/* v74 manual trade supervision: Binance-hosted stop/take-profit; foreground max hold.
   No automatic entries. Only trades recorded by this PWA are managed. */
(()=>{
'use strict';
const $=id=>document.getElementById(id),symbol='BTCUSDT',base='https://fapi.binance.com';
const keyName='btc-manual-stage-ledger-v1';
const aiSplitKey='btc-ai-three-tp-plans-v1';
function splitPlan(side){
 try{
  const all=JSON.parse(localStorage.getItem(aiSplitKey)||'{}');
  const plan=all[tag()]?.[side];
  return plan&&['PREPARING','ACTIVE','CANCELLING','ERROR'].includes(plan.state)?plan:null;
 }catch(_){return null}
}

let busy=false,deviceId='',lastRun=0;
function tag(){
 const api=getApiCredentials()?.apiKey||'';let h=2166136261;
 for(let i=0;i<api.length;i++)h=Math.imul(h^api.charCodeAt(i),16777619);
 return String(h>>>0);
}
function records(){
 try{const raw=JSON.parse(localStorage.getItem(keyName)||'{}');return raw[tag()]||{LONG:[],SHORT:[]};}
 catch(_){return {LONG:[],SHORT:[]};}
}
function persist(x){
 try{const all=JSON.parse(localStorage.getItem(keyName)||'{}');all[tag()]=x;localStorage.setItem(keyName,JSON.stringify(all));}
 catch(_){}
}
const note=document.createElement('div');
note.className='muted';note.style.cssText='font-size:11px;line-height:1.5;margin-top:9px;white-space:pre-line';
note.textContent='실전 손절/익절 보호 확인 전 · 앱 실행 중 보유시간 감시';
$('paperPositionCard')?.append(note);
async function signed(method,path,values={}){
 const c=getApiCredentials();if(!c?.apiKey||!c?.apiSecret)throw Error('API 잠금 해제 필요');
 const p=new URLSearchParams({...values,recvWindow:'5000',timestamp:String(Date.now())});
 const k=await crypto.subtle.importKey('raw',new TextEncoder().encode(c.apiSecret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const sig=await crypto.subtle.sign('HMAC',k,new TextEncoder().encode(p.toString()));
 p.set('signature',Array.from(new Uint8Array(sig),x=>x.toString(16).padStart(2,'0')).join(''));
 const body=method==='POST'||method==='PUT';
 const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),12000);
 try{
  const r=await fetch(base+path+(body?'':'?'+p.toString()),{method,headers:{
   'X-MBX-APIKEY':c.apiKey,...(body?{'Content-Type':'application/x-www-form-urlencoded'}:{})},
   ...(body?{body:p.toString()}:{}),signal:controller.signal,cache:'no-store',credentials:'omit'});
  const data=await r.json().catch(()=>null);
  if(!r.ok)throw Error('Binance '+(data?.code||r.status)+' '+(data?.msg||r.statusText));
  return data;
 }finally{clearTimeout(timeout)}
}
async function positions(){
 const data=await signed('GET','/fapi/v3/positionRisk',{symbol});
 return (Array.isArray(data)?data:[data]).filter(x=>x.symbol===symbol&&Math.abs(Number(x.positionAmt))>0);
}
function tick(n,size,roundUp=false){
 const step=Number(size),digits=String(size).split('.')[1]?.length||0;
 return ((roundUp?Math.ceil((n-1e-10)/step):Math.floor((n+1e-10)/step))*step).toFixed(Math.min(digits,8));
}
function algoList(x){return Array.isArray(x)?x:Array.isArray(x?.orders)?x.orders:null;}
async function algos(){
 const x=algoList(await signed('GET','/fapi/v1/openAlgoOrders',{symbol}));
 if(!x)throw Error('조건부 주문 응답 확인 실패');return x;
}
function isProtection(o,side,positionSide){
 return o.symbol===symbol&&o.positionSide===positionSide&&o.side===(side==='LONG'?'SELL':'BUY')&&
 (o.closePosition===true||o.closePosition==='true')&&['STOP_MARKET','TAKE_PROFIT_MARKET'].includes(o.orderType||o.type);
}
async function protect(side,p,info){
 const entry=Number(p.entryPrice),mark=Number(p.markPrice),stop=Number(info.stop),rr=Number(info.rr);
 if(!(entry>0&&mark>0&&stop>=.05&&stop<=10&&rr>=1))throw Error('손절·익절 계산 설정 확인 필요');
 const ex=await fetch(base+'/fapi/v1/exchangeInfo?symbol='+symbol,{cache:'no-store'}).then(r=>{if(!r.ok)throw Error('거래소 필터 조회 실패');return r.json()});
 const priceFilter=ex.symbols?.[0]?.filters?.find(f=>f.filterType==='PRICE_FILTER');
 if(!priceFilter?.tickSize)throw Error('호가 단위 확인 실패');
 const d=stop/100,sl=entry*(side==='LONG'?1-d:1+d),tp=entry*(side==='LONG'?1+d*rr:1-d*rr);
 const prices={
  STOP_MARKET:tick(sl,priceFilter.tickSize,side==='SHORT'),
  TAKE_PROFIT_MARKET:tick(tp,priceFilter.tickSize,side==='LONG')
 };
 if((side==='LONG'&&!(Number(prices.STOP_MARKET)<mark&&Number(prices.TAKE_PROFIT_MARKET)>mark))||
    (side==='SHORT'&&!(Number(prices.STOP_MARKET)>mark&&Number(prices.TAKE_PROFIT_MARKET)<mark)))
  throw Error('현재 마크가가 손절/익절 가격을 통과했습니다. 바이낸스에서 포지션 확인 필요');
 const ps=p.positionSide||'BOTH';
 const split=splitPlan(side);
 let active=(await algos()).filter(o=>isProtection(o,side,ps));
 // The user's explicitly approved three-limit TP plan replaces only the
 // original full-size TP. Keep/recreate STOP_MARKET throughout the plan.
 // Never create a competing full-size TP while split order state exists.
 for(const type of (split?['STOP_MARKET']:['STOP_MARKET','TAKE_PROFIT_MARKET'])){
  if(active.some(o=>(o.orderType||o.type)===type))continue;
  const clientAlgoId='btcp'+(type==='STOP_MARKET'?'s':'t')+side[0]+Date.now().toString(36);
  const payload={algoType:'CONDITIONAL',symbol,side:side==='LONG'?'SELL':'BUY',positionSide:ps,
   type,closePosition:'true',triggerPrice:prices[type],workingType:'MARK_PRICE',clientAlgoId};
  try{await signed('POST','/fapi/v1/algoOrder',payload);}
  catch(e){
   active=(await algos()).filter(o=>isProtection(o,side,ps));
   if(!active.some(o=>(o.orderType||o.type)===type))throw Error(type+' 등록 불확실: '+e.message);
  }
  active=(await algos()).filter(o=>isProtection(o,side,ps));
  if(!active.some(o=>(o.orderType||o.type)===type))throw Error(type+' 활성 상태 확인 실패');
 }
 if(!active.some(o=>(o.orderType||o.type)==='STOP_MARKET')||
    (!split&&!active.some(o=>(o.orderType||o.type)==='TAKE_PROFIT_MARKET')))
  throw Error('손절·익절 활성 상태 확인 실패');
 note.textContent=split?
  side+' 3분할 익절 관리 중 ('+split.state+') · 기존 손절 유지 · SL '+prices.STOP_MARKET+
  '\n원래 전량 익절은 분할 주문 적용 중 자동 재등록하지 않습니다.':
  side+' 거래소 손절·익절 활성 확인 · SL '+prices.STOP_MARKET+' / TP '+prices.TAKE_PROFIT_MARKET+
  '\n보호 주문은 해당 방향 포지션 전체에 적용 · 시간 청산은 앱 활성 중에만 가능';
}
async function closeAtDeadline(side,p,orders,info,dual){
 const qty=Math.abs(Number(p.positionAmt));if(!(qty>0))return;
 // Clear matching entry orders before time close to prevent reopening.
 const ownIds=new Set((records()[side]||[]).map(x=>String(x.id)));
 for(const o of orders.filter(o=>ownIds.has(String(o.orderId))&&(dual?o.positionSide===side:o.side===(side==='LONG'?'BUY':'SELL')))){
  await signed('DELETE','/fapi/v1/order',{symbol,orderId:String(o.orderId)});
 }
 const exchange=await fetch(base+'/fapi/v1/exchangeInfo?symbol='+symbol,{cache:'no-store'}).then(r=>r.json());
 const market=exchange.symbols?.[0]?.filters?.find(f=>f.filterType==='MARKET_LOT_SIZE');
 if(!market?.stepSize)throw Error('청산 수량 필터 확인 실패');
 const quantity=tick(qty,market.stepSize);
 if(!(Number(quantity)>0&&Math.abs(Number(quantity)-qty)<1e-8))throw Error('포지션 전체 수량 확인 실패');
 const id='btcMaxHold'+Date.now().toString(36);
 const lockKey='btc-max-hold-submission-'+tag()+'-'+side+'-'+info.id;
 if(localStorage.getItem(lockKey))throw Error('이 보유기간의 청산 요청 이력이 있습니다. 바이낸스에서 청산 완료를 확인하세요.');
 const request={symbol,side:side==='LONG'?'SELL':'BUY',positionSide:dual?side:'BOTH',type:'MARKET',
  quantity,newClientOrderId:id,newOrderRespType:'RESULT'};
 if(!dual)request.reduceOnly='true';
 let response;
 // Persist an at-most-once submission marker to avoid accidental duplicate closes after timeout or reload.
 localStorage.setItem(lockKey,id);
 try{response=await signed('POST','/fapi/v1/order',request);}
 catch(e){try{response=await signed('GET','/fapi/v1/order',{symbol,origClientOrderId:id});}
  catch(_){throw Error('보유시간 청산 결과 불확실 · 주문 ID '+id+'를 바이낸스에서 확인하세요');}}
 note.textContent='최대 보유시간 만료 · 실제 시장가 청산 #'+response.orderId+' / '+response.status+
  '\n잔여 포지션과 보호 주문은 거래소에서 확인하세요.';
 $('realAccountRefresh')?.click();
}
async function run(){
 if(busy||document.hidden||!getApiCredentials()?.apiKey)return;
 busy=true;
 try{
  const data=records();
  if(![...data.LONG||[],...data.SHORT||[]].length)return;
  const dual=Boolean((await signed('GET','/fapi/v1/positionSide/dual')).dualSidePosition);
  const pos=await positions();
  const pending=await signed('GET','/fapi/v1/openOrders',{symbol});
  for(const side of ['LONG','SHORT']){
   const entries=(data[side]||[]).filter(x=>x&&x.id&&x.stop&&x.rr&&x.hold);
   if(!entries.length)continue;
   const p=pos.find(x=>dual?x.positionSide===side:x.positionSide==='BOTH'&&
    (side==='LONG'?Number(x.positionAmt)>0:Number(x.positionAmt)<0));
   if(!p){note.textContent=side+' 보유 포지션 없음 · 보호 주문 상태는 바이낸스에서 확인하세요.';continue;}
   const fills=[];
   for(const x of entries){
    try{
     const state=await signed('GET','/fapi/v1/order',{symbol,orderId:String(x.id)});
     if(Number(state.executedQty)>0)fills.push({...x,filledAt:Number(state.updateTime)||Number(x.time)});
    }catch(_){} 
   }
   if(!fills.length)continue;
   const first=fills.sort((a,b)=>a.filledAt-b.filledAt)[0];
   const deadline=first.filledAt+Number(first.hold)*3600000;
   if(Date.now()>=deadline){
    await closeAtDeadline(side,p,pending,first,dual);continue;
   }
   await protect(side,p,first);
  }
 }catch(e){note.textContent='⚠ 실전 보호/보유시간 확인 실패: '+String(e?.message||e)+
  '\n바이낸스에서 손절·익절 주문 상태를 확인하세요.';}
 finally{busy=false;}
}
setInterval(run,15000);
document.addEventListener('btc:real-account-updated',()=>{if(Date.now()-lastRun>5000){lastRun=Date.now();void run();}});
document.addEventListener('btc:credentials-unlocked',()=>setTimeout(run,1000));
document.addEventListener('visibilitychange',()=>{if(!document.hidden)void run()});
setTimeout(run,2500);
})();