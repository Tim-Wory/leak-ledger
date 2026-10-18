const fs = require("fs");
// 运行:npm install jsdom && node 漏钱账本-回归测试.js
const { JSDOM, VirtualConsole } = require(process.env.JSDOM_PATH || "jsdom");
process.on("beforeExit", ()=>{});   // 页面有午夜定时器,脚本统一在结尾硬退出
const KILL_TIMERS = setInterval(()=>{}, 1<<30);
const path = require("path");
const FILE = process.argv[2] || path.join(__dirname, "漏钱账本-v2.html");"/Users/wory/Documents/new-skill-test/漏钱账本-v2.html";
const html = fs.readFileSync(FILE, "utf-8");

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log("PASS:", m)) : (fail++, console.error("FAIL:", m)); };

function boot(seed){
  const errors = [];
  const vc = new VirtualConsole()
    .on("jsdomError", e => errors.push("jsdomError: " + (e.detail ? (e.detail.stack||e.detail) : e.message)))
    .on("error", (...a) => errors.push("console.error: " + a.join(" ")));
  const dom = new JSDOM(html, { runScripts:"dangerously", url:"http://localhost/local.html", virtualConsole: vc, pretendToBeVisual:false,
    beforeParse(win){ win.scrollTo = () => {}; } });
  if(seed) dom.window.localStorage.setItem("leak-ledger-v1", JSON.stringify(seed));
  return { dom, w: dom.window, doc: dom.window.document, errors };
}
function rebootWithStorage(seed, priorStorageKeys){
  // 用同一份 localStorage 内容启动一个新实例(模拟刷新)
  const errors = [];
  const vc = new VirtualConsole()
    .on("jsdomError", e => errors.push("jsdomError: " + (e.detail ? (e.detail.stack||e.detail) : e.message)))
    .on("error", (...a) => errors.push("console.error: " + a.join(" ")));
  const dom = new JSDOM(html, { runScripts:"dangerously", url:"http://localhost/local.html", virtualConsole: vc,
    beforeParse(win){ win.scrollTo = () => {}; priorStorageKeys.forEach(([k,v])=> win.localStorage.setItem(k, v)); } });
  return { dom, w: dom.window, doc: dom.window.document, errors };
}
const submit = (w, form) => form.dispatchEvent(new w.Event("submit",{bubbles:true,cancelable:true}));

/* ============ 1. 冷启动 ============ */
console.log("\n=== 1. 冷启动(空账本) ===");
{
  const { w, doc, errors } = boot();
  const q = id => doc.getElementById(id);
  ok(errors.length === 0, "启动无 JS 错误 -> " + (errors[0]||"无"));
  ok(!doc.querySelector('[role="alert"]'), "没有出现启动失败红条");
  ok(q("daily").textContent === "0.00", "今日数为 0");
  ok(q("m-total").textContent === "0.00", "月度数为 0");
  ok(doc.querySelectorAll(".item").length === 0 && q("list").textContent.includes("还没有"), "固定清单显示空态");
  ok(q("flow-list").textContent.includes("还没有"), "流水清单显示空态");
  ok(q("chart-combo").innerHTML.includes("chart-empty"), "组合图显示空态");
  ok(q("chart-week").innerHTML.includes("chart-empty"), "星期图显示空态");
  ok(q("m-title").textContent.match(/^\d{4}年\d{1,2}月$/), "月份标题正常 -> " + q("m-title").textContent);
  w.close();
}

/* ============ 2. 示例数据 ============ */
console.log("\n=== 2. 填入示例数据 ===");
{
  const { w, doc, errors } = boot();
  const q = id => doc.getElementById(id);
  w.confirm = () => true;
  q("btn-demo").click();
  ok(errors.length === 0, "示例数据无报错 -> " + (errors[0]||"无"));
  const items = doc.querySelectorAll(".item").length;
  const flows = doc.querySelectorAll(".flow-row").length;
  ok(items === 5, "示例固定开支 5 笔(空账本时含房租)-> " + items);
  ok(flows === 6, "示例流水 6 条(含 1 笔冲销)-> " + flows);
  ok(parseFloat(q("daily").textContent) > 0, "今日固定流失 > 0 -> " + q("daily").textContent);
  ok(parseFloat(q("m-total").textContent.replace(/,/g,"")) > 0, "月度总流失 > 0 -> " + q("m-total").textContent);
  ok(q("m-donut").innerHTML.includes("<svg"), "环图已渲染");
  ok((q("chart-combo").innerHTML.match(/<rect/g)||[]).length > 0, "组合图有柱");
  ok((q("chart-week").innerHTML.match(/<rect/g)||[]).length === 7, "星期图 7 根 -> " + (q("chart-week").innerHTML.match(/<rect/g)||[]).length);
  ok(doc.querySelector(".flow-row .f-amt.neg") !== null, "负数冲销显示为绿色 neg 样式");

  /* 月度切换 */
  const todayTitle = q("m-title").textContent;
  q("m-prev").click();
  ok(q("m-title").textContent !== todayTitle, "上一个月生效 -> " + q("m-title").textContent);
  ok(doc.querySelectorAll(".flow-row").length === 0, "切到无数据月份流水为空");
  q("m-today").click();
  ok(q("m-title").textContent === todayTitle, "回到本月 -> " + q("m-title").textContent);
  ok(doc.querySelectorAll(".flow-row").length === flows, "回到本月流水恢复");
  w.close();
}

