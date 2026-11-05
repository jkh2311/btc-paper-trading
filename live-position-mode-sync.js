/* v65: Apply real Binance futures hedge/one-way position mode from existing UI.
 * Explicit action only; no order placement, no auto trading, no secret storage.
 * This setting is GLOBAL for USD-M and COIN-M futures after Binance CM migration.
 */
(()=>{
'use strict';
const selector=document.getElementById('paperPositionMode');
if(!selector)return;
const row=document.createElement('div');row.className='row';
const check=document.createElement('button');check.type='button';check.textContent='바이낸스 현재 모드 확인';
const apply=document.createElement('button');apply.type='button';apply.textContent='선택한 모드 실제 적용';
const message=document.createElement('p');message.className='muted';
message.setAttribute('role','status');message.setAttribute('aria-live','polite');
message.textContent='API 잠금 해제 후 현재 계좌 모드를 확인해 주세요. 변경은 별도 적용 버튼을 눌렀을 때만 이루어집니다.';
row.append(check,apply);
const parent=selector.closest('.card')||selector.parentElement;
selector.insertAdjacentElement('afterend',row);
row.insertAdjacentElement('afterend',message);
let running=false,epoch=0;
const creds=()=>typeof getApiCredentials==='function'?getApiCredentials():null;
async function request(method,fields,account){
 const query=new URLSearchParams({...fields,recvWindow:'5000',timestamp:String(Date.now())});
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(account.apiSecret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const signature=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(query.toString()));
 query.set('signature',[...new Uint8Array(signature)].map(x=>x.toString(16).padStart(2,'0')).join(''));
 const url='https://fapi.binance.com/fapi/v1/positionSide/dual';
 const abort=new AbortController();const timeout=setTimeout(()=>abort.abort(),11000);
 try{
  const response=await fetch(method==='GET'?url+'?'+query.toString():url,{
   method,mode:'cors',cache:'no-store',credentials:'omit',redirect:'error',
   headers:{'X-MBX-APIKEY':account.apiKey,...(method==='POST'?{'Content-Type':'application/x-www-form-urlencoded'}:{})},
   ...(method==='POST'?{body:query.toString()}:{}),
   signal:abort.signal
  });
  const data=await response.json().catch(()=>null);
  if(!response.ok)throw Error(data?.msg?String(data.msg).slice(0,160):'HTTP '+response.status);
  return data;
 }finally{clearTimeout(timeout)}
}
async function readCurrent(account){
 const response=await request('GET',{},account);
 if(typeof response?.dualSidePosition!=='boolean')throw Error('바이낸스 포지션 모드 응답을 확인할 수 없습니다.');
 return response.dualSidePosition;
}
function status(text,isError=false){message.textContent=text;message.style.color=isError?'#ff9aa7':''}
function setBusy(v){running=v;check.disabled=v;apply.disabled=v}
function accountOrWarn(){
 const a=creds();
 if(!a?.apiKey||!a?.apiSecret){status('설정 > API 키 관리에서 먼저 잠금을 해제해 주세요.',true);return null}
 if(!crypto?.subtle){status('이 브라우저에서는 암호화 API를 사용할 수 없습니다.',true);return null}
 return a;
}
function modeText(dual){return dual?'헤지 모드 (LONG/SHORT 동시)':'단방향 모드'}
check.onclick=async()=>{
 if(running)return;const a=accountOrWarn();if(!a)return;
 setBusy(true);const token=++epoch;status('바이낸스 실제 포지션 모드 조회 중…');
 try{
  const current=await readCurrent(a);
  if(token!==epoch)return;
  selector.value=current?'hedge':'oneway';
  selector.dispatchEvent(new Event('change',{bubbles:true}));
  status('바이낸스 현재 모드: '+modeText(current)+' · 조회 '+new Date().toLocaleTimeString('ko-KR'));
 }catch(err){if(token===epoch)status('조회 실패: '+String(err?.message||err)+' · 브라우저 CORS 또는 API 권한을 확인해 주세요.',true)}
 finally{setBusy(false)}
};
apply.onclick=async()=>{
 if(running)return;const a=accountOrWarn();if(!a)return;
 const dual=selector.value==='hedge';
 if(!dual&&selector.value!=='oneway'){status('포지션 모드 선택값 오류',true);return}
 setBusy(true);const token=++epoch;
 try{
  const before=await readCurrent(a);
  if(token!==epoch)return;
  if(before===dual){status('이미 바이낸스가 '+modeText(dual)+'입니다. 변경할 필요가 없어요.');return}
  if(!confirm('바이낸스 USD-M/COIN-M 선물 계좌 전체를 '+modeText(dual)+'로 변경합니다. 열린 포지션이나 미체결 주문이 있으면 거래소가 변경을 거절합니다. 변경할까요?'))return;
  status('바이낸스 실제 계좌 모드 변경 요청 및 결과 재확인 중…');
  let response;
  try{response=await request('POST',{dualSidePosition:String(dual)},a)}
  catch(err){
   let current;
   try{current=await readCurrent(a)}catch(_){}
   if(token===epoch)status('변경 요청 결과 미확정: '+String(err?.message||err)+
    (typeof current==='boolean'?' · 재조회된 현재 모드: '+modeText(current):' · 바이낸스 앱에서 직접 확인해 주세요.'),true);
   return;
  }
  if(token!==epoch)return;
  if(response?.code!==200)throw Error('거래소 변경 성공 코드 미확인');
  const after=await readCurrent(a);
  if(token!==epoch)return;
  if(after!==dual)throw Error('변경 응답은 받았지만 현재 모드 재확인 결과가 일치하지 않습니다');
  status('실제 바이낸스 선물 계좌 변경 완료: '+modeText(after)+' · '+new Date().toLocaleTimeString('ko-KR'));
  document.getElementById('realAccountRefresh')?.click();
 }catch(err){if(token===epoch)status('적용 실패 또는 확인 불가: '+String(err?.message||err)+' · 포지션/미체결 주문과 API 권한을 확인해 주세요.',true)}
 finally{setBusy(false)}
};
document.addEventListener('visibilitychange',()=>{if(document.hidden){epoch++;status('화면 복귀 후 바이낸스 현재 모드를 다시 확인하세요.')}});
})();
