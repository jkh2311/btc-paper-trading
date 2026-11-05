/* Direct Binance futures read-only account panel.
 * Uses the existing AES-GCM/PBKDF2 encrypted local PWA vault.
 * No Cloudflare Worker, no API key persistence outside the existing vault.
 * Trade execution is intentionally disabled until protections are verified.
 */
(()=>{
'use strict';
const accountPage=document.getElementById('page-position');
const historyPage=document.getElementById('page-history');
if(!accountPage||!historyPage)return;
const css=document.createElement('style');
css.textContent='.direct-live{background:#102139;color:#eaf2ff;border:1px solid #4d6685;border-radius:14px;padding:13px;margin:10px 0}.direct-live h2{font-size:17px;margin:0 0 9px}.direct-live p{font-size:12px;color:#b5c9e2;line-height:1.65}.direct-live button{font-size:12px;padding:9px;margin:4px 0}.direct-live .row2{display:grid;grid-template-columns:1fr 1fr;gap:7px}.direct-live .metric,.direct-live .item{background:#0c1b2e;border-radius:9px;padding:10px;margin:4px 0;overflow-wrap:anywhere}.direct-live small{display:block;color:#abc0d7;margin-bottom:5px}.direct-live input{width:100%;box-sizing:border-box;padding:8px;background:#192e49;border:1px solid #5a718e;color:white}.direct-live .error{color:#ffa0aa}.direct-live .success{color:#57dcb2}';
document.head.append(css);
function make(tag,text){const el=document.createElement(tag);if(text!==undefined)el.textContent=String(text);return el}
function amount(n,d=3){if(n===null||n===undefined||n==='')return '—';const x=Number(n);return Number.isFinite(x)?x.toLocaleString('ko-KR',{maximumFractionDigits:d}):'—'}
function item(parent,head,body){const e=make('div');e.className='item';e.append(make('b',head),make('small',body));parent.append(e)}
const root=make('section');root.className='direct-live';
const title=make('h2','바이낸스 실제 선물계좌 · 직접 연결');
const intro=make('p','설정 > API 키 관리에서 한 번 암호화 저장하고, 앱 재실행 후 비밀번호로 잠금 해제하세요. 서버에 키를 보내지 않고 바이낸스 WebSocket으로 직접 조회합니다.');
const controls=make('div');const refresh=make('button','실제 계좌 조회');const lock=make('button','API 잠금');
controls.append(refresh,lock);
const status=make('p','API 키 잠금 상태 · 설정에서 잠금 해제 필요');
status.setAttribute('role','status');
const stats=make('div');stats.className='row2';
const positions=make('div'),orders=make('div');
root.append(title,intro,controls,status,stats,make('h2','실제 BTCUSDT 포지션'),positions,make('h2','실제 미체결 주문'),orders);
accountPage.prepend(root);
const history=make('section');history.className='direct-live';
history.append(make('h2','실제 체결 기록'),make('p','실제 체결내역은 아직 연결되지 않았습니다. 모의 기록을 실전 기록으로 표시하지 않습니다.'));
historyPage.prepend(history);
let busy=false,seq=0;
function reset(){
 stats.replaceChildren();positions.replaceChildren();orders.replaceChildren();
}
async function signedCall(method,fields,creds){
 const params={apiKey:creds.apiKey,recvWindow:5000,timestamp:Date.now(),...fields};
 const string=Object.keys(params).sort().map(k=>k+'='+encodeURIComponent(params[k])).join('&');
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(creds.apiSecret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const signature=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(string));
 params.signature=[...new Uint8Array(signature)].map(x=>x.toString(16).padStart(2,'0')).join('');
 // Existing browser-only authenticated WSS request helper.
 return directBinanceWS(method,params,status,11000);
}
function render(acc,positionList){
 if(!acc||typeof acc!=='object'||!Array.isArray(positionList))throw Error('바이낸스 응답 형식 오류');
 reset();
 const usdt=Array.isArray(acc.assets)?acc.assets.find(v=>v.asset==='USDT'):null;
 if(!usdt)throw Error('USDT 계좌 정보를 받지 못했습니다');
 for(const [label,value] of [
  ['실제 USDT 지갑 잔고',usdt.walletBalance],
  ['사용 가능 USDT',usdt.availableBalance],
  ['미실현 손익',usdt.unrealizedProfit],
  ['현재 증거금',acc.totalPositionInitialMargin]
 ]){
  const e=make('div');e.className='metric';e.append(make('small',label),make('b',amount(value)+' USDT'));stats.append(e);
 }
 const live=positionList.filter(p=>p.symbol==='BTCUSDT'&&Math.abs(Number(p.positionAmt))>0);
 if(!live.length)positions.append(make('p','현재 BTCUSDT 포지션 없음'));
 for(const p of live){
  const side=p.positionSide==='BOTH'?(Number(p.positionAmt)>0?'LONG':'SHORT'):p.positionSide;
  item(positions,side+' · '+amount(Math.abs(Number(p.positionAmt)),6)+' BTC',
   '진입 '+amount(p.entryPrice)+' / 레버리지 '+amount(p.leverage,0)+'배 / 미실현 '+amount(p.unRealizedProfit)+' USDT / 청산 '+amount(p.liquidationPrice));
 }
 orders.append(make('p','미체결 주문 자동 조회는 아직 미구현입니다. 앱이 실제 주문 목록을 확인하기 전에는 취소·정정할 수 없습니다. 바이낸스 앱에서 확인하세요.'));
 status.className='success';status.textContent='바이낸스 직접 조회 성공 · '+new Date().toLocaleTimeString('ko-KR')+' · 실거래 주문 잠금';
}
refresh.addEventListener('click',async()=>{
 if(busy)return;
 if(typeof getApiCredentials!=='function'){status.className='error';status.textContent='API 키 관리 기능을 찾을 수 없습니다';return}
 const creds=getApiCredentials();
 if(!creds?.apiKey||!creds?.apiSecret){
  status.className='error';status.textContent='설정의 API 키 관리에서 비밀번호로 잠금 해제해 주세요.';
  if(typeof switchTab==='function'){switchTab('settings');document.getElementById('myApiManage').open=true}
  return;
 }
 const id=++seq;busy=true;refresh.disabled=true;
 status.className='';status.textContent='바이낸스에 직접 연결 중…';
 try{
  const [acc,pos]=await Promise.all([
   signedCall('account.status',{},creds),
   signedCall('account.position',{symbol:'BTCUSDT'},creds)
  ]);
  if(id===seq)render(acc,pos);
 }catch(err){if(id===seq){reset();status.className='error';status.textContent='계좌 조회 실패 · '+(err?.message||'연결 오류')}}
 finally{busy=false;refresh.disabled=false}
});
lock.addEventListener('click',()=>{
 seq++;if(typeof unlockedApiCredentials!=='undefined')unlockedApiCredentials=null;
 for(const id of ['myBinanceKey','myBinanceSecret','myVaultPassword']){
  const el=document.getElementById(id);if(el)el.value='';
 }
 reset();status.className='';status.textContent='잠금 완료 · 저장된 암호화 API 키는 유지됨';
 if(typeof clearRealAccount==='function')clearRealAccount('API 키 잠금');
 if(typeof showVaultStatus==='function')showVaultStatus();
});
})();
