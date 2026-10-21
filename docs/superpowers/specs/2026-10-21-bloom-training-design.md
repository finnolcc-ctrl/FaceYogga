# Bloom — task-reward loop and readable hints for the Exercise screen

## Summary

**Goal.** Make the Exercise screen (`data-screen="exercise"`) feel like a small, earned game and make the live hint readable at a glance. Each detected rep is a bud that opens while you hold the shape, blooms at snap, and drifts into a garden that grows into the session mandala.

**What changes.**
- `app.js`: a new self-contained `Bloom` section (bud, burst, drift, hint pill, garden, mini mandala), and small hooks in `stepGatedPhase`, `snapRep`, `autoAdvance`, `runActivePaced`, `handleSelfResult`, `drawMesh`, `teardownExercise`.
- `index.html`: inside the exercise section only — `#bloomLayer` canvas, `#hintPill`, `#bloomGarden`, `#miniMandala`.
- `style.css`: exercise-screen rules only — cue card contrast, hint pill, garden, mini mandala.
- Not touched: Home, Report (incl. `renderMandala`), Onboarding, `test.html`, `test.js`, `routine.v2.json`, `PRECISION_TARGETS`, `softPrecision`, `rampPrecision`, feedback copy banks, `drawMesh` contour choices.

**Decisions.**
- D1: Direction A "Bloom" (chosen by the user over "Catch the light" and "Quest card"). It reuses the mandala language and rewards only what was earned.
- D2: Hint pill sits between lower lip and chin, as a DOM element above the face canvas (not drawn on the canvas). Reason: the face canvas runs at 55% opacity and is stretched to the screen, which would dim and distort canvas text. Alternative: above the upper lip — rejected, it crowds the nose and the vowel target.
- D3: A 0-petal snap shows a small white seed puff, not nothing — "you kept going" still gets a beat.
- D4: Losing the shape folds the bud back silently. No sound — a loss sound reads as a failure state, which the brief forbids.
- D5: A 7-slot mini mandala in the top bar fills live as moves finish, using the Report mandala's colours and tiers.
- D6: Timer-paced moves (5–7 always; all moves in Guided mode) get a timer-grown stem and one identical blossom on "Completed" (smaller on "Partial", none on "Skip"). No grading.
- D7: Build A↔U first, user approves it on iPhone, then extend to E↔U and the two pucker moves.
- D8: `test.html` stays untouched. Bloom falls back to drawing on the face canvas when `#bloomLayer` is missing, and all new DOM hooks are null-safe, so the harness shows the bloom with no edits.

**Tests / verification.** No JS test runner on this PC (no Node). Verify in the built-in browser through `test.html` (sliders, Force snap) with screenshots per state, plus a console-error check. Pure logic (tier mapping, garden state) is kept in small pure functions that can be exercised from the browser console.

**Check on device (iPhone 15 Safari).** Pill readable while the face moves; bud opens and folds smoothly; bloom → drift → garden at 60 fps feel; mini mandala fills; moves 5–7 never show a graded reward; sound still muted by default.

**Risks.** Frame cost of a second canvas on older phones (mitigate: draw only while something is animating); pill jitter (mitigate: smoothing + clamping); visual clutter around the mouth (mitigate: hairline petals, one saturated accent at a time).

---

## 1. Problem

- The hint (`#phaseSub`) is 12px in camera mode (`style.css` `.in-camera-mode .phase-sub`), inside a translucent card at the bottom of the screen, far from where the user is looking.
- Everything drawn on the face canvas is shown at 55% opacity (`.mesh-canvas-soft.on`), so the target and fill read as faint.
- In camera mode `.phase-stage` is `display: none`, so most of `flashSnap()` is invisible. The only reward is a short pulse on the cue card.
- Progress is a row of small dots. Nothing on screen accumulates or carries from rep to rep or move to move.

## 2. Honesty constraints (unchanged, restated so the design can be checked against them)

1. No percentage, score or star rating that implies accuracy.
2. No automatic cycle counts for moves 5, 6, 7.
3. Rewards for moves 5–7 reward showing up (duration, user-confirmed completion), never performance.
4. Full marks come from the ideal, not the maximum. Bigger expressions never earn more.
5. Experimental detectors stay off.

Note: `CLAUDE_HANDOFF.txt`, named as the source of these rules, is not on disk, in git history, or in the Downloads zips. The list above is taken from §7 of `HANDOFF-GAMIFICATION.md`.

