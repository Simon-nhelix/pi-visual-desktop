# Agent-led GUI baseline and responsiveness candidate — 2026-09-07

## Scope / evidence

The user explicitly requested real computer-use testing and agent-side friction analysis. The parent agent used the registered `desktop_observe` / `desktop_act` tools in the current local Pi TUI, not a direct-helper bypass. The only input target was the disposable DesktopScratch fixture. No input was retried after an unknown outcome. Screenshots remain in normal Pi tool/session flow, not this repository.

Environment: macOS 26.1 (25B78), arm64; Pi 0.85.1; package 0.2.0. Baseline source `ca3e1fc`, before the candidate changes. Screen Recording/Accessibility=true, Secure Input=false. Main display 1512×982 logical / 3024×1964 native; full PNG 1280×831, rotation 0. Other scales, displays and apps are not covered.

## Actual baseline results

| Scenario | Visible evidence / result |
|---|---|
| Main observation | Full PNG delivered as an actual image block; fixture readable. PASS for this display only. |
| Hover | Entering pad showed ON/green. After clicking elsewhere the immediate image still showed ON; a later observation showed OFF/blue. Works, but immediate feedback lagged. |
| Click / double-click / right-click | Final counters Left=2, Double=1, Right=1. Double-click's first down also increments Left. PASS. |
| Zoom then click | Fresh text-area crop 1280×216; image-space click focused text field. The act result returned to full display. PASS; nested zoom not exercised live. |
| Literal Unicode / Return | `한글 😀 é — agent test` visibly entered, Return created a new line. PASS; clipboard contents were neither read nor independently verified. Other physical keys/layouts remain untested. |
| Drag | Slider changed from 0 to 68; handle moved accordingly. PASS for one drag, not cancellation/repeatability. |
| Vertical / horizontal scroll | Visible row moved from 1 to 17; horizontal movement exposed right-edge markers 17…26. PASS. |
| Foreground transition | A frame's foreground metadata differed from the visible desktop (initially interpreted as lag; see multi-monitor correction below). First observation after fixture launch rejected a foreground change; explicit fresh observation succeeded. Not a reliable transition pass. |
| Quit Scratch (Cmd+Q) | Tool returned **outcome unknown** after input. No repeat or other desktop input followed. Subsequent process inspection found neither Scratch nor desktop-helper. Task success was not claimed from dispatch or process exit alone. |

All action metadata remained `verified:false`. The basic passes above are visual assessments of fixture state, not automatic event-delivery guarantees. There is no measured cross-app success rate or end-to-end model latency baseline.

## Candidate changes and no-input verification

The original native helper blocked its main actor while reading stdin and during post-input settling. A pipe/timer regression test failed with `Main actor blocked: stdin=true, post-input settle=true`. With blocking I/O moved to a worker and settling changed to cancellation-aware async sleep, both actor-liveness cases pass. Only `Data` crosses the worker boundary; JSON parsing and desktop state stay on the actor.

This is a demonstrated scheduler defect and a plausible cause of delayed foreground metadata. **It does not prove that every GUI transition/quit failure is fixed.** Synchronous bounded event posting and release cleanup remain unchanged. No automatic capture/input retry was added.

Other changes:
- Optional action `settleMs` integer 0…2000, default250; same single input request and full screenshot. Helper advertises support; older helper + custom settle is rejected locally before input with an update explanation.
- Short model-facing frame text: current image dimensions/coordinates, full/zoom, app bundle, ref expiry, sent/not-verified state, operation/queue latency. Full geometry remains structured details; real image blocks remain intact.
- `before_agent_start` provides current on/off/blocked status to the model without polling, capture, input, permission requests or enabling control.
- Preflight refusal explicitly says no input was sent and a fresh observation is allowed. Unknown input still disables control and requires manual inspection before reconnecting.

