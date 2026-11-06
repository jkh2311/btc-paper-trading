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
window.btcLiveChartPrices=()=>levels().map(l=>l.price).filter(p=>Number.isFinite(p)&&p>0);
window.btcDrawLiveLevels=(ctx,scale)=>{
 const all=levels();
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
 const rect=chart.getBoundingClientRect(),px=(x-rect.left)*chart.width/rect.width,py=(y-rect.top)*chart.height/rect.height;
 if(px<0||px>scale.plotW||py<scale.top-12||py>scale.priceBottom+12)return null;
 return levels().filter(l=>l.kind!=='entry').map(l=>({l,dist:Math.abs(py-(scale.top+(scale.hi-l.price)/(scale.hi-scale.lo)*(scale.priceBottom-scale.top)))}))
  .filter(x=>x.dist<=17).sort((a,b)=>a.dist-b.dist)[0]?.l||null;
}
function priceAt(y){
 const s=scaleNow(),rect=chart.getBoundingClientRect();
 const local=(y-rect.top)*chart.height/rect.height;
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
 if(!confirm(s+' '+(kind==='sl'?'손절':'익절')+' 실제 주문 가격을 '+fmt(snapped)+' USDT로 '+(current?'변경':'등록')+'할까요?\n바이낸스 조건부 주문을 실제로 전송합니다.'))return;
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
  // Register the replacement before cancelling the old order: avoid an unprotected gap.
  let response=null;
  try{response=await signed('POST','/fapi/v1/algoOrder',req);}catch(e){
   const check=await signed('GET','/fapi/v1/openAlgoOrders',{symbol});
   const arr=openAlgoList(check)||[];
   if(!arr.some(a=>a.clientAlgoId===newId))throw Error('새 보호 주문 등록 불확실: '+e.message);
  }
  const check=await signed('GET','/fapi/v1/openAlgoOrders',{symbol});
  const arr=openAlgoList(check);
  if(!arr||!arr.some(a=>a.clientAlgoId===newId&&matching(a,p,kind)&&
     Math.abs(num(a.triggerPrice)-Number(snapped))<=Math.max(step/10,1e-8)))
   throw Error('새 주문 활성/가격 확인 실패 · 기존 보호 주문을 유지했습니다');
  if(current?.algoId)await signed('DELETE','/fapi/v1/algoOrder',{symbol,algoId:String(current.algoId)});
  // Verify the final exchange state before telling the user that the move worked.
  const final= openAlgoList(await signed('GET','/fapi/v1/openAlgoOrders',{symbol}));
  if(!final)throw Error('최종 보호 주문 조회 실패 · 바이낸스에서 확인하세요');
  const after=final.filter(a=>matching(a,p,kind));
  if(after.length!==1||after[0].clientAlgoId!==newId||
     Math.abs(num(after[0].triggerPrice)-Number(snapped))>Math.max(step/10,1e-8))
   throw Error('최종 주문 상태가 요청과 다릅니다. 중복 또는 미적용 주문을 바이낸스에서 확인하세요');
  algos=final.filter(a=>a.symbol===symbol);readStamp=Date.now();algoError='';
  redraw();document.dispatchEvent(new Event('btc:real-protection-updated'));
  actionNotice('✅ '+s+' '+(kind==='sl'?'손절':'익절')+' '+snapped+' USDT · 바이낸스 주문 변경 확인 완료');
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