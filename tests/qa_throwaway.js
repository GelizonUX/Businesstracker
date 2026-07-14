const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const { webcrypto } = require('node:crypto');

const APP = '/home/user/Businesstracker/index.html';
const html = fs.readFileSync(APP, 'utf8');
const results = [];
function rec(name, cond, extra){ results.push({name, ok: !!cond, extra}); console.log((cond?'PASS':'FAIL')+' — '+name+(!cond&&extra!==undefined?'  >> '+JSON.stringify(extra):'')); }
const wait = (ms)=>new Promise(r=>setTimeout(r,ms));

const winErrors = [];
const consoleErrors = [];

const dom = new JSDOM(html, { runScripts:'dangerously', resources:'usable', url:'https://x.test/', pretendToBeVisual:true });
const { window } = dom;
const d = window.document;
Object.defineProperty(window,'crypto',{value:webcrypto,configurable:true,writable:true});
window.TextEncoder = global.TextEncoder; window.TextDecoder = global.TextDecoder;
window.Element.prototype.getBoundingClientRect = function(){ return {top:100,left:90,right:260,bottom:140,width:170,height:40,x:90,y:100}; };
Object.defineProperty(window,'innerWidth',{value:1280,configurable:true});
Object.defineProperty(window,'innerHeight',{value:800,configurable:true});
window.addEventListener('error',(e)=>{ const m=(e.error&&e.error.stack)||e.message; winErrors.push(m); console.log('WINDOW ERROR >>',m); });
// capture console.error from app (modal submit catch, etc.)
const realErr = console.error.bind(console);
window.console = Object.assign({}, console, { error:function(){ consoleErrors.push(Array.from(arguments).map(String).join(' ')); realErr.apply(null,arguments); } });

function click(el){ if(el) el.dispatchEvent(new window.MouseEvent('click',{bubbles:true,cancelable:true})); }
function setVal(form,name,v){ const el=form.elements[name]; if(el){ el.value=v; } return !!el; }
function submitModal(){ const f=d.getElementById('modal-form'); if(!f) return false; f.dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true})); return true; }
function svgValid(s){ return typeof s==='string' && s.indexOf('<svg')===0 && s.indexOf('NaN')===-1 && s.indexOf('undefined')===-1 && s.indexOf('Infinity')===-1; }

