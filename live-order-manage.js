/* Real BTCUSDT order management: preflight and write-path code.
 * Deployment gate stays CLOSED until exchange tests and protection checks pass.
 * No auto actions. No secrets in source. The authenticated WebSocket calls
 * deliberately reuse the encrypted, locally unlocked API vault.
 */
(()=>{
'use strict';
const LIVE_ORDER_WRITES_VERIFIED=false; // Safety gate: do not enable without independent live/testnet verification.
const host=document.getElementById('page-position');
if(!host)return;
const section=document.createElement('section');section.className='direct-live';
const h=document.createElement('h2');h.textContent='실제 지정가 주문 관리 · 사전 검증';
const para=document.createElement('p');para.textContent='실제 Binance 주문 ID를 입력해 현재 상태를 재조회하고 취소/가격 변경 가능 여부를 확인합니다. 아직 취소·정정 실행은 잠겨 있습니다.';
const idLabel=document.createElement('label');idLabel.textContent='BTCUSDT 일반 주문 ID';
const id=document.createElement('input');id.type='text';id.inputMode='numeric';id.autocomplete='off';id.placeholder='실제 일반 지정가 주문 번호';
idLabel.append(id);
const priceLabel=document.createElement('label');priceLabel.textContent='변경할 지정가 (USDT)';
const price=document.createElement('input');price.type='number';price.inputMode='decimal';price.min='1';price.step='any';price.placeholder='기존 가격을 유지하거나 변경할 가격';
priceLabel.append(price);
const preflight=document.createElement('button');preflight.type='button';preflight.textContent='주문 상태·정정 조건 확인';
const actions=document.createElement('div');actions.className='row';
const cancel=document.createElement('button');cancel.type='button';cancel.textContent='실제 주문 취소';cancel.disabled=true;
const modify=document.createElement('button');modify.type='button';modify.textContent='실제 지정가 변경';modify.disabled=true;
actions.append(cancel,modify);
const message=document.createElement('p');message.setAttribute('role','status');message.textContent='API 잠금 해제 후 검증할 수 있어요. 실제 취소/정정은 안전 점검 전까지 비활성화되어 있습니다.';
section.append(h,para,idLabel,priceLabel,preflight,actions,message);
host.append(section);
const cleanInt=s=>/^[1-9]\d{0,15}$/.test(s)&&Number.isSafeInteger(Number(s));
const precision=x=>{const t=String(x);return t.includes('.')?t.split('.')[1].length:0};
const aligned=(v,step)=>{
 const p=Math.min(10,Math.max(precision(v),precision(step)));
 const scale=10**p,s=Math.round(Number(step)*scale),n=Math.round(Number(v)*scale);
 return s>0&&n>0&&n%s===0;
};
let pending=false,verified=null,sequence=0;
function invalidate(note){
 verified=null;cancel.disabled=true;modify.disabled=true;
 if(note)message.textContent=note;
}
async function signedCall(method,fields,creds){
 if(!['order.status','order.cancel','order.modify'].includes(method))throw Error('허용되지 않은 주문 메서드');
 if(!creds?.apiKey||!creds?.apiSecret)throw Error('설정에서 API 키 잠금 해제 필요');
 const params={apiKey:creds.apiKey,recvWindow:5000,timestamp:Date.now(),...fields};
 const query=Object.keys(params).sort().map(k=>k+'='+encodeURIComponent(params[k])).join('&');
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(creds.apiSecret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const raw=new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(query)));
 params.signature=Array.from(raw,b=>b.toString(16).padStart(2,'0')).join('');
 return directBinanceWS(method,params,message,11000);
}
async function freshStatus(orderId,creds){
 const result=await signedCall('order.status',{symbol:'BTCUSDT',orderId},creds);
 if(!result||result.symbol!=='BTCUSDT'||String(result.orderId)!==String(orderId))
  throw Error('거래소 주문 ID/심볼 일치 실패');
 if(!['NEW','PARTIALLY_FILLED'].includes(result.status))throw Error('현재 취소/정정 가능한 미체결 주문이 아닙니다');
 const orig=Number(result.origQty),filled=Number(result.executedQty),oldPrice=Number(result.price);
 if(!Number.isFinite(orig)||!Number.isFinite(filled)||!(orig>0)||filled<0||filled>=orig||!(oldPrice>0))
  throw Error('주문 수량 또는 가격이 예상과 달라요');
 return {result,orig,filled,oldPrice};
}
async function tickSize(){
 const r=await fetch('https://fapi.binance.com/fapi/v1/exchangeInfo',{cache:'no-store',signal:AbortSignal.timeout(7000)});
 if(!r.ok)throw Error('BTCUSDT 가격 단위 확인 실패');
 const data=await r.json(),symbol=data?.symbols?.find(x=>x.symbol==='BTCUSDT'&&x.status==='TRADING');
 const tick=Number(symbol?.filters?.find(x=>x.filterType==='PRICE_FILTER')?.tickSize);
 if(!(tick>0))throw Error('거래소 호가 단위를 확인할 수 없습니다');
 return tick;
}
function credentials(){return typeof getApiCredentials==='function'?getApiCredentials():null}
async function inspect(){
 if(pending)return;
 invalidate();
 const orderText=id.value.trim();
 if(!cleanInt(orderText)){message.textContent='올바른 주문 번호를 입력하세요';return}
 const creds=credentials();
 if(!creds?.apiKey||!creds?.apiSecret){message.textContent='설정에서 API 키를 먼저 잠금 해제하세요';return}
 pending=true;preflight.disabled=true;const seq=++sequence;
 try{
   const orderId=Number(orderText);
   const {result,orig,filled,oldPrice}=await freshStatus(orderId,creds);
   const isLimit=result.type==='LIMIT'&&result.origType!=='STOP'&&result.origType!=='TAKE_PROFIT';
   const proposed=Number(price.value);
   let amendment='변경 가격을 입력하면 호가 단위를 검사합니다';
   let allowModify=false;
   if(price.value.trim()){
     if(!isLimit)amendment='일반 LIMIT 주문만 가격 변경 가능';
     else if(filled>0)amendment='부분체결 주문은 안전상 가격 변경을 차단';
     else if(!(proposed>0))amendment='새 가격이 올바르지 않음';
     else if(Math.abs(proposed/oldPrice-1)>.02)amendment='기존 지정가 대비 2% 초과 변경은 제한';
     else{
       const tick=await tickSize();
       if(!aligned(proposed,tick))amendment='BTCUSDT 호가 단위와 맞지 않음 ('+tick+')';
       else if(proposed===oldPrice)amendment='가격이 동일함';
       else{allowModify=true;amendment='가격 변경 사전 검증 통과 (실행 잠금 중)'}
     }
   }
   if(seq!==sequence||id.value.trim()!==orderText)return;
   verified={orderId,side:result.side,positionSide:result.positionSide,
     quantity:orig,filled,oldPrice,price:proposed,allowModify,verifiedAt:Date.now()};
   const qtyLeft=Math.max(0,orig-filled);
   message.textContent='주문 ID: '+orderId+'\n상태: '+result.status+' · '+result.side+' '+result.positionSide+
     '\n기존 가격: '+oldPrice+' USDT · 전체 '+orig+' BTC · 체결 '+filled+' BTC · 남은 '+qtyLeft+' BTC'+
     '\n정정: '+amendment+
     '\n⚠ 가격 변경은 주문 대기 순서를 잃을 수 있습니다. 실제 취소/정정 전송은 잠금 상태입니다.';
   message.style.whiteSpace='pre-wrap';
   cancel.disabled=!LIVE_ORDER_WRITES_VERIFIED;
   modify.disabled=!LIVE_ORDER_WRITES_VERIFIED||!allowModify;
 }catch(err){if(seq===sequence)invalidate('상태 확인 실패: '+(err?.message||'연결 오류'))}
 finally{pending=false;preflight.disabled=false}
}
preflight.addEventListener('click',()=>void inspect());
id.addEventListener('input',()=>{sequence++;invalidate('주문 번호가 변경됐습니다. 다시 검증해 주세요.')});
price.addEventListener('input',()=>{sequence++;invalidate('변경 가격이 바뀌었습니다. 다시 검증해 주세요.')});
async function transact(method){
 if(!LIVE_ORDER_WRITES_VERIFIED)return;
 if(pending||!verified||Date.now()-verified.verifiedAt>10000){invalidate('다시 조회 후 진행하세요');return}
 const request=verified;
 const creds=credentials();
 if(!creds)return;
 const status=await freshStatus(request.orderId,creds);
 if(method==='order.modify'&&(!request.allowModify||status.filled!==0||status.result.type!=='LIMIT'))throw Error('현재 정정 불가');
 if(status.filled!==request.filled||status.orig!==request.quantity||status.oldPrice!==request.oldPrice)
   throw Error('검증 후 거래소 상태 변경 · 작업 중단');
 const prompt=method==='order.cancel'?
   'BTCUSDT 주문 #'+request.orderId+'을 실제 취소할까요?':
   'BTCUSDT #'+request.orderId+' 지정가를 '+request.oldPrice+' → '+request.price+' USDT로 실제 변경할까요?';
 if(!confirm(prompt))return;
 const params=method==='order.cancel'?{symbol:'BTCUSDT',orderId:request.orderId}:
   {symbol:'BTCUSDT',orderId:request.orderId,side:request.side,quantity:String(request.quantity),price:String(request.price)};
 // Execution gate is hardcoded false in this development build.
 const result=await signedCall(method,params,creds);
 if(result?.symbol!=='BTCUSDT'||Number(result.orderId)!==request.orderId)
   throw Error('결과 확인 필요: 주문 ID가 일치하지 않음');
 invalidate('서버 응답 접수 · 거래소 주문 상태 재확인 필요'); // Never assume final state from response alone.
}
function run(method){
 if(pending)return;pending=true;cancel.disabled=true;modify.disabled=true;
 Promise.resolve().then(()=>transact(method)).catch(e=>{message.textContent='실행 상태 확인 필요: '+(e?.message||'오류')})
   .finally(()=>{pending=false;invalidate()});
}
cancel.addEventListener('click',()=>run('order.cancel'));
modify.addEventListener('click',()=>run('order.modify'));
function lock(){sequence++;invalidate('API 잠금/화면 전환 · 다시 검증해 주세요.')}
document.addEventListener('btc:live-lock',lock);
document.addEventListener('visibilitychange',()=>{if(document.hidden)lock()});
window.addEventListener('pagehide',lock);
})();