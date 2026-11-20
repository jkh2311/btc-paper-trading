'use strict';
// Standalone always-on, READ-ONLY BTCUSDT RMI alert sender.
// No Binance credentials or trading/order endpoints are used here.
// Run on an always-on Node.js host with npm install and VAPID keys.
// This must be deployed separately: GitHub Pages cannot run this server.
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const webpush=require('web-push');
const WebSocket=require('ws');
const liveGuard=require('./live-auto-guard');
const liveExec=require('./live-auto-executor');

const PORT=Number(process.env.PORT||8787);
const ORIGIN=process.env.APP_ORIGIN||'https://jkh2311.github.io';
const REGISTER_TOKEN=process.env.PUSH_REGISTER_TOKEN;
const PUBLIC=process.env.VAPID_PUBLIC_KEY;
const PRIVATE=process.env.VAPID_PRIVATE_KEY;
const SUBJECT=process.env.VAPID_SUBJECT||'mailto:admin@example.com';
const SAVE_FILE=process.env.SUBSCRIPTIONS_FILE||path.join(__dirname,'subscribers.json');
if(!REGISTER_TOKEN||!PUBLIC||!PRIVATE||SUBJECT==='mailto:admin@example.com'){
 console.error('Set PUSH_REGISTER_TOKEN, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT.');
 process.exit(1);
}
webpush.setVapidDetails(SUBJECT,PUBLIC,PRIVATE);

