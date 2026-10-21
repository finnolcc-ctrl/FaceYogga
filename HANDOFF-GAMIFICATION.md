# FaceYoga — handoff for the gamification + training-UI redesign session

**New session's focus:** gamify the training flow with a task-reward loop, and redesign the training-screen UI so cues/hints are legible and the whole thing feels playful rather than clinical. Everything outside the Exercise screen (Home, Report, Onboarding) is already shipped and should NOT be touched this round.

---

## 1. Project snapshot

- **What it is:** mobile web app that plays short face-yoga sessions in iOS Safari / Chrome. Front camera → MediaPipe Face Landmarker → interactive practice screens. No backend, no accounts, everything local.
- **Stack:** vanilla HTML / CSS / ES-module JS. One `index.html`, one `style.css`, one `app.js`. No framework, no build step. Deployed to Vercel; the live URL is `https://faceyogga.vercel.app`.
- **Repo:** https://github.com/finnolcc-ctrl/FaceYogga (push authenticates against the `finnolcc-ctrl` GitHub user).
- **Owner:** SCAD student, Chinese-speaking, builds and tests on an iPhone 15. Switches fluently between English and Chinese in chat.

---

## 2. The 7 moves + the detection honesty line

Routine lives in `routine.v2.json`. Every move has `phaseSchedule`, timings, and bilingual `cue` strings.

| # | Move | Detection? | Why |
|---|---|---|---|
| 1 | `pucker_side_to_side` | ✓ | lip-center X deviation + `mouthPucker` blendshape |
| 2 | `pucker_circles` | ✓ | lip-center X/Y quadrant + `mouthPucker` |
| 3 | `vowel_a_u` (A↔U) | ✓ | `jawOpen` / `mouthPucker` |
| 4 | `vowel_e_u` (E↔U) | ✓ | `mouthSmile L+R` / `mouthPucker` |
| 5 | `tongue_inner_cheek` | ✗ | tongue invisible to camera |
| 6 | `air_side_to_side` | ✗ | air flow invisible to camera |
| 7 | `cheek_draw_in` | ✗ | ambiguous blendshape signal |

**Hard rule from the original brief (CLAUDE_HANDOFF.txt, read it on disk):** do NOT fabricate accuracy or auto cycle counts for moves 5/6/7. Camera cannot verify them. They remain **timer-paced + user-self-confirmed**. All gamification must respect this split: moves 1–4 can gate on real detection; moves 5–7 reward the ritual (showing up), not fake precision.

---

## 3. What's already shipped in the training flow

(These were built in the previous session; the quality bar is "works" but the UX is dull — your redesign starts from here.)

### Precision mechanic (moves 1–4)
- `softPrecision(value, ideal, soft, hard)` — bell curve around an ideal blendshape value (so over-shoot *also* costs quality, not just under-shoot).
- `rampPrecision(value, start, ideal, overLimit)` — for positional measures (pucker X / Y).
- `evaluatePrecision()` returns `{precision, direction, hintKey}`. See `app.js` for the `PRECISION_TARGETS` table — thresholds are tuned, do not casually move them.
- Per-rep peak precision → 0 / 1 / 2 / 3 petals at snap time.
- Fill meter inside the target shape, snap at fill = 1.0.
- Soft timeout at 2× `activeMs` → auto-advances with `partial` status.
- Auto-advance (no "Did you follow along?" modal) for detected moves. The modal still fires for 5/6/7.

### Lively feedback copy
`FEEDBACK_BANKS` buckets (`waiting / far / closer / good / perfect`) + direction-specific `UNDER_HINTS` / `OVER_HINTS` keyed on `hintKey` (`jawOpen` / `mouthPucker` / `mouthSmile` / `position`). Rotates copy per-bucket, throttled to 320 ms. Pulls one phrase at a time ("almost…", "soft round, not tight"). **The text itself is good — the problem is the user can barely see it.**

### Audio
`AudioEngine` (Web Audio) with:
- `transition(freq)` — soft bump when crossing into "good" or "perfect"
- `snap(petals)` — 1-note / 2-note / 3-note chord sized by petal count
- `complete(quality)` — 2–4-note arpeggio sized by move quality
- Muted by default; `♪` toggle in exercise footer. iOS Safari requires a tap to unlock the context — already handled.

