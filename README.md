# pi-visual-desktop · 0.2.0

Pi의 **현재 비전 모델이 화면을 보고 다음 동작을 고르는**, 작은 로컬 데스크톱 패키지입니다. 기존 computer-use 플러그인/Cua Driver를 사용하지 않습니다. 서버·VPS·별도 LLM·AX/DOM/OCR 탐색·앱별 단축키 전략·백그라운드 입력 우회가 없습니다.

**macOS 14+ 전용, Node 24+, Xcode Command Line Tools 필요.** 개발 검증은 macOS arm64 / Swift 6.3.3 / Node 24.13.0 / Pi 0.85.1에서 수행했습니다. Intel 및 포괄적인 GUI 동작은 아직 수동 검증하지 않았으며, arm64에서 Aside 새 탭 클릭 1회는 확인했습니다. 회사 PC의 OS는 미확인입니다. Windows/Linux에서는 사용할 수 없습니다.

## 한 번 허용하면 다음부터 바로 사용

설치와 macOS 권한 설정을 마친 뒤, 로컬 Pi에서 **`/desktop on`을 한 번 승인**하세요. 이후 Pi 시작·재시작·`/reload` 시 동의를 기억하고 자동 활성화합니다. 사용자 JSON을 직접 편집하거나 매 세션 다시 켤 필요가 없습니다.

| 하고 싶은 일 | 명령 |
|---|---|
| 최초 승인 / 일시 중지 후 재개 | `/desktop on` |
| 이번 세션에서만 중지 (동의 유지) | `/desktop off` |
| 앞으로의 자동 활성화까지 끄기 | `/desktop forget` |
| 현재 상태·차단 원인·버전 확인 | `/desktop status` |

권한 부족·Secure Input·다른 세션의 잠금은 시작할 때 안내합니다. 자동 활성화 자체는 화면을 캡처하거나 입력하지 않습니다. 자세한 설명은 아래 **사용** 항목을 참고하세요.

## 먼저 독립적으로 시험하기

기존 도구와 새 도구를 섞지 않고, 전역 **패키지 등록**을 바꾸지 않는 시험 실행입니다. 단, `/desktop on` 승인 시 제어 동의는 사용자 설정에 기억됩니다:

```sh
cd ~/Projects/pi-visual-desktop
npm ci --ignore-scripts
npm run setup
npm run health
pi --no-extensions -e ./src/index.ts --tools desktop_observe,desktop_act
```

이 실행에서는 다른 확장(기존 computer-use 및 확장 제공 모델 포함)을 로드하지 않습니다. 사용 가능한 비전 모델을 선택한 뒤, 자동 활성화를 설정하지 않았다면 `/desktop on`으로 동의하고 민감 정보 없는 임시 문서에서 아래 수동 체크리스트를 수행하세요. 종료해도 제어 동의는 기억됩니다. 시험 후 철회하려면 종료 전에 `/desktop forget`을 사용하세요. 다른 Pi 설정/패키지 등록은 바꾸지 않습니다. 실제 사용으로 전환할 때도 기존 computer-use와 동시에 활성화하지 말고 사용자가 `pi config`에서 선택하세요.

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

- `/desktop on` → **최초 한 번** 표준 확인 창에서 이 Mac의 앞으로의 로컬 Pi 세션에도 제어를 허용한다는 설명에 동의합니다. 사용자 설정에 동의를 저장하고, 이후에는 다시 묻지 않습니다. RPC/print/JSON 실행에서는 활성화하거나 동의를 저장할 수 없습니다.
- `/desktop off` → **현재 세션 일시 중지**. 진행 중 동작 취소, ref 폐기, helper 종료 및 잠금 해제. 같은 세션에서 자동으로 다시 켜지지 않습니다. 동의는 기억하며 `/desktop on`으로 재개할 때 다시 승인하지 않습니다.
- `/desktop forget` → 즉시 중지하고 **저장된 동의를 철회**합니다(`autoEnable:false`). 다음 시작도 꺼진 상태입니다. 다시 쓰려면 `/desktop on`에서 승인합니다.
- `/desktop status` → 패키지 버전, Git revision 및 clean/dirty, 활성화 상태와 마지막으로 읽거나 저장한 `autoEnable`, 차단 원인. 캡처하지 않습니다.
- 재시작·새 세션·세션 전환·fork·reload에서는 이전 ref/실행 상태를 폐기하고, 기억된 동의가 있으면 권한·Secure Input·잠금을 확인한 뒤 자동 활성화합니다. 설정을 외부에서 바꾼 경우 다음 시작 또는 `/desktop on`에서 다시 읽습니다.

