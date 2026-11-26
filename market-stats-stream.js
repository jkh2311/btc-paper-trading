/* v343: public Binance USD-M funding and UTC-day quote volume via market WebSocket.
   No credentials, account access, order requests or shared trade signals. */
(()=>{
'use strict';
const root=window;
if(typeof WebSocket!=='function')return;
const endpoint='wss://fstream.binance.com/market/stream?streams=btcusdt@markPrice@1s/btcusdt@kline_1d';
let socket=null,retry=null,attempt=0,closed=false,lastFunding=0,lastVolume=0;
const FRESH_MS=90000;
function freshFunding(){return Date.now()-lastFunding<FRESH_MS}
function freshVolume(){return Date.now()-lastVolume<FRESH_MS}
root.btcMarketStatsStream={freshFunding,freshVolume};
function connect(){
 if(document.hidden||closed)return;
 clearTimeout(retry);
 try{
  socket=new WebSocket(endpoint);
  socket.onopen=()=>{attempt=0;};
  socket.onmessage=e=>{
   let message;
   try{message=JSON.parse(e.data)}catch(_){return}
   const data=message?.data||message;
   if(data?.s!=='BTCUSDT')return;
   if(data.e==='markPriceUpdate'){
    const rate=Number(data.r),next=Number(data.T);
    if(Number.isFinite(rate)&&next>Date.now()-86400000){
     lastFunding=Date.now();root.btcUpdateFundingFromStream?.(rate,next);
    }
   }else if(data.e==='kline'&&data.k?.i==='1d'){
    const day=Math.floor(Date.now()/86400000)*86400000;
    const start=Number(data.k.t),q=Number(data.k.q);
    if(start===day&&Number.isFinite(q)&&q>=0){
     lastVolume=Date.now();root.btcUpdateDailyVolumeFromStream?.(q,start);
    }
   }
  };
  socket.onerror=()=>{}; // close handler schedules a bounded retry
  socket.onclose=()=>{
   socket=null;
   if(!closed&&!document.hidden){
    const wait=Math.min(120000,Math.max(10000,10000*2**Math.min(attempt++,4)));
    retry=setTimeout(connect,wait);
   }
  };
 }catch(_){
  retry=setTimeout(connect,Math.min(120000,10000*2**Math.min(attempt++,4)));
 }
}
document.addEventListener('visibilitychange',()=>{
 if(document.hidden){
  clearTimeout(retry);retry=null;
  if(socket){const s=socket;socket=null;s.onclose=null;try{s.close()}catch(_){}}
 }else if(!socket){attempt=0;connect()}
});
connect();
})();