let subscribers=[];
let lastPrice=null,lastPriceAt=0,lastPriceError=null,priceBusy=false;
// Same BTCUSDT USD-M futures contract, via Binance's official public market
// WebSocket. Never silently substitute spot or a different exchange.
let wsFeed=null,wsRetryTimer=null,wsClosedBars=[],wsLastMessageAt=0;
let wsError=null,wsStatus='connecting',wsReconnectDelay=5000;
let restBlockedUntil=0,restLastError=null,signalFeedSource='none';
const WS_FUTURES_KLINE_URL='wss://fstream.binance.com/market/ws/btcusdt@kline_1m';
function connectFuturesKlineStream(){
 if(wsFeed)return;
 wsStatus='connecting';
 const socket=new WebSocket(WS_FUTURES_KLINE_URL,{handshakeTimeout:10000});
 wsFeed=socket;
 socket.on('open',()=>{
  wsStatus='connected';wsError=null;wsReconnectDelay=5000;
  console.log('FUTURES WS connected');
 });
 socket.on('message',buffer=>{
  let msg;
  try{msg=JSON.parse(buffer.toString())}catch(_){return}
  const k=msg?.k||msg?.data?.k;
  if(k?.i!=='1m'||k?.s!=='BTCUSDT')return;
  wsLastMessageAt=Date.now();
  if(k.x!==true)return; // Never treat unfinished bars as trade signals.
  const t=Number(k.t),c=Number(k.c),v=Number(k.v);
  if(!Number.isSafeInteger(t)||t%60000!==0||!(c>0&&v>0))return;
  const row=[t,k.o,k.h,k.l,k.c,k.v];
  const last=wsClosedBars.at(-1);
  if(last&&t===Number(last[0])){wsClosedBars[wsClosedBars.length-1]=row;return}
  if(last&&t<Number(last[0]))return;
  if(last&&t!==Number(last[0])+60000){
   // Restart warm-up after any missing candle. No synthetic gaps.
   console.warn('FUTURES WS candle gap, resetting RMI warm-up');
   wsClosedBars=[];
  }
  wsClosedBars.push(row);
  if(wsClosedBars.length>500)wsClosedBars.shift();
 });
 socket.on('unexpected-response',(_request,response)=>{
  wsError='WebSocket HTTP '+response.statusCode;
  console.warn('FUTURES WS upstream:',wsError);
 });
 socket.on('error',error=>{
  wsError=wsError||String(error.message||error).slice(0,120);
  console.warn('FUTURES WS:',wsError);
 });
 socket.on('close',(code,reason)=>{
  if(wsFeed===socket)wsFeed=null;
  wsStatus='disconnected';
  wsError=wsError||('closed '+code+' '+String(reason||'').slice(0,60));
  wsLastMessageAt=0;
  if(!wsRetryTimer){
   const delay=wsReconnectDelay;
   wsReconnectDelay=Math.min(120000,wsReconnectDelay*2);
   wsRetryTimer=setTimeout(()=>{wsRetryTimer=null;connectFuturesKlineStream()},delay);
  }
 });
}
setInterval(()=>{
 if(wsFeed&&wsStatus==='connected'&&
    wsLastMessageAt>0&&Date.now()-wsLastMessageAt>95000){
  wsError='WebSocket market stream stale (>95s)';
  wsFeed.terminate();
 }
},30000);
function websocketKlines(){
 // Closed minute bars must be consecutive, fresh, and fully warmed up.
 const last=wsClosedBars.at(-1);
 if(wsStatus!=='connected'||!last||wsClosedBars.length<25||
    Date.now()-wsLastMessageAt>90000||
    Date.now()-Number(last[0])-60000>45000)return null;
 return wsClosedBars.slice();
}
async function loadSignalKlines(){
 if(Date.now()>=restBlockedUntil){
  try{
   const response=await fetch('https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=1m&limit=500',
    {signal:AbortSignal.timeout(7500),headers:{'cache-control':'no-cache'}});
   if(!response.ok){
    if(response.status===451)restBlockedUntil=Date.now()+300000;
    throw Error('Binance REST '+response.status);
   }
   const raw=await response.json();
   if(!Array.isArray(raw)||raw.length<25)throw Error('insufficient futures REST bars');
   restLastError=null;signalFeedSource='binance-usdm-rest';return raw;
  }catch(e){restLastError=String(e.message||e).slice(0,140)}
 }
 const fallback=websocketKlines();
 if(fallback){
  signalFeedSource='binance-usdm-websocket';
  return fallback;
 }
 signalFeedSource='none';
 throw Error((restLastError||'REST not available')+'; futures WS '+
  wsStatus+' ('+wsClosedBars.length+'/25 warmup bars)'+
  (wsError?' · '+wsError:''));
}
connectFuturesKlineStream();
let liveSignalBar=0,liveBusy=false,liveLastError=null,liveLastResult=null;
try{const raw=JSON.parse(fs.readFileSync(SAVE_FILE,'utf8'));if(Array.isArray(raw))subscribers=raw}catch(_){}
function save(){
 const tmp=SAVE_FILE+'.tmp';
 fs.writeFileSync(tmp,JSON.stringify(subscribers,null,2),{mode:0o600});
 fs.renameSync(tmp,SAVE_FILE);
}
function respond(res,code,obj){
 res.writeHead(code,{'Content-Type':'application/json; charset=utf-8',
 'Cache-Control':'no-store','Access-Control-Allow-Origin':ORIGIN,
 'Vary':'Origin','Access-Control-Allow-Headers':'content-type',
 'Access-Control-Allow-Methods':'GET, POST, OPTIONS'});
 res.end(JSON.stringify(obj));
}
function recoveryProof(endpoint){
 return crypto.createHmac('sha256',REGISTER_TOKEN).update('btc-push-device-recovery-v1:'+endpoint).digest('hex');
}
function authorized(req,body){
 if(req.headers.origin!==ORIGIN||!body||typeof body!=='object')return false;
 if(typeof body.token==='string'&&body.token===REGISTER_TOKEN)return true;
 const endpoint=body.subscription?.endpoint||body.endpoint;
 if(typeof endpoint!=='string'||!endpoint.startsWith('https://'))return false;
 const actual=body.recoveryProof,expected=recoveryProof(endpoint);
 return typeof actual==='string'&&/^[0-9a-f]{64}$/.test(actual)&&
  crypto.timingSafeEqual(Buffer.from(actual,'hex'),Buffer.from(expected,'hex'));
}
function readBody(req){
 return new Promise((resolve,reject)=>{
  let body='';
  req.on('data',chunk=>{body+=chunk;if(body.length>18000){reject(new Error('too large'));req.destroy()}});
  req.on('end',()=>{try{resolve(JSON.parse(body))}catch(e){reject(e)}});
  req.on('error',reject);
 });
}
function clamp(v,def,low,high){const n=Number(v);return Number.isFinite(n)?Math.max(low,Math.min(high,n)):def}
function preferences(obj){
 return {strategy:['range','bear','bull'].includes(obj?.strategy)?obj.strategy:'range',
 shortThreshold:clamp(obj?.shortThreshold,85,70,99),
 longThreshold:clamp(obj?.longThreshold,20,5,30)};
}
http.createServer(async(req,res)=>{
 if(req.method==='OPTIONS'){respond(res,204,{});return}
 if(req.headers.origin&&req.headers.origin!==ORIGIN){respond(res,403,{error:'origin'});return}
 const url=new URL(req.url,'http://localhost');
 if(req.method==='GET'&&url.pathname==='/config'){respond(res,200,{publicKey:PUBLIC});return}
 if(req.method==='GET'&&url.pathname==='/live/status'){
  respond(res,200,{ok:true,...liveGuard.readiness({health:{lastCheckTime,lastCheckError}}),liveExecution:liveExec.settings(),liveLastError,liveLastResult});
  return;
 }
 if(req.method==='GET'&&url.pathname==='/live/preflight'){
  // Read-only status. Trading is armed only by separate Render secrets,
  // persistent database and explicit server-side consent; never by a link.
  const feedOk=signalFeedSource==='binance-usdm-rest'&&!lastCheckError&&lastCheckTime>0&&Date.now()-lastCheckTime<90000;
  const cfg=liveExec.settings();
  const blockers=[...cfg.errors,...(!feedOk?['바이낸스 선물 시세 연결 미확인 또는 차단']:[])];
  respond(res,200,{ok:true,mode:blockers.length?'LIVE_LOCKED':'LIVE_READY',
   source:'Binance BTCUSDT USDT-M Futures',liveOrderEndpointExists:true,
   liveTradingEnabled:blockers.length===0,feedHealthy:feedOk,
   lastFeedError:lastCheckError,keysConfigured:cfg.credentialsPresent,
   modeChoice:cfg.mode,strategy:cfg.strategy,orderNotionalUsdt:cfg.riskValid?cfg.notional:null,
   riskConfigured:cfg.riskValid,serverOrderStatus:liveLastResult,
   serverOrderError:liveLastError,blockers});return;
 }
 if(req.method==='GET'&&url.pathname==='/health'){
  respond(res,200,{ok:true,monitor:'remote-push',subscriberCount:subscribers.length,lastCheckTime,lastCheckError,storage:'ephemeral',lastPriceAt,lastPriceError,priceAlertSupported:true,
 serverVersion:'v301',signalFeed:'binance-usdm-BTCUSDT',signalFeedSource,
 marketDataWorking:!lastCheckError&&lastCheckTime>0&&Date.now()-lastCheckTime<90000,
 restLastError,websocketStatus:wsStatus,websocketLastError:wsError,
 websocketLastMessageAt:wsLastMessageAt,websocketClosedBars:wsClosedBars.length,
 websocketReady1m:!!websocketKlines(),websocketReady10m:tenMinuteBars(wsClosedBars.map(x=>
  ({t:Number(x[0]),c:Number(x[4]),v:Number(x[5])}))).length>=20});
  return;
 }
 if(req.method==='POST'&&url.pathname==='/subscribe'){
  try{
   const body=await readBody(req);
   if(!authorized(req,body)){respond(res,403,{error:'registration code or device recovery'});return}
   const sub=body.subscription;
   if(!sub||typeof sub.endpoint!=='string'||!sub.endpoint.startsWith('https://')||
      typeof sub.keys?.p256dh!=='string'||typeof sub.keys?.auth!=='string'){
    respond(res,400,{error:'invalid push subscription'});return;
   }
   // Limit registrations to one private owner, at most five devices.
   const prefs=preferences(body);
   const existing=subscribers.findIndex(x=>x.subscription.endpoint===sub.endpoint);
   const record={subscription:sub,...prefs,lastBar:0,lastBar10:0,priceAlerts:[]};
   if(existing>=0){
    record.lastBar=subscribers[existing].lastBar;
    record.lastBar10=subscribers[existing].lastBar10||0;
    record.priceAlerts=Array.isArray(subscribers[existing].priceAlerts)?subscribers[existing].priceAlerts:[];
    subscribers[existing]=record;
   }else{
    if(subscribers.length>=5){respond(res,409,{error:'device limit'});return}
    subscribers.push(record);
   }
   save();respond(res,200,{ok:true,recoveryProof:recoveryProof(sub.endpoint)});
  }catch(e){respond(res,400,{error:'invalid request'})}
  return;
 }
 // Device-scoped alert rules. Never accept unauthenticated modifications.
 if(req.method==='POST'&&url.pathname==='/price-alerts'){
  try{
   const body=await readBody(req);
   if(!authorized(req,body)){respond(res,403,{error:'registration authentication required'});return}
   const record=subscribers.find(x=>x.subscription.endpoint===body.endpoint);
   if(!record){respond(res,404,{error:'device not registered'});return}
   const input=body.alerts;
   if(!Array.isArray(input)||input.length>10){respond(res,400,{error:'maximum 10 alerts'});return}
   const unique=new Set(),previous=new Map((record.priceAlerts||[]).map(x=>[x.id,x]));
   const rows=[];
   for(const item of input){
    const id=String(item?.id||''),target=Number(item?.price);
    if(!/^[a-zA-Z0-9_-]{8,64}$/.test(id)||unique.has(id)||
       !Number.isFinite(target)||target<1000||target>10000000){
     respond(res,400,{error:'invalid price alert'});return;
    }
    unique.add(id);
    const old=previous.get(id);
    rows.push(old&&old.price===target?old:{id,price:target,status:'armed',created:Date.now()});
   }
   record.priceAlerts=rows;save();
   respond(res,200,{ok:true,alerts:rows.map(x=>({id:x.id,price:x.price,status:x.status}))});
  }catch(e){respond(res,400,{error:'invalid alert request'})}
  return;
 }
 if(req.method==='POST'&&url.pathname==='/test'){
  try{
   const body=await readBody(req);
   if(!authorized(req,body)){respond(res,403,{error:'registration code or device recovery'});return}
   const record=subscribers.find(x=>x.subscription.endpoint===body.endpoint);
   if(!record){respond(res,404,{error:'device not registered'});return}
   await webpush.sendNotification(record.subscription,JSON.stringify({
    title:'🔔 BTCUSDT 원격 푸시 테스트',body:'아이폰 화면을 꺼도 서버에서 보낸 테스트 알림입니다.',
    tag:'btc-test-remote'
   }),{TTL:60,urgency:'high'});
   respond(res,200,{ok:true});
  }catch(e){respond(res,502,{error:'push rejected'})}
  return;
 }
 respond(res,404,{error:'not found'});
}).listen(PORT,'0.0.0.0',()=>console.log('RMI remote push monitor listening on '+PORT));

