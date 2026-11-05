/* Real BTCUSDT USD-M read-only dashboard; no order or key storage. */
(() => {
'use strict';
const accountPage=document.getElementById('page-position');
const historyPage=document.getElementById('page-history');
if(!accountPage||!historyPage)return;
const styles=document.createElement('style');styles.textContent='.live-dash{background:#11243b;color:#eaf1ff;border:1px solid #4a6382;border-radius:13px;padding:13px;margin:10px 0}.live-dash h2{font-size:17px;margin:0 0 8px}.live-dash .note{font-size:12px;color:#aec5df;line-height:1.5}.live-dash input{width:100%;box-sizing:border-box;padding:10px;margin:5px 0;background:#182c44;color:#fff;border:1px solid #526d8c;border-radius:8px}.live-dash button{padding:8px 12px;margin:4px}.live-dash .stats{display:grid;grid-template-columns:1fr 1fr;gap:6px}.live-dash .stat,.live-dash .line{background:#0c1b2e;border-radius:8px;padding:9px;margin:4px 0;overflow-wrap:anywhere}.live-dash small{display:block;color:#9eb6ce}.live-dash .error{color:#ff9bab;white-space:pre-wrap}';document.head.append(styles);
const elt=(tag,value)=>{const e=document.createElement(tag);if(value!==undefined)e.textContent=String(value);return e};
const fmt=(v,n=3)=>Number.isFinite(Number(v))&&v!==null?v.toLocaleString?.('ko-KR',{maximumFractionDigits:n})??Number(v).toFixed(n):'—';
const root=elt('section');root.className='live-dash';
root.append(elt('h2','바이낸스 BTCUSDT 실전 계좌 · 조회 전용'),elt('p','실제 주문 및 AUTO는 잠겨 있습니다. APP_AUTH_TOKEN만 입력하고 Binance API Key/Secret은 입력하지 마세요.'));
const url=elt('input');url.placeholder='https://계정명.서브도메인.workers.dev';url.setAttribute('aria-label','Cloudflare Worker 주소');url.autocomplete='off';
const token=elt('input');token.type='password';token.placeholder='APP_AUTH_TOKEN (32자 이상)';token.autocomplete='off';token.setAttribute('aria-label','Worker 인증 토큰');
const refresh=elt('button','계좌 새로고침');refresh.type='button';const disconnect=elt('button','연결 해제');disconnect.type='button';
const status=elt('p','연결 전');status.className='note';status.setAttribute('role','status');
const stats=elt('div');stats.className='stats';const positions=elt('div'),orders=elt('div');
root.append(url,token,refresh,disconnect,status,stats,elt('h2','실제 포지션'),positions,elt('h2','실제 미체결'),orders);
accountPage.prepend(root);
const history=elt('section');history.className='live-dash';history.append(elt('h2','실제 체결 기록'));
const fills=elt('div','연결 후 최근 체결 내역 표시');history.append(fills);historyPage.prepend(history);
let bearer='',endpoint='',controller=null;
const appendLine=(parent,title,description)=>{const row=elt('div');row.className='line';row.append(elt('b',title),elt('small',description));parent.append(row)};
function clear(){stats.replaceChildren();positions.replaceChildren();orders.replaceChildren();fills.textContent='연결 후 최근 체결 내역 표시'}
function render(data){
 if(data?.source!=='BINANCE_USDM_FUTURES'||data?.mode!=='READ_ONLY'||data?.liveTradingEnabled!==false)throw Error('예상과 다른 서버 응답');
 clear();const acc=data.account||{};
 for(const [name,value] of [['실제 USDT 잔고',acc.walletBalance],['사용 가능 USDT',acc.availableBalance],['포지션 증거금',acc.totalPositionInitialMargin],['미체결 증거금',acc.totalOpenOrderInitialMargin]]){
 const cell=elt('div');cell.className='stat';cell.append(elt('small',name),elt('b',fmt(value)+' USDT'));stats.append(cell)}
 const active=(Array.isArray(data.positions)?data.positions:[]).filter(x=>Number(x.quantity)!==0);
 if(!active.length)positions.append(elt('p','현재 BTCUSDT 포지션 없음'));
 for(const p of active)appendLine(positions,p.side+' · '+fmt(p.quantity,6)+' BTC · '+fmt(p.leverage,0)+'배','진입 '+fmt(p.entryPrice)+' / 미실현손익 '+fmt(p.unrealizedPnl)+' USDT / 청산가 '+fmt(p.liquidationPrice));
 const open=Array.isArray(data.openOrders)?data.openOrders:[];
 if(!open.length)orders.append(elt('p','미체결 주문 없음'));
 for(const o of open)appendLine(orders,o.side+' '+o.positionSide+' · '+fmt(o.price)+' USDT','주문 '+o.id+' / 미체결 '+fmt(o.remainingQty,6)+' BTC / 취소는 바이낸스 앱에서');
 const recent=Array.isArray(data.recentFills)?data.recentFills:[];
 if(!recent.length)fills.append(elt('p','최근 체결 내역 없음'));
 else{fills.replaceChildren();for(const x of [...recent].reverse().slice(0,40))appendLine(fills,x.side+' '+fmt(x.price)+' USDT · '+fmt(x.quantity,6)+' BTC','실현손익 '+fmt(x.realizedPnl)+' USDT / 수수료 '+fmt(x.commission,5)+' '+(x.commissionAsset||''))}
 status.className='note';status.textContent='실제 계좌 조회 · '+new Date(data.asOf).toLocaleString('ko-KR')+' · '+(data.hedgeMode?'헤지 모드':'단방향 모드');
}
function validOrigin(value){try{const u=new URL(value);return u.protocol==='https:'&&/^[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev$/i.test(u.hostname)&&!u.username&&!u.password&&!u.search&&!u.hash&&(u.pathname==='/'||u.pathname==='')}catch{return false}}
refresh.addEventListener('click',async()=>{
 const u=url.value.trim(),entered=token.value.trim();
 if(!validOrigin(u)){status.className='error';status.textContent='Cloudflare Workers HTTPS 주소를 확인해 주세요.';return}
 if(entered)bearer=entered;
 token.value='';
 if(bearer.length<32){status.className='error';status.textContent='APP_AUTH_TOKEN은 32자 이상이어야 합니다.';return}
 endpoint=new URL(u).origin;controller?.abort();controller=new AbortController();
 refresh.disabled=true;status.className='note';status.textContent='실제 계좌 조회 중…';
 try{
 const res=await fetch(endpoint+'/private/live-snapshot',{method:'GET',headers:{Authorization:'Bearer '+bearer},mode:'cors',cache:'no-store',credentials:'omit',signal:controller.signal});
 if(!res.ok)throw Error('HTTP '+res.status+' · 인증/Worker 배포/API 권한 확인');
 render(await res.json());
 }catch(e){if(e.name!=='AbortError'){clear();status.className='error';status.textContent='연결 실패: '+e.message+' · CORS 또는 인증 설정을 확인해 주세요.'}}finally{refresh.disabled=false}
});
disconnect.addEventListener('click',()=>{controller?.abort();bearer='';endpoint='';token.value='';clear();status.className='note';status.textContent='연결 해제'});
document.addEventListener('visibilitychange',()=>{if(document.hidden){controller?.abort();bearer='';status.textContent='보안을 위해 인증 해제 · 다시 인증해 주세요.'}});
})();
