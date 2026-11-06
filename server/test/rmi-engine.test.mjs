import test from 'node:test';
import assert from 'node:assert/strict';
import {rmiSeries,minuteRmiZoneEntry,chartSignalFromClosedCandles} from '../rmi-engine.mjs';

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
test('a chart signal contains no order request',()=>{
 const seq=Array.from({length:35},(_,i)=>({t:i*60000,c:100+i,v:1}));
 let found=null;
 for(let i=35;i<95;i++){
  seq.push({t:i*60000,c:135-(i-35)*2,v:1});
  found=chartSignalFromClosedCandles(seq);
  if(found)break;
 }
 assert.ok(found,'expected bearish RMI cross');
 assert.equal(found.side,'LONG');
 assert.equal(found.orderSent,false);
 assert.equal(found.source,'chart-rmi-zone-cross');
});
