/* v16: manual order bridge and position add / partial close sizing.
 * Browser-only calculations; NO Binance write methods or key persistence.
 */
(()=>{
'use strict';
const root=document.getElementById('page-position');if(!root)return;
const create=(tag,text)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=String(text);return e};
const panel=create('section');panel.className='direct-live';
panel.append(create('h2','실제 포지션 추가 진입 · 부분 청산 계산'));
const info=create('p','바이낸스 실제 포지션과 레버리지로 추가 진입 또는 부분 청산 수량을 계산합니다. 주문은 아직 전송하지 않습니다.');
function input(label,value){const l=create('label',label),e=create('input');e.type='number';e.inputMode='decimal';e.value=value||'';l.append(e);panel.append(l);return e}
function choice(label,values){const l=create('label',label),e=create('select');for(const [v,t] of values){const o=create('option',t);o.value=v;e.append(o)}l.append(e);panel.append(l);return e}
panel.append(info);
const side=choice('포지션 방향',[['LONG','LONG'],['SHORT','SHORT']]);
const action=choice('실행 계획',[['ADD','추가 진입'],['REDUCE','부분 청산']]);
const margin=input('추가 진입 증거금 (USDT)','10');
const percent=input('부분 청산 비율 (%)','25');
const price=input('계산 기준 BTC 가격 (USDT)','');
const calculate=create('button','추가 진입·청산 수량 계산');
const output=create('pre','포지션 탭에서 실제 계좌를 새로 조회하세요.');
output.style.cssText='white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px;line-height:1.7;padding:10px;background:#091827;border-radius:9px';
panel.append(calculate,output);
const stageStatus=create('p','6단계 계산 결과를 수동 주문 입력칸에 적용할 수 있어요.');
stageStatus.setAttribute('role','status');
const apply=create('button','6단계 계산값을 수동 주문칸에 입력');apply.type='button';apply.disabled=true;
panel.append(stageStatus,apply);
root.append(panel);
let account=null,stage=null,ruleCache=null,epoch=0;
const numeric=v=>v===null||v===undefined||v===''?NaN:Number(v);
const fmt=(v,d=8)=>Number(v).toLocaleString('ko-KR',{maximumFractionDigits:d});
const safeStep=(v,step)=>Math.floor(v/step+1e-9)*step;
const isFresh=v=>v&&Date.now()-v.at<60000;
function reset(msg){epoch++;account=null;stage=null;ruleCache=null;apply.disabled=true;output.textContent=msg;stageStatus.textContent='계좌 재조회 후 6단계 수량을 다시 검증해야 합니다.'}
document.addEventListener('btc:live-account-read',e=>{
 const p=e.detail?.positions;
 if(!Array.isArray(p))return;
 account={at:Date.now(),available:numeric(e.detail?.account?.availableBalance),
  positions:p.filter(x=>['BOTH','LONG','SHORT'].includes(x.positionSide)).map(x=>({
   side:x.positionSide,qty:numeric(x.positionAmt),leverage:numeric(x.leverage)}))};
 stage=null;apply.disabled=true;output.textContent='실제 계좌 확인됨. 방향·가격·비율을 입력하세요.';
});
document.addEventListener('btc:live-stage-sized',e=>{
 const d=e.detail;
 stage=d?.symbol==='BTCUSDT'&&Number.isFinite(d.margin)&&d.margin>0?{...d,at:Date.now()}:null;
 apply.disabled=!stage;
 stageStatus.textContent=stage?'피라미드 '+stage.stage+'단계 · '+fmt(stage.quantity)+' BTC / '+fmt(stage.margin,3)+' USDT 준비됨 (주문 아님)':'6단계 결과가 유효하지 않습니다.';
});
function findPosition(s){
 const hedge=account.positions.find(x=>x.side===s);
 if(hedge)return hedge;
 const both=account.positions.find(x=>x.side==='BOTH');
 if(!both)return null;
 return { ...both,wrongDirection:both.qty!==0&&(s==='LONG'?both.qty<0:both.qty>0) };
}
async function rules(){
 if(ruleCache&&Date.now()-ruleCache.at<300000)return ruleCache;
 const r=await fetch('https://fapi.binance.com/fapi/v1/exchangeInfo',{cache:'no-store',signal:AbortSignal.timeout(8000)});
 if(!r.ok)throw Error('거래소 거래 규칙 조회 실패');
 const data=await r.json(),sym=data.symbols?.find(v=>v.symbol==='BTCUSDT'&&v.status==='TRADING');
 const lot=sym?.filters?.find(v=>v.filterType==='LOT_SIZE');
 const priceFilter=sym?.filters?.find(v=>v.filterType==='PRICE_FILTER');
 const rules={at:Date.now(),step:numeric(lot?.stepSize),min:numeric(lot?.minQty),max:numeric(lot?.maxQty),tick:numeric(priceFilter?.tickSize)};
 if(!(rules.step>0&&rules.min>0&&rules.tick>0))throw Error('가격·수량 필터가 불분명합니다');
 ruleCache=rules;return rules;
}
calculate.onclick=async()=>{
 if(!isFresh(account)){output.textContent='실제 계좌를 최근 60초 이내에 다시 조회하세요.';return}
 const initial=epoch;
 calculate.disabled=true;
 try{
  const s=side.value,kind=action.value,p=numeric(price.value),pos=findPosition(s);
  if(!pos||!(pos.leverage>=1&&pos.leverage<=125))throw Error('실제 포지션 모드·레버리지 확인 실패');
  if(!(p>0))throw Error('BTC 계산 가격을 입력하세요');
  const f=await rules();
  if(initial!==epoch||!isFresh(account))throw Error('계좌 조회가 변경됐습니다. 다시 계산하세요');
  if(Math.abs(p/f.tick-Math.round(p/f.tick))>1e-7)throw Error('가격이 거래소 호가 단위와 맞지 않습니다');
  let qty,orderSide,remark;
  if(kind==='ADD'){
   const m=numeric(margin.value);
   if(pos.wrongDirection)throw Error('단방향 모드에서 반대 포지션 보유 중 · 추가 진입 차단');
   if(!(m>0&&m<=account.available))throw Error('추가 진입 증거금이 가용 잔고를 초과합니다');
   qty=safeStep(m*pos.leverage/p,f.step);
   orderSide=s==='LONG'?'BUY':'SELL';
   remark='추가 진입 후 실제 평균 진입가·전체 손절 수량은 다시 계산해야 합니다.';
  }else{
   const pct=numeric(percent.value),held=Math.abs(pos.qty);
   if(pos.wrongDirection||!(held>0))throw Error('청산할 해당 방향의 실제 포지션이 없습니다');
   if(!(pct>0&&pct<=100))throw Error('청산 비율은 0 초과 100% 이하만 허용');
   qty=safeStep(held*pct/100,f.step);
   if(pct===100)qty=safeStep(held,f.step);
   if(!(qty>0&&qty<=held+1e-10))throw Error('청산 수량 계산 오류');
   const remain=held-qty;
   if(remain>1e-10&&remain<f.min-1e-10)
    throw Error('부분 청산 후 최소 거래 수량 미만 잔여 포지션. 비율을 수정하세요');
   orderSide=s==='LONG'?'SELL':'BUY';
   remark='청산 전 거래소 포지션을 다시 확인해야 합니다. One-way 모드 청산에는 reduceOnly 설정이 필요합니다.';
  }
  if(!(qty>=f.min))
   throw Error('거래소 최소 주문 수량 미달. 실제 포지션 전량 종료가 필요한 소량 포지션은 바이낸스 앱에서 직접 확인하세요');
  if(Number.isFinite(f.max)&&f.max>0&&qty>f.max)throw Error('거래소 최대 수량 초과');
  output.textContent=(kind==='ADD'?'추가 진입':'부분 청산')+' 계산만 완료 · 실제 주문 0건\n'+
   '포지션 '+s+' · 거래소 positionSide '+pos.side+'\n'+
   '주문 방향 '+orderSide+' · 수량 '+fmt(qty)+' BTC\n'+
   '기준가 '+fmt(p,2)+' USDT · 명목가 '+fmt(qty*p,2)+' USDT\n'+
   '실제 레버리지 '+pos.leverage+'배'+
   (kind==='REDUCE'?'\n현재 포지션 '+fmt(Math.abs(pos.qty))+' BTC · 청산 후 예상 '+fmt(Math.max(0,Math.abs(pos.qty)-qty))+' BTC':'')+
   '\n'+remark;
 }catch(err){output.textContent='계산 실패: '+String(err.message||err)}
 finally{calculate.disabled=false}
};
apply.onclick=()=>{
 if(!stage||!isFresh(account)||Date.now()-stage.at>60000){apply.disabled=true;stageStatus.textContent='단계 계산값이 만료됨 · 다시 계산하세요';return}
 if(stage.margin>20){stageStatus.textContent='현재 수동 주문 미리보기의 증거금 상한 20 USDT 초과 · 단계 예산을 줄여 주세요';return}
 const draftSide=document.getElementById('draftSide'),draftPrice=document.getElementById('draftPrice'),draftMargin=document.getElementById('draftMargin');
 if(!draftSide||!draftPrice||!draftMargin){stageStatus.textContent='수동 주문 입력창을 찾지 못했습니다';return}
 draftSide.value=stage.side;draftPrice.value=String(stage.price);draftMargin.value=String(Number(stage.margin.toFixed(4)));
 const result=document.getElementById('draftResult');
 if(result)result.textContent='6단계 '+stage.stage+'단계 계산값 입력됨 · 반드시 「수량 · 손절 미리보기」를 다시 눌러 거래소 규칙 확인 후 진행하세요. 실제 주문은 전송되지 않았습니다.';
 stageStatus.textContent='수동 주문칸에 입력 완료. 반드시 수량·손절 미리보기 버튼을 눌러 재검증하세요.';
};
document.addEventListener('btc:live-lock',()=>reset('API 잠금 · 계좌 재조회 필요'));
document.addEventListener('visibilitychange',()=>{if(document.hidden)reset('앱 비활성화 · 계좌 재조회 필요')});
})();