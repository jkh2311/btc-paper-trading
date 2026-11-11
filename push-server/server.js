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
 if(req.method==='GET'&&url.pathname==='/health'){
  respond(res,200,{ok:true,monitor:'remote-push',subscriberCount:subscribers.length,lastCheckTime,lastCheckError,storage:'ephemeral'});
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
   const record={subscription:sub,...prefs,lastBar:0,lastBar10:0};
   if(existing>=0){
    record.lastBar=subscribers[existing].lastBar;
    record.lastBar10=subscribers[existing].lastBar10||0;
    subscribers[existing]=record;
   }else{
    if(subscribers.length>=5){respond(res,409,{error:'device limit'});return}
    subscribers.push(record);
   }
   save();respond(res,200,{ok:true,recoveryProof:recoveryProof(sub.endpoint)});
  }catch(e){respond(res,400,{error:'invalid request'})}
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
  return {text:'보유 '+side+' · 수익률 '+signed(pct)+'%\\n미실현 손익 '+signed(totalPnl)+' USDT',ok:true};
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
 if(polling||!subscribers.length)return;
 polling=true;
 try{
  const res=await fetch('https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=1m&limit=500',
    {signal:AbortSignal.timeout(7500),headers:{'cache-control':'no-cache'}});
  if(!res.ok)throw new Error('Binance '+res.status);
  const raw=await res.json();
  if(!Array.isArray(raw)||raw.length<25)throw new Error('Insufficient candles');
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
 }catch(e){lastCheckError=String(e.message||e).slice(0,180);console.warn('RMI poll:',lastCheckError)}
 finally{polling=false}
}
// Poll at 2.5s while process is online. New completed candle is detected
// on the first fresh REST response; this is NOT a guaranteed 0-second alert.
setInterval(()=>{void poll()},2500);
void poll();
