/* v283 manual trade supervision: Binance-hosted stop/take-profit without max-hold close.
   No automatic entries. Only trades recorded by this PWA are managed. */
(()=>{
'use strict';
const $=id=>document.getElementById(id),symbol='BTCUSDT',base='https://fapi.binance.com';
const keyName='btc-manual-stage-ledger-v1';
const aiSplitKey='btc-ai-three-tp-plans-v1';
function splitPlan(side,p){
 try{
  const all=JSON.parse(localStorage.getItem(aiSplitKey)||'{}');
  const plan=all[tag()]?.[side],entry=Number(p?.entryPrice);
  // Do not let an old closed-position split plan suppress protection for a
  // new position at a different average entry price.
  if(!plan||!['PREPARING','ACTIVE','CANCELLING','ERROR'].includes(plan.state)||
     !(entry>0)||!(Number(plan.entry)>0)||
     Math.abs(entry-Number(plan.entry))>Math.max(.2,entry*.00005))return null;
  return plan;
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
note.textContent='실전 손절/익절 거래소 상태 확인 중';
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
 ['STOP','TAKE_PROFIT','STOP_MARKET','TAKE_PROFIT_MARKET'].includes(o.orderType||o.type)&&
 (o.closePosition===true||o.closePosition==='true'||Number(o.quantity)>0);
}
async function protect(side,p,info){
 // Trust signed Binance active protection first. Historical local stop/rr
 // must not generate a false error when both exchange orders already exist.
 const ps=p.positionSide||'BOTH';
 const existingProtection=(await algos()).filter(x=>isProtection(x,side,ps));
 const stopOrder=existingProtection.find(x=>['STOP','STOP_MARKET'].includes(x.orderType||x.type)&&Number(x.triggerPrice)>0);
 const takeOrder=existingProtection.find(x=>['TAKE_PROFIT','TAKE_PROFIT_MARKET'].includes(x.orderType||x.type)&&Number(x.triggerPrice)>0);
 if(stopOrder&&takeOrder){
  note.textContent=side+' 바이낸스 익절·손절 등록 확인 · SL '+stopOrder.triggerPrice+
   ' / TP '+takeOrder.triggerPrice+' USDT · 기존 주문 유지';
  document.dispatchEvent(new CustomEvent('btc:manual-protection-status',{detail:{side,ok:true,message:note.textContent}}));
  return;
 }
 const entry=Number(p.entryPrice),mark=Number(p.markPrice),stop=Number(info.stop),rr=Number(info.rr);
 if(!(entry>0&&mark>0&&stop>=.05&&stop<=10&&rr>=1))throw Error('손절·익절 계산 설정 확인 필요');
 const ex=await fetch(base+'/fapi/v1/exchangeInfo?symbol='+symbol,{cache:'no-store'}).then(r=>{if(!r.ok)throw Error('거래소 필터 조회 실패');return r.json()});
 const priceFilter=ex.symbols?.[0]?.filters?.find(f=>f.filterType==='PRICE_FILTER');
 if(!priceFilter?.tickSize)throw Error('호가 단위 확인 실패');
 const d=stop/100;
 // A user-chosen reservation price is an absolute exchange target after fill.
 // Ordinary entries retain the established stop-percent / risk-reward defaults.
 const custom=Number(info.tpPrice)>0&&Number(info.slPrice)>0;
 const sl=custom?Number(info.slPrice):entry*(side==='LONG'?1-d:1+d);
 const tp=custom?Number(info.tpPrice):entry*(side==='LONG'?1+d*rr:1-d*rr);
 if(custom&&!(side==='LONG'?sl<entry&&tp>entry:sl>entry&&tp<entry))
  throw Error('예약 진입 보호가가 실제 포지션 평균 진입가 기준 올바르지 않습니다. 자동 보호 등록 중단 · 바이낸스 주문 확인 필요');
 const prices={
  STOP_MARKET:tick(sl,priceFilter.tickSize,side==='SHORT'),
  TAKE_PROFIT_MARKET:tick(tp,priceFilter.tickSize,side==='LONG')
 };
 const slFinal=Number(prices.STOP_MARKET),tpFinal=Number(prices.TAKE_PROFIT_MARKET);
 const minPrice=Number(priceFilter.minPrice),maxPrice=Number(priceFilter.maxPrice);
 if(![sl,tp,slFinal,tpFinal].every(v=>Number.isFinite(v)&&v>0)||
    (minPrice>0&&(slFinal<minPrice||tpFinal<minPrice))||
    (maxPrice>0&&(slFinal>maxPrice||tpFinal>maxPrice)))
  throw Error('설정된 익절/손절 가격이 거래소 허용 가격 범위 밖입니다. 손절 거리·손익비 또는 예약 목표가를 수정하세요 (주문 미전송)');
 if(!(side==='LONG'?slFinal<entry&&tpFinal>entry:slFinal>entry&&tpFinal<entry))
  throw Error('실제 진입가 기준 익절/손절 가격 방향이 잘못됐습니다. 목표가격을 수정하세요 (보호주문 미전송)');
 if(custom&&!(side==='LONG'?
  Number(prices.STOP_MARKET)<entry&&Number(prices.TAKE_PROFIT_MARKET)>entry:
  Number(prices.STOP_MARKET)>entry&&Number(prices.TAKE_PROFIT_MARKET)<entry))
  throw Error('바이낸스 호가 단위 반영 후 예약 TP/SL이 진입가를 넘어섰습니다. 보호 주문 미등록');
 if((side==='LONG'&&!(Number(prices.STOP_MARKET)<mark&&Number(prices.TAKE_PROFIT_MARKET)>mark))||
    (side==='SHORT'&&!(Number(prices.STOP_MARKET)>mark&&Number(prices.TAKE_PROFIT_MARKET)<mark)))
  throw Error('현재 마크가가 손절/익절 가격을 통과했습니다. 바이낸스에서 포지션 확인 필요');
 const split=splitPlan(side,p);
 let active=existingProtection;
 const category=t=>t==='STOP_MARKET'||t==='STOP'?'STOP':'TAKE_PROFIT';
 const safeQty=Math.abs(Number(p.positionAmt));
 if(!(Number.isFinite(safeQty)&&safeQty>0))
  throw Error('보호 지정가 청산 수량 확인 실패');
 const symbolRules=ex.symbols?.find(x=>x.symbol===symbol);
 const lot=symbolRules?.filters?.find(f=>f.filterType==='LOT_SIZE');
 const step=Number(lot?.stepSize),minQty=Number(lot?.minQty);
 if(!(step>0&&safeQty>=minQty&&Math.abs(safeQty/step-Math.round(safeQty/step))<1e-6))
  throw Error('현재 포지션 수량이 바이낸스 지정가 청산 단위와 맞지 않습니다. 수동 보호 필요');
 if(custom){
  // Respect existing exchange protective orders. Do not silently override
  // an existing stop or TP when pyramid entries have conflicting targets.
  for(const [kind,wanted] of [['STOP',prices.STOP_MARKET],
   ['TAKE_PROFIT',prices.TAKE_PROFIT_MARKET]]){
   if(split&&kind==='TAKE_PROFIT')continue;
   const existing=active.find(o=>category(o.orderType||o.type)===kind);
   const actual=Number(existing?.triggerPrice);
   if(existing&&Number.isFinite(actual)&&Math.abs(actual-Number(wanted))>
      Math.max(Number(priceFilter.tickSize)*.5,1e-6))
    throw Error('기존 바이낸스 '+kind+' 주문 '+actual+' USDT가 이미 활성화되어 있습니다. 새로운 예약 목표 '+wanted+'로 자동 교체하지 않았습니다. 계좌에서 직접 확인해 주세요.');
  }
 }
 // The user's explicitly approved three-limit TP plan replaces only the
 // original full-size TP. Keep/recreate STOP_MARKET throughout the plan.
 // Never create a competing full-size TP while split order state exists.
 for(const type of (split?['STOP']:['STOP','TAKE_PROFIT'])){
  if(active.some(o=>category(o.orderType||o.type)===type))continue;
  const clientAlgoId='btcp'+(type==='STOP'?'s':'t')+side[0]+Date.now().toString(36);
  const trigger=prices[type==='STOP'?'STOP_MARKET':'TAKE_PROFIT_MARKET'];
  // GTC conditional limit: the stop/TP trigger and limit price are user-set.
  // The order may remain unfilled after trigger; never claim guaranteed close.
  const payload={algoType:'CONDITIONAL',symbol,side:side==='LONG'?'SELL':'BUY',
   positionSide:ps,type,quantity:String(safeQty),price:trigger,
   timeInForce:'GTC',triggerPrice:trigger,workingType:'MARK_PRICE',clientAlgoId};
  if(ps==='BOTH')payload.reduceOnly='true';
  try{await signed('POST','/fapi/v1/algoOrder',payload);}
  catch(e){
   active=(await algos()).filter(o=>isProtection(o,side,ps));
   if(!active.some(o=>(o.orderType||o.type)===type&&
       Number(o.triggerPrice)===Number(trigger)))throw Error(type+' 지정가 등록 불확실: '+e.message);
  }
  active=(await algos()).filter(o=>isProtection(o,side,ps));
  const confirmed=active.find(o=>(o.orderType||o.type)===type&&
   ['NEW','ACTIVE','PENDING_NEW'].includes(String(o.algoStatus||o.status||'NEW')));
  if(!confirmed||!(Number(confirmed.triggerPrice)>0))
   throw Error(type+' 거래소 활성/가격 확인 실패 · 보호 주문 상태 재확인 필요');
  if(Math.abs(Number(confirmed.triggerPrice)-Number(trigger))>
      Math.max(Number(priceFilter.tickSize)*.5,1e-6)||
     Math.abs(Number(confirmed.price)-Number(trigger))>
      Math.max(Number(priceFilter.tickSize)*.5,1e-6))
   throw Error(type+' 거래소 지정가/조건가 불일치 · 직접 확인 필요');
 }

 if(!active.some(o=>category(o.orderType||o.type)==='STOP')||
    (!split&&!active.some(o=>category(o.orderType||o.type)==='TAKE_PROFIT')))
  throw Error('손절·익절 활성 상태 확인 실패');
 const hasLegacy=active.some(o=>['STOP_MARKET','TAKE_PROFIT_MARKET'].includes(o.orderType||o.type));
 note.textContent=split?
  side+' 3분할 익절 관리 중 ('+split.state+') · 기존 손절 유지 · SL '+prices.STOP_MARKET+
  '\n분할 익절 계획 중 기존 TP 주문 자동 교체 안 함':
  side+' 거래소 TP/SL 조회 완료 · SL '+prices.STOP_MARKET+' / TP '+prices.TAKE_PROFIT_MARKET+
  (hasLegacy?'\n기존 시장가 보호주문은 임의 변경하지 않았습니다.':
   '\n조건부 지정가(GTC) 보호주문 · 발동해도 미체결 가능 · 청산 수량 변화 시 재확인 필수');
 document.dispatchEvent(new CustomEvent('btc:manual-protection-status',{detail:{
  side,ok:true,message:note.textContent
 }}));
}
async function run(){
 if(busy||document.hidden||!getApiCredentials()?.apiKey)return;
 busy=true;
 try{
  const data=records();
  if(![...data.LONG||[],...data.SHORT||[]].length)return;
  const dual=Boolean((await signed('GET','/fapi/v1/positionSide/dual')).dualSidePosition);
  const pos=await positions();
  for(const side of ['LONG','SHORT']){
   const entries=(data[side]||[]).filter(x=>x&&x.id&&x.stop&&x.rr);
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
   await protect(side,p,first);
  }
 }catch(e){note.textContent='⚠ 실전 익절·손절 확인 실패: '+String(e?.message||e)+
  '\n바이낸스에서 손절·익절 주문 상태를 확인하세요.';
  document.dispatchEvent(new CustomEvent('btc:manual-protection-status',{
   detail:{ok:false,message:note.textContent}
  }));
 }
 finally{busy=false;}
}
setInterval(run,10000);
// A filled manual entry deserves prompt real Binance-hosted protection, not
// only the 10-second periodic supervisor. Limit orders are rechecked without
// assuming that NEW / PARTIALLY_FILLED is a complete fill.
document.addEventListener('btc:manual-entry-placed',()=>{
 lastRun=0;
 for(const delay of [0,1400,3700,7500])
  setTimeout(()=>{if(!document.hidden)void run();},delay);
});
document.addEventListener('btc:real-account-updated',()=>{if(Date.now()-lastRun>2500){lastRun=Date.now();void run();}});
document.addEventListener('btc:credentials-unlocked',()=>setTimeout(run,1000));
document.addEventListener('visibilitychange',()=>{if(!document.hidden)void run()});
setTimeout(run,2500);
})();