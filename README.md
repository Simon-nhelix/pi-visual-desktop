# pi-visual-desktop · 0.1.0

Pi의 **현재 비전 모델이 화면을 보고 다음 동작을 고르는**, 작은 로컬 데스크톱 패키지입니다. 기존 computer-use 플러그인/Cua Driver를 사용하지 않습니다. 서버·VPS·별도 LLM·AX/DOM/OCR 탐색·앱별 단축키 전략·백그라운드 입력 우회가 없습니다.

**macOS 14+ 전용, Node 24+, Xcode Command Line Tools 필요.** 개발 검증은 macOS arm64 / Swift 6.3.3 / Node 24.13.0 / Pi 0.85.1에서 수행했습니다. Intel 및 실제 GUI 동작은 아직 수동 검증하지 않았습니다. 회사 PC의 OS는 미확인입니다. Windows/Linux에서는 사용할 수 없습니다.

## 먼저 독립적으로 시험하기

기존 도구와 새 도구를 섞지 않고, 전역 설정을 바꾸지 않는 시험 실행입니다:

```sh
cd ~/Projects/pi-visual-desktop
npm ci --ignore-scripts
npm run setup
npm run health
pi --no-extensions -e ./src/index.ts --tools desktop_observe,desktop_act
```

이 실행에서는 다른 확장(기존 computer-use 및 확장 제공 모델 포함)을 로드하지 않습니다. 사용 가능한 비전 모델을 선택한 뒤 `/desktop on`으로 동의하고, 민감 정보 없는 임시 문서에서 아래 수동 체크리스트를 수행하세요. 종료하면 기존 Pi 설정은 그대로입니다. 실제 사용으로 전환할 때도 기존 computer-use와 동시에 활성화하지 말고 사용자가 `pi config`에서 선택하세요.

## 설치와 권한 (사용자가 직접)

개발 체크아웃에서:

```sh
npm ci --ignore-scripts
npm run setup           # Swift helper만 빌드; 화면 캡처/입력 없음
npm run health          # 권한 상태만 확인; 요청 팝업/설정 변경 없음
pi install "$PWD"       # 로컬 경로를 Pi에 등록 (파일 복사 아님)
```

설치 시 자동 빌드는 없습니다. `npm run setup`은 `build/desktop-helper`를 만듭니다. 명령줄 개발 도구가 없으면 사용자가 먼저 설치해야 합니다. Pi 실행 중 helper를 다시 빌드하지 마세요.

시스템 설정 → 개인정보 보호 및 보안에서 **화면 기록(Screen Recording / Screen & System Audio Recording)**과 **손쉬운 사용(Accessibility)**을 로컬 터미널/실행 helper에 허용하고 Pi를 재시작하세요. macOS 버전에 따라 표시 대상/이름이 다릅니다. `health`의 두 권한이 `true`인지 확인하세요. 이 패키지는 권한을 요청하거나 우회하지 않습니다. Secure Input이 켜져 있으면 입력을 거부합니다. 암호 입력 등 해당 기능을 사용자가 종료한 뒤 다시 확인하세요. 권한이 있어도 MDM/보호된 콘텐츠/앱 정책에 의해 실제 동작은 제한될 수 있습니다.

## 사용

로컬 Pi TUI에서 비전 모델을 선택하고:

- `/desktop on` → 표준 확인 창에 사용자가 동의해야 활성화됩니다. RPC/print/JSON 실행에서는 활성화할 수 없습니다.
- `/desktop off` → 진행 중 동작 취소, ref 폐기, helper 종료 및 잠금 해제.
- `/desktop status` → 패키지 버전, Git revision 및 clean/dirty, 활성화 상태. 캡처하지 않습니다.
- 재시작·새 세션·세션 전환·fork·reload 후에는 다시 동의해야 합니다. 동의 상태를 디스크에 복원하지 않습니다.

