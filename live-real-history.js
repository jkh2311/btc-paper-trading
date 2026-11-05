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
const card=history.querySelector('.paper-history-card');
const title=card?.querySelector('summary span');
if(title)title.textContent='실전매매 거래내역';
const create=(name,text)=>{const e=document.createElement(name);if(text!==undefined)e.textContent=String(text);return e};
const status=create('p','실제 바이낸스 BTCUSDT 체결 내역을 조회해 주세요. 모의매매 기록은 표시하지 않습니다.');
status.setAttribute('role','status');status.className='muted';
const get=create('button','실제 체결 내역 조회');get.type='button';
if(card){
 const box=card.querySelector('.paper-history-content');
 if(box)box.prepend(status,get);
}
if(refresh){refresh.textContent='실제 내역 새로고침';refresh.type='button'}
if(clear){clear.textContent='화면 기록 비우기';clear.type='button'}
const pattern=$('paperPatternDetails');if(pattern)pattern.hidden=true;
const style=create('style');style.textContent='.live-real-history-note{font-size:11px;color:#aec5dd;line-height:1.6;margin:10px 0}.live-real-history-row{white-space:pre-line;line-height:1.6}.live-real-history-row .pnl-positive{color:#4ed6a6}.live-real-history-row .pnl-negative{color:#ff869b}';document.head.append(style);
let sequence=0,busy=false,controller=null;
const num=v=>v===null||v===undefined||v===''?NaN:Number(v);
const fmt=(v,d=4)=>Number.isFinite(v)?v.toLocaleString('ko-KR',{maximumFractionDigits:d}):'—';
const signed=v=>v>0?'+'+fmt(v):fmt(v);
const showError=message=>{status.textContent=message;status.style.color='#ff9aaa'};
function empty(heading){
 log.replaceChildren();log.textContent=heading||'실제 체결 내역 조회 전';
 pending.replaceChildren();pending.textContent='실제 거래소 체결 조회 전';
 summary.replaceChildren();summary.textContent='실제 계좌 수익 정보 조회 전';
 closed.replaceChildren();closed.textContent='실제 청산 체결 조회 전';
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
 empty();
 const tradesDesc=create('div',undefined,'live-real-history-note');
 tradesDesc.textContent='실제 BTCUSDT 최근 최대 100건 체결 · 거래소 조회 시점 '+new Date().toLocaleTimeString('ko-KR')+
  ' · 전체 거래 기간을 포함하지 않을 수 있습니다.';
 pending.replaceChildren(tradesDesc);
 log.replaceChildren();
 if(!rows.length){
  log.textContent='조회 범위 내 실제 BTCUSDT 체결 내역이 없어요.';
  summary.textContent='조회 범위 내 체결 없음 · 전체 누적 수익률은 계산되지 않음';
  closed.textContent='조회된 청산 체결 없음';return;
 }
 for(const t of [...rows].reverse()){
  const box=create('div',undefined,'trade-log-item live-real-history-row');
  const pnl=create('span',(t.pnl>0?'+':'')+fmt(t.pnl,4)+' USDT');
  pnl.className=t.pnl>=0?'pnl-positive':'pnl-negative';
  box.append(create('span',new Date(t.time).toLocaleTimeString('ko-KR')+' · 실제 '+t.side+' '+
   fmt(t.qty,8)+' BTC @ '+fmt(t.price,2)+' USDT\n주문 #'+t.orderId+' · 실현손익 '),pnl,
   create('span',' · 수수료 '+fmt(t.fee,6)+' '+t.feeAsset));
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
   time:t.time,qty:0,pnl:0,commission:0};
  entry.qty+=t.qty;entry.pnl+=t.pnl;entry.time=Math.max(entry.time,t.time);
  entry.commission+=t.feeAsset==='USDT'?t.fee:0;
  byOrder.set(id,entry);
 }
 const groups=[...byOrder.values()].sort((a,b)=>b.time-a.time);
 const success=groups.filter(t=>t.pnl-t.commission>0).length;
 const failure=groups.filter(t=>t.pnl-t.commission<0).length;
 summary.replaceChildren();
 const grid=create('div',undefined,'paper-performance-grid paper-performance-minimal');
 const totalReturn=create('div');totalReturn.append(create('small','총 수익률'),
  create('strong','— (기준 계좌자산 미확인)'));
 const totalGain=create('div');totalGain.append(create('small','조회 범위 실현손익 (USDT)'),
  create('strong',signed(net)+(otherFee?'*':'')));
 totalGain.querySelector('strong').className=net>=0?'paper-stat-profit':'paper-stat-loss';
 grid.append(totalReturn,totalGain);summary.append(grid);
 summary.append(create('div','실현손익이 확인된 청산 체결 그룹 '+groups.length+'건 · 수익 '+success+
  '건 · 손실 '+failure+'건','paper-performance-count'));
 summary.append(create('p','※ 최근 최대 100체결 기준 · USDT 수수료 차감, 펀딩비·기타 자산 수수료는 제외'+
  (otherFee?'(*)':'')+'. 전체 계좌 누적 수익률이나 포지션 완전 청산 건수로 볼 수 없습니다.','live-real-history-note'));
 closed.replaceChildren();
 if(!groups.length)closed.textContent='조회 범위 내 실현손익이 확인된 청산 체결이 없어요.';
 for(const entry of groups){
  const node=create('div',undefined,'paper-closed-item');
  const heading=create('div',undefined,'paper-closed-head');
  const name=create('b',(entry.positionSide==='LONG'?'롱':entry.positionSide==='SHORT'?'숏':entry.side)+
   ' 청산 체결 · 주문 #'+entry.id);
  heading.append(name,create('span',new Date(entry.time).toLocaleString('ko-KR')));
  const pnl=entry.pnl-entry.commission;
  node.append(heading,create('div','체결 수량 '+fmt(entry.qty,8)+' BTC · 실현손익 '+signed(pnl)+' USDT'+
   ' (USDT 수수료 반영)','live-real-history-note'));
  closed.append(node);
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
get.onclick=()=>void run();
if(refresh)refresh.onclick=()=>void run();
if(clear)clear.onclick=()=>{sequence++;controller?.abort();empty('화면에서만 비웠습니다. 실제 거래소 기록은 삭제되지 않습니다.');status.textContent='화면 기록 초기화 · 실제 거래소 데이터는 그대로예요.'};
const reset=()=>{sequence++;controller?.abort();empty('API 잠금 또는 화면 비활성화 · 다시 조회해 주세요.');status.textContent='실제 거래내역 재조회 필요'};
document.addEventListener('visibilitychange',()=>{if(document.hidden)reset()});
window.addEventListener('pagehide',reset);
empty();
})();
