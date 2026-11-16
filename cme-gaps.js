/* CME futures gap display. Chart-only; does not alter orders or signal logic.
 * Verified-source CSV or user supplied prices only. No Binance data used. */
(()=>{'use strict';
const key='hanine-cme-gaps-v231';
const $=id=>document.getElementById(id);
let rows=[],show=true,filled=false;
try{const data=JSON.parse(localStorage.getItem(key)||'{}');
 if(Array.isArray(data.rows))rows=data.rows.filter(x=>/^\d{4}-\d{2}-\d{2}$/.test(x.date)&&Number.isFinite(x.low)&&Number.isFinite(x.high)&&x.low>0&&x.high>x.low).slice(-300);
 show=data.show!==false;filled=!!data.filled;
}catch(_){}
function store(){try{localStorage.setItem(key,JSON.stringify({rows,show,filled}))}catch(_){}}
function refresh(){window.btcRedrawChart?.()}
function date(value){
 const t=String(value??'').trim(),m=t.match(/^(\d{4})[-/.](\d\d)[-/.](\d\d)/);
 if(m){const s=m[1]+'-'+m[2]+'-'+m[3];return Number.isFinite(Date.parse(s+'T00:00:00Z'))?s:null}
 if(/^\d{10,13}$/.test(t)){const d=new Date(Number(t)*(t.length===10?1000:1));return Number.isFinite(+d)?d.toISOString().slice(0,10):null}
 return null;
}
function split(line,delim){
 let result=[],buffer='',quoted=false;
 for(let i=0;i<line.length;i++){const ch=line[i];
  if(ch==='"'){if(quoted&&line[i+1]==='"'){buffer+='"';i++}else quoted=!quoted}
  else if(ch===delim&&!quoted){result.push(buffer.trim());buffer=''}
  else buffer+=ch;
 }result.push(buffer.trim());return result;
}
function parse(csv){
 const lines=csv.replace(/^\uFEFF/,'').split(/\r?\n/).filter(x=>x.trim());
 if(lines.length<3||lines.length>10000)throw Error('2~10,000행의 CME 일별 CSV만 지원해요.');
 const delimiter=lines[0].includes(';')?';':lines[0].includes('\t')?'\t':',';
 const names=split(lines[0],delimiter).map(x=>x.toLowerCase().replace(/[^a-z]/g,''));
 const find=(...arr)=>names.findIndex(x=>arr.includes(x));
 const cols=[find('date','time','datetime','timestamp'),find('open','openprice'),find('high','highprice'),
  find('low','lowprice'),find('close','closeprice')];
 if(cols.includes(-1))throw Error('Date, Open, High, Low, Close 열이 필요해요.');
 const bars=[];
 for(const line of lines.slice(1)){
  const a=split(line,delimiter),dt=date(a[cols[0]]);
  const [o,h,l,c]=cols.slice(1).map(i=>Number(String(a[i]||'').replace(/,/g,'')));
  if(dt&&[o,h,l,c].every(Number.isFinite)&&l>0&&h>=Math.max(o,c,l)&&l<=Math.min(o,c))bars.push({date:dt,o,h,l,c});
 }
 bars.sort((a,b)=>a.date.localeCompare(b.date));
 const unique=[...new Map(bars.map(x=>[x.date,x])).values()],gaps=[];
 if(unique.length<2)throw Error('유효한 CME 일별 가격이 부족해요.');
 for(let i=1;i<unique.length;i++){
  const prev=unique[i-1],next=unique[i],p=Date.parse(prev.date+'T00:00:00Z'),n=Date.parse(next.date+'T00:00:00Z'),
   prevDay=new Date(p).getUTCDay(),day=new Date(n).getUTCDay(),elapsed=(n-p)/86400000;
  // Historical Friday to Sunday/Monday gap; stop on CME's 24/7 launch.
  if(!(prevDay===5&&(day===0||day===1)&&elapsed>=2&&elapsed<=4&&n<Date.UTC(2026,4,30)))continue;
  if(Math.abs(next.o-prev.c)<5)continue;
  const low=Math.min(prev.c,next.o),high=Math.max(prev.c,next.o);
  const after=unique.slice(i+1),up=next.o>prev.c;
  const settled=after.some(b=>up?b.l<=low:b.h>=high);
  gaps.push({date:next.date,low,high,filled:settled,source:'CSV'});
 }
 return {gaps,from:unique[0].date,to:unique.at(-1).date,count:unique.length};
}
function status(s){$('cmeGapStatus').textContent=s}
function render(){
 $('cmeGapToggle').checked=show;$('cmeGapFilled').checked=filled;
 const list=$('cmeGapList');list.replaceChildren();
 if(!rows.length)status('저장된 CME 갭 없음 · 확인된 데이터만 표시');
 else status(rows.length+'개 저장 · '+(filled?'전체':'미충족만')+' 표시');
 for(const entry of rows.slice().reverse().slice(0,40)){
  const el=document.createElement('div');el.style.cssText='display:flex;gap:6px;align-items:center;justify-content:space-between';
  const text=document.createElement('span');text.textContent=entry.date+' · $'+entry.low.toLocaleString('en-US')+'~'+entry.high.toLocaleString('en-US')+(entry.filled?' · 충족':'');
  const btn=document.createElement('button');btn.type='button';btn.textContent='삭제';btn.style.cssText='font-size:11px;padding:4px 7px';
  btn.onclick=()=>{rows=rows.filter(x=>x!==entry);store();render();refresh()};
  el.append(text,btn);list.append(el);
 }
}
window.btcDrawCmeGaps=(ctx,scale)=>{
 if(!show)return;
 const {y,lo,hi,top,priceBottom,plotW}=scale;
 const shown=rows.filter(r=>(filled||!r.filled)&&r.high>=lo&&r.low<=hi).slice(-35);
 if(!shown.length)return;
 ctx.save();ctx.beginPath();ctx.rect(0,top,plotW,priceBottom-top);ctx.clip();
 ctx.font='bold 10px -apple-system,sans-serif';
 for(const r of shown){
  const color=r.filled?'#8293aa':'#f8cf70';
  for(const price of [r.low,r.high]){
   const yy=y(price);if(yy<top||yy>priceBottom)continue;
   ctx.strokeStyle=color;ctx.lineWidth=1.2;ctx.setLineDash([6,5]);
   ctx.beginPath();ctx.moveTo(0,yy+.5);ctx.lineTo(plotW,yy+.5);ctx.stroke();
  }
  ctx.setLineDash([]);
  const center=y((r.low+r.high)/2);if(center<top||center>priceBottom)continue;
  const label='CME 갭 '+r.date+' $'+r.low.toLocaleString('en-US')+'~'+r.high.toLocaleString('en-US');
  const tw=Math.min(plotW-6,ctx.measureText(label).width+12);
  const ty=Math.max(top,Math.min(priceBottom-17,center-9));
  ctx.fillStyle='rgba(10,24,43,.94)';ctx.fillRect(3,ty,tw,17);
  ctx.fillStyle=color;ctx.fillText(label,9,ty+12,tw-9);
 }
 ctx.restore();
};
$('cmeGapToggle').onchange=e=>{show=e.target.checked;store();refresh()};
$('cmeGapFilled').onchange=e=>{filled=e.target.checked;store();render();refresh()};
$('cmeGapCsv').onchange=async e=>{
 const file=e.target.files?.[0];if(!file)return;
 try{
  if(file.size>2500000)throw Error('2.5MB 이하 CSV만 지원해요.');
  const result=parse(await file.text());
  rows=[...rows.filter(x=>x.source!=='CSV'),...result.gaps].sort((a,b)=>a.date.localeCompare(b.date)).slice(-300);
  store();render();refresh();
  status('CME CSV '+result.count+'일 검사 · '+result.gaps.length+'개 갭 · '+result.from+'~'+result.to);
 }catch(err){status('가져오기 실패: '+err.message)}
 finally{e.target.value=''}
};
$('cmeGapAdd').onclick=()=>{
 const dt=$('cmeGapDate').value,low=Number($('cmeGapLow').value),high=Number($('cmeGapHigh').value);
 if(!date(dt)||!(low>0&&high>low)){status('날짜와 갭 하단·상단 가격을 확인해 줘.');return}
 rows=[...rows.filter(x=>!(x.source==='직접 등록'&&x.date===dt&&x.low===low&&x.high===high)),
  {date:dt,low,high,filled:false,source:'직접 등록'}].sort((a,b)=>a.date.localeCompare(b.date)).slice(-300);
 store();render();refresh();
};
$('cmeGapReset').onclick=()=>{
 if(!rows.length||!confirm('저장된 CME 갭을 모두 지울까요?'))return;
 rows=[];store();render();refresh();
};
render();
})();