/* ============ 3. 记流水 + XSS + 负数 + 校验 ============ */
console.log("\n=== 3. 手工记流水 ===");
{
  const { w, doc, errors } = boot();
  const q = id => doc.getElementById(id);
  const today = q("f-flow-date").value;
  ok(/^\d{4}-\d{2}-\d{2}$/.test(today), "日期输入默认今天 -> " + today);

  q("f-flow-amt").value = "32.5";
  q("f-flow-note").value = '<img src=x onerror=alert(1)>';
  submit(w, q("flow-form"));
  ok(errors.length === 0, "提交无报错");
  ok(doc.querySelectorAll(".flow-row").length === 1, "流水 +1");
  const note = doc.querySelector(".flow-row .note").innerHTML;
  ok(!note.includes("<img") && note.includes("&lt;img"), "备注被 HTML 转义 -> " + note.slice(0,34));
  ok(q("f-flow-amt").value === "", "提交后金额已清空");
  ok(q("f-flow-date").value === today, "提交后日期仍是今天");

  // 金额为 0 / 空 -> 报错不入库
  q("f-flow-amt").value = "0"; submit(w, q("flow-form"));
  ok(doc.querySelectorAll(".flow-row").length === 1, "金额 0 不入库");
  ok(!q("flow-error").hidden, "金额 0 时错误提示可见 -> " + q("flow-error").textContent);

  // 负数冲销入库
  q("f-flow-amt").value = "-32.5"; q("f-flow-note").value = "冲销";
  submit(w, q("flow-form"));
  ok(doc.querySelectorAll(".flow-row").length === 2, "负数冲销入库");
  ok(parseFloat(q("m-flow").textContent.replace(/[¥,]/g,"")) === 0, "一正一负后月流水为 0 -> " + q("m-flow").textContent);
  w.close();
}

/* ============ 4. 固定开支 CRUD ============ */
console.log("\n=== 4. 固定开支 增/停/编/删 ===");
{
  const { w, doc, errors } = boot();
  const q = id => doc.getElementById(id);
  q("f-name").value = "房租"; q("f-amount").value = "2800"; q("f-cat").value = "rent"; q("f-cycle").value = "month";
  submit(w, q("form"));
  ok(doc.querySelectorAll(".item").length === 1, "新增固定开支 1 笔");
  ok(parseFloat(q("daily").textContent) > 90, "日折算生效 -> " + q("daily").textContent);

  let item = doc.querySelector(".item");
  item.querySelector('[data-act="toggle"]').click();
  ok(doc.querySelector(".item").className.includes("paused"), "暂停状态生效");
  ok(q("daily").textContent === "0.00", "暂停后日流失归 0");
  doc.querySelector('.item [data-act="toggle"]').click();
  ok(parseFloat(q("daily").textContent) > 90, "恢复后日流失回来 -> " + q("daily").textContent);

  doc.querySelector('.item [data-act="edit"]').click();
  ok(!q("editing-note").hidden, "进入编辑态提示可见");
  ok(q("f-name").value === "房租", "编辑表单已回填 -> " + q("f-name").value);
  q("f-amount").value = "3000"; submit(w, q("form"));
  ok(doc.querySelectorAll(".item").length === 1, "编辑不新增条目");
  ok(doc.querySelector(".item .name").textContent.includes("房租"), "编辑后名称保留");

  doc.querySelector('.item [data-act="del"]').click();
  ok(q("confirm-mask").className.includes("open"), "删除弹窗已打开");
  ok(q("confirm-text").textContent.includes("房租"), "弹窗文案含条目名");
  q("confirm-cancel").click();
  ok(!q("confirm-mask").className.includes("open") && doc.querySelectorAll(".item").length === 1, "取消删除不生效");
  doc.querySelector('.item [data-act="del"]').click();
  q("confirm-ok").click();
  ok(doc.querySelectorAll(".item").length === 0, "确认删除生效");
  ok(errors.length === 0, "CRUD 全程无报错 -> " + (errors[0]||"无"));
  w.close();
}