**같은 데스크톱을 사람이 동시에 조작하지 마세요.** 실제 전경 화면에 입력됩니다. 다른 앱을 자동 활성화하거나 실패한 입력을 다른 방식으로 재시도하지 않습니다.

도구는 두 개뿐입니다:

| 도구 | 의미 |
|---|---|
| `desktop_observe {}` | 주 디스플레이 전체 PNG + timestamp, width/height, opaque ref |
| `desktop_act` | 최신 ref로 원시 동작 하나 → 250ms settle → 후속 PNG와 새 ref |

모든 act는 `ref`, `action` 및 **해당 동작에 필요한 필드만** 전달합니다:

| action | 추가 필드 |
|---|---|
| `click`, `double_click`, `right_click` | `x`, `y` |
| `drag` | `x`, `y`, `toX`, `toY` (고정 약 300ms, 왼쪽 버튼) |
| `scroll` | `x`, `y`, `dx`, `dy` (정수 픽셀, 양수=오른쪽/아래, 각 -1000…1000, 둘 다 0 불가) |
| `type` | `text` (1…2048 UTF-16 단위의 올바른 Unicode 문자열; 클립보드 미사용) |
| `key` | `key`, `modifiers` (빈 배열도 명시) |

`key`는 물리 키 이름입니다: `a`…`z`, `0`…`9`, `return`, `tab`, `escape`, `backspace`, `delete`(앞 삭제), `left/right/up/down`, `home/end`, `page_up/page_down`, `space`, `f1`…`f12`, `minus/equal/left_bracket/right_bracket/backslash/semicolon/quote/comma/period/slash/grave`.
`modifiers`는 중복 없는 `command`, `shift`, `option`, `control` 배열입니다. 숫자 OS keycode는 노출하지 않습니다. 물리 키는 ANSI 위치 기준이므로 키보드 레이아웃/앱에 따라 결과가 다릅니다. **문자열 자체는 `type`을 사용하세요.** 키 누름/해제는 한 호출 안에서 끝납니다. 자동 전체선택·붙여넣기·앱별 레시피는 없습니다.

예: 최신 ref로 `{"ref":"…","action":"key","key":"return","modifiers":[]}`. 동작 성공을 가정하지 말고 반환 화면을 확인하세요.

### 좌표 규약 — 표시된 이미지의 정수 픽셀만

- 화면 일부가 아닌 **주 디스플레이 전체**를 ScreenCaptureKit으로 캡처합니다. 커서를 포함하며 창/앱을 제외하지 않습니다.
- Quartz 표시 방향/종횡비를 기준으로 긴 변을 최대 **1280픽셀**로 명시적으로 리사이즈합니다. 각 변을 내림한 뒤 전체 화면을 그 정수 크기에 축별로 맞춥니다(`preservesAspectRatio=false`, 여백 없음). 실제 PNG 크기와 메타데이터 일치를 검사합니다.
- 정확히 반환된 PNG에서 왼쪽 위 픽셀은 `(0,0)`, 오른쪽 아래는 `(width-1,height-1)`입니다. `x`는 오른쪽, `y`는 아래로 증가합니다. 정규화 좌표·원본 Retina 픽셀·다른 화면의 좌표는 받지 않습니다.
- 픽셀 **중심**을 Quartz 전역 포인트로 변환합니다:
  `X = bounds.x + (x + 0.5) * bounds.width / image.width`,
  `Y = bounds.y + (y + 0.5) * bounds.height / image.height`.
  Retina 배율/회전/원점 처리는 코드가 맡습니다. 모델이 배율을 계산하지 않습니다.

ref는 캡처 시작 시각부터 **120초**, 최신 한 장만 유효하며 한 번만 사용할 수 있습니다. 추론 지연을 허용하되 오래된 화면을 무기한 쓰지 않기 위한 상한입니다. 새 observe는 이전 ref를 대체합니다. 다른 세션의 ref, 사용한 ref, 만료된 ref, NaN/무한대/범위 밖 좌표는 거부합니다.

