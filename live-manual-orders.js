/* v69: BTCUSDT manual USD-M orders using the existing v61 controls.
   No RMI automatic orders. Credentials stay in the existing in-memory encrypted vault.
   Browser/API connectivity and live fills must be verified by the account owner. */
(()=>{
'use strict';
const $=id=>document.getElementById(id),symbol='BTCUSDT',base='https://fapi.binance.com';
let account=null,selected=null,busy=false,lastRequest=null,lastOrderIssue=false,refreshBusy=false;
let confirmedLeverage=null,leverageBusy=false;
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
const leverageButton=$('applyRealLeverage'),leverageStatus=$('realLeverageStatus');
function showLeverageStatus(value){if(leverageStatus)leverageStatus.textContent=value;}
function invalidateLeverage(value='레버리지 적용 확인 필요'){confirmedLeverage=null;showLeverageStatus(value);}
$('lev')?.addEventListener('input',()=>invalidateLeverage('변경됨 · 바이낸스 적용 필요'));
document.addEventListener('btc:real-account-cleared',()=>invalidateLeverage('계좌 재연결 후 레버리지 확인 필요'));
async function verifyLeverage(expected){
 // Position Risk V3 omits symbols without an open position or open orders.
 // Symbol configuration reports the leverage even when BTCUSDT is flat.
 const response=await signed('GET','/fapi/v1/symbolConfig',{symbol});
 const rows=Array.isArray(response)?response:[response];
 const matching=rows.filter(x=>x?.symbol===symbol);
 if(matching.length!==1||!Number.isInteger(Number(matching[0].leverage)))
  throw Error('바이낸스 BTCUSDT 설정 조회 실패 · 레버리지 미확인');
 const actual=Number(matching[0].leverage);
 if(actual!==expected)
  throw Error('설정 '+expected+'배 / 바이낸스 '+actual+'배 · 적용 후 재확인하세요');
 return true;
}
let leverageCheckBusy=false;
async function checkExistingLeverage(){
 if(leverageCheckBusy||leverageBusy||busy)return;
 const a=cred(),expected=val('lev');
 if(!a?.apiKey||!a?.apiSecret||!Number.isInteger(expected)||expected<1||expected>50)return;
 leverageCheckBusy=true;
 try{
  await verifyLeverage(expected);
  confirmedLeverage={value:expected,apiKey:a.apiKey,at:Date.now()};
  showLeverageStatus('✓ 바이낸스 '+expected+'배 확인');
 }catch(e){
  if(confirmedLeverage?.value===expected&&confirmedLeverage.apiKey===a.apiKey){
   showLeverageStatus('이전 '+expected+'배 적용 확인 · 재조회 실패');
  }else showLeverageStatus('바이낸스 적용 확인 필요 · 적용 버튼을 누르세요');
 }finally{leverageCheckBusy=false;}
}
document.addEventListener('btc:credentials-unlocked',()=>setTimeout(checkExistingLeverage,350));
setTimeout(checkExistingLeverage,1500);
if(leverageButton)leverageButton.onclick=async()=>{
 if(leverageBusy||busy)return;
 const lev=val('lev'),saved=cred();
 if(!saved?.apiKey||!saved?.apiSecret){showLeverageStatus('API 잠금 해제 필요');return;}
 if(!Number.isInteger(lev)||lev<1||lev>50){showLeverageStatus('레버리지는 1~50배로 설정하세요');return;}
 if(!confirm('바이낸스 BTCUSDT 실제 레버리지를 '+lev+'배로 미리 적용할까요?'))return;
 leverageBusy=true;leverageButton.disabled=true;invalidateLeverage('바이낸스 레버리지 적용 중…');
 try{
  const applied=await signed('POST','/fapi/v1/leverage',{symbol,leverage:String(lev)});
  if(Number(applied?.leverage)!==lev)throw Error('바이낸스 레버리지 적용 응답 불일치');
  await verifyLeverage(lev);
  confirmedLeverage={value:lev,apiKey:saved.apiKey,at:Date.now()};
  showLeverageStatus('✓ 바이낸스 '+lev+'배 적용·재조회 확인');
 }catch(e){showLeverageStatus('적용 확인 실패: '+String(e?.message||e));}
 finally{leverageBusy=false;leverageButton.disabled=false;}
};
document.addEventListener('btc:real-account-updated',e=>{account=e.detail; if(selected){const p=account?.positions?.find(p=>p.side===selected.positionSide&&Math.abs(Number(p.amount)-Number(selected.amount))<1e-8);if(!p)selected=null;} if($('close'))$('close').disabled=!selected;updateButtons();});
document.addEventListener('btc:real-account-cleared',()=>{account=null;selected=null;});
document.addEventListener('btc:real-position-selected',e=>{selected=e.detail||null;});
// Count manual stage reservations independently of Binance's merged directional positions.
const stageLedgerKey='btc-manual-stage-ledger-v1';
function stageAccountId(){
 const key=cred()?.apiKey||'';let h=2166136261;
 for(let i=0;i<key.length;i++)h=Math.imul(h^key.charCodeAt(i),16777619);
 return String(h>>>0);
}
function stageRecords(){
 try{const all=JSON.parse(localStorage.getItem(stageLedgerKey)||'{}');return all[stageAccountId()]||{LONG:[],SHORT:[]};}
 catch(_){return {LONG:[],SHORT:[]};}
}
function saveStageRecord(side,order){
 const all=stageRecords(),entries=Array.isArray(all[side])?all[side]:[];
 entries.push({id:String(order.orderId),time:Date.now(),stop:Number($('stop').value),rr:Number($('rr').value),hold:Number($('hold').value)});all[side]=entries.slice(-20);
 try{const base=JSON.parse(localStorage.getItem(stageLedgerKey)||'{}');base[stageAccountId()]=all;localStorage.setItem(stageLedgerKey,JSON.stringify(base));}
 catch(_){}
}
async function usedManualStages(side,dual){
 const live=await currentManualPositions(),open=await fetchOpenOrders();
 const records=stageRecords(),entries=Array.isArray(records[side])?records[side]:[];
 const position=live.some(p=>dual?p.positionSide===side:
  p.positionSide==='BOTH'&&(side==='LONG'?Number(p.positionAmt)>0:Number(p.positionAmt)<0));
 const sideOrders=open.filter(o=>dual?o.positionSide===side:o.side===(side==='LONG'?'BUY':'SELL'));
 const activeIds=new Set(sideOrders.map(o=>String(o.orderId)));
 const retained=[];
 for(const item of entries){
  if(activeIds.has(String(item.id))){retained.push(item);continue;}
  try{
   const state=await signed('GET','/fapi/v1/order',{symbol,orderId:String(item.id)});
   if(Number(state.executedQty)>0&&position||['NEW','PARTIALLY_FILLED'].includes(state.status))retained.push(item);
  }catch(_){retained.push(item);}
 }
 const counted=new Set(retained.map(x=>String(x.id)));
 const external=sideOrders.filter(o=>!counted.has(String(o.orderId))).length;
 if(!position&&!sideOrders.length)retained.length=0;
 if(retained.length!==entries.length){
  const data=stageRecords();data[side]=retained;
  try{const all=JSON.parse(localStorage.getItem(stageLedgerKey)||'{}');all[stageAccountId()]=data;localStorage.setItem(stageLedgerKey,JSON.stringify(all));}catch(_){}
 }
 return Math.max(position?1:0,retained.length)+external;
}
async function currentManualPositions(){
 const data=await signed('GET','/fapi/v3/positionRisk',{symbol});
 const rows=Array.isArray(data)?data:[data];
 if(rows.some(p=>p?.symbol!==symbol))throw Error('포지션 응답 오류');
 return rows.filter(p=>Math.abs(Number(p.positionAmt))>0);
}

// Share the chart's actual Binance futures WebSocket trade stream with this order
// sheet. The displayed live quote is separate from the order's LIMIT price.
// Editing the LIMIT price freezes only that field, not the moving live quote.
let sheetQuoteGeneration=0,sheetPriceEdited=false,sheetQuoteBusy=false,sheetQuoteLastAt=0;
let chartLimitPriceMode=false,entrySheetOriginalPosition=null;
function restoreChartLimitSheet(){
 const sh=$('entrySheet');if(!sh)return;
 sh.classList.remove('chart-price-entry-sheet');
 if(entrySheetOriginalPosition){
  const {parent,next}=entrySheetOriginalPosition;
  if(parent?.isConnected)parent.insertBefore(sh,next?.parentNode===parent?next:null);
  entrySheetOriginalPosition=null;
 }
 chartLimitPriceMode=false;
 for(const radio of document.querySelectorAll('input[name="orderType"]'))radio.disabled=false;
 if(typeof quoteReset!=='undefined'&&quoteReset)quoteReset.style.display='';
}
document.addEventListener('btc:chart-price-limit-entry',e=>{
 const data=e.detail;
 if(!data||data.symbol!=='BTCUSDT'||!['LONG','SHORT'].includes(data.side)||
    !Number.isFinite(data.price)||!(data.price>0)||busy)return;
 showSheet(data.side,data.price);
});
$('sheetCancel')?.addEventListener('click',restoreChartLimitSheet);

let liveQuote={price:NaN,at:0},sheetTick=NaN,sheetTickDigits=1,lastQuotePaint=0;
const limitInput=$('limitPrice'),sheetPriceHeader=$('sheetPrice');
const liveQuoteView=document.createElement('div');
liveQuoteView.setAttribute('aria-label','바이낸스 BTCUSDT 실시간 현재가');
liveQuoteView.style.cssText='margin:9px 0 4px;padding:8px 10px;border:1px solid #305d77;border-radius:9px;background:#0a2036;display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap';
const liveQuoteLabel=document.createElement('small');
liveQuoteLabel.textContent='실시간 현재가';
liveQuoteLabel.style.cssText='color:#aec8df;font-size:11px';
const liveQuoteValue=document.createElement('strong');
liveQuoteValue.textContent='연결 중…';
liveQuoteValue.style.cssText='color:#6de5bf;font-size:20px;font-variant-numeric:tabular-nums';
liveQuoteView.append(liveQuoteLabel,liveQuoteValue);
sheetPriceHeader?.insertAdjacentElement('afterend',liveQuoteView);
const quoteReset=document.createElement('button');
quoteReset.type='button';quoteReset.textContent='현재가 적용';
quoteReset.style.cssText='font-size:12px;min-height:32px;padding:5px 12px;margin:6px 0 3px';
const quoteState=document.createElement('span');
quoteState.className='muted';quoteState.style.cssText='font-size:11px;margin-left:8px';
quoteState.textContent='';
if(limitInput){
 limitInput.insertAdjacentElement('afterend',quoteReset);
 quoteReset.insertAdjacentElement('afterend',quoteState);
 limitInput.addEventListener('input',()=>{
  sheetPriceEdited=true;
  quoteState.textContent='직접 입력한 지정가 고정 · 현재가는 계속 표시';
 });
}
const limitOrderSelected=()=>document.querySelector('input[name="orderType"]:checked')?.value!=='market';
const isSheetOpen=()=>{const e=$('entrySheet');return !!e&&e.style.display!=='none'&&e.dataset.realSide;};
function followQuote(){
 if(!isSheetOpen()||!limitOrderSelected()||sheetPriceEdited||!limitInput||
    !(sheetTick>0)||!(liveQuote.price>0)||Date.now()-liveQuote.at>3500)return;
 limitInput.value=(Math.round(liveQuote.price/sheetTick)*sheetTick).toFixed(sheetTickDigits);
 sheetQuoteLastAt=Date.now();
 quoteState.textContent='실시간 현재가 연동 · 직접 수정하면 지정가 고정';
}
function displayLiveQuote(){
 if(!isSheetOpen())return;
 const fresh=liveQuote.price>0&&Date.now()-liveQuote.at<=3500;
 liveQuoteValue.textContent=fresh?
  liveQuote.price.toLocaleString('ko-KR',{minimumFractionDigits:1,maximumFractionDigits:2})+' USDT':
  '실시간 연결 확인 중…';
 liveQuoteValue.style.color=fresh?'#6de5bf':'#f5bb75';
 if(fresh)followQuote();
}
let activeCloseEditor=null;
document.addEventListener('btc:live-trade-price',e=>{
 const d=e.detail;
 if(d?.symbol!==symbol||!(Number(d.price)>0)||!Number.isFinite(Number(d.at)))return;
 liveQuote={price:Number(d.price),at:Number(d.at)};
 activeCloseEditor?.paint();
 if(!isSheetOpen()||Date.now()-lastQuotePaint<90)return;
 lastQuotePaint=Date.now();displayLiveQuote();
});
async function ensureSheetTick(){
 if(sheetTick>0)return;
 const f=await filters(),tick=Number(f.price.tickSize);
 if(!(tick>0))throw Error('지정가 호가 단위 조회 실패');
 sheetTick=tick;
 sheetTickDigits=Math.min(8,(String(f.price.tickSize).split('.')[1]||'').length);
}
async function updateLimitQuote(force=false){
 if(sheetQuoteBusy||!isSheetOpen()||!limitOrderSelected()||!limitInput)return;
 if(sheetPriceEdited&&!force)return;
 sheetQuoteBusy=true;
 const generation=sheetQuoteGeneration;
 try{
  await ensureSheetTick();
  if(generation!==sheetQuoteGeneration||!isSheetOpen()||sheetPriceEdited&&!force)return;
  // Prefer sub-second WebSocket trade ticks; REST is for stream interruptions.
  if(liveQuote.price>0&&Date.now()-liveQuote.at<=3500){
   if(force)sheetPriceEdited=false;
   displayLiveQuote();followQuote();return;
  }
  const data=await publicJson('/fapi/v1/ticker/price?symbol='+symbol);
  if(generation!==sheetQuoteGeneration||!isSheetOpen()||sheetPriceEdited&&!force)return;
  const price=Number(data?.price),stamp=Number(data?.time);
  if(data?.symbol!==symbol||!(price>0)||!Number.isFinite(price)||
    (stamp>0&&Math.abs(Date.now()-stamp)>30000))
   throw Error('최신 BTCUSDT 시세를 확인할 수 없습니다');
  if(force)sheetPriceEdited=false;
  // REST fallback shows a reference price, not a live WebSocket tick.
  limitInput.value=(Math.round(price/sheetTick)*sheetTick).toFixed(sheetTickDigits);
  sheetQuoteLastAt=Date.now();
  quoteState.textContent='최근 조회가 반영 · 실시간 스트림 재연결 중';
  displayLiveQuote();
 }catch(e){
  if(generation===sheetQuoteGeneration&&!sheetPriceEdited){
   if(Date.now()-sheetQuoteLastAt>10000)limitInput.value='';
   quoteState.textContent='시세 조회 실패 · 가격을 직접 입력하세요';
  }
 }finally{sheetQuoteBusy=false;}
}
function showSheet(side,chartPrice=null){
 if(!credentialsSafe())return;
 restoreChartLimitSheet();
 const sh=$('entrySheet');if(!sh)return;
 const chartSelected=Number.isFinite(chartPrice)&&chartPrice>0;
 if(chartSelected){
  // Expanded charts live in a separate fullscreen layer. Move the existing
  // REAL order sheet to document.body so it remains visible in either mode.
  entrySheetOriginalPosition={parent:sh.parentNode,next:sh.nextSibling};
  document.body.appendChild(sh);
  sh.classList.add('chart-price-entry-sheet');
  chartLimitPriceMode=true;
  const limit=document.querySelector('input[name="orderType"][value="limit"]');
  if(limit)limit.checked=true;
  const market=document.querySelector('input[name="orderType"][value="market"]');
  if(market)market.disabled=true;
  quoteReset.style.display='none';
 }
 sh.style.display='block';
 $('sheetLong').style.display=side==='LONG'?'':'none';
 $('sheetShort').style.display=side==='SHORT'?'':'none';
 $('sheetPrice').textContent='BTCUSDT 실제 '+(side==='LONG'?'롱':'숏')+' 주문';
 $('orderHelp').textContent=chartSelected?
   '실전 예약 지정가 · Post Only(즉시 체결 방지) · 수량은 설정값으로 계산 · 아래 실제 진입 버튼을 누르면 바이낸스에 전송됩니다.':
   '실전 주문 · 지정가 / 시장가';
 sh.dataset.realSide=side;
 sheetQuoteGeneration++;sheetPriceEdited=chartSelected;sheetQuoteLastAt=0;
 if(limitInput)limitInput.value=chartSelected?chartPrice.toFixed(1):'';
 quoteState.textContent=chartSelected?'차트에서 선택한 지정가 · 직접 변경 가능 · 시장가 전환 불가':
   '최신 지정가 불러오는 중…';
 displayLiveQuote();
 if(!chartSelected)void updateLimitQuote();
}
quoteReset.onclick=()=>{
 if(!isSheetOpen()||chartLimitPriceMode)return;
 sheetPriceEdited=false;sheetQuoteGeneration++;sheetQuoteLastAt=0;
 if(limitInput)limitInput.value='';
 quoteState.textContent='실시간 현재가 다시 적용 중…';
 displayLiveQuote();
 void updateLimitQuote(true);
};
for(const radio of document.querySelectorAll('input[name="orderType"]')){
 radio.addEventListener('change',()=>{
  if(!isSheetOpen())return;
  if(chartLimitPriceMode){document.querySelector('input[name="orderType"][value="limit"]').checked=true;return;}
  displayLiveQuote();
  if(!limitOrderSelected())return;
  sheetQuoteGeneration++;sheetPriceEdited=false;sheetQuoteLastAt=0;
  if(limitInput)limitInput.value='';
  void updateLimitQuote();
 });
}
setInterval(()=>{
 if(!isSheetOpen())return;
 displayLiveQuote();
 if(limitOrderSelected()&&!sheetPriceEdited&&
  Date.now()-sheetQuoteLastAt>=3000)void updateLimitQuote();
},1000);

function credentialsSafe(){if(!cred()?.apiKey||!cred()?.apiSecret){message('설정에서 API 키를 잠금 해제한 뒤 실전 주문을 이용하세요.');return false;}return true;}
async function enter(side){
 await run(async()=>{
  if(!account||Date.now()-account.at>30000)throw Error('실제 잔고 조회 후 주문하세요.');
  const dual=await mode(),f=await filters();
  const type=document.querySelector('input[name="orderType"]:checked')?.value==='market'?'MARKET':'LIMIT';
  const quote=Number(String($('price')?.textContent||'').replace(/[^0-9.]/g,''));
  const price=type==='LIMIT'?Number($('limitPrice').value):quote;
  if(chartLimitPriceMode&&type!=='LIMIT')throw Error('차트 예약진입은 지정가만 가능합니다.');
  if(!(price>0))throw Error('유효한 현재가/지정가가 필요합니다');
  const lev=val('lev'),count=val('pyramidEntryCount'),stop=val('stop');
  if(!confirmedLeverage||confirmedLeverage.value!==lev||confirmedLeverage.apiKey!==cred()?.apiKey)
   throw Error('설정에서 바이낸스 레버리지 적용을 먼저 눌러 확인해 주세요.');
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
  const used=await usedManualStages(side,dual);
  if(used>=count)throw Error('실계좌 보유/미체결 기준 '+count+'단계 한도에 도달했습니다.');
  const weights=Array.from({length:count},(_,i)=>1+i*.2);
  const margin=totalMargin*weights[used]/weights.slice(used).reduce((a,b)=>a+b,0);
  const lot=type==='MARKET'?f.market:f.lot;
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
   order.price=p;order.timeInForce=chartLimitPriceMode?'GTX':'GTC';
  }
  // The second, explicitly labeled REAL LONG/SHORT entry button submits
  // immediately after exchange/account/size checks, without a native confirm.
  // run() already locks both buttons until this request finishes to prevent
  // accidental double submissions from rapid taps.
  message('실제 '+(side==='LONG'?'롱':'숏')+' '+type+' 주문 전송 중… · '+qty+' BTC'+(order.price?' @ '+order.price+' USDT':''));
  // Leverage was explicitly applied and verified in Settings. Do not change it during entry.
  lastOrderIssue=true;lastRequest=order.newClientOrderId;
  let response;
  try{response=await signed('POST','/fapi/v1/order',order);}
  catch(e){
   // Binance -5022 is a definitive Post Only rejection (would trade
   // immediately). Do not mask it as uncertain or retry as market order.
   if(chartLimitPriceMode&&String(e?.message||'').includes('-5022')){
    lastOrderIssue=false;
    throw Error('예약 지정가가 즉시 체결될 수 있어 바이낸스가 거절했습니다(-5022). 다른 가격을 선택하세요.');
   }
   let known=null;try{known=await signed('GET','/fapi/v1/order',{symbol,origClientOrderId:lastRequest});}catch(_){}
   if(!known)throw Error('주문 전송 결과 불확실 · ID '+lastRequest+' · 바이낸스 주문내역에서 먼저 확인하세요. '+e.message);
   response=known;
  }
  lastOrderIssue=false;
  if(response?.orderId&& !['REJECTED','CANCELED','EXPIRED'].includes(response.status))saveStageRecord(side,response);
  message('실제 주문 확인 · #'+response.orderId+' · '+response.status+' · 체결 '+(response.executedQty||'0')+' BTC\n보호 주문은 자동 등록되지 않습니다.');
  if($('realAccountRefresh'))$('realAccountRefresh').click();
  void updateOpenOrders();
  if($('paperStatsReset')){/* no paper statistics mutation */}
 });
}
// The selected-position action places a user-priced LIMIT close. The individual
// card button remains a fast MARKET close. Both recheck the live exchange position.
function chooseLiveClosePrice(side,qty,initialPrice,tick,digits){
 // Display the same trade stream as the chart; editable LIMIT only freezes on input.
 return new Promise(resolve=>{
  if(activeCloseEditor){resolve(null);return;}
  const overlay=document.createElement('div');
  overlay.style.cssText='position:fixed;inset:0;z-index:99999;background:rgba(3,9,19,.82);display:flex;align-items:center;justify-content:center;padding:16px;padding-bottom:calc(16px + env(safe-area-inset-bottom))';
  const dialog=document.createElement('div');
  dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');
  dialog.setAttribute('aria-label',side+' 지정가 청산 가격 선택');
  dialog.style.cssText='background:#14243e;color:#e7edf8;border:1px solid #456280;border-radius:18px;padding:18px;width:min(100%,440px);max-height:90dvh;overflow-y:auto;box-shadow:0 15px 70px #0009;font-family:-apple-system,BlinkMacSystemFont,sans-serif';
  const title=document.createElement('strong');title.textContent='BTCUSDT '+side+' 지정가 청산';
  title.style.cssText='font-size:19px;display:block;margin-bottom:7px';
  const quantity=document.createElement('p');quantity.textContent='선택 포지션 '+qty+' BTC · 전량 지정가 청산';
  quantity.style.cssText='font-size:13px;color:#aac0d9;margin:0 0 15px';
  const priceBox=document.createElement('div');
  priceBox.style.cssText='background:#0b1b30;border:1px solid #36506d;border-radius:12px;padding:13px 15px;margin-bottom:12px';
  const caption=document.createElement('div');caption.textContent='실시간 현재가 · 바이낸스 체결가';
  caption.style.cssText='font-size:12px;color:#aabed6;margin-bottom:6px';
  const live=document.createElement('strong');live.textContent='실시간 시세 연결 중…';
  live.style.cssText='font-size:24px;font-variant-numeric:tabular-nums;color:#55dcac;display:block';
  priceBox.append(caption,live);
  const label=document.createElement('label');label.textContent='청산 주문 지정가 (USDT)';
  label.style.cssText='display:block;font-size:13px;color:#b7cce4;margin-bottom:7px';
  const input=document.createElement('input');input.type='text';input.inputMode='decimal';input.autocomplete='off';
  input.style.cssText='font-size:22px;color:#fff;background:#294364;border:1px solid #567598;border-radius:12px;padding:12px 13px;width:100%;box-sizing:border-box;font-variant-numeric:tabular-nums';
  const info=document.createElement('div');info.textContent='현재가 자동 연동 · 가격을 수정하면 지정가 고정';
  info.style.cssText='font-size:11px;color:#afc6de;margin-top:7px;min-height:16px';
  const actions=document.createElement('div');actions.style.cssText='display:flex;gap:8px;flex-wrap:wrap;margin-top:16px';
  const now=document.createElement('button');now.type='button';now.textContent='현재가 적용';
  const cancel=document.createElement('button');cancel.type='button';cancel.textContent='취소';
  const accept=document.createElement('button');accept.type='button';accept.textContent='지정가 청산 확인';
  const switchAction=document.createElement('button');switchAction.type='button';
  switchAction.textContent=side==='SHORT'?'청산 및 롱 스위칭 전환':'청산 및 숏 스위칭 전환';
  for(const button of [now,cancel,accept,switchAction])button.style.cssText='flex:1 1 auto;padding:12px 8px;min-height:43px;color:#fff;background:#294363;border:1px solid #4b6b89;border-radius:10px;font-size:13px';
  accept.style.background='#146753';accept.style.borderColor='#40ad8d';
  switchAction.style.cssText='flex:1 1 100%;padding:12px 8px;min-height:44px;background:#234d72;border:1px solid #5886b2;border-radius:10px;color:#fff;font-size:13px;font-weight:700';
  actions.append(now,cancel,accept,switchAction);
  const warning=document.createElement('p');
  warning.textContent='지정가 청산은 거래소 지정가 주문입니다. 스위칭 전환은 별도의 가격 감시 설정을 열며, 조건 충족 시 시장가 청산 후 반대 진입을 시도합니다. 스위칭은 앱이 활성 상태일 때만 감시합니다.';
  warning.style.cssText='font-size:11px;line-height:1.5;color:#b5cbe2;margin:11px 0 0';
  dialog.append(title,quantity,priceBox,label,input,info,actions,warning);
  overlay.append(dialog);document.body.append(overlay);
  let edited=false,closed=false;
  const snap=price=>(Math.round(price/tick)*tick).toFixed(digits);
  function paint(){
   const fresh=liveQuote.price>0&&Date.now()-liveQuote.at<=3500;
   live.textContent=fresh?liveQuote.price.toLocaleString('ko-KR',{minimumFractionDigits:1,maximumFractionDigits:2})+' USDT':'실시간 연결 확인 중…';
   live.style.color=fresh?'#55dcac':'#f5ba75';
   if(!edited&&fresh){input.value=snap(liveQuote.price);info.textContent='실시간 현재가 연동 · 직접 수정하면 지정가 고정';}
  }
  function finish(value){
   if(closed)return;closed=true;
   document.removeEventListener('keydown',keyHandler,true);
   if(activeCloseEditor?.paint===paint)activeCloseEditor=null;
   overlay.remove();resolve(value);
  }
  const keyHandler=e=>{if(e.key==='Escape'){e.preventDefault();finish(null);}};
  document.addEventListener('keydown',keyHandler,true);
  input.addEventListener('input',()=>{edited=true;info.textContent='입력한 지정가 고정 · 실시간 현재가는 계속 표시';});
  now.onclick=()=>{if(!(liveQuote.price>0&&Date.now()-liveQuote.at<=3500)){info.textContent='실시간 연결 확인 후 다시 눌러 주세요';return;}edited=false;paint();};
  cancel.onclick=()=>finish(null);
  accept.onclick=()=>{const value=input.value.trim();if(!value){info.textContent='지정가를 입력하세요';return;}finish(value);};
  switchAction.onclick=()=>{const value=input.value.trim();if(!value){info.textContent='전환 목표 가격을 입력하세요';return;}finish({switchPrice:value});};
  activeCloseEditor={paint};
  if(initialPrice>0)input.value=snap(initialPrice);
  paint();
 });
}
async function closeSelected(orderKind='LIMIT'){
 await run(async()=>{
  const selection=selected;
  if(!selection||!['LONG','SHORT'].includes(selection.side))
   throw Error('실제 LONG/SHORT 카드를 먼저 선택하세요');
  if(!['LIMIT','MARKET'].includes(orderKind))throw Error('지원하지 않는 청산 방식');
  const dual=await mode();
  const d=await signed('GET','/fapi/v3/positionRisk',{symbol});
  const positions=Array.isArray(d)?d:[d];
  const p=positions.find(p=>p.symbol===symbol&&p.positionSide===(dual?selection.side:'BOTH')&&Math.abs(Number(p.positionAmt))>0);
  if(!p)throw Error('실제 청산 대상 포지션 없음');
  const amount=Number(p.positionAmt),isLong=dual?selection.side==='LONG':amount>0;
  if((selection.side==='LONG')!==isLong)throw Error('선택 포지션 방향이 달라졌습니다.');
  const f=await filters(),lot=orderKind==='LIMIT'?f.lot:f.market;
  const qty=roundDown(Math.abs(amount),lot.stepSize);
  if(!(Number(qty)>0&&Math.abs(Number(qty)-Math.abs(amount))<1e-8))
   throw Error('청산 수량 필터 불일치 · 바이낸스에서 수량 확인');

  const exitSide=isLong?'SELL':'BUY',positionSide=dual?selection.side:'BOTH';
  // An already-open reduce-only close must not be duplicated (hedge can reject
  // or fill a second close independently). Ask user to cancel it first.
  const open=await signed('GET','/fapi/v1/openOrders',{symbol});
  if(!Array.isArray(open))throw Error('미체결 청산 주문 조회 실패');
  const otherClose=open.find(o=>o.symbol===symbol&&o.side===exitSide&&
   o.positionSide===positionSide&&(
    dual||o.reduceOnly===true||o.reduceOnly==='true'||o.closePosition===true));
  if(otherClose)throw Error('동일 방향 미체결 청산 주문 #'+otherClose.orderId+
   '이 있습니다. 거래내역에서 기존 청산 주문을 확인/취소하세요.');

  let price=null;
  if(orderKind==='LIMIT'){
   const tick=Number(f.price.tickSize);
   const digits=Math.min(8,(String(f.price.tickSize).split('.')[1]||'').length);
   if(!(tick>0))throw Error('지정가 호가 단위 조회 실패');
   const proposed=Number(p.markPrice)>0?Number(p.markPrice):Number(selection.mark);
   const defaultPrice=proposed>0?(Math.round(proposed/tick)*tick).toFixed(digits):'';
   const typed=await chooseLiveClosePrice(selection.side,qty,Number(defaultPrice),tick,digits);
   if(typed===null)return;
   const switchRequested=typeof typed==='object'&&typeof typed.switchPrice==='string';
   const chosenPrice=switchRequested?typed.switchPrice:typed;
   // iOS prompts can include grouping commas and surrounding whitespace.
   // Validate a numeric USDT price, never silently interpret extra text or currency units.
   const cleanPrice=chosenPrice.trim().replace(/,/g,'').replace(/\s+/g,'');
   if(!/^\d+(?:\.\d+)?$/.test(cleanPrice))
    throw Error('지정가는 숫자로 입력하세요. 예: 79650.5 USDT');
   const n=Number(cleanPrice),steps=Math.round(n/tick);
   if(!Number.isFinite(n)||n<=0||steps<1||Math.abs(n-steps*tick)>Math.max(1e-8,tick*1e-6))
    throw Error('바이낸스 지정가 호가 단위 '+f.price.tickSize+' USDT에 맞게 입력하세요');
   price=(steps*tick).toFixed(digits);
   if(Number(f.price.minPrice)>0&&Number(price)<Number(f.price.minPrice)||
      Number(f.price.maxPrice)>0&&Number(price)>Number(f.price.maxPrice))
    throw Error('거래소 지정가 허용 범위를 벗어났습니다');
   if(switchRequested){
    if(typeof window.btcOpenSwitch!=='function')
     throw Error('스위칭 설정 모듈을 확인하지 못했습니다. 주문은 실행되지 않았습니다');
    // Open the existing live switch setup; do not place a LIMIT close order.
    window.btcOpenSwitch(selection,Number(price));
    return;
   }
  }
  // The explicit LIMIT editor's "지정가 청산" action is the final user
  // approval. No additional browser confirm; keep exchange revalidation,
  // duplicate-order guard, and the existing run() submission lock.
  // Preserve an explicit confirm for MARKET close requests.
  if(orderKind==='MARKET'&&!confirm(
   'BTCUSDT '+selection.side+' 포지션 '+qty+' BTC 시장가 전량 청산 요청을 전송할까요?\n체결가는 현재 가격과 다를 수 있습니다.'
  ))return;

  // The price dialog may have remained open while the exchange position changed.
  // Check the exact position amount again before submitting a closing order.
  const finalData=await signed('GET','/fapi/v3/positionRisk',{symbol});
  const finalRows=Array.isArray(finalData)?finalData:[finalData];
  const finalPosition=finalRows.find(x=>x.symbol===symbol&&x.positionSide===positionSide&&Math.abs(Number(x.positionAmt))>0);
  if(!finalPosition||Math.abs(Math.abs(Number(finalPosition.positionAmt))-Number(qty))>1e-8)
   throw Error('청산창을 여는 동안 보유 수량이 바뀌었습니다. 다시 조회 후 시도하세요.');
  const id='btcClose'+Date.now()+Math.floor(Math.random()*10000);
  const order={symbol,side:exitSide,positionSide,type:orderKind,quantity:qty,
   newClientOrderId:id,newOrderRespType:'RESULT'};
  if(!dual)order.reduceOnly='true';
  if(orderKind==='LIMIT'){order.price=price;order.timeInForce='GTC';}
  let res;
  try{res=await signed('POST','/fapi/v1/order',order);}
  catch(e){
   try{res=await signed('GET','/fapi/v1/order',{symbol,origClientOrderId:id});}
   catch(_){throw Error('청산 주문 응답 미확정 · 바이낸스에서 ID '+id+'를 확인하세요. '+e.message);}
  }
  const status=String(res?.status||'UNKNOWN'),filled=Number(res?.executedQty||0);
  message((orderKind==='LIMIT'?'지정가':'시장가')+' 청산 주문 #'+res.orderId+' · '+status+
    ' · 체결 '+(Number.isFinite(filled)?filled:0)+' / '+qty+' BTC\n'+
    (status==='FILLED'?'체결 보고됨 · 잔여 포지션 재조회':
     orderKind==='LIMIT'?'미체결/부분체결 시 거래내역에서 대기 주문을 확인하거나 개별 취소하세요.':
     '체결 상태 및 잔여 포지션을 다시 확인하세요.'));
  $('realAccountRefresh')?.click();
  void updateOpenOrders();
 });
}
document.addEventListener('btc:real-close-requested',e=>{
 const requested=e.detail;
 if(!requested||!['LONG','SHORT'].includes(requested.side)||busy)return;
 selected=requested;
 void closeSelected('MARKET');
});
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
if($('close')){$('close').textContent='선택 포지션 지정가 청산';$('close').onclick=()=>void closeSelected('LIMIT');}
if($('cancel')){$('cancel').textContent='대기 주문 취소';$('cancel').onclick=cancelOrders;}
$('sheetPrice').textContent='실제 BTCUSDT 주문';
$('orderHelp').textContent='실전 주문 · 지정가 / 시장가';
const note=document.querySelector('.real-account-note');
if(note)note.textContent='앱 활성 중 5초 갱신';
const auto=setInterval(refreshLoop,5000);
document.addEventListener('btc:credentials-unlocked',()=>void refreshLoop());
document.addEventListener('visibilitychange',()=>{if(visible())void refreshLoop();});
window.addEventListener('focus',()=>{void refreshLoop();});
setTimeout(()=>{if(credentialsSafeSilent())void refreshLoop();},500);
})();
