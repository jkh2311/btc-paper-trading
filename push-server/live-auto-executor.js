'use strict';
// Live BTCUSDT USD-M executor. Never enabled by push registration or a PWA
// update. Requires separate credentials, persistent Postgres event claims,
// and an explicit Render environment opt-in. NO API secrets in GitHub/client.
const crypto=require('node:crypto');
const SYM='BTCUSDT',BASE='https://fapi.binance.com';
const MODES=['follow','strategy'],STRATEGIES=['range','bear','bull'];
function settings(env=process.env){
 const mode=MODES.includes(env.LIVE_AUTO_MODE)?env.LIVE_AUTO_MODE:'follow';
 const strategy=STRATEGIES.includes(env.LIVE_AUTO_STRATEGY)?env.LIVE_AUTO_STRATEGY:'range';
 const notional=Number(env.LIVE_AUTO_NOTIONAL_USDT);
 const stopPct=Number(env.LIVE_AUTO_STOP_PCT),takePct=Number(env.LIVE_AUTO_TAKE_PCT);
 const credentialsPresent=!!(env.BINANCE_FUTURES_TRADE_KEY&&env.BINANCE_FUTURES_TRADE_SECRET);
 const durableStatePresent=!!env.LIVE_TRADING_DATABASE_URL;
 const consent=env.LIVE_AUTO_ENABLED==='true'&&
  env.LIVE_AUTO_CONFIRM==='ENABLE_REAL_BTCUSDT_ORDERS';
 const riskValid=Number.isFinite(notional)&&notional>=25&&notional<=200&&
  Number.isFinite(stopPct)&&stopPct>=0.5&&stopPct<=2&&
  Number.isFinite(takePct)&&takePct>=0.5&&takePct<=4;
 const errors=[];
 if(!consent)errors.push('실전거래 서버 관리자 승인 OFF');
 if(!credentialsPresent)errors.push('별도 선물 거래 API 인증 없음');
 if(!durableStatePresent)errors.push('영구 주문 기록 DB 없음');
 if(!riskValid)errors.push('주문금액/손절/익절 안전 범위 미설정');
 return {mode,strategy,notional,stopPct,takePct,credentialsPresent,
  durableStatePresent,consent,riskValid,errors};
}
function client(env=process.env,fetchFn=fetch){
 if(!env.BINANCE_FUTURES_TRADE_KEY||!env.BINANCE_FUTURES_TRADE_SECRET)
  throw Error('SERVER_TRADE_CREDENTIALS_MISSING');
 async function call(method,route,params={},signed=true){
  const args=new URLSearchParams({...params});
  if(signed){args.set('recvWindow','5000');args.set('timestamp',String(Date.now()))}
  const query=args.toString();
  const signature=signed?'&signature='+crypto.createHmac('sha256',
    env.BINANCE_FUTURES_TRADE_SECRET).update(query).digest('hex'):'';
  const url=BASE+route+'?'+query+signature;
  const response=await fetchFn(url,{method,headers:{'X-MBX-APIKEY':env.BINANCE_FUTURES_TRADE_KEY},
   cache:'no-store',signal:AbortSignal.timeout(9000)});
  const body=await response.json().catch(()=>null);
  if(!response.ok){const e=Error('BINANCE_HTTP_'+response.status+'_CODE_'+(body?.code??'unknown'));
   e.status=response.status;throw e;}
  return body;
 }
 return {call};
}
function quantity(price,notional,info){
 const symbol=info?.symbols?.find(s=>s.symbol===SYM);
 const lot=symbol?.filters?.find(f=>f.filterType==='MARKET_LOT_SIZE')||
   symbol?.filters?.find(f=>f.filterType==='LOT_SIZE');
 if(!lot)throw Error('LOT_SIZE_MISSING');
 const step=Number(lot.stepSize),minimum=Number(lot.minQty),
   maximum=Number(lot.maxQty),raw=notional/price;
 if(!(step>0&&minimum>0&&maximum>0))throw Error('INVALID_LOT_SIZE');
 const decimals=Math.min(8,(String(lot.stepSize).split('.')[1]||'').replace(/0+$/,'').length);
 const amount=Math.floor((raw+step*1e-9)/step)*step;
 if(amount<minimum||amount>maximum||amount*price<5)
  throw Error('ORDER_BELOW_EXCHANGE_MINIMUM');
 return amount.toFixed(decimals);
}
function priceString(n,tick){
 const x=Number(tick),v=Number(n);
 if(!(x>0&&v>0))throw Error('INVALID_PRICE_FILTER');
 const places=Math.min(8,(String(tick).split('.')[1]||'').replace(/0+$/,'').length);
 return (Math.round(v/x)*x).toFixed(places);
}
function eventId(mode,strategy,side,barTime){
 if(!['LONG','SHORT'].includes(side)||!Number.isSafeInteger(barTime))
  throw Error('INVALID_SIGNAL');
 return crypto.createHash('sha256')
  .update(SYM+':1m:'+mode+':'+strategy+':'+side+':'+barTime)
  .digest('hex').slice(0,28);
}
async function openStore(env=process.env){
 if(!env.LIVE_TRADING_DATABASE_URL)throw Error('PERSISTENT_DATABASE_REQUIRED');
 const {Pool}=require('pg');
 const pool=new Pool({connectionString:env.LIVE_TRADING_DATABASE_URL,max:2,
  ssl:env.LIVE_TRADING_DATABASE_SSL==='true'?{rejectUnauthorized:true}:undefined});
 await pool.query("CREATE TABLE IF NOT EXISTS hanine_live_auto_events (id TEXT PRIMARY KEY, phase TEXT NOT NULL, details JSONB NOT NULL DEFAULT '{}'::jsonb, at TIMESTAMPTZ NOT NULL DEFAULT now())");
 return {
  async claim(id){
   const r=await pool.query("INSERT INTO hanine_live_auto_events(id,phase) VALUES($1,'CLAIMED') ON CONFLICT DO NOTHING RETURNING id",[id]);
   return r.rowCount===1;
  },
  async stage(id,phase,details={}){
   await pool.query("UPDATE hanine_live_auto_events SET phase=$2,details=details||$3::jsonb WHERE id=$1",
    [id,phase,JSON.stringify(details)]);
  },
  async recentCount(){
   const r=await pool.query("SELECT count(*)::int AS n FROM hanine_live_auto_events WHERE at>now()-interval '1 day' AND phase<>'SKIPPED'");
   return Number(r.rows[0].n);
  },
  async close(){await pool.end()}
 };
}
// This function is called only after market-data freshness and an explicit
// server admin opt-in. It never reverses or changes existing user positions.
async function executeSignal({side,barTime,markPrice,mode,strategy,environment=process.env,
 exchange,store}){
 const cfg=settings(environment);
 if(cfg.errors.length)throw Error('LIVE_BLOCKED:'+cfg.errors.join(';'));
 if(!exchange||!store||!['LONG','SHORT'].includes(side)||
  !Number.isFinite(markPrice)||markPrice<=0||!Number.isSafeInteger(barTime))
  throw Error('INVALID_EXECUTION_INPUT');
 if(Date.now()-barTime-60000>30000||barTime+60000>Date.now())
  throw Error('STALE_OR_UNCLOSED_SIGNAL');
 const id=eventId(mode,strategy,side,barTime);
 // This is a persistent "claim before external effects". Never retry
 // unknown outcomes automatically, including after a server restart.
 if(!await store.claim(id))return {status:'DUPLICATE_IGNORED',id};
 const stage=(phase,details)=>store.stage(id,phase,details);
 let confirmedEntry=null,stopAlgoId=null,takeAlgoId=null;
 try{
  if(await store.recentCount()>6)throw Error('DAILY_SIGNAL_LIMIT');
  const api=exchange.call;
  const [positionMode,positions,normalOrders,algos,info]=await Promise.all([
   api('GET','/fapi/v1/positionSide/dual'),
   api('GET','/fapi/v3/positionRisk',{symbol:SYM}),
   api('GET','/fapi/v1/openOrders',{symbol:SYM}),
   api('GET','/fapi/v1/openAlgoOrders',{symbol:SYM}),
   api('GET','/fapi/v1/exchangeInfo',{},false)
  ]);
  if(positionMode?.dualSidePosition!==false)throw Error('ONE_WAY_MODE_ONLY');
  if(!Array.isArray(positions)||positions.some(p=>Number(p.positionAmt)!==0))
   throw Error('EXISTING_POSITION_DO_NOT_TOUCH');
  if(!Array.isArray(normalOrders)||normalOrders.length||
   !Array.isArray(algos)||algos.length)throw Error('EXISTING_ORDERS_DO_NOT_TOUCH');
  const lot=quantity(markPrice,cfg.notional,info);
  const tick=info.symbols.find(s=>s.symbol===SYM)?.filters?.find(f=>f.filterType==='PRICE_FILTER')?.tickSize;
  if(!tick)throw Error('TICK_SIZE_MISSING');
  const buy=side==='LONG',entrySide=buy?'BUY':'SELL',
    exitSide=buy?'SELL':'BUY',clientId='hnla'+id.slice(0,25);
  await stage('ENTRY_PENDING',{side,barTime,clientId});
  // If this POST times out, do not repeat it. Query by client ID manually.
  const placed=await api('POST','/fapi/v1/order',{
    symbol:SYM,side:entrySide,positionSide:'BOTH',type:'MARKET',
    quantity:lot,newClientOrderId:clientId,newOrderRespType:'RESULT'
  });
  if(placed?.status!=='FILLED')throw Error('ENTRY_NOT_CONFIRMED_CHECK_CLIENT_ORDER_ID');
  const entry=Number(placed.avgPrice);
  if(!(entry>0))throw Error('INVALID_FILL_PRICE');
  confirmedEntry={side,barTime,clientId,entry,qty:lot};
  await stage('ENTRY_FILLED',confirmedEntry);
  const sl=priceString(buy?entry*(1-cfg.stopPct/100):entry*(1+cfg.stopPct/100),tick);
  const tp=priceString(buy?entry*(1+cfg.takePct/100):entry*(1-cfg.takePct/100),tick);
  const protectBase={algoType:'CONDITIONAL',symbol:SYM,side:exitSide,
    positionSide:'BOTH',closePosition:'true',workingType:'MARK_PRICE'};
  // STOP and TP are exchange-resident, not browser-side stops.
  const stopped=await api('POST','/fapi/v1/algoOrder',{
   ...protectBase,type:'STOP_MARKET',triggerPrice:sl,clientAlgoId:'hns'+id.slice(0,28)
  });
  if(!stopped?.algoId)throw Error('STOP_ORDER_UNCONFIRMED');
  stopAlgoId=stopped.algoId;
  await stage('STOP_SET',{side,barTime,clientId,entry,qty:lot,stopAlgoId});
  const target=await api('POST','/fapi/v1/algoOrder',{
   ...protectBase,type:'TAKE_PROFIT_MARKET',triggerPrice:tp,clientAlgoId:'hnt'+id.slice(0,28)
  });
  if(!target?.algoId)throw Error('TAKE_PROFIT_UNCONFIRMED');
  takeAlgoId=target.algoId;
  await stage('PROTECTED',{side,barTime,clientId,entry,qty:lot,
   stopAlgoId:stopped.algoId,takeAlgoId:target.algoId});
  return {status:'PROTECTED',id,side,qty:lot,entry,stop:sl,take:tp};
 }catch(error){
  // An exchange-confirmed entry without completed stop/take protection must
  // be flattened rather than left knowingly unprotected. A failed/unknown
  // entry response is NEVER retried: the fill outcome may be unknown.
  let emergency='NOT_ATTEMPTED';
  if(confirmedEntry){
   try{
    const open=await exchange.call('GET','/fapi/v3/positionRisk',{symbol:SYM});
    const active=Array.isArray(open)?open.filter(p=>Math.abs(Number(p.positionAmt))>0):[];
    if(active.length>1)throw Error('MULTIPLE_POSITIONS_MANUAL_REVIEW');
    if(active.length===1){
     const p=active[0],amount=Number(p.positionAmt);
     if(!(amount*(side==='LONG'?1:-1)>0))throw Error('POSITION_SIDE_MISMATCH');
     const emergencyId='hne'+id.slice(0,28);
     await stage('EMERGENCY_CLOSE_PENDING',{emergencyId});
     const closed=await exchange.call('POST','/fapi/v1/order',{
      symbol:SYM,side:side==='LONG'?'SELL':'BUY',positionSide:'BOTH',
      type:'MARKET',reduceOnly:'true',quantity:String(Math.abs(amount)),
      newOrderRespType:'RESULT',newClientOrderId:emergencyId
     });
     if(closed?.status!=='FILLED')throw Error('EMERGENCY_CLOSE_NOT_CONFIRMED');
    }
    emergency='FLAT_CONFIRMED_OR_NO_OPEN_POSITION';
    // Cleanup must handle BOTH protection orders, including an exchange-
    // accepted take-profit order followed by failed database stage update.
    for(const [name,algoId] of [['STOP',stopAlgoId],['TAKE',takeAlgoId]]){
     if(!algoId)continue;
     try{await exchange.call('DELETE','/fapi/v1/algoOrder',{symbol:SYM,algoId:String(algoId)})}
     catch(e){emergency='FLAT_WITH_POSSIBLE_STALE_'+name+'_ALGO'}
    }
   }catch(e){emergency='EMERGENCY_REVIEW_REQUIRED_'+String(e.message||e).slice(0,100)}
  }
  try{await stage('REVIEW_REQUIRED',{error:String(error.message||error).slice(0,160),emergency})}
  catch(e){console.error('LIVE AUTO DURABLE REVIEW LOG FAILURE',e?.message)}
  throw error;
 }
}
module.exports={settings,client,quantity,eventId,openStore,executeSignal};
