# 사내 노트북 서버 세팅 절차서

전용 노트북 한 대를 사내망 상시 서버로 만들어 이 서비스를 운영하기 위한 절차다.
처음 세팅하는 사람이 이 문서만 보고 끝까지 갈 수 있게 쓴다.

---

## 0. 왜 클라우드가 아니라 노트북인가

**예약 시스템(`예약 서버`)이 사내망에서만 접근 가능하다**(2026-08-19 확인).
Vercel 같은 외부 클라우드에서는 아무리 배포해도 여기에 닿을 수 없어 예약 기능이
원천적으로 동작하지 않는다. 실제로 Vercel 배포까지 마쳤지만 이 이유로 폐기했다
(`docs/4-prd.md`의 결정 변경 이력 참고).

역할 분담은 이렇게 된다.

| 구성요소 | 어디서 도는가 | 비고 |
| --- | --- | --- |
| 프론트엔드 + 백엔드 | **이 노트북** | 한 프로세스, 한 포트(3000) |
| 자동화(Playwright) | **이 노트북** | 사내망 필수 |
| 반복 예약 스케줄러 | **이 노트북** | 매일 00:01 |
| DB | **Supabase(클라우드)** | 노트북이 죽어도 데이터는 안전 |
| LLM | OpenAI API | 인터넷 필요 |

**Postgres를 노트북에 설치하지 않는다.** DB는 Supabase를 그대로 쓴다(사내망에서
아웃바운드 접속 가능함을 실측 확인). 노트북은 "실행만 하는 기기"이므로 고장나면
이 문서대로 다시 세팅해서 교체하면 된다.

---

## 1. 준비물

- 상시 켜둘 수 있는 노트북 (사내망 유선 연결 권장 — 무선은 절전 시 끊길 수 있다)
- 관리자 권한
- 설치할 것: **Node.js LTS**(개발 기준 v24), **Git**
- 필요 없는 것: ~~Postgres~~, ~~Docker~~

```powershell
node -v    # v20 이상
npm -v
git --version
```

---

## 2. 네트워크 고정

동료들에게 알려줄 주소가 바뀌면 안 되므로 IP를 고정한다.

1. 사내 IT에 **DHCP 예약**을 요청하거나, 노트북에 고정 IP를 설정한다.
2. 할당된 IP를 적어둔다. 이 문서에서는 `<서버IP>`로 표기한다.

방화벽에서 3000 포트 인바운드를 허용한다(**관리자 권한 PowerShell**):

```powershell
New-NetFirewallRule -DisplayName "cjfw-vbcd server 3000" `
  -Direction Inbound -Protocol TCP -LocalPort 3000 `
  -RemoteAddress LocalSubnet -Profile Any -Action Allow
```

`-RemoteAddress LocalSubnet`이 핵심이다. 같은 사내망 대역에서만 접속을 허용하고
그 밖으로는 열지 않는다.

> **주의**: 사내 Wi-Fi가 Windows에서 "공용 네트워크"로 잡히는 경우가 있다. 그때
> `-Profile Private`만 주면 규칙이 적용되지 않으므로 위처럼 `Any`를 쓴다.

---

## 3. 코드 배치

```powershell
cd C:\
git clone https://github.com/jiil89/cjfw-vbcd.git
cd C:\cjfw-vbcd
```

의존성 설치와 Playwright 브라우저 설치:

```powershell
cd C:\cjfw-vbcd\backend
npm install
npx playwright install chromium      # 자동화에 필요. 빠뜨리면 예약이 전부 실패한다

cd C:\cjfw-vbcd\frontend
npm install
```

---

## 4. 환경변수 작성

`C:\cjfw-vbcd\backend\.env` 파일을 만든다. 항목 설명은 `.env.example` 참고.

먼저 비밀키 3개를 새로 생성한다(서로 **반드시 다른 값**이어야 한다):

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # 3번 실행
```

`.env` 내용:

```ini
# --- DB: Supabase (Session pooler) ---
# 비밀번호에 특수문자가 있으면 URL 인코딩할 것 (예: # -> %23)
DATABASE_URL=postgresql://postgres.<프로젝트ref>:<비밀번호>@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres

# --- 인증/암호화 (위에서 생성한 서로 다른 값 3개) ---
JWT_ACCESS_TOKEN_SECRET=<생성값1>
JWT_REFRESH_TOKEN_SECRET=<생성값2>
CREDENTIAL_ENCRYPTION_KEY=<생성값3>

# --- LLM ---
OPENAI_API_KEY=<OpenAI 키>
OPENAI_MODEL=gpt-5.6-luna