How Bloom respects them: petal count is the existing 0–3 peak-precision tier (already shown as dot tiers), with no numbers on screen. Paced moves never get a bud, a petal count or a tier — only a stem tied to the clock and a single uniform blossom on self-confirmation. Bud opening follows `g.fill`, which already caps at the ideal via `softPrecision`.

## 3. Design

### 3.1 Layers (camera mode)

| z | Layer | Opacity | New? |
|---|---|---|---|
| 1 | `.exercise-dim` | — | existing |
| 2 | `#exerciseMesh` (face line art, targets) | 55% | existing |
| 3 | `#bloomLayer` canvas (bud, burst, drift) | 100% | new |
| 4 | `.exercise-body` (cue card, garden, `#hintPill`) | 100% | existing container |
| 5 | top bar (with `#miniMandala`) | 100% | existing container |

`#bloomLayer` uses the same CSS as `.mesh-canvas` (absolute, full screen, `scaleX(-1)`), is sized by `fitCanvasToVideo`, and is cleared and drawn each frame from `drawMesh` with the same landmarks. It gets class `on` only in camera mode.

### 3.2 Hint pill

- Element: `<div id="hintPill" class="hint-pill" aria-live="polite">` inside the exercise section.
- Look: `--vellum` background at ~0.94, `--night` text, Outfit 500, 18px, padding 8px 16px, 999px radius, soft shadow. No red or warning colours for over-shoot hints.
- Position: anchor = midpoint of lower lip (landmark 14) and chin (152), in canvas pixels. Map to CSS pixels for the stretched, mirrored canvas: `left = (1 - x / videoWidth) * canvas.clientWidth`, `top = y / videoHeight * canvas.clientHeight`. Smooth with an exponential lerp (≈120 ms time constant) and clamp so the pill stays 16px inside the screen edges and above the cue card.
- Text: whatever `updateFeedback` picks. `updateFeedback` keeps writing `#phaseSub` (so `test.html` still works) and also calls `Bloom.setHint(text)`. A text change cross-fades over 180 ms.
- Visibility: shown only while a detected phase is active and a face is tracked. Hidden on face loss, pause, demo, self-check and between moves.
- `#phaseSub` is hidden by CSS in camera mode (the pill replaces it there). In Guided mode nothing changes.

### 3.3 Cue card

- Camera mode `.phase-copy`: background `rgba(10,12,18,.82)`, cue (`#phaseCue`) 22px. It carries only the task line (the routine cue, e.g. "A: open gently") and the stage pill.

### 3.4 Bud (task)

- Drawn on `#bloomLayer` around the active target, which stays exactly as today on the face canvas.
- Target centre and radius come from the same geometry the existing target functions use (vowel ellipse around the mouth; pucker zone circle; pucker-circles target dot). To avoid duplicating that geometry, factor a small pure helper `targetGeometry(pts, w, h, moveId, phase) → {cx, cy, rx, ry}` and call it from `drawPhaseTarget`, `drawPuckerGuide` and `Bloom`. Numbers do not change.
- Five hairline petals (1–1.5px, `--amber`, ~0.7 alpha) placed around the target. Openness `o` eases toward `g.fill` (never ahead of it). At `o = 0` petals lie folded against the outline; at `o = 1` they open outward by ~35° and grow ~30%.
- When precision drops, `g.fill` already drains over 1.4 s; the petals follow it closed. No sound, no colour change (D4).

### 3.5 Bloom burst and drift (reward)

On `snapRep`, `Bloom.burst(tier, cx, cy)` starts an animation (state kept in `Bloom`, timed with `performance.now()`):

1. **Open (0–0.8 s):** petals open fully and fill with the tier colour; a soft radial glow pulses once. Tier visuals:
   - 0: small white seed puff (6–8 tiny dots drifting up and fading).
   - 1: amber petals (`#ead1b5`).
   - 2: coral → pink (`#ff6a7d → #ff8ac6`).
   - 3: magenta → violet (`#fff2d3 → #ff7cb9 → #9668ff`) with halo.
2. **Drift (0.8–1.4 s):** the flower shrinks to garden size and travels on a gentle curve to its garden slot (slot position read from `#bloomGarden` via `getBoundingClientRect`, mapped back to canvas space). On arrival the slot gets class `filled p<tier>` and `AudioEngine.transition(784)` plays very softly. If the garden element is missing (test harness), the flower fades out in place.

- Gameplay never waits: `stepGatedPhase` runs immediately as today, so the next bud starts while the previous bloom is still drifting. A burst for the next rep can overlap; `Bloom` keeps a small list of active bursts.
- `AudioEngine.snap(petals)` is unchanged.
- `flashSnap` stays for Guided mode; in camera mode its stage flash is invisible anyway and is left as is.