입력 직전에 주 디스플레이 ID·bounds·물리 해상도·회전, 전경 앱 PID·bundle·실행 시각, 권한·Secure Input·눌린 키/버튼을 재검사합니다. 캡처 중 geometry/전경이 바뀌어도 이미지를 폐기합니다. 같은 앱 내부의 창/내용 변화나 검사 직후의 외부 입력까지 원자적으로 막지는 못합니다. 오래 생각했거나 화면이 바뀌었다면 먼저 다시 observe하세요.

### 실패와 로컬 잠금

- 한 세션의 호출을 직렬화합니다. helper는 UID별 `/tmp/pi-visual-desktop-UID.lock`의 커널 `flock`을 활성 세션 동안 보유합니다. 다른 체크아웃/Pi 세션은 즉시 거부됩니다. 대기 큐 서비스·PID 재사용 추정·강제 잠금 탈취가 없습니다.
- 잠금 파일은 0600, 소유자/일반 파일 확인, symlink 거부. inode는 삭제하지 않습니다. 정상 종료/프로세스 종료 시 커널이 잠금을 풀며 빈 파일만 남습니다. 다른 활성 세션에서 `/desktop off` 하세요. **잠금 파일을 삭제하여 우회하지 마세요.**
- helper는 고정 JSON 작업만 읽고 실행 파일/셸/네트워크 요청을 받지 않습니다. stdin 한 줄 ≤32KiB, 응답 ≤10.5MB, 요청 10초 제한. 취소/시간초과 시 SIGTERM 후 최대 2초 정리 시간을 주고 종료를 기다립니다.
- 정상 취소는 이벤트 사이에서 감지하고 미리 준비한 key-up/button-up을 역순으로 보냅니다. 버튼/키를 잡은 상태에서 캡처를 기다리지 않습니다. OS 강제 종료(SIGKILL)·프로세스 크래시·하드웨어 실패까지 정리를 보장하지는 못합니다.
- `dispatched:true`, `verified:false`는 **입력을 보냈다는 뜻이지 작업 성공이 아닙니다**. 픽셀 변화도 성공 증거가 아닙니다.
- 전송 후 타임아웃/취소/캡처 실패는 **outcome unknown**, 재시도 없음, 데스크톱 제어 해제입니다. 부분 입력일 수 있으므로 사용자가 직접 확인한 뒤 `/desktop on`과 새 observe가 필요합니다. 입력 전 검사 거부도 해당 ref를 소비합니다.

이 동의/잠금은 이 패키지의 정상 사용을 위한 장치이지 같은 사용자 권한의 악성 코드나 다른 Pi 셸 도구를 격리하는 샌드박스가 아닙니다. 신뢰하는 확장만 사용하세요.

### 개인정보

별도 서비스·텔레메트리·자격증명·스크린 업로드 경로가 없습니다. PNG는 메모리/로컬 파이프에서 Pi **실제 image content block**으로 전달하며 helper 로그나 별도 캡처 파일에 남기지 않습니다. 컨트롤러는 최신 ref 메타데이터만 보관합니다.

**Pi의 정상 모델 전송 및 세션 저장에는 스크린샷과 도구 입력 텍스트가 포함될 수 있습니다.** 민감 화면을 닫고 사용하세요. Pi 세션/모델 제공자의 보관 정책은 이 패키지가 삭제하거나 변경하지 않습니다. 로컬 권한·설정·스크린샷·빌드 결과는 Git으로 옮기지 않습니다.

## 집 / 회사: 같은 Git 저장소, 각자의 로컬 데스크톱

두 컴퓨터에서 각각 OS를 확인하세요(`sw_vers`; macOS가 아니면 중단). 저장소 생성/게시와 아래 설치 명령은 소유자가 직접 수행합니다.

각 Mac의 **개발 체크아웃**에서 최초 한 번:

