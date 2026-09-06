# 내일: 0.2.0 수동 인수 (GUI 조작은 아직 NOT RUN)

**사용자/부모만 실행.** 민감 창을 닫고 다른 desktop 제어 세션을 끕니다. Secure Input을 우회하거나 테스트 중 권한을 바꾸지 않습니다. 구현 당시 부모 관측: Screen Recording/Accessibility=true, Secure Input=true. 보호 입력을 사용자가 정상 종료하기 전에는 제어 시험을 중단합니다.

## 준비 (각 Mac)

1. Pi/desktop helper 종료 후 개발 체크아웃에서 `git status`, `git pull --ff-only` (dirty/충돌은 직접 해결). 자동 reset/stash 금지.
2. `npm ci --ignore-scripts && npm run check && npm test && npm run setup && npm run test:native && npm run build:fixture` — 빌드/무입력 테스트만.
3. 사용자 직접 `npm run health`: 두 권한=true, secureInput=false 확인. false/true가 다르면 중단하고 안내를 따릅니다. fixture를 실행해도 Secure Input이 해제되지는 않습니다.
4. 사용자 직접 `open build/DesktopScratch.app`. **빌드 스크립트는 앱을 자동 실행하지 않습니다.** 창이 주 디스플레이에 맞는지 확인. 작은 화면이면 패널이 잘리는지 기록하고 중단합니다.
5. 로컬 Pi: `pi --no-extensions -e ./src/index.ts --tools desktop_observe,desktop_act`. 비전 모델 선택 → `/desktop on` 확인 (기존 사용자 autoEnable=true면 시작 health만 자동 수행) → `/desktop status`에서 0.2.0/revision/on 기록. 전역 설정 변경 필요 없음.
6. 사람이 fixture를 앞에 놓은 뒤 손을 떼고 모델에 관찰을 요청합니다. 도구는 앱을 활성화하지 않습니다. 시험 중 사람과 모델이 동시에 조작하지 않습니다.

## 도구 호출 규칙

- 전체: `desktop_observe {}`. 대기만: `desktop_observe {"waitMs":500}`.
- 새 확대: `desktop_observe {"zoom":{"ref":"방금 ref","x":선택왼쪽,"y":선택위,"width":픽셀폭,"height":픽셀높이}}`. 모두 최신 이미지 정수 픽셀; 전체 선택이 이미지 안에 있어야 함. waitMs 0..2000 함께 사용 가능.
- hover: `desktop_act {"ref":"방금 ref","action":"move","x":픽셀,"y":픽셀}`. 버튼 필드 없음.
- 나머지 act: README 표. 최신 **반환 이미지** 좌표만 사용. 모든 act 후 **전체 화면**으로 돌아오므로 다음 좌표를 새로 읽습니다.
- dispatch는 성공이 아닙니다. 아래 카운터/텍스트/색을 실제 이미지에서 확인해야 성공으로 기록합니다. unknown이면 즉시 중단, 자동 입력 재시도 금지. 사람이 직접 상태를 확인한 후에만 재활성화합니다.

부모가 별도 승인된 로컬 harness를 사용하는 경우에도 동일 경로는 `DesktopController.observe(params = {}, signal?)`, `DesktopController.act(params, signal?)`입니다. `observe(signal)`은 더 이상 지원하지 않습니다. helper wire는 `{"op":"observe","zoom":{...}}`; waitMs는 controller가 대기 후 제거합니다. 직접 helper wire 호출로 Pi 동의 경로를 대신하지 마세요.

## 이번 검증 결과

- 부모 재실행: TypeScript, Node 48/48, Swift helper/native self-test, fixture 컴파일, 패키징 dry-run 통과. 독립 코드 리뷰 통과.
- 실제 Pi PTY 시작: Secure Input 원인 경고 → autoEnable=true여도 status=off 유지 → 정상 종료 확인. 모델 프롬프트·캡처·입력 0회.
- Secure Input=true가 유지되어 fixture를 열거나 GUI 동작을 실행하지 않았습니다. 아래 조작 항목은 내일 확인할 대상이며, 빌드 성공으로 대체하지 않습니다.

## 기록표

| 항목 | 기대 관찰 | 상태 |
|---|---|---|
| 전체 화면/회전/Retina | PNG ≤1280, view=전체 bounds, 코너/중앙 일치 | NOT RUN |
| 확대 + 중첩 확대 | 새 ref/시간, 더 선명한 글씨(네이티브까지), 확대 안 클릭 위치 일치 | NOT RUN |
| `{}` / act 후 방향 복귀 | 전체 화면 view, 옛 확대 ref 재사용 거부 | NOT RUN |
| move로 MOUSE PAD 진입/이탈 | hover ON/녹색 ↔ OFF/파랑; 카운터는 불변 | NOT RUN |
| click / double_click / right_click | Left +1 / Double +1 / Right +1. 더블클릭 첫 down은 Left도 +1 | NOT RUN |
| 문자/물리 키 | 편집칸 클릭 후 `한글 😀 é`, return/tab/화살표. 텍스트 눈으로 확인 | NOT RUN |
| 양축 scroll | 행 번호와 오른쪽 marker의 이동 확인 | NOT RUN |
| drag | 슬라이더 손잡이를 드래그해 숫자 변경 확인 | NOT RUN |
| waitMs | 명시 500ms 관찰, 2000ms 대기 중 Esc/off 시 입력 없이 off | NOT RUN |
| stale/geometry preflight | 120초/소비/외부 ref 거부, 사람이 앱 전환/해상도 변경 후 기존 ref 거부 | NOT RUN |
| Secure Input 진단 | 실제 Pi에서 원인 경고, autoEnable=true여도 off 유지, 불필요한 권한 변경 안내 없음 | PASS (PTY; 캡처/입력 없음) |
| lock/consent | 두 번째 Pi on 거부; off 유지 | NOT RUN |
| 취소/unknown | 드래그 취소 후 잔류 누름 없음, 부분 입력은 unknown, 재시도 없음 | NOT RUN |

각 결과에 Mac/OS/scale/회전, 버전/revision, 기대값/실제값/오류를 **텍스트**로 기록하세요. 이미지는 Git에 넣지 말고 로컬 임시 파일이 있다면 시험 종료 후 삭제합니다. fixture는 메모리만 사용하고 copy/cut/paste와 외부 drop을 거부합니다. 클립보드 확인을 위해 도구로 읽거나 수정하지 않습니다. 피처가 앱별로 다르게 수신되면 있는 그대로 기록합니다.

종료: `/desktop off` → `/quit` → fixture 창 닫기 또는 Quit Scratch (Cmd+Q). helper를 켠 채 다시 빌드하지 않습니다. 부모가 결과를 검토한 뒤에만 필요한 파일 commit/push/다른 Mac pull을 진행합니다.
