# 아이폰 잠금화면 LONG/SHORT 신호 푸시 — Railway 사용 안 함

현재 코드에는 **아이폰 웹앱(PWA) + 별도 Cloudflare Worker** 구성만 준비되어 있습니다.
Cloudflare Worker를 배포하고 `push-config.json`에 실제 주소를 넣기 전에는 **푸시 발송이 비활성**입니다.
GitHub Pages만으로는 아이폰 화면이 꺼졌을 때 1분 신호를 계속 계산하거나 Web Push를 발송할 수 없습니다.

## 사전 조건

- iOS 16.4 이상, 홈 화면에 추가한 `https://jkh2311.github.io/btc-paper-trading/` 앱에서 알림을 직접 허용
- Cloudflare 계정에서 Workers 및 KV 사용 가능
- 로컬 컴퓨터/Cloudflare 개발 환경에서 Node.js 20+와 npm/Wrangler 사용
- Binance 선물 공개 캔들 API를 Cloudflare Worker에서 읽을 수 있어야 함. 지역/네트워크 차단이 발생하면 별도 시세 데이터 경로가 필요
- 실거래·Railway 코드·브라우저 저장된 가상 포지션은 건드리지 않음

## 배포 순서 (Cloudflare 계정 소유자가 직접 수행)

1. `cd push-worker && npm install`
2. Cloudflare 로그인: `npx wrangler login`
3. KV 만들기: `npx wrangler kv namespace create PUSH_STORE`
4. 반환된 KV ID를 `push-worker/wrangler.toml`의 `YOUR_KV_NAMESPACE_ID`에 반영
5. VAPID 키 만들기(예시): `npx web-push generate-vapid-keys`. **개인키는 절대로 GitHub·채팅·클라이언트 파일에 올리지 않음**
6. 환경 변수/비밀키 입력:
   - `npx wrangler secret put VAPID_PRIVATE_KEY` (VAPID 개인키)
   - `npx wrangler secret put VAPID_PUBLIC_KEY` (VAPID 공개키)
   - `npx wrangler secret put VAPID_SUBJECT` (예: `mailto:your-address@example.com`; 본인 이메일 사용)
7. `npm run deploy`로 Worker 배포. 1분 단위 Cron이 등록돼야 함.
8. `https://<본인 Worker 주소>/health`가 `configured:true`인지 확인
9. GitHub Pages의 `push-config.json`의 `workerUrl`을 Worker 실제 HTTPS 주소로 수정하고 커밋
10. 아이폰 Safari에서 웹앱을 **홈 화면에 추가** 후 앱 실행 → 설정 → **알림 켜기** → 권한 허용

## 주의할 점

- 서버 푸시는 자동매매 ON/OFF와 별도이며, 실제 모의 진입/체결 알림이 아니라 **진입 조건 신호** 알림임.
- 자동 전략 모드와 RMI 기준값은 사용자가 알림 등록할 때 저장되며, 앱이 켜져 있으면 주기적으로 동기화됨. 오프라인에서 바꾼 설정은 동기화되기 전까지 반영되지 않음.
- Cloudflare Worker는 기존 차트의 `calculateAutoPaperSignal` 계산식을 옮겨왔지만 **아이폰/Cloudflare 실환경 일치 검증은 미완료**. 특히 앱의 로컬 주문/진입 제한 및 체결 상태는 서버에서 추적하지 않으므로 완전 동일한 포지션 판정은 아님.
- Worker Cron은 정확한 초에 실행된다는 보장이 없고 시세 API·푸시 제공자 지연이 있을 수 있음. '초단타 실시간 보장'으로 표현하지 말 것.
- 중복 알림은 수신 단말의 구독 endpoint + 캔들 시각 + LONG/SHORT로 방지. KV 최종 일관성/재시도로 중복 가능성은 여전히 있음.
- `push-config.json`의 주소가 빈 값이면 앱은 푸시를 작동 중으로 표시하지 않음.
- 알림 구독 endpoint는 개인정보로 취급하고, Cloudflare KV 접근 권한을 보호할 것. 개인용 시범 서버이므로 대규모 사용자 계정 인증과 악용 차단은 추가 설계가 필요.
- 이 기능은 거래를 주문하거나 가상 잔고/손절/익절을 관리하지 않음. 서버가 자동매매를 대신하지 않음.

## 점검

- `node --check push-worker/src/index.js` 문법 검사
- `npx wrangler dev --test-scheduled`에서 예약 실행 점검
- `/health` 점검, 구독 등록, 테스트 신호 전송, 화면 잠금/앱 종료 상태의 실제 푸시 수신 검사
- 1분봉 롱/숏 신호가 앱 차트와 일치하는지 같은 데이터 시점에 비교
