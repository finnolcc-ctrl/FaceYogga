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
- Desktop previews use an iPhone 13 logical viewport of 390 × 844 CSS pixels with 47px top / 34px bottom preview safe areas. Short desktop windows scale the entire device uniformly instead of shortening its viewport. Typography and artwork use device dimensions rather than host-window dimensions. Verified at 1280 × 720 and 1440 × 1000, plus mobile 390 × 844; real phones fill their viewport and use native safe-area insets without a decorative device border.

## Camera mirror feedback

- The native mirror has a transparent canvas using the existing Face Landmarker results. No additional inference, segmentation, camera stream or video-frame copy is introduced.
- The shared cue painter draws the same arrows, cheek marks, lip hold and completion ripple in both views. Mirror anchors use measured landmarks with the video's `object-fit: cover`, `object-position: 50% 42%`, and one matching CSS horizontal flip. Hold ink follows the measured outer lip contour.
- Pausing, demos, missing/stale tracking and leaving Camera view clear the overlay. View changes leave the hold gate and round count unchanged.
- Geometry tests cover landscape/portrait crops, head translation/roll, resize, invalid landmarks and partial/full lip traces. App tests cover detected and timed feedback and clearing behavior.
- The synthetic video fixture supports `?pose=u&camera=1&mirror=1&feedback=round-lips`, `feedback=hold` or `feedback=ripple`. Its animated landmark fixture matches the drawn test video and does not access the user's camera. Real-camera alignment and device performance still need a manual check.
