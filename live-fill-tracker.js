/* BTCUSDT signed order.status tracker (read-only).
 * Tracks at most 8 actual order IDs, polling only while page is visible.
 * No fill simulation, order execution, key persistence or background trading.
 */
(()=>{
'use strict';
const host=document.getElementById('page-position');
if(!host)return;
const wrap=document.createElement('section');wrap.className='direct-live';
wrap.setAttribute('aria-label','실제 주문 체결 추적');
const heading=document.createElement('h2');heading.textContent='실제 체결 / 부분체결 추적';
const help=document.createElement('p');help.textContent='BTCUSDT 실제 일반 주문 ID를 추가하면 바이낸스에서 상태를 재조회합니다. 앱이 열려 있고 잠금 해제된 동안만 동작하며, 체결 수량은 거래소 응답만 사용합니다.';
const input=document.createElement('input');input.type='text';input.inputMode='numeric';input.autocomplete='off';input.placeholder='BTCUSDT 일반 주문 ID';input.setAttribute('aria-label','추적할 주문 ID');
const buttons=document.createElement('div');buttons.className='row';
const add=document.createElement('button');add.type='button';add.textContent='주문 추적 추가';
const syncButton=document.createElement('button');syncButton.type='button';syncButton.textContent='지금 동기화';
const clearButton=document.createElement('button');clearButton.type='button';clearButton.textContent='추적 목록 비우기';
buttons.append(add,syncButton,clearButton);
const notice=document.createElement('p');notice.setAttribute('role','status');notice.textContent='API 잠금 해제 후 주문 ID를 입력하세요.';
const list=document.createElement('div');
const footer=document.createElement('p');footer.textContent='부분체결·취소·완료 상태는 매번 거래소 주문 상태를 확인합니다. 연결 실패 시 미체결 없음이나 체결 완료로 간주하지 않습니다. 손절·익절 설치 여부는 별도로 확인해야 합니다.';
wrap.append(heading,help,input,buttons,notice,list,footer);
const anchor=host.querySelector('.direct-live');
if(anchor)anchor.insertAdjacentElement('afterend',wrap);else host.prepend(wrap);
const style=document.createElement('style');
style.textContent='.direct-live .track-order{border:1px solid #354f6c;background:#091a2f;border-radius:9px;padding:10px;margin:8px 0}.direct-live .track-order strong{display:block;font-size:13px}.direct-live .track-order small{display:block;font-size:11px;color:#adc6e1;white-space:pre-line;line-height:1.7}.direct-live .track-order button{width:auto;min-width:62px;margin-top:5px}.direct-live .track-warn{color:#ffb7ad}';
document.head.append(style);
const tracked=new Map();
const terminal=new Set(['FILLED','CANCELED','EXPIRED','EXPIRED_IN_MATCH','REJECTED']);
const goodId=v=>/^[1-9]\d{0,15}$/.test(v)&&Number.isSafeInteger(Number(v));
const format=(value,digits=6)=>Number(value).toLocaleString('ko-KR',{maximumFractionDigits:digits});
let busy=false,seq=0,lastChecked=0;
function credentials(){return typeof getApiCredentials==='function'?getApiCredentials():null}
function view(){
 list.replaceChildren();
 if(!tracked.size){list.textContent='추적 중인 주문 없음';return}
 for(const [id,rec] of tracked){
  const box=document.createElement('article');box.className='track-order';
  const title=document.createElement('strong');title.textContent='#'+id+' · '+(rec.status||'조회 전');
  const body=document.createElement('small');
  const rows=[];
  if(rec.state==='ok'){
   rows.push(rec.side+' '+rec.positionSide+' · '+rec.type+' · '+format(rec.price,2)+' USDT');
   rows.push('원주문 '+format(rec.total)+' BTC · 누적 체결 '+format(rec.filled)+' BTC · 잔여 '+format(Math.max(0,rec.total-rec.filled))+' BTC');
   rows.push('평균 체결가 '+(rec.averagePrice>0?format(rec.averagePrice,2)+' USDT':'—')+' · '+new Date(rec.updated).toLocaleTimeString('ko-KR')+' 확인');
   if(rec.isTerminal)rows.push('거래소 최종 상태: '+rec.status);
  }else if(rec.state==='error')rows.push('조회 실패 · 마지막 상태를 신뢰하지 마세요. '+(rec.error||''));
  else rows.push('주문 상태를 아직 확인하지 않았습니다');
  body.textContent=rows.join('\n');
  const remove=document.createElement('button');remove.textContent='추적 해제';remove.type='button';
  remove.onclick=()=>{tracked.delete(id);seq++;view();notice.textContent='추적만 해제됨 · 거래소 주문은 변경되지 않았습니다.'};
  box.append(title,body,remove);list.append(box);
 }
}
async function signedStatus(orderId,creds){
 const params={apiKey:creds.apiKey,symbol:'BTCUSDT',orderId:Number(orderId),recvWindow:5000,timestamp:Date.now()};
 const query=Object.keys(params).sort().map(k=>k+'='+encodeURIComponent(params[k])).join('&');
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(creds.apiSecret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const signature=new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(query)));
 params.signature=Array.from(signature,b=>b.toString(16).padStart(2,'0')).join('');
 return directBinanceWS('order.status',params,notice,11000);
}
function normalize(value,id){
 if(!value||value.symbol!=='BTCUSDT'||String(value.orderId)!==id)throw Error('BTCUSDT/주문 ID 검증 실패');
 const total=Number(value.origQty),filled=Number(value.executedQty),price=Number(value.price),averagePrice=Number(value.avgPrice||0);
 if(!Number.isFinite(total)||!(total>0)||!Number.isFinite(filled)||filled<0||filled>total||
    !Number.isFinite(price)||price<0||!Number.isFinite(averagePrice)||averagePrice<0)
  throw Error('체결 수량·가격 검증 실패');
 if(!['BUY','SELL'].includes(value.side)||!['LONG','SHORT','BOTH'].includes(value.positionSide))
  throw Error('주문 방향/포지션 검증 실패');
 const status=String(value.status||'');
 if(!['NEW','PARTIALLY_FILLED','FILLED','CANCELED','EXPIRED','EXPIRED_IN_MATCH','REJECTED'].includes(status))
  throw Error('알 수 없는 거래소 주문 상태');
 const remaining=Math.max(0,total-filled);
 if(status==='FILLED'&&remaining>Math.max(1e-8,total*1e-7))throw Error('완료 상태와 수량 불일치');
 return {state:'ok',status,total,filled,price,averagePrice,side:value.side,positionSide:value.positionSide,
  type:String(value.type||''),updated:Date.now(),isTerminal:terminal.has(status)};
}
async function sync(){
 if(busy||document.hidden||!tracked.size)return;
 const creds=credentials();
 if(!creds?.apiKey||!creds?.apiSecret){notice.className='track-warn';notice.textContent='API 잠금 해제 필요';return}
 const current=++seq,ids=[...tracked.keys()],limit=ids.slice(0,8);
 busy=true;syncButton.disabled=true;notice.textContent='바이낸스 실제 주문 상태 조회 중…';
 try{
  for(const id of limit){
   if(current!==seq||document.hidden)break;
   const previous=tracked.get(id);if(!previous)continue;
   try{
    const result=normalize(await signedStatus(id,creds),id);
    if(current!==seq||!tracked.has(id)||document.hidden)break;
    if(previous.state==='ok'&&result.filled+1e-9<previous.filled)
      throw Error('누적 체결 수량이 감소했습니다. 계좌 상태 확인 필요');
    tracked.set(id,result);
    if(previous.state==='ok'&&(previous.status!==result.status||result.filled>previous.filled+1e-9)){
     document.dispatchEvent(new CustomEvent('btc:order-fill-state',{
      detail:{orderId:id,status:result.status,executedQty:result.filled,remainingQty:Math.max(0,result.total-result.filled),
       checkedAt:result.updated,source:'BINANCE_ORDER_STATUS_READ_ONLY'}}));
    }
   }catch(err){
    if(current!==seq||!tracked.has(id))break;
    tracked.set(id,{...previous,state:'error',error:String(err?.message||'조회 실패').slice(0,140)});
   }
   view();
  }
  if(current===seq&&!document.hidden){
   lastChecked=Date.now();
   const problems=[...tracked.values()].filter(x=>x.state!=='ok').length;
   notice.className=problems?'track-warn':'';
   notice.textContent='주문 '+tracked.size+'건 확인 · '+new Date(lastChecked).toLocaleTimeString('ko-KR')+
      (problems?' · '+problems+'건 조회 오류 (바이낸스 앱 확인 필요)':' · 정상')+
      ' · 현재 화면 표시 중에만 약 20초 간격 동기화';
  }
 }finally{busy=false;syncButton.disabled=false}
}
function addId(value){
 const id=String(value).trim();
 if(!goodId(id))return false;
 if(tracked.has(id))return true;
 if(tracked.size>=8){notice.textContent='동시 추적 최대 8건 · 불필요한 주문을 추적 해제하세요.';return false}
 tracked.set(id,{state:'new',status:'조회 전'});view();return true;
}
add.onclick=()=>{if(addId(input.value)){input.value='';void sync()}else{notice.className='track-warn';notice.textContent='실제 BTCUSDT 주문 번호를 확인하세요 (최대 8건).'}};
syncButton.onclick=()=>void sync();
clearButton.onclick=()=>{seq++;tracked.clear();view();notice.textContent='추적 기록만 초기화됨 · 거래소 주문은 영향 없음'};
document.addEventListener('btc:open-order-snapshot',e=>{
 if(document.hidden||!credentials()?.apiKey||!Array.isArray(e.detail?.orders))return;
 for(const order of e.detail.orders.slice(0,8)){
  if(tracked.size>=8)break;
  if(order?.symbol==='BTCUSDT'&&goodId(String(order.orderId))&&!tracked.has(String(order.orderId)))
   addId(String(order.orderId));
 }
 if(tracked.size)void sync();
});
function clearOnLock(){
 seq++;tracked.clear();view();lastChecked=0;notice.className='track-warn';
 notice.textContent='보안상 추적 정보 초기화됨 · 다시 조회 필요';
}
document.addEventListener('btc:live-lock',clearOnLock);
document.addEventListener('visibilitychange',()=>{if(document.hidden)clearOnLock()});
window.addEventListener('pagehide',clearOnLock);
const poll=setInterval(()=>{if(!document.hidden&&!busy&&tracked.size&&Date.now()-lastChecked>=20000)void sync()},5000);
window.addEventListener('pagehide',()=>clearInterval(poll),{once:true});
view();
})();