| Check | Candidate result |
|---|---|
| `npm run check` | PASS |
| `npm test` | **71/71 PASS**; mocks/pipes/temp settings, no GUI |
| Separate `build/desktop-helper.candidate --self-test` | PASS; coordinates/events/locks/actor liveness/settle cancellation; no capture/input |
| Real Pi SDK load-only | PASS; two tools + `/desktop`, no session events/tool invocation |
| Updated helper live GUI / model availability context | Initially NOT RUN; bounded post-install results below |
| Install/replace active helper, settings changes, commit/push | Not done by the agent; user subsequently installed/restarted. No commit/push in this acceptance run. |

Candidate was compiled to a separate path so the installed helper was not rebuilt/replaced while Pi was running. After inspecting the desktop, end Pi, run `npm run setup && npm run test:native` in the checkout, then restart. `/reload` alone does not update Swift. Prior persistent consent remains unchanged.

## Post-install live acceptance — 14:56–14:59 KST

User reported installing and restarting Pi. Installed helper mtime 14:55:11 was newer than Swift source; actual `settleMs:800` succeeded. Checkout remained `feat/agent-desktop-feedback`, base `ca3e1fc` with the uncommitted candidate changes. No helper rebuild/replacement or settings change during this run.

- Model received `Desktop available` before any exploratory tool call, without additional enable approval.
- Two separately launched Scratch instances were observed with the correct Scratch bundle. First observations with explicit500 wait took 702ms and 657ms.
- Hover entry by `move` displayed ON. Click-to-text with default250 took508ms but left hover ON; a later observe with500 wait still showed ON. In a separate comparison after moving back into the pad, click with explicit800 took1192ms and also left ON. Explicit `move` outside took479ms and immediately showed OFF. **Do not attribute this to simple settle latency:** evidence points to event/tracking behavior; no hidden move was added to click.
- Literal `한글 😀 é — restart test` visibly received (535ms), slider0→67 (846ms), combined positive x/y scroll exposed right-edge markers12…21 (479ms). These are visual fixture assessments, not automatic success flags.
- **Cmd+Q with explicit800: PASS**, Scratch disappeared in the returned full frame (1170ms). A subsequent observation succeeded (643ms with500 wait), proving control was not disabled.
- **Cmd+Q with default250: PASS** on a newly launched, freshly observed Scratch instance (446ms). This was a second independent lifecycle, not a retry of a failed/unknown input. Scratch again disappeared in the returned image.
- No unknown, failed-input retry, direct helper bypass, or input into the background application occurred. Scratch windows were closed and the user was told testing ended. This is two successful local lifecycle cases, not a measured general success rate.

### Multi-monitor correction / remaining limitation

Read-only display inventory showed **three online, non-mirrored displays**: internal main display logical1512×982 plus two LG4K displays logical1920×1080 each. After Scratch quit, the main-display PNG showed a background app with a dim menu bar while global foreground bundle was iTerm2. Other displays were not captured. Global foreground need not be visible on the main display, so this alone is **not proof of stale NSWorkspace metadata**; which external display held focus was not verified.

The product captures only the main display. A global foreground bundle is not evidence that a keyboard target is visible in those pixels. Do not type into an unseen external-display target or infer click coordinates there. Explicit display selection is a potential future feature, not implemented/tested here. Broader GUI, zoom/other click types on this new binary, consent revocation and drag cancellation remain untested in this run.

## Original acceptance checklist (results above supersede not-run items)

1. Verify the model receives availability without a failed exploratory tool call; no automatic screenshot/input.
2. Use a newly observed Scratch frame and compare default250 versus explicit800 settle for hover exit. Record what the image actually shows; longer waiting does not prove success.
3. Observe after user-controlled app activation; confirm foreground bundle matches the visible active app. Never reuse pre-switch coordinates.
4. On a fresh Scratch frame, send Cmd+Q exactly once with explicit settling. Inspect the returned full frame. Any unknown stops the run; never repeat input to make the test pass.
5. Repeat basic fixture tasks only after the new helper is actually loaded; record operation latency and extra observation count. Do not compare tool latency to model reasoning or network latency.
6. Leave broader scale/rotation, clipboard integrity, drag cancellation and consent revocation cases unmarked until independently exercised.
