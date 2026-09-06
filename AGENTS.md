# pi-visual-desktop

## Product direction
Build a small, independent, visual-first Pi computer-use package. The owner wants a usable baseline now, then to tune it at home and work through the same GitHub repository. Git distributes code; desktop control remains local. No VPS service is required.

Do not depend on or wrap the existing @amaster.ai/pi-computer-use/Cua Driver plugin. No mandatory AX/DOM/OCR element discovery, app-specific shortcut recipes, hidden input retries, automatic foreground/background fallback, or nested LLM controller. Pi's current vision-capable model sees the screenshot and decides the next action. OS accessibility permission checks are permitted; AX element exploration is not part of v0.

## Scope
- v0.1.0: macOS 14+ first, explicitly unsupported elsewhere until an adapter is implemented/tested. Local Node/Pi adapter and small native Swift screen/input helper. No external service, telemetry, credentials or screen upload beyond the normal Pi model image path.
- Whole main-display screenshots with ONE exact, documented image-pixel coordinate convention. Capture the actual desktop, no AX tree. Resize explicitly to a bounded image; input conversion is code-owned and tested. Observe supplies timestamp, dimensions and opaque screenshot ref.
- A small tool surface: observe and act (status optional); act covers click/double-click/right-click, scroll, drag, literal Unicode text, and explicit raw key input. Keyboard input is a primitive, not embedded app knowledge. No automatic Cmd+A/paste/shortcut tricks, no clipboard modification.
- User enables desktop control for the current Pi session with an explicit local command/confirmation; no headless implicit enable. Foreground desktop input is intentional, not background simulation. Tell users not to use the same desktop concurrently. Do not let model tools grant their own permission.
- Reject expired/consumed/foreign refs and invalid/NaN/out-of-range values. Check main-display geometry and relevant foreground identity before mutation; serialize calls and prevent simultaneous control by separate package sessions. Keep locking bounded and auditable, not a new service.
- One requested operation, then bounded settle and screenshot. Report dispatched versus verified separately; pixels changing is not proof of task success. After dispatch timeout/capture failure report unknown outcome and do NOT retry input. Cancellation must not leave held keys/buttons.
- Screenshots are not committed, retained indefinitely, or printed as base64 logs. Temporary capture artifacts are cleaned up. No arbitrary shell execution or network endpoint in the helper.
- Clear non-prompting diagnostics and explicit permission setup. Do not invoke GUI input during implementation tests; owner/parent controls any live smoke test.

## Development and evidence
Read complete Pi docs/extensions.md and docs/packages.md plus relevant examples from the installed @earendil-works/pi-coding-agent before implementation. Pi execute failures must throw, not return isError:true. Preserve image content as actual Pi image blocks. Keep prompts short and factual.

Use mockable transport/control logic and automated tests for coordinates/Retina scaling, schema validation, stale refs, concurrency/locking, cancellation, process timeout/unknown outcomes and image-result forwarding. Compile Swift locally; do not claim live GUI behavior from mocks. Include a scratch-app/manual acceptance checklist, with honest not-run markers.

Use an explicit build/setup command, not install-time surprise execution. Report package version plus git revision/dirty state via a user command. Document a developer checkout + local Pi package install workflow for BOTH machines: git pull --ff-only before work, commit/push after, no editing Pi-managed git cache, no automatic reset/stash/pull during a session. Stable users can pin tags. Local permission/config/screenshots never travel through Git.

## Authority
Only this repository may be changed for the task. Do not alter ~/.pi settings, remove the old plugin, start another agent, create/push GitHub repos, grant permissions, change system settings, or perform desktop input. Compile and unit tests are allowed. Parent handles installation, live acceptance, publication and final acceptance. Use a single writer at a time. Record concrete blockers rather than silently changing execution protocols or expanding scope.
