# BTCUSDT 실전매매 전환 작업 (비활성화 상태)

이 브랜치는 기존 모의매매 앱을 **덮어쓰지 않고** 실전매매 버전을 만드는 작업 공간입니다.

## 보존된 모의매매
- `archive/paper-trading-v61-20261105` 브랜치에 현재 모의매매 v61 전체 코드 보존
- GitHub Pages `main`은 현재 모의매매를 계속 실행
- 별도 실전 개발 브랜치에서 작업하며 자동 실거래/주문 전송은 일절 하지 않음

## 재사용할 UI/로직
- BTCUSDT 가격, 캔들, 이동평균, 볼린저, RMI, LONG/SHORT 신호
- 차트 확대 모드, 캔들/거래량/RMI 높이 조절, 예약가격선 드래그 및 주문취소 UI
- 수동 피라미드 단계별 증거금 계획 **산식만** 유지. 실제 잔고/예약 증거금은 바이낸스가 반환한 값으로 교체

## 실전 전환 시 반드시 대체할 데이터
1. `hedgePositions`, `position`: 바이낸스 USDⓈ-M 포지션 및 체결 이벤트를 서버 통해 동기화
2. `pendingOrders`, `autoPendingLimit`: 서버가 조회한 실제 미체결 주문 ID / status를 기준으로 표시
3. `balance`, `paperMarginInUse`: 바이낸스 wallet/available/initial margin 응답에 연동
4. `logs`, `closedPaperTrades`: 바이낸스 거래내역 기반으로 분리
5. `openTrade`, `process`, `closePositionById`, `request`: **모의 체결 금지**; 인증된 API의 주문 상태 결과에만 반응
6. 자동 모의매매 `autoPaperEnabled`: 실거래 전에는 반드시 꺼둠. 신호 확인과 주문 실행 분리

## 서버 작업 (btc-trading-api)
- 작업 브랜치 `feature/read-only-live-account-snapshot`에서 강한 Bearer 인증 후 `GET /private/live-snapshot` 제안
- 실제 계좌/포지션/미체결 조회는 GET 전용. Cloudflare Secrets에서만 서명. 외부 API 키는 프런트엔드/GitHub에 넣지 않음
- 실계좌 조회에도 서버 인증, IP 제한, 최소 권한, 접속/오류 모니터링 필요
- **실제 주문용 POST/PUT/DELETE API는 없음**. 실전 API 주문권한 활성화나 코드 병합 전 안전 검토 필수

## 안전한 단계별 점검
1. 개발 환경에서 실계좌 조회 연결 및 헤지/단방향 모드 확인
2. 바이낸스 BTCUSDT 필터(stepSize/minQty/minNotional/tickSize), 레버리지/마진 유형 검증
3. 실제 미체결 주문 목록, 수량, 부분체결, 취소, 주문 정정 및 상태 재동기화
4. 타임아웃·중복 요청 시 idempotency와 orderId 조회 후 재시도(무조건 재주문 금지)
5. 손절·익절 보호 주문 확인 및 실패 시 신규 주문 차단(손절 실패 시 무방비 노출 금지)
6. 모의/테스트넷 검증 후 소액 실전 시험, 사용자 별도 확인으로만 실거래 활성화
7. 전체 주문 한도, 종목 고정 BTCUSDT, 레버리지 상한, 일손실 제한 및 긴급 중지 버튼

**절대 모의매매의 로컬 캔들 가격만으로 실전 체결로 취급하지 마세요.**

## 2026-11-05 업데이트: 실제 계좌 읽기 전용 UI 연결

