# Prototype flow — November 2026

This is the current implemented user surface. `system-map.svg`, `BRIEF.md` and `ARCHITECTURE.md` describe the original design concept; their planned AI roles are represented here as explicitly labelled previews.

## Connected paths

Introduction → preferences → personalized plan → routine detail → camera choice → setup / calibration (camera only) → demonstration → 3–2–1 → practice → finish → session report → form analysis → next plan.

Home also links directly to full practice, a single-move quick experience, progress, preferences, privacy and introduction. Progress opens saved session reports or a separate example report.

| Original flow | Current prototype |
| --- | --- |
| Intro + privacy | Introduction with optional setup; accessible privacy explanation |
| Home with three sessions | One full-practice entry + plan page offering Quick break (3 moves), Daily balance (5), Full practice (7) |
| Personalization AI | Preferences choose a suggested routine; latest unfinished movement provides a revisit suggestion; adaptive target range is an illustrative mock and never changes detection |
| Session detail | Actual selected moves, approximate duration, camera-supported vs timed labels |
| Setup and calibration | Existing live face setup and per-session pose calibration retained |
| Round loop | Existing demonstration, separate countdown, detected or timed movements, arrows, hold traces and ripples retained |
| Finish | Separate completion / ended-early page, then report |
| Report | Actual move statuses and camera vs self-confirmed provenance; retained report time comes from that session |
| Form Quality AI | Per-move radar with balance, isolation, control and their rounded average. Scores are preset prototype data. |
| Progress | Rolling seven days, completed-practice and move totals, up to 30 historical summaries, selectable reports |
| Empty states | No-history state, isolated example report, no analysis when no movements were performed |

The three routines reuse the approved seven-move registry. They intentionally supersede the old 4/6/8-round concept. Listed durations are estimates for guided practice and exclude camera setup, calibration and user-paced demonstrations.

## Data boundaries

- `faceyoga.v2` stores preferences, introduction dismissal, and actual session summaries with `planId`.
- Existing saved sessions without `planId` remain readable as full practice.
- Quick single-move experiences do not enter full practice history.
- Completed moves count from camera confirmation or explicit self-confirmation. All-skipped attempts are visible in history but do not increase completed-practice totals or streaks.
- Example session and form-review objects are generated in memory, never saved, and never contribute to progress or live tracking.
- Actual detection remains MediaPipe + rules + current-session calibration. The portrait rendering is a separate visual layer.
- The old seven-page onboarding is replaced in the runtime. Legacy onboarding assets/styles remain on disk for design reference.

## Verification

`node --test tests/*.test.mjs`

Regression coverage includes plan selection and saved identity, correct movement names for subsets, skipped-only streak handling, bounded personalization, guidance, camera gates, mock/history isolation and progress dates.