# --- 서버 ---
NODE_ENV=production
PORT=3000
# same-origin 구성이라 CORS가 실제로 쓰이진 않지만, 값이 없으면 부팅이 실패한다
ALLOWED_ORIGINS=http://<서버IP>:3000
```

> **`CREDENTIAL_ENCRYPTION_KEY`는 절대 잃어버리면 안 된다.** 사용자들의 사내 계정
> 비밀번호가 이 키로 암호화되어 DB에 저장된다. 키가 바뀌면 기존 사용자 전원이
> 다시 가입해야 한다. 안전한 곳에 따로 백업해둘 것.

---

## 5. 빌드

```powershell
cd C:\cjfw-vbcd\frontend
npm run build          # frontend/dist 생성

cd C:\cjfw-vbcd\backend
npm run build          # backend/dist 생성
```

백엔드가 `../frontend/dist`를 찾아 같은 포트에서 함께 서빙한다. 프론트용 서버를
따로 띄우지 않는다.

---

## 6. 수동 실행으로 동작 확인

자동 시작을 걸기 전에 먼저 손으로 띄워서 확인한다.

```powershell
cd C:\cjfw-vbcd\backend
npm start
```

`[backend] listening on http://localhost:3000` 이 뜨면, **다른** 터미널에서:

```powershell
curl.exe http://localhost:3000/health          # {"status":"ok"}  <- DB 연결까지 성공했다는 뜻
curl.exe http://localhost:3000/rooms           # 회의실 목록 JSON
```

브라우저로 `http://<서버IP>:3000` 접속 → 로그인 화면이 나와야 한다.
**다른 PC에서도** 같은 주소로 접속되는지 반드시 확인한다(방화벽 검증).

확인이 끝나면 `Ctrl+C`로 종료한다.

---

## 7. 절전 끄기 (가장 중요)

이걸 빠뜨리면 밤에 노트북이 잠들어 **반복 예약이 통째로 건너뛰어진다.**
실제로 2026-08-19 00:01 실행이 이 이유로 실행되지 않았다.

**관리자 권한 PowerShell**:

```powershell
powercfg /change standby-timeout-ac 0        # 대기 모드 안 함
powercfg /change hibernate-timeout-ac 0      # 최대 절전 안 함
powercfg /change monitor-timeout-ac 10       # 화면만 10분 뒤 끔 (전원 관리와 무관)
powercfg /hibernate off                      # 최대 절전 기능 자체를 끔
```

**덮개를 닫아도 계속 동작하게** (노트북이므로 필수):

```powershell
powercfg /setacvalueindex SCHEME_CURRENT 4f971e89-eebd-4455-a8de-9e59040e7347 5ca83367-6e45-459f-a27b-476b1d01c936 0
powercfg /setactive SCHEME_CURRENT
```

추가로 확인할 것:
- **전원 어댑터를 항상 연결**해둔다(배터리로 돌면 아래 스케줄러가 실행을 거부한다)
- Windows 자동 업데이트 재부팅 시간을 업무 시간 외로 설정
- 화면 잠금은 켜두되(보안), 잠금이 절전으로 이어지지 않게 위 설정 유지

---

## 8. 부팅 시 자동 시작

재부팅되어도 사람이 개입할 필요 없게 만든다. **관리자 권한 PowerShell**:

```powershell
$action = New-ScheduledTaskAction -Execute "C:\Program Files\nodejs\node.exe" `
  -Argument "dist\src\app.js" -WorkingDirectory "C:\cjfw-vbcd\backend"

$trigger = New-ScheduledTaskTrigger -AtStartup

$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit ([TimeSpan]::Zero)

Register-ScheduledTask -TaskName "cjfw-vbcd-server" `
  -Action $action -Trigger $trigger -Settings $settings `
  -User "SYSTEM" -RunLevel Highest -Force
```

- `-ExecutionTimeLimit Zero`: 상시 서버이므로 시간 제한 없음
- `-RestartCount 3`: 죽으면 1분 간격으로 3번까지 자동 재시작
- `-User SYSTEM`: 로그인하지 않아도 동작

바로 시작해서 확인:

```powershell
Start-ScheduledTask -TaskName "cjfw-vbcd-server"
Start-Sleep 10
curl.exe http://localhost:3000/health
```

---

## 9. 반복 예약 스케줄러 등록

매일 00:01에 "오늘로부터 7일 뒤" 날짜의 반복 규칙을 실행한다.
(이 시스템이 7일 뒤까지만 예약을 받으므로, 예약 창이 열리는 순간 잡는 구조다.)

**관리자 권한 PowerShell**:

```powershell
$action = New-ScheduledTaskAction -Execute "cmd.exe" `
  -Argument "/c npm run job:recurring >> .job.log 2>&1" `
  -WorkingDirectory "C:\cjfw-vbcd\backend"

$trigger = New-ScheduledTaskTrigger -Daily -At "00:01"

