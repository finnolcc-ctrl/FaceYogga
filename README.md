# Face Yoga — Week 1

Prove MediaPipe Face Landmarker runs on a real iPhone 15 and emits live blendshape scores. No UI yet, no scoring, no rounds — just camera → model → nine live values on screen.

## What's in week 1

- `index.html` — intro screen + camera stage
- `app.js` — camera + MediaPipe Face Landmarker, 9 blendshape readouts
- `style.css` — minimal mobile dark UI

## Run it locally (optional)

iOS Safari refuses the camera over plain `http://`, so local testing has a catch. Two paths:

**Easiest:** skip local, deploy straight to Vercel (below).

**If you want local:** install the VS Code "Live Server" extension or run any HTTPS static server. Chrome on your laptop will work for a desktop smoke test over `http://localhost`.

## Deploy to Vercel (recommended, 5 minutes)

Vercel gives you a free HTTPS URL that your iPhone can open.

1. Create a free GitHub account if you don't have one.
2. In GitHub, create a new empty repository named `faceyoga` (public is fine).
3. In this folder, open PowerShell and run:
   ```
   git init
   git add .
   git commit -m "Week 1 scaffold"
   git branch -M main
   git remote add origin https://github.com/<your-username>/faceyoga.git
   git push -u origin main
   ```
4. Go to <https://vercel.com> and sign in with GitHub.
5. Click **Add New → Project**, select the `faceyoga` repo, click **Deploy** (no build settings needed — Vercel serves static files automatically).
6. Within a minute you'll get a URL like `https://faceyoga-xxxx.vercel.app`.
7. Open that URL on your iPhone 15, tap **Start camera**, allow permission.

Every `git push` after this re-deploys automatically.

## What to verify on the iPhone

- [ ] Page loads
- [ ] Tap **Start camera** → iOS prompts for permission → you accept
- [ ] Front camera preview appears, mirrored
- [ ] Top-left shows "face · 478 landmarks"
- [ ] Top-right shows ~25–30 fps
- [ ] Bottom panel: nine blendshape bars respond when you smile, open your mouth, raise brows, blink
- [ ] Screen does NOT dim while you're on this page (wake lock)

If any of those fail, see the troubleshooting notes below.

## Troubleshooting (iOS Safari)

| Symptom | Likely cause | Fix |
|---|---|---|
| Button does nothing, no permission prompt | Not HTTPS | Deploy to Vercel; iOS requires HTTPS for camera |
| "Permission denied" | You tapped Don't Allow earlier | Settings → Safari → Camera → Ask or Allow |
| Camera opens but preview black | iOS Low Power Mode suppresses `playsinline` | Turn off Low Power Mode |
| ~5 fps or lower | GPU delegate rejected | Reload; on persistent failure change `delegate: "GPU"` to `delegate: "CPU"` in app.js |
| Model never loads | CDN blocked by school network | Try on cellular, or self-host the `.task` file |
| Screen keeps dimming | Wake Lock refused | iOS 16.4+ required; also tap screen once if backgrounded |

## Debugging on iPhone from your laptop

Safari devtools can inspect your phone:

1. iPhone: Settings → Safari → Advanced → Web Inspector ON
2. Mac: Safari → Settings → Advanced → "Show Develop menu in menu bar"
3. Plug iPhone into Mac with cable
4. On Mac: Safari → Develop → \[iPhone name\] → the Vercel page

You can see the console, inspect elements, and see any errors.

If you're on Windows (no Mac): the Vercel logs show server errors, but client errors need the Mac path or a tool like `eruda` injected into the page. Shout if you want me to add `eruda` for mobile console access.

## Next (week 2)

Pick 4–5 moves and set thresholds for each in the Move Registry. We'll build the hysteresis-banded detector and the hold accumulator.
