/* v166: Read-only BTCUSDT live-position take-profit guidance.
 * Uses position snapshots already emitted by the app and last 120 CLOSED
 * 1-minute Binance klines. Does not access credentials or place orders. */
(()=>{
'use strict';
const $=id=>document.getElementById(id);
const panel=$('aiEntryDetails'),toggle=$('aiEntryToggle');
if(!panel||!toggle)return;
const style=document.createElement('style');
style.textContent=`
/* v166 fixed modal, explicitly closed only; chart and TP choices */
#aiEntryDetails.ai-tp-modal{
 position:fixed!important;inset:0!important;width:100vw!important;height:100dvh!important;
 max-width:none!important;z-index:100810!important;border:0!important;border-radius:0!important;
 margin:0!important;overflow-y:auto!important;overscroll-behavior:contain!important;
 background:#0d1b30!important;color:#edf4ff!important;
 padding:calc(13px + env(safe-area-inset-top)) max(12px,env(safe-area-inset-right))
 calc(23px + env(safe-area-inset-bottom)) max(12px,env(safe-area-inset-left))!important;
}
#aiEntryDetails.ai-tp-modal[hidden]{display:none!important}
#aiEntryDetails .ai-tp-head{display:flex;align-items:center;justify-content:space-between;gap:9px;
 position:sticky;top:calc(-13px - env(safe-area-inset-top));background:#0d1b30;padding:6px 0 10px;
 border-bottom:1px solid #344e69;z-index:5}
#aiEntryDetails .ai-tp-head strong{font-size:16px}
#aiEntryDetails .ai-tp-head small{display:block;color:#97b2d1;font-size:10px}
#aiTpClose{min-width:73px;min-height:36px;padding:7px 10px;font-size:13px}
#aiTpPosition{margin:10px 0;padding:9px;background:#152941;border:1px solid #375879;border-radius:9px;
 display:flex;flex-wrap:wrap;gap:8px;align-items:center;font-size:12px}
#aiTpPositionSelect{min-width:138px;max-width:100%;padding:6px 8px;font-size:12px}
#aiTpStatus{font-size:12px;margin:7px 0;color:#d2e3f5;line-height:1.55}
#aiTpChart{width:100%!important;height:clamp(290px,47dvh,450px)!important;
 border:1px solid #39536e;border-radius:9px;background:#091524!important;touch-action:pan-y!important}
#aiTpChartNote{color:#aac5e1;font-size:11px;line-height:1.5;margin:6px 0 12px}
#aiTpChoices{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px}
#aiTpChoices button{padding:10px 6px;min-width:0;text-align:left;border:1px solid #3a5a78;background:#172d46;
 display:flex;flex-direction:column;gap:5px;border-radius:10px}
#aiTpChoices button[aria-pressed="true"]{border-color:#f5cd7b;box-shadow:0 0 0 1px #f5cd7b}
#aiTpChoices button strong{font-size:12px;color:#e9f5ff}
#aiTpChoices button .ai-tp-price{font-weight:800;font-size:clamp(12px,2.6vw,17px);color:#67dec0;overflow-wrap:anywhere}
#aiTpChoices button .ai-tp-roi{font-weight:700;color:#f6d38b;font-size:12px}
#aiTpChoices button .ai-tp-origin{font-size:10px;line-height:1.35;color:#b9d0e9}
#aiTpInfo{font-size:12px;margin:10px 0;line-height:1.55;color:#c1d8f0}
#aiTpRisk{font-size:11px;line-height:1.55;color:#ffd28c;background:#362c32;padding:9px;border-radius:8px}
#aiEntryDetails.ai-tp-modal .ai-tp-disclaimer{font-size:10px;color:#8fa8c3;line-height:1.6;margin-top:11px}
#page-chart #aiEntryToggle:disabled{opacity:.65;cursor:default}
#aiEntryToggle .candle-pattern-numbers{font-size:11px!important}
@media(max-width:460px){#aiTpChoices{grid-template-columns:1fr}
 #aiTpChoices button{display:grid;grid-template-columns:1fr 1fr;gap:3px}
 #aiTpChoices button .ai-tp-origin{grid-column:1/-1}
 #aiTpChart{height:320px!important}}
`;
document.head.append(style);
panel.classList.add('ai-tp-modal');
document.body.appendChild(panel);
panel.hidden=true;
panel.setAttribute('role','dialog');
panel.setAttribute('aria-modal','true');
panel.setAttribute('aria-labelledby','aiTpModalTitle');
panel.replaceChildren();
panel.innerHTML='<div class="ai-tp-head"><div><strong id="aiTpModalTitle">실전 포지션 AI 익절 구간</strong>'+
 '<small>최근 2시간 확정 1분봉 · 선택한 포지션 기준</small></div>'+
 '<button type="button" id="aiTpClose">✕ 닫기</button></div>'+
 '<div id="aiTpPosition"><span>보유 포지션 조회 중…</span></div>'+
 '<div id="aiTpStatus">포지션을 선택하면 지지·저항을 분석해요.</div>'+
 '<canvas id="aiTpChart" role="img" aria-label="최근 2시간 1분봉 및 선택 포지션 진입가와 익절 추천선"></canvas>'+
 '<div id="aiTpChartNote">완성된 1분봉과 실제 진입가 · 익절 후보선을 표시합니다.</div>'+
 '<div id="aiTpChoices"></div><div id="aiTpThreeOrders"></div><div id="aiTpInfo"></div><div id="aiTpRisk"></div>'+
 '<p class="ai-tp-disclaimer">참고용 규칙형 기술적 분석입니다. 실전 주문은 자동 제출되지 않습니다. '+
 '표시한 예상 수익률은 레버리지 기반 가격 변동과 가정한 왕복 거래비용 0.12%(명목가치 기준)를 반영한 추정치이며, '+
 '실제 수수료·슬리피지·펀딩·청산 위험에 따라 달라집니다. 5% 수익이나 익절 체결을 보장하지 않습니다.</p>';
let active=[],selectedKey=null,history=[],historyAt=0,busy=false,selectedCandidate=0,analysis=null;
const feeAssumption=.0012,minutes=60000,fmt=p=>Number(p).toLocaleString('en-US',{minimumFractionDigits:1,maximumFractionDigits:1});
const key=p=>p.side+':'+p.positionSide;
const snap=p=>Math.round(p*10)/10;
function positionsFromSnapshot(snapshot){
 if(!Array.isArray(snapshot?.positions))return [];
 return snapshot.positions.map(p=>{
  const amount=Number(p.amount),rawSide=p.side;
  const side=rawSide==='LONG'?'LONG':rawSide==='SHORT'?'SHORT':rawSide==='BOTH'?(amount>0?'LONG':'SHORT'):null;
  return {side,positionSide:rawSide,entry:Number(p.entry),amount,leverage:Number(p.leverage),mark:Number(p.mark)};
 }).filter(p=>p.side&&Number.isFinite(p.amount)&&Math.abs(p.amount)>0&&p.entry>0&&p.leverage>0);
}
function selectedPosition(){
 return active.find(p=>key(p)===selectedKey)||null;
}
/* Read-only bridge for the separately confirmed manual 3-part exit orders.
 * No automated trading occurs in this recommendation module. */
window.btcAiTpSelectedPlan=()=>{
 const p=selectedPosition();
 return p&&analysis?.candidates?.length>=3?
  {position:{...p},candidates:analysis.candidates.slice(0,3).map(c=>({...c})),at:analysis.at}:null;
};

function renderSummary(){
 const p=selectedPosition();
 const verdict=$('aiEntryVerdict'),scores=$('aiEntryScores'),asOf=$('aiEntryAsOf');
 if(!verdict||!scores||!asOf)return;
 if(!p){
  verdict.textContent='포지션 없음';verdict.dataset.kind='wait';
  scores.textContent='진입하면 익절 분석';asOf.textContent='보유 포지션이 있을 때만 활성';
  toggle.disabled=true;
 }else{
  verdict.textContent=p.side+' 익절';verdict.dataset.kind=p.side==='LONG'?'long':'short';
  scores.textContent='진입 '+fmt(p.entry);
  asOf.textContent='2시간 지지·저항 보기 ›';
  toggle.disabled=false;
 }
}
function normalizeSelection(payload){
 if(!payload||!['LONG','SHORT'].includes(payload.side))return;
 const match=active.find(p=>p.side===payload.side&&
  (p.positionSide===payload.positionSide||payload.positionSide==='BOTH'));
 if(match)selectedKey=key(match);
}
function updatePositions(snapshot){
 const previous=selectedPosition(),oldFingerprint=previous&&[previous.side,previous.entry,previous.amount,previous.leverage].join(':');
 active=positionsFromSnapshot(snapshot);
 if(!active.some(p=>key(p)===selectedKey))selectedKey=active[0]?key(active[0]):null;
 const next=selectedPosition(),nextFingerprint=next&&[next.side,next.entry,next.amount,next.leverage].join(':');
 if(!next){analysis=null;if(!panel.hidden)closeModal();}
 else if(oldFingerprint!==nextFingerprint) {analysis=null;selectedCandidate=0;}
 renderSummary();
 if(!panel.hidden)render();
}
function roi(price,p){
 const delta=(p.side==='LONG'?(price-p.entry):(p.entry-price))/p.entry;
 return (delta-feeAssumption)*p.leverage*100;
}
function goalPrice(p,roiPercent){
 const move=roiPercent/(100*p.leverage)+feeAssumption;
 return snap(p.entry*(1+(p.side==='LONG'?1:-1)*move));
}
function analyzeLevels(bars,p){
 if(!p||bars.length<35)return null;
 const last=bars.at(-1);
 const trs=bars.slice(1).map((b,i)=>Math.max(b.h-b.l,Math.abs(b.h-bars[i].c),Math.abs(b.l-bars[i].c)));
 const atr=trs.slice(-14).reduce((a,b)=>a+b,0)/Math.max(1,Math.min(14,trs.length));
 const tol=Math.max(.1,Math.min(p.entry*.0008,Math.max(atr*.24,p.entry*.00007)));
 const pivot=[],sideIsLong=p.side==='LONG';
 for(let i=2;i<bars.length-2;i++){
  const bar=bars[i],neighbours=bars.slice(i-2,i+3),prev=bars.slice(Math.max(0,i-20),i);
  const avgVol=prev.length?prev.reduce((a,v)=>a+v.v,0)/prev.length:bar.v;
  const relVol=avgVol>0?bar.v/avgVol:1;
  if(sideIsLong&&neighbours.every(x=>bar.h>=x.h))pivot.push({price:bar.h,v:relVol,at:bar.t});
  if(!sideIsLong&&neighbours.every(x=>bar.l<=x.l))pivot.push({price:bar.l,v:relVol,at:bar.t});
 }
 const clusters=[];
 for(const item of pivot){
  let cl=clusters.find(x=>Math.abs(x.price-item.price)<=tol);
  if(!cl){cl={price:item.price,count:0,weight:0,latest:item.at};clusters.push(cl);}
  const w=Math.min(2,Math.max(.6,item.v));
  cl.price=(cl.price*cl.weight+item.price*w)/(cl.weight+w);
  cl.weight+=w;cl.count++;cl.latest=Math.max(cl.latest,item.at);
 }
 const minPrice=goalPrice(p,5);
 const valid=clusters.filter(x=>sideIsLong?
   x.price>=minPrice&&x.price>last.c:x.price<=minPrice&&x.price<last.c)
  // Prefer levels touched at least twice, then nearer attainable targets.
  .sort((a,b)=>((b.count>=2?1:0)-(a.count>=2?1:0))||
   (sideIsLong?a.price-b.price:b.price-a.price));
 const chosen=[];
 // Prefer price levels with repeated touches; retain nearest distinct candidate levels.
 for(const level of valid){
  const price=snap(level.price),gain=roi(price,p);
  if(gain<4.999||price<=0||chosen.some(c=>Math.abs(c.price-price)<Math.max(tol,atr*.45)))continue;
  if(!(sideIsLong?price>last.c:price<last.c))continue; // Already passed: cannot offer as a future TP.
  chosen.push({price,roi:gain,source:sideIsLong?'저항':'지지',hits:level.count,strength:level.weight,kind:'level'});
  if(chosen.length===3)break;
 }
 const goalLevels=[5,8,12,16,20,30,40,60,80,100];
 for(const pct of goalLevels){
  if(chosen.length>=3)break;
  const price=goalPrice(p,pct);
  if(price<=0||roi(price,p)<4.999||
    !(sideIsLong?price>last.c:price<last.c))continue;
  if(chosen.some(c=>Math.abs(c.price-price)<Math.max(tol,atr*.4)))continue;
  chosen.push({price,roi:roi(price,p),kind:'goal',hits:0,strength:0});
 }
 // Position cannot yield net 5% before zero/negative future price.
 chosen.sort((a,b)=>sideIsLong?a.price-b.price:b.price-a.price);
 const before=clusters.filter(x=>sideIsLong?
   x.price>p.entry&&x.price<minPrice:x.price<p.entry&&x.price>minPrice)
  .sort((a,b)=>sideIsLong?a.price-b.price:b.price-a.price);
 return {candidates:chosen.slice(0,3),nearestBefore:before[0]||null,
  atr,at:last.t,mark:Number.isFinite(p.mark)&&p.mark>0?p.mark:last.c,
  resistanceOrSupport:sideIsLong?'저항':'지지',sampleCount:bars.length};
}
function paintChoices(p){
 const list=$('aiTpChoices');if(!list)return;
 list.replaceChildren();
 if(!analysis?.candidates?.length){
  list.textContent='현재 5% 이상 후보를 산출할 수 없습니다. 현재 포지션·데이터를 확인하세요.';
  return;
 }
 analysis.candidates.forEach((item,i)=>{
  const b=document.createElement('button');b.type='button';
  b.setAttribute('aria-pressed',String(selectedCandidate===i));
  const title=document.createElement('strong');title.textContent=(i+1)+'번 익절 후보';
  const price=document.createElement('span');price.className='ai-tp-price';price.textContent=fmt(item.price)+' USDT';
  const roiValue=document.createElement('span');roiValue.className='ai-tp-roi';
  roiValue.textContent='추정 순수익률 +'+item.roi.toFixed(1)+'%';
  const note=document.createElement('span');note.className='ai-tp-origin';
  note.textContent=item.kind==='level'?
   (p.side==='LONG'?'과거 저항':'과거 지지')+' 부근 · 피벗 '+item.hits+
    '회'+(item.hits>=2?' (반복 확인)':' (단일 확인)'):
   '목표 수익률 기준 · 뚜렷한 지지/저항 근거 없음';
  b.append(title,price,roiValue,note);
  b.addEventListener('click',()=>{
   selectedCandidate=i;paintChoices(p);drawChart();paintAdvice(p);
  });
  list.appendChild(b);
 });
}
function paintAdvice(p){
 const info=$('aiTpInfo'),risk=$('aiTpRisk'),note=$('aiTpChartNote');
 if(!analysis||!p)return;
 const chosen=analysis.candidates[selectedCandidate];
 info.textContent=chosen?
  '선택한 '+(selectedCandidate+1)+'번 후보: '+fmt(chosen.price)+' USDT · 추정 순수익률 +'+chosen.roi.toFixed(2)+
   '% · 선택은 차트 선만 강조하며 실제 익절 주문을 넣지 않아요.':'익절 후보 없음';
 let riskText='';
 if(analysis.nearestBefore){
  const b=analysis.nearestBefore;
  riskText='주의: 목표 +5%에 도달하기 전에 '+analysis.resistanceOrSupport+' 후보 '+fmt(b.price)+
   ' USDT가 있어요. 해당 지점에서 반등/저항을 받을 수 있습니다. ';
 }
 if(analysis.candidates.every(c=>c.kind==='goal'))
  riskText+='최근 2시간에 5% 이상 목표 구간의 뚜렷한 '+analysis.resistanceOrSupport+
   ' 피벗이 없어 수익률 기준 가격만 표시합니다. ';
 riskText+='실제 수익 실현은 시장 유동성, 수수료, 주문 체결 여부에 달려 있습니다.';
 risk.textContent=riskText;
 const local=new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit',hour12:false});
 note.textContent='완성된 1분봉 '+analysis.sampleCount+'개 · '+local.format(new Date(analysis.at+minutes))+
  ' 확정 · 흰색 진입선 / '+(p.side==='LONG'?'초록':'분홍')+' 익절선 / 노란색 선택';
}
function drawChart(){
 if(panel.hidden)return;
 const cv=$('aiTpChart'),p=selectedPosition();if(!cv||!p)return;
 const w=Math.floor(cv.getBoundingClientRect().width),h=Math.floor(cv.getBoundingClientRect().height);
 if(w<100||h<160)return;
 const dpr=Math.min(devicePixelRatio||1,2);cv.width=Math.round(w*dpr);cv.height=Math.round(h*dpr);
 const ctx=cv.getContext('2d');if(!ctx)return;
 ctx.setTransform(dpr,0,0,dpr,0,0);ctx.fillStyle='#091524';ctx.fillRect(0,0,w,h);
 const bars=history,plotL=10,plotR=Math.max(80,w-101),top=13,bottom=h-36;
 if(!bars.length){
  ctx.fillStyle='#adc2d9';ctx.font='12px sans-serif';ctx.fillText('최근 2시간 1분봉 조회 중…',17,37);return;
 }
 const priceLevels=[p.entry,...(analysis?.candidates||[]).map(x=>x.price),analysis?.nearestBefore?.price]
  .filter(v=>Number.isFinite(v));
 const low=Math.min(...bars.map(b=>b.l),...priceLevels),high=Math.max(...bars.map(b=>b.h),...priceLevels);
 const padding=Math.max(.5,(high-low)*.11),lo=low-padding,hi=high+padding;
 const y=v=>top+(hi-v)/(hi-lo)*(bottom-top),dx=(plotR-plotL)/bars.length;
 ctx.font='9px sans-serif';
 for(let i=0;i<=4;i++){
  const v=lo+(hi-lo)*i/4,Y=y(v);
  ctx.strokeStyle='#28415b';ctx.lineWidth=.65;ctx.beginPath();ctx.moveTo(plotL,Y);ctx.lineTo(plotR,Y);ctx.stroke();
  ctx.fillStyle='#9bb0c7';ctx.fillText(fmt(v),plotR+3,Y+3);
 }
 bars.forEach((bar,i)=>{
  const x=plotL+dx*(i+.5),color=bar.c>=bar.o?'#29b9a0':'#ed6d7c';
  ctx.strokeStyle=color;ctx.fillStyle=color;ctx.lineWidth=.9;
  ctx.beginPath();ctx.moveTo(x,y(bar.h));ctx.lineTo(x,y(bar.l));ctx.stroke();
  const t=y(Math.max(bar.o,bar.c)),b=y(Math.min(bar.o,bar.c));
  ctx.fillRect(x-Math.max(.45,dx*.29),t,Math.max(1,dx*.58),Math.max(1,b-t));
 });
 function line(price,label,color,emph=false,dash=[]){
  if(!Number.isFinite(price))return;
  const Y=y(price);ctx.strokeStyle=color;ctx.lineWidth=emph?2.5:1.2;ctx.setLineDash(dash);
  ctx.beginPath();ctx.moveTo(plotL,Y);ctx.lineTo(plotR,Y);ctx.stroke();ctx.setLineDash([]);
  ctx.fillStyle=color;ctx.font=emph?'bold 10px sans-serif':'10px sans-serif';
  ctx.fillText(label+' '+fmt(price),plotR+3,Math.max(11,Math.min(h-9,Y-3)));
 }
 line(p.entry,'진입','#f0f3fc',true,[6,3]);
 (analysis?.candidates||[]).forEach((c,i)=>line(c.price,'익절'+(i+1),
  i===selectedCandidate?'#ffe08d':p.side==='LONG'?'#4ed9af':'#ff88a0',i===selectedCandidate));
 if(analysis?.nearestBefore)line(analysis.nearestBefore.price,'근접'+(p.side==='LONG'?'저항':'지지'),'#fbab64',false,[2,3]);
 const last=bars.at(-1);line(last.c,'종가','#a5bfdc',false,[3,4]);
 ctx.fillStyle='#9cafc4';ctx.font='9px sans-serif';
 const time=new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit',hour12:false});
 for(const i of [0,Math.floor((bars.length-1)/2),bars.length-1]){
  const x=plotL+dx*(i+.5);
  ctx.fillText(time.format(new Date(bars[i].t)),Math.max(4,Math.min(plotR-31,x-13)),h-13);
 }
}
function render(){
 const p=selectedPosition();if(!p)return;
 const bar=$('aiTpPosition');bar.replaceChildren();
 const title=document.createElement('strong');title.textContent='실전 '+p.side+' · 진입 '+fmt(p.entry)+' USDT · '+p.leverage+'배';
 bar.appendChild(title);
 if(active.length>1){
  const select=document.createElement('select');select.id='aiTpPositionSelect';
  active.forEach(item=>{
   const option=document.createElement('option');option.value=key(item);
   option.textContent=item.side+' · '+fmt(item.entry)+' USDT';select.appendChild(option);
  });
  select.value=selectedKey;
  select.addEventListener('change',()=>{selectedKey=select.value;selectedCandidate=0;recalculate();});
  bar.appendChild(select);
 }
 const status=$('aiTpStatus');
 if(!history.length){status.textContent=busy?'최근 2시간 확정봉 조회 중…':'확정봉 데이터 조회 대기';drawChart();return;}
 analysis=analyzeLevels(history,p);
 if(!analysis){status.textContent='1분봉 데이터 또는 진입 정보 부족';return;}
 status.textContent=p.side==='LONG'?'LONG 청산(매도) 기준: 위쪽 저항과 목표 수익률에서 익절 후보를 찾았어요.':
  'SHORT 청산(매수) 기준: 아래쪽 지지와 목표 수익률에서 익절 후보를 찾았어요.';
 selectedCandidate=Math.min(selectedCandidate,Math.max(0,analysis.candidates.length-1));
 paintChoices(p);paintAdvice(p);requestAnimationFrame(drawChart);
}
function recalculate(){analysis=null;if(!panel.hidden)render();}
function openModal(){
 if(!selectedPosition())return;
 panel.hidden=false;document.body.classList.add('ai-entry-modal-open');
 render();if(!history.length)void fetchHistory();
 requestAnimationFrame(drawChart);
}
function closeModal(){panel.hidden=true;document.body.classList.remove('ai-entry-modal-open');}
toggle.addEventListener('click',e=>{e.stopPropagation();openModal()});
$('aiTpClose').addEventListener('click',()=>{closeModal();toggle.focus()});
window.addEventListener('resize',()=>{if(!panel.hidden)requestAnimationFrame(drawChart)});
document.addEventListener('btc:real-account-updated',e=>updatePositions(e.detail));
document.addEventListener('btc:real-position-selected',e=>{normalizeSelection(e.detail);if(!panel.hidden)recalculate();renderSummary()});
document.addEventListener('btc:real-account-cleared',()=>{active=[];selectedKey=null;history=[];analysis=null;closeModal();renderSummary()});
async function fetchHistory(){
 if(busy||document.visibilityState==='hidden'||!active.length)return;
 busy=true;if(!panel.hidden)$('aiTpStatus').textContent='바이낸스 확정 1분봉 분석 중…';
 try{
  const response=await fetch('https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=1m&limit=130',
   {cache:'no-store',signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw Error('1분봉 HTTP '+response.status);
  const raw=await response.json();if(!Array.isArray(raw))throw Error('캔들 응답 오류');
  const cutoff=Date.now()-122*minutes;
  const data=raw.map(x=>({t:Number(x[0]),o:Number(x[1]),h:Number(x[2]),l:Number(x[3]),c:Number(x[4]),v:Number(x[5])}))
   .filter(b=>b.t>=cutoff&&b.t+minutes<=Date.now()-1500&&
    b.o>0&&b.c>0&&b.h>=Math.max(b.o,b.c)&&b.l<=Math.min(b.o,b.c)&&b.v>=0);
  if(data.length<35)throw Error('확정 1분봉 '+data.length+'개 · 분석 자료 부족');
  history=data.slice(-120);historyAt=history.at(-1).t;
  if(!panel.hidden)render();
 }catch(err){
  if(!panel.hidden)$('aiTpStatus').textContent='차트 분석 조회 실패: '+String(err.message||err);
 }finally{busy=false;}
}
let lastMinute=-1;
function poll(){
 if(document.visibilityState==='hidden'||!active.length)return;
 const m=Math.floor((Date.now()-3000)/minutes)-1;
 if(m!==lastMinute){lastMinute=m;void fetchHistory();}
}
renderSummary();
setInterval(poll,2500);
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'){lastMinute=-1;poll()}});
})();