/* ============ 5. 流水删除 + 持久化(刷新) ============ */
console.log("\n=== 5. 持久化与刷新恢复 ===");
{
  const { w, doc } = boot();
  const q = id => doc.getElementById(id);
  w.confirm = () => true;
  q("btn-demo").click();
  const before = doc.querySelectorAll(".flow-row").length;
  const saved = w.localStorage.getItem("leak-ledger-v1");
  ok(!!saved && JSON.parse(saved).flows.length > 0, "数据已写入 localStorage");

  const r2 = rebootWithStorage(null, [["leak-ledger-v1", saved]]);
  const q2 = id => r2.doc.getElementById(id);
  ok(r2.errors.length === 0, "带存档重启无报错 -> " + (r2.errors[0]||"无"));
  ok(r2.doc.querySelectorAll(".flow-row").length === before, "刷新后流水数量一致 -> " + r2.doc.querySelectorAll(".flow-row").length);
  ok(r2.doc.querySelectorAll(".item").length > 0, "刷新后固定开支还在");

  // 删除一条流水
  const t = r2.doc.querySelector('.flow-row [data-act="delflow"]');
  t.click();
  ok(r2.doc.getElementById("confirm-title").textContent.includes("流水"), "流水删除弹窗标题正确");
  r2.doc.getElementById("confirm-ok").click();
  ok(r2.doc.querySelectorAll(".flow-row").length === before - 1, "流水删除生效 -> " + before + " -> " + r2.doc.querySelectorAll(".flow-row").length);
  w.close(); r2.dom.window.close();
}

/* ============ 6. 导出/导入往返 ============ */
console.log("\n=== 6. 导出→清空→恢复 ===");
{
  const { w, doc, errors } = boot();
  const q = id => doc.getElementById(id);
  w.confirm = () => true;
  q("btn-demo").click();
  let blobText = null;
  class FakeBlob { constructor(parts){ blobText = parts.join(""); } }
  const origBlob = w.Blob;
  w.Blob = FakeBlob;
  w.URL = Object.assign({}, w.URL, { createObjectURL: () => "blob:x", revokeObjectURL(){} });
  const lyue = w.localStorage.getItem("leak-ledger-v1");
  q("btn-export").click();
  w.Blob = origBlob;
  ok(!!blobText && JSON.parse(blobText).flows.length > 0, "导出内容有效");

  // 清空后再导入
  q("btn-clear").click();
  ok(doc.querySelectorAll(".item").length === 0 && doc.querySelectorAll(".flow-row").length === 0, "清空生效");

  // 模拟选择文件:直接触发 change ,FileReader 用假数据
  const input = q("file-import");
  Object.defineProperty(input, "files", { value: [{ name: "backup.json" }], writable:true, configurable:true });
  const RealFR = w.FileReader;
  class FakeFR { readAsText(){ this.result = blobText; this.onload(); } }
  w.FileReader = FakeFR;
  input.dispatchEvent(new w.Event("change", { bubbles:true }));
  w.FileReader = RealFR;
  ok(errors.length === 0, "导入无报错 -> " + (errors[0]||"无"));
  ok(doc.querySelectorAll(".item").length === JSON.parse(lyue).items.length, "导入后固定开支数一致");
  ok(doc.querySelectorAll(".flow-row").length === JSON.parse(lyue).flows.length, "导入后流水数一致");

  // 重复导入不再翻倍
  const after1 = doc.querySelectorAll(".item").length;
  Object.defineProperty(input, "files", { value: [{ name: "backup.json" }], writable:true, configurable:true });
  w.FileReader = FakeFR;
  input.dispatchEvent(new w.Event("change", { bubbles:true }));
  w.FileReader = RealFR;
  ok(doc.querySelectorAll(".item").length === after1, "重复导入不翻倍 -> " + doc.querySelectorAll(".item").length);
  w.close();
}

