/* USD-M BTCUSDT order.place + algoOrder.place transport architecture.
 * Production and demo transmission are both DISABLED in this release.
 * User data stream, testnet and protection-reconciliation tests are prerequisites.
 */
(()=>{
'use strict';
const TX_ENABLED=false; // build-time hard lock: do not enable in a public PWA.
const page=document.getElementById('page-position');if(!page)return;
const el=(tag,text)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node};
const card=el('section');card.className='direct-live';
const heading=el('h2','거래소 주문 실행 엔진 · 안전 잠금');
const details=el('p','신규 수동 주문(order.place), 실제 체결 확인(order.status), 손절·익절(algoOrder.place) 순서의 전송/검증 코드를 분리했습니다. 이 개발 빌드에서는 주문 전송이 실행되지 않습니다.');
const state=el('p','안전 잠금 ON · 실전/테스트넷 주문 전송 0건');state.setAttribute('role','status');
const button=el('button','실제 주문+손절·익절 실행 (검증 전 잠금)');
button.disabled=true;button.type='button';card.append(heading,details,state,button);page.append(card);
let busy=false;
const TERMINAL=new Set(['FILLED','CANCELED','EXPIRED','EXPIRED_IN_MATCH','REJECTED']);
const validateClientId=id=>typeof id==='string'&&/^btc[a-z0-9]{20}[est]$/.test(id);
async function signed(method,fields,creds){
 if(!TX_ENABLED)throw Error('빌드에서 주문 전송이 비활성화되어 있습니다');
 if(!['order.place','order.status','algoOrder.place'].includes(method))
   throw Error('허용되지 않은 메서드');
 const params={apiKey:creds.apiKey,recvWindow:5000,timestamp:Date.now(),...fields};
 const msg=Object.keys(params).sort().map(k=>k+'='+encodeURIComponent(params[k])).join('&');
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(creds.apiSecret),
   {name:'HMAC',hash:'SHA-256'},false,['sign']);
 const sig=new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(msg)));
 params.signature=Array.from(sig,b=>b.toString(16).padStart(2,'0')).join('');
 return directBinanceWS(method,params,state,10000);
}
const qtyOf=r=>Number(r?.executedQty);
function orderSnapshotValid(status,id,qty){
 return status?.symbol==='BTCUSDT'&&status?.clientOrderId===id&&
  ['BUY','SELL'].includes(status.side)&&status.status==='FILLED'&&
  Number.isFinite(qtyOf(status))&&qtyOf(status)>0&&
  Math.abs(qtyOf(status)-qty)<=1e-8;
}
function fields(plan,ids){
 if(!ids||!['entryId','stopId','takeId'].every(k=>validateClientId(ids[k])))
  throw Error('기기에 예약한 안전 주문 ID 없음');
 const entry={...plan.entry,newClientOrderId:ids.entryId,newOrderRespType:'RESULT'};
 const stop={...plan.stop,clientAlgoId:ids.stopId,newOrderRespType:'ACK'};
 const take={...plan.tp,clientAlgoId:ids.takeId,newOrderRespType:'ACK'};
 // Immediate-or-cancel all-or-nothing entry: no GTC order may fill after
 // the PWA is closed. A venue-side stop is still not atomic with entry.
 entry.timeInForce='FOK';
 if(entry.type!=='LIMIT'||!(Number(entry.quantity)>0)||!(Number(entry.price)>0))
  throw Error('지원하지 않는 진입 주문');
 if(stop.type!=='STOP_MARKET'||take.type!=='TAKE_PROFIT_MARKET'||
    stop.closePosition!=='true'||take.closePosition!=='true'||
    stop.symbol!=='BTCUSDT'||take.symbol!=='BTCUSDT'||
    'quantity'in stop||'quantity'in take||'reduceOnly'in stop||'reduceOnly'in take)
  throw Error('거래소 보호 주문 파라미터 부적합');
 return {entry,stop,take};
}
async function executeAuthenticated(plan,ids,creds,markUnknown){
 if(!TX_ENABLED)throw Error('실전 주문 전송 잠금');
 if(busy)throw Error('이미 거래소 상태를 확인 중');
 if(document.hidden)throw Error('앱 백그라운드에서는 거래 불가');
 busy=true;
 try{
  const tx=fields(plan,ids);
  // Persist UNKNOWN in durable journal BEFORE submitting. If saving fails,
  // exit before contacting the exchange. This is not an atomic multi-tab lock.
  await markUnknown('ENTRY_UNKNOWN',ids.entryId);
  let ack;
  try{ack=await signed('order.place',tx.entry,creds)}
  catch(_){throw Error('진입 주문 응답 불명확: 재주문 금지, Client ID로 거래소 조회 필수')}
  if(ack?.symbol!=='BTCUSDT'||ack?.clientOrderId!==ids.entryId)
   throw Error('진입 주문 응답 불일치: 거래소 조회 필수');
  // FOK may be EXPIRED rather than filled; never register protection on
  // a rejected/unfilled order. An unknown status remains a hard stop.
  const status=await signed('order.status',{symbol:'BTCUSDT',origClientOrderId:ids.entryId},creds);
  if(status?.status!=='FILLED'){
   if(!TERMINAL.has(status?.status))
     throw Error('신규 주문 상태 불명확: 상태 확인 후 복구 필요');
   return {status:'NOT_FILLED',detail:status.status};
  }
  if(!orderSnapshotValid(status,ids.entryId,Number(tx.entry.quantity)))
   throw Error('체결 수량/방향 불일치: 보호 주문을 추측하여 제출하지 않음');
  // There is an unavoidable protection gap between entry fill and the
  // separate exchange-side protective orders; app termination can expose it.
  await markUnknown('PROTECTION_UNKNOWN',ids.stopId);
  let stopAck;
  try{stopAck=await signed('algoOrder.place',tx.stop,creds)}
  catch(_){throw Error('손절 접수 여부 불명확: 절대 자동 재전송하지 말고 거래소에서 확인')}
  if(stopAck?.symbol!=='BTCUSDT'||stopAck?.clientAlgoId!==ids.stopId||
     !Number.isSafeInteger(Number(stopAck.algoId)))
   throw Error('손절 접수 응답 검증 실패 · 거래소 앱에서 즉시 확인');
  let takeAck;
  try{takeAck=await signed('algoOrder.place',tx.take,creds)}
  catch(_){throw Error('익절 접수 여부 불명확: 자동 재전송하지 않음. 손절 상태도 확인 필요')}
  if(takeAck?.symbol!=='BTCUSDT'||takeAck?.clientAlgoId!==ids.takeId)
   throw Error('익절 접수 응답 검증 실패');
  return {status:'VERIFY_ON_EXCHANGE',stopAlgoId:stopAck.algoId,takeAlgoId:takeAck.algoId};
 }finally{busy=false}
}
// Intentionally unreachable: no secret-bearing global function is exported
// and there is no user event bound to executeAuthenticated in this build.
button.addEventListener('click',()=>{button.disabled=true;state.textContent='현재 개발 버전은 실제 주문 전송이 비활성화되어 있습니다.'});
})();