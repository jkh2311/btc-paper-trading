/* v341: orphaned BTCUSDT TP/SL conditional-order cleanup.
   Runs only after successful real-account position updates.
   Isolated from v328 entry, TP/SL placement and API vault code. */
(()=>{
'use strict';
const symbol='BTCUSDT', base='https://fapi.binance.com';
const intervalMs=120000;
let busy=false,nextCheck=0,banUntil=0,lastActive=null;
let lastResult='대기';
const yes=v=>v===true||String(v).toLowerCase()==='true';
const array=v=>Array.isArray(v)?v:Array.isArray(v?.orders)?v.orders:null;
const activePositions=data=>{
 if(!Array.isArray(data))throw Error('포지션 조회 응답 검증 실패');
 // Binance positionRisk v3 can legitimately return [] when a symbol
 // has neither an active position nor a regular open order.
 // Trust only a valid array AND two separate successful signed snapshots.
 const relevant=data.filter(p=>p?.symbol===symbol);
 const active=new Set();
 for(const p of relevant){
  const amount=Number(p.positionAmt);
  if(!Number.isFinite(amount))throw Error('포지션 수량 확인 실패');
  if(!amount)continue;
  if(p.positionSide==='LONG'&&amount>0)active.add('LONG');
  else if(p.positionSide==='SHORT'&&amount<0)active.add('SHORT');
  else if(p.positionSide==='BOTH')active.add(amount>0?'LONG':'SHORT');
  else throw Error('포지션 방향 검증 실패');
 }
 return active;
};
const orderDirection=o=>{
 if(o?.positionSide==='LONG')return o.side==='SELL'?'LONG':null;
 if(o?.positionSide==='SHORT')return o.side==='BUY'?'SHORT':null;
 if(!o?.positionSide||o.positionSide==='BOTH')
  return o.side==='SELL'?'LONG':o.side==='BUY'?'SHORT':null;
 return null;
};
const protectTypes=new Set(['STOP','STOP_MARKET','TAKE_PROFIT','TAKE_PROFIT_MARKET']);
function protectedExit(o){
 if(o?.symbol!==symbol||!protectTypes.has(String(o.orderType||o.type||o.origType||'')))return false;
 const direction=orderDirection(o);if(!direction)return false;
 // Explicit reduceOnly/closePosition or hedge's closing direction.
 const ps=o.positionSide;
 if(!(yes(o.reduceOnly)||yes(o.closePosition)||
     ((ps==='LONG'||ps==='SHORT')&&direction===ps)))return false;
 return direction;
}
const openEntry=o=>{
 if(o?.symbol!==symbol)return false;
 const status=String(o.status||'NEW');
 if(!['NEW','PARTIALLY_FILLED'].includes(status))return false;
 return !protectedExit(o)&&!yes(o.reduceOnly)&&!yes(o.closePosition)&&
  !(o.positionSide==='LONG'&&o.side==='SELL')&&
  !(o.positionSide==='SHORT'&&o.side==='BUY');
};
async function signed(method,path,fields={}){
 const c=typeof getApiCredentials==='function'?getApiCredentials():null;
 if(!c?.apiKey||!c?.apiSecret)throw Error('API 잠금 상태 · 자동 정리 보류');
 const p=new URLSearchParams({...fields,recvWindow:'5000',timestamp:String(Date.now())});
 const k=await crypto.subtle.importKey('raw',new TextEncoder().encode(c.apiSecret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const b=await crypto.subtle.sign('HMAC',k,new TextEncoder().encode(p.toString()));
 p.set('signature',Array.from(new Uint8Array(b),v=>v.toString(16).padStart(2,'0')).join(''));
 const ctl=new AbortController(),timeout=setTimeout(()=>ctl.abort(),12000);
 try{
  const r=await fetch(base+path+'?'+p.toString(),{
   method,headers:{'X-MBX-APIKEY':c.apiKey},signal:ctl.signal,
   cache:'no-store',credentials:'omit'});
  const v=await r.json().catch(()=>null);
  if(!r.ok)throw Error('Binance '+(v?.code??r.status)+' · '+(v?.msg||r.statusText));
  return v;
 }finally{clearTimeout(timeout);}
}
function notice(text,ok=false){
 lastResult=text;
 document.dispatchEvent(new CustomEvent('btc:orphan-protection-cleanup',{
  detail:{ok,message:text,at:Date.now()}
 }));
}
function applyBanBackoff(err){
 window.btcProtectionReadBackoff?.remember(err);
 const msg=String(err?.message||err);
 const ban=Number(msg.match(/banned until\s+(\d{13})/i)?.[1]);
 if(ban>Date.now())banUntil=Math.max(banUntil,ban);
 else if(/-1003|429|418|451/.test(msg))banUntil=Math.max(banUntil,Date.now()+300000);
 nextCheck=Math.max(nextCheck,banUntil);
}
function isSameActive(a,b){
 return a.size===b.size&&[...a].every(s=>b.has(s));
}
async function clean(){
 if(busy||document.hidden||window.btcProtectionEditBusy===true||
    window.btcProtectionReadBackoff?.active()||
    Date.now()<nextCheck||Date.now()<banUntil)return;
 const c=typeof getApiCredentials==='function'?getApiCredentials():null;
 if(!c?.apiKey||!c?.apiSecret)return;
 busy=true;nextCheck=Date.now()+intervalMs;
 try{
  // Never use just the chart's cached position state to authorize cancellation.
  const before=activePositions(await signed('GET','/fapi/v3/positionRisk',{symbol}));
  const orders=array(await signed('GET','/fapi/v1/openOrders',{symbol}));
  const algos=array(await signed('GET','/fapi/v1/openAlgoOrders',{symbol}));
  if(!orders||!algos)throw Error('활성 주문 목록 검증 실패');
  // A conditional entry may also be waiting in the algo-order book.
  // Do not remove its prospective exits while a new entry can still fill.
  const pendingAlgoEntry=algos.some(o=>o?.symbol===symbol&&!protectedExit(o)&&
   ['NEW','ACTIVE','PENDING_NEW'].includes(String(o.algoStatus||o.status||'NEW')));
  if(orders.some(openEntry)||pendingAlgoEntry){
   notice('미체결 신규 진입 주문 있음 · 이전 익절/손절 자동 취소 보류');
   return;
  }
  const targets=[
   ...algos.map(o=>({o,kind:'algo'})),
   ...orders.map(o=>({o,kind:'normal'}))
  ].filter(({o})=>protectedExit(o)&&!before.has(protectedExit(o)));
  if(!targets.length)return;
  // Independent, subsequent signed risk snapshot. Abort on any ambiguity.
  await new Promise(resolve=>setTimeout(resolve,850));
  const after=activePositions(await signed('GET','/fapi/v3/positionRisk',{symbol}));
  if(!isSameActive(before,after)){
   notice('포지션 변경 감지 · 보호주문 자동 취소 보류');
   return;
  }
  let removed=0;
  for(const {o,kind} of targets){
   if(document.hidden||window.btcProtectionEditBusy===true)
    throw Error('화면 비활성/보호가격 변경 중 · 취소 보류');
   const id=kind==='algo'?o.algoId:o.orderId;
   if(!/^\d+$/.test(String(id||'')))throw Error('주문 번호 검증 실패 · 취소 보류');
   // Guard in-progress entries discovered after this cleanup started.
   // Do not use cancel-all: preserve unrelated and genuine opening orders.
   if(kind==='algo')await signed('DELETE','/fapi/v1/algoOrder',{symbol,algoId:String(id)});
   else await signed('DELETE','/fapi/v1/order',{symbol,orderId:String(id)});
   removed++;
  }
  const remainingAlgos=array(await signed('GET','/fapi/v1/openAlgoOrders',{symbol}));
  const remainingOrders=array(await signed('GET','/fapi/v1/openOrders',{symbol}));
  if(!remainingAlgos||!remainingOrders)throw Error('취소 후 주문 재조회 실패');
  const ids=new Set(targets.map(({o,kind})=>kind+':'+(kind==='algo'?o.algoId:o.orderId)));
  const remaining=[...remainingAlgos.map(o=>['algo',o]),...remainingOrders.map(o=>['normal',o])]
   .filter(([kind,o])=>ids.has(kind+':'+(kind==='algo'?o.algoId:o.orderId)));
  if(remaining.length)throw Error('일부 보호주문이 아직 활성 상태 · 바이낸스에서 확인 필요');
  notice('✅ 종료된 포지션의 익절/손절 '+removed+'건 바이낸스 취소 확인',true);
  // Refresh chart's own active TP/SL snapshot after exchange confirms.
  if(typeof window.btcRefreshRealProtection==='function')
   void window.btcRefreshRealProtection().catch(()=>{});
 }catch(e){
  applyBanBackoff(e);
  const limited=window.btcProtectionReadBackoff?.active();
  notice(limited?window.btcProtectionReadBackoff.message():
   '⚠ 익절/손절 자동 정리 보류 · '+String(e?.message||e));
 }finally{busy=false;}
}
document.addEventListener('btc:real-account-updated',e=>{
 const d=e.detail;
 if(!d||!Number.isFinite(d.at)||Date.now()-d.at>30000||!Array.isArray(d.positions))return;
 let sides;
 try{
  sides=new Set();
  for(const p of d.positions){
   const amount=Number(p.amount);
   if(!Number.isFinite(amount))return;
   if(!amount)continue;
   if(p.side==='LONG'&&amount>0)sides.add('LONG');
   else if(p.side==='SHORT'&&amount<0)sides.add('SHORT');
   else if(p.side==='BOTH')sides.add(amount>0?'LONG':'SHORT');
   else return;
  }
 }catch(_){return;}
 const hadClose=lastActive&&[...lastActive].some(s=>!sides.has(s));
 lastActive=sides;
 if(hadClose)nextCheck=Math.min(nextCheck,Date.now());
 if(!sides.size||hadClose)void clean();
});
window.btcOrphanProtectionStatus=()=>({busy,nextCheck,banUntil,lastResult});
})();