- `live-dashboard.js` 신규 추가. `index.html`의 마지막 외부 스크립트로 연결함.
- 앱의 포지션 및 거래내역 탭에 실제 선물 USDT 잔고, 사용 가능 잔고, 현재 포지션, 일반 미체결 주문, 최근 체결을 표시할 대시보드 배치.
- Cloudflare Worker HTTPS 주소와 `APP_AUTH_TOKEN`만 사용(토큰은 메모리만 사용하고 화면 비활성화 시 지움). Binance API 키/Secret은 화면에 입력하지 않음.
- 백엔드 `btc-trading-api`의 `feature/read-only-live-account-snapshot` 브랜치에 인증된 `GET /private/live-snapshot` 및 엄격한 출처 제한 GET/OPTIONS CORS 처리 추가.
- **미배포**: GitHub 브랜치만으로 사이트/Cloudflare Worker 업데이트가 되지 않음. 인증 및 실제 읽기 성공 검증 전까지 main 병합하지 않음.
- 실전 주문/정정/취소/자동매매는 아직 구현되지 않음. BTCUSDT 거래 API 권한을 켜도 앱에서 실제 주문을 낼 수 없음.
- 현재 주문목록 조회는 일반 미체결 주문이며 **조건부 손절·익절 Algo 주문은 아직 조회하지 않음**. 따라서 실제 보호 주문 유무 판단에는 사용하지 말 것.

## 2026-11-05: 서버 없는 직접 Binance WebSocket 계좌 조회 / 주문 미리보기

- 개발 브랜치의 `live-dashboard.js`는 기존 앱의 비밀번호 기반 AES-256-GCM/PBKDF2 API 금고를 사용합니다.
- 앱 재실행 뒤 비밀번호로 API 금고를 해제해 `account.status` 및 `account.position` WebSocket API에 직접 서명 요청합니다.
- `live-order-draft.js`는 실제 계좌 가용 잔고와 레버리지, BTCUSDT exchangeInfo 호가/수량 단위에 기초해 **수동 지정가 주문 미리보기만** 계산합니다.
- 계좌 조회값은 브라우저 메모리에만 보관합니다. API 비밀키는 암호화 저장되지만 **공개 웹앱에 거래용 키를 입력하는 것 자체에 보안 위험**이 있습니다. 스크립트 변조·XSS·악성 확장·잠금 해제된 기기에서 탈취될 수 있습니다.
- 기존 모의매매 `main` 배포와 `archive/paper-trading-v61-20261105` 브랜치는 변경하지 않았습니다.
- 실제 미체결 주문 및 체결 기록 WebSocket 조회, 조건부 손절 Algo 주문, 실전 주문 생성/정정/취소, 동기화, 자동 거래는 **미구현**이며 실전 주문 기능은 잠겨 있습니다.
- 아이폰 PWA는 백그라운드 JS 실행을 보장하지 않으므로 24시간 자동매매 및 손절 제어를 브라우저에 의존해서는 안 됩니다. 손절·익절은 거래소 서버에 등록된 보호 주문으로 관리해야 합니다.
- 실제 키 입력/계좌조회 검증이나 실거래 테스트는 이 개발 환경에서 수행하지 않았습니다. API 키와 비밀키를 채팅/소스코드에 붙여넣지 마세요.

## 실전 개발 버전 v6: 실제 주문 ID 조회 (읽기 전용)

- Binance USDⓈ-M WS API `order.status`를 인증된 `getApiCredentials()` + `directBinanceWS()` 경유로 호출.
- 실전 포지션 탭에서 BTCUSDT 주문 ID로 주문 상태/원수량/체결수량/미체결수량을 조회함.
- 숫자 주문 ID 정밀도 검증, 응답 주문 ID/심볼 검사, 응답 수량 검증을 수행.
- **전체 미체결 주문 자동 목록 조회 기능이 아님**. 아직 일반/Algo 주문 통합 조회, 실제 취소/정정, 체결내역 및 보호 주문 전송은 구현하지 않았음.
- main 모의매매 배포는 변경하지 않았고 실제 체결이나 거래소 주문은 보내지 않았음.

## v7: 미체결 일반/조건부 주문 직접 조회 화면 (읽기 전용)

