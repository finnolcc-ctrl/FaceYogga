# Bloom Training Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Summary

- **Goal:** ship Bloom round 1 on the Exercise screen. That means a readable hint pill by the mouth, a bud that opens with `g.fill`, a tiered bloom that drifts into a garden row, a live mini mandala, and a timer stem with a uniform blossom for paced moves. Bud and bloom run on A↔U only; round 2 (Task 7) enables them for E↔U and both pucker moves after the user approves round 1 on device.
- **Files:** `app.js` (pure helpers, `Bloom` section, hooks), `index.html` (exercise section only: 4 elements), `style.css` (exercise rules only), new `checks/bloom-checks.js` (console checks), local-only `.claude/launch.json` (static server, not committed).
- **Decisions:** all come from the approved spec (D1–D8). Plan-level choices:
  - P1: pure logic is checked by `checks/bloom-checks.js`, imported from the browser console on `test.html`. This PC has no Node, so there is no other JS runner. TDD applies to those helpers.
  - P2: visual work (canvas, CSS, DOM wiring) falls under the standing TDD exception. Its check is "no console errors + screenshot in the built-in browser + a device-checklist item".
  - P3: the static server is `python -m http.server 8000` (Python 3.12 is installed).
  - P4: a `BLOOM_MOVES` set gates the bud and burst, so round 2 is a one-line change plus checks.
- **Verification:** run `bloom-checks.js` (all PASS), take screenshots of each state in `test.html`, smoke-test the main app in the browser, then the iPhone 15 Safari checklist in Task 6.
- **On device:** pill readability, bud open/fold, bloom → drift → garden, mini mandala, no grading on moves 5–7, sound muted by default.
- **Risks:**
  - Changing the target geometry while refactoring. Mitigated by characterization checks plus before/after screenshots.
  - Frame cost of the second canvas. `Bloom.draw` returns early when idle.
  - Pill jitter. Mitigated by smoothing and clamping.

**Goal:** Implement spec `docs/superpowers/specs/2026-10-21-bloom-training-design.md`, round 1, then round 2.

**Architecture:** One new `Bloom` object in `app.js` owns all new visuals and state. It is driven by hooks in the existing gate, snap, paced and self-check functions. It draws on an optional full-opacity `#bloomLayer` canvas and positions an optional DOM `#hintPill`. Every element is optional, so `test.html` keeps working unchanged (falls back to the face canvas).

**Tech Stack:** vanilla HTML / CSS / ES-module JS, Canvas 2D, Web Audio (existing `AudioEngine`), MediaPipe Face Landmarker (existing). No build step.

**Spec:** `docs/superpowers/specs/2026-10-21-bloom-training-design.md`

## Global Constraints

- Scope: Exercise screen and gamification only. Do not edit Home, Report (`renderMandala`), Onboarding, `test.html`, `test.js`, `routine.v2.json`.
- Do not change `PRECISION_TARGETS`, `softPrecision`, `rampPrecision`, `FEEDBACK_BANKS`, `UNDER_HINTS`, `OVER_HINTS`, or `drawMesh` contour choices.
- No percentage, score or star rating on screen. No auto cycle count for moves 5/6/7. Paced moves never get a tier.
- Petal tier rule (unchanged): peak ≥ 0.9 → 3, ≥ 0.7 → 2, ≥ 0.5 → 1, else 0.
- Mandala tier rule (copied, not shared with `renderMandala`): q ≥ 10 → `q3`, ≥ 7 → `q2`, ≥ 4 → `q1`, else `q0`; paced completed = 7, partial = 3.
- Palette: `--vellum #f3eee6`, `--night #07080c`, `--amber #ead1b5`; tier 2 `#ff6a7d → #ff8ac6`; tier 3 `#fff2d3 → #ff7cb9 → #9668ff`.
- Pill: Outfit 500, 18px, vellum at ~0.94 background, night text, padding 8px 16px, radius 999px, 16px screen inset, 180 ms text cross-fade, ≈120 ms position smoothing.
- Camera-mode cue card: background `rgba(10,12,18,.82)`, `#phaseCue` 22px.
- Timings: bloom open 0–0.8 s, drift 0.8–1.4 s, move gather 0.6 s. Landing tone `AudioEngine.transition(784)`.
- Sound stays muted by default. No haptics.
- Commits: `Area: what changed`, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Pushing and deploying need the user's explicit go-ahead at that moment.

## Review Focus

