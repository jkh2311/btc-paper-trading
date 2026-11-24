/* v81: live BTCUSDT entry / exchange-protection chart lines, drag to request a real price change. */
(()=>{
'use strict';
const chart=document.getElementById('chart');
if(!chart)return;
const symbol='BTCUSDT',api='https://fapi.binance.com', $=id=>document.getElementById(id);
let positions=[],algos=[],algoError='',accountAt=0,drag=null,requestBusy=false,readBusy=false,readStamp=0,epoch=0;
let actionMessage='',actionError=false;
const num=x=>x===null||x===undefined||x===''?NaN:Number(x);
const fmt=n=>Number(n).toLocaleString('ko-KR',{maximumFractionDigits:2});
const hint=document.createElement('div');
hint.className='muted';
hint.style.cssText='font-size:11px;margin:6px 2px;line-height:1.5;white-space:pre-line';
hint.textContent='';
hint.style.display='none';
chart.closest('.chart-panel')?.insertAdjacentElement('afterend',hint);
function redraw(){window.btcRedrawChart?.();}
function creds(){return typeof getApiCredentials==='function'?getApiCredentials():null;}
async function signed(method,path,fields={}){
 const c=creds();if(!c?.apiKey||!c.apiSecret)throw Error('API 잠금 해제가 필요합니다');
 const p=new URLSearchParams({...fields,recvWindow:'5000',timestamp:String(Date.now())});
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(c.apiSecret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const signature=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(p.toString()));
 p.set('signature',Array.from(new Uint8Array(signature),v=>v.toString(16).padStart(2,'0')).join(''));
 const body=method==='POST';
 const ctl=new AbortController(),timeout=setTimeout(()=>ctl.abort(),12000);
 try{
  const response=await fetch(api+path+(body?'':'?'+p.toString()),{method,mode:'cors',credentials:'omit',cache:'no-store',redirect:'error',
   headers:{'X-MBX-APIKEY':c.apiKey,...(body?{'Content-Type':'application/x-www-form-urlencoded'}:{})},
   ...(body?{body:p.toString()}:{}),signal:ctl.signal});
  const data=await response.json().catch(()=>null);
  if(!response.ok)throw Error('Binance '+(data?.code??response.status)+' · '+(data?.msg||response.statusText));
  return data;
 }finally{clearTimeout(timeout);}
}
function side(p){return p.side==='LONG'||p.side==='SHORT'?p.side:p.side==='BOTH'?(p.amount>0?'LONG':'SHORT'):null;}
function matching(a,p,kind){
 const wanted=kind==='sl'?['STOP','STOP_MARKET']:['TAKE_PROFIT','TAKE_PROFIT_MARKET'];
 return a.symbol===symbol&&a.positionSide===p.side&&a.side===(side(p)==='LONG'?'SELL':'BUY')&&
  wanted.includes(a.orderType||a.type)&&['NEW','ACCEPTED','ACTIVE','PENDING_NEW',''].includes(String(a.algoStatus||a.status||''))&&num(a.triggerPrice)>0;
}
function getProtection(p,kind){
 return algos.filter(a=>matching(a,p,kind)).sort((a,b)=>Number(b.algoId||0)-Number(a.algoId||0))[0]||null;
}
// Read-only active exchange protection levels for the selected position card.
// Never treat a chart preview line as an actually registered Binance order.
window.btcRealProtectionSnapshot=position=>{
 const current=positions.find(p=>p.side===position?.side||
  p.side==='BOTH'&&position?.side==='BOTH'&&Math.sign(p.amount)===Math.sign(position.amount));
 if(!current)return {fresh:false,tp:null,sl:null};
 const fresh=!algoError&&Date.now()-readStamp<16000;
 if(!fresh)return {fresh:false,tp:null,sl:null};
 const tp=getProtection(current,'tp'),sl=getProtection(current,'sl');
 return {fresh:true,tp:tp?num(tp.triggerPrice):null,sl:sl?num(sl.triggerPrice):null};
};
function levels(){
 const list=[];
 for(const p of positions){
  const s=side(p),entry=num(p.entry);if(!(entry>0)||!s)continue;
  list.push({p,side:s,kind:'entry',price:entry,active:true});
  const leverage=num($('lev')?.value),d=num($('stop')?.value)/(100*leverage),tpMove=num($('rr')?.value)/(100*leverage);
  for(const kind of ['sl','tp']){
   const order=getProtection(p,kind);
   let price=num(order?.triggerPrice);
   if(!(price>0)&&d>0&&tpMove>0){
    price=entry*(s==='LONG'?(kind==='sl'?1-d:1+tpMove):(kind==='sl'?1+d:1-tpMove));
   }
   if(price>0)list.push({p,side:s,kind,order,price,active:!!order});
  }
 }
 return list;
}
function note(text,warning=false){
 if(actionMessage&&!warning){hint.textContent=actionMessage;hint.style.color=actionError?'#ff9aaa':'#4ed6a6';hint.style.display='block';return;}
 hint.textContent=text;
 hint.style.color=warning?'#ff9aaa':'#4ed6a6';
 hint.style.display=warning||/변경 요청 중|거래소 변경 확인/.test(text)?'block':'none';
}
function actionNotice(text,error=false){actionMessage=text;actionError=error;hint.textContent=text;hint.style.color=error?'#ff9aaa':'#4ed6a6';hint.style.display='block';}
function openAlgoList(v){return Array.isArray(v)?v:Array.isArray(v?.orders)?v.orders:null;}
// Preserve the full live-level snapshot for trading-mode detection. Only
// filtered display prices affect autoscaling; actual protection is unchanged.
const chartVisible=kind=>window.btcChartLevelVisible?.(kind)!==false;
window.btcLiveChartPrices=()=>levels().map(l=>l.price).filter(p=>Number.isFinite(p)&&p>0);
window.btcVisibleLiveChartPrices=()=>levels().filter(l=>chartVisible(l.kind))
 .map(l=>l.price).filter(p=>Number.isFinite(p)&&p>0);
window.btcDrawLiveLevels=(ctx,scale)=>{
 const all=levels().filter(l=>chartVisible(l.kind));
 for(const level of all){
  const price=drag&&drag.level.kind===level.kind&&drag.level.side===level.side&&drag.level.p.side===level.p.side?drag.price:level.price;
  const y=scale.y(price);
  if(y<scale.top||y>scale.priceBottom)continue;
  const color=level.active?(level.side==='LONG'?'#41dbad':'#ff819b'):'#f4bc61';
  ctx.save();
  ctx.strokeStyle=color;ctx.lineWidth=level.kind==='entry'?2.3:1.8;
  ctx.setLineDash(level.kind==='entry'?[]:level.active?[7,4]:[2,4]);
  ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(scale.plotW,y);ctx.stroke();
  ctx.setLineDash([]);
  const type=level.kind==='entry'?'진입':level.kind==='sl'?'손절':'익절';
  const preview=drag&&drag.level.kind===level.kind&&drag.level.side===level.side&&drag.level.p.side===level.p.side;
  const label=level.side+' '+type+(preview?' 이동 중':level.active?'':' 미등록')+' '+fmt(price);
  ctx.font='bold 10px -apple-system,sans-serif';
  const labelW=Math.min(scale.plotW-6,ctx.measureText(label).width+10);
  const x=level.kind==='entry'?5:level.kind==='sl'?Math.max(5,scale.plotW/3):Math.max(5,scale.plotW*2/3);
  const tx=Math.min(x,scale.plotW-labelW-2),ty=Math.max(scale.top,Math.min(scale.priceBottom-16,y-17));
  ctx.fillStyle='rgba(8,23,42,.91)';ctx.fillRect(tx,ty,labelW,16);
  ctx.fillStyle=color;ctx.fillText(label,tx+5,ty+12);
  ctx.restore();
 }
};
async function readAlgos(){
 if(readBusy||requestBusy||document.hidden||!creds()?.apiKey)return false;
 readBusy=true;const id=++epoch;
 try{
  const r=await signed('GET','/fapi/v1/openAlgoOrders',{symbol});
  const a=openAlgoList(r);
  if(!a)throw Error('조건부 주문 응답 형식 오류');
  if(id===epoch){algos=a.filter(o=>o.symbol===symbol);algoError='';readStamp=Date.now();
   if(positions.length)note('실전 진입선 / 손절·익절선 · 손절·익절선 길게 누르거나 드래그하여 실제 가격 변경');
   redraw();document.dispatchEvent(new Event('btc:real-protection-updated'));return true;}
 }catch(e){if(id===epoch){algoError=String(e?.message||e);note('⚠ 보호 주문 조회 실패 · '+algoError,true);redraw();}return false;}
 finally{readBusy=false;}
}
window.btcRefreshRealProtection=async()=>{
 const ok=await readAlgos();
 return {ok:ok===true,fresh:!algoError&&Date.now()-readStamp<15000,
  message:ok===true?'바이낸스 보호주문 조회 완료':
   (algoError||'API 잠금 또는 보호주문 조회 진행 중 · 잠시 후 다시 시도해 줘')};
};
document.addEventListener('btc:real-account-updated',e=>{
 const d=e.detail;if(!d||!Array.isArray(d.positions)||!Number.isFinite(d.at))return;
 positions=d.positions.map(p=>({...p,amount:num(p.amount),entry:num(p.entry),mark:num(p.mark)}))
 .filter(p=>side(p)&&Math.abs(p.amount)>0);
 accountAt=d.at;
 if(!positions.length)note('실제 포지션 없음');
 redraw();
 if(Date.now()-readStamp>4500)void readAlgos();
});
document.addEventListener('btc:real-account-cleared',()=>{positions=[];algos=[];accountAt=0;readStamp=0;redraw();document.dispatchEvent(new Event('btc:real-protection-updated'));});
function scaleNow(){return window.btcLiveScale||null;}
function touchHit(x,y){
 const scale=scaleNow();if(!scale||!positions.length||document.hidden)return null;
 const rect=chart.getBoundingClientRect(),px=x-rect.left,py=y-rect.top;
 if(px<0||px>scale.plotW||py<scale.top-35||py>scale.priceBottom+35||!(scale.hi>scale.lo))return null;
 return levels().filter(l=>l.kind!=='entry'&&chartVisible(l.kind)).map(l=>({l,dist:Math.abs(py-(scale.top+(scale.hi-l.price)/(scale.hi-scale.lo)*(scale.priceBottom-scale.top)))}))
  .filter(x=>x.dist<=35).sort((a,b)=>a.dist-b.dist||(b.l.active?1:0)-(a.l.active?1:0))[0]?.l||null;
}
// The parent chart drawing tool must defer when an actual TP/SL line is hit.
window.btcRealProtectionHit=(x,y)=>!!touchHit(x,y);
function priceAt(y){
 const s=scaleNow(),rect=chart.getBoundingClientRect();
 const local=y-rect.top;
 return s?s.hi-(local-s.top)/(s.priceBottom-s.top)*(s.hi-s.lo):NaN;
}
// IPhone PWA-safe confirmation. No exchange mutation before explicit tap.
function confirmProtectionReplacement(details){
 return new Promise(resolve=>{
  const existing=document.getElementById('realStopReplacementConfirm');
  if(existing)existing.remove();
  const wrap=document.createElement('div');wrap.id='realStopReplacementConfirm';
  wrap.style.cssText='position:fixed;inset:0;z-index:100120;display:flex;align-items:center;justify-content:center;background:rgba(2,9,19,.91);padding:16px';
  const card=document.createElement('div');
  card.style.cssText='width:min(100%,420px);max-height:86dvh;overflow:auto;border-radius:15px;padding:18px;background:#172b43;border:1px solid #6889aa;color:#edf6ff;box-shadow:0 18px 65px #000b';
  const title=document.createElement('h3');title.textContent=details.title;
  title.style.cssText='margin:0 0 12px;font-size:18px';
  const info=document.createElement('p');info.textContent=details.message;
  info.style.cssText='white-space:pre-line;font-size:13px;line-height:1.7;color:#ceddea';
  const alert=document.createElement('p');alert.textContent='실제 바이낸스 주문 변경입니다. 기존 주문 취소와 새 주문 등록 사이에 보호 공백이 생길 수 있습니다. 실패하거나 연결이 끊기면 바이낸스 앱에서 즉시 손절 주문을 확인하세요.';
  alert.style.cssText='font-size:12px;line-height:1.6;color:#ffd29a';
  const actions=document.createElement('div');actions.style.cssText='display:flex;gap:10px;margin-top:16px';
  const cancel=document.createElement('button');cancel.type='button';cancel.textContent='취소';
  const yes=document.createElement('button');yes.type='button';yes.textContent='기존 손절 취소 후 새 가격 등록';
  for(const button of [cancel,yes])button.style.cssText='flex:1;min-height:48px;border-radius:8px;border:1px solid #54799b;background:#2c4564;color:white;font-size:13px;padding:8px';
  yes.style.background='#0e7364';yes.style.borderColor='#56cbb4';
  const close=ok=>{wrap.remove();resolve(ok)};
  cancel.addEventListener('click',()=>close(false));
  yes.addEventListener('click',()=>close(true));
  actions.append(cancel,yes);card.append(title,info,alert,actions);wrap.append(card);
  document.body.append(wrap);cancel.focus({preventScroll:true});
 });
}
function matchingNormalStop(o,p,kind){
 // Older ordinary conditional stop orders are a separate Binance list.
 const expectedSide=side(p)==='LONG'?'SELL':'BUY';
 const wanted=kind==='sl'?['STOP','STOP_MARKET']:['TAKE_PROFIT','TAKE_PROFIT_MARKET'];
 return o?.symbol===symbol&&o?.positionSide===p.side&&o?.side===expectedSide&&
  wanted.includes(o.type||o.orderType)&&
  (o.reduceOnly===true||o.reduceOnly==='true'||o.closePosition===true||
   o.closePosition==='true');
}
async function moveProtection(l,raw){
 if(requestBusy)return false;
 actionMessage='';actionError=false;
 const s=l.side,p=l.p,kind=l.kind;
 const targetRaw=Number(raw),mark=num(p.mark);
 if(!(targetRaw>0&&mark>0)){
  actionNotice('마크가 또는 변경할 가격을 확인할 수 없습니다',true);return false;
 }
 const valid=s==='LONG'?(kind==='sl'?targetRaw<mark:targetRaw>mark):
  (kind==='sl'?targetRaw>mark:targetRaw<mark);
 if(!valid){
  actionNotice('현재 마크가 '+fmt(mark)+' USDT 기준 손절·익절 방향이 올바르지 않습니다',true);
  return false;
 }
 // Read both Algo and ordinary order inventories BEFORE asking for consent.
 let oldAlgo,oldNormal;
 try{
  const results=await Promise.all([
   signed('GET','/fapi/v1/openAlgoOrders',{symbol}),
   signed('GET','/fapi/v1/openOrders',{symbol})
  ]);
  const algoList=openAlgoList(results[0]);
  if(!Array.isArray(algoList)||!Array.isArray(results[1]))
   throw Error('바이낸스 조건부/일반 주문 목록을 확인할 수 없습니다');
  oldAlgo=algoList.filter(o=>matching(o,p,kind));
  oldNormal=results[1].filter(o=>matchingNormalStop(o,p,kind));
  // Fail closed rather than deleting orders that may belong elsewhere.
  if(oldAlgo.some(o=>!(Number(o.algoId)>0))||
    oldNormal.some(o=>!(Number(o.orderId)>0)))
   throw Error('기존 손절 주문 ID를 확인할 수 없습니다');
 }catch(e){
  actionNotice('⚠ 기존 손절 주문 조회 실패 · '+String(e?.message||e),true);
  return false;
 }
 const allOld=[...oldAlgo,...oldNormal];
 if(allOld.length>5){
  actionNotice('⚠ 활성 손절 주문이 '+allOld.length+'개입니다. 안전을 위해 자동 변경을 중단합니다. 바이낸스에서 확인하세요',true);
  return false;
 }
 let info;
 try{
  const [exchange,positionRisk]=await Promise.all([
   fetch(api+'/fapi/v1/exchangeInfo?symbol='+symbol,{cache:'no-store'}).then(async r=>{
    if(!r.ok)throw Error('호가 단위 조회 실패 · HTTP '+r.status);return r.json();
   }),
   signed('GET','/fapi/v3/positionRisk',{symbol})
  ]);
  const symbolInfo=exchange.symbols?.find(x=>x.symbol===symbol);
  const pf=symbolInfo?.filters?.find(f=>f.filterType==='PRICE_FILTER');
  const lot=symbolInfo?.filters?.find(f=>f.filterType==='LOT_SIZE');
  const step=num(pf?.tickSize),qtyStep=num(lot?.stepSize),minQty=num(lot?.minQty);
  if(!(step>0&&qtyStep>0&&minQty>0))throw Error('바이낸스 가격/수량 단위 확인 실패');
  const liveList=Array.isArray(positionRisk)?positionRisk:[positionRisk];
  const live=liveList.find(x=>x?.symbol===symbol&&x.positionSide===p.side&&
   Math.abs(num(x.positionAmt))>0&&
   Math.sign(num(x.positionAmt))===(s==='LONG'?1:-1));
  if(!live)throw Error('동일 방향의 실제 보유 포지션을 찾을 수 없습니다');
  const qty=Math.abs(num(live.positionAmt)),liveMark=num(live.markPrice);
  if(Math.abs(qty-Math.abs(num(p.amount)))>1e-7)
   throw Error('포지션 수량이 바뀌었습니다. 계좌를 새로고침 후 다시 수정하세요');
  const nowValid=s==='LONG'?(kind==='sl'?targetRaw<liveMark:targetRaw>liveMark):
   (kind==='sl'?targetRaw>liveMark:targetRaw<liveMark);
  if(!(liveMark>0&&nowValid))
   throw Error('마크가가 변경되어 새 보호 가격이 유효하지 않습니다');
  if(qty<minQty||Math.abs(qty/qtyStep-Math.round(qty/qtyStep))>1e-6)
   throw Error('현재 포지션 수량이 거래소 수량 단위와 맞지 않습니다');
  const digits=Math.min(8,(String(pf.tickSize).split('.')[1]||'').length);
  const snapped=(Math.round(targetRaw/step)*step).toFixed(digits);
  const snapValid=s==='LONG'?(kind==='sl'?Number(snapped)<liveMark:Number(snapped)>liveMark):
   (kind==='sl'?Number(snapped)>liveMark:Number(snapped)<liveMark);
  if(!snapValid)throw Error('호가 단위 적용 후 현재 마크가를 넘습니다');
  const kinds=new Set(allOld.map(o=>o.orderType||o.type));
  if(kinds.size>1)throw Error('서로 다른 시장가/지정가 손절 유형이 혼재합니다. 바이낸스에서 먼저 확인하세요');
  const oldType=kinds.size?[...kinds][0]:(kind==='sl'?'STOP_MARKET':'TAKE_PROFIT_MARKET');
  if(!['STOP','STOP_MARKET','TAKE_PROFIT','TAKE_PROFIT_MARKET'].includes(oldType))
   throw Error('지원되지 않는 보호 주문 종류입니다');
  const workingTypes=new Set(allOld.map(o=>o.workingType||'CONTRACT_PRICE'));
  if(workingTypes.size>1)throw Error('서로 다른 손절 발동 기준이 혼재합니다. 바이낸스에서 확인하세요');
  info={step,qty,liveMark,snapped,oldType,
   workingType:oldAlgo[0]?.workingType||oldNormal[0]?.workingType||'MARK_PRICE',
   reduceOnly:p.side==='BOTH'};
 }catch(e){
  actionNotice('⚠ 손절 주문 변경 전 검사 실패 · '+String(e?.message||e),true);
  return false;
 }
 const existingDescription=allOld.length?
  allOld.map(o=>fmt(num(o.triggerPrice??o.stopPrice))+' USDT').join(', '):
  '없음';
 const accepted=await confirmProtectionReplacement({
  title:s+' '+(kind==='sl'?'손절':'익절')+' 주문 교체',
  message:'현재 활성 보호주문 '+allOld.length+'개 · '+existingDescription+
   '\n새 보호가격 '+fmt(info.snapped)+' USDT'+
   '\n종류 '+info.oldType+' · 수량 '+fmt(info.qty)+' BTC'+
   '\n대상: '+s+' '+p.side+' BTCUSDT 주문만 (익절과 반대 포지션 제외)'+
   '\n모든 이전 '+(kind==='sl'?'손절':'익절')+' 주문을 취소 확인한 후 새 주문 1개만 등록합니다.'
 });
 if(!accepted){actionNotice('보호 주문 변경을 취소했습니다',true);return false;}
 requestBusy=true;window.btcProtectionEditBusy=true;
 const reqId='btcp'+(kind==='sl'?'s':'t')+s[0]+Date.now().toString(36);
 const isLimit=['STOP','TAKE_PROFIT'].includes(info.oldType);
 const req={algoType:'CONDITIONAL',symbol,positionSide:p.side,
  side:s==='LONG'?'SELL':'BUY',type:info.oldType,
  triggerPrice:info.snapped,workingType:info.workingType,
  clientAlgoId:reqId};
 if(isLimit){
  req.quantity=String(info.qty);req.price=info.snapped;req.timeInForce='GTC';
  if(info.reduceOnly)req.reduceOnly='true';
 }else req.closePosition='true';
 const readBoth=async()=>{
  const responses=await Promise.all([
   signed('GET','/fapi/v1/openAlgoOrders',{symbol}),
   signed('GET','/fapi/v1/openOrders',{symbol})
  ]);
  const algoList=openAlgoList(responses[0]);
  if(!Array.isArray(algoList)||!Array.isArray(responses[1]))
   throw Error('거래소의 최종 미체결 주문 목록을 확인할 수 없습니다');
  return {algo:algoList.filter(o=>matching(o,p,kind)),
   normal:responses[1].filter(o=>matchingNormalStop(o,p,kind))};
 };
 const knownOldIds=oldAlgo.map(o=>String(o.algoId));
 const knownNormalIds=oldNormal.map(o=>String(o.orderId));
 let cancellationStarted=false;
 try{
  // Revalidate immediately before cancellation. Only originally confirmed
  // order IDs may be canceled; if any new order appeared, stop safely.
  const before=await readBoth();
  if(before.algo.length!==knownOldIds.length||
     before.normal.length!==knownNormalIds.length||
     before.algo.some(o=>!knownOldIds.includes(String(o.algoId)))||
     before.normal.some(o=>!knownNormalIds.includes(String(o.orderId))))
   throw Error('주문 목록이 확인 이후 변경됐습니다. 새 주문 등록 없이 중단합니다');
  for(const o of before.algo){
   actionNotice('기존 '+(kind==='sl'?'손절':'익절')+' 주문 취소 중 · #'+o.algoId);
   cancellationStarted=true;
   await signed('DELETE','/fapi/v1/algoOrder',{symbol,algoId:String(o.algoId)});
  }
  for(const o of before.normal){
   actionNotice('기존 일반 손절 주문 취소 중 · #'+o.orderId);
   cancellationStarted=true;
   await signed('DELETE','/fapi/v1/order',{symbol,orderId:String(o.orderId)});
  }
  const afterCancel=await readBoth();
  if(afterCancel.algo.length||afterCancel.normal.length)
   throw Error('기존 손절 주문이 아직 활성 상태입니다. 추가 주문 등록을 중단합니다');
  actionNotice('기존 보호 주문 '+allOld.length+'개 취소 확인 · 새 가격 등록 중');
  try{await signed('POST','/fapi/v1/algoOrder',req)}
  catch(e){
   // A timeout after submission is ambiguous. Do not re-submit blindly.
   const uncertain=await readBoth().catch(()=>null);
   if(!uncertain?.algo.some(o=>o.clientAlgoId===reqId))
    throw Error('신규 주문 등록을 확인할 수 없습니다 · '+String(e?.message||e));
  }
  const final=await readBoth();
  const found=final.algo.filter(o=>o.clientAlgoId===reqId);
  if(found.length!==1||final.algo.length!==1||final.normal.length!==0||
    Math.abs(num(found[0].triggerPrice)-num(info.snapped))>Math.max(info.step/10,1e-8))
   throw Error('신규 가격으로 단일 활성 주문임을 확인하지 못했습니다');
  algos=(await signed('GET','/fapi/v1/openAlgoOrders',{symbol})).filter(o=>o.symbol===symbol);
  readStamp=Date.now();algoError='';
  redraw();document.dispatchEvent(new Event('btc:real-protection-updated'));
  actionNotice('✅ 이전 주문 '+allOld.length+'개 취소 · 새 '+(kind==='sl'?'손절':'익절')+
   ' '+info.snapped+' USDT 단일 활성 확인 완료');
  return true;
 }catch(e){
  const message=String(e?.message||e);
  // Never pretend success after a partial cancellation. Do not blindly
  // restore/create an order: its activation/position status may have changed.
  actionNotice('⚠ 보호 주문 교체 미완료 · '+message+
   (cancellationStarted?'\n보호 공백 또는 중복 가능성! 바이낸스 활성 손절 주문을 즉시 확인해 주세요.':''),true);
  return false;
 }finally{
  requestBusy=false;window.btcProtectionEditBusy=false;
  void readAlgos();
 }
}
// The position-card price editor reuses the EXACT guarded exchange workflow
// used by dragging/tapping the live chart TP/SL line. Never update UI optimistically.
window.btcRequestRealProtectionChange=async({side:direction,positionSide,amount,kind,price})=>{
 if(!['LONG','SHORT'].includes(direction)||!['tp','sl'].includes(kind))
  return {ok:false,message:'포지션 방향 또는 보호 주문 종류가 잘못되었습니다.'};
 const target=Number(price);
 if(!Number.isFinite(target)||!(target>0))
  return {ok:false,message:'0보다 큰 유효한 가격을 입력하세요.'};
 if(requestBusy)return {ok:false,message:'이미 다른 보호 주문을 변경하고 있습니다.'};
 if(document.hidden)return {ok:false,message:'앱이 보이는 상태에서 다시 시도하세요.'};
 const pos=positions.find(p=>p.side===positionSide&&side(p)===direction&&
  Math.abs(num(p.amount)-Number(amount))<1e-8);
 if(!pos)return {ok:false,message:'실제 포지션 수량 또는 방향이 변경되었습니다. 계좌 새로고침 후 다시 시도하세요.'};
 if(algoError||Date.now()-readStamp>15000){
  const ok=await readAlgos();
  if(!ok||algoError||Date.now()-readStamp>15000)
   return {ok:false,message:'바이낸스 보호주문 조회 실패 · '+(algoError||'API 잠금이나 네트워크를 확인해 주세요')};
 }
 const current=getProtection(pos,kind);
 const oldPrice=num(current?.triggerPrice);
 if(Number.isFinite(oldPrice)&&Math.abs(oldPrice-target)<1e-8)
  return {ok:true,message:'이미 거래소에 동일한 가격의 보호 주문이 등록되어 있습니다.'};
 const success=await moveProtection({p:pos,side:direction,kind,price:oldPrice,order:current},target);
 // Confirm success through the freshly verified in-memory exchange order list;
 // declined browser confirmation and failed replacement MUST never look applied.
 const active=getProtection(pos,kind);
 const verified=success===true&&!algoError&&Date.now()-readStamp<=15000&&
  num(active?.triggerPrice)>0&&Math.abs(num(active.triggerPrice)-target)<=
    Math.max(1e-6,target*.00001);
 return {ok:verified,message:verified?'바이낸스 보호 주문 변경 및 확인 완료':
  (actionError?actionMessage:'변경이 확인되지 않았습니다. 바이낸스 주문 상태를 다시 확인해 주세요.')};
};
function start(x,y){
 if(requestBusy||document.hidden)return false;
 const l=touchHit(x,y);if(!l)return false;
 drag={level:l,startY:y,price:l.price,moved:false};
 actionNotice('↕ '+l.side+' '+(l.kind==='sl'?'손절':'익절')+'선 선택됨 · 위아래로 이동 후 놓으면 변경 확인창이 뜹니다');
 return true;
}
function move(y){
 if(!drag)return;
 if(Math.abs(y-drag.startY)>5)drag.moved=true;
 if(!drag.moved)return;
 const price=priceAt(y);
 if(Number.isFinite(price)&&price>0){drag.price=price;redraw();
  actionNotice('↕ '+drag.level.side+' '+(drag.level.kind==='sl'?'손절':'익절')+' 변경 예정 '+fmt(price)+' USDT · 손가락을 놓으면 확인');}
}
function finish(cancel=false){
 const d=drag;drag=null;redraw();
 if(cancel||!d)return;
 if(d.moved&&Math.abs(d.price-d.level.price)>=.01){
  actionNotice('보호 가격 '+fmt(d.price)+' USDT · 주문 변경 확인 대기');
  void moveProtection(d.level,d.price);return;}
 // A tap opens a precise-price editor; drag still offers direct placement.
 const requested=prompt(d.level.side+' '+(d.level.kind==='sl'?'손절':'익절')+
  ' 가격 입력 (USDT) · 바이낸스 실제 조건부 주문을 변경합니다',String(Math.round(d.level.price*10)/10));
 if(requested===null)return;
 const cleaned=requested.trim().replace(/,/g,'');
 if(!/^\d+(?:\.\d+)?$/.test(cleaned)||!(Number(cleaned)>0)){
  actionNotice('⚠ 손절·익절 가격은 0보다 큰 숫자로 입력하세요',true);return;
 }
 if(Math.abs(Number(cleaned)-d.level.price)<.01)return;
 void moveProtection(d.level,Number(cleaned));
}
chart.addEventListener('touchstart',e=>{
 if(e.touches.length!==1||!start(e.touches[0].clientX,e.touches[0].clientY))return;
 e.preventDefault();e.stopImmediatePropagation();
},{capture:true,passive:false});
chart.addEventListener('touchmove',e=>{
 if(!drag)return;e.preventDefault();e.stopImmediatePropagation();
 if(e.touches.length===1)move(e.touches[0].clientY);else finish(true);
},{capture:true,passive:false});
chart.addEventListener('touchend',e=>{if(!drag)return;e.preventDefault();e.stopImmediatePropagation();finish(e.touches.length>0)},{capture:true,passive:false});
chart.addEventListener('touchcancel',e=>{if(drag){e.stopImmediatePropagation();finish(true)}},{capture:true});
chart.addEventListener('mousedown',e=>{
 if(e.button!==0||!start(e.clientX,e.clientY))return;
 e.preventDefault();e.stopImmediatePropagation();
 const onMove=ev=>move(ev.clientY);
 const onUp=()=>{window.removeEventListener('mousemove',onMove);window.removeEventListener('mouseup',onUp);finish();};
 window.addEventListener('mousemove',onMove);window.addEventListener('mouseup',onUp);
},true);
// Re-read Binance-hosted TP/SL as soon as the manual order supervisor
// confirms an order. The chart never labels an unregistered preview as active.
document.addEventListener('btc:manual-protection-status',e=>{
 const detail=e.detail||{};
 if(detail.ok===true){
  actionMessage='';actionError=false;
  actionNotice('✅ 실제 바이낸스 손절·익절 주문 활성 확인 · 차트 라인 갱신',false);
  readStamp=0;
  void readAlgos();
 }else if(detail.ok===false&&detail.message){
  actionNotice(String(detail.message),true);
  readStamp=0;
  void readAlgos();
 }
});
setInterval(()=>{if(Date.now()-readStamp>5500)void readAlgos()},5500);
document.addEventListener('btc:credentials-unlocked',()=>setTimeout(readAlgos,800));
setTimeout(readAlgos,1500);
})();