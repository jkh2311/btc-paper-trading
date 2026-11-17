'use strict';
// Read-only Binance USD-M Futures connectivity diagnostic.
// Does not forward price data, use credentials, place orders, or bypass restrictions.
const http=require('node:http');
const PORT=Number(process.env.PORT||10000);
let last={checkedAt:null,ok:false,httpStatus:null,error:'not checked',feed:'Binance BTCUSDT USD-M futures',region:process.env.RENDER_REGION||'unknown'};
let checking=false;
async function check(){
 if(checking)return;
 checking=true;
 try{
  const response=await fetch('https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=1m&limit=3',{
   signal:AbortSignal.timeout(8000),headers:{'accept':'application/json'}});
  let valid=false;
  if(response.ok){
   const data=await response.json();
   valid=Array.isArray(data)&&data.length===3&&data.every(x=>Array.isArray(x)&&
    Number.isFinite(Number(x[0]))&&Number(x[4])>0);
  }
  last={...last,checkedAt:new Date().toISOString(),ok:valid,httpStatus:response.status,
   error:valid?null:response.status===451?'Binance geographical/legal restriction (451)':
    'Binance response rejected or malformed'};
 }catch(e){
  last={...last,checkedAt:new Date().toISOString(),ok:false,httpStatus:null,
   error:e?.name==='TimeoutError'?'Binance request timeout':'Binance connection error'};
 }finally{checking=false}
}
const server=http.createServer((req,res)=>{
 const url=new URL(req.url,'http://localhost');
 res.setHeader('content-type','application/json; charset=utf-8');
 res.setHeader('cache-control','no-store');
 if(req.method!=='GET'||url.pathname!=='/health'){res.writeHead(404);res.end('{"error":"not found"}');return}
 res.writeHead(200);res.end(JSON.stringify({...last,service:'read-only-geography-diagnostic',
  liveTradingEnabled:false,proxyEnabled:false}));
});
server.listen(PORT,'0.0.0.0',()=>{console.log('Binance read-only market probe listening');void check()});
setInterval(check,60000);
