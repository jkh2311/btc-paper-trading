/* v342. Shared Binance auto-PROTECTION read backoff.
   Scope: only automatic TP/SL verification and orphan-order maintenance.
   Never masks a real order result or changes trading/credential behavior. */
(()=>{
'use strict';
const KEY='btc-protection-read-ban-until-v342';
let until=0;
try{until=Number(localStorage.getItem(KEY))||0}catch(_){}
function remember(error){
 const msg=String(error?.message||error||'');
 if(!/(?:Binance\s*)?-1003|(?:HTTP|Binance)\s*(?:418|429)|banned until/i.test(msg))return false;
 const found=Number(msg.match(/banned until\s+(\d{13})/i)?.[1]);
 const deadline=found>Date.now()?found:Date.now()+5*60000;
 until=Math.max(until,deadline);
 try{localStorage.setItem(KEY,String(until))}catch(_){}
 return true;
}
function active(){return Date.now()<until}
function message(){
 if(!active())return '';
 return '⚠ 바이낸스 요청 제한으로 익절·손절 자동 확인 일시 중지 ('+
  new Date(until).toLocaleString('ko-KR')+'까지) · 기존 거래소 주문은 변경하지 않았습니다. 바이낸스에서 직접 상태를 확인하세요.';
}
window.btcProtectionReadBackoff=Object.freeze({remember,active,message,until:()=>until});
window.addEventListener('storage',e=>{
 if(e.key===KEY&&Number(e.newValue)>until)until=Number(e.newValue);
});
})();