### Visuals
- **Line-art face model on pure black.** Hairline contours (face oval, brows, eyes, nose bridge, lips with rose fill), 7 key dots with halos. Real camera video is hidden by CSS (`opacity: 0`); the canvas IS the whole image during exercise.
- Target overlays per phase: dotted amber ellipse for vowels; horizontal "zone" for lateral pucker; dashed circle + traveling target for pucker circles. Outline fades warm as `matchForActivePhase()` climbs.
- Rep dots (`.rhythm-dots .r`) with `p0 / p1 / p2 / p3` quality tiers — the 3-petal dot has a magenta-violet halo.
- Mandala on the Report: 7 petals arranged in a flower, each petal richness driven by `moveState.quality` (0–12). This is tasteful; don't redesign it this round.

---

## 4. What the user is unhappy with (the brief for THIS session)

Direct quotes/paraphrase from the user:
- > "the hint 非常不明显" — the live cue text is invisible / washed out against the camera backdrop in Mirror mode
- > "不够有趣" — the whole thing feels functional, not playful. No real sense of "task" and "reward" beyond the quiet checkmark

Translation into design goals:
1. **Hints read at a glance even while the face map is drawing.** Right now the phase-cue card is `rgba(10,12,20,.6)` + 12 px blur, text 20 px. Against the mesh it fades. Needs real contrast — maybe a floating glass pill that breaks the dark field, not just more opacity.
2. **Task framing per rep.** The user doesn't see "do this → get this." Instead the fill meter just creeps. Possible framings:
   - A micro-objective shown at phase start ("Hold A for 2 beats") + a payoff animation on snap
   - Target shape "unlocks" or "catches" something visible when matched
   - Visible streak within a move (3-in-a-row = bonus petal glow)
3. **Reward beat worth watching.** The current snap is a 0.6 s brightness pulse. A real reward beat earns the user's eye — particles, a flower blooming beside the dot that just lit, a soft haptic-feel visual.
4. **Playfulness ≠ noise.** The project's aesthetic is the quiet-ritual mood board (Outfit light, aurora, soft gradients). Keep the dignity. Gamify through *earned* delight, not confetti.

---

## 5. Established design language — reuse, don't reinvent

- **Palette:** `--night #07080c`, `--vellum #f3eee6`, `--mist #a6a39a`, `--amber #ead1b5` (target accent), coral→pink gradient `#ff6a7d → #ff8ac6` (rep level 2), magenta→violet `#fff2d3 → #ff7cb9 → #9668ff` (rep level 3 only), teal `#5dcaa5`, cyan `#3fc4b2` (toggles).
- **Type:** Outfit 300 for display, 400 for body, 500 for labels. Doto ExtraBold for any numeric read-out (countdown, percent, duration). Google Fonts link already in `<head>`. Italic serif accent (`Instrument Serif`) used once per screen for the emotional moment of copy ("beautiful", "that was lovely"). Keep that pattern.
- **Radii / shapes:** 999 px pills, 28–36 px cards, 115 px for the giant round-rect stages, 20 px for icon buttons.
- **Line / motion:** hairline strokes, slow drifts (20 s+), 0.6–1 s snap pulses, no bouncy springs. Everything settles.
- **Mood board the user picked:** gradient blobs (Mari Katayeva meditation app, Yodiz Life, Nike Intentions 2024 look). Soft blur, saturated accent only in one place per view.

---

## 6. File map

Read these before touching anything.

| Path | Purpose |
|---|---|
| `index.html` | All screens as `<section data-screen>` blocks. Exercise is `data-screen="exercise"` |
| `style.css` | Shared tokens + screen styles. The training-screen rules live under `.screen-exercise` and `.in-camera-mode` |
| `app.js` | Everything else. Key functions below |
| `routine.v2.json` | Move list, phase schedule, cues (zh + en), timings |
| `BRIEF.md` | Original project brief |
| `CLAUDE_HANDOFF.txt` | **The honesty-constraints doc. Load this before writing code.** |
| `onboarding.css` + onboarding sections of `index.html` | New onboarding flow; gated behind `ENABLE_ONBOARDING = false`. Not relevant to this session |
| `test.html` + `test.js` | Face-free test harness — drive the detection pipeline from sliders. Keep this working after your redesign so the user can test without their face. |

### Key `app.js` entry points for THIS session

