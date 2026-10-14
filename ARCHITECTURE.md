# Face Yoga — Architecture Guide

A walk through how this app is put together, written for a designer. The goal: by the time you finish reading, you can point at any part of the running app and know which layer it belongs to, what decides what, and where AI lives.

Companion files: `BRIEF.md` (what we're building and why), `system-map.svg` (one-page visual), `WEEK2-PLAN.md` (next step).

---

## 1. The one-paragraph version

The app runs entirely in your phone's browser. The camera feed goes into a pre-trained AI model (MediaPipe) that outputs 52 numbers describing your current facial expression. A rule-based interpretation layer turns those numbers into "are you doing the move or not" and keeps a running score. A session orchestrator counts down rounds, drives the UI, and saves results to the phone's local storage. Nothing leaves your phone. A second, lighter AI watches your form (symmetry and isolation). A third AI learns your personal range over time and quietly adjusts thresholds so the app meets you where you are. That's the whole system.

---

## 2. The mental model

Picture the app as **four nested jobs** happening at different speeds.

| Speed | Job | Example |
|---|---|---|
| ~30 times per second | **See** | The camera takes a frame, the AI reads your expression |
| ~30 times per second | **Judge** | Did that frame count toward the move? |
| Once per round (every 11 sec) | **Decide** | How many stars? Advance to next round? |
| Once per session or less | **Remember + adapt** | Save results, update thresholds, update streak |

Everything the user sees — the ring filling, feedback text, star awards, streak dots — is a reflection of these four jobs humming along. If you understand which job owns which decision, you understand the system.

---

## 3. The seven layers

Reading top-down: what the user sees, down to where data lives.

### Layer 1 — User Surface (visible)

What's on screen at any moment.

**Screens:**
- Intro & privacy
- Camera permission
- Home (streak, 3 session cards, Progress tab link)
- Session detail (list of moves + Start)
- Setup check (face/distance/light + calibration)
- Countdown (3, 2, 1)
- Round view (Ready → Hold → Result → Rest cycles)
- Finish ("all done")
- Report (stars, strongest move, gentle suggestion)
- Progress tab (streak, weekly dots, totals, best session)

**Responsibilities:**
- Show what the orchestrator tells it to show
- Pass user taps back to the orchestrator (Start, Pause, End)
- Nothing else — the UI never decides anything about scoring or move detection

**File homes:** `index.html` (structure), `style.css` (visual), fragments of `app.js` that call `document.getElementById(...).textContent = ...`.

### Layer 2 — Session Orchestrator (hidden, algorithmic)

The conductor. Doesn't do perception, doesn't score, doesn't personalize — but tells everything else when to run.

**Responsibilities:**
- Owns the state machine: `idle → permission → setup → countdown → round(ready|hold|result|rest) → finish → report`
- Owns timers (3s ready, 5s hold, 2s result, 1s rest)
- Owns the wake lock (keeps the screen on)
- Owns the visibility handler (pauses when the tab is hidden)
- Counts rounds, decides when a session is complete
- Tells Layer 1 what to show
- Tells Layer 4 "a hold phase is starting, start accumulating" and "stop, give me the final percentage"

**File home:** will be `orchestrator.js` in weeks 3–4. Doesn't exist yet in week 1.

### Layer 3 — Perception AI ⭐

This is the real AI. MediaPipe Face Landmarker, a trained neural network running inside your phone's browser.

**What it is:**
- A face detector + a face mesh model, both pre-trained by Google
- Downloaded once (~3 MB), cached forever after
- Runs inference in WebGL (on your GPU) at ~30 frames per second

**What it does per frame:**
- Finds the biggest face in view
- Marks 478 landmark points on it (eyes, mouth, jaw, brow, every corner)
- Computes 52 **blendshape** scores (0 to 1 each) — "how much of each facial muscle action is happening right now"
- Computes a 4×4 matrix describing head pose (used by Form Quality later)

**What it does NOT do:**
- No training on your face. The model is static.
- No decisions. It's a measurement device, not a judge.
- No knowledge of face yoga moves. It only knows "muscle actions."

**Why calling this AI is accurate:** it's a neural network making predictions. The fact that we didn't train it ourselves is irrelevant — using pre-trained models is how 95% of production AI works. The alternative (training our own face expression classifier for a 5-week prototype) would be silly and worse.

**File home:** loaded as an ES module from a CDN inside `app.js`. The model file (`face_landmarker.task`) is served from Google's storage.

### Layer 4 — Interpretation (hidden, rule-based, hosts one AI)

Takes the raw 52 blendshape numbers each frame and turns them into "is the user doing the move or not."

**Four sub-modules:**

**4a. Setup Quality Checker**
- Face present? ✓
- Face big enough in frame (distance OK)? ✓
- Lighting OK (average pixel brightness in acceptable band)? ✓
- Stays all-green for 2 seconds? Advance.
- Any flips to red? Reset the 2-second timer.

**4b. Move Detector**
Reads the Move Registry (JSON file) to know what formula each move uses:
```
"big_smile":    max(mouthSmileLeft, mouthSmileRight)
"fish_face":    mouthPucker
"brows_up":     mean(browInnerUp, browOuterUpLeft, browOuterUpRight)
"jaw_drop":     jawOpen
"wink_slow":    max(eyeBlinkLeft, eyeBlinkRight)
```
Each formula → one 0–1 intensity number per frame.

**Hysteresis** (the subtle part): if `enter = 0.35` and `exit = 0.25`, the move becomes "reached" when intensity crosses 0.35, and only drops when it falls below 0.25. The gap stops it from flickering at exactly 0.35. Think of a thermostat.

**4c. Form Quality AI ⭐** (the second AI role, mentioned in the system map)

Lives inside Interpretation but is still AI, because it extracts meaning from the ML output beyond "did it cross a threshold." Two signals:
- **Symmetry:** `|mouthSmileLeft − mouthSmileRight|` — low number means balanced, high means lopsided
- **Isolation:** penalty if `jawOpen` activates during Big Smile, or `mouthFunnel` activates during Brows Up, etc. — tells you if you're straining the wrong muscles

Combined into a `formQuality` score 0–1 alongside intensity.

**4d. Hold Accumulator + Scorer**

While a Hold phase is running (5 seconds):
- Each frame has one of these labels: `no-face / out / in-band / strain`
- Count the `in-band` frames
- At end of Hold: `pctInBand = inBandFrames / totalFrames`
- Combine with formQuality → final star count:
  - 3 stars: `pctInBand ≥ 0.90` and `formQuality ≥ 0.7`
  - 2 stars: `pctInBand ≥ 0.60`
  - 1 star: anything else, if the user tried (floor of 1 — nobody gets zero)

**File home:** will be `detector.js` in week 2.

### Layer 5 — Personalization AI ⭐ (the third AI role)

Lives beside Layer 4, runs on a slower clock.

**What it does:**
- Reads your last N sessions from local storage
- For each move, computes running percentiles of the intensities you've actually produced
- Writes a personalized set of `enter` / `exit` / `strain` thresholds back into a working copy of the Move Registry
- Clamped: never more than ±25% from the registry defaults, so a bad week doesn't make the app pointlessly easy

**Why this counts as AI:** it's a learning loop. The app's behavior adapts to the user from the user's own data. You don't need a deep neural network for something to be AI — adaptive personalization from history is a legitimate ML technique (often called "on-device personalization" when it runs on the phone without a server).

**When it runs:** once at the Setup Check, before the first round. One quick pass over your stored history, writes personalized thresholds into memory for this session only.

**File home:** will be `personalization.js` in week 3 or 4.

### Layer 6 — Configuration (static data)

`moves.json` — hand-authored by me (the human). Lists every move the app supports, with:
- Human-readable name and cue
- The blendshape formula
- Default thresholds
- Which paired blendshapes to check for symmetry
- Which other blendshapes to penalize for isolation

**Why it's a layer:** separating "which moves exist and what they look like" from the detector code means we can add or tune moves without touching JavaScript. It's a data layer.

**File home:** will be `moves.json` in week 2.

### Layer 7 — Persistence (data lives here)

Your phone's `localStorage`. One JSON blob under the key `faceyoga.v1`:

```
{
  "streak": 7,
  "lastSessionDate": "2026-10-18",
  "calibrationBaseline": {
    "mouthSmileLeft": 0.08,
    "mouthSmileRight": 0.06,
    ... (one per watched blendshape)
  },
  "sessions": [
    {
      "date": "2026-10-18",
      "type": "classic",
      "rounds": [
        {
          "moveId": "big_smile",
          "pctInBand": 0.92,
          "formQuality": 0.81,
          "stars": 3
        },
        ...
      ]
    },
    ...
  ]
}
```

**Rules:**
- Written only by the Orchestrator (end-of-session) and by Setup Check (calibration baseline)
- Read by Personalization AI and by the Progress tab
- Never leaves the device. Nothing is uploaded.
- Capped: we keep the last ~30 sessions, prune older ones

**File home:** no file of its own — it's the browser's storage. Access wrapped in `storage.js` later.

---

## 4. How a single frame flows through the system

Think of this as what happens 30 times a second during a Hold phase:

```
Camera frame
   │
   ▼
Perception AI (MediaPipe)
   │  → 478 landmarks + 52 blendshape numbers + head pose matrix
   ▼
Interpretation
   │  → active move's formula applied → intensity (0–1)
   │  → hysteresis band → state (no-face | out | in-band | strain)
   │  → Form Quality AI → formQuality (0–1)
   │  → Hold Accumulator ticks: in-band frame #137 / 150
   ▼
Orchestrator
   │  → is Hold phase done (5s elapsed)? no → continue
   │  → yes → ask Scorer for final percentage
   │  → compute stars
   │  → advance state machine to Result
   ▼
User Surface
   │  → ring fill proportion changes
   │  → feedback text changes
   │  → state pill changes color
```

Nothing between Perception and User Surface takes longer than ~5 milliseconds. The whole loop fits in one frame.

---

## 5. How a whole session flows

```
Tap session card
   │
   ▼
Setup Check (face/distance/light + 2s stability)
   │  → Calibration: 2s of neutral face → baseline saved to localStorage
   │  → Personalization AI reads history → personalized thresholds for this session
   ▼
Countdown (3, 2, 1)
   │
   ▼
Round 1
   ├─ Ready (3s): show move name, cue, "Get ready"
   ├─ Hold  (5s): perception + interpretation + accumulator running
   ├─ Result (2s): star count flashes
   └─ Rest  (1s): breath, next move
   │
   ▼
Round 2, 3, ..., N
   │
   ▼
Finish screen ("all done")
   │
   ▼
Report
   │  → Total stars, per-move breakdown, strongest move
   │  → Gentle suggestion (lookup from weakest move → fixed copy)
   │  → Streak updated and saved
   ▼
Home screen (updated streak visible)
```

Only two writes to localStorage per session: calibration baseline at setup, and the full session summary at Finish.

---

## 6. Who decides what (the authority map)

When you look at any decision in the app, you can trace which layer owns it.

| Decision | Owner | Why |
|---|---|---|
| What session to run | User | Only user-facing choice, by design |
| When to start a round | Orchestrator | Timing policy belongs to the conductor |
| Is a face in view? | Interpretation (Setup Quality) | Reads perception output |
| Is the move being done? | Interpretation (Move Detector + hysteresis) | Reads perception output + registry |
| How many stars? | Interpretation (Scorer) | Deterministic math on accumulator |
| What feedback text to show? | Orchestrator | Picks from a small fixed list based on state |
| Should the ring flicker? | NO — hysteresis prevents this | Design constraint enforced in Interpretation |
| How strict are thresholds? | Personalization AI | Reads history, writes working thresholds |
| When to auto-pause | Orchestrator | After 3s of no-face from Interpretation |
| What goes on Report | Orchestrator | Reads scorer output + storage |

The user chooses what to do; the orchestrator chooses when; the interpretation chooses whether; the personalization chooses how strict. Clean separation.

---

## 7. Conflicts and how they resolve

Every real system has edge cases. Our map tracks these:

| Conflict | Resolver | How |
|---|---|---|
| Face briefly lost | Orchestrator | Pause ring immediately; auto-pause only after 3s continuous loss |
| Multiple faces in frame | Interpretation | Pick largest bounding box |
| Expression on threshold edge | Interpretation (hysteresis) | Enter/exit band prevents flicker |
| User can't reach target | Scorer | 1-star floor, encouraging copy |
| Marginal setup conditions | Setup Quality | 2s stability window before advancing |
| Lighting drops mid-session | Interpretation | Hint only, don't end session |
| Tab backgrounded | Orchestrator (Visibility API) | Pause automatically |
| Too-strong expression | Interpretation | Still scores; copy softens |
| Personalization drifts too far | Personalization AI | Clamp ±25% of registry defaults |
| Camera permission denied | Orchestrator | Pre-permission screen explains why; link to settings |

---

## 8. Where each AI role plays its part

The system has three AI roles, each playing a distinct part. Think of them like three characters in a short play:

**Perception AI** — the senses. Watches, measures, reports facts. Doesn't judge. (MediaPipe. ~30fps. Pre-trained. No learning.)

**Form Quality AI** — the coach's eye. Looks past "did you do it" to "how well did you do it" — balanced? isolated? (Rules on top of MediaPipe output. Still AI because it extracts meaning the model doesn't directly output.)

