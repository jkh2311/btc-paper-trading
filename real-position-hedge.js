/* v63: Reuse v61 LONG/SHORT hedge layout for REAL BTCUSDT positions.
 * All displayed values originate from successful Binance account.status reads.
 * NO order placement, closing, cancellation, or paper-position substitution.
 */
(()=>{
'use strict';
const root=document.getElementById('position');
const card=document.getElementById('paperPositionCard');
if(!root||!card)return;
const make=(tag,text,cls)=>{
 const el=document.createElement(tag);
 if(text!==undefined)el.textContent=String(text);
 if(cls)el.className=cls;
 return el;
};
const number=v=>v===null||v===undefined||v===''?NaN:Number(v);
const fmt=(v,d=4)=>Number.isFinite(v)?v.toLocaleString('ko-KR',{maximumFractionDigits:d}):'—';
const cleanSide=p=>p.side==='LONG'?'LONG':p.side==='SHORT'?'SHORT':
 p.side==='BOTH'?(p.amount>0?'LONG':p.amount<0?'SHORT':null):null;
let snapshot=null,selection=null;
const controls=make('div',undefined,'real-hedge-controls');
const refresh=make('button','실제 계좌 새로고침');
const manage=make('button','API 키 관리');
const message=make('div','실계좌 조회 전','muted');
refresh.type=manage.type='button';
refresh.onclick=()=>document.getElementById('realAccountRefresh')?.click();
manage.onclick=()=>document.getElementById('realAccountManage')?.click();
controls.append(refresh,manage);
card.insertBefore(controls,root);
card.insertBefore(message,root);
const style=make('style');
style.textContent=[
'body.real-position-ready #paperPositionCard .real-hedge-controls{display:flex;gap:8px;margin:8px 0}',
'body.real-position-ready #paperPositionCard .real-hedge-controls button{flex:1;padding:10px;font-size:12px}',
'body.real-position-ready #paperPositionCard .real-hedge-controls+.muted{font-size:11px;margin:8px 0}',
'body.real-position-ready #paperPositionCard .real-position-detail{padding:10px 0;color:#b7cbe3;font-size:12px;line-height:1.8;white-space:pre-line}',
'body.real-position-ready #paperPositionCard .real-position-row .hedge-select-button{font-size:13px}',
'body.real-position-ready #paperPositionCard .hedge-side-group{margin-top:12px}',
'body.real-position-ready #paperPositionCard .real-position-meta{font-size:12px;color:#b4c5dc;line-height:1.8}',
'body.real-position-ready #paperPositionCard .hedge-selected-detail{border-top:1px solid #324965;padding-top:12px;margin-top:12px}',
'body.real-position-ready #paperPositionCard .real-position-row{cursor:pointer}',
'body.real-position-ready #paperPositionCard .real-position-row:focus-visible{outline:2px solid #7ca9d3}'
].join('\n');
document.head.append(style);
function normalize(details){
 if(!details||!Array.isArray(details.positions)||!Number.isFinite(details.at))return null;
 const wallet=number(details.wallet),available=number(details.available);
 const margin=number(details.margin);
 const positions=details.positions.map(p=>({
  side:p.side,amount:number(p.amount),entry:number(p.entry),mark:number(p.mark),
  unrealized:number(p.unrealized),leverage:number(p.leverage),
  liquidation:number(p.liquidation),margin:number(p.margin)
 })).filter(p=>cleanSide(p)&&Number.isFinite(p.amount)&&Math.abs(p.amount)>1e-12);
 return {at:details.at,wallet,available,margin,positions};
}
function render(){
 root.replaceChildren();
 const label=document.getElementById('hedgeModeLabel');
 if(!snapshot){
  if(label)label.textContent='· 실제 계좌 조회 전';
  root.append(make('div','사용 중인 증거금 — USDT · 추가 사용 가능 — USDT','hedge-margin-summary'));
 }else{
  const used=Number.isFinite(snapshot.margin)?snapshot.margin:
   snapshot.positions.every(p=>Number.isFinite(p.margin))?
    snapshot.positions.reduce((sum,p)=>sum+p.margin,0):NaN;
  root.append(make('div','사용 중인 증거금 '+fmt(used,3)+' USDT · 추가 사용 가능 '+fmt(snapshot.available,3)+' USDT','hedge-margin-summary'));
  const hedge=snapshot.positions.some(p=>p.side==='LONG'||p.side==='SHORT');
  if(label)label.textContent=!snapshot.positions.length?'· 포지션 모드는 설정에서 확인':
   hedge?'· 다중 헤지 모드':'· 단방향 모드';
 }
 for(const side of ['LONG','SHORT']){
  const isLong=side==='LONG',colour=isLong?'hedge-long':'hedge-short';
  const members=snapshot?snapshot.positions.filter(p=>cleanSide(p)===side):[];
  const section=make('section',undefined,'hedge-side-group '+colour+'-group');
  const header=make('div',undefined,'hedge-group-header');
  header.append(make('strong',(isLong?'롱 LONG':'숏 SHORT'),colour+'-text'),
   make('span',snapshot?members.length+'개 보유':'조회 전'));
  section.append(header);
  if(!members.length)section.append(make('div',snapshot?'보유 중인 '+(isLong?'롱':'숏')+' 포지션이 없어요.':'실제 계좌 조회 후 표시돼요.','hedge-group-empty'));
  else members.forEach((p,i)=>{
   const row=make('article',undefined,'hedge-position-block '+colour+'-card real-position-row'+(selection===side?' active':''));
   row.tabIndex=0;row.setAttribute('role','button');
   row.setAttribute('aria-label',(isLong?'롱':'숏')+' 포지션 선택');
   row.setAttribute('aria-pressed',String(selection===side));
   const head=make('div',undefined,'hedge-position-head');
   head.append(make('b',(isLong?'롱 LONG':'숏 SHORT')+' #'+(i+1),colour+'-text'),
    make('small',fmt(Math.abs(p.amount),8)+' BTC'));
   const est=Number.isFinite(p.margin)?fmt(p.margin,3)+' USDT':'—';
   const entry=make('div','진입가 '+fmt(p.entry,2)+' USDT · 증거금 '+est,'real-position-meta');
   const pnl=make('div','미실현 손익 '+fmt(p.unrealized,4)+' USDT'+
    (Number.isFinite(p.leverage)?' · '+fmt(p.leverage,0)+'배':''),'hedge-pnl');
   pnl.classList.add(p.unrealized>=0?'pnl-positive':'pnl-negative');
   row.append(head,entry,pnl);
   row.onclick=()=>{
    selection=side;render();
    document.dispatchEvent(new CustomEvent('btc:real-position-selected',{detail:{
      side,positionSide:p.side,amount:p.amount,entry:p.entry,mark:p.mark,
      leverage:p.leverage,unrealized:p.unrealized,selectedAt:Date.now(),
      accountAt:snapshot?.at||0
    }}));
   };
   row.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();row.click()}};
   section.append(row);
  });
  root.append(section);
 }
 const detail=make('div',undefined,'hedge-selected-detail');
 const p=snapshot?.positions.find(p=>cleanSide(p)===selection);
 detail.append(make('b','선택한 포지션 상세 · '+(p?(selection==='LONG'?'롱 LONG':'숏 SHORT'):'선택 없음')));
 if(!p)detail.append(make('p','포지션 선택','muted'));
 else detail.append(make('div',[
  '보유 수량 '+fmt(Math.abs(p.amount),8)+' BTC',
  '평균 진입가 '+fmt(p.entry,2)+' USDT',
  '마크 가격 '+fmt(p.mark,2)+' USDT',
  '레버리지 '+fmt(p.leverage,0)+'배',
  '미실현 손익 '+fmt(p.unrealized,4)+' USDT',
  '추정 청산가 '+(p.liquidation>0?fmt(p.liquidation,2)+' USDT':'—')
 ].join('\n'),'real-position-detail'));
 root.append(detail);
 message.textContent=snapshot?'실계좌 조회 '+new Date(snapshot.at).toLocaleTimeString('ko-KR'):
  '실계좌 조회 전';
}
document.addEventListener('btc:real-account-updated',e=>{
 const next=normalize(e.detail);
 if(!next)return;
 snapshot=next;
 if(!snapshot.positions.some(p=>cleanSide(p)===selection))selection=null;
 render();
});
document.addEventListener('btc:real-account-cleared',e=>{
 snapshot=null;selection=null;render();
 document.dispatchEvent(new CustomEvent('btc:real-position-selected',{detail:null}));
 const note=e.detail?.message;
 if(note)message.textContent=String(note).slice(0,160)+'';
});
// Keep last verified snapshot while iOS temporarily suspends this PWA; timestamps remain visible.
// A genuine page reload naturally discards in-memory account details.
window.renderActualHedgePosition=render;
document.body.classList.add('real-position-ready');
render();
})();