- `drawMesh(canvas, video, landmarks)` — the line-art renderer. Target overlays and pucker guides are called from here.
- `drawPhaseTarget(ctx, pts, w, h, moveId, phase)` — dotted amber ellipse for vowels + fill meter.
- `drawPuckerGuide(ctx, pts, w, h, moveId, phase)` — lateral zone + circular track + user dot.
- `advanceGate()` — called every ~33 ms. Reads precision, climbs the fill, triggers `snapRep()`.
- `snapRep()` — awards petals, flashes stage, plays audio, advances phase (or auto-completes move).
- `flashSnap(petals)` — the 0.65 s pulse. **Replace / supplement this for the "reward beat"** goal above.
- `updateFeedback(precision, result)` — picks the hint text. **The engine is fine; its visibility layer isn't.**
- `renderRepDots(total, petalsPerRep)` — the dot-row at the bottom of the cue card. Candidates for a richer "collection" affordance (petals accumulating on-screen, not hiding in a small row).
- `AudioEngine.*` — reuse for new reward beats.

CSS selectors you'll touch:
- `.screen-exercise.in-camera-mode .phase-copy` — the cue card the user says is unreadable.
- `.phase-stage.snap-*` — snap animation variants by petal count.
- `.rhythm-dots .r.p1 / .p2 / .p3` — rep-dot tiers.

---

## 7. Honesty guardrails (never relax these)

- Never show a percentage, score, or star-rating that implies accuracy.
- Never auto-count cycles for moves 5 / 6 / 7.
- Any new "reward" visuals for moves 5–7 reward **showing up** (duration, consistency, user-confirmed completion), not performance.
- Never require users to strain harder for a bigger reward. Full marks come from the ideal, not the maximum.
- Experimental detectors stay OFF unless the user explicitly enables them.

The original handoff doc (`CLAUDE_HANDOFF.txt`) is the spec. If any new idea breaks a rule there, choose a different idea.

---

## 8. Suggested approach for the new session

1. **Load `CLAUDE_HANDOFF.txt`, `routine.v2.json`, `app.js` first.** Then read this doc end-to-end. Don't touch code until you can name every file in §6.
2. **Brainstorm the task-reward loop before building.** Use `superpowers:brainstorming` if the plugin is available, or do it conversationally. The user explicitly said precision + petal mandala is good — the gap is the *moment-to-moment loop*. Specifically answer:
   - What's the "task" the user sees at the start of a phase?
   - What's the "reward" at snap?
   - How does the reward *carry* — does it accumulate on screen, feed the mandala live, unlock something next phase?
   - What does losing fill feel like? (Right now: silent drain. Could be a quiet exhale sound, or a petal wilting.)
3. **Mock before building.** Ask the user to approve one phase's new look (A↔U is the clearest signal) before you touch pucker side-to-side / circles.
4. **Keep `test.html` working.** It's the user's main debugging tool. If you add new UI state, add a slider / button to drive it from there.
5. **Deploy to Vercel after each round.** User tests on iPhone 15 Safari. Push → wait for `curl` grep match → tell them to clear cache.
6. **The user wants discussion before code.** They push back hard when work ships without alignment. Short brainstorm → user picks → one tight implementation round.

---

## 9. What NOT to redo

- The precision math (`softPrecision`, `rampPrecision`, `PRECISION_TARGETS`). Thresholds are already tuned on the user's face.
- The feedback-copy library (`FEEDBACK_BANKS` / `UNDER_HINTS` / `OVER_HINTS`). The *words* are good.
- The line-art face model (`drawMesh` contour choices). This is the current aesthetic baseline; the user explicitly asked for it.
- The onboarding flow (gated off, don't ship changes to it).
- The report / mandala. Tasteful, done.
- `routine.v2.json` move list.

---

## 10. Opening prompt for the new session

Paste this verbatim as the first message of the new chat:

```
We're redesigning the training UI of my FaceYoga web app to be gamified
with a task-reward loop, and to make the on-screen hints actually visible.

Read these before anything else:
  • C:\Users\AISTUDIO\Downloads\Faceyoga\HANDOFF-GAMIFICATION.md
  • C:\Users\AISTUDIO\Downloads\Faceyoga\CLAUDE_HANDOFF.txt
  • C:\Users\AISTUDIO\Downloads\Faceyoga\routine.v2.json

The project is at C:\Users\AISTUDIO\Downloads\Faceyoga, live at
https://faceyogga.vercel.app. Repo is finnolcc-ctrl/FaceYogga.

Scope for this session: ONLY the Exercise screen (data-screen="exercise")
and the gamification mechanic. Do not touch Home, Report, Onboarding,
test harness, routine data, or the honesty constraints.

Brainstorm the task-reward loop with me first — propose 2–3 directions,
I'll pick one, we align before you write code.
```
