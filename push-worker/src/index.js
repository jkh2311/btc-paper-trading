import { buildPushPayload } from '@block65/webcrypto-web-push';

const ALLOWED_ORIGIN='https://jkh2311.github.io';
const APP_URL='https://jkh2311.github.io/btc-paper-trading/';
const AUTO_PAPER_STRATEGY='rmi-daily-bias-1m-cycle-v3';
const AUTO_RMI_NEAR_POINTS=2;
const candleDuration={'1m':60000,'5m':300000,'15m':900000,'1d':86400000};
let candles={},autoSignalHistory=[],activeConfig={};
const $=id=>({value:id==='autoMarketMode'?(activeConfig.mode||'classic'):String(activeConfig[id]??DEFAULTS[id]??0)});
const DEFAULTS={autoDailyHigh:70,autoDailyLow:30,autoMinuteHighFrom:85,autoMinuteLowTo:20};
function readAutoSetting(id){const n=Number($(id).value);return Number.isFinite(n)?n:DEFAULTS[id]}
function ema(a,p){let e=a[0],k=2/(p+1);for(let i=1;i<a.length;i++)e=a[i]*k+e*(1-k);return e}
function rmiSeries(a,length=14,momentum=5){
 const out=new Array(a.length).fill(null);if(a.length<momentum+length)return out;
 let avgGain=0,avgLoss=0;
 for(let i=momentum;i<momentum+length;i++){let delta=Number(a[i].c)-Number(a[i-momentum].c);avgGain+=Math.max(0,delta);avgLoss+=Math.max(0,-delta)}
 avgGain/=length;avgLoss/=length;
 const score=()=>avgGain+avgLoss===0?50:100*avgGain/(avgGain+avgLoss);
 out[momentum+length-1]=score();
 for(let i=momentum+length;i<a.length;i++){let delta=Number(a[i].c)-Number(a[i-momentum].c);avgGain=(avgGain*(length-1)+Math.max(0,delta))/length;avgLoss=(avgLoss*(length-1)+Math.max(0,-delta))/length;out[i]=score()}
 return out
}
function confirmedSignalBars(tf,asOf){
  const list=candles[tf],duration=candleDuration[tf];
  if(!Array.isArray(list)||!duration)return [];
  // Use exchange-confirmed REST klines. Synthetic WS-advanced bars have volume 0.
const AUTO_RMI_NEAR_POINTS=2;
function dailyRmiBars(asOf){
  return (candles['1d']||[]).filter(b=>b&&Number.isFinite(b.t)&&b.t<=asOf&&b.c>0&&b.v>0);
}
function rmiTrendRegime(bars,upper,lower,buffer=AUTO_RMI_NEAR_POINTS){
  if(!Array.isArray(bars)||bars.length<23)return null;
  const scores=rmiSeries(bars);let side=null,previousSide=null,enteredAt=null;
  for(let i=0;i<scores.length;i++){
    const v=scores[i];if(!Number.isFinite(v))continue;
    previousSide=side;
    if(v>=upper-buffer&&side!=='SHORT'){side='SHORT';enteredAt=bars[i].t}
    else if(v<=lower+buffer&&side!=='LONG'){side='LONG';enteredAt=bars[i].t}
  }
  const value=scores.at(-1),prior=scores.at(-2);
  if(!Number.isFinite(value)||!Number.isFinite(prior))return null;
  return {side,previousSide,changed:side!==previousSide&&side!==null,value,previous:prior,enteredAt};
}
function dailyRmiTrend(asOf){
  const a=dailyRmiBars(asOf);if(a.length<24||asOf-a.at(-1).t>86400000)return null;
  const d=rmiTrendRegime(a,readAutoSetting('autoDailyHigh'),readAutoSetting('autoDailyLow'));
  return d?{...d,developing:a.at(-1).t+86400000>asOf}:null;
}
function minuteRmiTrend(a){
  // Read one-minute RMI independently from the DAILY bias. The historical
  // extreme-zone latch alone leaves LONG active until RMI reaches ~83,
  // suppressing valid one-minute SHORT reversals below that level.
  // Accept symmetric 1m local tops/bottoms above/below RMI 50 as reversals.
  // Retain the original configured extreme thresholds as stronger overrides.
  if(!Array.isArray(a)||a.length<23)return null;
  const scores=rmiSeries(a);
  const upper=readAutoSetting('autoMinuteHighFrom')-AUTO_RMI_NEAR_POINTS;
  const lower=readAutoSetting('autoMinuteLowTo')+AUTO_RMI_NEAR_POINTS;
  const pivotStep=.8;
  let side=null,previousSide=null,enteredAt=null,turnKind=null;
  for(let i=0;i<scores.length;i++){
    const value=scores[i];
    if(!Number.isFinite(value))continue;
    previousSide=side;
    if(i>=2&&Number.isFinite(scores[i-1])&&Number.isFinite(scores[i-2])){
      const before=scores[i-2],peak=scores[i-1];
      if(peak>=50&&peak-before>=pivotStep&&peak-value>=pivotStep){
        side='SHORT';turnKind='1분 RMI 고점 반전';
      }else if(peak<=50&&before-peak>=pivotStep&&value-peak>=pivotStep){
        side='LONG';turnKind='1분 RMI 저점 반등';
      }
    }
    if(value>=upper){side='SHORT';turnKind='1분 RMI 상단 구간'}
    else if(value<=lower){side='LONG';turnKind='1분 RMI 하단 구간'}
    if(side!==previousSide&&side!==null)enteredAt=a[i].t;
  }
  const value=scores.at(-1),prior=scores.at(-2);
  if(!Number.isFinite(value)||!Number.isFinite(prior))return null;
  return {side,previousSide,changed:side!==previousSide&&side!==null,
    value,previous:prior,enteredAt,turnKind};
}
// Independent 1m RMI zone crossing. Works even when the RMI direction
// switched to SHORT around 83 before reaching the configured 85 threshold.
function minuteRmiZoneEntry(previous,current){
  if(!Number.isFinite(previous)||!Number.isFinite(current))return null;
  if(previous<readAutoSetting('autoMinuteHighFrom')&&
     current>=readAutoSetting('autoMinuteHighFrom'))return 'SHORT';
  if(previous>readAutoSetting('autoMinuteLowTo')&&
     current<=readAutoSetting('autoMinuteLowTo'))return 'LONG';
  return null;
}
// Chart-only crosses on confirmed exchange candles; never create retroactive orders.
function chartRmiZoneMarkers(bars,start,end,asOf=Date.now()-1800){
  if(!Array.isArray(bars)||bars.length<23)return [];
  const closed=bars.filter(b=>b&&Number.isFinite(b.t)&&b.t+60000<=asOf&&b.v>0&&b.c>0);
  if(closed.length<23)return [];
  const scores=rmiSeries(closed),markers=[];
  for(let i=1;i<closed.length;i++){
    if(closed[i].t<bars[start]?.t||closed[i].t>bars[end-1]?.t)continue;
    const side=minuteRmiZoneEntry(scores[i-1],scores[i]);
    if(side)markers.push({barTime:closed[i].t,side,chartOnly:true});
  }
  return markers;
}
function autoTimeframeTrend(tf,asOf){
  const arr=confirmedSignalBars(tf,asOf),duration=candleDuration[tf];
  if(arr.length<35||!duration)return 0;
  // A stale timeframe must never approve a fresh 1-minute entry.
  if(asOf-(arr.at(-1).t+duration)>duration)return 0;
  const closes=arr.slice(-65).map(b=>b.c);
  const fast=ema(closes,9),slow=ema(closes,21),gap=(fast-slow)/Math.max(1,slow);
  return gap>0.00005?1:gap<-.00005?-1:0;
}
function auto1mVolumeRatio(minutes){
  if(!Array.isArray(minutes)||minutes.length<21)return 0;
  const previous=minutes.slice(-21,-1).map(b=>Number(b.v)||0);
  const average=previous.reduce((sum,v)=>sum+v,0)/20;
  return average>0?(Number(minutes.at(-1).v)||0)/average:0;
}

// Market regime classifier (closed 5m/15m candles only). All thresholds are
// initial paper-trading heuristics, NOT a validated trading edge.
const MARKET_MODE_OPTIONS=['auto','range','trend','classic','breakout','off'];
function adxWilder(bars,period=14){
  if(!Array.isArray(bars)||bars.length<period*2+2)return null;
  const tr=[],plus=[],minus=[];
  for(let i=1;i<bars.length;i++){
    const b=bars[i],prev=bars[i-1],up=b.h-prev.h,down=prev.l-b.l;
    tr.push(Math.max(b.h-b.l,Math.abs(b.h-prev.c),Math.abs(b.l-prev.c)));
    plus.push(up>down&&up>0?up:0);
    minus.push(down>up&&down>0?down:0);
  }
  let smTr=0,smPlus=0,smMinus=0;
  for(let i=0;i<period;i++){smTr+=tr[i];smPlus+=plus[i];smMinus+=minus[i]}
  const dx=[];
  for(let i=period-1;i<tr.length;i++){
    if(i>=period){
      smTr=smTr-smTr/period+tr[i];
      smPlus=smPlus-smPlus/period+plus[i];
      smMinus=smMinus-smMinus/period+minus[i];
    }
    const plusDI=smTr>0?100*smPlus/smTr:0,minusDI=smTr>0?100*smMinus/smTr:0;
    dx.push(plusDI+minusDI>0?100*Math.abs(plusDI-minusDI)/(plusDI+minusDI):0);
  }
  if(dx.length<period)return null;
  let adx=dx.slice(0,period).reduce((a,b)=>a+b,0)/period,previous=adx;
  for(let i=period;i<dx.length;i++){previous=adx;adx=(adx*(period-1)+dx[i])/period}
  return {value:adx,previous};
}
function marketEmaState(bars){
  const closes=bars.slice(-95).map(x=>x.c);
  if(closes.length<65)return null;
  const fast=ema(closes,20),slow=ema(closes,50);
  const earlier=ema(closes.slice(0,-4),20);
  if(!(fast>0&&slow>0&&earlier>0))return null;
  return {side:fast>slow?1:fast<slow?-1:0,
    gap:(fast-slow)/slow,slope:(fast-earlier)/earlier};
}
function separatedBoxTouches(bars,level,tolerance,high){
  let touches=0,lastAt=-4;
  for(let i=0;i<bars.length;i++){
    const price=high?bars[i].h:bars[i].l;
    if(Math.abs(price-level)<=tolerance&&i-lastAt>=3){touches++;lastAt=i}
  }
  return touches;
}
function marketRegimeSnapshot(asOf=Date.now()-1800){
  const a5=confirmedSignalBars('5m',asOf),a15=confirmedSignalBars('15m',asOf);
  const waiting={kind:'unknown',label:'판별 대기',reason:'확정 캔들 부족/시세 지연',box:null};
  if(a5.length<85||a15.length<85)return waiting;
  const tail5=a5.slice(-100),tail15=a15.slice(-100);
  if(asOf-(tail5.at(-1).t+300000)>300000||
     asOf-(tail15.at(-1).t+900000)>900000)return waiting;
  const five=marketEmaState(tail5),fifteen=marketEmaState(tail15);
  const adx5=adxWilder(tail5),adx15=adxWilder(tail15);
  if(!five||!fifteen||!adx5||!adx15)return waiting;
  const previous24=tail5.slice(-25,-1);
  const high=Math.max(...previous24.map(b=>b.h)),low=Math.min(...previous24.map(b=>b.l));
  const mid=(high+low)/2,width=(high-low)/mid;
  if(!(high>low&&low>0&&width>0))return waiting;
  const tolerance=(high-low)*.13;
  const upperTouches=separatedBoxTouches(previous24,high,tolerance,true);
  const lowerTouches=separatedBoxTouches(previous24,low,tolerance,false);
  const latest=tail5.at(-1),previousVolume=tail5.slice(-21,-1);
  const volumeAvg=previousVolume.reduce((sum,b)=>sum+b.v,0)/previousVolume.length;
  const volumeRatio=volumeAvg>0?latest.v/volumeAvg:0;
  const burst=volumeRatio>=1.5&&
    (latest.c>high*1.00025||latest.c<low*.99975)&&
    adx5.value>=adx5.previous;
  const box={high,low,width,upperTouches,lowerTouches};
  const common={box,adx5:adx5.value,adx15:adx15.value,volumeRatio,
    trend5:five.side,trend15:fifteen.side};
  if(burst)return {...common,kind:'breakout',label:'돌파주의',
    reason:'2시간 박스 밖 5분봉 마감 · 거래량 1.5배 이상 · ADX 상승',confirmedBreakout:true};
  const boxFormed=width>=.0035&&width<=.025&&upperTouches>=2&&lowerTouches>=2;
  const flat=adx5.value<20&&adx15.value<22&&
    Math.abs(five.gap)<.0015&&Math.abs(fifteen.gap)<.003&&
    Math.abs(five.slope)<.0012&&Math.abs(fifteen.slope)<.002;
  if(boxFormed&&flat)return {...common,kind:'range',label:'횡보',
    reason:'ADX 약세 · EMA 횡보 · 박스 상하단 반복 확인'};
  const aligned=five.side!==0&&five.side===fifteen.side&&
    five.slope*five.side>.00025&&fifteen.slope*fifteen.side>.0004;
  if(adx5.value>=23&&adx15.value>=20&&aligned)
    return {...common,kind:'trend',label:'추세',
      reason:five.side===1?'5·15분 상승 추세 확인':'5·15분 하락 추세 확인'};
  // Ambiguous momentum is not proof of a breakout.
  return {...common,kind:'uncertain',label:'불확실',
    reason:'횡보·추세 조건이 모두 확인되지 않음 · 실제 돌파 감지 아님',confirmedBreakout:false};
}
function selectedMarketPlan(asOf=Date.now()-1800){
  const selected=$('autoMarketMode')?.value||'classic';
  const snapshot=marketRegimeSnapshot(asOf);
  if(selected==='off')return {mode:'pause',reason:'거래 안 함 모드',snapshot,selected};
  if(selected==='breakout')return {mode:'pause',reason:'돌파주의 모드 · 신규 진입 차단',snapshot,selected};
  if(selected==='auto'){
    return {mode:snapshot.kind==='range'?'range':snapshot.kind==='trend'?'classic':'pause',
      reason:snapshot.kind==='unknown'?'시장 상태 판별 대기':'자동 판별: '+snapshot.label+' · 신규 진입 차단',
      snapshot,selected};
  }
  return {mode:selected==='range'?'range':selected==='classic'?'classic':'trend',reason:'',snapshot,selected};
}
}