### 최초 동의를 기억하고 시작할 때 확인

이제 **`/desktop on` 승인 자체가 자동 활성화 설정을 저장**합니다. JSON을 직접 편집할 필요가 없습니다. 초기 설치/동의 철회 상태에서는 시작 시 한 번 승인하라는 안내를 표시하고, 승인 팝업을 임의로 띄우지는 않습니다. 이후 시작에서는 권한·Secure Input·잠금 문제를 작업 전에 알립니다. 하단 상태는 `desktop: on`, `desktop: off`, 또는 비전 모델이 아닌 경우 `desktop: vision model required`로 표시됩니다. 상태는 명령/모델 전환/도구 결과 시 갱신하며 백그라운드 폴링하지 않습니다.

저장 대상은 **사용자 전역 설정** `~/.pi/agent/settings.json`의 아래 키입니다. 기존에 직접 설정한 `true`도 그대로 인정합니다. 수동 편집 시 파일 전체를 아래 내용으로 덮어쓰면 안 됩니다.

```json
{
  "pi-visual-desktop": {
    "autoEnable": true
  }
}
```

`PI_CODING_AGENT_DIR`를 별도로 쓰면 그 디렉터리의 `settings.json`을 읽고 씁니다. 프로젝트 `.pi/settings.json`은 동의의 근거도 저장 대상도 아닙니다. 정확한 JSON boolean `true`만 동의로 인정하며, **최초 승인 전에는 꺼져 있습니다**. 회사 Mac에서도 처음 한 번 승인하세요. 개인 설정은 저장소에 커밋하지 않습니다.

저장은 Pi와 같은 설정 잠금을 사용하며, 다른 키와 확장의 하위 설정을 보존해 0600 임시 파일을 원자적으로 교체합니다. 잠금 충돌·잘못된 JSON/객체·symlink 대상은 덮어쓰지 않습니다. 저장 실패 시 **기억되지 않았다는 경고와 함께 승인한 현재 세션만 사용**할 수 있습니다. `/desktop on`으로 저장을 다시 시도할 수 있습니다. `/desktop forget`의 저장이 실패해도 현재 제어는 중지되지만 다음 시작 동의는 남아 있을 수 있으므로, 안내대로 설정을 수정한 뒤 재시작하세요.

승인 기록은 권한/잠금 검사보다 먼저 저장하므로, Secure Input이나 일시적인 잠금 때문에 활성화가 실패해도 동의를 다시 묻지 않습니다. 안전 차단을 자동으로 재시도하거나 우회하지는 않습니다.

이 설정은 **이후 로컬 Pi TUI 세션에서 화면 제어를 허용한다는 지속적 사용자 동의**입니다. 시작 시 helper의 권한·잠금 상태만 확인하고 안내를 표시하며, 스크린샷이나 입력을 자동 실행하지는 않습니다. 실제 관찰·입력에는 여전히 비전 모델과 도구 호출이 필요합니다. 권한 부족, Secure Input, 다른 세션의 잠금, 잘못된 설정 등은 경고 후 꺼진 상태로 남기며 자동 재시도하지 않습니다. 여러 Pi를 켜면 먼저 활성화한 세션이 데스크톱을 점유하므로 사용하지 않는 세션에서 `/desktop off` 하세요.

현재 세션만 끄려면 `/desktop off`, 이후 자동 활성화도 끄려면 `/desktop forget`을 쓰세요. 이 명령은 현재 세션과 앞으로 시작하는 세션에 적용되며 다른 실행 중인 Pi 프로세스를 원격 중지하지는 않습니다. 자동 활성화는 화면 제어 동의만 변경하며, 자동 코드 업데이트나 OS 권한 우회는 하지 않습니다.

**같은 데스크톱을 사람이 동시에 조작하지 마세요.** 실제 전경 화면에 입력됩니다. 다른 앱을 자동 활성화하거나 실패한 입력을 다른 방식으로 재시도하지 않습니다.

