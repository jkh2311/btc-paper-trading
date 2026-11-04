import {chromium} from 'playwright';
import http from 'node:http';
import path from 'node:path';
import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {timingSafeEqual} from 'node:crypto';

const APP='https://jkh2311.github.io/btc-paper-trading/';
const ORIGIN='https://jkh2311.github.io';
const TOKEN=process.env.BACKGROUND_TOKEN||'';
const DIR=process.env.RAILWAY_VOLUME_MOUNT_PATH||process.env.PAPER_DATA_DIR;
if(!DIR||TOKEN.length<32)throw Error('Persistent volume and 32+ character BACKGROUND_TOKEN required');
const keys={paper:'btc-paper-trading-state-v1',settings:'btc-paper-auto-settings-v1',signals:'btc-paper-signals-v1'};
const meta=path.join(DIR,'armed.json'),backup=path.join(DIR,'paper-backup.json');
let state={armed:false,initialized:false},context=null,page=null,lock=Promise.resolve(),lastError=null,heartbeatAt=0,lastWritten='';
const serial=fn=>{const t=lock.then(fn);lock=t.catch(()=>{});return t};
const read=async p=>{try{return JSON.parse(await readFile(p,'utf8'))}catch{return null}};
const save=async(p,x)=>{await writeFile(p+'.tmp',JSON.stringify(x),{mode:0o600});await rename(p+'.tmp',p)};
function auth(req){const token=(req.headers.authorization||'').replace(/^Bearer /,'');const a=Buffer.from(token),b=Buffer.from(TOKEN);return a.length===b.length&&timingSafeEqual(a,b)}
function headers(origin){const h={'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin'};if(origin===ORIGIN){h['Access-Control-Allow-Origin']=ORIGIN;h['Access-Control-Allow-Methods']='GET,POST,OPTIONS';h['Access-Control-Allow-Headers']='Authorization,Content-Type'}return h}
function send(res,status,value,origin){res.writeHead(status,headers(origin));res.end(JSON.stringify(value))}
async function body(req){let s='';for await(const piece of req){s+=piece;if(s.length>700000)throw Error('Too large')}return s?JSON.parse(s):{}}
async function getSnapshot(){if(!page||page.isClosed())throw Error('Browser unavailable');return page.evaluate(keys=>Object.fromEntries(Object.entries(keys).map(([k,v])=>[k,localStorage.getItem(v)])),keys)}
async function importSnapshot(value){
  if(!value||typeof value!=='object'||typeof value.paper!=='string')throw Error('Paper-only initial snapshot required');
  const out={};for(const [k,id] of Object.entries(keys)){const v=value[k];if(v==null)continue;if(typeof v!=='string'||v.length>600000||!JSON.parse(v)||Array.isArray(JSON.parse(v)))throw Error('Invalid '+k);out[id]=v}
  await page.evaluate(data=>{
    for(const [k,v] of Object.entries(data))localStorage.setItem(k,v);
    // The currently running phone app writes its old in-memory portfolio on
    // pagehide. Restore the imported values AFTER that legacy handler runs.
    // Otherwise the first server reload silently erases existing positions.
    window.addEventListener('pagehide',()=>{
      for(const [k,v] of Object.entries(data))localStorage.setItem(k,v);
    },{once:true});
  },out);
  await page.reload({waitUntil:'domcontentloaded',timeout:45000});
  const after=await getSnapshot();
  if(!after.paper)throw Error('Initial phone paper portfolio transfer missing');
  const source=JSON.parse(value.paper),restored=JSON.parse(after.paper);
  // Verify all imported active paper positions survived the reload. A position
  // may legitimately close immediately, in which case it appears in trades.
  const ids=x=>['LONG','SHORT'].flatMap(side=>{
    const raw=x.hedgePositions?.[side]||[];
    return (Array.isArray(raw)?raw:[raw]).filter(Boolean).map(p=>p.id).filter(Boolean);
  });
  const available=new Set([...ids(restored),
    ...(restored.closedPaperTrades||[]).map(t=>t.id).filter(Boolean)]);
  if(ids(source).some(id=>!available.has(id)))
    throw Error('Imported phone paper positions did not survive initialization');
  await page.locator('#autoPaperQuickToggle').waitFor({timeout:30000});
}
async function browser(){
  if(context)try{await context.close()}catch{}
  context=await chromium.launchPersistentContext(path.join(DIR,'profile'),{headless:true,viewport:{width:390,height:844},args:['--no-sandbox','--disable-dev-shm-usage']});
  page=context.pages()[0]||await context.newPage();
  // Playwright dismisses unhandled confirms. Only accept the phone app's
  // AUTO consent prompt following an authenticated explicit server /api/start.
  page.on('dialog',async dialog=>{
    try{
      if(dialog.type()==='confirm'&&state.armed&&
         dialog.message().includes('자동 모의매매를 활성화'))await dialog.accept();
      else await dialog.dismiss();
    }catch(e){console.warn('Background dialog failed',e)}
  });
  await page.goto(APP,{waitUntil:'domcontentloaded',timeout:45000});
  await page.locator('#autoPaperQuickToggle').waitFor({timeout:30000});
  if(state.initialized){
    const val=await getSnapshot();
    if(!val.paper){const old=await read(backup);if(old?.paper)await importSnapshot(old)}
  }
}
async function synchronize(){
  if(!page||page.isClosed())await browser();
  if(!state.initialized)return;
  const status=await page.evaluate(()=>({on:typeof autoPaperEnabled==='boolean'&&autoPaperEnabled,visible:document.visibilityState}));
  if(status.visible!=='visible')throw Error('Headless app hidden');
  if(status.on!==state.armed){
    await page.locator('#autoPaperQuickToggle').click({timeout:9000});
    const actual=await page.evaluate(()=>typeof autoPaperEnabled==='boolean'&&autoPaperEnabled);
    if(actual!==state.armed)throw Error('Server AUTO activation did not take effect');
  }
  const val=await getSnapshot(),hash=JSON.stringify(val);
  if(hash!==lastWritten){await save(backup,val);lastWritten=hash}
}
async function status(){
  const v={armed:state.armed,initialized:state.initialized,ready:!!page&&!page.isClosed(),lastError,heartbeatAt};
  if(v.ready&&v.initialized)try{
    v.paper=await page.evaluate(key=>{const p=JSON.parse(localStorage.getItem(key)||'{}');return {
      balance:Number(p.balance)||0,long:Array.isArray(p.hedgePositions?.LONG)?p.hedgePositions.LONG.length:0,
      short:Array.isArray(p.hedgePositions?.SHORT)?p.hedgePositions.SHORT.length:0,
      closed:Array.isArray(p.closedPaperTrades)?p.closedPaperTrades.length:0,
      autoEnabled:typeof autoPaperEnabled==='boolean'&&autoPaperEnabled,
      marketTickAgeMs:typeof lastTickAt==='number'&&lastTickAt>0?Date.now()-lastTickAt:null};},keys.paper);
  }catch(e){v.lastError=String(e.message||e).slice(0,200)}
  return v;
}
async function request(req,res){
  const origin=req.headers.origin||'';
  if(origin&&origin!==ORIGIN)return send(res,403,{error:'Origin denied'},origin);
  if(req.method==='OPTIONS'){res.writeHead(204,headers(origin));res.end();return}
  const url=new URL(req.url,'http://localhost').pathname;
  if(url==='/health')return send(res,200,{ok:!!page&&!page.isClosed()},origin);
  if(!auth(req))return send(res,401,{error:'Unauthorized'},origin);
  try{
    if(req.method==='GET'&&url==='/api/status')return send(res,200,await serial(status),origin);
    if(req.method==='GET'&&url==='/api/snapshot')return send(res,200,await serial(getSnapshot),origin);
    if(req.method==='POST'&&url==='/api/start'){
      const request=await body(req);
      const value=await serial(async()=>{
        if(!page||page.isClosed())await browser();
        if(!state.initialized){await importSnapshot(request.snapshot);state.initialized=true}
        else if(request.snapshot)throw Error('Server already initialized; do not overwrite its trade history');
        state.armed=true;await save(meta,state);await synchronize();return status();
      });
      return send(res,200,value,origin);
    }
    if(req.method==='POST'&&url==='/api/stop'){
      const value=await serial(async()=>{state.armed=false;await save(meta,state);await synchronize();return status()});
      return send(res,200,value,origin);
    }
    return send(res,404,{error:'Not found'},origin);
  }catch(e){return send(res,400,{error:String(e.message||e).slice(0,250)},origin)}
}
await mkdir(DIR,{recursive:true,mode:0o700});
state={...state,...await read(meta)};
try{await browser()}catch(e){lastError=String(e.message||e).slice(0,300)}
http.createServer((req,res)=>{void request(req,res)}).listen(Number(process.env.PORT)||3000,'0.0.0.0');
setInterval(()=>{void serial(async()=>{heartbeatAt=Date.now();try{await synchronize();lastError=null}catch(e){lastError=String(e.message||e).slice(0,300)}})},3000);
