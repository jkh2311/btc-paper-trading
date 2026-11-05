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