도구는 두 개뿐입니다:

| 도구 | 의미 |
|---|---|
| `desktop_observe {}` | 주 디스플레이 전체 PNG + timestamp, width/height, view, opaque ref |
| `desktop_observe {zoom:{ref,x,y,width,height}, waitMs?}` | 최신 이미지의 영역을 **새로 고해상도 캡처** (중첩 가능), 선택적 명시 대기 |
| `desktop_act` | 최신 ref로 원시 동작 하나 → 250ms settle → **전체 화면** PNG와 새 ref |

모든 act는 `ref`, `action` 및 **해당 동작에 필요한 필드만** 전달합니다:

| action | 추가 필드 |
|---|---|
| `move` | `x`, `y` (버튼 없이 mouseMoved 이벤트 1회, hover 가능) |
| `click`, `double_click`, `right_click` | `x`, `y` |
| `drag` | `x`, `y`, `toX`, `toY` (고정 약 300ms, 왼쪽 버튼) |
| `scroll` | `x`, `y`, `dx`, `dy` (정수 픽셀, 양수=오른쪽/아래, 각 -1000…1000, 둘 다 0 불가) |
| `type` | `text` (1…2048 UTF-16 단위의 올바른 Unicode 문자열; 클립보드 미사용) |
| `key` | `key`, `modifiers` (빈 배열도 명시) |

`key`는 물리 키 이름입니다: `a`…`z`, `0`…`9`, `return`, `tab`, `escape`, `backspace`, `delete`(앞 삭제), `left/right/up/down`, `home/end`, `page_up/page_down`, `space`, `f1`…`f12`, `minus/equal/left_bracket/right_bracket/backslash/semicolon/quote/comma/period/slash/grave`.
`modifiers`는 중복 없는 `command`, `shift`, `option`, `control` 배열입니다. 숫자 OS keycode는 노출하지 않습니다. 물리 키는 ANSI 위치 기준이므로 키보드 레이아웃/앱에 따라 결과가 다릅니다. **문자열 자체는 `type`을 사용하세요.** 키 누름/해제는 한 호출 안에서 끝납니다. 자동 전체선택·붙여넣기·앱별 레시피는 없습니다.

예: 최신 ref로 `{"ref":"…","action":"key","key":"return","modifiers":[]}`. 동작 성공을 가정하지 말고 반환 화면을 확인하세요.

### 좌표 규약 — 표시된 이미지의 정수 픽셀만

- 기본은 **주 디스플레이 전체**, zoom을 명시하면 선택 영역을 ScreenCaptureKit으로 새로 캡처합니다. 커서를 포함하며 창/앱을 제외하지 않습니다. 확대된 옛 PNG를 만들지 않습니다.
- Quartz 표시 방향/종횡비를 기준으로 긴 변을 최대 **1280픽셀**로 명시적으로 리사이즈합니다. 네이티브 해상도를 넘지 않으며 각 변을 내림한 뒤 캡처 영역을 그 정수 크기에 축별로 맞춥니다(`preservesAspectRatio=false`, 여백 없음). 실제 PNG 크기와 메타데이터 일치를 검사합니다.
- 정확히 반환된 PNG에서 왼쪽 위 픽셀은 `(0,0)`, 오른쪽 아래는 `(width-1,height-1)`입니다. `x`는 오른쪽, `y`는 아래로 증가합니다. 정규화 좌표·원본 Retina 픽셀·다른 화면의 좌표는 받지 않습니다.
- 픽셀 **중심**을 Quartz 전역 포인트로 변환합니다:
  `X = geometry.x + view.x + (x + 0.5) * view.width / image.width`,
  `Y = geometry.y + view.y + (y + 0.5) * view.height / image.height`.
  `geometry`는 항상 전체 디스플레이/전경 정보이고 `view`는 디스플레이 로컬 논리 포인트의 캡처 사각형입니다. 전체 화면의 view는 `{x:0,y:0,width:geometry.width,height:geometry.height}`입니다.
  Retina 배율/회전/원점 처리는 코드가 맡습니다. 모델이 배율을 계산하지 않습니다.

### 확대 관찰 / hover / 명시 대기

