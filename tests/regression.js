// 运行:npm install jsdom && node tests/regression.js
const fs = require("fs");
const path = require("path");
const { JSDOM, VirtualConsole } = require(process.env.JSDOM_PATH || "jsdom");
const FILE = process.argv[2] || require("path").join(__dirname, "..", "index.html");
const html = fs.readFileSync(FILE, "utf-8");
let pass=0, fail=0;
const ok=(c,m)=>{ c?(pass++,console.log("PASS:",m)):(fail++,console.error("FAIL:",m)); };
const KILL = setInterval(()=>{}, 1<<30);

function make(seed){
  const errors=[];
  const vc = new VirtualConsole()
    .on("jsdomError", e=>errors.push(String(e.detail ? (e.detail.stack||e.detail) : e.message)))
    .on("console.error", (...a)=>errors.push(a.join(" ")));
  const dom = new JSDOM(html, {
    runScripts:"dangerously", url:"http://localhost/l.html", virtualConsole: vc,
    beforeParse(win){
      win.scrollTo = ()=>{}; win.confirm = ()=>true;
      if(seed) win.localStorage.setItem("leak-ledger-v1", JSON.stringify(seed));
      win.HTMLElement.prototype.scrollIntoView = function(){};
    }
  });
  return { dom, w: dom.window, doc: dom.window.document, errors };
}
const submit=(w,el)=>el.dispatchEvent(new w.Event("submit",{bubbles:true,cancelable:true}));

/* 1 冷启动 */
{
  console.log("\n=== 1 冷启动 ===");
  const { w, doc, errors } = make();
  const q=id=>doc.getElementById(id);
  ok(errors.length===0, "启动无错误 -> "+(errors[0]||"无"));
  ok(!Array.from(doc.querySelectorAll('[role="alert"]')).some(el=>!/form-error/.test(el.className)), "没有启动失败红条");
  ok(q("odo").querySelectorAll(".od").length>=4, "滚轮数字已构建 -> "+q("odo").querySelectorAll(".od").length);
  ok(q("odo").getAttribute("data-value")==="0.00", "空账本显示 0 -> "+q("odo").getAttribute("data-value"));
  ok(q("gauge").querySelectorAll(".tick").length===13, "量表 13 根刻度 -> "+q("gauge").querySelectorAll(".tick").length);
  ok(/^\d{4}年\d{1,2}月$/.test(q("m-title").textContent), "月份标题 -> "+q("m-title").textContent);
  ok(q("fixed-list").textContent.includes("还没有")||q("fixed-list").textContent.includes("No fixed"), "固定清单空态");
  ok(q("flow-list").textContent.includes("Nothing"), "流水空态");
  ok(q("c1").innerHTML.includes("chart-empty"), "图表空态");
  ok(q("f-sign").textContent==="狮子座", "默认生日 = 狮子座");
  ok(q("q-date").value === new Date().toISOString().slice(0,10), "日期默认今天");
  w.close();
}

/* 2 示例数据 */
{
  console.log("\n=== 2 示例数据 ===");
  const { w, doc, errors } = make();
  const q=id=>doc.getElementById(id);
  q("btn-demo").click();
  ok(errors.length===0, "示例无错误 -> "+(errors[0]||"无"));
  ok(doc.querySelectorAll(".row[data-id]").length===6, "固定行 6 条 -> "+doc.querySelectorAll(".row[data-id]").length);
  ok(doc.querySelectorAll(".frow").length===16, "流水 16 条 -> "+doc.querySelectorAll(".frow").length);
  ok(parseFloat(q("g-month").textContent.replace(/[¥,]/g,""))>3000, "月折算已渲染 -> "+q("g-month").textContent);
  ok(q("gauge").querySelector(".arc-val").getAttribute("d").length>10, "量表已画出达成弧");
  ok(doc.querySelectorAll(".fl-item").length>0, "支出流已生成");
  ok(doc.querySelectorAll(".bar").length>0, "图表柱已生成");
  ok(doc.querySelectorAll(".bar").length>=10, "示例已铺满整月 -> "+doc.querySelectorAll(".bar").length+" 根柱");
  ok(q("m-proj").textContent.startsWith("¥"), "月底预估 -> "+q("m-proj").textContent);
  w.close();
}