async function main(){
  window.GATE.enabled = false;
  window.bootApp();
  await wait(80);
  const gr=d.getElementById('gate-root'); if(gr) gr.innerHTML='';
  rec('app boots (state present)', !!window.state);
  window.loadSampleData();
  await wait(60);

  // ---------- 1. every route renders, non-empty, no throw ----------
  const routes = ['dashboard','finance','invoices','report','products','orders','accounts','utang','calculators','metrics','goals','roadmap','tasks','clients','manpower','notes','reviews','settings','assistant','insights'];
  const routeErrors=[], emptyRoutes=[];
  for(const rt of routes){
    const before = winErrors.length;
    try{
      window.location.hash='#/'+rt; window.render();
      const main = d.getElementById('main');
      const len = main? main.innerHTML.length : 0;
      if(len<80) emptyRoutes.push(rt+'(len='+len+')');
    }catch(e){ routeErrors.push(rt+': '+e.message); }
    if(winErrors.length>before) routeErrors.push(rt+' raised WINDOW ERROR');
  }
  rec('all 20 routes render without throw', routeErrors.length===0, routeErrors);
  rec('no route renders empty', emptyRoutes.length===0, emptyRoutes);

  // ---------- 2. core flows ----------
  // finance entry
  const fN=window.state.finance.length;
  window.entryModal({type:'income'});
  let f=d.getElementById('modal-form');
  setVal(f,'amount','1234'); setVal(f,'date','2026-07-01'); setVal(f,'note','QA income'); setVal(f,'category','Sales');
  submitModal();
  rec('finance entry persists (+1)', window.state.finance.length===fN+1);
  window.location.hash='#/finance'; window.render();
  rec('finance view reflects new entry', d.getElementById('main').innerHTML.indexOf('QA income')>-1 || window.state.finance.some(x=>x.note==='QA income'));

  // invoice
  const iN=window.state.invoices.length;
  window.invoiceModal();
  f=d.getElementById('modal-form'); setVal(f,'client','QA Client Co'); setVal(f,'amount','5000'); setVal(f,'desc','QA work'); submitModal();
  rec('invoice persists (+1)', window.state.invoices.length===iN+1);
  window.location.hash='#/invoices'; window.render();
  rec('invoice view reflects new invoice', d.getElementById('main').innerHTML.indexOf('QA Client Co')>-1);

  // task
  const tN=window.state.tasks.length;
  window.taskModal();
  f=d.getElementById('modal-form'); setVal(f,'title','QA task'); submitModal();
  rec('task persists (+1)', window.state.tasks.length===tN+1);
  window.location.hash='#/tasks'; window.render();
  rec('tasks view reflects new task', d.getElementById('main').innerHTML.indexOf('QA task')>-1);

  // goal
  const gN=window.state.goals.length;
  window.goalModal();
  f=d.getElementById('modal-form'); setVal(f,'title','QA goal'); setVal(f,'target','100000'); submitModal();
  rec('goal persists (+1)', window.state.goals.length===gN+1);
  window.location.hash='#/goals'; window.render();
  rec('goals view reflects new goal', d.getElementById('main').innerHTML.indexOf('QA goal')>-1);

  // client
  const cN=window.state.clients.length;
  window.clientModal();
  f=d.getElementById('modal-form'); setVal(f,'name','QA Person'); submitModal();
  rec('client persists (+1)', window.state.clients.length===cN+1);
  window.location.hash='#/clients'; window.render();
  rec('clients view reflects new client', d.getElementById('main').innerHTML.indexOf('QA Person')>-1);

  // product
  const pN=window.state.products.length;
  window.productModal();
  f=d.getElementById('modal-form'); setVal(f,'name','QA Widget'); setVal(f,'price','250'); setVal(f,'stock','10'); submitModal();
  rec('product persists (+1)', window.state.products.length===pN+1);
  window.location.hash='#/products'; window.render();
  rec('products view reflects new product', d.getElementById('main').innerHTML.indexOf('QA Widget')>-1);

  // order (needs a product selected)
  const oN=window.state.orders.length;
  window.orderModal();
  f=d.getElementById('modal-form');
  const prodOpt = window.state.products[0];
  const oiProd=f.querySelector('.oi-prod'), oiQty=f.querySelector('.oi-qty'), oiPrice=f.querySelector('.oi-price');
  if(oiProd){ oiProd.value=prodOpt.id; }
  if(oiQty){ oiQty.value='2'; }
  if(oiPrice){ oiPrice.value=String(prodOpt.price||100); }
  setVal(f,'clientName','QA Buyer');
  submitModal();
  rec('order persists (+1)', window.state.orders.length===oN+1, {have:window.state.orders.length, want:oN+1});
  window.location.hash='#/orders'; window.render();
  rec('orders view reflects new order', d.getElementById('main').innerHTML.indexOf('QA Buyer')>-1);

  // calculator (breakeven)
  window.location.hash='#/calculators'; window.render();
  let calcForm=d.querySelector('form[data-calc="breakeven"]');
  rec('calculator form present', !!calcForm);
  if(calcForm){
    calcForm.elements['fixed'].value='10000'; calcForm.elements['price'].value='500'; calcForm.elements['varcost'].value='200';
    calcForm.dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));
    const outEl=d.getElementById('calc-result-breakeven');
    rec('calculator produces a result', !!outEl && outEl.innerHTML.indexOf('Break-even')>-1, outEl?outEl.innerHTML.slice(0,60):null);
  }

  // ---------- 3. charts ----------
  const months=window.lastNMonths?window.lastNMonths(6):['2026-02','2026-03','2026-04','2026-05','2026-06','2026-07'];
  const mm={}; months.forEach((k,i)=>{ mm[k]={revenue:1000*(i+1), expenses:400*(i+1)}; });
  let s1=window.svgSeries(months,mm,'bars'); let s2=window.svgSeries(months,mm,'line'); let s3=window.svgSeries(months,mm,'area');
  rec('svgSeries bars valid SVG', svgValid(s1));
  rec('svgSeries line valid SVG', svgValid(s2));
  rec('svgSeries area valid SVG', svgValid(s3));
  const donut=window.svgDonut([{label:'A',value:30},{label:'B',value:70}],150);
  rec('svgDonut valid SVG', svgValid(donut));
  const bars=window.catBarsHTML([{label:'A',value:30},{label:'B',value:70}]);
  rec('catBarsHTML non-empty, no NaN/undefined', typeof bars==='string'&&bars.length>0&&bars.indexOf('NaN')<0&&bars.indexOf('undefined')<0);
  const spark=window.svgSparkline([1,5,3,8,4,9],90,30,'var(--accent)','QA');
  rec('svgSparkline valid SVG', svgValid(spark));
  // edge: sparkline all-equal values (division guard)
  const sparkFlat=window.svgSparkline([5,5,5,5],90,30);
  rec('svgSparkline flat values no NaN', typeof sparkFlat==='string'&&sparkFlat.indexOf('NaN')<0);
  // .c-flow overlays present in line/area
  rec('.c-flow overlay present in line series', s2.indexOf('class="c-flow')>-1);
  rec('.c-spark-flow overlay present in sparkline', spark.indexOf('c-spark-flow')>-1);

  // data-ctip parses as JSON on rendered dashboard + finance + advisor
  function ctipCheck(route){
    window.location.hash='#/'+route; window.render();
    const nodes=d.querySelectorAll('[data-ctip]');
    let bad=0, total=0;
    nodes.forEach(n=>{ total++; try{ const o=JSON.parse(n.getAttribute('data-ctip')); if(!o||typeof o!=='object') bad++; }catch(_){ bad++; } });
    return {total, bad};
  }
  const dashTip=ctipCheck('dashboard'), finTip=ctipCheck('finance'), advTip=ctipCheck('insights');
  rec('dashboard data-ctip all parse as JSON', dashTip.bad===0 && dashTip.total>0, dashTip);
  rec('finance data-ctip all parse as JSON', finTip.bad===0, finTip);
  rec('advisor(insights) data-ctip all parse as JSON', advTip.bad===0, advTip);

  // chart-style switcher re-renders + persists
  window.location.hash='#/dashboard'; window.render();
  const styleBtn=d.querySelector('[data-action="chart-style"]');
  rec('chart-style switcher present on dashboard', !!styleBtn);
  if(styleBtn){
    const chart=styleBtn.getAttribute('data-chart'), style=styleBtn.getAttribute('data-style');
    const before=winErrors.length;
    click(styleBtn);
    await wait(20);
    const persisted = window.state.settings.chartStyles && window.state.settings.chartStyles[chart]===style;
    rec('chart-style click persists preference + no error', persisted && winErrors.length===before, {chart,style,persisted});
  }
  // tooltip hover with c-flow present doesn't break chartTipShow
  window.location.hash='#/finance'; window.render();
  const hot=d.querySelector('[data-ctip]');
  if(hot){
    const before=winErrors.length;
    try{ window.chartTipShow(hot.getAttribute('data-ctip'), 100, 100); }catch(e){ winErrors.push('chartTipShow: '+e.message); }
    rec('chartTipShow parses ctip + no error', winErrors.length===before);
  }

  // ---------- 4. assistant offline router ----------
  window.location.hash='#/assistant'; window.render();
  await wait(20);
  function asstSay(text){
    const inp=window.assistantInputEl(); if(!inp) return 0;
    inp.value=text;
    const before=window.state.chat?window.state.chat.length:0;
    window.assistantSend();
    return before;
  }
  const chat0=window.state.chat?window.state.chat.length:0;
  asstSay('Spent 500 on facebook ads today');
  await wait(20);
  const afterLog=window.state.chat.length;
  rec('assistant: log message produces bot reply', afterLog>chat0+1 && window.state.chat.some(m=>m.role==='bot'));
  asstSay('how much did I spend this month?');
  await wait(20);
  rec('assistant: question produces bot reply', window.state.chat.length>afterLog && window.state.chat[window.state.chat.length-1].role==='bot');
  const q2=window.state.chat.length;
  asstSay('yes');
  await wait(20);
  rec('assistant: follow-up "yes" handled (bot responds)', window.state.chat.length>=q2 && window.state.chat[window.state.chat.length-1].role==='bot');
  asstSay('hello');
  await wait(20);
  rec('assistant: small talk handled', window.state.chat[window.state.chat.length-1].role==='bot');

  // ---------- 5. data integrity: serialize round-trip ----------
  const snap = JSON.stringify(window.state);
  const counts = {finance:window.state.finance.length, invoices:window.state.invoices.length, tasks:window.state.tasks.length, goals:window.state.goals.length, clients:window.state.clients.length, products:window.state.products.length, orders:window.state.orders.length};
  // round-trip through the app's own merge path (deepMerge of DEFAULT_STATE + parsed)
  let rehydrated;
  try{ rehydrated = window.deepMerge(JSON.parse(JSON.stringify(window.DEFAULT_STATE)), JSON.parse(snap)); }catch(e){ rehydrated=null; }
  const rtOK = rehydrated && rehydrated.finance.length===counts.finance && rehydrated.invoices.length===counts.invoices && rehydrated.orders.length===counts.orders && rehydrated.products.length===counts.products;
  rec('state serialize -> deepMerge round-trips (no data loss)', rtOK, {counts, after: rehydrated?{finance:rehydrated.finance.length, orders:rehydrated.orders.length}:null});
  // re-serialize equality of key arrays
  rec('round-trip re-serialize preserves finance array', rehydrated && JSON.stringify(rehydrated.finance)===JSON.stringify(window.state.finance));

  // ---------- 5b. undo/redo ----------
  // global finance undo (doUndo / snapshotForUndo)
  window.snapshotForUndo();
  const preDel = window.state.finance.length;
  window.state.finance.pop();
  window.doUndo();
  await wait(20);
  rec('doUndo restores finance count', window.state.finance.length===preDel, {have:window.state.finance.length, want:preDel});
  const afterUndoValid = window.state && Array.isArray(window.state.finance) && Array.isArray(window.state.roadmaps);
  rec('state not corrupt after doUndo', afterUndoValid);

  // roadmap undo/redo
  window.location.hash='#/roadmap'; window.render();
  await wait(20);
  if(window.state.roadmaps && window.state.roadmaps.length){
    window.rmSnapshot();
    const rm=window.currentRoadmap();
    const phasesBefore = rm ? (rm.phases||[]).length : 0;
    // mutate: add a phase-ish change via snapshot then undo
    if(rm){ rm.phases=rm.phases||[]; rm.phases.push({id:window.uid(),name:'QA phase',tasks:[],order:rm.phases.length}); }
    window.rmUndoRoad();
    await wait(20);
    const rm2=window.currentRoadmap();
    rec('rmUndoRoad reverts roadmap change', rm2 && (rm2.phases||[]).length===phasesBefore, {before:phasesBefore, after:rm2?(rm2.phases||[]).length:null});
    window.rmRedo();
    await wait(20);
    const rm3=window.currentRoadmap();
    rec('rmRedo re-applies roadmap change', rm3 && (rm3.phases||[]).length===phasesBefore+1, {after:rm3?(rm3.phases||[]).length:null});
    rec('state not corrupt after rm undo/redo', Array.isArray(window.state.finance)&&Array.isArray(window.state.roadmaps));
  } else {
    rec('roadmap present for undo test', false, 'no roadmaps in sample data');
  }

  // ---------- 6. re-render every route AFTER mutations (regression) ----------
  const routeErrors2=[];
  for(const rt of routes){
    const before=winErrors.length;
    try{ window.location.hash='#/'+rt; window.render(); }catch(e){ routeErrors2.push(rt+': '+e.message); }
    if(winErrors.length>before) routeErrors2.push(rt+' WINDOW ERROR');
  }
  rec('all routes still render after mutations', routeErrors2.length===0, routeErrors2);

  // ---------- summary ----------
  await wait(50);
  rec('no WINDOW ERROR captured across whole run', winErrors.length===0, winErrors.slice(0,8));
  rec('no console.error captured across whole run', consoleErrors.length===0, consoleErrors.slice(0,8));

  const failed=results.filter(r=>!r.ok);
  console.log('\n==== SUMMARY ====');
  console.log(results.length+' checks, '+(results.length-failed.length)+' passed, '+failed.length+' failed');
  if(failed.length){ console.log('FAILED:'); failed.forEach(fl=>console.log('  - '+fl.name+(fl.extra!==undefined?'  >> '+JSON.stringify(fl.extra):''))); }
  console.log('WINDOW ERRORS: '+winErrors.length);
  console.log('CONSOLE ERRORS: '+consoleErrors.length);
  process.exit(0);
}
main().catch(e=>{ console.log('HARNESS CRASH >>', e.stack||e.message); process.exit(1); });