1. **Face lost mid-bloom.** `drawMesh` gets no landmarks. Expected: pill hides, in-flight bursts finish at their last position, no exception. Pinned in Task 3 Step 5 and Task 4 Step 6.
2. **Skip / End / Retry during a bloom or a paced stem.** Expected: no stray flower drifts into the next move's garden, and the stem resets. Pinned in Task 5 Step 6.
3. **Pause during drift.** Expected: animation freezes while paused and resumes without jumping. Pinned in Task 4 Step 6.
4. **Second session in the same page load.** Expected: garden and mini mandala start empty. Pinned in Task 5 Step 6.
5. **Pill near screen edges** (face near the bottom, cue card overlap). Expected: clamped inside 16px and above `.phase-copy`. Pinned in Task 3 Step 5.

---

### Task 0: Local server

**Files:**
- Create (not committed): `.claude/launch.json`

- [ ] **Step 1:** Create `.claude/launch.json` with one configuration: name `static`, `runtimeExecutable` `python`, `runtimeArgs` `["-m","http.server","8000"]`, port `8000`.
- [ ] **Step 2:** `preview_start` name `static`, then navigate to `http://localhost:8000/test.html`. Expected: harness loads and the console has no errors. Take a baseline screenshot with move A↔U started and slider jaw = 0.35 (file it in the scratchpad as `before-a.png`), plus one for pucker ← (`before-puck.png`).

### Task 1: Pure helpers + geometry refactor

**Files:**
- Create: `checks/bloom-checks.js`
- Modify: `app.js` — new helpers near `drawPhaseTarget` (~line 1866), `snapRep` (~1091), `drawPhaseTarget`, `drawPuckerGuide` (~1773), `window.FaceYoga` export (~2054)

**Interfaces:**
- Produces:
  - `targetGeometry(pts, w, h, moveId, phase) → {cx, cy, rx, ry} | null`, in canvas pixels.
  - `petalTier(peak: number) → 0|1|2|3`
  - `mandalaTier(moveState) → "q0"|"q1"|"q2"|"q3"|null`
  - `easeOutCubic(t: number) → number`, with t clamped to [0, 1].
  - `BLOOM_MOVES: Set<string>`, which is `new Set(["vowel_a_u"])` in round 1.
  - All five are exported on `window.FaceYoga`.

- [ ] **Step 1: Write the failing checks** in `checks/bloom-checks.js`.
  - It is an ES module that exports `async function run()`. `run` reads `window.FaceYoga`, collects `[name, pass, detail]` rows, `console.table`s them, and returns `{passed, failed}`.
  - Checks:
    - `petalTier`: 0.95→3, 0.9→3, 0.89→2, 0.7→2, 0.69→1, 0.5→1, 0.49→0, 0→0.
    - `mandalaTier`:
      - `{status:"completed",quality:12}`→`q3`; `{status:"completed",quality:10}`→`q3`; `{status:"completed",quality:9}`→`q2`; `{status:"completed",quality:4}`→`q1`; `{status:"completed",quality:3}`→`q0`.
      - `{status:"completed"}`→`q2`; `{status:"partial"}`→`q0`.
      - `{status:"skipped"}`→`null`; `{status:"not_started"}`→`null`.
    - `easeOutCubic`: 0→0, 1→1, 0.5→0.875, -1→0, 2→1.
    - `targetGeometry` on `FY.State.lastLandmarks[0]` with w = 480, h = 640:
      - Let `eyeDist = hypot((p263.x-p33.x)*w, (p263.y-p33.y)*h)`. `vowel_a_u:a` → `rx = eyeDist*0.17`, `ry = eyeDist*0.22`, `cx = ((p61.x+p291.x)/2)*w`, `cy = ((p13.y+p14.y)/2)*h`.
      - `vowel_a_u:u` and `vowel_e_u:u` → `rx = eyeDist*0.09`, `ry = eyeDist*0.11`.
      - `vowel_e_u:e` → `rx = eyeDist*0.26`, `ry = eyeDist*0.08`.
      - `pucker_side_to_side:left` → with `d = lipDeviation`-equivalent values (`noseX = p1.x*w`, `eyeDistPx = |p263.x-p33.x|*w`, `neutralLipY = (p1.y + |p263.x-p33.x|*0.35)*h`): `cx = noseX + eyeDistPx*0.1`, `cy = neutralLipY`, `rx = ry = eyeDistPx*0.045`. For `:right`, cx uses `-`.
      - `pucker_circles:up` → `cx = noseX + cos(-π/2)*eyeDistPx*0.095`, `cy = neutralLipY + sin(-π/2)*eyeDistPx*0.095`, `rx = ry = eyeDistPx*0.038`.
      - `tongue_inner_cheek:left_up` → `null`.
    - Tolerance 1e-6. Also check `BLOOM_MOVES.has("vowel_a_u") === true` and `BLOOM_MOVES.size === 1`.
