/* BTCUSDT USD-M orders snapshot (read-only).
   Uses locally unlocked encrypted vault; NO proxy; NO order writes.
   REST may be blocked by browser CORS. In that case fail closed and show an error.
*/
(()=>{
'use strict';
const host=document.getElementById('page-position');
if(!host)return;
const section=document.createElement('section');
section.className='direct-live';
section.setAttribute('aria-label','실제 BTC 미체결 주문');
const heading=document.createElement('h2');heading.textContent='실제 미체결 주문 · BTCUSDT';
const description=document.createElement('p');description.textContent='일반 지정가와 조건부 손절·익절을 각각 바이낸스에서 조회합니다. 실제 취소나 가격 변경은 지원하지 않습니다.';
const button=document.createElement('button');button.type='button';button.textContent='미체결 새로고침';
const state=document.createElement('p');state.setAttribute('role','status');
state.textContent='API 잠금 해제 후 새로고침을 누르세요.';
const normalHeading=document.createElement('h3');normalHeading.textContent='일반 미체결';
const normalList=document.createElement('div');
const algoHeading=document.createElement('h3');algoHeading.textContent='조건부 · 손절 / 익절';
const algoList=document.createElement('div');
const note=document.createElement('p');note.textContent='이 목록은 마지막 조회 시점의 상태입니다. 전체 주문 실시간 추적이 아니며 아이폰 화면 잠금·다른 앱 사용 중 갱신이 보장되지 않습니다.';
section.append(heading,description,button,state,normalHeading,normalList,algoHeading,algoList,note);
const existing=host.querySelector('.direct-live');
if(existing)existing.insertAdjacentElement('afterend',section);else host.prepend(section);
const style=document.createElement('style');
style.textContent='.direct-live h3{margin:13px 0 7px;font-size:13px}.direct-live .order-entry{padding:9px;margin:6px 0;border:1px solid #314862;border-radius:9px;background:#0c1b2e;font-size:12px;line-height:1.6}.direct-live .order-entry small{color:#a8c2dd;display:block;font-size:11px}.direct-live .order-warn{color:#ffb0ad}';
document.head.append(style);
const format=(v,p=5)=>Number.isFinite(Number(v))&&v!==null&&v!==''?Number(v).toLocaleString('ko-KR',{maximumFractionDigits:p}):'—';
function line(parent,heading,details){
 const row=document.createElement('div');row.className='order-entry';
 const h=document.createElement('b');h.textContent=heading;const d=document.createElement('small');d.textContent=details;row.append(h,d);parent.append(row);
}
let seq=0,loading=false,enabled=false,lastResultAt=0;
let controller=null;
function clear(message='조회 전'){
 normalList.replaceChildren();algoList.replaceChildren();
 normalList.textContent=message;algoList.textContent=message;
}
function locked(){
 enabled=false;seq++;controller?.abort();controller=null;
 clear('API 잠금 또는 재조회 필요');state.textContent='API 잠금 상태 · 데이터 삭제';
}
async function signedRead(path,credentials,signal){
 if(!['/fapi/v1/openOrders','/fapi/v1/openAlgoOrders'].includes(path))throw Error('허용되지 않은 조회 경로');
 const params=new URLSearchParams({symbol:'BTCUSDT',recvWindow:'5000',timestamp:String(Date.now())});
 const secretKey=await crypto.subtle.importKey('raw',new TextEncoder().encode(credentials.apiSecret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const digest=await crypto.subtle.sign('HMAC',secretKey,new TextEncoder().encode(params.toString()));
 params.set('signature',[...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join(''));
 const response=await fetch('https://fapi.binance.com'+path+'?'+params.toString(),{
   method:'GET',mode:'cors',cache:'no-store',credentials:'omit',redirect:'error',
   headers:{'X-MBX-APIKEY':credentials.apiKey},signal
 });
 if(!response.ok)throw Error('바이낸스 HTTP '+response.status);
 const data=await response.json();
 if(!Array.isArray(data))throw Error('바이낸스 주문 배열 응답이 아님');
 return data.filter(o=>o&&o.symbol==='BTCUSDT');
}
function renderNormal(items){
 normalList.replaceChildren();
 if(!items.length){normalList.textContent='조회된 일반 미체결 주문 0건';return}
 items.slice(0,100).forEach(o=>{
   const total=Number(o.origQty),filled=Number(o.executedQty);
   const remaining=Number.isFinite(total)&&Number.isFinite(filled)?Math.max(0,total-filled):null;
   line(normalList,(o.positionSide||'BOTH')+' '+(o.side||'')+' · '+(o.type||'LIMIT')+
      ' · '+format(o.price,2)+' USDT',
      'ID '+String(o.orderId||'—')+' · 상태 '+String(o.status||'—')+
      ' · 미체결 '+format(remaining,7)+' BTC / 전체 '+format(o.origQty,7)+' BTC');
 });
}
function renderAlgo(items){
 algoList.replaceChildren();
 if(!items.length){algoList.textContent='조회된 조건부 주문 0건';return}
 items.slice(0,100).forEach(o=>{
   line(algoList,(o.positionSide||'BOTH')+' '+(o.side||'')+' · '+(o.orderType||o.type||'ALGO'),
      'Algo ID '+String(o.algoId||'—')+' · 상태 '+String(o.algoStatus||'—')+
      ' · 트리거 '+format(o.triggerPrice,2)+' USDT · 수량 '+format(o.quantity,7)+' BTC');
 });
}
async function sync(){
 if(loading||document.hidden)return;
 const credentials=typeof getApiCredentials==='function'?getApiCredentials():null;
 if(!credentials?.apiKey||!credentials?.apiSecret){
  locked();state.textContent='설정에서 저장된 API 키의 잠금을 해제해 주세요.';return;
 }
 const current=++seq;loading=true;button.disabled=true;
 controller?.abort();controller=new AbortController();
 const timeout=setTimeout(()=>controller?.abort(),13000);
 state.textContent='일반/조건부 미체결 조회 중…';
 const [plain,algo]=await Promise.allSettled([
   signedRead('/fapi/v1/openOrders',credentials,controller.signal),
   signedRead('/fapi/v1/openAlgoOrders',credentials,controller.signal)
 ]);
 clear('조회 실패 · 미체결 없음으로 판단할 수 없음');
 if(current===seq){
  if(plain.status==='fulfilled')renderNormal(plain.value);
  if(algo.status==='fulfilled')renderAlgo(algo.value);
  const ok=plain.status==='fulfilled'&&algo.status==='fulfilled';
  enabled=ok;
  lastResultAt=ok?Date.now():0;
  state.className=ok?'success':'order-warn';
  state.textContent=ok?
    '조회 완료 · '+new Date(lastResultAt).toLocaleTimeString('ko-KR')+' · 일반 '+plain.value.length+'건 / 조건부 '+algo.value.length+'건':
    '일부 또는 전체 조회 실패. 브라우저 CORS·지역 제한·API 권한을 확인하세요. 실제 주문 유무는 바이낸스 앱에서 확인해야 합니다.';
 }
 clearTimeout(timeout);loading=false;button.disabled=false;
}
button.addEventListener('click',sync);
const poll=setInterval(()=>{
 if(enabled&&!loading&&!document.hidden&&Date.now()-lastResultAt>=30000)void sync();
},5000);
document.addEventListener('visibilitychange',()=>{
 if(document.hidden){locked();state.textContent='보안상 화면 비활성화 시 목록 초기화 · 다시 조회 필요'}
});
window.addEventListener('pagehide',()=>{locked();clearInterval(poll)});
})();