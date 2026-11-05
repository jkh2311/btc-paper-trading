/* Mini BTC chart: inside the PWA only (not system PiP). */
(() => {
'use strict';
const css = '#miniBtcBtn{position:fixed;right:10px;top:58px;z-index:9399;padding:7px;font-size:12px;background:#193650;color:white;border:1px solid #536e89;border-radius:10px}'+
'#miniBtcBox{position:fixed;right:10px;top:100px;width:240px;max-width:calc(100vw - 20px);z-index:9400;padding:10px;border-radius:14px;border:1px solid #536e89;background:#0b192c;color:white;box-shadow:0 8px 30px #000a}'+
'#miniBtcBox[hidden]{display:none}#miniBtcHandle{display:flex;justify-content:space-between;align-items:center;touch-action:none;user-select:none;font-size:12px;font-weight:bold}'+
'#miniBtcClose{background:transparent;border:0;padding:2px 6px;color:white}#miniBtcPrice{font-size:22px;font-weight:700;margin:9px 0}'+
'#miniBtcCanvas{display:block;width:100%;height:92px;border:0;background:transparent;touch-action:none}#miniBtcInfo{display:flex;justify-content:space-between;font-size:11px;margin-top:6px}#miniBtcNote{color:#9ab0ca;font-size:10px;margin-top:5px}';
const style=document.createElement('style');style.textContent=css;document.head.appendChild(style);
const btn=document.createElement('button');btn.id='miniBtcBtn';btn.type='button';btn.textContent='▣ 미니';btn.setAttribute('aria-label','미니 차트 열기');
const box=document.createElement('div');box.id='miniBtcBox';box.hidden=true;
box.innerHTML='<div id="miniBtcHandle"><span>₿ BTCUSDT · <span id="miniBtcTf">1분</span></span><button id="miniBtcClose" type="button" aria-label="닫기">✕</button></div><div id="miniBtcPrice">-- USDT</div><canvas id="miniBtcCanvas" width="440" height="184"></canvas><div id="miniBtcInfo"><span id="miniBtcTrend">추세 대기</span><span id="miniBtcRmi">RMI --</span></div><div id="miniBtcNote">PWA 앱 내부 전용</div>';
document.body.append(btn,box);
const el=id=>document.getElementById(id);
const key='btc-mini-chart-open-v1';
function paint(){
  if(box.hidden||document.visibilityState==='hidden')return;
  const tf=el('tf')?.value||'1m', data=(typeof candles!=='undefined'&&candles[tf])||[];
  const bars=data.slice(-30).filter(b=>[b.o,b.h,b.l,b.c].every(v=>Number.isFinite(Number(v))));
  const price=Number(typeof last!=='undefined'?last:0)||Number(bars[bars.length-1]?.c)||0;
  el('miniBtcTf').textContent=({'1m':'1분','5m':'5분','15m':'15분','30m':'30분','1h':'1시간','4h':'4시간','1d':'1일'})[tf]||tf;
  el('miniBtcPrice').textContent=price>0?(typeof fmt==='function'?fmt(price):price.toFixed(1))+' USDT':'-- USDT';
  const dir=data.length>=22&&typeof trend==='function'?trend(data):'대기';
  el('miniBtcTrend').textContent='추세 '+dir;el('miniBtcTrend').style.color=dir==='상승'?'#4dd4a4':dir==='하락'?'#ff7d92':'#aec1d5';
  const rmi=data.length>=20&&typeof rmiSeries==='function'?rmiSeries(data):[];
  const score=rmi[rmi.length-1];el('miniBtcRmi').textContent='RMI '+(Number.isFinite(score)?score.toFixed(1):'--');
  el('miniBtcNote').textContent=typeof demo!=='undefined'&&demo?'데모 시세 (실제 가격 아님)':typeof wsConnected!=='undefined'&&wsConnected?'실시간 시세 · 앱 내부 전용':'연결 대기 · 최근 시세';
  const cv=el('miniBtcCanvas'),ctx=cv.getContext('2d');if(!ctx)return;
  const w=220,h=92,dpr=Math.min(devicePixelRatio||1,3);
  if(cv.width!==Math.round(w*dpr)||cv.height!==Math.round(h*dpr)){cv.width=Math.round(w*dpr);cv.height=Math.round(h*dpr)}
  ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);
  if(!bars.length){ctx.font='12px sans-serif';ctx.fillStyle='#aec1d5';ctx.fillText('캔들 데이터 대기 중',10,45);return}
  let low=Math.min(...bars.map(b=>Number(b.l))),high=Math.max(...bars.map(b=>Number(b.h)));
  const pad=Math.max((high-low)*.12,high*.00005,1);low-=pad;high+=pad;
  const y=v=>5+(high-v)/(high-low)*(h-10),dx=w/bars.length,bw=Math.max(2,Math.min(7,dx*.6));
  bars.forEach((b,i)=>{const x=(i+.5)*dx,a=y(Math.max(b.o,b.c)),z=y(Math.min(b.o,b.c));
    ctx.strokeStyle=ctx.fillStyle=Number(b.c)>=Number(b.o)?'#4dd4a4':'#ff7d92';
    ctx.beginPath();ctx.moveTo(x,y(b.h));ctx.lineTo(x,y(b.l));ctx.stroke();ctx.fillRect(x-bw/2,a,bw,Math.max(1,z-a));
  });
}
function show(open){box.hidden=!open;btn.setAttribute('aria-pressed',String(open));try{localStorage.setItem(key,open?'1':'0')}catch(_){}if(open)paint()}
btn.onclick=()=>show(box.hidden);el('miniBtcClose').onclick=()=>show(false);
const handle=el('miniBtcHandle');let drag=null;
handle.addEventListener('pointerdown',e=>{if(e.target.closest('button'))return;const r=box.getBoundingClientRect();drag={id:e.pointerId,x:e.clientX-r.left,y:e.clientY-r.top};handle.setPointerCapture(e.pointerId);e.preventDefault()});
handle.addEventListener('pointermove',e=>{if(!drag||e.pointerId!==drag.id)return;box.style.left=Math.max(0,Math.min(innerWidth-box.offsetWidth,e.clientX-drag.x))+'px';box.style.top=Math.max(0,Math.min(innerHeight-box.offsetHeight,e.clientY-drag.y))+'px';box.style.right='auto'});
handle.addEventListener('pointerup',()=>drag=null);handle.addEventListener('pointercancel',()=>drag=null);
el('tf')?.addEventListener('change',paint);document.addEventListener('visibilitychange',paint);setInterval(paint,1000);
try{if(localStorage.getItem(key)==='1')show(true)}catch(_){}
})();