**Personalization AI** — the teacher who remembers you. Notices what range you naturally hit, calibrates expectations so you aren't rated against a stranger. (On-device learning loop. Runs once per session. No neural network needed — percentiles do the work.)

Stretch role (week 5 if time): **LLM Report Reflection** — writes a 1–2 sentence encouraging summary in the Report instead of a lookup from fixed strings. Needs a tiny backend. Deferred because the first three are enough to tell the "this is an AI product" story.

---

## 9. File map (what will exist by end of 5 weeks)

```
Faceyoga/
├── index.html          # Entry point, structure of every screen
├── style.css           # All visual styling, dark theme, mobile-first
├── app.js              # Current MediaPipe setup, will shrink as modules split out
├── orchestrator.js     # (week 3) State machine, timers, round control
├── detector.js         # (week 2) Interpretation layer: setup check, move detector, form quality, accumulator
├── personalization.js  # (week 4) Adaptive threshold engine
├── storage.js          # (week 3) Wrapper around localStorage
├── moves.json          # (week 2) Move Registry — hand-authored data
├── vercel.json         # Deploy config (headers, caching)
├── BRIEF.md            # Project brief + locked decisions
├── ARCHITECTURE.md     # This file
├── WEEK2-PLAN.md       # What ships next
├── README.md           # How to deploy and test
└── system-map.svg      # One-page visual of the layers
```

