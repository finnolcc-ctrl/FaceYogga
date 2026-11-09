# Training regression checks

Run `node --test tests/*.test.mjs` from the project root (Node 20+, no install).

- `tracking.test.mjs`: calibrated directional matching, A/E/U separation, over-range movements, small personal ranges, head-pose rejection, frame gaps, aspect ratios and continuous holds.
- `app.test.mjs`: runs the actual application logic in a DOM stub with synthetic camera results; checks eight-step calibration, full-cycle counting, circle reversal, skipped calibration, pause/lost tracking and honest timeout handling.
- `/test.html`: interactive synthetic face controls. Its Match value now uses the same detector as training. Reference poses are synthetic fixtures, not measurements of a real person.
- `/tests/ui-preview.html?screen=calibration&pose=u`: production markup with static illustration/progress data. Also accepts `screen=exercise&pose=a&camera=1`. Camera area is intentionally empty.

Before evaluating real recognition, enter Mirror mode and complete fresh calibration in comfortable poses. Check both sides, A/E/U transitions, head turns, face loss and pause/resume. The synthetic tests do not establish recognition accuracy on a live face or across devices.

## Animated portrait and soft oval mirror (2026-10-28)

- Tests cover a separate demonstration and 3-second countdown, pausing, skipping, head framing,
  directional lip shapes, and switching views without resetting movement/hold progress.
- `/tests/ui-preview.html?pose=left&camera=1&intro=1` runs the production intro and
  transition without requesting a camera (tap “I’m ready” on the first move). Omit `intro=1` for a stable layout check.
- Camera mode directly displays the same video used by face tracking, with a CSS
  oval gradient mask. It retains some background inside the mirror. No second model,
  segmentation worker, bitmap transfers, or per-frame mask/compositing pass remains.
  The hidden line portrait is not redrawn in Camera mode.
- `/tests/ui-preview.html?camera=1&mirror=1&pose=u` uses a generated canvas stream to check the real
  video element, mask, and view switch without accessing a physical camera.
- Physical-device frame rate and face-tracking accuracy still require a live check.

## Portrait hold ring and contained phone preview (2026-11-09)

- The visible ring reads the actual continuous detection hold on every model frame. Wrong poses, face loss and pauses reset it; target transitions restart it; only a fully confirmed move leaves it complete.
- In guided / uncalibrated practice the ring reads the scheduled phase's elapsed time, is labelled “Timed”, and freezes with pause/replay. It never awards camera confirmation.
- The active screen keeps detailed cues accessible but visually concentrates on the live portrait. Demonstrations and replay retain the full tutorial; framing/lost-face notices stay visible on the portrait.
- `tests/ui-preview.html?pose=left&camera=1` shows a static 60% ring and synthetic portrait; `&mirror=1` checks the native mirror with generated video. These are layout fixtures, not live recognition tests.
- Desktop previews are bounded to 420 × 844 CSS pixels and available viewport height. Verified at 1280 × 720 and 1440 × 1000, plus mobile 320 × 568 and 390 × 844; mobile fills the viewport without a decorative device border.