### 3.6 Garden row

- `<div id="bloomGarden" class="bloom-garden">` replaces the visible role of `#rhythmDots` in camera mode. `#rhythmDots` is still rendered (hidden by CSS in camera mode) so `test.html` and Guided mode keep working.
- Detected moves: one slot per required rep (4). Empty slot = hairline circle; current slot = soft pulse; filled slot = mini flower in its tier style.
- On move complete (`autoAdvance`): the filled slots gather into one blossom at the garden centre (0.6 s), shown under the existing closing line ("that was lovely." etc.), then it flies to the move's slot in `#miniMandala`.
- Paced moves (5–7, and Guided mode): the garden shows a single stem whose height follows elapsed active time / planned active time (clock only, no detection). On "Completed": one uniform blossom grows on the stem; "Partial": a smaller bud-sized blossom; "Skip": stem fades. The blossom then flies to the mini mandala the same way.

### 3.7 Mini mandala

- `<div id="miniMandala" class="mini-mandala">` in the exercise top bar, ~32px, next to the progress track.
- Seven slots at the same angles as `PETAL_PRESETS`. When a move finishes, its petal appears with that preset's gradient and the same tier rule as `renderMandala` (`q ≥ 10 → q3, ≥ 7 → q2, ≥ 4 → q1, else q0`; paced completed = default `7`, partial = `3`, matching the Report's fallback). `renderMandala` itself is not modified; the tier rule is copied into a pure `mandalaTier(moveState)` helper used only by the mini mandala.
- Reset in `startSession`.

### 3.8 Code structure

New section in `app.js`, after the AudioEngine block:

```
// Bloom — bud, burst, drift, hint pill, garden, mini mandala
const Bloom = {
  init(),                       // look up optional elements; null-safe
  reset(),                      // new session / teardown
  startPhase(moveId, phase),    // new bud, show pill
  draw(ctx, pts, w, h),         // per frame from drawMesh
  setHint(text),                // from updateFeedback
  burst(tier),                  // from snapRep
  completeMove(moveState),      // from autoAdvance / handleSelfResult
  startPaced(move),             // from runActivePaced
  hide(),                       // pause, demo, self-check, face loss
};
```

Pure helpers (console-testable): `targetGeometry`, `petalTier(peak)` (the existing 0.9 / 0.7 / 0.5 rule, moved out of `snapRep` unchanged), `mandalaTier(moveState)`, `easeOutCubic`.

`window.FaceYoga` also exports `Bloom` so the harness or console can drive it.

`drawMesh` calls `Bloom.draw` on `#bloomLayer` when present; otherwise `Bloom.draw` runs on the face canvas context after the targets (D8). When nothing is animating and no phase is active, `Bloom.draw` clears once and returns.

## 4. Rollout

1. **Round 1 — A↔U only.** Pill, cue card contrast, bud, burst, drift, garden, mini mandala, paced stem/blossom. Bud and burst are enabled only for `vowel_a_u`; other detected moves keep today's visuals plus the pill. Verify in `test.html`, then on device. User approves the look.
2. **Round 2 — E↔U, pucker side to side, pucker circles.** Enable bud and burst for the remaining detected moves using `targetGeometry`.

Deploy after each round. Pushing and deploying need the user's go-ahead at that time.

## 5. Verification

- **Browser (`test.html`, built-in browser):** for A↔U — screenshots of bud closed, bud half open, each burst tier (via sliders tuned to give peak ≥ 0.9, 0.7–0.9, 0.5–0.7, < 0.5, then Force snap), drift into the garden fallback; no console errors. Run each paced move to confirm the harness still works and nothing graded appears.
- **Main app in the browser:** start a session, check the layers, and that Home, Report and Onboarding look unchanged.
- **Device checklist (iPhone 15 Safari, camera mode):**
  1. Pill is readable while moving the head slightly, and does not cover the lips or target.
  2. Bud opens as you hold A, folds back when you relax, with no sound.
  3. Each snap blooms, drifts and lands in the garden; the next bud is already there.
  4. Move end: blossom gathers and flies to the mini mandala.
  5. Moves 5–7: stem grows with time; "Completed" gives the same blossom every time; no petals count shown.
  6. Sound still off by default; with ♪ on, snap chime and a soft landing tone.
  7. Report mandala unchanged.

## 6. Out of scope

Home, Report, Onboarding, the test harness files, routine data, precision thresholds, feedback wording, line-art contours, haptics (iOS Safari has no Vibration API).