- [ ] **Step 2: Run, expect fail.** In the browser console on `test.html`: `(await import('/checks/bloom-checks.js')).run()`. Expected: failures with "is not a function".
- [ ] **Step 3: Implement the helpers.** Move the tier expression out of `snapRep` into `petalTier` and call it there. Make `drawPhaseTarget` and `drawPuckerGuide` take centre and radii from `targetGeometry`. Their own `matchScore` / warm / fill logic stays inline and unchanged.
- [ ] **Step 4: Run, expect pass.** Same console command. Expected: `failed: 0`.
- [ ] **Step 5: Characterization.** Repeat the Task 0 screenshots (`after-a.png`, `after-puck.png`) at the same slider values. Expected: visually identical to the `before` shots.
- [ ] **Step 6: Commit.** `git add app.js checks/bloom-checks.js`, message `Exercise: extract target geometry and tier helpers`.

### Task 2: Markup and camera-mode CSS

**Files:**
- Modify: `index.html` (exercise section only), `style.css` (rules near lines 449–486 and the rhythm-dots block ~841)

**Interfaces:**
- Produces these DOM ids, which Tasks 3–5 rely on:
  - `#bloomLayer`: `<canvas class="mesh-canvas bloom-layer">`, a sibling after `#exerciseMesh`.
  - `#hintPill`: `<div class="hint-pill" aria-live="polite" hidden>`, inside `.screen-exercise`, after `.exercise-body`.
  - `#bloomGarden`: `<div class="bloom-garden" aria-hidden="true">`, inside `.exercise-body`, after `#rhythmDots`.
  - `#miniMandala`: `<div class="mini-mandala" aria-hidden="true">`, inside `.topbar-exercise .session-progress`, after `.progress-track`.
- Produces these CSS classes:
  - `.hint-pill.show`
  - `.bloom-garden .slot`, plus modifiers `.current`, `.filled.p0`–`.filled.p3`, `.stem`, `.blossom`, `.blossom.small`, `.gather`
  - `.mini-mandala .mp` (with `--rot`) and `.mp.q0`–`.mp.q3`

- [ ] **Step 1: Add the four elements** at the positions listed above.
- [ ] **Step 2: Add the CSS.**
  - `#bloomLayer`: z-index 3, full opacity when `.on`.
  - Camera-mode `.phase-copy` and `#phaseCue`: the values from Global Constraints.
  - Camera mode hides `.phase-sub`. It hides `.rhythm-dots` only when the screen lacks the `.bloom-off` class (selector `.in-camera-mode:not(.bloom-off) .rhythm-dots`); Task 5 sets that class. `.bloom-garden` is hidden unless it has `.on`, which Bloom sets for Bloom moves and for paced moves in either mode.
  - Pill styles from Global Constraints: `position: absolute`, `transform: translate(-50%, 0)`, opacity transition 180 ms, z-index 4.
  - Garden slots: 22px hairline circles, 10px gap.
  - Mini mandala: 32px box, petals 6×14px rotated by `--rot`, tier opacity and saturation stepping like the Report petals.
  - Guided-mode rules stay untouched.
- [ ] **Step 3: Verify.** Load `http://localhost:8000/` and start a Guided session (no camera). Expected: no console errors, the screen looks as before, and the mini mandala is 7 empty slots.
- [ ] **Step 4: Commit.** `Exercise: add bloom layer, hint pill, garden and mini mandala markup`.

### Task 3: Bloom core + hint pill

**Files:**
- Modify: `app.js` — new `Bloom` section after `AudioEngine` (~line 1248), hooks in `updateFeedback`, `drawMesh`, `stepGatedPhase`, `pauseExercise`, `resumeExercise`, `showDemoOverlay`, `showSelfCheck`, `teardownExercise`, `startSession`, `init`, plus the `window.FaceYoga` export

**Interfaces:**
- Consumes: Task 1 `targetGeometry`; Task 2 DOM ids.
- Produces the `Bloom` object with:
  - `init()`: looks up `#bloomLayer`, `#hintPill`, `#bloomGarden`, `#miniMandala`. Any of them may be null.
  - `reset()`
  - `startPhase(moveId, phase)`
  - `draw(fallbackCtx, video, pts, w, h)`
  - `setHint(text)`
  - `hide()`
  - `show()`
  - Internal state: `bud {moveId, phase, open}`, `bursts []`, `pill {x, y, text, visible}`.
