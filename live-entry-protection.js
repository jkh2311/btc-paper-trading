/* BTCUSDT live entry + venue-side protection workflow planner.
 * READ-ONLY: no trade methods are called, no simulated fills.
 * Every draft is ephemeral, cleared on lock or app background.
 */
(()=>{
'use strict';
const parent=document.getElementById('page-position');
if(!parent)return;
const section=document.createElement('section');
section.className='direct-live';
section.setAttribute('aria-label','실전 진입 및 보호 주문 계획');
const title=document.createElement('h2');title.textContent='실전 진입 + 거래소 보호 주문 · 사전 계획';
const intro=document.createElement('p');intro.textContent='수동 지정가 주문 미리보기를 먼저 검증하면 진입 주문과 손절/익절 계획이 나옵니다. 보호 주문은 실제 체결 수량을 확인한 뒤 거래소에 등록해야 하며, 현재 실행 기능은 잠겨 있습니다.';
const rrLabel=document.createElement('label');rrLabel.textContent='목표 손익비 (익절/손절 거리)';
const rr=document.createElement('input');rr.type='number';rr.min='0.5';rr.max='5';rr.step='0.1';rr.value='1.5';rrLabel.append(rr);
const preview=document.createElement('button');preview.type='button';preview.textContent='진입·손절·익절 계획 확인';
const result=document.createElement('pre');result.style.cssText='white-space:pre-wrap;overflow-wrap:anywhere;background:#091828;padding:11px;border-radius:9px;font-size:12px;line-height:1.7';
result.textContent='실제 계좌 조회 → 지정가 미리보기 → 여기서 보호 주문 계획을 확인하세요.';
const note=document.createElement('p');note.textContent='주문 전송 비활성화: 신규 주문/손절/익절 Algo 주문은 실제로 등록되지 않습니다. 거래소의 거래 상태와 기존 보호 주문 확인 없이 자동 실행하면 안 됩니다.';
section.append(title,intro,rrLabel,preview,result,note);
const existing=parent.querySelector('.live-draft');
if(existing?.parentNode)existing.insertAdjacentElement('afterend',section);else parent.prepend(section);
let draft=null,lastAccountAt=0;
const clear=(message)=>{draft=null;result.textContent=message};
document.addEventListener('btc:entry-draft-validated',e=>{
 const v=e.detail;
 if(v?.symbol==='BTCUSDT'&&Number.isFinite(v.quantity)&&v.quantity>0){
  draft={...v};result.textContent='진입 초안 검증됨 · 손익비를 설정하고 계획을 확인하세요.';
 }
});
document.addEventListener('btc:live-account-read',()=>{lastAccountAt=Date.now();draft=null;result.textContent='실제 계좌가 새로 조회됐습니다. 지정가 주문 수량을 다시 검증하세요.'});
document.addEventListener('btc:live-lock',()=>{lastAccountAt=0;clear('API 잠금 · 주문 계획 초기화')});
document.addEventListener('visibilitychange',()=>{if(document.hidden){lastAccountAt=0;clear('앱 비활성화 · 계획 초기화')}});

const fixed=(n,p=8)=>Number(n).toLocaleString('en-US',{maximumFractionDigits:p});
preview.addEventListener('click',()=>{
 try{
  if(!draft)throw Error('먼저 실제 계좌에서 수동 지정가 미리보기를 실행해 주세요.');
  if(Date.now()-draft.validatedAt>60000)throw Error('주문 미리보기 검증 결과가 만료됐습니다.');
  if(!lastAccountAt||Date.now()-lastAccountAt>60000)throw Error('실제 계좌 잔고·포지션을 다시 조회해 주세요.');
  if(!['LONG','SHORT'].includes(draft.side)||!(draft.quantity>0)||!(draft.price>0)||
     !(draft.stopPrice>0)||!Number.isFinite(draft.leverage))throw Error('실전 주문 입력이 유효하지 않습니다.');
  const ratio=Number(rr.value);
  if(!Number.isFinite(ratio)||ratio<.5||ratio>5)throw Error('손익비는 0.5~5 범위만 허용합니다.');
  const diff=Math.abs(draft.price-draft.stopPrice);
  if(!(diff>0))throw Error('손절 폭이 0입니다.');
  const isLong=draft.side==='LONG',entrySide=isLong?'BUY':'SELL',exitSide=isLong?'SELL':'BUY';
  const tp=draft.price+(isLong?1:-1)*diff*ratio;
  if(!(tp>0))throw Error('익절 가격이 잘못됐습니다.');
  // Never guess hedge-vs-oneway: this is derived from the current account snapshot.
  const ps=draft.positionSide;
  if(!['BOTH','LONG','SHORT'].includes(ps))throw Error('실제 계좌 포지션 모드 확인 필요');
  if(ps!=='BOTH'&&ps!==draft.side)throw Error('계좌 포지션 방향이 진입 방향과 다릅니다');
  const entry={symbol:'BTCUSDT',side:entrySide,positionSide:ps,type:'LIMIT',
    timeInForce:'FOK',quantity:fixed(draft.quantity),price:fixed(draft.price,4)};
  const stop={algoType:'CONDITIONAL',symbol:'BTCUSDT',side:exitSide,positionSide:ps,
    type:'STOP_MARKET',triggerPrice:fixed(draft.stopPrice,4),workingType:'MARK_PRICE'};
  const take={algoType:'CONDITIONAL',symbol:'BTCUSDT',side:exitSide,positionSide:ps,
    type:'TAKE_PROFIT_MARKET',triggerPrice:fixed(tp,4),workingType:'MARK_PRICE'};
  // In hedge mode, protective orders must use positionSide and verified filled qty.
  // In one-way mode, reduceOnly/closePosition semantics must be verified prior to live writes.
  const risk=draft.quantity*diff;
  result.textContent=[
   '계획만 생성됨 · 실제 주문 전송 0건',
   '',
   '① 수동 지정가 주문: '+entry.side+' '+entry.positionSide+
     ' / '+entry.quantity+' BTC @ '+entry.price+' USDT',
   '② 체결 상태 확인: 신규 주문 ID → order.status → 실제 누적 체결 수량 검증',
   '③ 보호 손절: '+stop.side+' '+stop.type+' / 트리거 '+stop.triggerPrice+' USDT',
   '④ 보호 익절: '+take.side+' '+take.type+' / 트리거 '+take.triggerPrice+' USDT',
   '⑤ 보호 주문 Algo ID 및 ACTIVE/NEW 상태 재확인 후에만 주문 관리 가능',
   '',
   '목표 손익비 '+fixed(ratio,1)+' / 이론상 손절 손실 약 '+fixed(risk,2)+' USDT (수수료·슬리피지 제외)',
   '실제 체결 수량이 예상보다 적으면 보호 수량을 체결 수량에 맞춰야 합니다.',
   '보호 주문 실패/타임아웃 시 자동 재주문 금지 · 바이낸스 앱에서 즉시 확인 필요',
   '아이폰 PWA 종료 시 앱 내 자동 관리 불가: 거래소 등록 보호 주문 필수',
   '',
   '검증된 진입 계획 필드: '+Object.keys(entry).join(', '),
   '조건부 보호 주문 필드: '+Object.keys(stop).join(', ')
  ].join('\n');
 }catch(e){result.textContent='보호 계획 생성 불가: '+e.message}
});
})();