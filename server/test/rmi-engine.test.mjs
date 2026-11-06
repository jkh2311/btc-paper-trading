import test from 'node:test';
import assert from 'node:assert/strict';
import {rmiSeries,minuteRmiZoneEntry,chartSignalFromClosedCandles,downtrendBb30mFilter,
 rmiLongSixTrendUp,rmiLongMarketMode,chartRmiLongEvents} from '../rmi-engine.mjs';

const DUR={'5m':300000,'15m':900000,'30m':1800000,'1h':3600000,'4h':14400000,'1d':86400000};
const SIX=Object.keys(DUR);
function framesAsOf(asOf,kind='up'){
 const frames={};
 for(const tf of SIX){
  const ms=DUR[tf],lastStart=Math.floor(asOf/ms)*ms-ms;
  frames[tf]=Array.from({length:90},(_,i)=>({
   t:lastStart-(89-i)*ms,
   c:(kind==='flat'||kind==='down'&&tf==='30m')?80000+(i%5-2)*80:70000+i*75,
   v:100
  }));
 }
 if(kind==='down'){
  for(let i=85;i<90;i++)frames['30m'][i].c=80000-(i-84)*1100;
 }
 return frames;
}
const now=180000000;
function events(scores,mode){
 return chartRmiLongEvents(scores,scores.map((_,i)=>i*60000),()=>mode);
}
test('RMI 5/14 neutral on unchanged prices',()=>{
 const bars=Array.from({length:40},(_,i)=>({t:i*60000,c:100,v:1}));
 const score=rmiSeries(bars);
 assert.equal(score[18],50);
 assert.equal(score.at(-1),50);
 assert.equal(chartSignalFromClosedCandles(bars),null);
});
test('original SHORT at 85 still unchanged',()=>{
 assert.equal(minuteRmiZoneEntry(84,85),'SHORT');
 assert.equal(minuteRmiZoneEntry(83,90),'SHORT');
 assert.equal(minuteRmiZoneEntry(85,86),null);
});
test('six higher confirmed timeframes, excluding 1m, must all be up',()=>{
 const frames=framesAsOf(now,'up');
 assert.equal(rmiLongSixTrendUp(now,frames),true);
 assert.equal(rmiLongMarketMode(now,frames),'UP');
 frames['1h']=[];
 assert.equal(rmiLongSixTrendUp(now,frames),false);
 assert.equal(rmiLongMarketMode(now,frames),'WAIT');
});
test('30m bearish Bollinger expansion selects the archived downtrend strategy',()=>{
 const frames=framesAsOf(now,'down');
 assert.equal(rmiLongSixTrendUp(now,frames),false);
 assert.equal(downtrendBb30mFilter(now,frames['30m']).blocked,true);
 assert.equal(rmiLongMarketMode(now,frames),'DOWN');
});
test('mixed/unknown is WAIT and emits no LONG',()=>{
 const e=events([50,23,20,15,25,21,17],'WAIT');
 assert.equal(e.filter(Boolean).length,0);
});
test('six-frame UP LONG on first 20 downward touch without READY',()=>{
 const e=events([50,23,20,18,25,21,19],'UP');
 assert.equal(e[2],'LONG');
 assert.equal(e[3],null);
 assert.equal(e[6],'LONG');
 assert.equal(e.includes('READY'),false);
});
test('in downtrend first 17 touch is silent, recovery 25 is READY, second 17 is LONG',()=>{
 const e=events([50,21,17,14,22,25,21,18,17,15],'DOWN');
 assert.equal(e[2],null);
 assert.equal(e[5],'READY');
 assert.equal(e[8],'LONG');
 assert.equal(e[9],null);
 assert.equal(e.filter(x=>x==='LONG').length,1);
});
test('in downtrend no 25 rebound means no LONG',()=>{
 const e=events([50,21,17,13,20,14,24,16,23,17],'DOWN');
 assert.equal(e.filter(Boolean).length,0);
});
test('in UP trend the archived READY/retest path cannot run',()=>{
 const e=events([50,21,17,25,21,17],'UP');
 assert.equal(e[3],null);
 assert.equal(e.filter(x=>x==='READY').length,0);
 assert.equal(e.filter(x=>x==='LONG').length,2);
});
test('in DOWN trend the original 20 crossing never fires LONG',()=>{
 const e=events([50,23,20,18,17,16],'DOWN');
 assert.equal(e.filter(Boolean).length,0);
});
test('READY expiration exactly 40 minutes, and 39 minutes allowed',()=>{
 const expired=Array(50).fill(21);
 expired[0]=40;expired[1]=17;expired[2]=25;
 expired[41]=18;expired[42]=17;
 const a=events(expired,'DOWN');
 assert.equal(a[2],'READY');assert.equal(a[42],null);
 const before=expired.slice();before[40]=18;before[41]=17;
 const b=events(before,'DOWN');
 assert.equal(b[41],'LONG');
});
test('expired READY requires the complete new 17-25-17 cycle',()=>{
 const scores=Array(53).fill(21);
 scores[0]=40;scores[1]=17;scores[2]=25;
 scores[41]=18;scores[42]=17;
 scores[43]=21;scores[44]=24;scores[45]=25;
 scores[46]=21;scores[47]=17;
 const e=events(scores,'DOWN');
 assert.equal(e[42],null);assert.equal(e[45],'READY');assert.equal(e[47],'LONG');
});
test('trend regime switch wipes stale READY',()=>{
 const scores=[50,21,17,25,22,21,17,25,22,17];
 const regimes=['DOWN','DOWN','DOWN','DOWN','WAIT','DOWN','DOWN','DOWN','DOWN','DOWN'];
 const e=chartRmiLongEvents(scores,scores.map((_,i)=>i*60000),i=>regimes[i]);
 assert.equal(e[3],'READY');
 assert.equal(e[6],null);
 assert.equal(e[7],'READY');
 assert.equal(e[9],'LONG');
});
test('signal never represents an executed real order',()=>{
 const candles=Array.from({length:60},(_,i)=>({t:i*60000,c:100+i,v:1}));
 const frames=framesAsOf(100*60000,'up');
 let found=null;
 for(let i=60;i<110;i++){
  candles.push({t:i*60000,c:candles.at(-1).c-2,v:1});
  found=chartSignalFromClosedCandles(candles,{frames});
  if(found?.side==='LONG')break;
 }
 assert.ok(found,'expected bullish-frame RMI LONG');
 assert.equal(found.side,'LONG');
 assert.equal(found.orderSent,false);
});
