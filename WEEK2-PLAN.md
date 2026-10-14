# Week 2 Plan — Move Registry and Detector

**Goal by end of week 2:** You can hold any one of the 5 moves for 5 seconds and watch a live score tick up to 100%. The game loop isn't built yet (that's week 3) — this proves the detector works in isolation.

## Prerequisite you need to supply

**A reference video for 5 beginner face yoga moves.** You said you'll find one. When you do, send me:
- The link
- For each move: a timestamp or a short description (one sentence) of what the move looks like

I need this because:
- Different sources teach the same move slightly differently (e.g. "big smile" with lips open vs closed)
- The MediaPipe blendshape mapping depends on what the muscles are actually doing
- Low-strain versions matter for your "rest ritual" tone

If you don't find a video that covers all 5, pick what it does cover and we'll fill gaps with my placeholder table.

## What gets built (3 deliverables)

### 1. `moves.json` — the Move Registry

Hand-authored JSON, one entry per move. Fields per move:

| Field | Example | Why it exists |
|---|---|---|
| `id` | `"big_smile"` | Stable key for persistence and threshold lookup |
| `name` | `"Big smile"` | What the user sees |
| `cue` | `"Soft smile with closed lips, feel the cheeks lift"` | One-line coaching line shown during Ready phase |
| `blendshape` | `"max(mouthSmileLeft, mouthSmileRight)"` | Formula that turns raw MediaPipe output into one 0–1 intensity |
| `pairedBlendshapes` | `["mouthSmileLeft", "mouthSmileRight"]` | Used by Form Quality AI (symmetry check) |
| `isolationPenalties` | `["jawOpen"]` | Blendshapes that should NOT activate — penalty if they do |
| `enter` | `0.35` | Intensity to count as "reached" |
| `exit` | `0.25` | Intensity to count as "dropped" (hysteresis — lower than enter so it doesn't flicker) |
| `strain` | `0.85` | Above this, feedback softens to "gently" |

**Starter table I'll propose (you confirm or replace once you have the video):**

1. Big smile — `max(mouthSmileLeft, mouthSmileRight)` — enter 0.35
2. Fish face — `mouthPucker` — enter 0.40
3. Surprised brows — `mean(browInnerUp, browOuterUpLeft, browOuterUpRight)` — enter 0.30
4. Jaw drop — `jawOpen` — enter 0.45
5. Gentle wink (L then R) — `max(eyeBlinkLeft, eyeBlinkRight)` — enter 0.60

Thresholds are starting guesses. We tune them on your face during the week.

### 2. The detector module

A single file `detector.js` that exports two functions:

- `calibrate(stream, moveId)` — collect 2 seconds of neutral face, store per-user baseline for each move's blendshapes (subtracts resting values). Called once at setup.
- `scoreFrame(blendshapeMap, move, baseline)` — returns `{ intensity, state, formQuality }` where state is one of `no-face | out | in-band | strain`.

Internals:
- Evaluates the move's `blendshape` formula on each frame
- Applies hysteresis (enter/exit bands)
- Computes form quality: symmetry across paired blendshapes + isolation penalty for unwanted muscles
- Returns a stable per-frame verdict

### 3. The debug UI (replaces the raw blendshape bars)

Same page, new overlay:
- **Dropdown** at the top: pick which move to test
- **Big ring**: fills as intensity rises toward target band, softens past strain
- **State pill**: `no face | almost there | in band | too strong`
- **Timer bar**: fills for 5 seconds while you hold, resets if you drop
- **Score tile**: % of hold-phase time spent in band
- **Form quality bar**: how symmetric and isolated the expression is

This is the week 3 game loop UI in miniature. Reusable later.

## What is NOT built in week 2 (deferred)

- The round state machine (Ready → Hold → Result → Rest)
- Star scoring (3/2/1)
- Streaks, sessions, Report screen
- Home screen, session cards
- The Adaptive Personalization AI (needs session history — comes week 3 or 4)
- The warming overlay

Those are week 3+.

## Decisions still open (flag these in your reply)

1. **Reference video** — need the link + per-move notes
2. **Calibration prompt wording** — "Hold a neutral face" vs "Just relax your face for 2 seconds" vs something else?
3. **Hold duration for debug** — 5 seconds matches the real game, or longer (10s) for easier tuning?
4. **Starting thresholds** — trust my starter numbers above and tune on your face, or do you want to pick them yourself first?

## Timeline inside the week

Day 1–2: You send the reference video. I write `moves.json`, you review the cues/names.
Day 3–4: I build `detector.js` and the debug UI. You test on your phone and we iterate on thresholds.
Day 5: Form Quality AI (symmetry + isolation). Form quality score shows up alongside intensity.
Day 6–7: Buffer for threshold tuning. By end of week: hold a smile for 5 seconds, see a real score.

## Risks for week 2

- **MediaPipe blendshape values on YOUR face at rest may be nonzero.** That's what calibration solves. Risk: if your resting values are already very high for some blendshapes (common for `browInnerUp` on some faces), the enter threshold has no headroom. Mitigation: calibration normalizes it. If it still doesn't work for a specific move, we drop or replace that move.
- **Formula ambiguity.** "Big smile" might activate `mouthSmileL/R` AND `cheekSquintL/R` AND `mouthStretchL/R`. The formula is a choice — the video reference helps me pick the right primary signal.
- **Debug UI on phone.** Dropdowns on iOS Safari with the camera running might flicker. Mitigation: pause the camera while the menu is open.

## Review checklist for you

Read the plan and tell me:
- [ ] Does the move list match what your reference video shows?
- [ ] Is the debug UI the right thing to see first, or do you want the real round loop (Ready/Hold/Result) in week 2 instead?
- [ ] Any face yoga moves you specifically want in the list that aren't there?
- [ ] Comfortable with the 5-day day-by-day pace, or want it compressed/stretched?

When you reply with the video + answers, I'll start writing `moves.json`.
