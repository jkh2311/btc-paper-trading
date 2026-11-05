/* v16: RMI live AUTO signal monitor (paper-strategy candidate bridge).
 * NO trades. No signed Binance request. Never runs in the background.
 */
(()=>{
'use strict';
const page=document.getElementById('page-position');if(!page)return;
const el=(tag,text)=>{const x=document.createElement(tag);if(text!==undefined)x.textContent=String(text);return x};
const card=el('section');card.className='direct-live';
const head=el('h2','RMI AUTO · 실전 신호 관찰');
const desc=el('p','기존 1분 RMI·시장 모드·5/15분 추세·거래량 조건을 그대로 사용해 매매 후보를 표시합니다. 실제 주문은 전송하지 않습니다.');
const toggle=el('button','RMI AUTO 신호 관찰 OFF');toggle.type='button';
toggle.setAttribute('aria-pressed','false');
const status=el('p','신호 관찰 OFF · 실거래 주문 비활성');
status.setAttribute('role','status');
const list=el('div');
const info=el('p','기기 화면이 보일 때만 새로 확정된 캔들 신호를 받습니다. 과거 신호로 주문하지 않으며, 앱 재시작 후 과거 캔들을 재실행하지 않습니다.');
card.append(head,desc,toggle,status,list,info);
page.append(card);
const KEY='btc-live-rmi-observed-v1';
let enabled=false,account=null,seen='',lastTime=0,signalCount=0;
try{const val=localStorage.getItem(KEY);seen=typeof val==='string'&&/^[0-9]{10,15}:(LONG|SHORT)$/.test(val)?val:''}catch(_){}
function render(){toggle.textContent='RMI AUTO 신호 관찰 '+(enabled?'ON':'OFF');toggle.setAttribute('aria-pressed',String(enabled))}
function disable(reason){enabled=false;account=null;render();status.textContent=reason||'신호 관찰 OFF · 주문 실행 없음'}
toggle.addEventListener('click',()=>{
 enabled=!enabled;render();
 status.textContent=enabled?'RMI 조건을 만족하는 다음 확정봉부터 관찰 · 실제 주문은 보내지 않아요.':
 '신호 관찰 OFF · 주문 실행 없음';
});
document.addEventListener('btc:live-account-read',e=>{
 account={at:Date.now(),canTrade:e.detail?.account?.canTrade===true,
  available:Number(e.detail?.account?.availableBalance),positions:Array.isArray(e.detail?.positions)?e.detail.positions:[]};
});
document.addEventListener('btc:live-rmi-candidate',e=>{
 if(!enabled||document.hidden)return;
 const s=e.detail;
 if(s?.symbol!=='BTCUSDT'||!['LONG','SHORT'].includes(s.side))return;
 const bar=Number(s.barTime),now=Date.now();
 if(!Number.isFinite(bar)||bar<=0||now<bar+60000||now-(bar+60000)>90000)return;
 const key=bar+':'+s.side;
 if(key===seen||bar<=lastTime)return;
 // Persist the signal key BEFORE presenting it; browser reload must not repeat it.
 try{localStorage.setItem(KEY,key)}catch(_){status.textContent='중복 신호 기록 불가 · 신호 관찰 중단';disable();return}
 seen=key;lastTime=bar;signalCount++;
 const row=el('div');row.className='order-entry';
 const title=el('b',s.side+' · '+new Date(bar+60000).toLocaleTimeString('ko-KR')+' 확정');
 const body=el('small','기준가 '+Number(s.price).toLocaleString('ko-KR')+' USDT · 1분 RMI '+s.minuteRmi+
  ' · 거래량 '+s.volumeRatio+'배 · '+String(s.reason||'').slice(0,220));
 row.append(title,body);list.prepend(row);
 while(list.children.length>10)list.removeChild(list.lastChild);
 const fresh=account&&now-account.at<=60000&&account.canTrade&&Number.isFinite(account.available)&&account.available>0;
 status.textContent='신호 '+signalCount+'건 관찰 · '+s.side+(fresh?' · 계좌 조회 유효':' · 실계좌 재조회 필요')+
  ' · 주문 미전송 / AUTO 실행 기능 미구현';
});
document.addEventListener('btc:live-lock',()=>disable('API 잠금 · RMI 관찰 OFF'));
document.addEventListener('visibilitychange',()=>{if(document.hidden)disable('앱 비활성화 · RMI 관찰 OFF')});
window.addEventListener('pagehide',()=>disable('앱 종료 · RMI 관찰 OFF'));
render();
})();