/* 3 流水录入 + 撤销 */
{
  console.log("\n=== 3 流水录入 ===");
  const { w, doc, errors } = make();
  const q=id=>doc.getElementById(id);
  const before = doc.querySelectorAll(".frow").length;
  q("q-amt").value="32.5"; q("q-note").value='<img src=x onerror=alert(1)>';
  q("q-chips").querySelector('[data-cat="cafe"]').click();
  submit(w, q("flow-form"));
  ok(errors.length===0, "提交无错误");
  ok(doc.querySelectorAll(".frow").length===before+1, "流水 +1");
  const note = doc.querySelector(".frow .note").innerHTML;
  ok(!note.includes("<img") && note.includes("&lt;img"), "备注已转义");
  ok(q("toast").textContent.includes("已记下"), "toast 提示 -> "+q("toast").textContent.trim());
  ok(!!q("toast-act"), "toast 带撤回按钮");
  q("toast-act").click();
  ok(doc.querySelectorAll(".frow").length===before, "撤回后恢复 -> "+doc.querySelectorAll(".frow").length);
  ok(q("q-amt").value==="", "提交后金额清空");
  w.close();
}

/* 4 固定开支 CRUD */
{
  console.log("\n=== 4 固定开支 CRUD ===");
  const { w, doc, errors } = make();
  const q=id=>doc.getElementById(id);
  q("i-name").value="房租"; q("i-amt").value="3000"; q("i-cat").value="rent"; q("i-cycle").value="month";
  submit(w, q("item-form"));
  ok(doc.querySelectorAll(".row[data-id]").length===1, "新增 1 行");
  ok(doc.querySelector(".row[data-id] .r-name").textContent.includes("房租"), "名称显示");
  ok(doc.querySelector(".row[data-id] .r-amt .d").textContent.includes("98.56"), "日均折算 -> "+doc.querySelector(".row[data-id] .r-amt .d").textContent);
  ok(doc.querySelectorAll(".tick").length===13, "量表仍在");

  doc.querySelector('.row[data-id] [data-act="toggle"]').click();
  ok(doc.querySelector(".row[data-id]").className.includes("paused"), "暂停生效");
  ok(q("odo").getAttribute("data-value")==="0.00", "暂停后滚轮归零 -> "+q("odo").getAttribute("data-value"));
  doc.querySelector('.row[data-id] [data-act="toggle"]').click();

  doc.querySelector('.row[data-id] [data-act="edit"]').click();
  ok(q("i-name").value==="房租", "编辑回填");
  ok(q("i-submit").textContent.includes("保存"), "进入编辑态");
  q("i-amt").value="3600"; submit(w, q("item-form"));
  ok(doc.querySelectorAll(".row[data-id]").length===1, "保存不新增");

  doc.querySelector('.row[data-id] [data-act="del"]').click();
  ok(q("confirm-mask").className.includes("open"), "删除弹窗打开");
  q("confirm-ok").click();
  ok(doc.querySelectorAll(".row[data-id]").length===0, "删除生效");
  ok(!!q("toast-act"), "删除后可撤回");
  q("toast-act").click();
  ok(doc.querySelectorAll(".row[data-id]").length===1, "撤回恢复删除");
  ok(errors.length===0, "CRUD 全程无错误 -> "+(errors[0]||"无"));
  w.close();
}

/* 5 持久化 */
{
  console.log("\n=== 5 持久化 ===");
  const { w, doc } = make();
  const q=id=>doc.getElementById(id);
  q("btn-demo").click();
  const saved = w.localStorage.getItem("leak-ledger-v1");
  ok(!!saved && JSON.parse(saved).items.length===6, "已写入 localStorage");
  const r = make(JSON.parse(saved));
  ok(r.errors.length===0, "带存档重启无错误 -> "+(r.errors[0]||"无"));
  ok(r.doc.querySelectorAll(".row[data-id]").length===6, "重启后固定 6 条");
  ok(r.doc.querySelectorAll(".frow").length===16, "重启后流水 16 条");
  ok(r.doc.getElementById("f-birth").value==="1998-07-24", "生日恢复");
  w.close(); r.w.close();
}

