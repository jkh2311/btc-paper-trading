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
const fx=()=>{const rate=Number(document.getElementById('fx')?.value);return rate>0?rate:NaN};
const won=amount=>{
 if(!Number.isFinite(amount)||!Number.isFinite(fx()))return '원화 환산 불가';
 const krw=Math.round(amount*fx());
 return (krw>0?'+':krw<0?'-':'')+Math.abs(krw).toLocaleString('ko-KR')+'원';
};
function roi(p){
 const lev=Number.isFinite(p.leverage)&&p.leverage>0?p.leverage:NaN;
 const notional=Number.isFinite(p.entry)&&p.entry>0?Math.abs(p.amount)*p.entry:NaN;
 const margin=Number.isFinite(p.margin)&&p.margin>0?p.margin:notional/lev;
 return margin>0&&Number.isFinite(p.unrealized)?p.unrealized/margin*100:NaN;
}
function roiLabel(p){
 const n=roi(p);
 return Number.isFinite(n)?'수익률 '+(n>=0?'+':'')+n.toFixed(2)+'% · ':'수익률 확인 중 · ';
}
function renderActualBalanceStrip(){
 const balance=document.getElementById('balanceSummary'),pnl=document.getElementById('pnlSummary');
 if(!balance||!pnl)return;
 const available=snapshot?.available,positionPnl=snapshot?.positions.reduce((sum,p)=>sum+(Number.isFinite(p.unrealized)?p.unrealized:0),0);
 balance.textContent=Number.isFinite(available)?fmt(available,3)+' USDT':'—';
 pnl.textContent=snapshot?won(positionPnl):'—';
 pnl.classList.toggle('pnl-positive',!!snapshot&&positionPnl>0);
 pnl.classList.toggle('pnl-negative',!!snapshot&&positionPnl<0);
}
window.renderActualBalanceStrip=renderActualBalanceStrip;
document.getElementById('fx')?.addEventListener('input',()=>{render();renderActualBalanceStrip();});

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
'body.real-position-ready #paperPositionCard .real-position-row:focus-visible{outline:2px solid #7ca9d3}',
'body.real-position-ready #paperPositionCard .real-position-row .hedge-position-head{display:flex;align-items:center;gap:8px}',
'body.real-position-ready #paperPositionCard .real-position-row .real-close-single{margin-left:auto;padding:8px 10px;min-height:34px;font-size:12px;white-space:nowrap}',
'body.real-position-ready #paperPositionCard .real-position-row .real-switch-detail{background:linear-gradient(120deg,#ffb020,#ff6b31)!important;color:#101c2b!important;border:2px solid #ffd37a!important;box-shadow:0 0 0 2px rgba(255,162,44,.12),0 4px 14px rgba(255,107,49,.32);font-weight:850!important}',
'.real-switch-choice-actions button:nth-child(2){background:linear-gradient(120deg,#ffb020,#ff6b31)!important;color:#101c2b!important;border:2px solid #ffd37a!important;font-weight:850}',
'body.real-position-ready #paperPositionCard .real-switch-detail{margin-top:13px;width:100%;padding:12px 9px;font-size:13px;font-weight:700;background:#234d72;border-color:#5886b2}',
'.real-switch-choice{position:fixed;inset:0;background:#000b;z-index:100000;display:flex;align-items:center;justify-content:center;padding:15px}',
'.real-switch-choice[hidden]{display:none!important}',
'.real-switch-choice-dialog{width:min(440px,100%);padding:18px;background:#14243e;border:1px solid #536f90;border-radius:16px;box-shadow:0 15px 60px #000a;color:#e7edf8}',
'.real-switch-choice-dialog h3{font-size:18px;margin:0 0 10px}',
'.real-switch-choice-dialog p{font-size:12px;color:#b8cce3;line-height:1.6}',
'.real-switch-choice-dialog label{display:block;font-size:12px;margin:10px 0 4px}',
'.real-switch-choice-dialog input{width:100%}',
'.real-switch-choice-actions{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:12px 0 8px}',
'.real-switch-choice-actions button{padding:11px 4px;font-size:12px;white-space:normal}',
'.real-switch-choice-cancel{width:100%;font-size:12px}',
'body.real-position-ready #paperPositionCard .real-position-row .hedge-pnl{font-weight:700}',
'body.real-position-ready #paperPositionCard .real-tpsl-pnl{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px;margin-top:12px}',
'body.real-position-ready #paperPositionCard .real-tpsl-pnl>div{border:1px solid #34516e;border-radius:11px;background:#0b1d33;padding:11px 9px;min-width:0}',
'body.real-position-ready #paperPositionCard .real-tpsl-pnl small{display:block;font-size:11px;color:#b7cbe2;margin-bottom:7px}',
'body.real-position-ready #paperPositionCard .real-tpsl-pnl strong{font-size:17px;font-variant-numeric:tabular-nums;white-space:nowrap}',
'body.real-position-ready #paperPositionCard .real-tpsl-pnl .tp strong{color:#4ed6a6}',
'body.real-position-ready #paperPositionCard .real-tpsl-pnl .sl strong{color:#ff869b}',
'body.real-position-ready #paperPositionCard .real-tpsl-pnl .estimate-meta{font-size:10px;line-height:1.45;color:#a0b9d2;margin-top:4px}',
'body.real-position-ready #paperPositionCard .real-tpsl-disclaimer{font-size:10px;color:#9fb4cc;margin:7px 2px 0}'
].join('\n');
document.head.append(style);

