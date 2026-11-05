/* v66: Reuse original paper-v61 HISTORY card layout for real Binance BTCUSDT fills.
 * Read-only signed userTrades. No paper logs, fabricated total ROI, or order submission.
 */
(()=>{
'use strict';
const $=id=>document.getElementById(id);
const history=$('page-history'),log=$('log'),pending=$('manualPendingHistory');
const summary=$('paperPerformanceSummary'),closed=$('paperClosedTradeList'),refresh=$('paperStatsReset'),clear=$('clear');
if(!history||!log||!pending||!summary||!closed)return;
window.liveHistoryViewActive=true;
const autoPanel=document.getElementById('autoPaperToggle')?.closest('.auto-panel');
if(autoPanel){
 const observer=document.createElement('p');observer.className='muted';
 observer.style.cssText='position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap';
 observer.textContent='AUTO · 신호 관찰만 (실주문 OFF)';
 autoPanel.querySelector('.auto-panel-header')?.insertAdjacentElement('afterend',observer);
 document.addEventListener('btc:live-rmi-observed',e=>{
  const d=e.detail;if(d?.symbol!=='BTCUSDT'||!['LONG','SHORT'].includes(d.side))return;
  observer.textContent='RMI 신호 감지: '+d.side+' · '+new Date(d.barTime+60000).toLocaleTimeString('ko-KR')+
   ' · 실제 주문 미전송';
 });
}
const card=history.querySelector('.paper-history-card');
const title=card?.querySelector('summary span');
if(title)title.textContent='실전매매 거래내역';
const create=(name,text,cls)=>{const e=document.createElement(name);if(text!==undefined)e.textContent=String(text);if(cls)e.className=cls;return e};
const status=create('p','실제 바이낸스 BTCUSDT 체결 내역을 조회해 주세요. 모의매매 기록은 표시하지 않습니다.');
status.setAttribute('role','status');status.className='muted';
const get=create('button','실제 체결 내역 조회');get.type='button';
if(card){
 const box=card.querySelector('.paper-history-content');
 if(box)box.prepend(status,get);
}
if(refresh){refresh.textContent='새로고침';refresh.type='button'}
if(clear){clear.textContent='화면 기록 비우기';clear.type='button'}
const pattern=$('paperPatternDetails');if(pattern)pattern.hidden=true;
const style=create('style');style.textContent=`
.live-real-history-note{font-size:11px;color:#aec5dd;line-height:1.35;margin:4px 0}
.live-real-history-row{white-space:pre-line;line-height:1.6}
.live-real-history-row .pnl-positive{color:#4ed6a6}
.live-real-history-row .pnl-negative{color:#ff869b}
#page-history .live-real-closed{padding:0!important;overflow:hidden;display:block!important}
#page-history .live-real-closed>summary{display:grid;grid-template-columns:30px minmax(36px,.6fr) minmax(80px,1.3fr) auto;align-items:center;gap:7px;padding:10px 9px;cursor:pointer;list-style:none;min-height:42px}
#page-history .live-real-closed>summary::-webkit-details-marker{display:none}
#page-history .live-real-closed>summary::marker{content:''}
#page-history .live-real-closed[open]>summary{border-bottom:1px solid #31445f}
#page-history .live-real-closed .live-real-detail{padding:9px 11px 10px;margin:0;font-size:11px;line-height:1.5;white-space:pre-line;color:#a9bdd7}
#page-history .live-real-closed .paper-closed-amount{font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#page-history .live-real-closed .paper-closed-rate{font-size:11px;color:#8faac7;white-space:nowrap}
#page-history .live-real-history-note{font-size:10px}
`;document.head.append(style);
let sequence=0,busy=false,controller=null;
let lastTrades=null,realWallet=NaN;
const num=v=>v===null||v===undefined||v===''?NaN:Number(v);
const fmt=(v,d=4)=>Number.isFinite(v)?v.toLocaleString('ko-KR',{maximumFractionDigits:d}):'—';
const signed=v=>v>0?'+'+fmt(v):fmt(v);
const currentFx=()=>{const x=num($('fx')?.value);return Number.isFinite(x)&&x>0?x:NaN;};
const won=(v)=>{
 const rate=currentFx();if(!Number.isFinite(v)||!Number.isFinite(rate))return '원화 환산 불가';
 const krw=Math.round(v*rate);
 return (krw>0?'+':krw<0?'-':'')+Math.abs(krw).toLocaleString('ko-KR')+'원';
};
const feeWon=(v,asset)=>asset==='USDT'?won(-v).replace(/^-/, ''):
 (v>0?'수수료 '+fmt(v,6)+' '+asset+' (원화 미지원)':'0원');

const showError=message=>{status.textContent=message;status.style.color='#ff9aaa'};
function empty(heading){
 log.replaceChildren();log.textContent=heading||'실제 체결 내역 조회 전';
 pending.replaceChildren();pending.textContent='체결 조회 전';
 summary.replaceChildren();summary.textContent='손익 조회 전';
 closed.replaceChildren();closed.textContent='청산 조회 전';
}
function validateTrade(t){
 if(t?.symbol!=='BTCUSDT')return null;
 const price=num(t.price),qty=num(t.qty),pnl=num(t.realizedPnl),fee=num(t.commission),time=num(t.time);
 if(!(price>0&&qty>0&&Number.isFinite(pnl)&&fee>=0&&Number.isFinite(time)&&
  ['BUY','SELL'].includes(t.side)))return null;
 return {id:String(t.id??''),orderId:String(t.orderId??''),side:t.side,
  positionSide:String(t.positionSide||''),price,qty,pnl,fee,time,feeAsset:String(t.commissionAsset||'')};
}
async function trades(account,signal){
 const params=new URLSearchParams({symbol:'BTCUSDT',limit:'100',recvWindow:'5000',timestamp:String(Date.now())});
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(account.apiSecret),
  {name:'HMAC',hash:'SHA-256'},false,['sign']);
 const signature=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(params.toString()));
 params.set('signature',Array.from(new Uint8Array(signature),x=>x.toString(16).padStart(2,'0')).join(''));
 const response=await fetch('https://fapi.binance.com/fapi/v1/userTrades?'+params.toString(),
  {method:'GET',mode:'cors',cache:'no-store',credentials:'omit',redirect:'error',headers:{'X-MBX-APIKEY':account.apiKey},signal});
 if(!response.ok)throw Error('바이낸스 거래내역 조회 HTTP '+response.status);
 const json=await response.json();if(!Array.isArray(json))throw Error('바이낸스 체결 내역 응답 형식 오류');
 if(json.some(t=>t?.symbol!=='BTCUSDT'||!validateTrade(t)))
  throw Error('체결 데이터 일부를 확인할 수 없어 전체 손익 계산을 중단합니다.');
 return json.map(validateTrade).sort((a,b)=>a.time-b.time||Number(a.id)-Number(b.id));
}
function showRows(rows){
 lastTrades=rows;
 empty();
 const tradesDesc=create('div','최근 체결 최대 100건 · '+new Date().toLocaleTimeString('ko-KR'),'live-real-history-note');
 pending.replaceChildren(tradesDesc);
 log.replaceChildren();
 if(!rows.length){
  log.textContent='조회 범위 내 실제 BTCUSDT 체결 내역이 없어요.';
  summary.textContent='조회 범위 내 체결 없음 · 전체 누적 수익률은 계산되지 않음';
  closed.textContent='조회된 청산 체결 없음';return;
 }
 for(const t of [...rows].reverse()){
  const box=create('div',undefined,'trade-log-item live-real-history-row');
  const isUsdt=t.feeAsset==='USDT',net=t.pnl-(isUsdt?t.fee:0);
  const pnl=create('span',won(t.pnl));
  pnl.className=t.pnl>=0?'pnl-positive':'pnl-negative';
  box.append(create('span',new Date(t.time).toLocaleTimeString('ko-KR')+' · 실제 '+t.side+' '+
   fmt(t.qty,8)+' BTC @ '+fmt(t.price,2)+' USDT\n주문 #'+t.orderId+' · 실현손익 '),pnl,
   create('span',' · 수수료 '+(isUsdt?feeWon(t.fee,'USDT'):fmt(t.fee,6)+' '+t.feeAsset+' (원화 환산 제외)')+
    '\n수수료 차감 후 '+won(net)+(isUsdt?'':' · 기타 자산 수수료 별도')));
  log.append(box);
 }
 const pnlSum=rows.reduce((x,t)=>x+t.pnl,0);
 const usdtFees=rows.filter(t=>t.feeAsset==='USDT').reduce((x,t)=>x+t.fee,0);
 const otherFee=rows.some(t=>t.feeAsset!=='USDT'&&t.fee>0);
 const net=pnlSum-usdtFees;
 const candidates=rows.filter(t=>Math.abs(t.pnl)>1e-10);
 // Realized fills are not equivalent to fully closed round-trip positions.
 // Keep original section, but explicitly label this narrower evidence.
 const byOrder=new Map();
 for(const t of candidates){
  const id=t.orderId+'-'+t.positionSide+'-'+t.side;
  const entry=byOrder.get(id)||{id:t.orderId,side:t.side,positionSide:t.positionSide,
   time:t.time,qty:0,pnl:0,commission:0,otherCommission:false};
  entry.qty+=t.qty;entry.pnl+=t.pnl;entry.time=Math.max(entry.time,t.time);
  entry.commission+=t.feeAsset==='USDT'?t.fee:0;
  if(t.feeAsset!=='USDT'&&t.fee>0)entry.otherCommission=true;
  byOrder.set(id,entry);
 }
 const groups=[...byOrder.values()].sort((a,b)=>b.time-a.time);
 const success=groups.filter(t=>t.pnl-t.commission>0).length;
 const failure=groups.filter(t=>t.pnl-t.commission<0).length;
 summary.replaceChildren();
 const grid=create('div',undefined,'paper-performance-grid paper-performance-minimal');
 const roi=Number.isFinite(realWallet)&&realWallet>0?net/realWallet*100:NaN;
 const totalReturn=create('div');
 const rateLabel=Number.isFinite(roi)?(roi>=0?'+':'')+roi.toFixed(2)+'%':'—';
 const rateValue=create('strong',rateLabel);
 rateValue.className=Number.isFinite(roi)?(roi>=0?'paper-stat-profit':'paper-stat-loss'):'';
 totalReturn.append(create('small','조회 손익률'),rateValue);
 totalReturn.title='최근 최대 100체결 손익 ÷ 현재 지갑 잔고 · 전체 누적 수익률 아님';
 const totalGain=create('div'),netValue=create('strong',won(net)+(otherFee?'*':''));
 netValue.className=net>=0?'paper-stat-profit':'paper-stat-loss';
 totalGain.append(create('small','조회 순실현손익'),netValue);
 grid.append(totalReturn,totalGain);summary.append(grid);
 const count=create('div',undefined,'paper-performance-count');
 count.append(create('span','청산 체결 '+groups.length+'건 · '));
 const wins=create('span','수익 '+success+'건');wins.className='paper-stat-profit';
 const losses=create('span','손실 '+failure+'건');losses.className='paper-stat-loss';
 count.append(wins,create('span',' · '),losses);
 summary.append(count);
 const notice=create('p','최근 100체결 기준 · 수익률은 현재 잔고 대비 참고값','live-real-history-note');
 notice.title='전체 누적 수익률이 아니며, USDT 수수료만 차감. 펀딩비·기타 자산 수수료 제외'+(otherFee?' (기타 수수료 있음)':'');
 summary.append(notice);
 closed.replaceChildren();
 if(!groups.length)closed.textContent='조회 범위 내 실현손익이 확인된 청산 체결이 없어요.';
 for(const entry of groups){
  const netResult=entry.pnl-entry.commission;
  const isLong=entry.positionSide==='LONG'||entry.positionSide==='BOTH'&&entry.side==='SELL';
  const direction=entry.positionSide==='LONG'?'롱':entry.positionSide==='SHORT'?'숏':isLong?'롱':'숏';
  // Do not invent a per-trade ROI without knowing the original entry margin.
  const node=create('details',undefined,'paper-closed-item paper-closed-compact live-real-closed');
  const header=create('summary');
  const side=create('b',direction,'paper-closed-side '+(direction==='롱'?'hedge-long-text':'hedge-short-text'));
  const rate=create('span','체결','paper-closed-rate');
  const amount=create('span',won(netResult),'paper-closed-amount '+(netResult>=0?'paper-stat-profit':'paper-stat-loss'));
  const time=create('small',new Date(entry.time).toLocaleString('ko-KR',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}),'paper-closed-time');
  header.append(side,rate,amount,time);
  const detail=create('div',undefined,'live-real-detail');
  detail.textContent='주문 #'+entry.id+' · '+fmt(entry.qty,8)+' BTC\n실현손익 '+won(entry.pnl)+
   ' · 수수료 '+feeWon(entry.commission,'USDT')+
   '\n수수료 차감 후 '+won(netResult)+(entry.otherCommission?'\n기타 자산 수수료 별도':'');
  node.append(header,detail);closed.append(node);
 }
}
async function run(){
 if(busy||document.hidden)return;
 const account=typeof getApiCredentials==='function'?getApiCredentials():null;
 if(!account?.apiKey||!account?.apiSecret){
  showError('설정에서 실제 바이낸스 API 키 잠금을 해제해 주세요. 가상 거래 기록은 표시하지 않습니다.');return;
 }
 busy=true;get.disabled=true;if(refresh)refresh.disabled=true;
 const token=++sequence;
 controller?.abort();controller=new AbortController();
 const timeout=setTimeout(()=>controller.abort(),11000);
 status.style.color='';status.textContent='바이낸스 실제 거래 체결 내역 읽는 중…';
 try{
  const list=await trades(account,controller.signal);
  if(token!==sequence||document.hidden)return;
  showRows(list);status.textContent='바이낸스 실제 체결 '+list.length+'건 조회 완료 · '+new Date().toLocaleTimeString('ko-KR');
 }catch(e){
  if(token!==sequence||document.hidden)return;
  empty('조회 실패 · 가상 기록으로 대체하지 않습니다.');
  showError('실제 내역 조회 실패: '+String(e?.message||'브라우저 네트워크/CORS 제한')+
   ' · 연결·권한을 확인해 주세요.');
 }finally{
  clearTimeout(timeout);busy=false;get.disabled=false;if(refresh)refresh.disabled=false;
 }
}
get.onclick=()=>run();
if(refresh)refresh.onclick=()=>run();
if(clear)clear.onclick=()=>{sequence++;controller?.abort();empty('화면에서만 비웠습니다. 실제 거래소 기록은 삭제되지 않습니다.');status.textContent='화면 기록 초기화 · 실제 거래소 데이터는 그대로예요.'};
const reset=()=>{sequence++;controller?.abort();empty('API 잠금 또는 화면 비활성화 · 다시 조회해 주세요.');status.textContent='실제 거래내역 재조회 필요'};
document.addEventListener('btc:real-account-cleared',reset);
document.addEventListener('btc:real-account-updated',e=>{
 const wallet=num(e.detail?.wallet);
 if(Number.isFinite(wallet)&&wallet>0&&wallet!==realWallet){
  realWallet=wallet;
  if(lastTrades)showRows(lastTrades);
 }
});
$('fx')?.addEventListener('input',()=>{if(lastTrades)showRows(lastTrades)});

// Retain last fetched fills on brief app switches; resume refreshes on return.
// Do not erase the visible last-read history merely because iOS suspends the page.
empty();
})();