- `drawMesh` calls `Bloom.draw(ctx, video, pts, w, h)` in two places:
  - after the target overlays;
  - on the no-landmarks early return, with `pts = null` and `ctx` being the face canvas context.
- `Bloom.draw` behaviour:
  - It uses `#bloomLayer` (sized with `fitCanvasToVideo(layer, video)` and cleared) when present, otherwise `fallbackCtx`.
  - With no pts it hides the pill but keeps advancing bursts.
  - When idle (no bud, no bursts, pill hidden) it clears once and returns.

- [ ] **Step 1: Write the `Bloom` skeleton.** Call `Bloom.init()` from `init()`, and `Bloom.reset()` from `startSession` and `teardownExercise`. Export it.
- [ ] **Step 2: Hint pill.**
  - `updateFeedback` still sets `#phaseSub` and also calls `Bloom.setHint(text)`.
  - `stepGatedPhase` calls `Bloom.startPhase(g.moveId, p.phase)`, which seeds the pill with the waiting text it already sets.
  - Anchor: midpoint of landmarks 14 and 152.
  - Screen position: `left = (1 - x/w) * layerEl.clientWidth`, `top = (y/h) * layerEl.clientHeight`. `layerEl` is `#bloomLayer` or the face canvas.
  - Smoothing: exponential, `k = 1 - exp(-dt/0.12)`.
  - Clamping: inside 16px of each screen edge, and `top` stays above `.phase-copy`'s `getBoundingClientRect().top - pillHeight - 8`.
  - Text change: set opacity to 0, swap the text after 90 ms, fade back in over the remaining 90 ms.
- [ ] **Step 3: Hide and show.** `pauseExercise`, `showDemoOverlay` and `showSelfCheck` call `Bloom.hide()`. `resumeExercise` calls `Bloom.show()`. The pill shows only while `State.phaseGate` exists, a face is tracked, and Bloom isn't hidden.
- [ ] **Step 4: Verify the main path.** Run the checks: still `failed: 0`. In `test.html`, start A↔U and move the jaw slider. Expected: `#phaseSub` text changes as before, and there are no console errors. The pill isn't visible in the harness (no `#hintPill` there). That is expected per D8, and harness behaviour is unchanged.
- [ ] **Step 5: Verify pill placement in the main app.**
  - Browsers can't fake a camera here, so drive it from the console on `http://localhost:8000/`:
    - run `FY.startSession("camera_assisted_candidate")` (with no camera stream it takes the non-camera branch)
    - then add class `in-camera-mode` to the exercise screen and class `on` to `#bloomLayer`
    - feed `FY.State.lastLandmarks` with a landmark array copied from the harness (`JSON.stringify` there)
    - call `FY.drawMesh(meshEl, {videoWidth:480, videoHeight:640}, lm)` in a rAF loop
  - Screenshot checks:
    1. The pill sits between lip and chin.
    2. Set every landmark y to +0.35 (face low). The pill is clamped above the cue card.
    3. Pass `[]` landmarks. The pill hides with no exception.
- [ ] **Step 6: Commit.** `Exercise: Bloom core and hint pill by the mouth`.

### Task 4: Bud, bloom burst, drift

**Files:**
- Modify: `app.js` — `Bloom` (add `burst`, bud drawing), `snapRep`

**Interfaces:**
- Consumes: `petalTier`, `easeOutCubic`, `BLOOM_MOVES`, `targetGeometry`, `AudioEngine.transition`.
- Produces:
  - `Bloom.burst(tier, slotIndex)`
  - `Bloom.slotCenter(slotIndex) → {x, y} | null`, in canvas pixels, mapped from `#bloomGarden .slot` rects (the inverse of the pill mapping). Returns null without a garden.
  - Burst record: `{tier, x, y, t0, slotIndex, landed}`

- [ ] **Step 1: Draw the bud.**
  - Draw it only when `BLOOM_MOVES.has(bud.moveId)` and pts exist.
  - `bud.open` eases toward `State.phaseGate.fill` with `k = 1 - exp(-dt/0.08)` and is never above fill.
  - Five petals around the `targetGeometry` ellipse. Each petal is a quadratic-curve leaf: base on the ellipse at angle `θi = -π/2 + i·2π/5`, tip pushed outward by `(0.15 + 0.35·open)·max(rx, ry)`, rotated by `open·35°`.
  - Stroke `rgba(234,209,181,0.7)`, line width `max(1, w/400)`, no fill. It folds back automatically because fill drains.