function positionPayload(p,side){
 return {side,positionSide:p.side,amount:p.amount,entry:p.entry,mark:p.mark,
  leverage:p.leverage,unrealized:p.unrealized,selectedAt:Date.now(),accountAt:snapshot?.at||0};
}
// The existing LIVE switch engine handles Binance writes; this view only requests actions.
function closeChoice(p,side){
 const payload=positionPayload(p,side),old=document.getElementById('realSwitchChoice');
 if(old)old.remove();
 const overlay=make('div',undefined,'real-switch-choice');
 overlay.id='realSwitchChoice';
 const dialog=make('div',undefined,'real-switch-choice-dialog');
 dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');
 const title=make('h3',side==='SHORT'?'숏 SHORT 포지션 청산 / 롱 전환':'롱 LONG 포지션 청산 / 숏 전환');
 const desc=make('p',fmt(Math.abs(p.amount),8)+' BTC 보유 · 실제 바이낸스 포지션입니다.');
 const label=make('label','스위칭 후 신규 진입 수량 (BTC)');
 const qty=make('input');qty.type='number';qty.min='0.000001';qty.step='0.000001';
 qty.inputMode='decimal';qty.value=String(Math.abs(p.amount));label.append(qty);
 const warning=make('p','청산만: 기존 시장가 청산 기능 그대로 사용. 청산 및 스위칭: 기존 포지션 전량 청산 확인 후 반대 방향으로 시장가 신규 진입. 기존 보호주문 취소 가능, 신규 포지션의 손절·익절은 별도로 설정해야 합니다.');
 const actions=make('div',undefined,'real-switch-choice-actions');
 const closeOnly=make('button','청산만 하기');closeOnly.type='button';
 const switchNow=make('button','청산 및 스위칭 전환');switchNow.type='button';
 switchNow.style.cssText='background:#175a50;border-color:#40af8b';
 const cancel=make('button','취소','real-switch-choice-cancel');cancel.type='button';
 const error=make('p');error.setAttribute('role','status');
 function dismiss(){overlay.remove()}
 cancel.onclick=dismiss;overlay.onclick=e=>{if(e.target===overlay)dismiss()};
 closeOnly.onclick=()=>{
  dismiss();document.dispatchEvent(new CustomEvent('btc:real-position-selected',{detail:payload}));
  document.dispatchEvent(new CustomEvent('btc:real-close-requested',{detail:payload}));
 };
 switchNow.onclick=async()=>{
  const n=Number(qty.value);
  if(!(Number.isFinite(n)&&n>0)){error.textContent='신규 BTC 수량을 입력해 주세요.';return}
  if(typeof window.btcSwitchNow!=='function'){
   error.textContent='실전 스위칭 모듈을 불러오지 못했어요. 주문은 실행되지 않았습니다.';return;
  }
  dismiss();await window.btcSwitchNow(payload,n);
 };
 actions.append(closeOnly,switchNow);
 dialog.append(title,desc,label,warning,actions,cancel,error);overlay.append(dialog);
 document.body.append(overlay);qty.focus();
}

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
   const name=make('b',(isLong?'롱 LONG':'숏 SHORT')+' #'+(i+1),colour+'-text');
   const closeOne=make('button','개별 청산','real-close-single');
   closeOne.type='button';
   closeOne.onclick=e=>{
    e.preventDefault();e.stopPropagation();
    selection=side;
    document.dispatchEvent(new CustomEvent('btc:real-position-selected',{detail:positionPayload(p,side)}));
    closeChoice(p,side);
   };
   head.append(name,make('small',fmt(Math.abs(p.amount),8)+' BTC'),closeOne);
   const est=Number.isFinite(p.margin)?fmt(p.margin,3)+' USDT':'—';
   const entry=make('div','진입가 '+fmt(p.entry,2)+' USDT · 증거금 '+est,'real-position-meta');
   const pnl=make('div',roiLabel(p)+won(p.unrealized),'hedge-pnl');
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
 else{
  // Reuse the original v61 paper-position compact grid and result panel.
  const summary=make('div',undefined,'position-summary paper-detail-compact');
  const grid=make('div',undefined,'position-grid');
  const value=(label,display)=>{
   const cell=make('div',undefined,'position-stat');
   cell.append(make('small',label),make('strong',display));
   return cell;
  };
  const size=Math.abs(p.amount);
  const margin=Number.isFinite(p.margin)&&p.margin>0?p.margin:
   p.entry>0&&p.leverage>0?size*p.entry/p.leverage:NaN;
  grid.append(
   value('보유 수량',fmt(size,8)+' BTC'),
   value('평균 진입가',fmt(p.entry,2)+' USDT'),
   value('마크 가격',fmt(p.mark,2)+' USDT'),
   value('레버리지',p.leverage>0?fmt(p.leverage,0)+'배':'조회 실패'),
   value('증거금',Number.isFinite(margin)?fmt(margin,3)+' USDT':'—'),
   value('추정 청산가',p.liquidation>0?fmt(p.liquidation,2)+' USDT':'—')
  );
  const result=make('div',undefined,'paper-tp-result');
  result.append(make('strong','현재 미실현 손익'));
  const total=make('b',roiLabel(p)+won(p.unrealized),p.unrealized>=0?'paper-stat-profit':'paper-stat-loss');
  result.append(total);
  summary.append(grid,result);
  // Only exchange-confirmed TP/SL orders are shown, not unregistered chart preview levels.
  const protection=window.btcRealProtectionSnapshot?.(p)||{fresh:false,tp:null,sl:null};
  const tpsl=make('div',undefined,'real-tpsl-pnl');
  const expected=(kind,price)=>{
   const isTp=kind==='tp';
   const box=make('div',undefined,isTp?'tp':'sl');
   box.append(make('small',isTp?'익절 시 예상 손익':'손절 시 예상 손익'));
   const valid=protection.fresh&&Number.isFinite(price)&&price>0&&p.entry>0&&size>0;
   const signedSize=selection==='LONG'?size:-size;
   const gross=valid?(price-p.entry)*signedSize:NaN;
   const amt=make('strong',valid?won(gross):'—');
   box.append(amt);
   const pct=valid&&margin>0?gross/margin*100:NaN;
   box.append(make('div',valid?fmt(price,2)+' USDT · '+(pct>=0?'+':'')+pct.toFixed(2)+'%':
    protection.fresh?'거래소 주문 미등록':'보호 주문 확인 중','estimate-meta'));
   return box;
  };
  tpsl.append(expected('tp',protection.tp),expected('sl',protection.sl));
  summary.append(tpsl,make('div','실제 등록된 TP/SL 기준 예상 금액 · 체결가 변동 및 수수료·펀딩비 제외','real-tpsl-disclaimer'));
  detail.append(summary);
  const switchButton=make('button',selection==='SHORT'?'↔ 롱 스위칭 설정':'↔ 숏 스위칭 설정','real-switch-detail');
  switchButton.type='button';
  switchButton.onclick=()=>{
   if(typeof window.btcOpenSwitch!=='function'){alert('스위칭 설정 모듈을 불러오지 못했습니다.');return}
   window.btcOpenSwitch(positionPayload(p,selection));
  };
  detail.append(switchButton);
 }
 root.append(detail);
 message.textContent=snapshot?'실계좌 조회 '+new Date(snapshot.at).toLocaleTimeString('ko-KR'):
  '실계좌 조회 전';
 renderActualBalanceStrip();
}
document.addEventListener('btc:real-protection-updated',()=>{if(snapshot&&selection)render();});
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