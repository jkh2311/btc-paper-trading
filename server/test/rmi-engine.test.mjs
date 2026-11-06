import test from 'node:test';
import assert from 'node:assert/strict';
import {rmiSeries,minuteRmiZoneEntry,chartRmiPatternSignals,chartSignalFromClosedCandles} from '../rmi-engine.mjs';

test('same 5,14 momentum RMI neutral on unchanged prices',()=>{
 const bars=Array.from({length:40},(_,i)=>({t:i*60000,c:100,v:1}));
 const score=rmiSeries(bars);
 assert.equal(score[18],50);
 assert.equal(score.at(-1),50);
 assert.equal(chartSignalFromClosedCandles(bars),null);
});
test('chart LONG and SHORT are directional 15/85 crossings only',()=>{
 assert.equal(minuteRmiZoneEntry(16,15,85,15),'LONG');
 assert.equal(minuteRmiZoneEntry(84,85,85,15),'SHORT');
 assert.equal(minuteRmiZoneEntry(15,14,85,15),null);
 assert.equal(minuteRmiZoneEntry(85,84,85,15),null);
 assert.equal(minuteRmiZoneEntry(14,85,85,15),'SHORT');
 assert.equal(minuteRmiZoneEntry(NaN,85,85,15),null);
});
test('no signal on insufficient or invalid latest bars',()=>{
 assert.equal(chartSignalFromClosedCandles([]),null);
 const rows=Array.from({length:35},(_,i)=>({t:i*60000,c:100,v:1}));
 rows.at(-1).v=0;
 assert.equal(chartSignalFromClosedCandles(rows),null);
});
test('chart LONG requires first 15 touch, 30 recovery, second 15 touch',()=>{
 const scores=[50,16,15,14,23,30,28,16,15,14];
 const sides=chartRmiPatternSignals(scores);
 assert.equal(sides[2],null,'first 15 touch must not signal');
 assert.equal(sides[5],null,'30 recovery must not signal');
 assert.equal(sides[8],'LONG','second 15 touch after recovery signals');
 assert.equal(sides[9],null,'remaining below 15 must not repeat');
 assert.equal(chartRmiPatternSignals([50,16,15,23,29,16,15]).filter(Boolean).length,0,
  '29 is insufficient recovery');
});
test('SHORT remains the first upward 85 crossing',()=>{
 const sides=chartRmiPatternSignals([80,84,85,86,20,15]);
 assert.equal(sides[2],'SHORT');
 assert.equal(sides[3],null);
 assert.equal(sides[5],null,'first 15 touch does not trigger LONG');
});
test('each later 30 recovery permits one new LONG retest',()=>{
 const sides=chartRmiPatternSignals([50,16,15,30,16,14,30,16,15]);
 assert.equal(sides[5],'LONG');
 assert.equal(sides[8],'LONG');
 assert.equal(sides.filter(x=>x==='LONG').length,2);
});
test('confirmed chart LONG after two oversold dips contains no order request',()=>{
 const seq=Array.from({length:60},(_,i)=>({t:i*60000,c:100+i,v:1}));
 let firstLow=false,recovered=false,found=null;
 for(let i=60;i<180;i++){
  const part=Math.floor((i-60)/35)%4;
  const delta=part===0||part===2?-2:2;
  seq.push({t:i*60000,c:seq.at(-1).c+delta,v:1});
  const current=rmiSeries(seq).at(-1);
  if(current<=15)firstLow=true;
  if(firstLow&&current>=30)recovered=true;
  const signal=chartSignalFromClosedCandles(seq);
  if(signal?.side==='LONG'){
   assert.ok(firstLow&&recovered,'LONG before recovery');
   found=signal;break;
  }
 }
 assert.ok(found,'expected second oversold touch');
 assert.equal(found.side,'LONG');
 assert.equal(found.orderSent,false);
 assert.equal(found.source,'chart-rmi-zone-cross');
});