```sh
git clone <repository-url> ~/Projects/pi-visual-desktop
cd ~/Projects/pi-visual-desktop
git switch main
git pull --ff-only
npm ci --ignore-scripts
npm run setup
pi install "$PWD"
```

집에서도 회사에서도 작업 전: Pi 제어를 끄고 종료 → `git status`로 미완료 작업 확인 → `git pull --ff-only` → `npm ci --ignore-scripts` → `npm run setup`. 충돌/dirty 작업은 사람이 해결합니다. 세션 중 자동 pull/reset/stash는 하지 않습니다.

작업 후: `npm run check && npm test && npm run setup && npm run test:native` → diff 확인 → 필요한 코드만 `git add <files>` → `git commit` → `git push`. 다른 Mac에서는 다시 `git pull --ff-only`. 코드는 Git으로 공유하지만 화면 제어와 권한은 항상 각 Mac에 남습니다.

**Pi 관리 Git 캐시(`~/.pi/agent/git/...`)를 개발 작업 공간으로 편집하지 마세요.** Pi 갱신은 그 캐시를 reset/clean할 수 있습니다. 안정 사용자는 별도 체크아웃에서 게시된 태그(예: `v0.1.0`, 아직 게시하지 않았다면 사용 불가)를 pin하고 명시적으로 빌드한 뒤 로컬 경로로 설치할 수 있습니다. Pi의 `git:…@tag` pin도 가능하지만 캐시에서는 소스 수정 없이 명시적 빌드만 해야 합니다. 업데이트는 제어 세션을 종료한 뒤 사용자가 수행합니다.

## 검증 / 수동 인수 체크리스트

```sh
npm run check          # 실제 Pi 타입으로 TypeScript 검사
npm test               # mock controller/pipe helper + 실제 Pi tool wrapper, GUI 없음
npm run setup          # Swift 컴파일
npm run test:native    # 순수 이벤트/좌표/preflight + build/ 내 임시 flock 테스트, 정리됨
npm run health         # 비프롬프팅 권한 상태만 조회
```

자동 테스트는 좌표/Retina/회전, schema·named key 매핑, ref TTL/외부·소비, 세션 opt-in/reset, 직렬화, 잠금 충돌/해제/symlink, 이벤트 중단 시 release, 프로세스 timeout/crash/abort/출력 제한, Pi 이미지 전달/throw 오류를 검사합니다. CI도 캡처/입력을 실행하지 않습니다. **컴파일과 mock 통과는 실제 GUI 검증이 아닙니다.**

아래는 소유자가 민감 정보 없는 임시 문서/스크래치 앱에서 수행할 항목이며 **현재 전부 NOT RUN**입니다:

- [ ] macOS 14+ 각 Mac: 거부된 권한 안내, 수동 허용/재시작, on 동의 취소·승인·off.
- [ ] 전체 화면과 커서, Retina/비-Retina 및 회전/해상도 변경 후 PNG 좌표 네 모서리/중앙 일치.
- [ ] 클릭/더블클릭/우클릭·양축 스크롤·드래그 후 이미지. 부작용/앱별 수신 차이 기록.
- [ ] `한글 😀 é` 리터럴 입력, 클립보드 내용 불변, return/tab/화살표와 사용자가 명시한 modifier 조합.
- [ ] 다른 앱으로 전환/해상도 변경/120초 경과/동일 ref 재사용 시 입력 거부.
- [ ] 두 Pi 세션에서 동시 on 거부, 정상 off 후 다른 세션 활성화.
- [ ] 드래그/키 중 Esc 또는 off: 눌림 잔류 없음, 부분 입력은 unknown이며 자동 재시도 없음.
- [ ] 화면 기록 권한 회수/실패 시 unknown 처리, 사용자가 확인하기 전 재입력 없음.
- [ ] 실제 비전 모델에 image block 전달, screenshot 이후에만 다음 동작 결정, 성공 주장과 dispatch 구분.
