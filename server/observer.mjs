// BTCUSDT USD-M futures 24/7 RMI signal observer. LIVE ORDERS: HARD DISABLED.
// Node.js 22+ only (native fetch and WebSocket). No trading credentials are used.
// The PWA chart uses RMI(5,14) confirmed-candle 85-up => SHORT, 15-touch/below => LONG.
// Node 22+ global WebSocket (no third-party dependencies).
import {createServer} from 'node:http';
import {mkdir,readFile,rename,writeFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {chartSignalFromClosedCandles} from './rmi-engine.mjs';

const SYMBOL='BTCUSDT',INTERVAL_MS=60000;
const REST='https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=1m&limit=500';
const WS='wss://fstream.binance.com/market/ws/btcusdt@kline_1m';
const statePath=resolve(process.env.RMI_STATE_PATH||'./server-data/rmi-state.json');
const port=Number(process.env.RMI_HEALTH_PORT||8787);
const upper=Number(process.env.RMI_UPPER||85),lower=Number(process.env.RMI_LOWER||15);
if(!(upper>=1&&upper<=100&&lower>=0&&lower<upper))throw Error('Invalid RMI threshold');
if(process.env.RMI_LIVE_TRADING==='true'||process.env.ENABLE_LIVE_ORDERS==='true')
 throw Error('Real trading is not implemented or permitted in this observer. No orders will be sent.');
let candles=[],seenBar=0,seenSignal=0,connected=false,lastEventAt=0,lastError='',signals=0;
let ws=null,retryTimer=null,watchdog=null,stopped=false;
function log(event,details={}){console.log(JSON.stringify({at:new Date().toISOString(),event,...details}));}
async function save(){
 await mkdir(dirname(statePath),{recursive:true});
 const tmp=statePath+'.tmp';
 await writeFile(tmp,JSON.stringify({seenBar,seenSignal,signals,at:Date.now()}),{mode:0o600});
 await rename(tmp,statePath);
}
async function load(){
 try{
  const state=JSON.parse(await readFile(statePath,'utf8'));
  if(Number.isFinite(state.seenBar))seenBar=state.seenBar;
  if(Number.isFinite(state.seenSignal))seenSignal=state.seenSignal;
  if(Number.isFinite(state.signals))signals=state.signals;
 }catch(e){if(e.code!=='ENOENT')throw e;}
}
function convert(row){
 const t=Number(row[0]),c=Number(row[4]),v=Number(row[5]);
 if(!Number.isFinite(t)||!(c>0)||!(v>=0))throw Error('Invalid Binance candle');
 return {t,c,v};
}
async function bootstrap(){
 const response=await fetch(REST,{cache:'no-store',signal:AbortSignal.timeout(12000)});
 if(!response.ok)throw Error('Binance REST '+response.status);
 const rows=await response.json();
 if(!Array.isArray(rows)||rows.length<40)throw Error('Insufficient 1m candle history');
 const now=Date.now();
 candles=rows.map(convert).filter(b=>b.t+INTERVAL_MS<=now&&b.v>0).slice(-500);
 if(candles.length<23)throw Error('Insufficient confirmed 1m candles');
 // All historical bars are for calculation only. Never emit signals on server start/reconnect.
 seenBar=Math.max(seenBar,candles.at(-1).t);
 await save();
 log('historical_warmup',{bars:candles.length,lastBar:seenBar,liveOrders:false});
}
async function accept(k){
 if(!k||k.i!=='1m'||k.s!==SYMBOL||k.x!==true)return;
 const t=Number(k.t),c=Number(k.c),v=Number(k.v);
 if(!Number.isFinite(t)||!(c>0)||!(v>0)||t<=seenBar)return;
 if(t+INTERVAL_MS>Date.now()+3000||Date.now()-(t+INTERVAL_MS)>15000){
  lastError='Old or future candle rejected; resync required';
  connected=false;ws?.close();return;
 }
 if(!candles.length||t-candles.at(-1).t!==INTERVAL_MS){
  lastError='Missing 1m candle(s); resync required';
  connected=false;ws?.close();return;
 }
 candles.push({t,c,v});candles=candles.slice(-500);
 const signal=chartSignalFromClosedCandles(candles,{upper,lower});
 seenBar=t;
 // Persist the watermark before emitting so restart cannot re-fire this bar.
 const newSignal=!!signal&&t>seenSignal;
 if(newSignal){seenSignal=t;signals++;}
 await save();
 if(newSignal)log('rmi_chart_signal',{...signal,liveOrders:false});
}
function connect(){
 if(stopped)return;
 const socket=new WebSocket(WS);ws=socket;
 let queue=Promise.resolve();
 socket.addEventListener('open',()=>{connected=true;lastError='';lastEventAt=Date.now();log('stream_connected',{symbol:SYMBOL,liveOrders:false});});
 socket.addEventListener('message',event=>{
  lastEventAt=Date.now();
  queue=queue.then(async()=>{
   const msg=JSON.parse(String(event.data));
   if(msg.e==='kline')await accept(msg.k);
  }).catch(error=>{lastError=String(error?.message||error);log('stream_error',{message:lastError});socket.close();});
 });
 socket.addEventListener('error',()=>{lastError='WebSocket error';});
 socket.addEventListener('close',()=>{
  if(ws!==socket)return;
  connected=false;log('stream_disconnected',{message:lastError});
  clearTimeout(retryTimer);
  if(!stopped)retryTimer=setTimeout(()=>{void restart();},3000);
 });
}
let restarting=false;
async function restart(){
 if(stopped||restarting)return;
 restarting=true;
 try{
  await bootstrap();
  if(!stopped)connect();
 }catch(error){
  lastError=String(error?.message||error);
  log('reconnect_error',{message:lastError});
  retryTimer=setTimeout(()=>{void restart();},5000);
 }finally{restarting=false;}
}
const health=createServer((req,res)=>{
 if(req.url!=='/health'||req.method!=='GET'){res.writeHead(404);res.end();return;}
 const ok=connected&&Date.now()-lastEventAt<20000;
 const body=JSON.stringify({mode:'SIGNAL_OBSERVER',liveOrders:false,ok,connected,
  lastEventAt,seenBar,seenSignal,signals,upper,lower,lastError});
 res.writeHead(ok?200:503,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
 res.end(body);
});
health.listen(port,'127.0.0.1',()=>log('health_listening',{host:'127.0.0.1',port}));
watchdog=setInterval(()=>{
 if(connected&&Date.now()-lastEventAt>20000){
  lastError='WebSocket stale; force reconnect';connected=false;ws?.close();
 }
},5000);
async function stop(){
 if(stopped)return;stopped=true;clearTimeout(retryTimer);clearInterval(watchdog);
 ws?.close();health.close();log('observer_stopped');
}
process.on('SIGTERM',()=>void stop());
process.on('SIGINT',()=>void stop());
await load();
await restart();
