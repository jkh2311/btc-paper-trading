/* v69: BTCUSDT manual USD-M orders using the existing v61 controls.
   No RMI automatic orders. Credentials stay in the existing in-memory encrypted vault.
   Browser/API connectivity and live fills must be verified by the account owner. */
(()=>{
'use strict';
const $=id=>document.getElementById(id),symbol='BTCUSDT',base='https://fapi.binance.com';
let account=null,selected=null,busy=false,lastRequest=null,lastOrderIssue=false,refreshBusy=false;
const cred=()=>typeof getApiCredentials==='function'?getApiCredentials():null;
const val=id=>Number($(id)?.value),fmt=n=>Number(n).toLocaleString('ko-KR',{maximumFractionDigits:8});
const status=$('realAccountUpdated'),result=document.querySelector('.real-trade-action-result');
function message(text){
 const sheet=$('entrySheet'),help=$('orderHelp');
 if(sheet&&sheet.style.display!=='none'&&help){help.textContent=text;help.style.whiteSpace='pre-line';help.style.color=text.includes('실패')||text.includes('오류')||text.includes('필요')?'#ff9aaa':'#bbd5f1';}
 if(result)result.textContent=text;else if(status)status.textContent=text;
}
function credentials(){const a=cred();if(!a?.apiKey||!a?.apiSecret)throw Error('API 키를 먼저 잠금 해제하세요.');return a;}
function visible(){return document.visibilityState==='visible';}
async function signed(method,path,fields={}){
 const a=credentials(),p=new URLSearchParams({...fields,recvWindow:'5000',timestamp:String(Date.now())});
 const k=await crypto.subtle.importKey('raw',new TextEncoder().encode(a.apiSecret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const sig=await crypto.subtle.sign('HMAC',k,new TextEncoder().encode(p.toString()));
 p.set('signature',Array.from(new Uint8Array(sig),b=>b.toString(16).padStart(2,'0')).join(''));
 const c=new AbortController(),timeout=setTimeout(()=>c.abort(),12000);
 try{
  const hasBody=method==='POST'||method==='PUT';
  const response=await fetch(base+path+(hasBody?'':'?'+p),{
   method,mode:'cors',credentials:'omit',cache:'no-store',redirect:'error',
   headers:{'X-MBX-APIKEY':a.apiKey,...(hasBody?{'Content-Type':'application/x-www-form-urlencoded'}:{})},
   ...(hasBody?{body:p.toString()}:{}),signal:c.signal
  });
  const data=await response.json().catch(()=>null);
  if(!response.ok)throw Error('Binance '+(data?.code??response.status)+' · '+String(data?.msg||response.statusText));
  return data;
 }finally{clearTimeout(timeout);}
}
async function publicJson(path){
 const r=await fetch(base+path,{cache:'no-store'});if(!r.ok)throw Error('시세/필터 HTTP '+r.status);return r.json();
}
async function mode(){const d=await signed('GET','/fapi/v1/positionSide/dual');if(typeof d?.dualSidePosition!=='boolean')throw Error('실제 포지션 모드 확인 실패');return d.dualSidePosition;}
async function filters(){
 const d=await publicJson('/fapi/v1/exchangeInfo?symbol='+symbol);
 const x=d.symbols?.find(s=>s.symbol===symbol),lot=x?.filters?.find(f=>f.filterType==='LOT_SIZE'),market=x?.filters?.find(f=>f.filterType==='MARKET_LOT_SIZE'),price=x?.filters?.find(f=>f.filterType==='PRICE_FILTER'),notional=x?.filters?.find(f=>f.filterType==='MIN_NOTIONAL');
 if(!lot||!price)throw Error('거래소 수량/가격 필터 조회 실패');
 return {lot,market:market&&Number(market.stepSize)>0?market:lot,price,minNotional:Number(notional?.notional||notional?.minNotional||100)};
}
function roundDown(n,step){const s=String(step),digits=s.includes('.')?s.split('.')[1].length:0;return (Math.floor((n+1e-12)/Number(step))*Number(step)).toFixed(Math.min(digits,8));}
async function run(fn){
 if(busy)return;
 busy=true;
 if($('entrySheet')?.style.display!=='none')message('실제 계좌 및 주문 조건 확인 중…');
 for(const id of ['sheetLong','sheetShort','close','cancel'])if($(id))$(id).disabled=true;
 try{await fn();}catch(e){message('실제 거래 요청 실패/확인 필요: '+String(e?.message||e)+'\n주문이 불확실하면 바이낸스에서 확인하기 전 같은 주문을 반복하지 마세요.');}
 finally{busy=false;for(const id of ['sheetLong','sheetShort','cancel'])if($(id))$(id).disabled=false; if($('close'))$('close').disabled=!selected;}
}
function updateButtons(){for(const id of ['long','short'])if($(id))$(id).disabled=false;}
document.addEventListener('btc:real-account-updated',e=>{account=e.detail; if(selected){const p=account?.positions?.find(p=>p.side===selected.positionSide&&Math.abs(Number(p.amount)-Number(selected.amount))<1e-8);if(!p)selected=null;} if($('close'))$('close').disabled=!selected;updateButtons();});
document.addEventListener('btc:real-account-cleared',()=>{account=null;selected=null;});
document.addEventListener('btc:real-position-selected',e=>{selected=e.detail||null;});
function showSheet(side){
 if(!credentialsSafe())return;
 const sh=$('entrySheet');if(!sh)return;
 sh.style.display='block';
 $('sheetLong').style.display=side==='LONG'?'':'none';
 $('sheetShort').style.display=side==='SHORT'?'':'none';
 $('sheetPrice').textContent='BTCUSDT 실제 '+(side==='LONG'?'롱':'숏')+' 주문';
 $('orderHelp').textContent='실제 바이낸스 선물 주문입니다. 지정가 또는 시장가를 선택하세요.';
 sh.dataset.realSide=side;
 const type=document.querySelector('input[name="orderType"]:checked')?.value||'limit';
 if(type==='limit'&&!Number($('limitPrice').value))$('limitPrice').value=String(Number(String($('price')?.textContent||'').replace(/[^0-9.]/g,''))||'');
}
function credentialsSafe(){if(!cred()?.apiKey||!cred()?.apiSecret){message('설정에서 API 키를 잠금 해제한 뒤 실전 주문을 이용하세요.');return false;}return true;}
async function enter(side){
 await run(async()=>{
  if(!account||Date.now()-account.at>30000)throw Error('실제 잔고 조회 후 주문하세요.');
  const dual=await mode(),f=await filters();
  const type=document.querySelector('input[name="orderType"]:checked')?.value==='market'?'MARKET':'LIMIT';
  const quote=Number(String($('price')?.textContent||'').replace(/[^0-9.]/g,''));
  const price=type==='LIMIT'?Number($('limitPrice').value):quote;
  if(!(price>0))throw Error('유효한 현재가/지정가가 필요합니다');
  const lev=val('lev'),count=val('pyramidEntryCount'),stop=val('stop');
  if(!Number.isInteger(lev)||lev<1||lev>125||!Number.isInteger(count)||count<1||count>20||!(stop>0&&stop<=10))throw Error('전략 레버리지/단계/손절 설정 확인');
  const wallet=Number(account.wallet),available=Number(account.available);
  if(!(wallet>0&&available>0))throw Error('주문 가능 증거금 없음');
  const modeSize=$('sizeMode')?.value;
  let totalMargin;
  if(modeSize==='margin'){const pct=val('marginPct');if(!(pct>0&&pct<=100))throw Error('증거금 사용 비율 확인');totalMargin=available*pct/100;}
  else if(modeSize==='risk'){const pct=val('risk');if(!(pct>0&&pct<=5))throw Error('계좌 위험 비율 확인');totalMargin=wallet*(pct/100)/(stop/100)/lev;}
  else throw Error('주문 규모 계산 방식 확인');
  totalMargin=Math.min(totalMargin,available*.95);
  // One order is one pyramid stage; repeated manual entries are explicitly separate orders.
  const weight=1,weightSum=Array.from({length:count},(_,i)=>1+i*.2).reduce((a,b)=>a+b,0);
  const margin=totalMargin*weight/weightSum,lot=type==='MARKET'?f.market:f.lot;
  const qty=roundDown(margin*lev/price,lot.stepSize);
  if(!(Number(qty)>=Number(lot.minQty)&&Number(qty)<=Number(lot.maxQty)))throw Error('바이낸스 최소/최대 주문 수량 불충족: '+qty+' BTC');
  if(Number(qty)*price<f.minNotional)throw Error('최소 주문금액 미달: '+fmt(Number(qty)*price)+' USDT');
  const existing=account.positions.find(p=>p.side===(dual?side:'BOTH')&&Math.abs(Number(p.amount))>0);
  if(existing&&Number(existing.leverage)!==lev)throw Error('실제 기존 포지션 레버리지와 설정값 불일치. 바이낸스 레버리지를 확인하세요.');
  const order={symbol,side:side==='LONG'?'BUY':'SELL',positionSide:dual?side:'BOTH',type,quantity:qty,newOrderRespType:'RESULT',
    newClientOrderId:'btcPwa'+Date.now()+Math.floor(Math.random()*10000)};
  if(type==='LIMIT'){
   const p=roundDown(price,f.price.tickSize);
   if(!(Number(p)>0))throw Error('지정가 호가 단위 오류');
   order.price=p;order.timeInForce='GTC';
  }
  const summary=side+' '+type+' · '+qty+' BTC'+(order.price?' @ '+order.price:'')+' · '+lev+'배 · 예상 증거금 '+fmt(margin)+' USDT\n실제 계좌에 주문하며 손절/익절 보호 주문은 자동 등록되지 않습니다.';
  if(!confirm('바이낸스 실제 주문을 전송할까요?\n'+summary))return;
  // No exchange-side mutation takes place before the user confirms the order.
  if(!existing){
   message('바이낸스 레버리지 확인 및 주문 요청 중…');
   const leverageResult=await signed('POST','/fapi/v1/leverage',{symbol,leverage:String(lev)});
   if(Number(leverageResult?.leverage)!==lev)throw Error('레버리지 재확인 실패');
  }
  lastOrderIssue=true;lastRequest=order.newClientOrderId;
  let response;
  try{response=await signed('POST','/fapi/v1/order',order);}
  catch(e){
   let known=null;try{known=await signed('GET','/fapi/v1/order',{symbol,origClientOrderId:lastRequest});}catch(_){}
   if(!known)throw Error('주문 전송 결과 불확실 · ID '+lastRequest+' · 바이낸스 주문내역에서 먼저 확인하세요. '+e.message);
   response=known;
  }
  lastOrderIssue=false;
  message('실제 주문 확인 · #'+response.orderId+' · '+response.status+' · 체결 '+(response.executedQty||'0')+' BTC\n보호 주문은 자동 등록되지 않습니다.');
  if($('realAccountRefresh'))$('realAccountRefresh').click();
  void updateOpenOrders();
  if($('paperStatsReset')){/* no paper statistics mutation */}
 });
}
async function closeSelected(){
 await run(async()=>{
  const s=selected;if(!s)throw Error('실제 LONG/SHORT 카드를 먼저 선택하세요');
  const dual=await mode();
  // Recheck actual position via account before using stale selected size.
  if($('realAccountRefresh'))$('realAccountRefresh').click();
  const d=await signed('GET','/fapi/v3/positionRisk',{symbol});
  const positions=Array.isArray(d)?d:[d];
  const p=positions.find(p=>p.symbol===symbol&&p.positionSide===(dual?s.side:'BOTH')&&Math.abs(Number(p.positionAmt))>0);
  if(!p)throw Error('실제 청산 대상 포지션 없음');
  const amount=Number(p.positionAmt),isLong=dual?s.side==='LONG':amount>0;
  if((s.side==='LONG')!==isLong)throw Error('선택 포지션 방향이 달라졌습니다.');
  const f=await filters(),qty=roundDown(Math.abs(amount),f.market.stepSize);
  if(!(Number(qty)>0&&Math.abs(Number(qty)-Math.abs(amount))<1e-8))throw Error('청산 수량 필터 불일치 · 바이낸스에서 수량 확인');
  if(!confirm('BTCUSDT 실제 '+s.side+' 포지션 '+qty+' BTC를 시장가로 전량 청산할까요?'))return;
  const id='btcClose'+Date.now()+Math.floor(Math.random()*10000);
  const order={symbol,side:isLong?'SELL':'BUY',positionSide:dual?s.side:'BOTH',type:'MARKET',quantity:qty,newClientOrderId:id,newOrderRespType:'RESULT'};
  if(!dual)order.reduceOnly='true';
  let res;
  try{res=await signed('POST','/fapi/v1/order',order);}
  catch(e){
   try{res=await signed('GET','/fapi/v1/order',{symbol,origClientOrderId:id});}
   catch(_){throw Error('청산 응답 미확정 · 바이낸스에서 ID '+id+'를 확인하세요. '+e.message);}
  }
  message('실제 청산 주문 #'+res.orderId+' · '+res.status+' · 체결 '+(res.executedQty||'0')+' BTC\n미체결/잔여 포지션은 다시 조회하세요.');
  selected=null;
  $('realAccountRefresh')?.click();
  void updateOpenOrders();
 });
}
async function cancelOrders(){
 await run(async()=>{
  const normal=await signed('GET','/fapi/v1/openOrders',{symbol});
  const algo=await signed('GET','/fapi/v1/openAlgoOrders',{symbol}).catch(()=>null);
  if(!Array.isArray(normal))throw Error('일반 미체결 주문 응답 오류');
  if(algo!==null&&!Array.isArray(algo?.orders)&&!Array.isArray(algo))throw Error('조건부 주문 응답 오류');
  const algoOrders=Array.isArray(algo)?algo:algo?.orders||[];
  if(!normal.length&&!algoOrders.length){message('실제 미체결 주문 0건 · 일반/조건부 주문 확인'+(algo===null?' (조건부 조회 실패)':''));return;}
  if(!confirm('BTCUSDT 실제 미체결 일반 '+normal.length+'건'+(algo===null?' · 조건부 주문은 조회 불가':', 조건부 '+algoOrders.length+'건')+'을 모두 취소할까요?\n손절/익절 주문도 취소될 수 있습니다.'))return;
  let normalResult='없음',algoResult=algo===null?'조회 불가':'없음';
  if(normal.length){try{await signed('DELETE','/fapi/v1/allOpenOrders',{symbol});normalResult='취소 요청 수락';}catch(e){normalResult='취소 실패/확인 필요: '+e.message;}}
  if(algoOrders.length){try{await signed('DELETE','/fapi/v1/algoOpenOrders',{symbol});algoResult='취소 요청 수락';}catch(e){algoResult='취소 실패/확인 필요: '+e.message;}}
  message('BTCUSDT 실전 주문 취소 · 일반: '+normalResult+' · 조건부: '+algoResult+'\n잔여 주문은 바이낸스에서 다시 확인하세요.');
  $('realAccountRefresh')?.click();
 });
}
// Reuse the v61 expandable trade-history area; no extra trading dashboard.
const historyContent=$('page-history')?.querySelector('.paper-history-content');
const orderList=document.createElement('div');
orderList.id='realOpenOrdersList';
orderList.setAttribute('aria-live','polite');
orderList.style.cssText='margin:10px 0 14px';
if(historyContent){
 const oldPending=$('manualPendingHistory');
 if(oldPending)oldPending.insertAdjacentElement('beforebegin',orderList);
 else historyContent.prepend(orderList);
}
let listedOrders=null,orderListError='',orderCancelBusy=false,orderReadGeneration=0;
function formatOpenOrder(o){
 const side=o.positionSide==='LONG'?'롱 LONG':o.positionSide==='SHORT'?'숏 SHORT':o.side==='BUY'?'롱 BUY':'숏 SELL';
 const remaining=Math.max(0,Number(o.origQty)-Number(o.executedQty));
 return {side,remaining,price:Number(o.price),qty:Number(o.origQty)};
}
function showOpenOrders(orders,error=''){
 if(error){
  orderListError=error;
  orderList.textContent='실제 미체결 주문 조회 실패 · 마지막 목록은 최신 정보가 아닙니다. '+error;
  return;
 }
 orderListError='';
 listedOrders=orders;
 orderList.replaceChildren();
 const title=document.createElement('div');
 title.style.cssText='font-size:13px;font-weight:750;color:#dbe7f8;margin:5px 0 9px';
 title.textContent='실제 BTCUSDT 미체결 주문 · '+orders.length+'건';
 orderList.append(title);
 if(!orders.length){
  const empty=document.createElement('p');empty.className='muted';
  empty.textContent='현재 일반 미체결 주문이 없습니다. (조건부·Algo 주문은 별도)';
  orderList.append(empty);return;
 }
 for(const o of orders){
  if(o.symbol!==symbol||!Number.isSafeInteger(Number(o.orderId)))continue;
  const details=formatOpenOrder(o);
  const row=document.createElement('div');
  row.style.cssText='display:flex;align-items:center;justify-content:space-between;gap:8px;padding:9px 5px;border-bottom:1px solid #314665';
  const info=document.createElement('div');
  info.style.cssText='font-size:12px;min-width:0;line-height:1.6;overflow-wrap:anywhere';
  const heading=document.createElement('b');
  heading.textContent=details.side+' · '+o.type+' · '+String(o.status||'미체결');
  heading.style.color=o.side==='BUY'?'#4ed6a6':'#ff869b';
  const description=document.createElement('div');
  description.textContent='주문 #'+o.orderId+' · '+fmt(details.remaining)+' / '+fmt(details.qty)+' BTC 남음 · '+fmt(details.price)+' USDT';
  info.append(heading,description);
  const cancel=document.createElement('button');
  cancel.type='button';cancel.textContent='개별 취소';
  cancel.disabled=orderCancelBusy||!!orderListError;
  cancel.style.cssText='flex-shrink:0;padding:8px 10px;font-size:12px';
  cancel.onclick=()=>void cancelSingleOrder(o.orderId);
  row.append(info,cancel);orderList.append(row);
 }
}
async function fetchOpenOrders(){
 const data=await signed('GET','/fapi/v1/openOrders',{symbol});
 if(!Array.isArray(data)||data.some(o=>o?.symbol!==symbol||!Number.isSafeInteger(Number(o.orderId))))
  throw Error('바이낸스 미체결 주문 데이터 확인 실패');
 return data;
}
async function updateOpenOrders(){
 const generation=++orderReadGeneration;
 try{
  const data=await fetchOpenOrders();
  if(generation===orderReadGeneration&&!orderCancelBusy)showOpenOrders(data);
 }catch(e){
  if(generation===orderReadGeneration&&!orderCancelBusy)showOpenOrders([],String(e?.message||e));
 }
}
async function cancelSingleOrder(orderId){
 if(orderCancelBusy||busy||orderListError)return;
 // Recheck the order directly before asking for permission to cancel it.
 orderCancelBusy=true;
 const generation=++orderReadGeneration;
 try{
  const before=await fetchOpenOrders();
  const target=before.find(o=>String(o.orderId)===String(orderId));
  if(!target){showOpenOrders(before);return;}
  const details=formatOpenOrder(target);
  if(!confirm('바이낸스 실제 주문 #'+orderId+'만 취소할까요?\n'+details.side+' · '+fmt(details.remaining)+' BTC · '+target.type+' @ '+fmt(details.price)+' USDT\n다른 주문은 유지됩니다.')){showOpenOrders(before);return;}
  orderList.textContent='바이낸스 주문 #'+orderId+' 개별 취소 요청 중…';
  let response=null,requestError=null;
  try{response=await signed('DELETE','/fapi/v1/order',{symbol,orderId:String(orderId)});}
  catch(e){requestError=e;}
  // A timeout or CORS error does not tell us whether Binance canceled the order.
  let after=null;
  try{after=await fetchOpenOrders();}catch(e){
   orderList.textContent='취소 결과 미확정 · 주문 #'+orderId+' · 바이낸스 앱에서 주문 상태를 확인하세요. '+String(e?.message||e);
   return;
  }
  if(generation!==orderReadGeneration)return;
  showOpenOrders(after);
  const stillOpen=after.some(o=>String(o.orderId)===String(orderId));
  const text=stillOpen?'취소 미완료 또는 응답 지연 · 주문 #'+orderId+'가 아직 미체결 목록에 있습니다.':
   requestError?'주문 #'+orderId+'가 미체결 목록에서 사라졌습니다. 취소 여부와 체결 여부는 바이낸스 거래내역에서 확인하세요.':
   response?.status==='CANCELED'?'주문 #'+orderId+' 실제 취소 확인 (CANCELED)':
   '주문 #'+orderId+'가 미체결 목록에서 사라졌습니다. 최종 상태는 바이낸스에서 확인하세요.';
  const note=document.createElement('p');note.className='muted';note.style.cssText='font-size:11px;line-height:1.6';
  note.textContent=text;orderList.append(note);
 }catch(e){
  orderList.textContent='개별 취소를 진행할 수 없습니다 · '+String(e?.message||e);
 }finally{
  orderCancelBusy=false;
  // Restore per-order button state on next five-second account refresh.
 }
}
if(historyContent){
 orderList.textContent='실제 미체결 주문 조회 전 · API 잠금 해제 후 자동 갱신';
}

let lastOrdersStatus=0;
async function refreshLoop(){
 if(!visible()||refreshBusy||busy||!credentialsSafeSilent())return;
 refreshBusy=true;
 try{
  $('realAccountRefresh')?.click();
  // Keep calls sequential and skip overlapping requests; app suspension stops timers.
  {
   const button=[...document.querySelectorAll('#page-history button')].find(e=>e.textContent.includes('실제 체결 내역 조회'));
   button?.click();
  }
  if(Date.now()-lastOrdersStatus>5000){
   await updateOpenOrders();
   lastOrdersStatus=Date.now();
   const note=$('realAccountUpdated');
   if(note&&Array.isArray(listedOrders)&&!orderListError)note.title='BTCUSDT 일반 미체결 '+listedOrders.length+'건 · '+new Date().toLocaleTimeString('ko-KR');
  }
 }catch(e){console.warn('실계좌 자동 조회 실패:',e.message)}
 finally{refreshBusy=false;}
}
function credentialsSafeSilent(){const a=cred();return !!(a?.apiKey&&a?.apiSecret);}
for(const [id,side] of [['long','LONG'],['short','SHORT']]){
 const b=$(id);if(!b)continue;b.disabled=false;b.onclick=()=>showSheet(side);
}
for(const [id,side] of [['sheetLong','LONG'],['sheetShort','SHORT']])if($(id))$(id).onclick=()=>enter(side);
if($('close')){$('close').textContent='포지션 선택 후 청산';$('close').onclick=closeSelected;}
if($('cancel')){$('cancel').textContent='대기 주문 취소';$('cancel').onclick=cancelOrders;}
$('sheetPrice').textContent='실제 BTCUSDT 주문';
$('orderHelp').textContent='실제 선물 주문 · 지정가/시장가 · 바이낸스 주문 응답을 확인합니다.';
const note=document.querySelector('.real-account-note');
if(note)note.textContent='앱 실행·활성 상태에서 실계좌를 약 5초마다 자동 조회합니다. 백그라운드 상태에서는 갱신하지 않습니다.';
const auto=setInterval(refreshLoop,5000);
document.addEventListener('btc:credentials-unlocked',()=>void refreshLoop());
document.addEventListener('visibilitychange',()=>{if(visible())void refreshLoop();});
window.addEventListener('focus',()=>{void refreshLoop();});
setTimeout(()=>{if(credentialsSafeSilent())void refreshLoop();},500);
})();
