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
export function minuteRmiZoneEntry(previous,current,upper=85,lower=15){
 if(!Number.isFinite(previous)||!Number.isFinite(current))return null;
 if(previous<upper&&current>=upper)return 'SHORT';
 if(previous>lower&&current<=lower)return 'LONG';
 return null;
}
// Exactly matches the PWA's confirmed-bar chart LONG retest sequence.
// First <= lower -> >= 30 recovery -> second <= lower crossing.
// The original SHORT upward crossing at upper remains unchanged.
export function chartRmiPatternSignals(scores,{upper=85,lower=15}={}){
 const sides=new Array(scores.length).fill(null);
 let firstLow=false,recovered=false;
 for(let i=1;i<scores.length;i++){
  const prev=scores[i-1],value=scores[i];
  if(!Number.isFinite(value))continue;
  if(firstLow&&value>=30)recovered=true;
  if(!Number.isFinite(prev))continue;
  if(prev<upper&&value>=upper)sides[i]='SHORT';
  if(prev>lower&&value<=lower){
   if(recovered)sides[i]='LONG';
   firstLow=true;recovered=false;
  }
 }
 return sides;
}
export function chartSignalFromClosedCandles(candles,{upper=85,lower=15}={}){
 if(!Array.isArray(candles)||candles.length<23)return null;
 const latest=candles.at(-1);
 if(!latest||!Number.isFinite(latest.t)||!(Number(latest.c)>0)||!(Number(latest.v)>0))return null;
 const scores=rmiSeries(candles);
 const previous=scores.at(-2),current=scores.at(-1);
 const side=chartRmiPatternSignals(scores,{upper,lower}).at(-1);
 if(!side)return null;
 return {symbol:'BTCUSDT',timeframe:'1m',barTime:latest.t,side,
  close:Number(latest.c),rmiBefore:previous,rmiAfter:current,
  source:'chart-rmi-zone-cross',orderSent:false};
}