function rmiSeries(bars,length=14,momentum=5){
 const out=Array(bars.length).fill(null);
 if(bars.length<momentum+length)return out;
 let gain=0,loss=0;
 for(let i=momentum;i<momentum+length;i++){
  const d=bars[i].c-bars[i-momentum].c;
  gain+=Math.max(0,d);loss+=Math.max(0,-d);
 }
 gain/=length;loss/=length;
 const score=()=>gain+loss===0?50:100*gain/(gain+loss);
 out[momentum+length-1]=score();
 for(let i=momentum+length;i<bars.length;i++){
  const d=bars[i].c-bars[i-momentum].c;
  gain=(gain*(length-1)+Math.max(0,d))/length;
  loss=(loss*(length-1)+Math.max(0,-d))/length;
  out[i]=score();
 }
 return out;
}
// Mirrors the RMI chart's range/bear/bull signal state machine.
// Only fully closed candles are sent. Never forward READY as a trade signal.
function signals(bars,prefs,minutes=1){
 const scores=rmiSeries(bars),events=Array(bars.length).fill(null);
 const strategy=prefs.strategy,shortThreshold=strategy==='bull'?90:prefs.shortThreshold;
 let firstLow=false,ready=false,readyAt=-1;
 let highBars=0,repeat=false,highReady=0,fired35=false;
 for(let i=1;i<scores.length;i++){
  const prev=scores[i-1],now=scores[i],close=bars[i].t+minutes*60000;
  if(!Number.isFinite(prev)||!Number.isFinite(now)){
   if(strategy==='bull'){highBars=0;repeat=false}
   continue;
  }
  if(strategy==='range'){
   if(prev>prefs.longThreshold&&now<=prefs.longThreshold)events[i]='LONG';
  }else if(strategy==='bear'){
   if(ready&&close-readyAt>=40*60000){ready=false;firstLow=false;readyAt=-1}
   if(!firstLow&&prev>17&&now<=17)firstLow=true;
   else if(firstLow&&!ready&&now>=25){ready=true;readyAt=close;events[i]='READY'}
   else if(ready&&prev>17&&now<=17){events[i]='LONG';ready=false;firstLow=true;readyAt=-1}
  }else if(strategy==='bull'){
   if(now>=90)highReady=90;
   else if(now>=85&&highReady!==90)highReady=85;
   if(now>35)fired35=false;
   const basic=prev>20&&now<=20&&!fired35;
   const from90=highReady===90&&prev>20&&now<=20;
   const from85=highReady===85&&prev>35&&now<=35;
   if(from90||from85||basic){events[i]='LONG';if(from85)fired35=true;if(highReady)highReady=0}
  }
  if(prev<shortThreshold&&now>=shortThreshold)events[i]='SHORT';
  if(strategy==='bull'){
   if(now<90){highBars=0;repeat=false}
   else if(prev<90&&now>=90){highBars=1;repeat=false}
   else if(prev>=90&&bars[i].t-bars[i-1].t===minutes*60000&&highBars>0)highBars++;
   else{highBars=0;repeat=false}
   if(highBars>=5&&!repeat){events[i]='SHORT';repeat=true}
  }
 }
 return events;
}
// Aggregate exact, aligned 10-minute candles from closed 1-minute futures bars.
// Do not treat a partial 10-minute bucket as confirmed.
function tenMinuteBars(minuteBars){
 const buckets=new Map();
 for(const b of minuteBars){
  const t=Math.floor(b.t/600000)*600000;
  let x=buckets.get(t);
  if(!x){x={t,c:b.c,v:0,count:0,lastT:0};buckets.set(t,x)}
  if(b.t!==t+x.count*60000){x.invalid=true}
  x.c=b.c;x.v+=b.v;x.count++;x.lastT=b.t;
 }
 return [...buckets.values()].filter(x=>!x.invalid&&x.count===10&&x.lastT===x.t+540000)
  .map(({t,c,v})=>({t,c,v}));
}
// Optional read-only account snapshot, only when separate READ-ONLY credentials
// are explicitly configured in Render environment. Never use live-trading credentials.
const PNL_KEY=process.env.PNL_READONLY_API_KEY||'';
const PNL_SECRET=process.env.PNL_READONLY_API_SECRET||'';
let pnlLastError=null;
async function readCurrentPnl(){
 if(!PNL_KEY||!PNL_SECRET)return {text:'수익률·미실현 손익: 계좌 조회 미연결',ok:false};
 try{
  const query=new URLSearchParams({symbol:'BTCUSDT',recvWindow:'5000',timestamp:String(Date.now())});
  const sig=crypto.createHmac('sha256',PNL_SECRET).update(query.toString()).digest('hex');
  query.set('signature',sig);
  const response=await fetch('https://fapi.binance.com/fapi/v3/positionRisk?'+query,{
   headers:{'X-MBX-APIKEY':PNL_KEY},signal:AbortSignal.timeout(5500),cache:'no-store'
  });
  if(!response.ok)throw Error('Binance HTTP '+response.status);
  const value=await response.json();
  const positions=(Array.isArray(value)?value:[value]).filter(p=>p&&p.symbol==='BTCUSDT'&&
   Number.isFinite(Number(p.positionAmt))&&Math.abs(Number(p.positionAmt))>0);
  if(!positions.length){pnlLastError=null;return {text:'현재 BTCUSDT 보유 포지션 없음',ok:true}}
  let totalPnl=0,totalMargin=0;const sides=new Set();
  for(const p of positions){
   const amount=Number(p.positionAmt),entry=Number(p.entryPrice),mark=Number(p.markPrice);
   const lev=Number(p.leverage),pnl=Number(p.unRealizedProfit??p.unrealizedProfit);
   if(!Number.isFinite(pnl)||!(entry>0&&mark>0&&lev>0))throw Error('Invalid position fields');
   totalPnl+=pnl;totalMargin+=Math.abs(amount)*entry/lev;
   sides.add(p.positionSide==='BOTH'?(amount>0?'LONG':'SHORT'):p.positionSide);
  }
  if(!(totalMargin>0))throw Error('Invalid position margin');
  const pct=100*totalPnl/totalMargin;
  const signed=n=>(n>=0?'+':'')+n.toLocaleString('ko-KR',{maximumFractionDigits:2});
  const side=sides.size===1?[...sides][0]:'LONG/SHORT';
  pnlLastError=null;
  return {text:'보유 '+side+' · 수익률 '+signed(pct)+'%\n미실현 손익 '+signed(totalPnl)+' USDT',ok:true};
 }catch(err){
  pnlLastError=String(err.message||err).slice(0,100);
  return {text:'수익률·미실현 손익: 현재 조회 불가',ok:false};
 }
}
function signalBody(timeframe,price,pnl){
 return timeframe+' RMI 확정 · '+price.toLocaleString('en-US')+' USDT'+
  '\n'+pnl.text;
}
let lastCheckTime=0,lastCheckError=null,polling=false;
async function poll(){
 // Strategy-based live monitoring does not require an iPhone push subscription.
 // Follow mode remains restricted to exactly one registered device.
 const liveCfg=liveExec.settings();
 if(polling||(!subscribers.length&&liveCfg.errors.length))return;
 polling=true;
 try{
  const raw=await loadSignalKlines();
  const now=Date.now()-1800;
  const bars=raw.map(x=>({t:Number(x[0]),c:Number(x[4]),v:Number(x[5])}))
    .filter(x=>Number.isFinite(x.t)&&x.c>0&&x.v>0&&x.t+60000<=now);
  if(bars.length<25)return;
  const current=bars.at(-1);
  // Reject stale Binance response: never alert on historical candles.
  if(now-current.t-60000>45000)return;
  const tens=tenMinuteBars(bars);
  const latest10=tens.at(-1);
  for(const subscriber of [...subscribers]){
   const events=[];
   if(current.t>subscriber.lastBar){
    const first=!subscriber.lastBar;
    subscriber.lastBar=current.t;
    if(!first){
     const side=signals(bars,subscriber,1).at(-1);
     if(side==='LONG'||side==='SHORT')events.push({side,minutes:1,bar:current});
    }
   }
   if(latest10&&latest10.t>Number(subscriber.lastBar10||0)){
    const first=!subscriber.lastBar10;
    subscriber.lastBar10=latest10.t;
    // Never notify a historical 10m signal on server startup.
    const tenClose=latest10.t+600000;
    if(!first&&now>=tenClose&&now-tenClose<45000){
     const side=signals(tens,subscriber,10).at(-1);
     if(side==='LONG'||side==='SHORT')events.push({side,minutes:10,bar:latest10});
    }
   }
   save();
   const pnl=events.length?await readCurrentPnl():null;
   for(const {side,minutes,bar} of events){
    const timeframe=minutes===10?'10분봉':'1분봉';
    try{
     await webpush.sendNotification(subscriber.subscription,JSON.stringify({
      title:(minutes===10?'🔟 10분봉 ':'1분봉 ')+(side==='LONG'?'🟢 LONG 신호':'🔴 SHORT 신호'),
      body:signalBody(timeframe,bar.c,pnl),
      tag:'btc-rmi-'+minutes+'m-'+subscriber.strategy+'-'+bar.t+'-'+side,
      side,minutes,barTime:bar.t
     }),{TTL:75,urgency:'high'});
     console.log('PUSH',minutes+'m',side,new Date(bar.t).toISOString());
    }catch(err){
     console.warn('Web Push error',err.statusCode||err.message);
     if(err.statusCode===404||err.statusCode===410){
      subscribers=subscribers.filter(x=>x!==subscriber);save();
      break;
     }
    }
   }
  }
  lastCheckTime=Date.now();lastCheckError=null;
  // Fire-and-forget only after a validated, fresh, fully closed Binance bar.
  // runLiveExecution itself holds the persistent duplicate-claim check.
  // A fallback notification feed must never silently enable real orders.
  // Server-side LIVE execution remains restricted to the original REST feed.
  if(signalFeedSource==='binance-usdm-rest')void pollLiveExecution(bars,current);
 }catch(e){lastCheckError=String(e.message||e).slice(0,180);console.warn('RMI poll:',lastCheckError)}
 finally{polling=false}
}
// Fully isolated server-side LIVE automation. A read-only push registration
// cannot arm this. All trading credentials/settings must be configured through
// Render secrets, with a separate persistent Postgres database.
async function pollLiveExecution(bars,current){
 const cfg=liveExec.settings();
 if(cfg.errors.length||liveBusy)return;
 if(!lastCheckTime||Date.now()-lastCheckTime>90000||lastCheckError)return;
 if(!current||!Number.isFinite(current.t))return;
 if(!liveSignalBar){liveSignalBar=current.t;return;} // no historical entry on boot
 if(current.t<=liveSignalBar)return;
 liveSignalBar=current.t;
 if(Date.now()-current.t-60000>30000)return;
 const owner=subscribers[0];
 if(cfg.mode==='follow'&&subscribers.length!==1){
  liveLastError='FOLLOW 모드는 단일 푸시 기기 등록이 필요';return;
 }
 const strategy=cfg.mode==='follow'?owner.strategy:cfg.strategy;
 // Dedicated strategy mode must match the application's base RMI thresholds,
 // even when no iPhone is subscribed. Never source trade settings from users.
 const signalPrefs=cfg.mode==='follow'?
  {strategy,shortThreshold:owner.shortThreshold,longThreshold:owner.longThreshold}:
  {strategy,shortThreshold:85,longThreshold:20};
 const side=signals(bars,signalPrefs,1).at(-1);
 if(side!=='LONG'&&side!=='SHORT')return;
 liveBusy=true;
 let store=null;
 try{
  store=await liveExec.openStore();
  liveLastResult=await liveExec.executeSignal({
   side,barTime:current.t,markPrice:current.c,mode:cfg.mode,
   strategy,exchange:liveExec.client(),store
  });
  liveLastError=null;
  console.info('LIVE AUTO RESULT',liveLastResult?.status,liveLastResult?.id);
 }catch(e){
  liveLastError=String(e.message||e).slice(0,170);
  console.error('LIVE AUTO HALTED - manual review required:',liveLastError);
  // Unknown order or protection state: never retry automatically.
  process.env.LIVE_AUTO_ENABLED='false';
 }finally{
  try{await store?.close()}catch(_){}
  liveBusy=false;
 }
}
// Independent price watcher. Alert only when an observed live price crosses
// a configured level; never fabricate a crossing after a gap or restart.
async function pollPriceAlerts(){
 if(priceBusy||!subscribers.some(s=>(s.priceAlerts||[]).some(a=>a.status==='armed')))return;
 priceBusy=true;
 try{
  const response=await fetch('https://fapi.binance.com/fapi/v1/ticker/price?symbol=BTCUSDT',
   {cache:'no-store',signal:AbortSignal.timeout(6500)});
  if(!response.ok)throw Error('Binance price HTTP '+response.status);
  const json=await response.json(),price=Number(json.price),now=Date.now();
  if(!Number.isFinite(price)||price<=0)throw Error('Invalid BTCUSDT quote');
  const old=lastPrice,oldTime=lastPriceAt;
  lastPrice=price;lastPriceAt=now;lastPriceError=null;
  if(!(old>0&&now-oldTime<20000))return;
  for(const subscriber of [...subscribers]){
   for(const alert of subscriber.priceAlerts||[]){
    if(alert.status!=='armed')continue;
    const crossed=(old<alert.price&&price>=alert.price)||
     (old>alert.price&&price<=alert.price);
    if(!crossed)continue;
    // Mark the crossing before sending so retries cannot spam duplicates.
    alert.status='triggered';alert.triggeredAt=now;save();
    try{
     await webpush.sendNotification(subscriber.subscription,JSON.stringify({
      title:'🎯 BTCUSDT 지정가격 도달',
      body:'설정 '+alert.price.toLocaleString('en-US')+' USDT · 현재 '+price.toLocaleString('en-US')+' USDT',
      tag:'btc-price-'+alert.id
     }),{TTL:3600,urgency:'high'});
     console.log('PRICE ALERT',alert.id,alert.price,price);
    }catch(e){
     console.warn('Price Web Push error',e.statusCode||e.message);
     if(e.statusCode===404||e.statusCode===410){
      subscribers=subscribers.filter(x=>x!==subscriber);save();break;
     }
     // Network/temporary errors remain visible as unconfirmed delivery;
     // no automatic duplicate resend after an uncertain push response.
    }
   }
  }
 }catch(e){lastPriceError=String(e.message||e).slice(0,140)}
 finally{priceBusy=false}
}
setInterval(()=>{void pollPriceAlerts()},2500);
void pollPriceAlerts();

// Poll at 2.5s while process is online. New completed candle is detected
// on the first fresh REST response; this is NOT a guaranteed 0-second alert.
setInterval(()=>{void poll()},2500);
void poll();
