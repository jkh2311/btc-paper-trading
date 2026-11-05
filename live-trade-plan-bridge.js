/* v17: live order plan bridge for manual ADD/REDUCE and RMI AUTO.
 * Direct-browser plan generation only. NO signed calls and NO trade transmission.
 * Binance positions are aggregated; never infer six separate fills from a single position.
 */
(()=>{
'use strict';
const host=document.getElementById('page-position');if(!host)return;
const elem=(tag,txt)=>{const e=document.createElement(tag);if(txt!==undefined)e.textContent=String(txt);return e};
const panel=elem('section');panel.className='direct-live';panel.append(elem('h2','실전 주문 계획 · 수동 / RMI AUTO'));
const desc=elem('p','실제 계좌와 거래소 주문 단위를 확인해 추가 진입·부분 청산 및 RMI 후보의 주문 방향과 보호 가격을 계산합니다. 아직 실제 주문 전송은 비활성화되어 있습니다.');
const label=elem('label','RMI 자동 주문 계획: 6단계 총 증거금 예산 USDT');
const total=elem('input');total.type='number';total.inputMode='decimal';total.min='1';total.value='60';label.append(total);
const stageLabel=elem('label','AUTO 계획 단계 (실제 진입 횟수는 거래소가 합산하므로 자동 추론 불가)');
const stage=elem('select');for(let i=1;i<=6;i++){const o=elem('option',i+'단계');o.value=String(i);stage.append(o)}stageLabel.append(stage);
const stopLabel=elem('label','손절 거리 % (계산용)');
const stopInput=elem('input');stopInput.type='number';stopInput.inputMode='decimal';stopInput.min='0.1';stopInput.max='5';stopInput.value='0.8';stopLabel.append(stopInput);
const rrLabel=elem('label','익절 손익비');
const rrInput=elem('input');rrInput.type='number';rrInput.min='0.5';rrInput.max='3';rrInput.value='1.5';rrLabel.append(rrInput);
const msg=elem('pre','실제 계좌 조회 후 수동 주문 수량을 계산하거나 RMI 신호 관찰을 ON 하세요.');
msg.setAttribute('role','status');msg.style.cssText='white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px;line-height:1.65;padding:10px;border-radius:9px;background:#091827';
panel.append(desc,label,stageLabel,stopLabel,rrLabel,msg);
host.append(panel);
const weight=[1,1.2,1.4,1.6,1.8,2],sum=9;
const number=x=>x===null||x===undefined||x===''?NaN:Number(x);
const display=(n,d=8)=>Number.isFinite(n)?n.toLocaleString('ko-KR',{maximumFractionDigits:d}):'—';
const safeQty=(n,step)=>Math.floor(n/step+1e-9)*step;
const tickRound=(n,step)=>Math.round(n/step)*step;
const fresh=v=>v&&Date.now()-v.ts<45000;
let account=null,rules=null,request=0;
function reset(note){request++;account=null;rules=null;msg.textContent=note||'실제 계좌를 다시 조회하세요.'}
document.addEventListener('btc:live-account-read',e=>{
 const d=e.detail;
 if(!Array.isArray(d?.positions))return;
 account={ts:Date.now(),canTrade:d.account?.canTrade===true,available:number(d.account?.availableBalance),
  positions:d.positions.map(p=>({side:p.positionSide,amount:number(p.positionAmt),lev:number(p.leverage)}))};
 msg.textContent='실제 계좌 조회 완료. 수동 포지션 계산 또는 RMI AUTO 신호를 확인하세요.';
});
document.addEventListener('btc:live-lock',()=>reset('API 잠금 · 계획 초기화'));
document.addEventListener('visibilitychange',()=>{if(document.hidden)reset('앱 화면 비활성화 · 계획 초기화')});
async function exchangeRules(){
 if(rules&&Date.now()-rules.ts<300000)return rules;
 const res=await fetch('https://fapi.binance.com/fapi/v1/exchangeInfo',
  {method:'GET',cache:'no-store',signal:AbortSignal.timeout(8000)});
 if(!res.ok)throw Error('바이낸스 거래 규칙 조회 실패');
 const data=await res.json(),s=data?.symbols?.find(v=>v.symbol==='BTCUSDT'&&v.status==='TRADING');
 const lot=s?.filters?.find(x=>x.filterType==='LOT_SIZE'),price=s?.filters?.find(x=>x.filterType==='PRICE_FILTER');
 const minimum=s?.filters?.find(x=>x.filterType==='MIN_NOTIONAL');
 const r={ts:Date.now(),step:number(lot?.stepSize),min:number(lot?.minQty),
  max:number(lot?.maxQty),tick:number(price?.tickSize),notional:number(minimum?.notional)};
 if(!(r.step>0&&r.min>0&&r.tick>0))throw Error('최소 주문 단위·호가 단위 확인 실패');
 rules=r;return r;
}
function pick(side){
 const own=account.positions.find(x=>x.side===side);
 if(own)return own;
 const both=account.positions.find(x=>x.side==='BOTH');
 if(!both)throw Error('거래소 포지션 모드 확인 실패');
 if(Math.abs(both.amount)>1e-9&&(side==='LONG'?both.amount<0:both.amount>0))
  throw Error('단방향 모드에서 반대 포지션 보유 중');
 return both;
}
function protection(p,side,price,stopPct,ratio,step){
 const long=side==='LONG',diff=price*stopPct/100;
 const sl=tickRound(price+(long?-diff:diff),step),tp=tickRound(price+(long?diff:-diff)*ratio,step);
 if(!(sl>0&&tp>0)||long&&(sl>=price||tp<=price)||!long&&(sl<=price||tp>=price))
  throw Error('손절/익절 방향 또는 가격 단위 오류');
 return {stop:sl,take:tp,closeSide:long?'SELL':'BUY',positionSide:p.side};
}
function renderPlan(origin,data,protect){
 const order={
  symbol:'BTCUSDT',side:data.orderSide,positionSide:data.positionSide,
  type:'LIMIT',timeInForce:'FOK',quantity:String(Number(data.quantity.toFixed(8))),
  price:String(data.price),
  ...(data.reduce&&data.positionSide==='BOTH'?{reduceOnly:'true'}:{})
 };
 if(!['BUY','SELL'].includes(order.side)||!(Number(order.quantity)>0)||
    !(Number(order.price)>0))throw Error('실행 대기 주문 파라미터 확인 실패');
 document.dispatchEvent(new CustomEvent('btc:live-execution-preview',{detail:{
  source:origin.startsWith('RMI AUTO')?'RMI':'MANUAL',order,
  stopCandidate:protect?{side:protect.closeSide,positionSide:protect.positionSide,
   triggerPrice:protect.stop,type:'STOP_MARKET',closePosition:true}:null,
  takeCandidate:protect?{side:protect.closeSide,positionSide:protect.positionSide,
   triggerPrice:protect.take,type:'TAKE_PROFIT_MARKET',closePosition:true}:null,
  inspectedAt:Date.now(),tradeEnabled:false
 }}));
 const lines=[origin+' · 실제 주문 전송 없음',
  '포지션 '+data.direction+' / Binance positionSide '+data.positionSide,
  '주문: '+data.orderSide+' '+display(data.quantity)+' BTC · 지정가 '+display(data.price,2)+' USDT',
  '레버리지 '+data.leverage+'배 · 주문 명목가 '+display(data.quantity*data.price,2)+' USDT'];
 if(data.reduce)lines.push('청산 예상: 보유 '+display(data.held)+' BTC → '+display(Math.max(0,data.held-data.quantity))+
  ' BTC / '+(data.positionSide==='BOTH'?'reduceOnly=true 필수':'동일 positionSide 청산'));
 else lines.push('추가 진입 이후 실제 포지션 수량·평균가 및 보호 주문을 다시 맞춰야 합니다.');
 if(protect)lines.push('보호 주문 후보(실제 주문 아님): 손절 '+display(protect.stop,2)+
  ' USDT, 익절 '+display(protect.take,2)+' USDT / 보호 청산 '+protect.closeSide);
 else lines.push('부분 청산: 남아 있는 보호 주문의 수량·트리거도 다시 확인해야 합니다.');
 lines.push('거래소 체결 확인/보호 주문 실제 접수 검증 전까지 신규 주문은 잠김');
 msg.textContent=lines.join('\n');
}
document.addEventListener('btc:position-action-planned',async e=>{
 const mine=++request;
 try{
  const d=e.detail;
  if(!fresh(account)||!account.canTrade)throw Error('실계좌 조회·거래 권한을 다시 확인하세요');
  if(d?.symbol!=='BTCUSDT'||!['ADD','REDUCE'].includes(d.kind)||
     !['LONG','SHORT'].includes(d.side)||!(d.quantity>0)||!(d.price>0)||
     Date.now()-d.checkedAt>45000)throw Error('수동 주문 계획 값이 만료되거나 유효하지 않음');
  const p=pick(d.side),r=await exchangeRules();
  if(mine!==request||!fresh(account))return;
  if(p.side!==d.positionSide||Math.abs(Math.abs(p.amount)-d.heldQty)>1e-8||
     p.lev!==d.leverage)throw Error('현재 계좌 포지션이 수량 계산 시점과 다름');
  if(d.quantity+1e-9<r.min||Number.isFinite(r.max)&&d.quantity>r.max||
     Math.abs(d.quantity/r.step-Math.round(d.quantity/r.step))>1e-7||
     Math.abs(d.price/r.tick-Math.round(d.price/r.tick))>1e-7)
     throw Error('거래소 최소·최대 수량 또는 가격 단위 오류');
  if(d.kind==='REDUCE'&&d.quantity>Math.abs(p.amount)+1e-8)throw Error('보유 수량 초과 청산 금지');
  const ratio=number(rrInput.value),stop=number(stopInput.value);
  if(!(ratio>=.5&&ratio<=3&&stop>=.1&&stop<=5))throw Error('손절 거리/익절 손익비 범위 오류');
  const protect=d.kind==='ADD'?protection(p,d.side,d.price,stop,ratio,r.tick):null;
  renderPlan('수동 '+(d.kind==='ADD'?'추가 진입':'부분 청산')+' 검증 완료',
   {direction:d.side,positionSide:p.side,orderSide:d.orderSide,quantity:d.quantity,
    price:d.price,leverage:p.lev,held:Math.abs(p.amount),reduce:d.kind==='REDUCE'},protect);
 }catch(err){if(mine===request)msg.textContent='수동 주문 계획 거절: '+String(err.message||err)}
});
document.addEventListener('btc:live-auto-plan-request',async e=>{
 const mine=++request;
 try{
  const d=e.detail,now=Date.now();
  if(!fresh(account)||!account.canTrade||!(account.available>0))throw Error('AUTO 실계좌 조회·거래 권한 필요');
  if(d?.symbol!=='BTCUSDT'||!['LONG','SHORT'].includes(d.side)||!(d.signalPrice>0)||
    now-(d.barTime+60000)>90000||now<d.barTime+60000)throw Error('RMI 신호가 오래되었거나 잘못됨');
  const b=number(total.value),i=number(stage.value)-1,stop=number(stopInput.value),ratio=number(rrInput.value);
  if(!(b>0&&b<=account.available&&Number.isInteger(i)&&i>=0&&i<6&&stop>=.1&&stop<=5&&ratio>=.5&&ratio<=3))
   throw Error('AUTO 예산·단계·손절/익절 입력값 오류');
  const p=pick(d.side);
  if(!(p.lev>=1&&p.lev<=125))throw Error('AUTO 실제 레버리지 미확인');
  const r=await exchangeRules();
  if(mine!==request||!fresh(account)||document.hidden)return;
  const price=tickRound(d.signalPrice,r.tick),margin=b*weight[i]/sum,quantity=safeQty(margin*p.lev/price,r.step);
  if(!(quantity>=r.min)&&!(quantity>0))throw Error('AUTO 선택 단계 BTC 수량 미달');
  if(!(quantity>=r.min)||Number.isFinite(r.max)&&quantity>r.max||
   Number.isFinite(r.notional)&&r.notional>0&&quantity*price+1e-8<r.notional)
   throw Error('AUTO 선택 단계가 거래소 주문 수량/최소 명목가 조건 미달');
  const protect=protection(p,d.side,price,stop,ratio,r.tick);
  const side=d.side==='LONG'?'BUY':'SELL';
  renderPlan('RMI AUTO '+(i+1)+'단계 후보 · 봉 '+new Date(d.barTime+60000).toLocaleTimeString('ko-KR'),
   {direction:d.side,positionSide:p.side,orderSide:side,quantity,price,leverage:p.lev,
    held:Math.abs(p.amount),reduce:false},protect);
  msg.textContent+='\nRMI 기준 '+d.minuteRmi+' · 현재 예상 증거금 '+display(margin,3)+
   ' USDT · 조건 '+String(d.marketMode||'')+' / 동일 봉 자동 중복 실행 없음';
 }catch(err){if(mine===request)msg.textContent='RMI AUTO 주문 계획 제외: '+String(err.message||err)}
});
})();