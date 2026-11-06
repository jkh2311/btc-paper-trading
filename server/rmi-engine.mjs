// Matches index.html rmiSeries(a,14,5) and minuteRmiZoneEntry exactly.
// Pure, side-effect-free: does not place orders or read credentials.
export function rmiSeries(candles,length=14,momentum=5){
 const out=new Array(candles.length).fill(null);
 if(candles.length<momentum+length)return out;
 let avgGain=0,avgLoss=0;
 for(let i=momentum;i<momentum+length;i++){
  const delta=Number(candles[i].c)-Number(candles[i-momentum].c);
  avgGain+=Math.max(0,delta);avgLoss+=Math.max(0,-delta);
 }
 avgGain/=length;avgLoss/=length;
 const score=()=>avgGain+avgLoss===0?50:100*avgGain/(avgGain+avgLoss);
 out[momentum+length-1]=score();
 for(let i=momentum+length;i<candles.length;i++){
  const delta=Number(candles[i].c)-Number(candles[i-momentum].c);
  avgGain=(avgGain*(length-1)+Math.max(0,delta))/length;
  avgLoss=(avgLoss*(length-1)+Math.max(0,-delta))/length;
  out[i]=score();
 }
 return out;
}
export function minuteRmiZoneEntry(previous,current,upper=85,lower=20){
 if(!Number.isFinite(previous)||!Number.isFinite(current))return null;
 if(previous<upper&&current>=upper)return 'SHORT';
 if(previous>lower&&current<=lower)return 'LONG';
 return null;
}
// Mirror of index.html downtrendBb30mFilter. Data is confirmed 30m klines.
export function downtrendBb30mFilter(asOf,thirtyMinutes){
 const span=1800000;
 if(!Array.isArray(thirtyMinutes))return {blocked:true,reason:'30m data missing'};
 // Binance REST candles are chronological; only 24 latest confirmed are needed.
 let left=0,right=thirtyMinutes.length;
 while(left<right){
  const mid=(left+right)>>1;
  if(thirtyMinutes[mid].t+span<=asOf)left=mid+1;else right=mid;
 }
 const closed=thirtyMinutes.slice(Math.max(0,left-24),left)
  .filter(b=>b&&Number.isFinite(b.t)&&b.v>0&&b.c>0);
 if(closed.length<24||asOf-(closed.at(-1).t+span)>span+120000)
  return {blocked:true,reason:'30m history insufficient/stale'};
 function band(end){
  const slice=closed.slice(end-19,end+1);
  if(slice.length!==20)return null;
  const mid=slice.reduce((sum,b)=>sum+b.c,0)/20;
  const sigma=Math.sqrt(slice.reduce((sum,b)=>sum+(b.c-mid)**2,0)/20);
  return {mid,lower:mid-2*sigma,width:4*sigma};
 }
 for(let end=closed.length-1;end>=Math.max(21,closed.length-3);end--){
  const now=band(end),prior=band(end-2);
  if(!now||!prior||!(prior.mid>0&&prior.width>0))continue;
  const widthGrowth=now.width/prior.width;
  const midFall=(prior.mid-now.mid)/prior.mid;
  const lowerFall=(prior.lower-now.lower)/prior.mid;
  if(widthGrowth>=1.12&&midFall>=0.0015&&lowerFall>=0.004&&
    closed[end].c<now.mid)
   return {blocked:true,reason:'30m bearish Bollinger expansion'};
 }
 return {blocked:false,reason:''};
}

