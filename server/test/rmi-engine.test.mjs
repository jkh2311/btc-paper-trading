import test from 'node:test';
import assert from 'node:assert/strict';
import {rmiSeries,minuteRmiZoneEntry,chartSignalFromClosedCandles} from '../rmi-engine.mjs';

test('RMI(5,14) neutral on unchanged prices',()=>{
 const bars=Array.from({length:40},(_,i)=>({t:i*60000,c:100,v:1}));
 const score=rmiSeries(bars);
 assert.equal(score[18],50);
 assert.equal(score.at(-1),50);
 assert.equal(chartSignalFromClosedCandles(bars),null);
});

test('original paper chart LONG downward 20 crossing',()=>{
 assert.equal(minuteRmiZoneEntry(21,20),'LONG','touching 20 emits LONG');
 assert.equal(minuteRmiZoneEntry(22,18),'LONG','jumping below 20 emits LONG');
 assert.equal(minuteRmiZoneEntry(20,19),null,'already at or below 20 is not a new crossing');
 assert.equal(minuteRmiZoneEntry(19,18),null,'remaining below 20 does not repeat');
 assert.equal(minuteRmiZoneEntry(25,21),null,'above 20 does not trigger');
 assert.equal(minuteRmiZoneEntry(20,21),null,'upward crossing does not trigger');
 assert.equal(minuteRmiZoneEntry(NaN,20),null);
});

test('SHORT crossing 85 remains unchanged',()=>{
 assert.equal(minuteRmiZoneEntry(84,85),'SHORT');
 assert.equal(minuteRmiZoneEntry(83,90),'SHORT');
 assert.equal(minuteRmiZoneEntry(85,86),null);
 assert.equal(minuteRmiZoneEntry(86,84),null);
});

test('no signal on insufficient or invalid latest bars',()=>{
 assert.equal(chartSignalFromClosedCandles([]),null);
 const rows=Array.from({length:35},(_,i)=>({t:i*60000,c:100,v:1}));
 rows.at(-1).v=0;
 assert.equal(chartSignalFromClosedCandles(rows),null);
});

test('chart LONG emits on first 20 crossing without 17-25 READY sequence',()=>{
 const seq=Array.from({length:60},(_,i)=>({t:i*60000,c:100+i,v:1}));
 let found=null;
 for(let i=60;i<110;i++){
   seq.push({t:i*60000,c:seq.at(-1).c-2,v:1});
   found=chartSignalFromClosedCandles(seq);
   if(found?.side==='LONG')break;
 }
 assert.ok(found,'20 crossing must produce a LONG signal');
 assert.equal(found.side,'LONG');
 assert.equal(found.orderSent,false);
 assert.equal(found.source,'chart-rmi-zone-cross');
});

test('single threshold 20 is shared between direct and confirmed chart signal',()=>{
 const seq=Array.from({length:60},(_,i)=>({t:i*60000,c:100+i,v:1}));
 let prevRmi=null;
 for(let i=60;i<110;i++){
  seq.push({t:i*60000,c:seq.at(-1).c-2,v:1});
  const score=rmiSeries(seq);
  const previous=score.at(-2),current=score.at(-1);
  const signal=chartSignalFromClosedCandles(seq);
  const expected=minuteRmiZoneEntry(previous,current);
  assert.equal(signal?.side??null,expected,'RMI signal mismatch on bar '+i);
  prevRmi=current;
 }
 assert.ok(Number.isFinite(prevRmi));
});