- [ ] **Step 2: Hook the snap.** In `snapRep`, before `stepGatedPhase()` and before the auto-complete branch, call `Bloom.burst(petals, g.reps - 1)` when `BLOOM_MOVES.has(g.moveId)`. The burst origin is the current bud centre.
- [ ] **Step 3: Animate the burst.** Use local time `t = (now - t0)/1000`, excluding time spent paused (accumulate paused time while `State.paused`).
  - 0 ≤ t < 0.8: petals scale out with `easeOutCubic(t/0.8)` and are filled with the tier gradient from Global Constraints. Tier 0 draws 7 seed dots rising 0.4·r and fading instead.
  - One radial glow pulse, alpha peaking at 0.45 at t = 0.3.
  - 0.8 ≤ t < 1.4: scale down to slot size and move along a quadratic Bézier from origin to `slotCenter(slotIndex)`, with the control point 0.3·h above the midpoint.
  - At t ≥ 1.4: set the slot class to `filled p<tier>`, call `AudioEngine.transition(784)`, and drop the burst.
  - With a null `slotCenter`: fade out in place over 0.8–1.4 s.
- [ ] **Step 4: Verify the checks.** Expected: `failed: 0`.
- [ ] **Step 5: Verify the tiers in `test.html`.** For each tier, set the sliders, wait for the gate, and take screenshots at about 0.3 s and 1.0 s after the snap:
  - jaw 0.35 → tier 3
  - jaw 0.25 → precision ≈ 0.47, so expect tier 0 or 1. Record which.
  - Force snap from rest → tier 0 seed puff
  - Expected: the bud is visible around the ellipse, it opens with fill and folds when the jaw slider returns to 0, the burst is visible, and it fades in place (no garden in the harness). No console errors.
- [ ] **Step 6: Review Focus checks.**
  - Press the harness pause button during a drift. Expected: the burst freezes, then resumes without jumping.
  - Pass empty landmarks mid-burst (harness: set `FY.State.lastLandmarks = []` and call `FY.drawMesh(meshEl, fakeVideo, [])` from the console). Expected: no exception, and the burst finishes.
- [ ] **Step 7: Commit.** `Exercise: bud opens with fill and blooms into the garden`.

### Task 5: Garden, move gather, mini mandala, paced stem

**Files:**
- Modify: `app.js` — `Bloom` (`startMove`, `completeMove`, `startPaced`, `pacedTick`), plus hooks in `runActiveDetection`, `autoAdvance`, `runActivePaced`, `handleSelfResult`, `clearPhaseTimers`, `runDemo`

**Interfaces:**
- Consumes: `mandalaTier`, `PETAL_PRESETS` (read only), `Bloom.burst` slots.
- Produces:
  - `Bloom.startMove(moveIndex, slotCount)`: rebuilds the garden. `slotCount = requiredReps` for detected moves in `BLOOM_MOVES`.
  - `Bloom.startPaced(moveIndex, plannedMs)`: builds a single `.stem`.
  - `Bloom.pacedTick(elapsedMs)`: sets the stem height to `min(1, elapsed/planned)`.
  - `Bloom.completeMove(moveIndex, moveState)`
  - `Bloom.clearMove()`: cancels in-flight bursts and empties the garden. Used by skip, retry and end.

- [ ] **Step 1: Detected moves.**
  - `runActiveDetection` calls `Bloom.startMove(s.moveIndex, requiredReps)` when the move is in `BLOOM_MOVES`.
  - The garden gets `.on`, and the slot at `g.reps` carries `.current`.
  - Other detected moves keep `renderRepDots` visible: the garden stays off and `.rhythm-dots` is shown via a `.bloom-off` class on the screen.
- [ ] **Step 2: Paced moves.**
  - `runActivePaced` calls `Bloom.startPaced(s.moveIndex, move.activeMs)`, and its `runPhase` calls `Bloom.pacedTick(performance.now() - activeStart)`.
  - The stem shows a height only, with no count and no number.
