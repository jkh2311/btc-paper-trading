/* BTCUSDT manual entry and protective orders -- execution architecture v13.
 * LIVE TRANSMISSION IS DISABLED. This file creates a validated, inert
 * transmission plan only. No order.place / algoOrder.place calls are made.
 * A single PWA cannot guarantee continuous post-fill protection while closed.
 */
(()=>{
'use strict';
const root=document.getElementById('page-position');if(!root)return;
const ACTIVE_LIVE_TRANSMISSION=false;
const SECURE_DEFAULTS=Object.freeze({
 symbol:'BTCUSDT',maxMargin:20,maxNotional:100,maxLeverage:10,
 maxAge:45000,minStopPct:.1,maxStopPct:5
});
const element=(tag,text)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;return el};
const box=element('section');box.className='direct-live';
const title=element('h2','수동 진입 + 실제 보호 주문 · 전송 설계');
const description=element('p','실제 BTCUSDT 롱·숏 신규 주문과 거래소 STOP_MARKET/TAKE_PROFIT_MARKET 보호 주문에 필요한 요청을 검사합니다. 이 빌드에서는 실제 주문 전송을 차단합니다.');
const ratioLabel=element('label','목표 손익비');
const ratio=element('input');ratio.type='number';ratio.min='0.5';ratio.max='3';ratio.step='.1';ratio.value='1.5';ratioLabel.append(ratio);
const btn=element('button','주문 + 보호 주문 규격 검증');btn.type='button';
const send=element('button','실제 주문 전송 · 검증 전 잠금');send.type='button';send.disabled=true;
const output=element('pre');output.style.cssText='white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px;line-height:1.6;background:#091827;padding:10px;border-radius:10px';
output.textContent='계좌 새로고침 → 주문 미리보기 → 이곳에서 매개변수를 검증해 주세요.';
const notice=element('p','중요: 미체결 주문은 언제 체결될지 예측할 수 없습니다. 체결 이후 앱이 꺼지면 보호 주문 등록이 실패할 수 있어요. 실전 진입은 자동 보호 검증 전까지 잠금 유지.');
box.append(title,description,ratioLabel,btn,send,output,notice);
root.append(box);
let snapshot=null,draft=null,checked=null,seq=0;
function clear(message){seq++;draft=null;checked=null;output.textContent=message;send.disabled=true}
document.addEventListener('btc:live-account-read',e=>{
 snapshot={at:Date.now(),positions:Array.isArray(e.detail?.positions)?e.detail.positions:[],
  availableBalance:Number(e.detail?.account?.availableBalance),
  canTrade:e.detail?.account?.canTrade===true};
 clear('계좌를 새로 조회했어요. 지정가 수량을 다시 검증해 주세요.');
});
document.addEventListener('btc:entry-draft-validated',e=>{
 const v=e.detail;if(v?.symbol!=='BTCUSDT')return;
 draft={...v,receivedAt:Date.now()};checked=null;
 output.textContent='실제 계좌를 참조한 지정가 초안 수신. 주문·보호 주문 검증 버튼을 눌러 주세요.';
});
document.addEventListener('btc:live-lock',()=>{snapshot=null;clear('API 잠금 · 진입 계획 초기화')});
document.addEventListener('visibilitychange',()=>{if(document.hidden){snapshot=null;clear('앱 백그라운드 · 진입 계획 초기화')}});
const integerQty=v=>Number.isFinite(v)&&v>0;
const isOneWay=p=>p==='BOTH';
const isHedge=p=>p==='LONG'||p==='SHORT';
const num=v=>Number(v);
const fmt=(v,places=8)=>num(v).toFixed(places).replace(/\.?0+$/,'');
function buildPlan(account,v,rr){
 if(!account||!account.canTrade||!Number.isFinite(account.availableBalance)||!(account.availableBalance>0))
  throw Error('바이낸스 실제 가용 잔고 또는 거래 권한 검증 실패');
 if(Date.now()-account.at>SECURE_DEFAULTS.maxAge||Date.now()-v.receivedAt>SECURE_DEFAULTS.maxAge)
  throw Error('계좌/수량 미리보기 45초 만료 · 다시 조회 필요');
 if(!['LONG','SHORT'].includes(v.side)||!integerQty(v.quantity)||!(v.price>0)||!(v.stopPrice>0))
  throw Error('방향·수량·가격·손절 값 오류');
 if(!Number.isFinite(v.leverage)||v.leverage<1||v.leverage>SECURE_DEFAULTS.maxLeverage)
  throw Error('이 버전은 레버리지 10배 이하에서만 검증 가능');
 const notional=v.quantity*v.price,margin=notional/v.leverage;
 if(!(margin>0&&margin<=SECURE_DEFAULTS.maxMargin&&notional<=SECURE_DEFAULTS.maxNotional&&
      margin<=account.availableBalance*.05))
  throw Error('최대 한도: 예상 증거금 20 USDT, 명목가 100 USDT, 가용 잔고의 5% 이내');
 const ps=v.positionSide;
 if(!isOneWay(ps)&&!(isHedge(ps)&&ps===v.side))throw Error('계좌 포지션 모드가 진입 방향과 맞지 않음');
 // Reject if another position may be open: no adding to unprotected position in this stage.
 const hasExisting=account.positions.some(p=>Number.isFinite(num(p.positionAmt))&&Math.abs(num(p.positionAmt))>1e-9);
 if(hasExisting)throw Error('이미 열린 BTCUSDT 포지션 존재: 보호 주문/피라미드 검증 전 신규 진입 차단');
 const isLong=v.side==='LONG';
 if(isLong&&v.stopPrice>=v.price||!isLong&&v.stopPrice<=v.price)throw Error('손절 방향 오류');
 const dist=Math.abs(v.price-v.stopPrice),pct=dist/v.price*100;
 if(pct<SECURE_DEFAULTS.minStopPct||pct>SECURE_DEFAULTS.maxStopPct)
  throw Error('손절 거리 범위 0.1~5% 밖');
 if(!(rr>=.5&&rr<=3))throw Error('손익비 0.5~3 밖');
 const entrySide=isLong?'BUY':'SELL',exitSide=isLong?'SELL':'BUY';
 const tick=Number(v.tickSize),step=Number(v.quantityStep);
 if(!(tick>0&&step>0&&Number.isFinite(tick)&&Number.isFinite(step)))
  throw Error('거래소 호가 단위와 수량 단위를 다시 검증해야 합니다');
 const nearTick=x=>Math.abs(x/tick-Math.round(x/tick))<1e-7;
 const nearStep=x=>Math.abs(x/step-Math.round(x/step))<1e-7;
 if(!nearTick(v.price)||!nearTick(v.stopPrice)||!nearStep(v.quantity))
  throw Error('진입가·손절가·수량이 거래소 필터와 불일치');
 const rawTake=isLong?v.price+dist*rr:v.price-dist*rr;
 const take=Math.round(rawTake/tick)*tick;
 if(!(take>0)||!nearTick(take)||isLong&&take<=v.price||!isLong&&take>=v.price)
  throw Error('익절 가격이 호가 단위와 맞지 않음');
 // The quantity cannot be used with closePosition=true. For hedge mode
 // positionSide must equal the side to be *closed*.
 const entry={symbol:'BTCUSDT',side:entrySide,positionSide:ps,type:'LIMIT',
  timeInForce:'FOK',quantity:fmt(v.quantity),price:fmt(v.price,4)};
 const common={algoType:'CONDITIONAL',symbol:'BTCUSDT',side:exitSide,
  positionSide:ps,workingType:'MARK_PRICE',closePosition:'true'};
 const stop={...common,type:'STOP_MARKET',triggerPrice:fmt(v.stopPrice,4)};
 const tp={...common,type:'TAKE_PROFIT_MARKET',triggerPrice:fmt(take,4)};
 if('quantity'in stop||'quantity'in tp||'reduceOnly'in stop||'reduceOnly'in tp)
  throw Error('closePosition=true 보호 주문 파라미터 충돌');
 return {entry,stop,tp,notional,margin,pct,rr,
  warning:'실제 체결 및 보호 주문 접수/상태 확인 전에는 안전한 거래라고 판단할 수 없습니다.'};
}
btn.addEventListener('click',()=>{
 try{
  if(!snapshot||!draft)throw Error('계좌 조회와 수동 주문 미리보기를 먼저 완료해 주세요');
  const plan=buildPlan(snapshot,draft,Number(ratio.value));
  checked={plan,at:Date.now(),seq:seq};
  const shape=p=>Object.entries(p).map(([k,v])=>k+'='+v).join(' · ');
  output.textContent=[
   '✅ 주문/보호 주문 매개변수 구조 검증 통과 · 전송 0건',
   '① 바이낸스 order.place 신규 LIMIT · '+shape(plan.entry),
   '② 실제 order.status 체결·부분체결 확인(미체결 기간 계속 모니터링 필요)',
   '③ 바이낸스 algoOrder.place 손절 · '+shape(plan.stop),
   '④ 바이낸스 algoOrder.place 익절 · '+shape(plan.tp),
   '⑤ 각 clientAlgoId/Algo ID를 조회해 모두 NEW/활성 상태인지 확인',
   '⑥ 하나라도 미확인/실패하면 신규 주문을 차단하고 바이낸스 앱에서 수동 대응',
   '',
   '예상 증거금 '+plan.margin.toFixed(3)+' USDT · 목표 손절폭 '+plan.pct.toFixed(3)+'% · 손익비 '+plan.rr,
   '⚠ 지정가 미체결과 부분체결은 계속 변동할 수 있으며, 보호 주문은 실제 접수되지 않았습니다.'
  ].join('\n');
  send.disabled=!ACTIVE_LIVE_TRANSMISSION; // permanently false in this branch
 }catch(e){checked=null;send.disabled=true;output.textContent='검증 실패: '+e.message}
});
send.addEventListener('click',()=>{send.disabled=true;output.textContent='이 개발 버전에서는 실제 주문 전송이 잠겨 있습니다.'});
})();