const TREND_FRAMES=['5m','15m','30m','1h','4h','1d'];
const FRAME_MS={'5m':300000,'15m':900000,'30m':1800000,'1h':3600000,'4h':14400000,'1d':86400000};
function ema(values,period){
 let average=values[0],weight=2/(period+1);
 for(let i=1;i<values.length;i++)average=values[i]*weight+average*(1-weight);
 return average;
}
export function rmiLongSixTrendUp(asOf,frames={}){
 return TREND_FRAMES.every(tf=>{
  const duration=FRAME_MS[tf],all=frames[tf]||[];
  let left=0,right=all.length;
  while(left<right){const mid=(left+right)>>1;
   if(all[mid].t+duration<=asOf)left=mid+1;else right=mid;}
  const a=all.slice(Math.max(0,left-62),left)
   .filter(b=>b&&Number.isFinite(b.t)&&b.v>0&&b.c>0);
  if(!a.length||asOf-(a.at(-1).t+duration)>duration+120000)return false;
  if(tf==='5m'||tf==='15m'){
   if(a.length<24)return false;
   const closes=a.slice(-22).map(b=>b.c);
   const fast=ema(closes,5),slow=ema(closes,10);
   const previous=ema(closes.slice(0,-3),5),lastClose=closes.at(-1);
   return (fast-slow)/Math.max(1,slow)>.000045&&
    (fast-previous)/Math.max(1,previous)>.000015&&lastClose>=slow;
  }
  if(a.length<55)return false;
  const closes=a.slice(-60).map(b=>b.c);
  return ema(closes,20)>ema(closes,50)*1.0003;
 });
}
export function rmiLongMarketMode(asOf,frames={}){
 if(rmiLongSixTrendUp(asOf,frames))return 'UP';
 const bb=downtrendBb30mFilter(asOf,frames['30m']);
 if(bb.blocked&&bb.reason==='30m bearish Bollinger expansion')return 'DOWN';
 return 'WAIT';
}
export function chartRmiLongEvents(scores,times,marketMode){
 const events=new Array(scores.length).fill(null);
 let touched=false,ready=false,readyAt=-1;
 for(let i=1;i<scores.length;i++){
  const v=scores[i],prev=scores[i-1];
  if(!Number.isFinite(v)||!Number.isFinite(prev))continue;
  const currentTime=(times?.[i]??i*60000)+60000;
  if(ready&&currentTime-readyAt>=40*60000){
   ready=false;touched=false;readyAt=-1;
  }
  const candidate20=prev>20&&v<=20;
  const candidate17=prev>17&&v<=17;
  const mode=marketMode(i);
  if(mode==='UP'){
   ready=false;touched=false;readyAt=-1;
   if(candidate20)events[i]='LONG';
  }else if(mode==='DOWN'){
   if(!touched&&candidate17)touched=true;
   else if(touched&&!ready&&v>=25){
    ready=true;readyAt=currentTime;events[i]='READY';
   }else if(ready&&candidate17){
    ready=false;readyAt=-1;touched=true;events[i]='LONG';
   }
  }else{
   touched=false;ready=false;readyAt=-1;
  }
 }
 return events;
}
export function chartSignalFromClosedCandles(candles,{upper=85,lower=20,thirtyMinutes=null,frames=null}={}){
 if(!Array.isArray(candles)||candles.length<23)return null;
 const latest=candles.at(-1);
 if(!latest||!Number.isFinite(latest.t)||!(Number(latest.c)>0)||!(Number(latest.v)>0))return null;
 const scores=rmiSeries(candles);
 const previous=scores.at(-2),current=scores.at(-1);
 const byTime=frames||{'30m':thirtyMinutes};
 const modes=new Map(),times=candles.map(b=>b.t);
 const longs=chartRmiLongEvents(scores,times,i=>{
  const key=Math.floor((times[i]+60000)/300000);
  if(!modes.has(key))modes.set(key,rmiLongMarketMode(times[i]+60000,byTime));
  return modes.get(key);
 });
 const side=previous<upper&&current>=upper?'SHORT':longs.at(-1);
 if(!side)return null;
 return {symbol:'BTCUSDT',timeframe:'1m',barTime:latest.t,side,
  close:Number(latest.c),rmiBefore:previous,rmiAfter:current,
  source:'chart-rmi-zone-cross',orderSent:false};
}
