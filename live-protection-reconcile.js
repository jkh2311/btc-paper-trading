/* Live BTCUSDT reconciliation, read-only and fail closed.
 * Requires independently refreshed account and conditional order snapshots.
 * A matching algo order is a CANDIDATE, never proof of effective stop protection.
 * No order creation/cancellation, no keys or account snapshots in persistent storage.
 */
(()=>{
'use strict';
const positionPage=document.getElementById('page-position');
const historyPage=document.getElementById('page-history');
if(!positionPage||!historyPage)return;
const make=(tag,text)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=String(text);return el};
const box=make('section');box.className='direct-live';
const heading=make('h2','실제 포지션 ↔ 손절·익절 대조');
const desc=make('p','포지션·조건부 주문을 각각 다시 조회한 뒤 비교합니다. 손절/익절 주문 존재만으로 보호가 확정되지는 않습니다.');
const verify=make('button','보호 주문 대조');
verify.type='button';
const alert=make('p','계좌와 미체결 주문을 먼저 조회해 주세요.');alert.setAttribute('role','status');
const details=make('div');
box.append(heading,desc,verify,alert,details);
const existing=positionPage.querySelector('.direct-live');
if(existing)existing.insertAdjacentElement('afterend',box);else positionPage.prepend(box);
const fillsCard=make('section');fillsCard.className='direct-live';
const fillsTitle=make('h2','실제 BTCUSDT 체결 내역 · 최근 50건');
const fillsInfo=make('p','마지막으로 조회한 실제 거래소 기록입니다. 주문의 NEW/미체결 상태와 실제 체결 내역은 별개입니다.');
const fillsRefresh=make('button','최근 체결 불러오기');fillsRefresh.type='button';
const fillsState=make('p','비밀번호로 API 잠금 해제 후 조회하세요.');fillsState.setAttribute('role','status');
const fillsList=make('div');
fillsCard.append(fillsTitle,fillsInfo,fillsRefresh,fillsState,fillsList);
historyPage.prepend(fillsCard);
const style=make('style');
style.textContent='.direct-live .recon-item{border:1px solid #465d79;background:#09192e;border-radius:9px;padding:10px;margin:8px 0;font-size:12px;line-height:1.65;white-space:pre-line}.direct-live .recon-warning{color:#ffd296}.direct-live .recon-fail{color:#ff99aa}.direct-live .recon-neutral{color:#a8c8e9}';
document.head.append(style);
let account=null,orders=null,epoch=0,inflight=false;
let fillsBusy=false,fillController=null,fillEpoch=0;
const MAX_AGE=60000;
const safeNum=v=>v===undefined||v===null||v===''?NaN:Number(v);
const display=(v,d=6)=>Number.isFinite(v)?v.toLocaleString('ko-KR',{maximumFractionDigits:d}):'—';
const validSnap=s=>s&&Number.isFinite(s.at)&&Date.now()-s.at<=MAX_AGE;
function reset(message){
 epoch++;account=null;orders=null;details.replaceChildren();
 alert.className='recon-fail';alert.textContent=message||'보안 잠금/화면 전환 · 계좌·주문 정보 다시 조회 필요';
}
document.addEventListener('btc:live-account-read',e=>{
 const x=e.detail;
 if(!Array.isArray(x?.positions)||!Number.isFinite(safeNum(x?.account?.availableBalance)))return;
 account={at:Date.now(),positions:x.positions.filter(p=>['LONG','SHORT','BOTH'].includes(p.positionSide)).map(p=>({
  positionSide:p.positionSide,amount:safeNum(p.positionAmt)
 }))};
 details.replaceChildren();alert.className='recon-neutral';
 alert.textContent='실제 계좌 조회됨 · 미체결(조건부) 주문도 갱신한 뒤 대조해 주세요.';
});
document.addEventListener('btc:open-order-snapshot',e=>{
 const x=e.detail;
 if(!Array.isArray(x?.algoOrders)||!Number.isFinite(x.receivedAt))return;
 orders={at:x.receivedAt,algo:x.algoOrders.map(o=>({
  id:String(o.algoId??''),side:o.side,positionSide:o.positionSide,
  type:String(o.type||''),status:String(o.algoStatus||''),
  trigger:safeNum(o.triggerPrice),quantity:safeNum(o.quantity),
  closePosition:o.closePosition===true||o.closePosition==='true',
  reduceOnly:o.reduceOnly===true||o.reduceOnly==='true'
 }))};
 details.replaceChildren();alert.className='recon-neutral';
 alert.textContent='실제 조건부 주문 목록 조회됨 · 보호 주문 대조 버튼을 눌러 주세요.';
});
function positionSide(p){
 if(p.positionSide!=='BOTH')return p.positionSide;
 return p.amount>0?'LONG':'SHORT';
}
function reconcile(){
 details.replaceChildren();
 if(!validSnap(account)||!validSnap(orders)){
  alert.className='recon-fail';
  alert.textContent='검증 중단: 실제 포지션과 조건부 주문을 모두 최근 60초 이내에 정상 조회해야 해요. 둘 중 하나라도 실패하면 보호 여부를 판단하지 않습니다.';
  return;
 }
 if(Math.abs(account.at-orders.at)>45000){
  alert.className='recon-fail';alert.textContent='두 조회 시점이 너무 달라요. 계좌와 미체결을 다시 조회하세요.';return;
 }
 const positions=account.positions.filter(p=>Number.isFinite(p.amount)&&Math.abs(p.amount)>1e-9);
 if(!positions.length){
  alert.className='recon-neutral';alert.textContent='BTCUSDT 열린 포지션 없음(마지막 계좌 조회 기준). 보호 주문 필요 여부는 추가 확인하세요.';
  return;
 }
 let warn=0;
 for(const p of positions){
  const side=positionSide(p),exitSide=side==='LONG'?'SELL':'BUY',qty=Math.abs(p.amount);
  const same=orders.algo.filter(o=>o.side===exitSide&&(o.positionSide===side||o.positionSide==='BOTH'&&p.positionSide==='BOTH')&&
    ['NEW','ACCEPTED','WORKING','ACTIVE'].includes(o.status));
  const stop=same.filter(o=>['STOP_MARKET','STOP'].includes(o.type));
  const take=same.filter(o=>['TAKE_PROFIT_MARKET','TAKE_PROFIT'].includes(o.type));
  const row=make('div');row.className='recon-item';
  const header=make('b',side+' 포지션 '+display(qty,8)+' BTC');
  const msg=[];
  const stopQty=stop.reduce((v,o)=>v+(Number.isFinite(o.quantity)?o.quantity:0),0);
  const fullClose=stop.some(o=>o.closePosition);
  msg.push('손절 후보: '+stop.length+'건 / 익절 후보: '+take.length+'건');
  if(stop.length){
   msg.push('손절 Algo ID: '+stop.map(o=>o.id).join(', '));
   msg.push('손절 주문 수량 합계: '+display(stopQty,8)+' BTC'+(fullClose?' · 전체 청산 플래그 확인 필요':''));
  }else msg.push('경고: 활성 손절 후보를 찾지 못했습니다.');
  if(take.length)msg.push('익절 Algo ID: '+take.map(o=>o.id).join(', '));
  msg.push('⚠ 후보 일치만 확인. 실제 트리거 방향, 거래소 접수 상태, 수량/중복, 마진 모드, reduceOnly/closePosition 유효성은 추가 검증이 필요합니다.');
  if(!stop.length||!take.length||!fullClose&&stopQty+1e-8<qty){
   row.classList.add('recon-fail');warn++;
  }else row.classList.add('recon-warning');
  const content=make('div',msg.join('\n'));row.append(header,content);details.append(row);
 }
 alert.className=warn?'recon-fail':'recon-warning';
 alert.textContent=warn?
  '보호 주문 누락 또는 수량 부족 가능성: '+warn+'개 포지션. 바이낸스 앱에서 즉시 확인하세요.':
  '보호 주문 후보가 발견됐지만 완전한 보호는 확인되지 않았습니다. 바이낸스 앱에서 트리거·수량·상태를 확인하세요.';
}
verify.addEventListener('click',reconcile);
async function signedTrades(credentials,signal){
 const params=new URLSearchParams({symbol:'BTCUSDT',limit:'50',recvWindow:'5000',timestamp:String(Date.now())});
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(credentials.apiSecret),
   {name:'HMAC',hash:'SHA-256'},false,['sign']);
 const sig=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(params.toString()));
 params.set('signature',[...new Uint8Array(sig)].map(x=>x.toString(16).padStart(2,'0')).join(''));
 const resp=await fetch('https://fapi.binance.com/fapi/v1/userTrades?'+params.toString(),{
  method:'GET',mode:'cors',cache:'no-store',credentials:'omit',redirect:'error',
  headers:{'X-MBX-APIKEY':credentials.apiKey},signal
 });
 if(!resp.ok)throw Error('HTTP '+resp.status);
 const rows=await resp.json();
 if(!Array.isArray(rows))throw Error('바이낸스 체결 응답 형식 불일치');
 return rows.filter(o=>o.symbol==='BTCUSDT');
}
function renderTrades(rows){
 fillsList.replaceChildren();
 if(!rows.length){fillsList.textContent='최근 50건 조회 범위에 체결 없음';return}
 let sum=0;
 for(const o of [...rows].reverse()){
  const id=String(o.id??''),price=safeNum(o.price),qty=safeNum(o.qty),pnl=safeNum(o.realizedPnl),fee=safeNum(o.commission);
  const row=make('div');row.className='recon-item';
  if(Number.isFinite(pnl))sum+=pnl;
  row.append(make('b',(o.side||'—')+' '+display(qty,8)+' BTC @ '+display(price,2)+' USDT'),
   make('div','체결 ID '+id+' · 주문 ID '+String(o.orderId??'—')+
   '\n실현손익 '+display(pnl,5)+' USDT · 수수료 '+display(fee,6)+' '+String(o.commissionAsset||'')+
   '\n'+(Number.isFinite(Number(o.time))?new Date(Number(o.time)).toLocaleString('ko-KR'):'시간 정보 없음')));
  fillsList.append(row);
 }
 fillsState.className='recon-neutral';
 fillsState.textContent='실제 체결 '+rows.length+'건 · 실현손익 합 '+display(sum,5)+
  ' USDT (조회한 최대 50건, 수수료 별도) · '+new Date().toLocaleTimeString('ko-KR');
}
fillsRefresh.addEventListener('click',async()=>{
 if(fillsBusy||document.hidden)return;
 const creds=typeof getApiCredentials==='function'?getApiCredentials():null;
 if(!creds?.apiKey||!creds?.apiSecret){fillsState.className='recon-fail';fillsState.textContent='설정에서 API 키 잠금 해제 필요';return}
 fillsBusy=true;fillsRefresh.disabled=true;fillEpoch++;
 const mine=fillEpoch;fillController?.abort();fillController=new AbortController();
 const timer=setTimeout(()=>fillController?.abort(),11000);
 fillsList.replaceChildren();fillsState.textContent='바이낸스 실제 체결 읽는 중…';
 try{
  const rows=await signedTrades(creds,fillController.signal);
  if(mine===fillEpoch&&!document.hidden)renderTrades(rows);
 }catch(err){
  if(mine===fillEpoch){fillsList.replaceChildren();fillsState.className='recon-fail';
   fillsState.textContent='체결 조회 실패 (결과 미확정): '+String(err?.message||'네트워크/CORS 차단')+
    ' · 바이낸스 앱에서 확인하세요.'}
 }finally{clearTimeout(timer);fillsBusy=false;fillsRefresh.disabled=false}
});
const clearAll=()=>{
 reset('API 잠금/앱 비활성화 · 보호 상태 확인을 다시 진행하세요.');
 fillEpoch++;fillController?.abort();fillsList.replaceChildren();
 fillsState.className='recon-neutral';fillsState.textContent='보안상 체결 기록 지움 · 다시 조회 필요';
};
document.addEventListener('btc:live-lock',clearAll);
document.addEventListener('visibilitychange',()=>{if(document.hidden)clearAll()});
window.addEventListener('pagehide',clearAll);
})();