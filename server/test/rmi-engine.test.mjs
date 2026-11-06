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
test('simple lower crossing helper uses 17; SHORT remains 85',()=>{
 assert.equal(minuteRmiZoneEntry(18,17),'LONG');
 assert.equal(minuteRmiZoneEntry(84,85),'SHORT');
 assert.equal(minuteRmiZoneEntry(17,16),null);
 assert.equal(minuteRmiZoneEntry(85,84),null);
 assert.equal(minuteRmiZoneEntry(NaN,85),null);
});
test('no signal on insufficient or invalid latest bars',()=>{
 assert.equal(chartSignalFromClosedCandles([]),null);
 const rows=Array.from({length:35},(_,i)=>({t:i*60000,c:100,v:1}));
 rows.at(-1).v=0;
 assert.equal(chartSignalFromClosedCandles(rows),null);
});
test('first 17 touch is silent, 25 rebound is READY, second 17 touch is LONG',()=>{
 const scores=[50,19,17,15,20,25,23,18,17,15];
 const sides=chartRmiPatternSignals(scores);
 assert.equal(sides[2],null,'first 17 touch must remain silent');
 assert.equal(sides[4],null,'20 rebound is insufficient');
 assert.equal(sides[5],'READY','25 touch must show readiness');
 assert.equal(sides[8],'LONG','second 17 touch after readiness is LONG');
 assert.equal(sides[9],null,'staying under 17 must not duplicate LONG');
 assert.equal(sides.filter(x=>x==='LONG').length,1);
});
test('17 touch without 25 rebound never emits readiness or LONG',()=>{
 const sides=chartRmiPatternSignals([50,19,17,12,20,14,22,16,23,15]);
 assert.equal(sides.filter(Boolean).length,0);
});
test('25 rebound without prior 17 touch never emits readiness or LONG',()=>{
 const sides=chartRmiPatternSignals([50,25,26,23,25,18,17]);
 assert.equal(sides.filter(Boolean).length,0);
});
test('crossing straight below 17 triggers LONG only after READY',()=>{
 const sides=chartRmiPatternSignals([50,20,14,18,26,21,13]);
 assert.equal(sides[2],null);
 assert.equal(sides[4],'READY');
 assert.equal(sides[6],'LONG');
});
test('SHORT at 85 remains unchanged and independent',()=>{
 const sides=chartRmiPatternSignals([80,84,85,86,20,17]);
 assert.equal(sides[2],'SHORT');
 assert.equal(sides[3],null);
 assert.equal(sides[5],null);
});
test('repeated LONG cycles each need a fresh READY',()=>{
 const sides=chartRmiPatternSignals([50,19,17,25,20,17,16,24,25,20,17]);
 assert.equal(sides[3],'READY');
 assert.equal(sides[5],'LONG');
 assert.equal(sides[6],null);
 assert.equal(sides[8],'READY');
 assert.equal(sides[10],'LONG');
 assert.equal(sides.filter(x=>x==='LONG').length,2);
});
test('confirmed-bar READY and LONG are observer events; no order request',()=>{
 const seq=Array.from({length:60},(_,i)=>({t:i*60000,c:100+i,v:1}));
 let foundReady=null,foundLong=null;
 for(let i=60;i<180;i++){
  const part=Math.floor((i-60)/35)%4;
  const delta=part===0||part===2?-2:2;
  seq.push({t:i*60000,c:seq.at(-1).c+delta,v:1});
  const signal=chartSignalFromClosedCandles(seq);
  if(signal?.side==='READY'&&!foundReady)foundReady=signal;
  if(signal?.side==='LONG'){foundLong=signal;break;}
 }
 assert.ok(foundReady,'expected 25 recovery READY');
 assert.ok(foundLong,'expected second 17 touch LONG');
 assert.equal(foundReady.orderSent,false);
 assert.equal(foundLong.orderSent,false);
 assert.equal(foundLong.source,'chart-rmi-zone-cross');
});

test('READY expires after exactly 40 confirmed 1m candle intervals',()=>{
 const scores=Array(50).fill(21);
 scores[0]=40;scores[1]=17;scores[2]=25; // READY at index 2
 scores[41]=18;scores[42]=17; // index 42: exactly 40m after READY
 const sides=chartRmiPatternSignals(scores);
 assert.equal(sides[2],'READY');
 assert.equal(sides[42],null,'expired READY cannot trigger LONG at 40m');
 assert.equal(sides.filter(x=>x==='LONG').length,0);
});
test('39-minute second 17 touch is still LONG',()=>{
 const scores=Array(43).fill(21);
 scores[0]=40;scores[1]=17;scores[2]=25;
 scores[40]=18;scores[41]=17; // 39m after READY
 const sides=chartRmiPatternSignals(scores);
 assert.equal(sides[41],'LONG');
});
test('expired READY requires a fresh 17 touch and 25 rebound before next LONG',()=>{
 const scores=Array(53).fill(21);
 scores[0]=40;scores[1]=17;scores[2]=25;
 scores[41]=18;scores[42]=17; // timeout -> first touch of new cycle
 scores[43]=21;scores[44]=24; // not READY
 scores[45]=25; // new READY
 scores[46]=21;scores[47]=17; // valid LONG
 const sides=chartRmiPatternSignals(scores);
 assert.equal(sides[42],null);
 assert.equal(sides[44],null);
 assert.equal(sides[45],'READY');
 assert.equal(sides[47],'LONG');
 assert.equal(sides.filter(x=>x==='LONG').length,1);
});
test('real candle timestamps expire READY even if bar count is short',()=>{
 const scores=[40,17,25,21,18,17,25,20,17];
 const barTimes=[0,60000,120000,180000,240000,2520000,2580000,2640000,2700000];
 const sides=chartRmiPatternSignals(scores,{barTimes});
 assert.equal(sides[2],'READY');
 assert.equal(sides[5],null,'time gap expired the old READY');
 assert.equal(sides[6],'READY','fresh >=25 after first new 17 touch');
 assert.equal(sides[8],'LONG');
});
test('SHORT remains unchanged while long READY expires',()=>{
 const scores=Array(45).fill(50);
 scores[0]=40;scores[1]=17;scores[2]=25;
 scores[20]=84;scores[21]=85;
 scores[42]=18;scores[43]=17;
 const sides=chartRmiPatternSignals(scores);
 assert.equal(sides[21],'SHORT');
 assert.equal(sides[43],null,'long READY expired');
});
