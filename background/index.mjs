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
const marketModes=new Set(['classic','trend','auto','range','breakout','off']);
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
async function setPageMarketMode(mode){
  if(!marketModes.has(mode))throw Error('Invalid market mode');
  if(!page||page.isClosed())await browser();
  await page.locator('#autoMarketMode').waitFor({timeout:10000});
  const applied=await page.evaluate(value=>{
    const select=document.getElementById('autoMarketMode');
    if(!select||![...select.options].some(option=>option.value===value))throw Error('Server app market selector missing');
    if(select.value!==value){
      select.value=value;
      // Run the app's existing handler so its unfilled AUTO order is cancelled
      // when changing strategy, while keeping opened paper positions intact.
      select.dispatchEvent(new Event('change',{bubbles:true}));
    }
    if(typeof savePaperState==='function')savePaperState();
    return select.value;
  },mode);
  if(applied!==mode)throw Error('Server market mode confirmation failed');
}
async function synchronize(){
  if(!page||page.isClosed())await browser();
  if(!state.initialized)return;
  if(state.tradingConfig){
    const current=await getServerTradingConfig();
    if(JSON.stringify(current)!==JSON.stringify(state.tradingConfig))
      await setServerTradingConfig(state.tradingConfig);
  }else if(marketModes.has(state.marketMode)){
    const selected=await page.locator('#autoMarketMode').inputValue();
    if(selected!==state.marketMode)await setPageMarketMode(state.marketMode);
  }
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

const manualSettingsSpec={
  lev:[1,50],risk:[0.01,5],stop:[0.05,10],rr:[1,20],
  hold:[1,24],marginPct:[0.1,100]
};

const autoSettingsSpec={
  autoDailyHigh:[55,95],autoDailyLow:[5,45],
  autoMinuteHighFrom:[70,95],autoMinuteHighTo:[75,99],
  autoMinuteLowFrom:[1,25],autoMinuteLowTo:[5,30],
  autoMaxChasePct:[0.03,0.5],autoMaxPositions:[1,5],
  autoDailyLossPct:[0.5,10],autoCooldownMin:[1,240]
};
const serverTradeFields=['lev','risk','stop','rr','hold','sizeMode','marginPct'];
const serverGuardFields=Object.keys(autoSettingsSpec);
function checkedTradingConfig(data){
  if(!data||typeof data!=='object'||!marketModes.has(data.marketMode))throw Error('Invalid paper market strategy');
  if(!data.strategy||typeof data.strategy!=='object'||!['risk','margin'].includes(data.strategy.sizeMode))
    throw Error('Invalid paper size mode');
  if(!data.guards||typeof data.guards!=='object')throw Error('Invalid paper guard configuration');
  const strategy={},guards={};
  for(const id of serverTradeFields){
    if(id==='sizeMode'){strategy[id]=data.strategy[id];continue}
    const [min,max]=manualSettingsSpec[id],raw=data.strategy[id],value=Number(raw);
    if(raw===null||raw===undefined||raw===''||!Number.isFinite(value)||value<min||value>max)
      throw Error('Invalid paper strategy field: '+id);
    strategy[id]=value;
  }
  for(const id of serverGuardFields){
    const [min,max]=autoSettingsSpec[id],raw=data.guards[id],value=Number(raw);
    if(raw===null||raw===undefined||raw===''||!Number.isFinite(value)||value<min||value>max)
      throw Error('Invalid paper AUTO field: '+id);
    guards[id]=value;
  }
  return {marketMode:data.marketMode,strategy,guards};
}
async function getServerTradingConfig(){
  if(!page||page.isClosed())throw Error('Paper engine browser offline');
  return page.evaluate(({strategy,guards})=>{
    const value=id=>document.getElementById(id)?.value;
    return {marketMode:value('autoMarketMode'),
      strategy:Object.fromEntries(strategy.map(id=>[id,id==='sizeMode'?value(id):Number(value(id))])),
      guards:Object.fromEntries(guards.map(id=>[id,Number(value(id))]))};
  },{strategy:serverTradeFields,guards:serverGuardFields});
}
async function setServerTradingConfig(config){
  const normalized=checkedTradingConfig(config);
  if(!page||page.isClosed())await browser();
  await page.locator('#autoMarketMode').waitFor({timeout:10000});
  const applied=await page.evaluate(({config,strategyIds,guardIds})=>{
    const el=id=>document.getElementById(id);
    const mode=el('autoMarketMode');
    if(!mode||![...mode.options].some(option=>option.value===config.marketMode))
      throw Error('Paper market strategy selector unavailable');
    for(const id of [...strategyIds,...guardIds])if(!el(id))
      throw Error('Paper engine missing setting '+id);
    // Only affect future paper entries; do not touch balance, positions,
    // orders, trading history or Binance private API credentials.
    for(const id of strategyIds)el(id).value=String(config.strategy[id]);
    for(const id of guardIds)el(id).value=String(config.guards[id]);
    if(mode.value!==config.marketMode){
      mode.value=config.marketMode;
      mode.dispatchEvent(new Event('change',{bubbles:true}));
    }
    syncSizeMode();
    saveAutoSettings();savePaperState();
    return {marketMode:mode.value,
      strategy:Object.fromEntries(strategyIds.map(id=>[id,id==='sizeMode'?el(id).value:Number(el(id).value)])),
      guards:Object.fromEntries(guardIds.map(id=>[id,Number(el(id).value)]))};
  },{config:normalized,strategyIds:serverTradeFields,guardIds:serverGuardFields});
  if(JSON.stringify(applied)!==JSON.stringify(normalized))
    throw Error('Paper strategy verification mismatch');
  return applied;
}

function checkedManualOrder(input){
  if(!input||typeof input!=='object')throw Error('Manual order data required');
  const {requestId,side,type}=input;
  if(typeof requestId!=='string'||!/^[a-zA-Z0-9_-]{12,96}$/.test(requestId))
    throw Error('Invalid manual request identifier');
  if(!['LONG','SHORT'].includes(side)||!['market','limit'].includes(type))
    throw Error('Invalid paper order side or type');
  const price=type==='limit'?Number(input.price):null;
  if(type==='limit'&&(!Number.isFinite(price)||price<1||price>10000000))
    throw Error('Invalid paper limit price');
  if(!input.settings||typeof input.settings!=='object'||
     !['risk','margin'].includes(input.settings.sizeMode))
    throw Error('Invalid manual position sizing mode');
  const settings={sizeMode:input.settings.sizeMode};
  for(const [name,[min,max]] of Object.entries(manualSettingsSpec)){
    const value=Number(input.settings[name]);
    if(input.settings[name]===null||input.settings[name]===undefined||
       input.settings[name]===''||!Number.isFinite(value)||value<min||value>max)
      throw Error('Invalid paper manual setting: '+name+' (allowed '+min+'~'+max+')');
    settings[name]=value;
  }
  return {requestId,side,type,price,settings};
}
async function persistPaperBackup(){
  const val=await getSnapshot();
  await save(backup,val);
  lastWritten=JSON.stringify(val);
}
async function handleManualOrder(input){
  const order=checkedManualOrder(input);
  if(!state.initialized)throw Error('Start and initialize Railway paper account first');
  if(!page||page.isClosed())await browser();
  if(!Array.isArray(state.manualReceipts))state.manualReceipts=[];
  const existing=state.manualReceipts.find(item=>item.requestId===order.requestId);
  if(existing)return existing;
  // Check the browser portfolio too: it can survive a crash between a trade
  // being saved in the browser and the receipt reaching the persistent volume.
  const prior=await page.evaluate(id=>{
    const active=allPaperPositions().find(p=>p.manualRequestId===id);
    if(active)return {requestId:id,side:active.side,type:active.entryType,
      positionId:active.id,entry:active.entry,stop:active.stop,tp:active.tp,
      result:'filled'};
    const completed=closedPaperTrades.find(t=>t.manualRequestId===id);
    if(completed)return {requestId:id,side:completed.side,type:'market',
      positionId:completed.id,entry:completed.entry,stop:null,tp:null,result:'closed'};
    if(pending?.manualRequestId===id)
      return {requestId:id,side:pending.side,type:'limit',price:pending.price,result:'pending'};
    return null;
  },order.requestId);
  if(prior){state.manualReceipts.push(prior);state.manualReceipts=state.manualReceipts.slice(-100);await save(meta,state);return prior}
  const receipt=await page.evaluate(order=>{
    if(demo||!(last>0)||!Number.isFinite(last)||Date.now()-lastTickAt>10000)
      throw Error('Server BTC market price is stale: manual paper order not submitted');
    if(paperMode()!=='hedge')throw Error('Server paper hedge mode is required for independent long/short');
    if(typeof openTrade!=='function'||typeof savePaperState!=='function')
      throw Error('Server paper trading engine unavailable');
    const ids=['lev','risk','stop','rr','hold','sizeMode','marginPct'];
    const old=Object.fromEntries(ids.map(id=>[id,document.getElementById(id).value]));
    try{
      for(const id of ids)document.getElementById(id).value=String(order.settings[id]);
      syncSizeMode();
      if(order.type==='market'){
        const before=new Set(allPaperPositions().map(p=>p.id));
        if(!(paperFreeMargin()>0.001))throw Error('No free server paper margin');
        pendingFillType='market';
        try{openTrade(order.side,last*(order.side==='LONG'?1+slip:1-slip),order.requestId)}
        finally{pendingFillType=null}
        const p=allPaperPositions().find(p=>p.side===order.side&&!before.has(p.id));
        if(!p)throw Error('Manual server entry was not executed');
        p.manualRequestId=order.requestId;
        savePaperState();
        return {requestId:order.requestId,side:order.side,type:'market',
          positionId:p.id,entry:p.entry,stop:p.stop,tp:p.tp,result:'filled'};
      }
      if(pending)throw Error('Existing server paper limit order: cancel it first');
      pending={side:order.side,price:order.price,manualRequestId:order.requestId,manualSettings:{...order.settings}};
      add('서버 수동 가상 '+order.side+' 지정가 대기 '+fmt(order.price)+' USDT');
      savePaperState();render();
      return {requestId:order.requestId,side:order.side,type:'limit',price:order.price,result:'pending'};
    }finally{
      for(const [id,value] of Object.entries(old))document.getElementById(id).value=value;
      syncSizeMode();savePaperState();
    }
  },order);
  state.manualReceipts.push(receipt);
  state.manualReceipts=state.manualReceipts.slice(-100);
  await save(meta,state);
  await persistPaperBackup();
  return receipt;
}
async function closeServerPaperPosition(id){
  if(!state.initialized)throw Error('Server paper account not initialized');
  if(typeof id!=='string'||!/^paper-[a-z0-9-]+$/.test(id))throw Error('Invalid paper position ID');
  const result=await page.evaluate(id=>{
    if(demo||!(last>0)||Date.now()-lastTickAt>10000)
      throw Error('Server market price stale: cannot close paper position');
    const p=allPaperPositions().find(p=>p.id===id);
    if(!p)throw Error('Paper position is no longer open');
    const side=p.side;
    closePositionById(id,'서버 수동 청산');
    if(allPaperPositions().some(p=>p.id===id))throw Error('Paper position not closed');
    return {positionId:id,side,result:'closed'};
  },id);
  await persistPaperBackup();
  return result;
}
async function cancelServerPaperLimit(){
  if(!state.initialized)throw Error('Server paper account not initialized');
  const result=await page.evaluate(()=>{
    if(!pending)return {result:'none'};
    const old={side:pending.side,price:pending.price};
    pending=null;add('서버 수동 지정가 주문 취소');savePaperState();render();
    return {result:'cancelled',...old};
  });
  await persistPaperBackup();
  return result;
}
async function status(){
  const v={armed:state.armed,initialized:state.initialized,ready:!!page&&!page.isClosed(),lastError,heartbeatAt,recentManualIds:(state.manualReceipts||[]).slice(-40).map(r=>r.requestId)};
  if(v.ready&&v.initialized)try{
    v.paper=await page.evaluate(key=>{const p=JSON.parse(localStorage.getItem(key)||'{}');return {
      balance:Number(p.balance)||0,long:Array.isArray(p.hedgePositions?.LONG)?p.hedgePositions.LONG.length:0,
      short:Array.isArray(p.hedgePositions?.SHORT)?p.hedgePositions.SHORT.length:0,
      closed:Array.isArray(p.closedPaperTrades)?p.closedPaperTrades.length:0,
      autoEnabled:typeof autoPaperEnabled==='boolean'&&autoPaperEnabled,
      marketMode:document.getElementById('autoMarketMode')?.value||null,
      tradingConfig:{
        marketMode:document.getElementById('autoMarketMode')?.value||null,
        strategy:Object.fromEntries(['lev','risk','stop','rr','hold','sizeMode','marginPct'].map(id=>
          [id,id==='sizeMode'?document.getElementById(id)?.value:Number(document.getElementById(id)?.value)])),
        guards:Object.fromEntries(['autoDailyHigh','autoDailyLow','autoMinuteHighFrom','autoMinuteHighTo',
          'autoMinuteLowFrom','autoMinuteLowTo','autoMaxChasePct','autoMaxPositions',
          'autoDailyLossPct','autoCooldownMin'].map(id=>[id,Number(document.getElementById(id)?.value)]))
      },
      marketTickAgeMs:typeof lastTickAt==='number'&&lastTickAt>0?Date.now()-lastTickAt:null,
      marketPrice:typeof last==='number'&&last>0?last:null,
      positions:allPaperPositions().slice(0,40).map(p=>({
        id:p.id,side:p.side,entry:p.entry,stop:p.stop,tp:p.tp,opened:p.opened,
        leverage:p.leverage,margin:p.notional/(p.leverage||1),
        manual:!!p.manualRequestId,unrealized:last>0?Number(netAt(p,last).toFixed(2)):null
      })),
      manualPending:pending?{side:pending.side,price:pending.price}:null
    };},keys.paper);
    // Node process metadata is not available inside page.evaluate's browser realm.
    v.paper.configRevision=Number(state.configRevision)||0;
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
    if(req.method==='POST'&&url==='/api/market-mode'){
      const request=await body(req);
      if(!marketModes.has(request?.mode))throw Error('Invalid market mode');
      const value=await serial(async()=>{
        if(!state.initialized)throw Error('Server paper account not initialized');
        if(state.tradingConfig){
          const next={...state.tradingConfig,marketMode:request.mode};
          await setServerTradingConfig(next);
          state.tradingConfig=next;
        }else await setPageMarketMode(request.mode);
        state.marketMode=request.mode;
        state.configRevision=(Number(state.configRevision)||0)+1;
        await save(meta,state);
        return status();
      });
      return send(res,200,value,origin);
    }
    if(req.method==='POST'&&url==='/api/trading-config'){
      const config=checkedTradingConfig(await body(req));
      const value=await serial(async()=>{
        if(!state.initialized)throw Error('Server paper account not initialized');
        const actual=await getServerTradingConfig();
        const changed=JSON.stringify(actual)!==JSON.stringify(config);
        if(changed)await setServerTradingConfig(config);
        state.tradingConfig=config;
        state.marketMode=config.marketMode;
        if(changed)state.configRevision=(Number(state.configRevision)||0)+1;
        await save(meta,state);
        return status();
      });
      return send(res,200,value,origin);
    }
    if(req.method==='POST'&&url==='/api/manual-order'){
      const input=await body(req);
      // Guaranteed not sent to the paper engine if rejected here.
      // Distinct 422 lets the phone discard this invalid draft safely,
      // instead of endlessly retrying the same impossible order ID.
      try{checkedManualOrder(input)}
      catch(e){return send(res,422,{error:String(e.message||e)},origin)}
      const receipt=await serial(()=>handleManualOrder(input));
      // Order is already acknowledged and persisted; do not wait for a
      // second headless-browser status query before responding to the tap.
      return send(res,200,{receipt},origin);
    }
    if(req.method==='POST'&&url==='/api/manual-close'){
      const input=await body(req);
      const value=await serial(async()=>{
        const receipt=await closeServerPaperPosition(input?.positionId);
        return {receipt,...await status()};
      });
      return send(res,200,value,origin);
    }
    if(req.method==='POST'&&url==='/api/manual-cancel'){
      const value=await serial(async()=>{
        const receipt=await cancelServerPaperLimit();
        return {receipt,...await status()};
      });
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
