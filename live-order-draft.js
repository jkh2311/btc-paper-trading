/* Manual BTCUSDT LIMIT order sizing preview only. NO order submission. */
(()=>{
'use strict';
const host=document.getElementById('page-position');
if(!host)return;
const css=document.createElement('style');css.textContent='.live-draft{background:#11243a;border:1px solid #4a6382;border-radius:12px;padding:12px;margin:8px 0;color:#eaf2ff}.live-draft h3{margin:0 0 8px;font-size:15px}.live-draft small{font-size:11px;color:#b5c9df;line-height:1.5}.live-draft label{font-size:12px}.live-draft select,.live-draft input{min-width:0;width:100%;padding:9px}.live-draft .fields{display:grid;grid-template-columns:1fr 1fr;gap:8px}.live-draft button{width:100%;margin:10px 0 2px;padding:10px}.live-draft pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px;line-height:1.6;background:#081828;padding:10px;border-radius:8px}.live-draft .warn{color:#ffcca1}';document.head.append(css);
const c=document.createElement('section');c.className='live-draft';
c.innerHTML='<h3>실전 수동 지정가 주문 · 미리보기</h3><small>실제 계좌 조회 후 주문 금액을 검증합니다. 현재 실제 주문 전송은 잠겨 있어요.</small><div class="fields"><label>방향<select id="draftSide"><option value="LONG">롱 LONG</option><option value="SHORT">숏 SHORT</option></select></label><label>예약 가격 (USDT)<input id="draftPrice" type="number" inputmode="decimal" min="1" step="0.1" placeholder="BTC 지정가"></label><label>예상 증거금 (USDT)<input id="draftMargin" type="number" inputmode="decimal" min="1" max="20" step="0.1" value="10"></label><label>손절 거리 (%)<input id="draftStop" type="number" min="0.1" max="10" step="0.1" value="0.8"></label></div><button id="draftCalculate" type="button">수량 · 손절 미리보기</button><pre id="draftResult" aria-live="polite">실제 계좌를 조회한 뒤 미리보기를 실행해 주세요.</pre><small class="warn">주문 전송 / 자동 진입 / 청산은 작동하지 않습니다. 보호 주문이 실제로 설치됐다는 뜻이 아닙니다.</small>';
const panel=host.querySelector('.direct-live');
if(panel?.parentNode)panel.parentNode.insertBefore(c,panel.nextSibling);
else host.prepend(c);
const e=id=>document.getElementById(id),result=e('draftResult');
let snapshot=null,filters=null;
document.addEventListener('btc:live-account-read',event=>{snapshot=event.detail;result.textContent='계좌 조회 완료 · 지정가와 증거금을 입력해 검증할 수 있어요.'});
document.addEventListener('btc:live-lock',()=>{snapshot=null;result.textContent='API 잠금됨 · 계좌를 다시 조회해야 합니다.'});
async function exchangeFilters(){
 if(filters)return filters;
 const r=await fetch('https://fapi.binance.com/fapi/v1/exchangeInfo',{cache:'no-store',signal:AbortSignal.timeout(7000)});
 if(!r.ok)throw Error('거래소 주문 규칙 조회 실패');
 const info=await r.json(),sym=info?.symbols?.find(x=>x.symbol==='BTCUSDT'&&x.status==='TRADING');
 if(!sym)throw Error('BTCUSDT 거래 가능 상태 확인 실패');
 const lot=sym.filters?.find(x=>x.filterType==='LOT_SIZE'),price=sym.filters?.find(x=>x.filterType==='PRICE_FILTER');
 if(!lot||!price)throw Error('거래소 수량/가격 규칙 확인 실패');
 filters={step:Number(lot.stepSize),min:Number(lot.minQty),tick:Number(price.tickSize)};
 if(!Object.values(filters).every(x=>Number.isFinite(x)&&x>0))throw Error('거래소 주문 규칙 오류');
 return filters;
}
function floorStep(value,step){return Math.floor((value/step)+1e-9)*step}
function tickRound(value,step){return Math.round(value/step)*step}
function format(v,precision=6){return Number(v).toLocaleString('en-US',{maximumFractionDigits:precision})}
e('draftCalculate').onclick=async()=>{
 result.textContent='주문 조건 확인 중…';
 try{
  if(!snapshot)throw Error('먼저 포지션 탭에서 실제 바이낸스 계좌를 조회하세요');
  if(!snapshot.account?.canTrade)throw Error('계좌에 거래 권한이 확인되지 않았습니다');
  const side=e('draftSide').value,price=Number(e('draftPrice').value),margin=Number(e('draftMargin').value),stopPct=Number(e('draftStop').value)/100;
  const available=Number(snapshot.account.availableBalance);
  if(!(price>0&&margin>0&&stopPct>=.001&&stopPct<=.1&&available>0))throw Error('가격/증거금/손절 범위를 확인하세요');
  const maxMargin=Math.min(20,available*.05);
  if(margin>maxMargin)throw Error('미리보기 한도 초과: 가용 증거금의 5%와 20 USDT 중 작은 금액만 허용');
  const positions=snapshot.positions||[];
  const active=positions.find(p=>p.positionSide===side)||positions.find(p=>p.positionSide==='BOTH');
  const lev=Number(active?.leverage);
  if(!(lev>=1&&lev<=125))throw Error('실제 레버리지를 계좌에서 확인할 수 없습니다');
  const f=await exchangeFilters();
  if(Math.abs(price/f.tick-Math.round(price/f.tick))>1e-7)throw Error('예약 가격이 거래소 호가 단위와 맞지 않습니다');
  const qty=floorStep(margin*lev/price,f.step);
  if(!(qty>=f.min))throw Error('예상 주문 수량이 최소 주문 수량보다 작습니다');
  const stop=tickRound(price*(side==='LONG'?1-stopPct:1+stopPct),f.tick);
  if(!(stop>0))throw Error('손절 가격 계산 실패');
  result.textContent='실전 주문 전 사전 계산 · 주문 전송 없음\n'+
   '방향: '+side+'\n지정가: '+format(price,4)+' USDT\n실제 계좌 레버리지: '+lev+'배\n'+
   '예상 주문 수량: '+format(qty,8)+' BTC\n명목 금액: '+format(qty*price,2)+' USDT\n'+
   '예상 최초 증거금: '+format(qty*price/lev,3)+' USDT\n손절 목표 가격: '+format(stop,4)+' USDT\n'+
   '주의: 수수료, 유지증거금, 최소 명목가·주문 동시 제한 등은 별도 검증이 필요합니다. 실제 주문은 제출되지 않았습니다.';
  document.dispatchEvent(new CustomEvent('btc:entry-draft-validated',{detail:{
    symbol:'BTCUSDT',side,positionSide:active?.positionSide||'UNKNOWN',
    leverage:lev,price,quantity:Number(qty.toFixed(8)),stopPrice:stop,
    stopPct:Number((stopPct*100).toFixed(4)),availableBalance:available,
    validatedAt:Date.now()
  }}));
 }catch(err){result.textContent='미리보기 불가: '+(err?.message||'입력 확인 실패')}
};
})();