/* ============ 7. 损坏存档容错 ============ */
console.log("\n=== 7. 脏存档容错 ===");
{
  const bad = JSON.stringify({ items:[ {name:"坏金额", amount:"25x", cycle:"month"} ], flows:[{date:"xx", amount:1}] });
  const r = rebootWithStorage(null, [["leak-ledger-v1", bad]]);
  ok(r.errors.length === 0, "脏存档启动不崩 -> " + (r.errors[0]||"无"));
  ok(!r.doc.querySelector('[role="alert"]'), "没有启动失败红条");
  ok(r.doc.getElementById("daily").textContent === "0.00", "脏存档被识别为无效 -> " + r.doc.getElementById("daily").textContent);
  r.dom.window.close();
}
{
  const notjson = "{ this is not json ";
  const r = rebootWithStorage(null, [["leak-ledger-v1", notjson]]);
  ok(r.errors.length === 0 && r.doc.getElementById("m-title").textContent.includes("年"), "非 JSON 存档也能启动");
  r.dom.window.close();
}


/* ============ 8. 敌对环境 & 运势 DOM ============ */
console.log("\n=== 8. 敌对环境(key API 缺失)与运势渲染 ===");
{
  // 8a:删掉 requestAnimationFrame,页面必须照常可用(这是刚把我们咬到的失效模式)
  const { JSDOM: J2, VirtualConsole: VC2 } = require(process.env.JSDOM_PATH || "jsdom");
  const errs = [];
  const vc = new VC2().on("jsdomError", e => errs.push(String(e.detail ? (e.detail.stack||e.detail) : e.message)));
  const d = new J2(fs.readFileSync(FILE,"utf-8"), {
    runScripts:"dangerously", url:"http://localhost/l.html", virtualConsole: vc,
    beforeParse(win){
      win.scrollTo = () => {};
      delete win.requestAnimationFrame;         // 故意抽掉,验证降级
      win.confirm = () => true;
    }});
  const doc = d.window.document, q = id => doc.getElementById(id);
  ok(errs.length === 0, "无 requestAnimationFrame 也不崩 -> " + (errs[0]||"无"));
  ok(!doc.querySelector('[role="alert"]'), "无 rAF 时没有报错红条");
  q("btn-demo").click();
  ok(doc.querySelectorAll(".item").length === 5, "无 rAF 时示例数据照常 -> " + doc.querySelectorAll(".item").length);
  ok(parseFloat(q("daily").textContent) > 0, "无 rAF 时今日数正常");
  d.window.close();
}
{
  // 8b:运势模块在真实 DOM 里渲染出内容
  const { w, doc } = boot();
  const q = id => doc.getElementById(id);
  ok(q("f-sign").textContent === "狮子座", "默认生日 -> 狮子座 -> " + q("f-sign").textContent);
  ok(q("f-birth").value === "1998-07-24", "生日输入框默认 1998-07-24 -> " + q("f-birth").value);
  ok(/\d/.test(q("f-total").textContent) && +q("f-total").textContent > 0, "综合分已渲染 -> " + q("f-total").textContent);
  ok(doc.querySelectorAll(".f-bar").length === 4, "四项分数条 -> " + doc.querySelectorAll(".f-bar").length);
  ok(doc.querySelectorAll(".f-chip").length === 3, "幸运色/数字/方位三个标签");
  ok(q("f-range").textContent.includes("7月23日"), "星座区间已显示 -> " + q("f-range").textContent);
  ok(q("f-meta").textContent.includes("实岁"), "年龄与生日倒计时 -> " + q("f-meta").textContent);
  ok(q("f-read").textContent.includes("狮子座"), "近期解析含狮子座内容");
  ok(doc.querySelector(".swatch") !== null, "幸运色色块已渲染");

  // 改生日 -> 换星座
  q("f-birth").value = "2000-01-02";
  q("f-birth").dispatchEvent(new w.Event("change", {bubbles:true}));
  ok(q("f-sign").textContent === "摩羯座", "改生日后重算为摩羯座 -> " + q("f-sign").textContent);
  ok(JSON.parse(w.localStorage.getItem("leak-ledger-v1")).birth === "2000-01-02", "生日已持久化到 localStorage");
  w.close();
}
{
  // 8c:动画节点存在(静态可查)
  const { doc } = boot();
  ok(doc.querySelectorAll(".drip .drop").length === 3, "滴水动画 3 个水滴");
  ok(doc.querySelectorAll(".drip .ripple").length === 3, "涟漪 3 个");
  ok(doc.querySelector(".wave-line path") !== null, "页底流光线条存在");
  ok(doc.querySelectorAll(".sun .rays line").length === 12, "太阳座光芒已画 -> " + doc.querySelectorAll(".sun .rays line").length);
  w_ignore: { const { dom } = boot(); dom.window.close(); }
}

console.log("\n================ 结果: PASS " + pass + " / FAIL " + fail + " ================");
clearInterval(KILL_TIMERS);
process.exit(fail ? 1 : 0);