- [ ] **Step 3: Move completion.**
  - `autoAdvance` (detected moves) and `handleSelfResult` (paced moves, status completed or partial) call `Bloom.completeMove(s.moveIndex, moveState)` after `moveState` is final.
  - Detected moves: the filled slots get `.gather` (they scale to the garden centre over 0.6 s) and become one `.blossom`.
  - Paced moves: `.blossom` for completed, `.blossom.small` for partial, and the stem fades on skip.
  - After 0.6 s the blossom flies to `#miniMandala .mp:nth-child(moveIndex+1)` using a FLIP transform over 0.6 s. That `.mp` then gets the `mandalaTier(moveState)` class, the `PETAL_PRESETS[moveIndex].grad` background and `--rot`.
  - Skip and retry from the self-check call `Bloom.clearMove()`.
- [ ] **Step 4: Session lifecycle.** `startSession` → `Bloom.reset()` empties the 7 mini-mandala slots. `clearPhaseTimers` and `runDemo` call `Bloom.clearMove()`.
- [ ] **Step 5: Verify the checks.** Expected: `failed: 0`.
- [ ] **Step 6: Verify the flows in the browser.**
  - Main app, Guided session: Skip until move 5, let move 5 run, tap Completed. Expected: the stem grows with time, there is no number, one blossom appears, and it flies to mini-mandala slot 5 with a `q2` look. Move 6 → Partial → small blossom, slot 6 `q0`. Move 7 → Skip → no petal.
  - Mid-move Skip and End during a stem: no blossom, and the next move's garden is clean.
  - Start a second session without reloading: the mini mandala is empty.
  - Camera path via the Task 3 Step 5 console setup on A↔U, with Force snap via `FY.State.phaseGate.fill = 1.01` ×4. Expected: 4 slots fill, they gather, slot 3 of the mini mandala fills, and the Report screen afterwards looks unchanged.
- [ ] **Step 7: Commit.** `Exercise: garden row, live mini mandala and paced blossoms`.

### Task 6: Round 1 verification and device test

- [ ] **Step 1: Run checks and regression.** Run `superpowers:verification-before-completion`:
  - checks pass
  - `git diff main --stat` touches only `app.js`, `index.html`, `style.css`, `checks/`, `docs/`
  - `git diff main -- test.html test.js routine.v2.json onboarding.css` is empty
  - grep the diff for `%` in user-facing strings (none allowed)
- [ ] **Step 2: Code review.** Run `superpowers:requesting-code-review` on the branch diff and fix the findings.
- [ ] **Step 3: Ask before deploying.**
  - Ask the user whether to push `feature/bloom-training`, and whether Vercel has a preview deploy for branches. Check with `gh api repos/finnolcc-ctrl/FaceYogga/deployments` after the push, or ask.
  - Pushing to `main` (production) needs a separate yes.
- [ ] **Step 4: Hand over the iPhone 15 Safari checklist** (camera mode, A↔U). Ask the user to clear the cache first.
  1. The pill is readable while you move your head a little. It never covers the lips or the target.
  2. Holding A opens the bud. Relaxing folds it back, silently.
  3. Each snap blooms, drifts and lands in the garden, and the next bud is already there.
  4. At the end of the move, the blossom gathers and flies to mini-mandala slot 3.
  5. On moves 5–7 the stem grows with time. "Completed" gives the same blossom every time, and no count is ever shown.
  6. Sound is off by default. With ♪ on, you hear the snap chime plus a soft landing tone.
  7. The Report mandala looks unchanged.
  8. E↔U and the pucker moves show the pill and the old target/dots, with no bud yet.
- [ ] **Step 5: Wait.** Wait for the user's results (or "skip device test"). Bugs go through `superpowers:systematic-debugging`.

### Task 7: Round 2 — remaining detected moves (only after the user approves round 1)

**Files:**
- Modify: `app.js` (`BLOOM_MOVES`), `checks/bloom-checks.js`

- [ ] **Step 1: Update the check** to expect `BLOOM_MOVES` = `{vowel_a_u, vowel_e_u, pucker_side_to_side, pucker_circles}` (size 4). Run it. Expected: FAIL.
- [ ] **Step 2: Extend `BLOOM_MOVES`.** Run the checks. Expected: PASS.
- [ ] **Step 3: Verify in `test.html`.** For each of E↔U, Pucker ← / →, and Pucker circles up/down/left/right: the bud sits around the correct target (zone circle; travelling ring dot) and the burst is visible. Screenshots, no console errors.
- [ ] **Step 4: Commit.** `Exercise: enable Bloom for E-U and pucker moves`.
- [ ] **Step 5: Repeat Task 6** (checks, review, deploy ask, device checklist items 1–4 for each move). Then `superpowers:finishing-a-development-branch`.
