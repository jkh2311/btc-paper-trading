'use strict';
// Production live-trading readiness guard. Fail closed by design.
// No live orders are sent or accepted by this module.
// The push registration secret is NOT trading authorization.
// The user's existing iPhone-encrypted API vault is never transmitted.
function readiness(options={}){
 const env=options.env||process.env;
 const health=options.health||{};
 const credentialsPresent=Boolean(env.BINANCE_FUTURES_TRADE_KEY&&env.BINANCE_FUTURES_TRADE_SECRET);
 const durableStatePresent=Boolean(env.LIVE_TRADING_DATABASE_URL);
 const marketFresh=health.lastCheckError==null&&Number.isFinite(health.lastCheckTime)&&
   health.lastCheckTime>0&&Date.now()-health.lastCheckTime<90000;
 const blockers=[];
 if(!credentialsPresent)blockers.push('실전 주문용 바이낸스 API 인증정보 미등록');
 if(!durableStatePresent)blockers.push('주문/체결/중복방지 기록용 영구 저장소 없음');
 if(!marketFresh)blockers.push('바이낸스 선물 시세 연결 정상 검증되지 않음');
 blockers.push('거래소 포지션 동기화·체결검증·손절 보호주문 자동실행 미검증');
 blockers.push('현재 무료 Render 서버로 24시간 자동매매 안정성 보장 불가');
 return {symbol:'BTCUSDT',venue:'BINANCE_USDM',mode:'LIVE_DISABLED',
  liveEnabled:false,orderMethodsAvailable:false,
  signalChoices:['existing-long-short','range','bear','bull'],
  credentialsPresent,durableStatePresent,marketFresh,blockers};
}
module.exports={readiness};
