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
 const wanted=kind==='sl'?'STOP_MARKET':'TAKE_PROFIT_MARKET';
 return a.symbol===symbol&&a.positionSide===p.side&&a.side===(side(p)==='LONG'?'SELL':'BUY')&&
  (a.orderType||a.type)===wanted&&['NEW','ACCEPTED',''].includes(String(a.algoStatus||a.status||''))&&num(a.triggerPrice)>0;
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
  const d=num($('stop')?.value)/100,rr=num($('rr')?.value);
  for(const kind of ['sl','tp']){
   const order=getProtection(p,kind);
   let price=num(order?.triggerPrice);
   if(!(price>0)&&d>0&&rr>0){
    price=entry*(s==='LONG'?(kind==='sl'?1-d:1+d*rr):(kind==='sl'?1+d:1-d*rr));
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
  const price=drag?.level?.p===level.p&&drag.level.kind===level.kind?drag.price:level.price;
  const y=scale.y(price);
  if(y<scale.top||y>scale.priceBottom)continue;
  const color=level.active?(level.side==='LONG'?'#41dbad':'#ff819b'):'#f4bc61';
  ctx.save();
  ctx.strokeStyle=color;ctx.lineWidth=level.kind==='entry'?2.3:1.8;
  ctx.setLineDash(level.kind==='entry'?[]:level.active?[7,4]:[2,4]);
  ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(scale.plotW,y);ctx.stroke();
  ctx.setLineDash([]);
  const type=level.kind==='entry'?'진입':level.kind==='sl'?'손절':'익절';
  const label=level.side+' '+type+(level.active?'':' 미등록')+' '+fmt(price);
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
 if(readBusy||requestBusy||document.hidden||!creds()?.apiKey)return;
 readBusy=true;const id=++epoch;
 try{
  const r=await signed('GET','/fapi/v1/openAlgoOrders',{symbol});
  const a=openAlgoList(r);
  if(!a)throw Error('조건부 주문 응답 형식 오류');
  if(id===epoch){algos=a.filter(o=>o.symbol===symbol);algoError='';readStamp=Date.now();
   if(positions.length)note('실전 진입선 / 손절·익절선 · 손절·익절선 길게 누르거나 드래그하여 실제 가격 변경');
   redraw();document.dispatchEvent(new Event('btc:real-protection-updated'));}
 }catch(e){if(id===epoch){algoError=String(e?.message||e);if(!actionMessage)note('⚠ 보호 주문 조회 실패 · '+algoError,true);redraw();}}
 finally{readBusy=false;}
}
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
 const scale=scaleNow();if(!scale||!positions.length)return null;
 const rect=chart.getBoundingClientRect(),px=x-rect.left,py=y-rect.top;
 if(px<0||px>scale.plotW||py<scale.top-12||py>scale.priceBottom+12)return null;
 return levels().filter(l=>l.kind!=='entry'&&chartVisible(l.kind)).map(l=>({l,dist:Math.abs(py-(scale.top+(scale.hi-l.price)/(scale.hi-scale.lo)*(scale.priceBottom-scale.top)))}))
  .filter(x=>x.dist<=17).sort((a,b)=>a.dist-b.dist)[0]?.l||null;
}
function priceAt(y){
 const s=scaleNow(),rect=chart.getBoundingClientRect();
 const local=y-rect.top;
 return s?s.hi-(local-s.top)/(s.priceBottom-s.top)*(s.hi-s.lo):NaN;
}
async function moveProtection(l,raw){
 if(requestBusy)return;
 actionMessage='';actionError=false;
 const s=l.side,p=l.p,kind=l.kind,current=getProtection(p,kind);
 const mark=num(p.mark),targetRaw=raw;
 if(!(mark>0&&targetRaw>0))return note('현재 마크가 확인 후 다시 시도하세요',true);
 const valid=s==='LONG'?(kind==='sl'?targetRaw<mark:targetRaw>mark):(kind==='sl'?targetRaw>mark:targetRaw<mark);
 if(!valid)return note('손절·익절 가격이 현재 마크가의 잘못된 방향입니다',true);
 if(current&&String(current.clientAlgoId||'').startsWith('btcp')===false)
  return note('앱 외부에서 등록한 보호 주문은 변경하지 않습니다. 바이낸스에서 직접 수정하세요.',true);
 if(algoError||Date.now()-readStamp>15000)return note('바이낸스 조건부 주문이 최신 상태가 아닙니다. 재조회 후 시도하세요.',true);
 let tick='0.1';
 try{
  const r=await fetch(api+'/fapi/v1/exchangeInfo?symbol='+symbol,{cache:'no-store'});
  if(!r.ok)throw Error('호가 단위 조회 실패');
  const json=await r.json();
  tick=json.symbols?.find(x=>x.symbol===symbol)?.filters?.find(f=>f.filterType==='PRICE_FILTER')?.tickSize;
  if(!tick||!(Number(tick)>0))throw Error('호가 단위 확인 실패');
 }catch(e){return note('가격 단위 확인 실패: '+e.message,true);}
 const step=Number(tick),digits=(String(tick).split('.')[1]||'').length;
 const snapped=(Math.round(targetRaw/step)*step).toFixed(Math.min(digits,8));
 if(!(Number(snapped)>0))return;
 const validSnapped=s==='LONG'?(kind==='sl'?Number(snapped)<mark:Number(snapped)>mark):(kind==='sl'?Number(snapped)>mark:Number(snapped)<mark);
 if(!validSnapped)return note('호가 단위 반영 후 현재 마크가를 넘습니다. 다른 가격을 선택하세요.',true);
 if(!confirm(s+' '+(kind==='sl'?'손절':'익절')+' 실제 주문을 '+fmt(snapped)+' USDT로 '+(current?'교체':'등록')+'할까요?\n'+
  (current?'바이낸스는 기존 전체 청산용 조건부 주문과 새 주문의 중복 등록을 거부합니다. 기존 주문을 취소한 뒤 재등록하므로 잠시 보호 공백이 발생할 수 있습니다. 실패하면 기존 가격 복구를 시도하며, 복구도 실패할 수 있습니다.':'바이낸스 실제 조건부 주문을 전송합니다.')+'\n앱 화면이 아니라 거래소 주문 상태를 반드시 확인하세요.'))return;
 requestBusy=true;actionNotice('바이낸스 실제 '+(kind==='sl'?'손절':'익절')+' 주문 변경 중 · 거래소 확인 전에는 적용된 것이 아닙니다');
 try{
  const updated=await signed('GET','/fapi/v1/openAlgoOrders',{symbol});
  const currentList=openAlgoList(updated);
  if(!Array.isArray(currentList))throw Error('실제 주문 상태 확인 불가');
  const found=currentList.filter(a=>matching(a,p,kind));
  if(found.length>1)throw Error('동일 방향에 활성 보호 주문이 여러 개 있습니다. 바이낸스에서 확인 후 수정하세요');
  if(current&&(!found.some(a=>String(a.algoId)===String(current.algoId))||found.length!==1))
   throw Error('실제 보호 주문이 변경되었습니다. 중복 주문 방지를 위해 중단합니다');
  if(!current&&found.length)throw Error('다른 보호 주문이 존재합니다. 바이낸스에서 확인하세요');
  const freshPosition=await signed('GET','/fapi/v3/positionRisk',{symbol});
  const currentPositions=Array.isArray(freshPosition)?freshPosition:[freshPosition];
  const live=currentPositions.find(x=>x?.symbol===symbol&&x.positionSide===p.side&&
   Math.abs(num(x.positionAmt))>0);
  if(!live)throw Error('실제 보유 포지션이 없습니다. 보호 주문 변경을 중단합니다');
  if(Math.abs(Math.abs(num(live.positionAmt))-Math.abs(num(p.amount)))>1e-8)
   throw Error('포지션 수량이 바뀌었습니다. 주문을 재조회한 후 다시 수정하세요');
  const liveMark=num(live.markPrice);
  const validNow=s==='LONG'?(kind==='sl'?Number(snapped)<liveMark:Number(snapped)>liveMark):
   (kind==='sl'?Number(snapped)>liveMark:Number(snapped)<liveMark);
  if(!(liveMark>0&&validNow))throw Error('마크가 변동으로 지정 가격이 유효하지 않습니다');
  const type=kind==='sl'?'STOP_MARKET':'TAKE_PROFIT_MARKET';
  const newId='btcp'+(kind==='sl'?'s':'t')+s[0]+Date.now().toString(36);
  const req={algoType:'CONDITIONAL',symbol,side:s==='LONG'?'SELL':'BUY',positionSide:p.side,type,
   closePosition:'true',triggerPrice:snapped,workingType:'MARK_PRICE',clientAlgoId:newId};
  // Binance -4130 rejects a second GTE closePosition conditional order in
  // the same direction. No general modify endpoint exists for these Algo orders.
  // With explicit user consent, cancel the own old order, then place the new one.
  // The restore path is best effort, never a guarantee of uninterrupted protection.
  let oldCancelled=false;
  const activeOrders=()=>signed('GET','/fapi/v1/openAlgoOrders',{symbol}).then(openAlgoList);
  const isNew=a=>a.clientAlgoId===newId&&matching(a,p,kind)&&
   Math.abs(num(a.triggerPrice)-Number(snapped))<=Math.max(step/10,1e-8);
  const oldId=String(current?.algoId||'');
  const oldPrice=num(current?.triggerPrice);
  const oldClient=String(current?.clientAlgoId||'');
  const restoreId='btcpr'+(kind==='sl'?'s':'t')+s[0]+Date.now().toString(36);
  try{
   if(current){
    if(!oldId||!(oldPrice>0)||!oldClient.startsWith('btcp'))
     throw Error('기존 보호 주문 소유권을 확인할 수 없어 취소하지 않습니다');
    const beforeCancel=await activeOrders();
    if(!beforeCancel||beforeCancel.filter(a=>matching(a,p,kind)).length!==1||
       !beforeCancel.some(a=>String(a.algoId)===oldId))
     throw Error('기존 보호 주문 정보가 바뀌었습니다. 재조회 후 시도하세요');
    actionNotice('보호 주문 교체 중 · 기존 주문 취소 후 새 가격 등록 예정');
    await signed('DELETE','/fapi/v1/algoOrder',{symbol,algoId:oldId});
    oldCancelled=true;
    const afterCancel=await activeOrders();
    if(!afterCancel||afterCancel.some(a=>String(a.algoId)===oldId))
     throw Error('이전 주문 취소 확인 실패 · 중복 등록하지 않고 중단합니다');
   }
   actionNotice('새 '+(kind==='sl'?'손절':'익절')+' 주문 등록 중 · 적용 확인 전');
   try{await signed('POST','/fapi/v1/algoOrder',req);}
   catch(issue){
    // A network timeout can happen after Binance accepted the order.
    const maybe=await activeOrders().catch(()=>null);
    if(!maybe||!maybe.some(isNew))
     throw Error('새 주문 등록 실패: '+String(issue?.message||issue));
   }
   const final=await activeOrders();
   if(!final)throw Error('거래소 최종 조건부 주문 목록 확인 실패');
   const after=final.filter(a=>matching(a,p,kind));
   if(after.length!==1||!isNew(after[0]))
    throw Error('새 조건부 주문이 유일한 활성 주문인지 확인할 수 없습니다');
   algos=final.filter(a=>a.symbol===symbol);readStamp=Date.now();algoError='';
   redraw();document.dispatchEvent(new Event('btc:real-protection-updated'));
   actionNotice('✅ '+s+' '+(kind==='sl'?'손절':'익절')+' '+snapped+' USDT · 거래소 활성 주문 확인 완료');
  }catch(issue){
   if(oldCancelled){
    // Restore only when no replacement/other matching order is active.
    // Never blindly submit duplicates after ambiguous network failures.
    let latest=null,restoreError='';
    try{latest=await activeOrders();}catch(e){restoreError=String(e?.message||e);}
    if(latest){
     if(latest.some(isNew)){
      algos=latest.filter(a=>a.symbol===symbol);readStamp=Date.now();algoError='';
      redraw();document.dispatchEvent(new Event('btc:real-protection-updated'));
      actionNotice('✅ 새 주문 '+snapped+' USDT 활성 확인 · 이전 주문은 취소됨');
      return;
     }
     if(latest.filter(a=>matching(a,p,kind)).length===0){
      // Check the position and the old trigger relative to current MARK_PRICE.
      try{
       const fresh=await signed('GET','/fapi/v3/positionRisk',{symbol});
       const items=Array.isArray(fresh)?fresh:[fresh];
       const still=items.find(x=>x.symbol===symbol&&x.positionSide===p.side&&Math.abs(num(x.positionAmt))>0);
       if(!still)throw Error('포지션이 종료되었거나 방향이 바뀌었습니다');
       const m=num(still.markPrice),allowed=s==='LONG'?
        (kind==='sl'?oldPrice<m:oldPrice>m):(kind==='sl'?oldPrice>m:oldPrice<m);
       if(!allowed)throw Error('마크가 변동으로 원래 보호 가격을 다시 등록할 수 없습니다');
       const backup={...req,triggerPrice:String(oldPrice),clientAlgoId:restoreId,
        workingType:current.workingType||'MARK_PRICE'};
       await signed('POST','/fapi/v1/algoOrder',backup);
      }catch(e){restoreError=String(e?.message||e);}
      latest=await activeOrders().catch(()=>null);
     }
    }
    const restored=latest?.filter(a=>matching(a,p,kind)).some(a=>
     Math.abs(num(a.triggerPrice)-oldPrice)<=Math.max(step/10,1e-8));
    if(restored){
     algos=latest.filter(a=>a.symbol===symbol);readStamp=Date.now();algoError='';
     redraw();document.dispatchEvent(new Event('btc:real-protection-updated'));
     throw Error(String(issue?.message||issue)+' · 기존 '+oldPrice+' USDT 보호 주문 복구 확인');
    }
    throw Error('⚠ 보호 주문 공백 가능! 변경 실패: '+String(issue?.message||issue)+
     (restoreError?' · 복구 실패: '+restoreError:' · 복구 여부 불명')+
     ' · 바이낸스에서 즉시 손절·익절 주문을 확인하세요');
   }
   throw issue;
  }
 }catch(e){actionNotice('⚠ 주문 변경을 확인하지 못했습니다: '+String(e?.message||e)+'\n바이낸스에서 해당 방향의 손절·익절 주문과 중복 여부를 확인해 주세요.',true)}
 finally{requestBusy=false;void readAlgos();}
}
function start(x,y){
 if(requestBusy||document.hidden)return false;
 const l=touchHit(x,y);if(!l)return false;
 drag={level:l,startY:y,price:l.price,moved:false};
 return true;
}
function move(y){
 if(!drag)return;
 if(Math.abs(y-drag.startY)>5)drag.moved=true;
 if(!drag.moved)return;
 const price=priceAt(y);
 if(Number.isFinite(price)&&price>0){drag.price=price;redraw();}
}
function finish(cancel=false){
 const d=drag;drag=null;redraw();
 if(cancel||!d)return;
 if(d.moved&&Math.abs(d.price-d.level.price)>=.01){void moveProtection(d.level,d.price);return;}
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
setInterval(()=>{if(Date.now()-readStamp>5500)void readAlgos()},5500);
document.addEventListener('btc:credentials-unlocked',()=>setTimeout(readAlgos,800));
setTimeout(readAlgos,1500);
})();