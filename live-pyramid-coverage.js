/* v15: six-stage sizing and position protection coverage, read only. */
(()=>{
'use strict';
const host=document.getElementById('page-position');if(!host)return;
const el=(tag,t)=>{const n=document.createElement(tag);if(t!==undefined)n.textContent=t;return n};
const first=host.querySelector('.direct-live');
function card(title){const x=el('section');x.className='direct-live';x.append(el('h2',title));return x}
function field(box,title,initial){const l=el('label',title),input=el('input');input.type='number';input.inputMode='decimal';input.value=initial;l.append(input);box.append(l);return input}
function selector(box,title,values){const l=el('label',title),s=el('select');for(const value of values){const opt=el('option',String(value));opt.value=String(value);s.append(opt)}l.append(s);box.append(l);return s}
const pyramid=card('실전 6단계 피라미드 · 수량 계산');
pyramid.append(el('p','6단계 예산을 분배해 실제 BTC 수량을 계산합니다. 실제 주문은 전송하지 않습니다.'));
const side=selector(pyramid,'방향',['LONG','SHORT']),stage=selector(pyramid,'단계',[1,2,3,4,5,6]);
const budget=field(pyramid,'6단계 총 증거금 예산 USDT','30'),price=field(pyramid,'예상 BTC 지정가 USDT','');
const calc=el('button','단계별 수량 계산');calc.type='button';
const result=el('pre','실제 계좌를 조회한 뒤 예산과 가격을 입력하세요.');
result.style.cssText='white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px;line-height:1.7';
pyramid.append(calc,result);
const protection=card('실제 포지션 · 손절/익절 수량 점검');
const compare=el('button','실제 포지션과 보호 수량 비교');compare.type='button';
const coverage=el('pre','실제 계좌와 조건부 주문을 각각 조회하세요.');
coverage.style.cssText='white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px;line-height:1.7';
protection.append(el('p','바이낸스에서 조회한 포지션 수량과 손절·익절 후보 수량을 비교합니다. 보호 주문 체결을 보장하지는 않습니다.'),compare,coverage);
if(first){first.insertAdjacentElement('afterend',pyramid);pyramid.insertAdjacentElement('afterend',protection)}
else{host.prepend(protection);host.prepend(pyramid)}
const W=[1,1.2,1.4,1.6,1.8,2],SUM=W.reduce((a,b)=>a+b,0);
const n=v=>v===null||v===undefined||v===''?NaN:Number(v);
const fmt=(v,d=6)=>Number.isFinite(v)?v.toLocaleString('ko-KR',{maximumFractionDigits:d}):'—';
const active=new Set(['NEW','ACCEPTED','WORKING','ACTIVE']);
let account=null,orders=null,filter=null,locked=false;
const fresh=x=>x&&Date.now()-x.at<60000;
document.addEventListener('btc:live-account-read',e=>{
 const d=e.detail;if(!Array.isArray(d?.positions))return;
 account={at:Date.now(),available:n(d.account?.availableBalance),positions:d.positions.map(p=>({
  side:p.positionSide,qty:n(p.positionAmt),lev:n(p.leverage)}))};
 filter=null;locked=false;result.textContent='계좌 조회됨. 예산과 지정가를 입력하세요.';
 coverage.textContent='계좌 조회됨. 조건부 미체결도 새로 조회하세요.';
});
document.addEventListener('btc:open-order-snapshot',e=>{
 if(!Array.isArray(e.detail?.algoOrders))return;
 orders={at:Date.now(),rows:e.detail.algoOrders.map(o=>({
  id:String(o.algoId||''),side:o.side,positionSide:o.positionSide,type:String(o.type||''),
  status:String(o.algoStatus||''),qty:n(o.quantity),close:o.closePosition===true||o.closePosition==='true'}))};
 coverage.textContent='조건부 주문 조회됨. 비교 버튼을 누르세요.';
});
const reset=()=>{account=null;orders=null;filter=null;locked=true;result.textContent='API 잠금/앱 비활성화. 다시 조회하세요.';coverage.textContent='계좌/보호 주문 재조회 필요'};
document.addEventListener('btc:live-lock',reset);
document.addEventListener('visibilitychange',()=>{if(document.hidden)reset()});
async function getRules(){
 if(filter&&Date.now()-filter.at<300000)return filter;
 const response=await fetch('https://fapi.binance.com/fapi/v1/exchangeInfo',
  {method:'GET',cache:'no-store',signal:AbortSignal.timeout(8000)});
 if(!response.ok)throw Error('거래소 거래 규칙 조회 실패');
 const data=await response.json(),s=data?.symbols?.find(x=>x.symbol==='BTCUSDT'&&x.status==='TRADING');
 if(!s)throw Error('BTCUSDT 거래 가능 상태 미확인');
 const get=type=>s.filters?.find(f=>f.filterType===type);
 const r={at:Date.now(),step:n(get('LOT_SIZE')?.stepSize),min:n(get('LOT_SIZE')?.minQty),
  tick:n(get('PRICE_FILTER')?.tickSize),minNotional:n(get('MIN_NOTIONAL')?.notional)};
 if(!(r.step>0&&r.min>0&&r.tick>0))throw Error('거래소 단위 확인 실패');
 filter=r;return r;
}
calc.onclick=async()=>{
 if(locked||!fresh(account)){result.textContent='실제 계좌를 60초 이내에 다시 조회하세요';return}
 calc.disabled=true;
 try{
  const b=n(budget.value),p=n(price.value),index=Number(stage.value)-1;
  if(!(b>0&&p>0&&Number.isFinite(b)&&Number.isFinite(p)&&index>=0&&index<6))
   throw Error('예산, 가격, 단계 확인');
  if(!(account.available>0&&b<=account.available))throw Error('예산이 실제 가용 잔고보다 많습니다');
  const position=account.positions.find(x=>x.side===side.value)||account.positions.find(x=>x.side==='BOTH');
  if(!position||!(position.lev>=1&&position.lev<=125))throw Error('실제 계좌 레버리지 확인 실패');
  const rules=await getRules();if(locked||!fresh(account))throw Error('계좌 정보 만료');
  if(Math.abs(p/rules.tick-Math.round(p/rules.tick))>1e-7)throw Error('지정가 호가 단위 오류');
  const rows=W.map((w,i)=>{
   const m=b*w/SUM,q=Math.floor(m*position.lev/p/rules.step+1e-9)*rules.step;
   const ok=q>=rules.min&&(!(rules.minNotional>0)||q*p>=rules.minNotional-1e-8);
   return {i,m,q,ok};
  });
  result.textContent='방향 '+side.value+' · 실제 레버리지 '+position.lev+'배\n'+
   '총 계획 증거금 '+fmt(b,3)+' USDT / 가용 '+fmt(account.available,3)+' USDT\n'+
   rows.map(x=>(x.i+1)+'단계 '+fmt(x.m,3)+' USDT · '+fmt(x.q,8)+' BTC'+(x.ok?'':' (최소 주문 조건 미달)')).join('\n')+
   '\n선택 '+(index+1)+'단계: '+(rows[index].ok?fmt(rows[index].q,8)+' BTC':'거래소 최소 조건 미달')+
   '\n\n실제 주문 전송 없음. 단계 수는 사용자가 관리하는 계획이며 바이낸스 포지션 수와 다릅니다.';
 }catch(e){result.textContent='계산 실패: '+String(e.message||e)}
 finally{calc.disabled=false}
};
compare.onclick=()=>{
 if(locked||!fresh(account)||!fresh(orders)||Math.abs(account.at-orders.at)>30000){
  coverage.textContent='계좌와 조건부 주문을 최근 60초 내, 30초 이내 간격으로 모두 조회해 주세요.';return;
 }
 const pos=account.positions.filter(p=>Number.isFinite(p.qty)&&Math.abs(p.qty)>1e-9);
 if(!pos.length){coverage.textContent='현재 열린 BTCUSDT 포지션 없음 (마지막 조회 기준)';return}
 const lines=[];
 for(const p of pos){
  const side=p.side==='BOTH'?(p.qty>0?'LONG':'SHORT'):p.side;
  const exit=side==='LONG'?'SELL':'BUY',quantity=Math.abs(p.qty);
  const relevant=orders.rows.filter(o=>o.side===exit&&active.has(o.status)&&
   (o.positionSide===p.side||p.side==='BOTH'&&o.positionSide==='BOTH'));
  const group=(name,types)=>{
   const list=relevant.filter(o=>types.includes(o.type)),closeAll=list.some(o=>o.close);
   const sum=list.reduce((a,o)=>a+(Number.isFinite(o.qty)&&o.qty>0?o.qty:0),0);
   return name+' '+list.length+'건 '+(closeAll?'closePosition=true 후보':fmt(sum,8)+' BTC')+
    (!list.length?' ⚠ 없음':!closeAll&&sum+1e-8<quantity?' ⚠ 수량 부족 가능':'')+
    '\nAlgo ID: '+(list.map(o=>o.id).join(', ')||'없음');
  };
  lines.push(side+' '+fmt(quantity,8)+' BTC\n'+
   group('손절',['STOP_MARKET','STOP'])+'\n'+
   group('익절',['TAKE_PROFIT_MARKET','TAKE_PROFIT']));
 }
 coverage.textContent=lines.join('\n\n')+
  '\n\n조회 시점의 후보 수량 비교이며 보호 주문 접수·트리거·실행 성공을 보증하지 않습니다.';
};
})();