# StartWhenAvailable: 그 시각에 노트북이 꺼져 있었다면, 켜진 직후 놓친 실행을 따라잡는다.
# 이게 없으면 하루치 예약이 통째로 사라진다 (2026-08-19에 실제로 발생).
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable

Register-ScheduledTask -TaskName "cjfw-recurring-booking" `
  -Action $action -Trigger $trigger -Settings $settings -Force
```

수동으로 한 번 돌려서 확인:

```powershell
Start-ScheduledTask -TaskName "cjfw-recurring-booking"
Start-Sleep 60
Get-Content C:\cjfw-vbcd\backend\.job.log -Tail 20
```

---

## 10. 최초 Admin 계정 만들기

DB의 `admin_whitelist` 테이블에 있는 사번으로 가입하면 **자동으로 Admin 승인**된다
(최초 Admin이 없으면 아무도 승인할 수 없는 문제를 푸는 장치). 현재 `jiil`이 등록되어 있다.

1. 브라우저로 `http://<서버IP>:3000` 접속
2. 회원가입 → 사번, 사내 계정 비밀번호, 앱 로그인 비밀번호, 선호 회의실 입력
3. 로그인 → 챗봇 화면이 뜨면 성공

다른 사람을 Admin으로 추가하려면 Supabase에서 `admin_whitelist`에 사번을 넣으면 된다.

---

## 11. 최종 점검 체크리스트

- [ ] 다른 PC 브라우저에서 `http://<서버IP>:3000` 접속됨
- [ ] 로그인 성공 (= 자동 로그인까지 통과했다는 뜻)
- [ ] 챗봇으로 회의실 조회가 됨 (= 연동 정상)
- [ ] 실제 예약 1건 생성 후 사이트에서 확인
- [ ] 노트북 덮개를 닫아도 위 접속이 계속 됨
- [ ] 노트북 재부팅 후 손대지 않아도 서비스가 다시 뜸
- [ ] `Get-ScheduledTaskInfo -TaskName "cjfw-recurring-booking"` 의 `NextRunTime`이 내일 00:01

---

## 12. 운영

**상태 확인**

```powershell
Get-ScheduledTaskInfo -TaskName "cjfw-vbcd-server"
Get-ScheduledTaskInfo -TaskName "cjfw-recurring-booking"   # LastTaskResult가 0이면 정상
curl.exe http://localhost:3000/health
```

`LastTaskResult`가 `2147946720`(=`0x800710E0`)이면 "제약 조건 때문에 실행되지 않음"
— 대개 노트북이 그 시각에 꺼져 있었거나 배터리로 돌고 있었다는 뜻이다.

**재시작**

```powershell
Stop-ScheduledTask -TaskName "cjfw-vbcd-server"
Start-ScheduledTask -TaskName "cjfw-vbcd-server"
```

**코드 업데이트**

```powershell
cd C:\cjfw-vbcd
git pull
cd frontend; npm install; npm run build
cd ..\backend; npm install; npm run build
Stop-ScheduledTask -TaskName "cjfw-vbcd-server"
Start-ScheduledTask -TaskName "cjfw-vbcd-server"
```

> DB 마이그레이션이 포함된 업데이트라면 `supabase/migrations/`의 새 파일을
> Supabase에도 적용해야 한다. Dev(로컬)와 Prd(Supabase)가 분리되어 있으므로
> **양쪽에 모두 적용**하는 것이 원칙이다(`docs/4-prd.md` 참고).

**로그**

- 서버 로그: 작업 스케줄러로 띄우면 콘솔이 없다. 로그가 필요하면 8번의 `-Argument`를
  `"dist\src\app.js >> server.log 2>&1"` 형태로 바꾸되, `cmd.exe /c`로 감싸야 한다.
- 반복 예약 잡 로그: `C:\cjfw-vbcd\backend\.job.log`

---

## 13. 알아둘 한계

- **HTTPS가 아니다.** 사내망 안에서만 쓰는 전제다. 브라우저의 "보안 컨텍스트" 전용
  API(`crypto.randomUUID` 등)는 HTTP에서 동작하지 않으므로 코드에서 쓰지 않는다
  (2026-08-19에 실제로 이 문제로 채팅 전송이 막힌 적이 있다).
- **노트북이 꺼지면 서비스도 멈춘다.** DB는 Supabase라 데이터는 안전하지만,
  조회·예약은 노트북이 살아 있어야 가능하다.
- **Supabase 무료 플랜은 7일간 요청이 없으면 프로젝트를 일시정지시킨다.** 노트북이
  상시 가동되면 스케줄러가 매일 DB를 건드리므로 문제없지만, 장기 연휴로 노트북을
  오래 꺼둔다면 복귀 후 Supabase 대시보드에서 복구가 필요할 수 있다.
- **자동 백업이 없다**(무료 플랜). 실사용 데이터가 쌓이면 정기 `pg_dump`를 검토할 것.