`desktop_observe {"zoom":{"ref":"최신 ref","x":100,"y":80,"width":300,"height":200}}`처럼 **최신 반환 이미지의 정수 픽셀**로 영역을 선택합니다. 이 예의 숫자는 설명용이며 실제 화면을 보고 정해야 합니다. x/y는 선택의 왼쪽 위 **픽셀 경계**, width/height는 양의 픽셀 개수입니다. 선택 전체가 이미지 안에 있어야 합니다. 코드가 `view.x + x*view.width/image.width` 등으로 논리 포인트 영역을 계산하고, ScreenCaptureKit `sourceRect`에 전달합니다(Apple SDK SCStream.h: display logical points). 실제 desktop의 새 PNG를 얻으므로 작은 글씨를 더 자세히 볼 수 있지만 이미 네이티브 크기면 추가 세부 정보는 늘지 않습니다.

확대 결과의 좌표로 바로 act할 수 있고, 같은 규칙으로 중첩 확대할 수도 있습니다. 모델은 원본 배율을 계산하지 않습니다. 확대 요청도 원본 ref의 정확한 identity/120초 TTL/전체 geometry·전경을 검사합니다(캡처 완료까지 만료되면 거부). 오래된 ref에 새 수명을 주지 않습니다. `{}`는 전체 화면으로 돌아가며 **모든 act의 후속 이미지는 전체 화면**입니다. 이전 확대 좌표를 그 이미지에 재사용하지 마세요.

`desktop_act {"ref":"최신 ref","action":"move","x":…,"y":…}`는 버튼 없이 커서만 한 번 이동합니다. hover 메뉴가 열리는 등 앱 반응은 가능하며 task success를 보장하지 않습니다. 항상 일반 act와 같은 preflight/취소/후속 전체 화면 규칙을 따릅니다.