Each JS file is ~100–300 lines, importable by any other. No build step. No framework. No npm install. Open the HTML, run the JS.

---

## 10. Glossary

Terms a design student might not immediately know, in order of appearance in the system:

**Blendshape** — a 0-to-1 number from MediaPipe describing how much of one facial muscle action is happening right now. There are 52 of them (smile left, smile right, jaw open, eye blink left, brow inner up, etc.). The whole app is built on top of these numbers.

**Landmark** — a (x, y, z) point marking a specific spot on the face (corner of mouth, tip of nose, etc.). MediaPipe outputs 478 of them per frame. We don't use most of them directly — we use the blendshapes, which are already derived from the landmarks.

**Hysteresis** — a two-threshold trick (enter at 0.35, exit at 0.25) that prevents a measurement from flickering when it hovers near the boundary. Named after an old physics concept, same idea.

**Inference** — running a trained AI model to get a prediction from a new input. The opposite is *training* (teaching the model from data). We only do inference.

**ES module** — modern JavaScript's way of splitting code into files that `import` from each other. Loaded via `<script type="module">` tags.

**Wake lock** — a browser API that keeps the screen on. iOS Safari supports it from version 16.4. Critical for a hands-free app.

**Hysteresis vs threshold** — one threshold = flickers at the edge; hysteresis = clean on/off, like a thermostat.

**State machine** — a formal way of saying "the app is always in exactly one of these named states, and only certain transitions between them are allowed." It's how we keep timers, UI, and audio from going out of sync.

**On-device** — happens on the user's phone, not on a server. All three AI roles here are on-device. This is a privacy and latency win.

**Hand-authored** — written by a human, not generated or trained. The Move Registry is hand-authored; the Perception model is trained.

---

## 11. What this document is for

If you're explaining the project to a professor, a classmate, a reviewer, or your future self:
- Section 2 is your 30-second elevator pitch
- Section 3 is your 5-minute walkthrough
- Section 8 is your "where's the AI" answer
- Section 6 is your "who decides what" answer
- The `system-map.svg` is your one-slide image

Open to feedback — tell me what feels thin, confusing, or missing, and I'll expand or revise that section.