- 개발 브랜치에 `live-open-orders.js` 추가, `index.html`에서 로드.
- **실제 일반 미체결**: signed `GET /fapi/v1/openOrders?symbol=BTCUSDT`.
- **실제 조건부 손절·익절 및 트레일링**: signed `GET /fapi/v1/openAlgoOrders?symbol=BTCUSDT`.
- 둘 다 별도 조회로 표시. 각 상태에 주문 ID/Algo ID, 주문 가격 또는 트리거 가격, 수량을 표시.
- 새로고침은 사용자가 수행하며, 최초 정상 조회 후 화면이 보이는 동안에만 30초 간격으로 스냅샷 재조회.
- 성공한 응답이 없으면 '주문 없음' 대신 '조회 실패'를 표시. 화면 비활성화 또는 API 잠금 시 목록 초기화.
- **중요**: 브라우저에서 Binance USD-M REST API의 CORS 허용 여부를 실기기로 검증하지 않았습니다. 직접 요청이 차단될 경우 보안 장치를 우회하거나 읽기 실패를 미체결 0건으로 표시하지 않습니다.
- 이 기능은 실시간 User Data Stream 주문 동기화를 대체하지 않으며 앱 종료/화면 잠금 중 업데이트되지 않습니다.
- 실제 주문 생성·정정·취소 및 보호 주문 등록은 계속 미구현/잠금 상태. 모의매매 메인 브랜치는 미변경.

## v8: 실제 주문 취소 / 지정가 변경 사전 검증 UI

- `live-order-manage.js`를 추가하고 실전 개발 버전의 포지션 화면에 연결.
- Binance USDⓈ-M WebSocket API `order.status`를 이용해 실제 일반 미체결 주문 ID/수량/가격/상태를 조회.
- 일반 LIMIT 주문의 지정가 변경 검증: 거래소 호가 단위, 부분체결 차단, 기존 가격 대비 ±2% 안에서만 미리보기 허용.
- 실제 주문 취소/변경 코드 경로를 `order.cancel` / `order.modify`로 분리. **`LIVE_ORDER_WRITES_VERIFIED=false`이며 실제 거래소 요청 버튼은 비활성화되어 있음.**
- 실제 실행 활성화 전에 WebSocket 주문 상태 응답의 포맷, 실패/타임아웃/동시 체결, 최신 주문 상태, 보호 주문 확인, 재시도 시 중복 방지를 테스트해야 함.
- 정정은 매칭 대기열 우선순위가 바뀌며 부분체결 시 위험한 취소 조건이 있으므로 실전 주문 상태 기반으로만 실행.
- 남은 작업: 실제 일반 주문 목록/Algo 주문을 아이폰에서 확실히 조회할 방식 검증, 실제 수동 주문 등록, 서버에 등록되는 손절/익절, 사용자 데이터 실시간 갱신, 상태/취소 동기화, 거래 기록, 자동 피라미드/리스크 제한/킬 스위치, 실기기·테스트넷 검증, 별도 실전앱 배포.
- 모의매매 `main` 브랜치 및 v61 보존 브랜치는 변경하지 않음.

## v9: 수동 진입 + 거래소 보호 손절/익절 계획 (실행 금지)

- `live-order-draft.js`의 Binance BTCUSDT 가격/수량 규칙 검증 성공 시 주문 예상치(방향, 원계좌 포지션 모드, 수량, 지정가, 손절 거리)를 메모리 이벤트로 게시.
- `live-entry-protection.js` 신규 추가: 수동 지정가 LIMIT/GTC 진입, STOP_MARKET/TAKE_PROFIT_MARKET 조건부 보호 주문(Algo API), RR 목표값을 **미리보기 전용**으로 계산.
- 목표 손익비 0.5~5배 제한, 최근 계좌/주문 사전 검증 60초 제한, LONG/SHORT와 Hedge/One-Way 포지션 방향 검사.
- 서버 없이 바이낸스에 직접 연결하는 기존 API 암호화 보관함/브라우저 구조 유지.
- **실거래 주문 전송 없음:** `order.place` / `algoOrder.place` 호출은 아직 연결하지 않음. 보호 주문을 등록했다고 표시하지 않음.
- 실전 활성화 전: 실제 fill 수량 기반 보호 주문(부분체결 포함), 알맞은 reduceOnly/closePosition / hedge 모드, 보호 주문 수명/중복/반대방향 포지션 회피, Algo ID 상태 확인, 실패 시 명확한 복구 수단, 거래소 현재 레버리지·marginType/availableBalance 재검증, 거래소 minNotional/priceRange 필터, 테스트넷과 아이폰 실기기 검증 필수.
- iOS PWA가 종료되거나 화면 잠금 중이면 자율적으로 보호 주문을 계속 관리할 수 없음. 거래소가 실제로 접수한 보호 주문만 유효.
- 기존 모의매매 `main`과 archive는 변경하지 않음.
