/* Live order safety journal v12. NO order creation, retry, cancellation or modification.
 * Feature 1: durable client IDs and fail-closed duplicate/unknown guard.
 * Feature 2: protective-order failure recovery through read-only venue checks.
 * Idempotence is local to this browser origin; multi-device coordination is NOT provided.
 */
(()=>{
'use strict';
const page=document.getElementById('page-position');
if(!page)return;
const KEY='btc-live-safety-journal-v1',MAX=16;
const STOPPED=new Set(['UNKNOWN','PROTECTION_UNKNOWN','PROTECTION_MISSING','RECONCILE_REQUIRED']);
const allowed=new Set(['PREPARED','UNKNOWN','RECONCILE_REQUIRED','PROTECTION_UNKNOWN','PROTECTION_MISSING','VERIFIED_CLOSED']);
const make=(tag,content)=>{const e=document.createElement(tag);if(content!==undefined)e.textContent=String(content);return e};
const section=make('section');section.className='direct-live';
const title=make('h2','중복 주문 방지 · 보호 주문 복구 점검');
const note=make('p','실제 거래를 실행하지 않는 안전 검증 화면입니다. 앱을 껐다 켜도 주문 식별자와 미확인 상태를 저장하여 새 주문을 막고, 바이낸스에 먼저 조회하도록 설계했어요.');
const bar=make('div');bar.className='row';
const prepare=make('button','신규 식별자 준비');prepare.type='button';
const recovery=make('button','거래소에 미확인 주문 조회');recovery.type='button';
const status=make('p','실제 계좌 조회 후 준비할 수 있어요.');status.setAttribute('role','status');
const list=make('div');
const warning=make('p','보호 주문이 조회되지 않거나 조회에 실패하면 신규 진입 금지 상태로 유지해야 합니다. 이 앱에서는 위험한 자동 재시도, 자동 청산, 실제 주문 전송을 하지 않아요.');
bar.append(prepare,recovery);section.append(title,note,bar,status,list,warning);
page.append(section);
const css=make('style');css.textContent='.direct-live .safety-entry{background:#0a1a2d;border:1px solid #556b88;border-radius:10px;padding:10px;margin:8px 0}.direct-live .safety-entry small{display:block;font-size:11px;color:#afc5db;white-space:pre-line;line-height:1.6}.direct-live .safety-alert{color:#ffadad}.direct-live .safety-ok{color:#c6e6ce}';
document.head.append(css);
let draft=null,account=null,busy=false,epoch=0;
const validId=v=>typeof v==='string'&&/^btc[a-z0-9_-]{6,32}$/.test(v);
const validStatus=v=>allowed.has(v);
function load(){
 try{
  const values=JSON.parse(localStorage.getItem(KEY)||'[]');
  if(!Array.isArray(values))throw Error('format');
  return values.slice(0,MAX).filter(v=>v&&validId(v.entryId)&&validId(v.stopId)&&validId(v.takeId)&&validStatus(v.status)&&
    Number.isFinite(v.createdAt)&&v.symbol==='BTCUSDT').map(v=>({
      entryId:v.entryId,stopId:v.stopId,takeId:v.takeId,status:v.status,
      createdAt:v.createdAt,updatedAt:Number(v.updatedAt)||v.createdAt,
      details:typeof v.details==='string'?v.details.slice(0,200):''
    }));
 }catch(_){return null}
}
let records=load(),corrupted=records===null;
if(corrupted)records=[];
const save=()=>{
 try{localStorage.setItem(KEY,JSON.stringify(records));return true}
 catch(_){corrupted=true;status.className='safety-alert';status.textContent='기기에 주문 안전기록을 저장할 수 없습니다. 신규 주문 진행 금지.';return false}
};
const isBlocked=()=>corrupted||records.some(x=>x.status!=='VERIFIED_CLOSED');
const credentials=()=>typeof getApiCredentials==='function'?getApiCredentials():null;
function render(){
 list.replaceChildren();
 for(const rec of records){
  const box=make('article');box.className='safety-entry';
  const header=make('b',rec.status+' · '+new Date(rec.createdAt).toLocaleString('ko-KR'));
  const info=make('small',[
    '진입 Client ID: '+rec.entryId,
    '손절 Client Algo ID: '+rec.stopId,
    '익절 Client Algo ID: '+rec.takeId,
    '메모: '+(rec.details||'거래소에서 확인 전')
  ].join('\n'));
  box.append(header,info);
  const close=make('button','거래소에서 종료 확인 후 기록 표시');
  close.type='button';close.disabled=rec.status==='VERIFIED_CLOSED';
  close.onclick=()=>{
   if(!confirm('바이낸스 앱에서 진입 주문이 종료되고, 해당 주문으로 열린 포지션도 없으며, 남은 보호 주문이 없는 상태를 모두 확인했나요?\n확인되지 않았다면 절대 기록을 해제하지 마세요.'))return;
   if(!confirm('주의: 이 버튼은 거래소를 조회해 검증하지 않고 사용자의 확인에 따라 기록만 종료 표시합니다. 신규 주문 중복 차단이 풀릴 수 있어요. 계속할까요?'))return;
   rec.status='VERIFIED_CLOSED';rec.updatedAt=Date.now();rec.details='사용자 직접 확인에 따른 기록 종료 (자동 검증 아님)';
   save();render();
  };
  box.append(close);list.append(box);
 }
 const blocked=isBlocked();
 prepare.disabled=busy||blocked||!draft||!account;
 recovery.disabled=busy||!records.some(x=>x.status!=='VERIFIED_CLOSED');
 status.className=blocked?'safety-alert':'safety-ok';
 status.textContent=corrupted?'기존 기록 오류. 주문 잠금 유지 · 데이터 보존 후 수동 복구 필요':
  blocked?'미확인 주문 또는 보호 주문 있음 · 신규 진입 잠금':
  records.length?'기록상 미확인 주문 없음 (거래소 전체 계좌 확인을 의미하지 않음)':
  '주문 안전기록 없음 · 실제 계좌를 먼저 조회하세요';
}
function newIds(){
 const random=new Uint8Array(10);crypto.getRandomValues(random);
 const id=[...random].map(v=>v.toString(16).padStart(2,'0')).join('');
 const base='btc'+id;
 return {entryId:base+'e',stopId:base+'s',takeId:base+'t'};
}
document.addEventListener('btc:entry-draft-validated',e=>{
 const v=e.detail;
 if(v?.symbol!=='BTCUSDT'||!['LONG','SHORT'].includes(v.side)||!(v.quantity>0))return;
 draft={side:v.side,quantity:v.quantity,price:v.price,at:Date.now()};
 render();
});
document.addEventListener('btc:live-account-read',e=>{
 account={at:Date.now(),positions:e.detail?.positions||[]};draft=null;render();
});
prepare.onclick=()=>{
 if(busy||isBlocked()||!draft||!account)return;
 if(Date.now()-draft.at>60000||Date.now()-account.at>60000){
  draft=null;render();status.textContent='최근 60초 안에 실제 계좌 조회와 주문 수량 재검증 필요';return;
 }
 if(records.length>=MAX){status.textContent='안전 기록 최대 '+MAX+'건. 저장 데이터 백업 및 검토 필요.';return}
 const ids=newIds(),stamp=Date.now();
 if(records.some(x=>Object.values(x).includes(ids.entryId))){status.textContent='ID 충돌. 재시도 전 기록 확인';return}
 const rec={...ids,symbol:'BTCUSDT',status:'PREPARED',createdAt:stamp,updatedAt:stamp,
   details:'주문 ID 준비만 완료 · 거래소 주문은 제출되지 않음'};
 records.unshift(rec);
 if(!save()){records.shift();return}
 draft=null;render();
 status.textContent='클라이언트 주문 ID 세트 준비 완료. 주문 전송 0건. 실제 제출 코드가 연결되기 전까지는 기록만 남아요.';
};
async function signedRead(method,params,creds){
 const input={apiKey:creds.apiKey,recvWindow:5000,timestamp:Date.now(),symbol:'BTCUSDT',...params};
 const query=Object.keys(input).sort().map(k=>k+'='+encodeURIComponent(input[k])).join('&');
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(creds.apiSecret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const sig=new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(query)));
 input.signature=Array.from(sig,b=>b.toString(16).padStart(2,'0')).join('');
 return directBinanceWS(method,input,status,12000);
}
async function algoRead(clientAlgoId,creds,signal){
 const params=new URLSearchParams({clientAlgoId,recvWindow:'5000',timestamp:String(Date.now())});
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(creds.apiSecret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const sig=new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(params.toString())));
 params.set('signature',Array.from(sig,b=>b.toString(16).padStart(2,'0')).join(''));
 const response=await fetch('https://fapi.binance.com/fapi/v1/algoOrder?'+params.toString(),{
  method:'GET',mode:'cors',cache:'no-store',credentials:'omit',redirect:'error',
  headers:{'X-MBX-APIKEY':creds.apiKey},signal
 });
 if(!response.ok)throw Error('Algo 조회 HTTP '+response.status);
 const data=await response.json();
 if(data?.symbol!=='BTCUSDT'||data?.clientAlgoId!==clientAlgoId)throw Error('Algo ID 응답 불일치');
 return data;
}
recovery.onclick=async()=>{
 if(busy||corrupted)return;
 const creds=credentials();
 if(!creds?.apiKey||!creds?.apiSecret){status.textContent='먼저 설정에서 API 키 잠금 해제 필요';return}
 busy=true;const current=++epoch;render();
 try{
  for(const rec of records.filter(x=>x.status!=='VERIFIED_CLOSED')){
   if(document.hidden||current!==epoch)break;
   let order='조회되지 않음',stop='조회되지 않음',take='조회되지 않음';
   try{
    const x=await signedRead('order.status',{origClientOrderId:rec.entryId},creds);
    if(x?.symbol!=='BTCUSDT'||x?.clientOrderId!==rec.entryId)throw Error('진입 ID 불일치');
    order=x.status+' / 체결 '+String(x.executedQty);
   }catch(_){order='미확인 (미접수 확정 아님)'}
   for(const [name,clientId] of [['stop',rec.stopId],['take',rec.takeId]]){
    if(current!==epoch||document.hidden)break;
    try{
     const controller=new AbortController();
     const timer=setTimeout(()=>controller.abort(),9000);
     let x;try{x=await algoRead(clientId,creds,controller.signal)}finally{clearTimeout(timer)}
     if(name==='stop')stop=x.algoStatus||'상태 누락';
     else take=x.algoStatus||'상태 누락';
    }catch(_){if(name==='stop')stop='미확인 (재주문 금지)';else take='미확인 (재주문 금지)'}
   }
   if(current!==epoch)break;
   rec.status='RECONCILE_REQUIRED';rec.updatedAt=Date.now();
   rec.details=('진입 '+order+' · 손절 '+stop+' · 익절 '+take).slice(0,200);
   if(!save())break;
   render();
  }
 }finally{
  busy=false;render();
  if(current!==epoch||document.hidden)return;
  status.textContent='조회 결과는 진입/손절/익절 주문 유무를 보장하지 않습니다. 미확인이나 조회 실패 시 바이낸스 앱에서 실제 포지션 및 모든 보호 주문 확인이 필요합니다. 자동 재주문 없음.';
 }
};
function lock(){
 epoch++;draft=null;account=null;render();
}
document.addEventListener('btc:live-lock',lock);
document.addEventListener('visibilitychange',()=>{if(document.hidden)lock()});
window.addEventListener('pagehide',lock);
window.addEventListener('storage',event=>{
 if(event.key!==KEY)return;
 // Multi-tab updates are not an atomic lock. Fail closed until re-open/review.
 corrupted=true;draft=null;account=null;epoch++;
 status.className='safety-alert';
 render();
 status.textContent='다른 탭/창에서 안전 기록 변경 감지 · 이 화면의 신규 진입 잠금. 모든 앱 창을 종료하고 다시 열어 거래소 상태를 확인하세요.';
});
render();
})();