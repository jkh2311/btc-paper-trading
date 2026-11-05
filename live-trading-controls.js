/* v67: Restore familiar position actions, show actual Binance positions/orders,
 * bind real USDT and strategy fields to READ-ONLY manual/RMI trade previews.
 * No order.place, order.cancel, position-close or automatic order transmission.
 */
(()=>{
'use strict';
const $=id=>document.getElementById(id);
const section=$('paperPositionCard'),settings=$('page-settings');
if(!section||!settings)return;
const create=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=String(text);if(cls)e.className=cls;return e};
const style=create('style');
style.textContent=[
'body.real-position-ready #page-position #paperPositionCard>.row{display:flex!important;gap:8px}',
'body.real-position-ready #page-position #paperPositionCard>.row button{flex:1;min-width:0}',
'.real-trade-action-result{background:#0b1b31;border:1px solid #385271;padding:12px;border-radius:12px;line-height:1.65;font-size:12px;white-space:pre-line;margin-top:10px}',
'.real-strategy-preview{background:#0b1b31;border:1px solid #385271;padding:12px;border-radius:12px;white-space:pre-line;font-size:12px;line-height:1.7;margin-top:10px}',
'.real-balance-note{font-size:11px;color:#abc4df;line-height:1.5}'
].join('\n');
document.head.append(style);
const close=$('close'),cancel=$('cancel');
const result=create('div','실제 포지션을 선택하면 청산할 수량과 방향을 확인할 수 있어요.','real-trade-action-result');
result.setAttribute('role','status');
const row=close?.parentElement;if(row){row.insertAdjacentElement('afterend',result)}
if(close){close.type='button';close.textContent='포지션 선택 후 청산';close.disabled=true}
if(cancel){cancel.type='button';cancel.textContent='대기 주문 취소';cancel.disabled=false}
let account=null,selected=null;
const value=x=>x===null||x===undefined||x===''?NaN:Number(x);
const fmt=(v,n=6)=>Number.isFinite(v)?v.toLocaleString('ko-KR',{maximumFractionDigits:n}):'—';
const fresh=a=>a&&Date.now()-a.at<60000;
const credential=()=>typeof getApiCredentials==='function'?getApiCredentials():null;
function reset(){
 account=null;selected=null;
 if(close)close.disabled=true;
 result.textContent='실제 계좌 재조회가 필요합니다. 오래된 포지션으로 청산 주문을 만들지 않습니다.';
 resetBalance();
}
document.addEventListener('btc:real-position-selected',e=>{
 const p=e.detail;
 selected=p&&['LONG','SHORT'].includes(p.side)?p:null;
 if(close)close.disabled=!selected;
 result.textContent=selected?'선택 '+selected.side+' · '+fmt(Math.abs(value(selected.amount)),8)+' BTC · 청산 계획을 확인하려면 버튼을 누르세요.':'포지션을 선택해 주세요.';
});
document.addEventListener('btc:real-account-updated',e=>{
 const d=e.detail;
 if(!d||!Number.isFinite(d.at)||!Array.isArray(d.positions))return;
 account={at:d.at,wallet:value(d.wallet),available:value(d.available),positions:d.positions};
 selected=null;if(close)close.disabled=true;
 result.textContent='실제 계좌 '+new Date(d.at).toLocaleTimeString('ko-KR')+' 조회 · 포지션을 선택하거나 대기 주문을 확인해 주세요.';
 updateBalance();
});
document.addEventListener('btc:real-account-cleared',reset);
const balance=$('balance');
const originalLabel=balance?.closest('label')||balance?.previousElementSibling;
if(originalLabel&&originalLabel.tagName==='LABEL')originalLabel.textContent='실제 계좌 USDT';
if(balance){balance.value='';balance.readOnly=true;balance.placeholder='바이낸스 실제 잔고 조회 후 표시';balance.setAttribute('aria-label','바이낸스 실제 USDT 잔고, 읽기 전용')}
const note=create('p','실제 바이낸스 선물 계좌 조회값입니다. 조회 전에는 가상 잔고를 표시하지 않습니다.','real-balance-note');
if(balance)balance.insertAdjacentElement('afterend',note);
function updateBalance(){
 if(!balance)return;
 balance.value=fresh(account)&&Number.isFinite(account.wallet)?account.wallet.toFixed(2):'';
 note.textContent=fresh(account)?
  '바이낸스 실제 총 USDT '+fmt(account.wallet,4)+' · 주문 가능 '+fmt(account.available,4)+
  ' USDT · 마지막 조회 '+new Date(account.at).toLocaleTimeString('ko-KR'):
  '실제 계좌 조회 전 · API 키 잠금 해제 후 포지션 탭에서 새로고침하세요.';
}
function resetBalance(){if(balance)balance.value='';note.textContent='실제 계좌 연결 해제 · 재조회 필요'}
if(close)close.onclick=()=>{
 if(!fresh(account)||!selected||Math.abs(account.at-selected.accountAt)>1000){
  result.textContent='실제 계좌를 다시 조회하고 포지션을 선택해야 합니다.';return;
 }
 const p=account.positions.find(p=>
  p.side===selected.positionSide&&Math.abs(value(p.amount)-value(selected.amount))<1e-8);
 if(!p){result.textContent='선택 포지션이 최신 조회 목록과 맞지 않습니다. 재조회하세요.';return}
 const qty=Math.abs(value(p.amount)),exit=selected.side==='LONG'?'SELL':'BUY';
 if(!(qty>0)){result.textContent='실제 보유 수량 확인 실패';return}
 result.textContent='실제 청산 주문 확인\n'+selected.side+' · '+fmt(qty,8)+' BTC\n거래소 청산 방향: '+
  exit+' / positionSide '+selected.positionSide+(selected.positionSide==='BOTH'?' / reduceOnly=true':'')+
  '\n이 화면에서는 청산 주문을 보내지 않습니다. 실제 청산은 바이낸스 앱에서 확인 후 실행해 주세요.';
};
if(cancel)cancel.onclick=async()=>{
 if(!credential()?.apiKey||!credential()?.apiSecret){
  result.textContent='실제 미체결 주문을 보려면 API 키를 잠금 해제해 주세요.';return;
 }
 cancel.disabled=true;result.textContent='바이낸스 실제 BTCUSDT 미체결 주문 조회 중…';
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),11000);
 try{
  const creds=credential();
  const params=new URLSearchParams({symbol:'BTCUSDT',recvWindow:'5000',timestamp:String(Date.now())});
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(creds.apiSecret),
   {name:'HMAC',hash:'SHA-256'},false,['sign']);
  const signature=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(params.toString()));
  params.set('signature',[...new Uint8Array(signature)].map(x=>x.toString(16).padStart(2,'0')).join(''));
  const resp=await fetch('https://fapi.binance.com/fapi/v1/openOrders?'+params.toString(),{
   method:'GET',headers:{'X-MBX-APIKEY':creds.apiKey},credentials:'omit',cache:'no-store',
   mode:'cors',redirect:'error',signal:controller.signal
  });
  if(!resp.ok)throw Error('바이낸스 응답 HTTP '+resp.status);
  const orders=await resp.json();
  if(!Array.isArray(orders)||orders.some(o=>o.symbol!=='BTCUSDT'))throw Error('미체결 주문 응답 오류');
  result.textContent=orders.length?
   '실제 BTCUSDT 미체결 주문 '+orders.length+'건\n'+orders.slice(0,10).map(o=>
    '#'+o.orderId+' · '+o.side+' '+o.type+' · '+fmt(value(o.origQty),8)+
    ' BTC @ '+fmt(value(o.price),2)+' USDT').join('\n')+
    '\n실제 취소는 아직 미연결입니다. 바이낸스 앱에서 주문 ID를 확인해 취소해 주세요.':
   '바이낸스 일반 미체결 주문 0건 (조건부 Algo 주문은 별도 조회 필요)';
 }catch(err){result.textContent='실제 미체결 조회 실패 · 주문 없음으로 단정할 수 없습니다.\n'+String(err?.message||err)}
 finally{clearTimeout(timer);cancel.disabled=false}
};
// The preserved v61 settings remain editable, but calculate an exchange-account
// plan separately rather than pretending editing fields changes Binance leverage.
const settingsCard=balance?.closest('.card');
if(settingsCard){
 const button=create('button','실제 계좌 기준 전략 수량 계산');button.type='button';
 const output=create('div','실제 잔고 조회 후 기존 레버리지·6단계·손절·손익비 설정으로 주문 계획을 계산할 수 있어요.','real-strategy-preview');
 output.setAttribute('role','status');
 settingsCard.append(button,output);
 const plan=()=>{
  if(!fresh(account)||!(account.available>0)){output.textContent='실제 계좌가 최신 상태가 아닙니다. 먼저 바이낸스 잔고를 조회하세요.';return}
  const lev=value($('lev')?.value),count=value($('pyramidEntryCount')?.value),
   stop=value($('stop')?.value),rr=value($('rr')?.value),
   price=value(String($('price')?.textContent||'').replace(/[^0-9.]/g,''));
  if(!(lev>=1&&lev<=125&&Number.isInteger(lev)&&count>=1&&count<=20&&Number.isInteger(count)&&
    stop>0&&stop<=10&&rr>0&&rr<=10&&price>0)){
   output.textContent='레버리지·진입 개수·손절 거리·손익비·시세를 확인해 주세요.';return;
  }
  const mode=$('sizeMode')?.value,marginPct=value($('marginPct')?.value),
   riskPct=value($('risk')?.value),hold=value($('hold')?.value);
  if(!['risk','margin'].includes(mode)||!(hold>=1&&hold<=24)){
   output.textContent='포지션 크기 계산 방식과 최대 보유 시간을 확인해 주세요.';return;
  }
  let desiredMargin;
  if(mode==='margin'){
   if(!(marginPct>0&&marginPct<=100)){output.textContent='증거금 사용 비율은 0~100% 범위에서 설정해 주세요.';return}
   desiredMargin=account.available*marginPct/100;
  }else{
   if(!(riskPct>0&&riskPct<=5)){output.textContent='계좌 위험 비율은 0~5% 범위에서 설정해 주세요.';return}
   desiredMargin=account.wallet*(riskPct/100)/(stop/100)/lev;
  }
  const usable=Math.min(desiredMargin,account.available*.95);
  if(!(usable>0)){output.textContent='실제 사용 가능한 증거금 없음';return}
  const weights=Array.from({length:count},(_,i)=>1+i*.2);
  const total=weights.reduce((a,b)=>a+b,0);
  const side=($('paperPositionMode')?.value==='oneway'?'단방향':'헤지');
  const stages=weights.slice(0,10).map((w,i)=>{
   const margin=usable*w/total;
   return (i+1)+'단계 · 예상 증거금 '+fmt(margin,2)+' USDT · '+fmt(margin*lev/price,8)+' BTC';
  });
  output.textContent='실제 잔고 기준 주문 계획 · 실제 주문 전송 없음\n실제 사용 가능 '+fmt(account.available,2)+
   ' USDT / 계산 증거금 '+fmt(usable,2)+' USDT (최대 가용 잔고 95%)\n'+
   (mode==='margin'?'남은 증거금 사용 비율 '+fmt(marginPct,2)+'%':'1회 계좌 위험 '+fmt(riskPct,2)+'% (수수료·슬리피지 제외 추산)')+
   '\n현재 입력 레버리지 '+lev+
   '배 (바이낸스 설정 변경 아님) · '+side+'\n'+
   stages.join('\n')+(count>10?'\n… 나머지 '+(count-10)+'단계':'' )+
   '\n손절 '+fmt(stop,2)+'% · 목표 손익비 '+fmt(rr,2)+' · 최대 보유 '+hold+'시간'+
   '\n실제 거래소 수량 필터·호가/레버리지 재검증 전의 계산 결과입니다.';
 };
 button.onclick=plan;
 const autoLabel=create('p','RMI AUTO ON은 신호 관찰용입니다. 이 전략값은 수동매매 계획에 활용하며 실제 주문 전송이나 레버리지 변경은 하지 않습니다.','real-balance-note');
 settingsCard.append(autoLabel);
}
// Keep the last known account snapshot across brief app switches; freshness is checked before use.
})();