function calculateAutoPaperSignal(now){
  const minutes=confirmedSignalBars('1m',now-1800);
  if(minutes.length<36)return null;
  const candle=minutes.at(-1),asOf=candle.t+60000;
  if(now-asOf>110000)return null;
  const minute=minuteRmiTrend(minutes);
  if(!minute?.side)return null;
  const side=minute.side,day=dailyRmiTrend(asOf);
  const aligned=!!day?.side&&side===day.side;
  const plan=selectedMarketPlan(asOf);
  if(plan.mode==='pause')return null;
  const volumeRatio=auto1mVolumeRatio(minutes);
  let rangeLow=null,rangeHigh=null,rangeReason='',trend5m=null,trend15m=null;
  if(plan.mode==='classic'){
    // Trend mode keeps the 5m/15m and volume filters, but the DAY RMI
    // cannot forbid either 1m LONG or SHORT; it only adjusts order size.
    // 1m volume >= 1.2x previous 20 bars and <0.5% candle body.
    trend5m=autoTimeframeTrend('5m',asOf);
    trend15m=autoTimeframeTrend('15m',asOf);
    if(!trend5m||trend5m!==trend15m||(side==='LONG'?trend5m!==1:trend5m!==-1))return null;
    if(volumeRatio<1.2||Math.abs(candle.c/candle.o-1)>.005)return null;
    const lastPlaced=autoSignalHistory.filter(x=>x.strategy===AUTO_PAPER_STRATEGY&&
      (x.orderStatus==='pending'||x.orderStatus==='filled'||x.executed)).at(-1);
    if(!minute.changed&&minuteRmiZoneEntry(minute.previous,minute.value)!==side&&
       lastPlaced&&asOf-(lastPlaced.barTime+60000)<300000)return null;
  }else{
    // Retain RMI-first and range behavior: no trend/volume entry confirmation.
    const zoneEntry=minuteRmiZoneEntry(minute.previous,minute.value);
    const rmiTurning=minute.changed||zoneEntry===side||
      (side==='LONG'?minute.value>minute.previous:minute.value<minute.previous);
    if(!rmiTurning)return null;
    if(plan.mode==='range'){
      const snap=plan.snapshot,box=snap.box;
      if(!box||snap.confirmedBreakout||
         box.width<.0035||box.width>.025||
         box.lowerTouches<2||box.upperTouches<2)return null;
      const location=(candle.c-box.low)/(box.high-box.low);
      const nearEdge=side==='LONG'
        ?location>=0&&location<=.22&&minute.value<=readAutoSetting('autoMinuteLowTo')+12
        :location<=1&&location>=.78&&minute.value>=readAutoSetting('autoMinuteHighFrom')-12;
      if(!nearEdge)return null;
      rangeLow=box.low;rangeHigh=box.high;
      rangeReason=side==='LONG'?'횡보 박스 하단 롱':'횡보 박스 상단 숏';
    }
  }
  return {barTime:candle.t,side,price:candle.c,detectedAt:now,strategy:AUTO_PAPER_STRATEGY,
    marketMode:plan.mode,rangeLow,rangeHigh,
    dailyBias:day?.side||null,aligned,dailyDeveloping:!!day?.developing,
    trend5m,trend15m,volumeRatio:Number(volumeRatio.toFixed(2)),
    dailyRmi:day&&Number.isFinite(day.value)?Number(day.value.toFixed(1)):null,
    minuteRmi:Number(minute.value.toFixed(1)),
    reason:(plan.mode==='classic'?'추세장 · 5·15분 정렬 + 거래량 1.2배':
       rangeReason||'1분 RMI 타점 · 시간봉/거래량 필터 없음')+
      ' · '+(minute.turnKind||'1분 방향 유지')+
function validConfig(raw){
  const mode=['classic','trend','auto','range','breakout','off'].includes(raw?.mode)?raw.mode:'classic';
  const config={mode};
  for(const [k,min,max] of [['autoDailyHigh',55,95],['autoDailyLow',5,45],
    ['autoMinuteHighFrom',70,95],['autoMinuteLowTo',5,30]]){
    const n=Number(raw?.[k]);config[k]=Number.isFinite(n)&&n>=min&&n<=max?n:DEFAULTS[k];
  }
  return config;
}
const cors={'Access-Control-Allow-Origin':ALLOWED_ORIGIN,'Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Allow-Headers':'Content-Type','Vary':'Origin','Cache-Control':'no-store'};
const response=(obj,status=200)=>new Response(JSON.stringify(obj),{status,headers:{...cors,'Content-Type':'application/json;charset=utf-8'}});
async function digest(s){const b=new TextEncoder().encode(s),d=await crypto.subtle.digest('SHA-256',b);return Array.from(new Uint8Array(d),x=>x.toString(16).padStart(2,'0')).join('')}
function allowedEndpoint(s){
  try{const u=new URL(s);return u.protocol==='https:'&&[
    'web.push.apple.com','updates.push.services.mozilla.com',
    'fcm.googleapis.com','fcmregistrations.googleapis.com'
  ].some(h=>u.hostname===h||u.hostname.endsWith('.'+h))}catch{return false}
}
async function loadCandles(){
  const tf=['1m','5m','15m','1d'];
  const data=await Promise.all(tf.map(async interval=>{
    const res=await fetch('https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval='+interval+'&limit=220',{headers:{Accept:'application/json'}});
    if(!res.ok)throw Error('Binance '+interval+' HTTP '+res.status);
    const rows=await res.json();
    if(!Array.isArray(rows)||rows.length<85)throw Error('Invalid candles '+interval);
    return [interval,rows.map(v=>({t:+v[0],o:+v[1],h:+v[2],l:+v[3],c:+v[4],v:+v[5]}))];
  }));
  candles=Object.fromEntries(data);
}
async function processSignals(env){
  const {keys}=await env.PUSH_STORE.list({prefix:'sub:',limit:100});
  if(!keys.length)return;
  await loadCandles();
  const now=Date.now();
  const bar=candles['1m'].filter(b=>b.t+60000<=now-1800).at(-1);
  if(!bar||now-(bar.t+60000)>110000)return;
  for(const key of keys){
    const stored=await env.PUSH_STORE.get(key.name,'json');
    if(!stored?.subscription?.endpoint)continue;
    activeConfig=validConfig(stored.config);
    autoSignalHistory=[];
    let signal;
    try{signal=calculateAutoPaperSignal(now)}catch(e){console.error('signal',e);continue}
    if(!signal||signal.barTime!==bar.t)continue;
    const id=key.name.slice(4),dedup='last:'+id;
    if(await env.PUSH_STORE.get(dedup)===String(signal.barTime+':'+signal.side))continue;
    const msg={title:signal.side==='LONG'?'🟢 BTCUSDT LONG 신호':'🔴 BTCUSDT SHORT 신호',
      body:'1분 RMI · '+signal.reason+' · '+signal.price.toLocaleString('en-US')+' USDT',
      side:signal.side,price:signal.price,barTime:signal.barTime,url:APP_URL};
    try{
      const opts=await buildPushPayload({data:JSON.stringify(msg),options:{ttl:90}},
        stored.subscription,{subject:env.VAPID_SUBJECT,publicKey:env.VAPID_PUBLIC_KEY,privateKey:env.VAPID_PRIVATE_KEY});
      const sent=await fetch(stored.subscription.endpoint,opts);
      if(sent.status===404||sent.status===410){await env.PUSH_STORE.delete(key.name);continue}
      if(!sent.ok){console.error('push status',sent.status);continue}
      await env.PUSH_STORE.put(dedup,String(signal.barTime+':'+signal.side),{expirationTtl:86400});
    }catch(e){console.error('send push',e)}
  }
}
export default {
  async fetch(request,env){
    const url=new URL(request.url);
    if(request.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
    if(url.pathname==='/health')return response({service:'btc-signal-push',configured:!!(env.VAPID_PUBLIC_KEY&&env.VAPID_PRIVATE_KEY)});
    if(url.pathname==='/config'&&request.method==='GET')return response({publicKey:env.VAPID_PUBLIC_KEY||null});
    if(request.headers.get('Origin')!==ALLOWED_ORIGIN)return response({error:'Origin not allowed'},403);
    if(url.pathname!=='/subscription'||request.method!=='POST')return response({error:'Not found'},404);
    let body;try{body=await request.json()}catch{return response({error:'Invalid JSON'},400)}
    const sub=body?.subscription;
    if(!sub?.endpoint||!allowedEndpoint(sub.endpoint)||typeof sub.keys?.p256dh!=='string'||typeof sub.keys?.auth!=='string')return response({error:'Invalid web push subscription'},400);
    const id=await digest(sub.endpoint),key='sub:'+id;
    if(body.action==='unsubscribe'){await env.PUSH_STORE.delete(key);return response({ok:true})}
    if(body.action!=='subscribe')return response({error:'Invalid action'},400);
    await env.PUSH_STORE.put(key,JSON.stringify({subscription:sub,config:validConfig(body.config)}));
    return response({ok:true});
  },
  async scheduled(controller,env,ctx){ctx.waitUntil(processSignals(env))}
};