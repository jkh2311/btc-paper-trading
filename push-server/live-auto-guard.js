'use strict';
// Read-only health/status only. Never accepts credentials or triggers orders.
const executor=require('./live-auto-executor');
function readiness(options={}){
 const cfg=executor.settings(options.env||process.env),health=options.health||{};
 const marketFresh=!health.lastCheckError&&Number.isFinite(health.lastCheckTime)&&
  health.lastCheckTime>0&&Date.now()-health.lastCheckTime<90000;
 const blockers=[...cfg.errors];
 if(!marketFresh)blockers.push('바이낸스 BTCUSDT 선물 확정봉 수신 미확인');
 const armed=blockers.length===0;
 return {symbol:'BTCUSDT',venue:'BINANCE_USDM',mode:armed?'LIVE_ARMED':'LIVE_DISABLED',
  liveEnabled:armed,orderMethodsAvailable:true,
  tradingCredentialsPresent:cfg.credentialsPresent,durableStatePresent:cfg.durableStatePresent,
  strategyMode:cfg.mode,selectedStrategy:cfg.strategy,marketFresh,blockers,
  note:'SERVER_ARMed_STATUS_ONLY_DOES_NOT_VERIFY_ORDER_FILL_OR_DB_HEALTH'};
}
module.exports={readiness};
