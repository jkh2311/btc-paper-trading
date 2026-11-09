/* v175: User-confirmed Binance BTCUSDT three-stage TAKE PROFIT LIMITs.
 * Never enter positions automatically; preserve full-position STOP_MARKET.
 * The initial full TP_MARKET is restored on an explicit successful cancel. */
(()=>{
'use strict';
const $=id=>document.getElementById(id),host=$('aiTpThreeOrders');
if(!host||typeof window.btcAiTpSelectedPlan!=='function')return;
const KEY='btc-ai-three-tp-plans-v1',SYM='BTCUSDT',BASE='https://fapi.binance.com';
let busy=false,feedback='',lastUiSignature='';
const css=document.createElement('style');
css.textContent=`
#aiTpThreeOrders{margin:13px 0 10px;padding:12px;background:#132840;border:1px solid #476582;border-radius:11px;color:#e8f4ff}
#aiTpThreeOrders .three-title{font-size:13px;font-weight:800;line-height:1.5}
#aiTpThreeOrders .three-help{font-size:11px;color:#a9c8e5;line-height:1.55;margin:6px 0}
#aiTpThreeOrders .three-row{font-size:12px;display:flex;justify-content:space-between;gap:8px;padding:5px 0;border-bottom:1px solid #304962}
#aiTpThreeOrders .three-actions{display:flex;flex-wrap:wrap;gap:7px;margin:10px 0 4px}
#aiTpThreeOrders button{font-size:12px;padding:10px;flex:1 1 120px;border-radius:9px;min-height:40px}
#aiTpThreeOrders .three-apply{background:#146651;border:1px solid #38b18b;font-weight:750}
#aiTpThreeOrders .three-cancel{background:#593a47;border:1px solid #c78090;font-weight:750}
#aiTpThreeOrders .three-result{color:#ffd28c;white-space:pre-line;font-size:11px;line-height:1.55;margin-top:8px}
`;document.head.append(css);
function api(){const c=typeof getApiCredentials==='function'?getApiCredentials():null;
 if(!c?.apiKey||!c?.apiSecret)throw Error('실전 API 키 잠금 해제가 필요해요');return c}
function tag(){const key=api().apiKey;let h=2166136261;for(let i=0;i<key.length;i++)h=Math.imul(h^key.charCodeAt(i),16777619);return String(h>>>0);}
function allPlans(){try{return JSON.parse(localStorage.getItem(KEY)||'{}')||{}}catch(_){return {}}}
function planFor(side){try{return allPlans()[tag()]?.[side]||null}catch(_){return null}}
function savePlan(side,plan){const x=allPlans(),t=tag();if(!x[t])x[t]={};if(plan)x[t][side]=plan;else delete x[t][side];
 localStorage.setItem(KEY,JSON.stringify(x));}
function dec(v){const n=Number(v);return Number.isFinite(n)?n:NaN;}
const fmt=(n,d=4)=>Number(n).toLocaleString('ko-KR',{maximumFractionDigits:d});
function direction(p){return p?.side==='LONG'?'SELL':p?.side==='SHORT'?'BUY':null}
function isOpen(o){return ['NEW','PARTIALLY_FILLED','PENDING_NEW'].includes(String(o.status||'NEW'));}
function algoArray(x){return Array.isArray(x)?x:Array.isArray(x?.orders)?x.orders:null}
function matching(o,p){return o?.symbol===SYM&&o.positionSide===p.positionSide&&o.side===direction(p)}
function isStop(o){return (o.orderType||o.type)==='STOP_MARKET'&&(o.closePosition===true||o.closePosition==='true')}
function isTake(o){return (o.orderType||o.type)==='TAKE_PROFIT_MARKET'&&(o.closePosition===true||o.closePosition==='true')}
async function signed(method,path,values={}){
 const c=api(),q=new URLSearchParams({...values,recvWindow:'5000',timestamp:String(Date.now())});
 const cryptoKey=await crypto.subtle.importKey('raw',new TextEncoder().encode(c.apiSecret),
 {name:'HMAC',hash:'SHA-256'},false,['sign']);
 const sig=await crypto.subtle.sign('HMAC',cryptoKey,new TextEncoder().encode(q.toString()));
 q.set('signature',Array.from(new Uint8Array(sig),b=>b.toString(16).padStart(2,'0')).join(''));
 const body=method==='POST'||method==='PUT',ctrl=new AbortController(),timeout=setTimeout(()=>ctrl.abort(),12000);
 try{
  const response=await fetch(BASE+path+(body?'':'?'+q.toString()),{method,cache:'no-store',
   credentials:'omit',mode:'cors',redirect:'error',signal:ctrl.signal,
   headers:{'X-MBX-APIKEY':c.apiKey,...(body?{'Content-Type':'application/x-www-form-urlencoded'}:{})},
   ...(body?{body:q.toString()}:{})});
  const data=await response.json().catch(()=>null);
  if(!response.ok)throw Error('Binance '+(data?.code||response.status)+' '+(data?.msg||response.statusText));
  return data;
 }finally{clearTimeout(timeout)}
}
async function exchange(){
 const response=await fetch(BASE+'/fapi/v1/exchangeInfo?symbol='+SYM,{cache:'no-store',signal:AbortSignal.timeout(10000)});
 if(!response.ok)throw Error('거래소 최소수량/가격 규칙 조회 실패');
 const data=await response.json(),item=data.symbols?.find(x=>x.symbol===SYM);
 const by=t=>item?.filters?.find(x=>x.filterType===t);
 const lot=by('LOT_SIZE'),tick=by('PRICE_FILTER'),minN=by('MIN_NOTIONAL')||by('NOTIONAL');
 if(!lot?.stepSize||!tick?.tickSize)throw Error('BTCUSDT 거래소 주문 필터 확인 실패');
 return {step:dec(lot.stepSize),minQty:dec(lot.minQty),tick:dec(tick.tickSize),
  minNotional:dec(minN?.notional||minN?.minNotional||0)};
}
function digits(step){const x=String(step);return Math.min(8,(x.split('.')[1]||'').length)}
function down(v,step){return Number((Math.floor((v+1e-12)/step)*step).toFixed(digits(step)))}
function exactTick(price,tick){return Number((Math.round(price/tick)*tick).toFixed(digits(tick)))}
async function livePosition(p){
 const [duality,positions]=await Promise.all([
  signed('GET','/fapi/v1/positionSide/dual'),signed('GET','/fapi/v3/positionRisk',{symbol:SYM})]);
 const dual=duality?.dualSidePosition===true||duality?.dualSidePosition==='true';
 const ps=dual?p.side:'BOTH';
 const rows=Array.isArray(positions)?positions:[positions];
 const match=rows.find(x=>x?.symbol===SYM&&x.positionSide===ps&&
  (p.side==='LONG'?Number(x.positionAmt)>0:Number(x.positionAmt)<0));
 if(!match)throw Error('바이낸스에서 선택 포지션을 확인할 수 없어요');
 const amount=Math.abs(Number(match.positionAmt)),entry=dec(match.entryPrice),mark=dec(match.markPrice);
 if(!(amount>0&&entry>0&&mark>0))throw Error('포지션 수량/진입가/마크가 확인 실패');
 if(Math.abs(entry-p.entry)>Math.max(0.2,entry*.00005))
  throw Error('추천 계산 이후 진입가가 변했어요. AI 익절 추천을 다시 확인하세요');
 return {side:p.side,positionSide:ps,amount,entry,mark,dual};
}
async function openAlgos(){
 const x=algoArray(await signed('GET','/fapi/v1/openAlgoOrders',{symbol:SYM}));
 if(!x)throw Error('바이낸스 조건부 손절·익절 주문 조회 실패');return x;
}
async function openNormal(){
 const x=await signed('GET','/fapi/v1/openOrders',{symbol:SYM});
 if(!Array.isArray(x))throw Error('바이낸스 일반 미체결 주문 조회 실패');return x;
}
function unique(a,b){if(a.length!==1||!a[0]?.algoId||!(dec(a[0].triggerPrice)>0))throw Error(b+' 보호주문이 정확히 1개인지 확인할 수 없어요');return a[0]}
function splitQuantities(amount,f,prices){
 const q1=down(amount*.5,f.step),q2=down(amount*.3,f.step),q3=down(amount-q1-q2,f.step);
 const quantities=[q1,q2,q3];
 if(quantities.some((q,i)=>!Number.isFinite(q)||q<f.minQty||q<f.step||
   (f.minNotional>0&&q*prices[i]<f.minNotional)))
  throw Error('3분할 최소수량/최소주문금액을 충족하지 못해요. 바이낸스 최소 주문수량보다 포지션이 작아요');
 if(Math.abs(q1+q2+q3-amount)>f.step*.01)
  throw Error('보유 BTC 수량이 LOT_SIZE 단위에 맞지 않아 3분할을 중단해요');
 return quantities;
}
function checkTargets(p,raw,f){
 if(!Array.isArray(raw)||raw.length!==3)throw Error('AI 익절 후보 3개가 모두 필요해요');
 const levels=raw.map(c=>exactTick(dec(c.price),f.tick));
 const good=levels.every((v,i)=>Number.isFinite(v)&&v>0&&
  (p.side==='LONG'?v>p.mark&&v>p.entry:v<p.mark&&v<p.entry)&&
  (i===0||(p.side==='LONG'?v>levels[i-1]:v<levels[i-1])));
 if(!good)throw Error('익절 가격이 현재 마크가의 수익 방향에 있지 않거나 중복돼요. 다시 분석해 주세요');
 return levels;
}
function planSnapshot(){
 const snap=window.btcAiTpSelectedPlan?.();
 if(!snap?.position?.side||!Array.isArray(snap.candidates)||snap.candidates.length!==3)return null;
 return snap;
}
function show(message){feedback=message;paint(true)}
function refreshAccount(){ $('realAccountRefresh')?.click(); }
function ownOpenOrders(orders,plan){const own=new Set(plan.ids||[]);
 return orders.filter(o=>own.has(String(o.clientOrderId))&&isOpen(o));}
function originalPayload(plan,type){
 const original=type==='STOP_MARKET'?plan.originalStop:plan.originalTp;
 if(!original||!(dec(original.triggerPrice)>0))throw Error('원래 '+type+' 가격을 확인할 수 없어요');
 return {algoType:'CONDITIONAL',symbol:SYM,side:plan.exitSide,positionSide:plan.positionSide,
  type,closePosition:'true',triggerPrice:String(original.triggerPrice),
  workingType:original.workingType||'MARK_PRICE',
  clientAlgoId:'btc3restore'+(type==='STOP_MARKET'?'s':'t')+Date.now().toString(36)};
}
async function restoreAlgo(plan,type){
 const current=(await openAlgos()).filter(o=>o.symbol===SYM&&o.side===plan.exitSide&&
  o.positionSide===plan.positionSide&&(o.orderType||o.type)===type&&
  (o.closePosition===true||o.closePosition==='true'));
 if(current.length>1)throw Error(type+' 보호주문이 중복되어 복구를 중단했어요');
 if(current.length===1)return;
 const req=originalPayload(plan,type);
 try{await signed('POST','/fapi/v1/algoOrder',req);}
 catch(err){
  const after=(await openAlgos()).filter(o=>o.clientAlgoId===req.clientAlgoId);
  if(!after.length)throw Error(type+' 복구 불확실 · '+err.message);
 }
 const verify=(await openAlgos()).find(o=>o.clientAlgoId===req.clientAlgoId);
 if(!verify)throw Error(type+' 복구 거래소 확인 실패');
}
async function cancelOne(clientId){
 try{await signed('DELETE','/fapi/v1/order',{symbol:SYM,origClientOrderId:clientId});}
 catch(e){
  const exists=(await openNormal()).find(o=>o.clientOrderId===clientId&&isOpen(o));
  if(exists)throw Error(clientId+' 취소 불확실 · '+e.message);
 }
}
async function cancelOwnOrders(plan){
 for(const id of plan.ids||[])await cancelOne(id);
 const open=ownOpenOrders(await openNormal(),plan);
 if(open.length)throw Error('3분할 미체결 주문 '+open.length+'개가 남아 취소/원복을 중단했어요');
}
async function apply(){
 if(busy)return;
 const v=planSnapshot();if(!v)return show('실전 포지션과 익절 후보 3개를 먼저 확인하세요');
 const p=v.position,side=p.side;busy=true;paint(true);
 let plan=null;
 try{
  if(planFor(side))throw Error('이미 3분할 익절 적용/복구 내역이 있어요. 먼저 취소/원복 상태를 확인하세요');
  const live=await livePosition(p),f=await exchange();
  const prices=checkTargets(live,v.candidates,f),quantities=splitQuantities(live.amount,f,prices);
  const [algos,normals]=await Promise.all([openAlgos(),openNormal()]);
  const exits=algos.filter(o=>matching(o,live));
  const stop=unique(exits.filter(isStop),'기존 손절 STOP_MARKET');
  const tp=unique(exits.filter(isTake),'기존 익절 TAKE_PROFIT_MARKET');
  if(exits.some(o=>!isStop(o)&&!isTake(o)))
   throw Error('다른 조건부 청산 주문이 있어 충돌 방지를 위해 중단했어요');
  if(normals.some(o=>matching(o,live)&&isOpen(o)))
   throw Error('기존 일반 청산 주문이 있어요. 바이낸스에서 확인 후 다시 시도하세요');
  const msg='BTCUSDT '+side+' 실제 포지션 '+live.amount+' BTC\n'+
   '1차 '+fmt(prices[0],1)+' USDT · 50% ('+quantities[0]+' BTC)\n'+
   '2차 '+fmt(prices[1],1)+' USDT · 30% ('+quantities[1]+' BTC)\n'+
   '3차 '+fmt(prices[2],1)+' USDT · 나머지 20% ('+quantities[2]+' BTC)\n\n'+
   '기존 STOP_MARKET 손절 유지 · 기존 전량 TP_MARKET은 취소하고 LIMIT 3개 등록\n'+
   '지정가 주문은 체결 보장되지 않고 주문 취소 시 실제 거래소 주문을 변경합니다.\n계속할까요?';
  if(!confirm(msg)){show('3분할 주문을 적용하지 않았어요');return}
  // Recheck the exact original position and orders immediately after approval.
  const again=await livePosition(p);
  if(Math.abs(again.amount-live.amount)>1e-8)throw Error('확인 도중 포지션 수량이 바뀌어 중단했어요');
  const verified=(await openAlgos());
  if(!verified.some(o=>String(o.algoId)===String(stop.algoId))||
     !verified.some(o=>String(o.algoId)===String(tp.algoId)))
   throw Error('확인 도중 원래 손절/익절 주문이 바뀌어 중단했어요');
  plan={state:'PREPARING',side,positionSide:live.positionSide,exitSide:direction(live),
   entry:live.entry,initialQty:live.amount,createdAt:Date.now(),ids:[],
   originalStop:{algoId:stop.algoId,triggerPrice:stop.triggerPrice,workingType:stop.workingType},
   originalTp:{algoId:tp.algoId,triggerPrice:tp.triggerPrice,workingType:tp.workingType},
   prices,quantities};
  savePlan(side,plan); // BEFORE cancelling old TP: prevent background auto-recreation
  await signed('DELETE','/fapi/v1/algoOrder',{symbol:SYM,algoId:String(tp.algoId)});
  if((await openAlgos()).some(o=>String(o.algoId)===String(tp.algoId)))
   throw Error('기존 전량 익절 주문 취소가 확인되지 않았어요');
  for(let i=0;i<3;i++){
   const clientId='btc3tp'+side[0]+Date.now().toString(36)+i;
   // Save the client ID BEFORE sending; protects against ambiguous responses.
   plan.ids.push(clientId);savePlan(side,plan);
   const fields={symbol:SYM,side:plan.exitSide,positionSide:plan.positionSide,
    type:'LIMIT',timeInForce:'GTC',price:String(prices[i]),quantity:String(quantities[i]),
    newClientOrderId:clientId,newOrderRespType:'RESULT'};
   if(plan.positionSide==='BOTH')fields.reduceOnly='true';
   try{await signed('POST','/fapi/v1/order',fields);}
   catch(e){
    const order=(await openNormal()).find(o=>o.clientOrderId===clientId);
    if(!order)throw Error('3분할 '+(i+1)+'차 주문 결과 불확실 · '+e.message);
   }
   const check=await signed('GET','/fapi/v1/order',{symbol:SYM,origClientOrderId:clientId});
   if(!['NEW','PARTIALLY_FILLED','FILLED'].includes(check.status))
    throw Error('3분할 '+(i+1)+'차 주문 상태 '+check.status+' · 거래소 확인 필요');
  }
  const now=ownOpenOrders(await openNormal(),plan);
  if(now.length!==3)throw Error('3분할 주문 3개 활성 확인 실패 (부분 체결 가능) · 상태 확인 필요');
  plan.state='ACTIVE';savePlan(side,plan);
  show('✅ 3분할 실제 LIMIT 익절 주문 3개 등록 확인\n기존 전량 익절은 교체, STOP_MARKET 손절은 유지됨.\n취소/원복 시 아직 미체결인 분할 주문을 취소한 후 원래 익절을 복구해요.');
  refreshAccount();
 }catch(e){
  if(plan){
   plan.state='ERROR';savePlan(side,plan);
   // Never guess whether an ambiguous submission filled. Keep all IDs so
   // the user can explicitly cancel/reconcile, preserving the stop.
   show('⚠ 3분할 적용을 완전히 확인하지 못했어요: '+e.message+
    '\n손절 주문은 유지됩니다. [3분할 취소·원복]으로 정리하거나 바이낸스에서 주문 상태를 확인해 주세요.');
  }else show('⚠ 3분할 적용 중단: '+e.message);
 }finally{busy=false;paint(true)}
}
async function cancelAndRestore(){
 if(busy)return;
 const v=planSnapshot(),side=v?.position?.side||window.btcAiTpSelectedPlan?.()?.position?.side;
 if(!side)return show('취소할 포지션을 AI 익절 창에서 선택하세요');
 let plan=planFor(side);
 if(!plan)return show('이 포지션에는 앱에서 등록한 3분할 주문이 없어요');
 if(!confirm('BTCUSDT '+side+' 미체결 3분할 익절 주문만 취소하고, 남은 포지션에 기존 전량 익절 가격을 복구할까요?\n이미 체결된 익절은 되돌릴 수 없습니다.'))return;
 busy=true;plan.state='CANCELLING';savePlan(side,plan);paint(true);
 try{
  await cancelOwnOrders(plan);
  const now=await signed('GET','/fapi/v3/positionRisk',{symbol:SYM});
  const positions=Array.isArray(now)?now:[now];
  const remaining=positions.find(x=>x.symbol===SYM&&x.positionSide===plan.positionSide&&
   (side==='LONG'?Number(x.positionAmt)>0:Number(x.positionAmt)<0));
  if(remaining){
   const mark=dec(remaining.markPrice),stop=dec(plan.originalStop.triggerPrice),tp=dec(plan.originalTp.triggerPrice);
   if(!(mark>0&&stop>0&&tp>0&&
    (side==='LONG'?stop<mark&&tp>mark:stop>mark&&tp<mark)))
    throw Error('기존 손절/익절 가격을 현재 시세가 통과했어요. 자동 원복 불가 · 바이낸스에서 직접 보호주문을 확인하세요');
   await restoreAlgo(plan,'STOP_MARKET');
   await restoreAlgo(plan,'TAKE_PROFIT_MARKET');
  }
  savePlan(side,null);
  show(remaining?'✅ 3분할 미체결 주문 취소 · 원래 손절/전량 익절 가격 복원 확인':'✅ 3분할 미체결 주문 취소 · 포지션이 없어 보호주문 복구 생략');
  refreshAccount();
 }catch(e){
  plan.state='ERROR';savePlan(side,plan);
  show('⚠ 취소/원복 미완료: '+e.message+
   '\n원복 완료 전에는 기존 전량 익절이 없을 수 있어요. 바이낸스에서 손절·익절 주문을 직접 확인하거나 다시 취소/원복해 주세요.');
 }finally{busy=false;paint(true)}
}
function paint(force=false){
 if($('aiEntryDetails')?.hidden)return;
 const snapshot=planSnapshot(),side=snapshot?.position?.side||null;
 let plan=null;try{if(side)plan=planFor(side)}catch(_){}
 const sig=[side,plan?.state,plan?.ids?.length,snapshot?.candidates?.map(x=>x.price).join(','),busy,feedback].join('|');
 if(!force&&sig===lastUiSignature)return;lastUiSignature=sig;
 host.replaceChildren();
 const title=document.createElement('div');title.className='three-title';
 title.textContent='3분할 익절라인 · 1차 50% / 2차 30% / 3차 20%';
 const help=document.createElement('div');help.className='three-help';
 help.textContent='실제 바이낸스 지정가 익절 주문 3개 · 기존 손절 유지 · 자동 진입 없음. 주문이 미체결될 수 있으며 익절 수익을 보장하지 않습니다.';
 host.append(title,help);
 if(snapshot){
  snapshot.candidates.forEach((c,i)=>{
   const row=document.createElement('div');row.className='three-row';
   row.textContent=(i+1)+'차 '+[50,30,20][i]+'% · '+fmt(c.price,1)+' USDT'+
    ' · ROI 추정 +'+fmt(c.roi,1)+'%';host.append(row);
  });
 }
 const actions=document.createElement('div');actions.className='three-actions';
 const applyBtn=document.createElement('button');applyBtn.type='button';applyBtn.className='three-apply';
 applyBtn.textContent=busy?'거래소 확인 중…':'3분할 익절라인 걸기';
 applyBtn.disabled=busy||!snapshot||!!plan;applyBtn.onclick=()=>void apply();
 const cancelBtn=document.createElement('button');cancelBtn.type='button';cancelBtn.className='three-cancel';
 cancelBtn.textContent='3분할 취소 · 원복';
 cancelBtn.disabled=busy||!plan;cancelBtn.onclick=()=>void cancelAndRestore();
 actions.append(applyBtn,cancelBtn);host.append(actions);
 if(plan){const status=document.createElement('div');status.className='three-help';
  status.textContent='현재 3분할 주문 상태: '+plan.state+' · 등록 이력 '+(plan.ids||[]).length+'개';
  host.append(status);}
 if(feedback){const result=document.createElement('div');result.className='three-result';result.textContent=feedback;host.append(result)}
}
$('aiEntryToggle')?.addEventListener('click',()=>queueMicrotask(()=>paint(true)));
$('aiTpPosition')?.addEventListener('change',()=>queueMicrotask(()=>paint(true)));
$('aiTpChoices')?.addEventListener('click',()=>queueMicrotask(()=>paint(true)));
document.addEventListener('btc:real-account-updated',()=>{if(!$('aiEntryDetails')?.hidden)paint()});
document.addEventListener('btc:real-position-selected',()=>queueMicrotask(()=>paint(true)));
document.addEventListener('btc:real-account-cleared',()=>{feedback='';lastUiSignature=''});
setInterval(()=>{if(!$('aiEntryDetails')?.hidden)paint()},2500);
})();