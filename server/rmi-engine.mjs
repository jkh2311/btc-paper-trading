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
 const closed=thirtyMinutes.filter(b=>b&&Number.isFinite(b.t)&&
  b.t+span<=asOf&&b.v>0&&b.c>0);
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

export function chartSignalFromClosedCandles(candles,{upper=85,lower=20,thirtyMinutes=null}={}){
 if(!Array.isArray(candles)||candles.length<23)return null;
 const latest=candles.at(-1);
 if(!latest||!Number.isFinite(latest.t)||!(Number(latest.c)>0)||!(Number(latest.v)>0))return null;
 const scores=rmiSeries(candles);
 const previous=scores.at(-2),current=scores.at(-1);
 const side=minuteRmiZoneEntry(previous,current,upper,lower);
 if(!side)return null;
 if(side==='LONG'&&downtrendBb30mFilter(latest.t+60000,thirtyMinutes).blocked)return null;
 return {symbol:'BTCUSDT',timeframe:'1m',barTime:latest.t,side,
  close:Number(latest.c),rmiBefore:previous,rmiAfter:current,
  source:'chart-rmi-zone-cross',orderSent:false};
}
