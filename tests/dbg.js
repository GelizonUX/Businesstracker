const fs=require('fs');const {JSDOM}=require('jsdom');const {webcrypto}=require('node:crypto');
const html=fs.readFileSync('/home/user/Businesstracker/index.html','utf8');
const dom=new JSDOM(html,{runScripts:'dangerously',resources:'usable',url:'https://x.test/',pretendToBeVisual:true});
const {window}=dom;Object.defineProperty(window,'crypto',{value:webcrypto,configurable:true,writable:true});
window.TextEncoder=global.TextEncoder;window.TextDecoder=global.TextDecoder;window.fetch=()=>Promise.reject(new Error('no'));
setTimeout(()=>{
 window.GATE.enabled=false;window.bootApp();
 setTimeout(()=>{
  const sp=window.svgSparkline([1,5,3,8,4,9],90,30,'var(--accent)','QA');
  console.log('len',sp.length);
  console.log('has c-spark-flow:', sp.indexOf('c-spark-flow'));
  console.log('has c-spark-line:', sp.indexOf('c-spark-line'));
  console.log(sp);
  process.exit(0);
 },100);
},50);
