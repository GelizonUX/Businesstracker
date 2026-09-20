const http=require('http'), fs=require('fs'), path=require('path');
const ROOT=path.resolve(__dirname,'..');
const TYPES={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml'};
function serve(){
  return new Promise(function(res){
    var s=http.createServer(function(req,rp){
      /* Proxy the Firebase Auth emulator through this origin. The app's CSP is
         connect-src 'self', so a different PORT is a different origin and would be
         refused: the only way the real page can talk to the real emulator is same-origin. */
      if(req.url.indexOf('/__emu/')===0){
        var body='';
        req.on('data',function(c){ body+=c; });
        req.on('end',function(){
          var opt={host:'127.0.0.1',port:9099,path:req.url.replace('/__emu',''),method:req.method,
                   headers:{'Content-Type':'application/json'}};
          var pr=http.request(opt,function(pres){
            rp.writeHead(pres.statusCode,{'Content-Type':'application/json'});
            pres.pipe(rp);
          });
          pr.on('error',function(e){ rp.writeHead(502); rp.end(JSON.stringify({error:{message:String(e.message)}})); });
          if(body) pr.write(body);
          pr.end();
        });
        return;
      }
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
  ['greet-root','onboard-root','lock-root','consent-root'].forEach(function(id){ var e=document.getElementById(id); if(e) e.innerHTML=''; });
  document.querySelectorAll('.greet-overlay,.onb-overlay,.toast').forEach(function(e){ e.remove(); });
};
async function boot(page,opts){
  opts=opts||{};
  await page.addInitScript(function(){ try{ localStorage.setItem('bizpilot.tourdone','1'); }catch(_){ } });
  await page.goto(opts.url,{waitUntil:'load'});
  await page.waitForFunction(function(){ return typeof window.state==='object'&&window.state&&window.state.settings; },null,{timeout:30000});
  await page.evaluate(function(o){
    state.settings.onboarded=true; state.settings.startDismissed=true;
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
