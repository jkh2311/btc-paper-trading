'use strict';
/* Hanine daily Bollinger contraction scenarios — VISUAL ANALYSIS ONLY.
 * No API credentials, trading signal, order logic, timers, or fetches.
 * Only completed historical BTCUSDT daily bars, no forward leakage.
 */
(function(){
 const DAY=86400000,HORIZON=20,WINDOW=20,LOOKBACK=120,MAX_MATCHES=75;
 const barClose=b=>Number(b?.c);
 function quantile(values,q){
  const x=values.filter(Number.isFinite).sort((a,b)=>a-b);
  if(!x.length)return null;
  const pos=(x.length-1)*Math.min(1,Math.max(0,q)),i=Math.floor(pos),f=pos-i;
  return x[i]+(x[Math.min(i+1,x.length-1)]-x[i])*f;
 }
 function bb(bars,i){
  if(i<WINDOW-1)return null;
  let sum=0;for(let j=i-19;j<=i;j++)sum+=barClose(bars[j]);
  const mid=sum/20;
  let variance=0;for(let j=i-19;j<=i;j++)variance+=(barClose(bars[j])-mid)**2;
  const dev=Math.sqrt(variance/20);
  return mid>0?{mid,upper:mid+2*dev,lower:mid-2*dev,
   width:4*dev/mid,location:dev>0?(barClose(bars[i])-mid)/(2*dev):0}:null;
 }
 function dailyCompleted(bars,now){
  if(!Array.isArray(bars))return [];
  const input=bars.filter(b=>Number.isFinite(Number(b?.t))&&barClose(b)>0&&
   Number(b?.h)>0&&Number(b?.l)>0&&Number(b?.h)>=Number(b?.l))
    .slice().sort((a,b)=>a.t-b.t);
  const arr=[];
  for(const b of input){
   if(Number(b.t)+DAY>now)continue;
   if(arr.length&&Number(b.t)<=Number(arr.at(-1).t))continue;
   arr.push(b);
  }
  return arr;
 }
 function classify(base,path){
  const ratios=path.map(p=>p/base-1);
  const min5=Math.min(...ratios.slice(0,10)),at5=ratios[4],at20=ratios.at(-1);
  if(min5<-.035&&at20>min5+.02)return 'B';
  if(at5>0&&at20>-.025)return 'A';
  return 'C';
 }
 function analyze(bars,now=Date.now()){
  const d=dailyCompleted(bars,now);
  if(d.length<WINDOW+LOOKBACK+HORIZON+30)
   return {ready:false,reason:'일봉 데이터가 부족해요 (최소 약 190개 확정 일봉 필요)'};
  const end=d.length-1,current=bb(d,end);
  if(!current)return {ready:false,reason:'현재 볼밴 계산 불가'};
  const currentReturn=barClose(d[end])/barClose(d[end-5])-1;
  const historical=[];
  for(let i=LOOKBACK;i<=end-HORIZON;i++){
   // Every candidate's features must use only past/current candles at i.
   const v=bb(d,i);if(!v)continue;
   const priorWidths=[];
   for(let k=i-LOOKBACK+1;k<=i;k++){
    const w=bb(d,k)?.width;
    if(Number.isFinite(w))priorWidths.push(w);
   }
   if(priorWidths.length<LOOKBACK)continue;
   const percentile=priorWidths.filter(x=>x<=v.width).length/priorWidths.length;
   historical.push({i,v,percentile,ret5:barClose(d[i])/barClose(d[i-5])-1});
  }
  const recentWidths=[];
  for(let k=end-LOOKBACK+1;k<=end;k++){
   const w=bb(d,k)?.width;
   if(Number.isFinite(w))recentWidths.push(w);
  }
  const rank=recentWidths.filter(x=>x<=current.width).length/recentWidths.length;
  const span=Math.max(.04,current.width);
  const matches=historical.map(x=>{
   const score=Math.abs(x.percentile-rank)*1.5+
    Math.abs(x.ret5-currentReturn)/.10*.40+
    Math.abs(x.v.location-current.location)*.15+
    Math.abs(x.v.width-current.width)/span*.25;
   return {...x,score};
  }).sort((a,b)=>a.score-b.score).slice(0,MAX_MATCHES);
  // Exclude weak analogues; never claim accuracy from unrelated regimes.
  const selected=matches.filter(x=>x.score<=.85);
  const groups={A:[],B:[],C:[]};
  const spot=barClose(d[end]);
  for(const m of selected){
   const base=barClose(d[m.i]);
   const path=Array.from({length:HORIZON},(_,k)=>barClose(d[m.i+k+1]));
   if(path.some(p=>!(p>0)))continue;
   const kind=classify(base,path);
   groups[kind].push(path.map(p=>p/base));
  }
  const names={A:'반등 후 수렴 후보',B:'추가 하락 후 회복 후보',C:'하락 지속 후보'};
  const paths={};
  for(const key of ['A','B','C']){
   const rows=groups[key];
   if(rows.length<3)continue;
   paths[key]=Array.from({length:HORIZON+1},(_,j)=>
    j?spot*quantile(rows.map(p=>p[j-1]),.5):spot);
  }
  const threshold=quantile(recentWidths,.25);
  const contraction=recentWidths.length>=25&&current.width<=threshold?
   '이미 낮은 폭':current.width>recentWidths.at(-2)?'폭 확대 중':'폭 축소 중';
  // A future path's 20-day BB width uses projected closes only,
  // never treats the projection as exchange candles or signals.
  const convergences={};
  for(const key of Object.keys(paths)){
   const closes=d.slice(-19).map(barClose);
   let first=null,priorWidth=current.width;
   for(let k=1;k<=HORIZON;k++){
    closes.push(paths[key][k]);if(closes.length>20)closes.shift();
    const mean=closes.reduce((x,y)=>x+y,0)/20;
    const sd=Math.sqrt(closes.reduce((x,y)=>x+(y-mean)**2,0)/20);
    const width=4*sd/mean;
    if(first===null&&width<=current.width*.75&&width<priorWidth)first=k;
    priorWidth=width;
   }
   convergences[key]=first;
  }
  const boxBars=d.slice(-20);
  const support=Math.min(...boxBars.map(x=>Number(x.l)));
  const resistance=Math.max(...boxBars.map(x=>Number(x.h)));
  return {ready:true,width:current.width,rank,contraction,spot,
   support,resistance,paths,convergences,
   counts:Object.fromEntries(['A','B','C'].map(k=>[k,groups[k].length])),
   samples:selected.length,names,lastClosedAt:Number(d[end].t),
   horizon:HORIZON,range:[quantile(d.slice(-10).map(b=>Number(b.l)),.2),
   quantile(d.slice(-10).map(b=>Number(b.h)),.8)]};
 }
 let cachedKey='',cached=null;
 function cachedAnalysis(bars){
  const n=Date.now();
  const last=bars?.at(-1),key=[bars?.length,last?.t,last?.c,Math.floor(n/DAY)].join('|');
  if(key!==cachedKey){cached=analyze(bars,n);cachedKey=key}
  return cached;
 }
 function summary(result){
  const el=document.getElementById('dailyConvergenceStatus');
  if(!el)return;
  if(!result?.ready){el.textContent=result?.reason||'일봉 데이터 대기 중';return;}
  const pct=n=>(100*n).toFixed(1)+'%';
  const money=n=>Math.round(n).toLocaleString('ko-KR');
  const rows=['일봉 볼밴 폭 '+pct(result.width)+' · 120일 폭 상위 '+Math.round((1-result.rank)*100)+'% · '+result.contraction,
   '최근 20일 지지 후보 '+money(result.support)+' / 저항 후보 '+money(result.resistance)+' USDT',
   '과거 유사 구간 '+result.samples+'개 (유사도 조건 충족)'];
  for(const type of ['A','B','C']){
   const n=result.counts[type],step=result.convergences[type];
   rows.push(type+' '+result.names[type]+': '+n+'개'+
    (result.paths[type]?' · 20일 중앙 경로 · 폭 25% 축소 '+(step?'약 '+step+'일째':'20일 내 미확인'):' · 표본 부족 (경로 숨김)'));
  }
  rows.push('과거 패턴 기반 조건부 시나리오 · 미래 방향/수렴 시점 보장 없음 · 주문 신호 아님');
  el.textContent=rows.join('\n');
 }
 function render(ctx,{bars,tf,left,count,bw,y,top,bottom,plotW}){
  if(!document.getElementById('dailyConvergenceToggle')?.checked)return;
  if(tf!=='1d'){
   const el=document.getElementById('dailyConvergenceStatus');
   if(el)el.textContent='일봉에서만 경로 표시 · 시간봉을 일봉으로 바꿔 주세요';
   return;
  }
  const result=cachedAnalysis(bars);
  summary(result);
  if(!result?.ready)return;
  // Draw only future paths and genuine historical box levels; no synthetic
  // candle insertion, no auto orders. Keep all chart price scaling untouched.
  const dailyBars=dailyCompleted(bars,Date.now());
  const lastIndex=bars.findIndex(x=>Number(x.t)===result.lastClosedAt);
  if(lastIndex<0)return;
  const futureDays=Math.min(HORIZON,Math.max(0,Math.floor(left+count-1-lastIndex)));
  const toX=j=>(lastIndex+j-left+.5)*bw;
  ctx.save();ctx.beginPath();ctx.rect(0,top,plotW,Math.max(1,bottom-top));ctx.clip();
  if(futureDays>0){
   const colors={A:'#3ddc96',B:'#ffa85e',C:'#ee6c8b'};
   for(const kind of ['A','B','C']){
    const curve=result.paths[kind];if(!curve)continue;
    ctx.beginPath();ctx.setLineDash([4,5]);ctx.strokeStyle=colors[kind];
    ctx.lineWidth=1.8;
    for(let j=0;j<=futureDays;j++){
     const x=toX(j),yy=y(curve[j]);
     if(j===0)ctx.moveTo(x,yy);else ctx.lineTo(x,yy);
    }
    ctx.stroke();
    const xx=toX(futureDays),yy=y(curve[futureDays]);
    if(xx>=0&&xx<=plotW&&yy>=top+12&&yy<=bottom-4){
     ctx.setLineDash([]);ctx.fillStyle=colors[kind];ctx.font='bold 10px sans-serif';
     ctx.fillText(kind,Math.min(plotW-12,xx+3),yy-4);
    }
   }
  }
  // This is an observed, trailing 20-d range (not a future prediction).
  ctx.lineWidth=1;ctx.setLineDash([3,6]);ctx.font='10px sans-serif';
  for(const [price,label,color] of [[result.support,'20일 지지','#49d1ac'],
   [result.resistance,'20일 저항','#f29a98']]){
   const yy=y(price);if(yy<top+15||yy>bottom-10)continue;
   ctx.beginPath();ctx.moveTo(0,yy);ctx.lineTo(plotW,yy);
   ctx.strokeStyle=color;ctx.stroke();
   ctx.fillStyle=color;ctx.fillText(label,6,yy-4);
  }
  ctx.restore();
 }
 window.btcDailyConvergenceForecast={analyze,render,summary,refresh(){
  cachedKey='';if(typeof window.btcRedrawChart==='function')window.btcRedrawChart();
 }};
 const control=document.getElementById('dailyConvergenceToggle');
 control?.addEventListener('change',()=>{
  try{localStorage.setItem('hanine-daily-bb-convergence-v251',control.checked?'1':'0')}catch(_){}
  window.btcDailyConvergenceForecast.refresh();
 });
 try{if(control)control.checked=localStorage.getItem('hanine-daily-bb-convergence-v251')==='1'}
 catch(_){}
})();
