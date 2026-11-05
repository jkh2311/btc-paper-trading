/* Deterministic offline failure-scenario checks for the BTCUSDT live order pipeline.
 * All data is simulated. No credentials, WebSocket, REST calls or real orders.
 */
(()=>{
'use strict';
const page=document.getElementById('page-position');if(!page)return;
const e=(tag,text)=>{const x=document.createElement(tag);if(text!==undefined)x.textContent=String(text);return x};
const box=e('section');box.className='direct-live';
const h=e('h2','실전 주문 안전 시나리오 검사 (모의 테스트)');
const info=e('p','실제 바이낸스 테스트넷 결과가 아니라 주문 처리 상태 전이를 점검하는 오프라인 테스트입니다. 실패 1건이라도 있으면 거래 활성화 불가.');
const button=e('button','오프라인 시나리오 10건 실행');button.type='button';
const out=e('pre','아직 검사하지 않았습니다.');out.setAttribute('role','status');
out.style.cssText='white-space:pre-wrap;font:12px/1.7 ui-monospace,monospace;overflow-wrap:anywhere;background:#07182c;padding:11px;border-radius:9px';
box.append(h,info,button,out);page.append(box);
const STATES=Object.freeze({
 READY:'READY', ENTRY_UNKNOWN:'ENTRY_UNKNOWN', ENTRY_NOT_FILLED:'ENTRY_NOT_FILLED',
 ENTRY_FILLED:'ENTRY_FILLED', STOP_UNKNOWN:'STOP_UNKNOWN',
 STOP_VERIFIED:'STOP_VERIFIED', TAKE_UNKNOWN:'TAKE_UNKNOWN',
 PROTECTION_VERIFIED:'PROTECTION_VERIFIED', HALTED:'HALTED'
});
const enums=Object.values(STATES);
function reduce(state,event){
 if(!enums.includes(state))throw Error('Unknown state');
 if(!['READY','ENTRY_NOT_FILLED'].includes(state)&&event==='RETRY_ENTRY')return state;
 const map={
 READY:{SUBMIT_ENTRY:STATES.ENTRY_UNKNOWN},
 ENTRY_UNKNOWN:{ENTRY_CONFIRMED_FILLED:STATES.ENTRY_FILLED,ENTRY_CONFIRMED_NOT_FILLED:STATES.ENTRY_NOT_FILLED,ENTRY_TIMEOUT:STATES.HALTED,ENTRY_REJECTED:STATES.ENTRY_NOT_FILLED},
 ENTRY_FILLED:{SUBMIT_STOP:STATES.STOP_UNKNOWN,APP_CLOSED:STATES.HALTED},
 STOP_UNKNOWN:{STOP_VERIFIED:STATES.STOP_VERIFIED,STOP_TIMEOUT:STATES.HALTED,STOP_REJECTED:STATES.HALTED,APP_CLOSED:STATES.HALTED},
 STOP_VERIFIED:{SUBMIT_TAKE:STATES.TAKE_UNKNOWN,APP_CLOSED:STATES.HALTED},
 TAKE_UNKNOWN:{TAKE_VERIFIED:STATES.PROTECTION_VERIFIED,TAKE_TIMEOUT:STATES.HALTED,TAKE_REJECTED:STATES.HALTED,APP_CLOSED:STATES.HALTED},
 PROTECTION_VERIFIED:{APP_CLOSED:STATES.HALTED,PROTECTION_MISSING:STATES.HALTED},
 ENTRY_NOT_FILLED:{RESET_AFTER_EXCHANGE_RECONCILE:STATES.READY},
 HALTED:{READ_ONLY_RECONCILE:STATES.HALTED}
 };
 return map[state]?.[event]||state;
}
function runScenario(name,events,wanted){
 let current=STATES.READY;
 for(const event of events)current=reduce(current,event);
 return {name,actual:current,expected:wanted,pass:current===wanted};
}
const scenarios=[
 ['전량 체결 → 손절 → 익절 상태 검증',
  ['SUBMIT_ENTRY','ENTRY_CONFIRMED_FILLED','SUBMIT_STOP','STOP_VERIFIED','SUBMIT_TAKE','TAKE_VERIFIED'],STATES.PROTECTION_VERIFIED],
 ['진입 요청 무응답 → 신규 주문 잠금',
  ['SUBMIT_ENTRY','ENTRY_TIMEOUT'],STATES.HALTED],
 ['거절 주문은 체결로 간주하지 않음',
  ['SUBMIT_ENTRY','ENTRY_REJECTED'],STATES.ENTRY_NOT_FILLED],
 ['FOK 미체결은 보호 주문 시작하지 않음',
  ['SUBMIT_ENTRY','ENTRY_CONFIRMED_NOT_FILLED','SUBMIT_STOP'],STATES.ENTRY_NOT_FILLED],
 ['진입 체결 직후 앱 종료 → 중단',
  ['SUBMIT_ENTRY','ENTRY_CONFIRMED_FILLED','APP_CLOSED'],STATES.HALTED],
 ['손절 주문 거절 → 중단',
  ['SUBMIT_ENTRY','ENTRY_CONFIRMED_FILLED','SUBMIT_STOP','STOP_REJECTED'],STATES.HALTED],
 ['손절 주문 시간초과 → 중단',
  ['SUBMIT_ENTRY','ENTRY_CONFIRMED_FILLED','SUBMIT_STOP','STOP_TIMEOUT'],STATES.HALTED],
 ['익절 주문 시간초과 → 중단',
  ['SUBMIT_ENTRY','ENTRY_CONFIRMED_FILLED','SUBMIT_STOP','STOP_VERIFIED','SUBMIT_TAKE','TAKE_TIMEOUT'],STATES.HALTED],
 ['중단 상태에서 진입 재시도 거부',
  ['SUBMIT_ENTRY','ENTRY_TIMEOUT','RETRY_ENTRY','SUBMIT_ENTRY'],STATES.HALTED],
 ['보호 주문 확인 후 거래소 상태 변경 → 중단',
  ['SUBMIT_ENTRY','ENTRY_CONFIRMED_FILLED','SUBMIT_STOP','STOP_VERIFIED','SUBMIT_TAKE','TAKE_VERIFIED','PROTECTION_MISSING'],STATES.HALTED]
];
function run(){
 const results=scenarios.map(x=>runScenario(...x));
 const count=results.filter(r=>r.pass).length;
 out.textContent='시뮬레이션 '+count+'/'+results.length+' 통과 · '+new Date().toLocaleTimeString('ko-KR')+'\n'+
  results.map(r=>(r.pass?'✅':'❌')+' '+r.name+' : '+r.actual).join('\n')+
  '\n\n실계좌/테스트넷에 주문을 보내지 않았습니다. 네트워크·iOS 백그라운드·실제 거래소 응답의 안전성은 별도 검증이 필요합니다.';
 out.style.color=count===results.length?'#b0edd5':'#ffadb4';
 return results;
}
button.addEventListener('click',run);
// Expose only safe pure test function in a scoped browser namespace for offline QA.
Object.defineProperty(box,'runSafetyChecks',{value:run,writable:false});
})();