/* 6 导出导入 */
{
  console.log("\n=== 6 导出 / 导入 ===");
  const { w, doc, errors } = make();
  const q=id=>doc.getElementById(id);
  q("btn-demo").click();
  let blob=null;
  const Ob = w.Blob; w.Blob = class { constructor(p){ blob=p.join(""); } };
  w.URL.createObjectURL = ()=>"blob:x"; w.URL.revokeObjectURL = ()=>{};
  q("btn-export").click();
  w.Blob = Ob;
  ok(!!blob && JSON.parse(blob).flows.length===16, "导出内容完整");
  q("btn-clear").click(); q("confirm-ok").click();
  ok(doc.querySelectorAll(".row[data-id]").length===0, "清空生效");

  const input=q("file-import");
  Object.defineProperty(input,"files",{value:[{name:"b.json"}],configurable:true});
  const RF = w.FileReader;
  w.FileReader = class { readAsText(){ this.result=blob; this.onload(); } };
  input.dispatchEvent(new w.Event("change",{bubbles:true}));
  w.FileReader = RF;
  ok(errors.length===0, "导入无错误 -> "+(errors[0]||"无"));
  ok(doc.querySelectorAll(".row[data-id]").length===6, "导入恢复固定开支");
  ok(doc.querySelectorAll(".frow").length===16, "导入恢复流水");
  w.close();
}

/* 7 脏数据 & 无 rAF */
{
  console.log("\n=== 7 健壮性 ===");
  const bad = { items:[{name:"坏金额", amount:"25x", cycle:"month"},{name:"好", amount:30, cycle:"month"}], flows:[{date:"xx",amount:1}], createdAt:Date.now() };
  const r = make(bad);
  ok(r.errors.length===0, "脏存档不崩 -> "+(r.errors[0]||"无"));
  ok(r.doc.querySelectorAll(".row[data-id]").length===1, "坏金额被剔除 -> "+r.doc.querySelectorAll(".row[data-id]").length);
  r.w.close();

  const errors=[]; const vc = new VirtualConsole().on("jsdomError",e=>errors.push(String(e.detail?(e.detail.stack||e.detail):e.message)));
  const dom = new JSDOM(html,{runScripts:"dangerously",url:"http://localhost/l.html",virtualConsole:vc,
    beforeParse(win){ win.scrollTo=()=>{}; delete win.requestAnimationFrame; win.HTMLElement.prototype.scrollIntoView=function(){}; }});
  ok(!Array.from(dom.window.document.querySelectorAll('[role="alert"]')).some(el=>!/form-error/.test(el.className)), "无 requestAnimationFrame 也能启动");
  ok(dom.window.document.getElementById("odo").textContent.includes("0"), "无 rAF 时数字仍渲染");
  dom.window.close();
}

/* 8 运势 */
{
  console.log("\n=== 8 今日签 ===");
  const { w, doc } = make();
  const q=id=>doc.getElementById(id);
  ok(q("f-sign").textContent==="狮子座", "1998-07-24 = 狮子座");
  ok(/实岁 28/.test(q("f-meta").textContent), "年龄计算 -> "+q("f-meta").textContent);
  ok(doc.querySelectorAll(".fbar").length===4, "四项分数");
  ok(doc.querySelectorAll(".f-lucky span").length===3, "三个幸运标签");
  q("f-birth").value="2000-01-02";
  q("f-birth").dispatchEvent(new w.Event("change",{bubbles:true}));
  ok(q("f-sign").textContent==="摩羯座", "改生日 -> 摩羯座 -> "+q("f-sign").textContent);
  ok(JSON.parse(w.localStorage.getItem("leak-ledger-v1")).birth==="2000-01-02", "生日已持久化");
  w.close();
}

/* 9 键盘与弹窗 */
{
  console.log("\n=== 9 键盘 / 弹窗 ===");
  const { w, doc } = make();
  const q=id=>doc.getElementById(id);
  doc.dispatchEvent(new w.KeyboardEvent("keydown",{key:"n",bubbles:true}));
  ok(doc.activeElement===q("q-amt"), "按 N 聚焦金额 -> "+doc.activeElement.id);
  doc.dispatchEvent(new w.KeyboardEvent("keydown",{key:"?",bubbles:true}));
  ok(q("help-mask").className.includes("open"), "问号打开快捷键表");
  doc.dispatchEvent(new w.KeyboardEvent("keydown",{key:"Escape",bubbles:true}));
  ok(!q("help-mask").className.includes("open"), "Esc 关闭");
  w.close();
}
console.log(`\n================ 结果: PASS ${pass} / FAIL ${fail} ================`);
clearInterval(KILL);
process.exit(fail?1:0);