관찰에 `waitMs`(정수 0…2000, 기본 0)를 명시하면 캡처 전 그만큼만 기다립니다. 예: `desktop_observe {"waitMs":500}`. 확대와 함께 쓸 수도 있고 대기 시간도 원본 ref TTL에 포함됩니다. Esc/off로 취소할 수 있으며 자동 대기/재시도는 없습니다. 대기 중 취소하면 입력 없이 세션이 꺼집니다. 입력 후 고정 250ms settle은 변경하지 않았습니다.

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
git clone git@github.com:Simon-nhelix/pi-visual-desktop.git ~/Projects/pi-visual-desktop
cd ~/Projects/pi-visual-desktop
git switch main
git pull --ff-only
npm ci --ignore-scripts
npm run setup
pi install "$PWD"
```

집에서도 회사에서도 작업 전: Pi 제어를 끄고 종료 → `git status`로 미완료 작업 확인 → `git pull --ff-only` → `npm ci --ignore-scripts` → `npm run setup`. 충돌/dirty 작업은 사람이 해결합니다. 세션 중 자동 pull/reset/stash는 하지 않습니다.

작업 후: `npm run check && npm test && npm run setup && npm run test:native` → diff 확인 → 필요한 코드만 `git add <files>` → `git commit` → `git push`. 다른 Mac에서는 **같은 브랜치**에서 `git pull --ff-only`. 코드는 Git으로 공유하지만 화면 제어와 권한은 항상 각 Mac에 남습니다.

최초 동의 기억 개선을 `main`에 병합하기 전에 시험하려면, Pi를 종료하고 깨끗한 체크아웃에서 다음 작업 브랜치를 사용하세요. 기존 로컬 브랜치가 있으면 `git switch feat/remember-desktop-consent`만 실행합니다.

```sh
git fetch origin
git switch --track origin/feat/remember-desktop-consent
git pull --ff-only
npm ci --ignore-scripts
npm run setup
```

이미 로컬 경로로 설치했다면 `pi install`을 반복할 필요는 없습니다. 새 의존성 설치 후 Pi를 시작하세요. 해당 Mac의 기존 `autoEnable:true`는 유지되며, 처음 쓰는 Mac에서만 `/desktop on` 최초 승인이 필요합니다. 실행 중인 개발 세션에서 **TypeScript만** 바꿨고 의존성/helper가 준비돼 있다면 `/reload`로 반영할 수 있습니다.

### 저장소에 공유하는 파일

제품 코드·테스트·README·공통 수동 인수 문서는 공유합니다. 개인별 에이전트 지침(`AGENTS.md`, `CLAUDE.md`, `GEMINI.md` 등), 도구별 로컬 설정 디렉터리, Superpowers 작업 문서(`docs/superpowers/`)는 로컬에만 보관하며 `.gitignore`로 제외합니다. 공통 개발·안전 규칙은 개인 설정 대신 이 README와 테스트에 반영하세요.

**Pi 관리 Git 캐시(`~/.pi/agent/git/...`)를 개발 작업 공간으로 편집하지 마세요.** Pi 갱신은 그 캐시를 reset/clean할 수 있습니다. 안정 사용자는 별도 체크아웃에서 게시된 태그(예: `v0.1.0`, 아직 게시하지 않았다면 사용 불가)를 pin하고 명시적으로 빌드한 뒤 로컬 경로로 설치할 수 있습니다. Pi의 `git:…@tag` pin도 가능하지만 캐시에서는 소스 수정 없이 명시적 빌드만 해야 합니다. 업데이트는 제어 세션을 종료한 뒤 사용자가 수행합니다.

## 검증 / 수동 인수 체크리스트

```sh
npm run check          # 실제 Pi 타입으로 TypeScript 검사
npm test               # mock controller/pipe helper + 실제 Pi tool wrapper, GUI 없음
npm run setup          # Swift 컴파일
npm run test:native    # 순수 이벤트/좌표/preflight + build/ 내 임시 flock 테스트, 정리됨
npm run health         # 비프롬프팅 권한 상태만 조회
```

자동 테스트는 전체/확대/중첩 좌표와 sourceRect/Retina/회전/소수 반올림, move 이벤트 구성(게시 없음), wait 취소·만료, 정확한 health 원인 안내, schema·named key 매핑, ref TTL/외부·소비, 세션 opt-in/reset, 직렬화, 잠금 충돌/해제/symlink, 이벤트 중단 시 release, 프로세스 timeout/crash/abort/출력 제한, Pi 이미지 전달/throw 오류를 검사합니다. CI도 캡처/입력을 실행하지 않습니다. **컴파일과 mock 통과는 실제 GUI 검증이 아닙니다.**

### 동의 기억 UX 개발 변경 (2026-09-07)

`/desktop on`의 최초 승인 기억, 재시작 자동 활성화, off 재개, forget 철회, 설정 보존/잠금 충돌/손상 거부, 저장 실패, 종료 중 경쟁 조건, 시작 시 차단·비전 모델 안내를 검증했습니다.

| 검증 | 결과 |
|---|---|
| TypeScript 타입 검사 | PASS |
| Node 자동 테스트 (임시 설정 파일 + mock GUI transport) | **63/63 PASS** |
| 기존 native 무입력 self-test | PASS; 캡처/입력 없음 |
| 실제 Pi 0.85.1 확장 로더 | PASS; 도구 2개와 `/desktop` 등록, `session_start` 실행 없음 |
| 패키징 dry-run / 런타임 의존성 확인 | PASS |
| 새 TUI 확인 창·재시작·철회 및 실제 GUI 인수 | **NOT RUN** |

이 변경은 Swift 입력/캡처 구현을 바꾸지 않습니다. 코드 로딩 검증을 전체 TUI/GUI 인수 통과로 간주하지는 않습니다. 새 TypeScript 구현은 `/reload` 또는 Pi 재시작 후 적용됩니다. 패키지 버전은 0.2.0을 유지하며, 개발 변경은 `/desktop status`의 Git revision과 clean/dirty로 구별합니다.

### 0.2.0 수동 검증 상태 (이전 기록)

부모가 독립적으로 TypeScript 검사, **Node 48/48 테스트**, Swift helper/fixture 빌드, 무입력 native self-test와 패키징 dry-run을 다시 통과시켰고 코드 리뷰도 통과했습니다.

실제 Pi 0.85.1을 별도 PTY에서 실행한 결과, 사용자 설정 autoEnable=true여도 **Secure Input을 정확히 원인으로 안내하고 꺼진 상태를 유지**했으며 `/desktop status`에서 off를 확인한 뒤 정상 종료했습니다. 모델 프롬프트·화면 캡처·입력은 0회입니다. 이 결과는 실제 TUI 안전 차단/진단 검증이지 GUI 작업 성공이 아닙니다.

**0.2.0 확대·hover·문자 입력·스크롤·드래그의 실제 동작은 아직 NOT RUN**입니다. 당시 테스트 Mac의 Screen Recording/Accessibility는 true였지만 Secure Input=true가 지속돼 GUI 테스트를 중단했습니다. fixture도 실행하지 않았습니다. 보호 입력을 사용자가 정상 종료한 뒤 아래 체크리스트로 확인하세요. 이전 버전의 클릭 성공 기록은 새 기능의 증거가 아닙니다.

수동 인수 실행 순서와 기록표: [test/manual/README.md](test/manual/README.md). `npm run build:fixture`는 `build/DesktopScratch.app`만 빌드하고 실행하지 않습니다. fixture는 저장/네트워크/클립보드 기능 없이 클릭 카운터·한글/emoji 편집·양축 스크롤·슬라이더 드래그·hover 색을 제공합니다. 창을 닫거나 Quit Scratch로 종료합니다.

### 실제 동작 확인 기록 (이전 버전)

0.1.1에서는 실제 Pi 0.85.1을 별도 PTY에서 실행해, 격리된 사용자 설정 `autoEnable:true`로 **시작 시 실제 native helper 활성화 → `/desktop status`의 on 확인 → `/desktop off` → status의 off 유지 → `/quit` 정상 종료**를 확인했습니다. 모델 프롬프트·화면 캡처·데스크톱 입력은 0회였으며, 이 검증은 실제 TUI 시작/끄기 경로에 한정됩니다.

2026-09-07, 사용자의 명시 요청으로 macOS arm64에서 **Aside 브라우저의 새 탭 열기 1회**를 확인했습니다. 시스템 `open`으로 Aside를 앞에 연 다음, 별도 일회성 테스트 harness에서 이 패키지의 `DesktopController → HelperTransport → native helper`를 그대로 사용했습니다. 주 화면 PNG(1280×720, 논리 화면 2304×1296)를 보고 왼쪽 `새 탭` 버튼을 `(31,436)`에서 한 번 클릭했으며, 후속 PNG에서 `New Tab` 항목과 검색창이 나타남을 확인했습니다. 좌표는 해당 순간의 관측값이지 앱 레시피가 아닙니다. 기존 computer-use 도구, AX/DOM 조회, 단축키, 입력 재시도는 사용하지 않았습니다. 테스트 helper/잠금은 종료했고 임시 화면 파일은 제거했습니다.

**이 결과는 주 화면 캡처와 단일 좌표 클릭의 실제 성공 사례입니다.** Pi에 등록된 도구를 모델이 직접 호출하는 경로, `/desktop on` TUI 확인, 문자 입력·스크롤·드래그, 다른 화면 배율이나 반복 성공률까지 검증한 것은 아닙니다. 아래 포괄적 인수 항목은 여전히 미완료입니다:

- [ ] macOS 14+ 각 Mac: 거부된 권한 안내, 수동 허용/재시작, on 동의 취소·승인·off, autoEnable 시작/실패/끄기.
- [ ] 전체 화면과 커서, Retina/비-Retina 및 회전/해상도 변경 후 PNG 좌표 네 모서리/중앙 일치.
- [ ] 클릭/더블클릭/우클릭·양축 스크롤·드래그 후 이미지. 부작용/앱별 수신 차이 기록.
- [ ] `한글 😀 é` 리터럴 입력, 클립보드 내용 불변, return/tab/화살표와 사용자가 명시한 modifier 조합.
- [ ] 다른 앱으로 전환/해상도 변경/120초 경과/동일 ref 재사용 시 입력 거부.
- [ ] 두 Pi 세션에서 동시 on 거부, 정상 off 후 다른 세션 활성화.
- [ ] 드래그/키 중 Esc 또는 off: 눌림 잔류 없음, 부분 입력은 unknown이며 자동 재시도 없음.
- [ ] 화면 기록 권한 회수/실패 시 unknown 처리, 사용자가 확인하기 전 재입력 없음.
- [ ] 실제 비전 모델에 image block 전달, screenshot 이후에만 다음 동작 결정, 성공 주장과 dispatch 구분.
