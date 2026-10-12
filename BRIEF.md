# Face Yoga Prototype — Brief

Mobile web app: a short, game-like face yoga break. The front camera tracks visible facial movements and gives live feedback. A rest ritual, not a beauty product. No beauty claims.

## Platform
- Mobile web app, portrait only, runs in the phone browser (iOS Safari and Android Chrome)
- No app store, no backend, no accounts
- MediaPipe Face Landmarker in-browser for expression scores
- Data stays on device (localStorage)

## Session structure
Round ~ 11 seconds: Ready (3s) → Hold (5s) → Result (2s) → Rest (1s).
- Quick Break: 4 rounds
- Classic: 6 rounds
- Full Face: 8 rounds

## User flow
Intro + privacy → camera permission → Home (streak, 3 cards, Progress) → session detail → setup check (face/distance/light + 2s stability) → countdown → round loop → Finish → Report → Progress tab (parallel).

## Live feedback (Hold phase)
- No face: ring pauses, "Come back into view"
- Not reached: "Almost there"
- Reached: ring fills, "Nice, keep it up"
- Too strong: ring fills, color softens, "Gently, no need to push"
- Dropped mid-hold: pause, don't reset, "Back to it"
- Face lost 3s+: auto-pause

## Scoring
- 3 stars: ~90%+ time in band
- 2 stars: ~60%+
- 1 star: anything less if the user tried (floor of 1)
- Full marks come from a comfortable target, not biggest expression

## Tone
Relaxed and encouraging. No failure states, no competition.

## 5-week plan
1. Camera + face tracking on a real phone, live expression values
2. Detection + thresholds for 4–5 moves
3. Round loop with ring, timer, star scoring
4. Mobile UI polish, end screen, streaks, wake lock
5. Testing (5–10 people, varied phones/light), fixes, demo prep

## Risks
iOS camera rules (HTTPS + tap-first), performance on older phones, screen sleep, lighting. Test on real iPhone week 1.

---

# System Design Decisions

See `system-map.svg` for the visual.

## Layers
1. **User Surface** (visible): Permission → Home → Round loop → Report
2. **Session Orchestrator** (hidden, algorithmic): state machine, timers, wake lock, visibility handler
3. **Perception AI**: MediaPipe Face Landmarker (pre-trained CV neural net, in-browser inference, 52 blendshapes/frame)
4. **Interpretation** (hidden): setup quality, move detector (hysteresis), hold accumulator, scorer — includes **Form Quality AI** for symmetry + isolation signals
5. **Personalization AI**: adaptive thresholds from on-device session history (running percentiles, clamped ±25%)
6. **Configuration**: Move Registry JSON (hand-authored, read-only at runtime)
7. **Persistence**: localStorage (streak, calibrationBaseline, sessions)

## Three AI components
- **Perception AI**: MediaPipe (pre-trained, no training data needed)
- **Form Quality AI**: symmetry + isolation analysis of blendshape output
- **Personalization AI**: on-device learning loop from user history

Stretch (week 5): LLM-generated report reflection.

## Decisions locked
- Move Registry: JSON file, hand-authored
- Progress tab: pure read, no AI
- Calibration: 2s neutral face at setup check, personal baseline subtraction

## Conflict resolution
| Conflict | Resolution |
|---|---|
| Face briefly lost | Pause ring; auto-pause after 3s continuous |
| Ambiguous expression | Hysteresis band |
| User can't reach target | 1-star floor + reframed copy |
| Marginal setup | 2s stability before advance |
| Lighting drops mid-session | Hint only, don't end |
| Multiple faces | Pick largest bbox |
| Tab backgrounded | Visibility API pauses |
| Too-strong expression | Still scores; copy softens |
| Adaptive threshold drift | Clamp ±25% of registry defaults |

## Not needed yet
Full UI kit, brand logo, backend, user accounts, character, animation assets.
