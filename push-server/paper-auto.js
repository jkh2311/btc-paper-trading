'use strict';
// Server-side PAPER simulation only. No exchange authentication or order methods.
// The caller supplies completed Binance BTCUSDT USD-M futures candles.
const MODES=new Set(['follow','strategy']);
const STRATEGIES=new Set(['range','bear','bull']);
const START_BALANCE=1000,MAX_LOG=80,FEE=0.0005;
function finite(v){return typeof v==='number'&&Number.isFinite(v)}
function defaults(){
 return {enabled:false,mode:'follow',strategy:'range',notional:100,stopPct:1,takePct:2,
  balance:START_BALANCE,realized:0,fees:0,wins:0,losses:0,
  lastBar:0,lastPrice:null,lastSignal:null,position:null,log:[],updatedAt:Date.now()};
}
function hydrate(value){
 const x=defaults();
 if(!value||typeof value!=='object')return x;
 x.enabled=value.enabled===true;
 x.mode=MODES.has(value.mode)?value.mode:'follow';
 x.strategy=STRATEGIES.has(value.strategy)?value.strategy:'range';
 x.notional=[25,50,100,200,500].includes(value.notional)?value.notional:100;
 x.stopPct=[0.5,1,2].includes(value.stopPct)?value.stopPct:1;
 x.takePct=[1,2,3,4].includes(value.takePct)?value.takePct:2;
 for(const k of ['balance','realized','fees','wins','losses','lastBar','lastPrice','updatedAt'])
  if(finite(value[k]))x[k]=value[k];
 if(value.position&&typeof value.position==='object'&&
   ['LONG','SHORT'].includes(value.position.side)&&finite(value.position.entry)&&
   value.position.entry>0&&finite(value.position.qty)&&value.position.qty>0&&
   finite(value.position.barTime))x.position={...value.position};
 if(value.lastSignal&&typeof value.lastSignal==='object')x.lastSignal=value.lastSignal;
 if(Array.isArray(value.log))x.log=value.log.slice(-MAX_LOG).filter(z=>z&&typeof z==='object');
 return x;
}
function entrySignal(side,price,barTime){
 return {side,price,barTime,at:Date.now()};
}
function log(s,event){
 s.log.push({at:Date.now(),...event});
 if(s.log.length>MAX_LOG)s.log=s.log.slice(-MAX_LOG);
}
function closePosition(s,price,barTime,reason){
 const p=s.position;
 if(!p||!finite(price)||price<=0)return;
 const gross=(p.side==='LONG'?price-p.entry:p.entry-price)*p.qty;
 const exitFee=price*p.qty*FEE;
 const pnl=gross-exitFee;
 s.balance+=p.notional+pnl;
 s.realized+=pnl;
 s.fees+=exitFee;
 if(gross-p.entryFee-exitFee>=0)s.wins++;else s.losses++;
 log(s,{type:'CLOSE',side:p.side,barTime,price,qty:p.qty,
  pnl:pnl-p.entryFee,reason});
 s.position=null;
}
function onClosedBar(input,bar,side,strategy){
 const s=hydrate(input),t=Number(bar?.t),price=Number(bar?.c);
 if(!s.enabled||!finite(t)||!finite(price)||price<=0||!finite(bar?.h)||!finite(bar?.l)||
    bar.h<bar.l||bar.h<=0||bar.l<=0)return s;
 if(s.lastBar&&t<=s.lastBar)return s;
 // A paused monitor or a gap must never backfill orders from old signals.
 const contiguous=s.lastBar&&t-s.lastBar===60000;
 s.lastBar=t;s.lastPrice=price;s.updatedAt=Date.now();
 if(!contiguous)return s;
 if(s.position){
  const p=s.position,stop=p.side==='LONG'?p.entry*(1-s.stopPct/100):
    p.entry*(1+s.stopPct/100),take=p.side==='LONG'?p.entry*(1+s.takePct/100):
    p.entry*(1-s.takePct/100);
  const stopHit=p.side==='LONG'?bar.l<=stop:bar.h>=stop;
  const takeHit=p.side==='LONG'?bar.h>=take:bar.l<=take;
  // Conservative same-candle assumption: stop wins if both were touched.
  if(stopHit||takeHit){
   closePosition(s,stopHit?stop:take,t,stopHit?'STOP':'TAKE');
   return s;
  }
 }
 if(side!=='LONG'&&side!=='SHORT')return s;
 s.lastSignal={...entrySignal(side,price,t),strategy};
 if(s.position){
  if(s.position.side!==side)closePosition(s,price,t,'OPPOSITE_SIGNAL');
  return s; // No same-bar reversal after a close.
 }
 const notional=Math.min(s.notional,s.balance);
 if(notional<10)return s;
 const qty=notional/price,entryFee=notional*FEE;
 s.balance-=notional+entryFee;s.realized-=entryFee;s.fees+=entryFee;
 s.position={side,entry:price,qty,notional,entryFee,barTime:t};
 log(s,{type:'OPEN',side,barTime:t,price,qty,notional,strategy});
 return s;
}
function configure(input,config,lastObservedBar=0){
 const s=hydrate(input);
 const enabled=config?.enabled===true;
 const mode=MODES.has(config?.mode)?config.mode:null;
 const strategy=STRATEGIES.has(config?.strategy)?config.strategy:null;
 const notional=Number(config?.notional),stopPct=Number(config?.stopPct),
  takePct=Number(config?.takePct);
 if(!mode||!strategy||![25,50,100,200,500].includes(notional)||
  ![0.5,1,2].includes(stopPct)||![1,2,3,4].includes(takePct))
  throw Error('모의매매 설정 형식 오류');
 if(s.position&&(s.notional!==notional||s.stopPct!==stopPct||
    s.takePct!==takePct||s.mode!==mode||s.strategy!==strategy))
  throw Error('모의 포지션 보유 중에는 전략·주문조건 변경 불가. 먼저 OFF 후 신호 종료를 기다려 주세요.');
 const settingsChanged=s.enabled!==enabled||s.mode!==mode||s.strategy!==strategy;
 Object.assign(s,{enabled,mode,strategy,notional,stopPct,takePct,updatedAt:Date.now()});
 if(settingsChanged)s.lastBar=Math.max(Number(lastObservedBar)||0,s.lastBar);
 return s;
}
function snapshot(input){
 const s=hydrate(input),p=s.position;
 const unrealized=p&&finite(s.lastPrice)?
  (p.side==='LONG'?s.lastPrice-p.entry:p.entry-s.lastPrice)*p.qty:0;
 return {...s,unrealized,equity:s.balance+(p?p.notional+unrealized:0)};
}
module.exports={defaults,hydrate,configure,onClosedBar,snapshot};
