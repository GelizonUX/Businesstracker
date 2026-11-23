const http=require('http'), fs=require('fs'), path=require('path');
const ROOT=path.resolve(__dirname,'..');
const TYPES={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml'};
function serve(){
  return new Promise(function(res){
    var s=http.createServer(function(req,rp){
      var u=decodeURIComponent(req.url.split('?')[0].split('#')[0]);
      if(u==='/') u='/index.html';
      var f=path.join(ROOT,u);
      if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){ rp.writeHead(404); return rp.end('no'); }
      rp.writeHead(200,{'Content-Type':TYPES[path.extname(f)]||'application/octet-stream'});
      fs.createReadStream(f).pipe(rp);
    });
    s.listen(0,'127.0.0.1',function(){ res({server:s,port:s.address().port}); });
  });
}
const CLEAN=function(){
  var e=document.getElementById('lock-root'); if(e) e.innerHTML='';
  document.querySelectorAll('.toast').forEach(function(e){ e.remove(); });
};
async function boot(page,opts){
  opts=opts||{};
  await page.goto(opts.url,{waitUntil:'load'});
  await page.waitForFunction(function(){ return typeof window.state==='object'&&window.state&&window.state.settings; },null,{timeout:30000});
  await page.evaluate(function(o){
    // an owner who has already opened the book: no first-run question, no connections notice
    state.settings.onboarded=true;
    state.settings.privacy=Object.assign({},state.settings.privacy,{consent:'all'});
    if(o.sample&&typeof loadSampleData==='function'&&state.finance.length===0) loadSampleData();
    save(); applyTheme(); render();
  },opts);
  await page.evaluate(CLEAN);
  await page.waitForTimeout(200);
  return page;
}
async function settle(page){
  await page.waitForTimeout(120);
  await page.evaluate(async function(){
    var fin=document.getAnimations().filter(function(a){
      try{ var t=a.effect&&a.effect.getComputedTiming?a.effect.getComputedTiming():null;
           return t && t.iterations!==Infinity && isFinite(t.endTime); }catch(_){ return false; }
    }).map(function(a){ return a.finished.catch(function(){}); });
    await Promise.race([Promise.all(fin), new Promise(function(r){ setTimeout(r,1500); })]);
  }).catch(function(){});
  await page.waitForTimeout(80);
}
module.exports={serve,boot,settle,CLEAN};
