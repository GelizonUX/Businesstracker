const fs=require('fs'),path=require('path');const {JSDOM}=require('jsdom');const {webcrypto}=require('node:crypto');
const html=fs.readFileSync('/home/user/Businesstracker/index.html','utf8');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const dom=new JSDOM(html,{runScripts:'dangerously',resources:'usable',url:'https://x.test/',pretendToBeVisual:true});
const {window}=dom;const d=window.document;
Object.defineProperty(window,'crypto',{value:webcrypto,configurable:true,writable:true});
window.TextEncoder=global.TextEncoder;window.TextDecoder=global.TextDecoder;
window.Element.prototype.getBoundingClientRect=function(){return{top:0,left:0,right:1200,bottom:800,width:1200,height:800,x:0,y:0};};
window.addEventListener('error',e=>console.log('WINERR',(e.error&&e.error.stack)||e.message));
function pdown(el,x,y,sh){el.dispatchEvent(new window.MouseEvent('pointerdown',{bubbles:true,cancelable:true,clientX:x,clientY:y,button:0,shiftKey:!!sh}));}
function pup(el,x,y,sh){el.dispatchEvent(new window.MouseEvent('pointerup',{bubbles:true,cancelable:true,clientX:x,clientY:y,button:0,shiftKey:!!sh}));}
const K=o=>Object.keys(o||{});
function seed(){window.state.roadmaps=[{id:'R',name:'m',color:'#7c5cd6',phases:[{id:'PH1',name:'p',x:600,y:300,tasks:[]}],notes:[{id:'N1',x:500,y:400,text:'n',kind:'sticky',w:190,h:170}],stamps:[{id:'S1',x:500,y:400,emoji:'x'}],frames:[{id:'F1',x:200,y:200,w:300,h:200,name:'f'}],tables:[{id:'T1',x:300,y:500,rows:2,cols:2,cells:[['a','b'],['c','d']]}],comments:[{id:'C1',x:800,y:600,text:'c'}],ink:[{id:'I1',color:'#e0554e',w:3,pts:[[100,100],[150,150]]}]}];window.ui.roadmapId='R';window.location.hash='#/roadmap';window.render();}
async function m(){
 window.GATE.enabled=false;window.bootApp();await wait(80);if(d.getElementById('gate-root'))d.getElementById('gate-root').innerHTML='';window.loadSampleData();await wait(40);
 async function shiftClick(sel,x,y,label){seed();await wait(15);let b=d.getElementById('rm-board');window.ui.rmCam={x:0,y:0,z:1};window.rmCvRectInvalidate();window.rmSelectOnly('note:N1');let el=b.querySelector(sel);if(!el){console.log(label,'-> element not found');return;}pdown(el,x,y,true);pup(el,x,y,true);console.log(label,'-> sel now:',K(window.ui.rmSelSet).sort());}
 console.log('start selection is always {note:N1}. Shift-click a DIFFERENT object should TOGGLE it in (=> both present):');
 await shiftClick('.rm-stamp[data-stamp="S1"]',500,400,'shift-click STAMP');
 await shiftClick('.rm-frame[data-frame="F1"]',210,210,'shift-click FRAME');
 await shiftClick('.rm-table-grip[data-table-grip="T1"]',305,505,'shift-click TABLE grip');
 await shiftClick('.rm-comment[data-comment="C1"]',800,600,'shift-click COMMENT');
 // ink shift toggle (should work)
 seed();await wait(15);{let b=d.getElementById('rm-board');window.ui.rmCam={x:0,y:0,z:1};window.rmCvRectInvalidate();window.rmSelectOnly('note:N1');let pl=b.querySelector('polyline[data-ink="I1"]');pdown(pl,120,120,true);pup(pl,120,120,true);console.log('shift-click INK -> sel now:',K(window.ui.rmSelSet).sort());}
 // node shift toggle (baseline that works)
 seed();await wait(15);{let b=d.getElementById('rm-board');window.ui.rmCam={x:0,y:0,z:1};window.rmCvRectInvalidate();window.rmSelectOnly('note:N1');let nd=b.querySelector('.rm-node[data-nid="p:PH1"]');pdown(nd,600,300,true);pup(nd,600,300,true);console.log('shift-click NODE p:PH1 -> sel now:',K(window.ui.rmSelSet).sort());}
}
m().then(()=>setTimeout(()=>process.exit(0),150));
