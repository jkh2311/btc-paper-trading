# 서버 기반 실전 자동매매 — BTCUSDT USD-M Futures (v240)

이 기능은 **모의매매가 아닙니다.** 활성화 시 바이낸스 선물 **실제 시장가 주문**을 전송할 수 있습니다. 초기 상태는 **OFF**이며 GitHub Pages 화면에서 켤 수 없습니다.

## 현재 배포 상태 / 사전 조건

- Render 웹서비스의 24시간 지속 실행을 보장할 수 없는 무료 플랜은 실거래에 적합하지 않습니다.
- 서버가 Binance USD-M Futures 시세와 서명된 계좌·주문 API를 정상 호출해야 합니다. 특히 451 지역/접근 제한이면 **실거래를 시작하지 마세요.**
- Render 시크릿 환경변수에 **별도의 바이낸스 선물 거래 전용 API Key/Secret**이 필요합니다. **출금 권한을 부여하지 마세요.** 아이폰 PWA에 암호화 저장된 API 키는 서버로 자동 전송되지 않습니다.
- 모든 신호/주문 처리 이력을 보존할 **PostgreSQL 영구 데이터베이스**가 있어야 합니다. `LIVE_TRADING_DATABASE_URL` 없는 경우 주문이 차단됩니다. 연결 가능한 Render Postgres를 개설하면 비용이 발생할 수 있습니다.
- 실전 주문이 존재하는데 보호주문이나 체결 검증이 실패할 가능성을 제거할 수는 없습니다. 소액 거래소 연동 실험과 계좌/보호주문 테스트가 먼저 필요합니다.

## 서버 시크릿 / 환경변수

아래 변수들은 **Render 대시보드의 Environment에만** 입력합니다. GitHub에 키나 토큰을 커밋하지 말고 채팅에 보내지도 마세요.

| 환경변수 | 예시 / 허용값 | 설명 |
| --- | --- | --- |
| `BINANCE_FUTURES_TRADE_KEY` | (비공개) | 서버용 선물 거래 키 |
| `BINANCE_FUTURES_TRADE_SECRET` | (비공개) | 서버용 선물 거래 시크릿 |
| `LIVE_TRADING_DATABASE_URL` | (비공개 Postgres 연결문자열) | 영구 중복 주문 방지 |
| `LIVE_TRADING_DATABASE_SSL` | `true` / `false` | Postgres TLS 정책에 맞춤 |
| `LIVE_AUTO_MODE` | `follow` / `strategy` | 기존 LONG/SHORT 신호 또는 독립 전략 선택 |
| `LIVE_AUTO_STRATEGY` | `range` / `bear` / `bull` | 전략 선택 시 적용 |
| `LIVE_AUTO_NOTIONAL_USDT` | `100` | **명목 주문금액** 25~200 USDT |
| `LIVE_AUTO_STOP_PCT` | `1` | 손절 0.5~2% |
| `LIVE_AUTO_TAKE_PCT` | `2` | 익절 0.5~4% |
| `LIVE_AUTO_ENABLED` | **기본 `false`** | 실제 거래 시작 승인 |
| `LIVE_AUTO_CONFIRM` | **기본 공백** | 별도 명시적 승인 문구 `ENABLE_REAL_BTCUSDT_ORDERS` 필요 |

**안전 권고:** 모든 거래/권한/보호주문 검증 전에는 `LIVE_AUTO_ENABLED=false`, `LIVE_AUTO_CONFIRM` 비워두기. 정확한 실거래 활성화 문구를 입력하면 실제 주문이 나갈 수 있습니다.

## 동작 방식

1. Render 서버가 Binance `fapi.binance.com`의 확정 1분봉을 읽음 (바이비트 사용 금지).
2. `follow`는 단일 푸시 가입 기기에 설정된 RMI 전략 사용. `strategy`는 별도 서버 환경변수 사용. 1분봉 LONG/SHORT 신호만 진입 대상. `READY`는 진입 아님.
3. 신호별 고유 ID를 PostgreSQL에 **먼저** 기록하고, 기존 포지션·미체결 일반주문·조건부 주문이 하나라도 있으면 신규 진입 금지.
4. 단방향(One-way) 모드, BTCUSDT 한 종목만 지원. 헤지 모드는 차단.
5. 시장가 진입 **완전 체결 확인 후** 거래소의 STOP_MARKET / TAKE_PROFIT_MARKET 전체 포지션 종료 조건부 주문을 등록.
6. 보호주문 등록 실패 시 **확인된 포지션에 한해** 긴급 reduceOnly 청산을 시도. 결과가 불확실하면 재주문을 자동 시도하지 않고 검토 상태로 전환.
7. **반대 신호가 와도 이미 보유한 포지션은 임의 청산·스위칭하지 않음.** 기존 사용자가 배치한 주문을 취소하거나 수정하지 않음.
8. 서버 시작 시 과거 신호로 진입하지 않음. 하루 최대 6회 신호 요청 후 중단.
9. 차트/기존 수동 주문/기존 푸시 알림의 코드 경로는 수정하지 않음.

## 확인

- `GET /live/preflight`: 서버 실전 자동매매 상태/차단 이유만 반환. 인증키 자체는 출력하지 않음.
- `GET /live/status`: 신호와 오류 요약.
- `GET /health`: 기존 푸시 서버 확인.

### 중요한 한계

이 구현은 **서버 코드와 단위 시뮬레이션 수준까지 검증**된 것으로, 실제 거래소 계좌에서 엔드투엔드 실거래·보호주문·서버 재시작 복구를 검증한 것은 아닙니다. 안전하게 운용할 수 있다고 확인되기 전에는 활성화하지 마세요. 거래소 정책 또는 지역 제한을 우회하는 연결은 지원하지 않습니다.
