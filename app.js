// Face Yoga MVP — Guided-first prototype.
// Spec: CLAUDE_HANDOFF v0.2 + routine.v2.json.
// Camera matching uses per-session calibration; uncalibrated moves stay guided.

import {
  FaceLandmarker,
  FilesetResolver,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.0/vision_bundle.mjs";

import { measureFace, medianSample, calibrationIssue, samplesAreStable, canMatch,
  evaluatePose, advanceHold, containTransform } from "./tracking.mjs";
import { POSES, CALIBRATION_STEPS, mouthDiagram, calibrationDiagram, guideKey, guideSequence } from "./guidance.mjs";

const STORAGE_KEY = "faceyoga.v2";
const MP_VERSION = "1.1.0";
const MODEL_URL  = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

// =====================================================
// FACE MODEL — line-art portrait
// Camera video is hidden; the canvas paints warm ivory
// and draws a refined hairline-contour face.
//   - face oval (whisper-thin)
//   - brows + nose bridge (thin)
//   - eye contours (crisp)
//   - lip contours with a single rose accent
//   - 7 small key-point dots with a soft halo
// Everything is drawn with smooth quadratic curves so
// the geometry reads as designed, not polygonal.
// =====================================================
const SHOW_STICKERS = false;

const CONTOURS = {
  oval:      [10,338,297,332,284,251,389,356,454,323,361,288,397,365,379,378,400,377,152,148,176,149,150,136,172,58,132,93,234,127,162,21,54,103,67,109],
  leftBrow:  [46,53,52,65,55,107,66,105,63,70],
  rightBrow: [276,283,282,295,285,336,296,334,293,300],
  leftEye:   [33,246,161,160,159,158,157,173,133,155,154,153,145,144,163,7],
  rightEye:  [362,398,384,385,386,387,388,466,263,249,390,373,374,380,381,382],
  noseBridge:[168,6,197,195,5,4,1],
  lipsOuter: [61,185,40,39,37,0,267,269,270,409,291,375,321,405,314,17,84,181,91,146],
  lipsInner: [78,191,80,81,82,13,312,311,310,415,308,324,318,402,317,14,87,178,88,95],
};
const KEY_DOTS = [10, 33, 263, 1, 61, 291, 152];
const STICKER_SLOTS = {
  brow_green_l:  { anchor: 55,  size: 18, offset: [0, 0],  imageUrl: "stickers/brow.svg"   },
  brow_green_r:  { anchor: 285, size: 18, offset: [0, 0],  imageUrl: "stickers/brow.svg"   },
  temple_l:      { anchor: 70,  size: 12, offset: [0, 0],  imageUrl: "stickers/temple.svg" },
  temple_r:      { anchor: 300, size: 12, offset: [0, 0],  imageUrl: "stickers/temple.svg" },
  cheek_star_l:  { anchor: 234, size: 18, offset: [0, 0],  imageUrl: "stickers/cheek.svg"  },
  cheek_star_r:  { anchor: 454, size: 18, offset: [0, 0],  imageUrl: "stickers/cheek.svg"  },
  nose_bow:      { anchor: 1,   size: 12, offset: [0, 0],  imageUrl: "stickers/nose.svg"   },
  chin_l:        { anchor: 148, size: 14, offset: [0, 0],  imageUrl: "stickers/chin.svg"   },
  chin_r:        { anchor: 377, size: 14, offset: [0, 0],  imageUrl: "stickers/chin.svg"   },
};
// Dots at these landmark indices get skipped — the sticker takes the dot's visual slot.
const STICKER_ANCHORS = new Set(
  Object.values(STICKER_SLOTS).map((s) => s.anchor)
);
// StickerLayer manages HTML img elements positioned over the mesh.
// Keeps SVG fidelity (gradients + filters + foreignObject all render natively).
class StickerLayer {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this.imgs = {};
    this.built = false;
  }
  ensureBuilt() {
    if (this.built || !this.container || !SHOW_STICKERS) return;
    for (const key in STICKER_SLOTS) {
      const slot = STICKER_SLOTS[key];
      if (!slot.imageUrl) continue;
      const img = document.createElement("img");
      img.src = slot.imageUrl;
      img.alt = "";
      this.container.appendChild(img);
      this.imgs[key] = img;
    }
    this.built = true;
  }
  update(landmarks, canvas) {
    if (!this.container) return;
    if (!SHOW_STICKERS) {
      this.container.classList.remove("on");
      return;
    }
    if (!landmarks?.length || !canvas) {
      this.container.classList.remove("on");
      return;
    }
    this.ensureBuilt();
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    const pts = landmarks[0];
    const eyeL = pts[33], eyeR = pts[263];
    const eyeDist = eyeL && eyeR
      ? Math.hypot((eyeR.x - eyeL.x) * w, (eyeR.y - eyeL.y) * h)
      : 160;
    const scale = eyeDist / 160;
    for (const key in STICKER_SLOTS) {
      const slot = STICKER_SLOTS[key];
      const img = this.imgs[key];
      if (!img) continue;
      const p = pts[slot.anchor];
      if (!p) continue;
      const size = slot.size * scale;
      const [ox, oy] = slot.offset || [0, 0];
      // Mirror X because the display video has CSS scaleX(-1)
      const cx = (1 - p.x) * w + ox * scale;
      const cy = p.y * h + oy * scale;
      img.style.width = `${size}px`;
      img.style.height = `${size}px`;
      img.style.transform = `translate3d(${cx}px, ${cy}px, 0) translate(-50%, -50%)`;
    }
    this.container.classList.add("on");
  }
}
const Stickers = { setup: null, exercise: null };

// -------- State --------
const State = {
  routine: null,
  mode: "guided",          // "guided" | "camera_assisted_candidate"
  cameraStream: null,
  landmarker: null,
  session: null,           // active session object
  timers: { phase: null, active: null, demo: null, ready: null, rest: null, setup: null, mesh: null },
  active: null,                                       // { moveId, phase } while a phase is on-screen
  blendshapes: {},                                    // EMA-smoothed category -> score
  observations: null,                                 // { matchedMs, smileWarmth, samples }
  phaseGate: null,                                    // active detection-gated phase state
  lastLandmarks: null,                                // most recent faceLandmarks for detection logic
  calibration: null,
  calibrationRun: null,
  frameSize: { width: 640, height: 480 },
  lastFrameAt: 0,
  paused: false,
  wakeLock: null,
};

// -------- Boot --------
const IS_TEST = typeof location !== "undefined"
  && (new URLSearchParams(location.search).get("test") === "1"
      || /\/test\.html?$/.test(location.pathname)
      || window.__faceYogaTest === true);
if (!IS_TEST) {
  init().catch((e) => showDiag("init error: " + (e?.message || e)));
}

async function init() {
  const res = await fetch("routine.v2.json");
  State.routine = await res.json();

  bindActions();
  bindExerciseDialogs();
  renderHome();
  renderPreviewList();
  bootOnboarding();

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && State.session && !State.paused) {
      pauseExercise(true);
    }
  });
}

// -------- Onboarding boot & state --------
const ONBOARDING_FLOW = ["welcome", "goals", "about", "privacy", "faceScan", "teachMoves", "plan"];
const ONB_STORAGE_KEY = "faceyoga.onboarded";
const ONB_PROFILE_KEY = "faceyoga.profile";

// Onboarding is finished but not yet released — flip to true when the
// rest of the app is ready. In the meantime visit ?onboarding=1 to preview.
const ENABLE_ONBOARDING = false;

function bootOnboarding() {
  State.onboarding = loadOnboarding();
  const forcePreview = new URLSearchParams(location.search).get("onboarding") === "1";
  if (!ENABLE_ONBOARDING && !forcePreview) {
    show("home");
    return;
  }
  const done = localStorage.getItem(ONB_STORAGE_KEY) === "true";
  if (done && !forcePreview) {
    show("home");
  } else {
    show("welcome");
  }
}

function loadOnboarding() {
  try {
    const raw = localStorage.getItem(ONB_PROFILE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return {
    goals: [],
    name: "Mia",
    experience: "new",
    dailyMinutes: 4,
    reminderTime: "20:30",
    privacy: { camera: true, save: true, reminders: false, stats: false },
  };
}

function saveOnboarding() {
  try { localStorage.setItem(ONB_PROFILE_KEY, JSON.stringify(State.onboarding)); } catch {}
}

function currentOnbIndex() {
  const active = document.querySelector(".onb:not([hidden])")?.dataset.screen;
  return ONBOARDING_FLOW.indexOf(active);
}

function onbGoto(delta) {
  const i = currentOnbIndex();
  const next = i + delta;
  if (next < 0) return;
  if (next >= ONBOARDING_FLOW.length) {
    completeOnboarding();
    return;
  }
  show(ONBOARDING_FLOW[next]);
  onEnterOnbStep(ONBOARDING_FLOW[next]);
}

function onEnterOnbStep(step) {
  if (step === "faceScan") startFaceScan();
  if (step === "teachMoves") startCalibCountdown();
  if (step === "plan") {
    document.getElementById("onbPlanName").textContent = (State.onboarding.name || "Mia").toUpperCase();
    document.getElementById("onbPlanMin").textContent = State.onboarding.dailyMinutes;
  }
}

function attachCameraToElement(videoEl, stageEl) {
  if (!videoEl || !stageEl) return;
  if (State.cameraStream) {
    try {
      videoEl.srcObject = State.cameraStream;
      videoEl.play().catch(() => {});
      stageEl.classList.add("is-active");
    } catch {}
  } else {
    stageEl.classList.remove("is-active");
  }
}

async function ensureCameraStream() {
  if (State.cameraStream) return State.cameraStream;
  try {
    State.cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false,
    });
    return State.cameraStream;
  } catch {
    return null;
  }
}

function completeOnboarding() {
  State.onboarding.name = document.getElementById("onbName")?.value || State.onboarding.name;
  State.onboarding.reminderTime = document.getElementById("onbReminder")?.value || State.onboarding.reminderTime;
  saveOnboarding();
  localStorage.setItem(ONB_STORAGE_KEY, "true");
  // Release the onboarding camera so the exercise flow can request its own
  if (State.cameraStream) {
    State.cameraStream.getTracks().forEach((t) => t.stop());
    State.cameraStream = null;
  }
  if (State.onbScanTimer) { clearInterval(State.onbScanTimer); State.onbScanTimer = null; }
  if (State.onbCalibTimer) { clearInterval(State.onbCalibTimer); State.onbCalibTimer = null; }
  renderHome();
  show("home");
}

// Goals grid
function toggleGoal(key, btn) {
  const g = State.onboarding.goals;
  const idx = g.indexOf(key);
  if (idx >= 0) g.splice(idx, 1); else g.push(key);
  btn.setAttribute("aria-pressed", idx < 0 ? "true" : "false");
}

// Experience / time pills
function pickPill(groupId, val) {
  const group = document.getElementById(groupId);
  if (!group) return;
  group.querySelectorAll(".onb-pill").forEach((p) => {
    const selected = p.dataset.val === String(val);
    p.classList.toggle("is-selected", selected);
    p.setAttribute("aria-pressed", String(selected));
  });
}

// Face-scan — attaches live camera into the stage, walks fake percent to 100,
// then unlocks the Continue button
async function startFaceScan() {
  const stage = document.querySelector('.screen[data-screen="faceScan"] .onb-scan-stage');
  const video = document.getElementById("onbScanVideo");
  const pctEl = document.getElementById("onbScanPct");
  const btn   = document.getElementById("onbScanNext");
  const btnText = document.getElementById("onbScanBtnText");
  if (!stage || !pctEl || !btn) return;

  await ensureCameraStream();
  attachCameraToElement(video, stage);

  let pct = 0;
  if (State.onbScanTimer) clearInterval(State.onbScanTimer);
  pctEl.textContent = "0%";
  btn.classList.add("onb-btn-primary--idle");
  btnText.textContent = "Hold still...";
  State.onbScanTimer = setInterval(() => {
    pct = Math.min(100, pct + (3 + Math.random() * 4));
    pctEl.textContent = Math.round(pct) + "%";
    if (pct >= 100) {
      clearInterval(State.onbScanTimer);
      btn.classList.remove("onb-btn-primary--idle");
      btnText.textContent = "Continue";
    }
  }, 180);
}

// Calibration countdown — 3 → 2 → 1 → next pose
const CALIB_POSES = [
  { move: "smile", cue: "Make a soft smile, lips closed" },
  { move: "brow",  cue: "Lift your brows gently" },
  { move: "cheek", cue: "Puff your cheeks softly" },
];
async function startCalibCountdown() {
  const stage = document.querySelector('.screen[data-screen="teachMoves"] .onb-calib-stage');
  const video = document.getElementById("onbCalibVideo");
  await ensureCameraStream();
  attachCameraToElement(video, stage);

  if (State.onbCalibTimer) clearInterval(State.onbCalibTimer);
  State.onbCalibIdx = 0;
  stepCalibPose();
}
function stepCalibPose() {
  const pose = CALIB_POSES[State.onbCalibIdx];
  const countEl = document.getElementById("onbCalibCount");
  const cueEl   = document.getElementById("onbCalibCue");
  const arcEl   = document.getElementById("onbCalibArc");
  if (!pose || !countEl) return;
  cueEl.textContent = pose.cue;
  document.getElementById("onbPoseDiagram").innerHTML = mouthDiagram(pose.move);
  document.querySelectorAll("#onbCalibChips .onb-chip").forEach((c) => {
    const done = CALIB_POSES.slice(0, State.onbCalibIdx + 1).some((p) => p.move === c.dataset.move);
    c.classList.toggle("onb-chip--done", done);
    c.classList.toggle("onb-chip--outline", !done);
  });
  let n = 3;
  countEl.textContent = n;
  if (arcEl) {
    arcEl.setAttribute("stroke-dashoffset", "427");
    requestAnimationFrame(() => arcEl.setAttribute("stroke-dashoffset", "0"));
  }
  State.onbCalibTimer = setInterval(() => {
    n--;
    if (n <= 0) {
      clearInterval(State.onbCalibTimer);
      State.onbCalibIdx++;
      if (State.onbCalibIdx < CALIB_POSES.length) {
        setTimeout(stepCalibPose, 450);
      }
    } else {
      countEl.textContent = n;
    }
  }, 900);
}

// -------- Screen router --------
function show(name) {
  document.querySelectorAll("[data-screen]").forEach((el) => {
    el.hidden = el.dataset.screen !== name;
  });
  window.scrollTo(0, 0);
}

// -------- Actions --------
function bindActions() {
  document.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const action = btn.dataset.action;
    const fn = Actions[action];
    if (fn) fn(e, btn);
  });
}

// Keep modal controls reachable by keyboard without focusing the exercise behind them.
function bindExerciseDialogs() {
  const screen = document.querySelector('[data-screen="exercise"]');
  const dialogs = [...screen.querySelectorAll('.selfcheck, .pause-overlay, .demo-overlay')];
  let current = null;
  let returnFocus = null;
  function sync() {
    const next = screen.hidden ? null : dialogs.find((dialog) => !dialog.hidden);
    if (next === current) return;
    if (!current && next) returnFocus = document.activeElement;
    current = next;
    screen.querySelectorAll('.topbar-exercise, .exercise-body, .exercise-footer').forEach((el) => {
      el.inert = Boolean(current);
    });
    if (current) current.querySelector('button')?.focus({ preventScroll: true });
    else if (returnFocus?.isConnected && returnFocus.getClientRects().length) returnFocus.focus({ preventScroll: true });
  }
  dialogs.forEach((dialog) => {
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    const title = dialog.querySelector('h3');
    if (!title.id) title.id = dialog.id + 'Title';
    dialog.setAttribute('aria-labelledby', title.id);
    new MutationObserver(sync).observe(dialog, { attributes: true, attributeFilter: ['hidden'] });
  });
  new MutationObserver(sync).observe(screen, { attributes: true, attributeFilter: ['hidden'] });
  screen.addEventListener('keydown', (event) => {
    if (!current) return;
    if (event.key === 'Escape' && current.id !== 'selfcheck') {
      event.preventDefault();
      if (current.id === 'demoOverlay') hideDemoOverlay(); else resumeExercise();
    }
    if (event.key === 'Tab') {
      const buttons = [...current.querySelectorAll('button:not(:disabled)')];
      const first = buttons[0], last = buttons.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  });
}

const Actions = {
  startSession:   () => { renderPreviewList(); show("preview"); },
  flowPrevious:  () => scrollFlow(-1),
  flowNext:      () => scrollFlow(1),
  goHome:         () => { teardownExercise(); show("home"); renderHome(); },
  toPreview:      () => show("preview"),
  toCameraChoice: () => { stopCamera(); show("cameraChoice"); },
  chooseGuided:   () => { State.mode = "guided"; stopCamera(); startSession("guided"); },
  chooseCamera:   () => beginCameraSetup(),
  skipCalibration:() => { stopCalibration(); State.calibration = null; startSession("camera_assisted_candidate"); },
  togglePause:    () => (State.paused ? resumeExercise() : pauseExercise(false)),
  resume:         () => resumeExercise(),
  endSession:     () => endSessionConfirm(),
  skipMove:       () => handleSelfResult("skipped"),
  replayDemo:     () => showDemoOverlay(),
  demoDone:       () => hideDemoOverlay(),
  selfCompleted:  () => handleSelfResult("completed"),
  selfRetry:      () => handleSelfResult("retry"),
  selfSkip:       () => handleSelfResult("skipped"),
  toggleSound:    () => {
    AudioEngine.setEnabled(!AudioEngine.enabled);
    document.getElementById("soundToggle")?.classList.toggle("on", AudioEngine.enabled);
    document.getElementById("soundToggle")?.setAttribute("aria-pressed", String(AudioEngine.enabled));
    if (AudioEngine.enabled) AudioEngine.tone(660, 120, "sine", 0.08);
  },

  // ----- Onboarding -----
  onbStart:       () => onbGoto(1),
  onbNext:        () => {
    const step = document.querySelector(".onb:not([hidden])")?.dataset.screen;
    if (step === "about") {
      const nameInput = document.getElementById("onbName");
      if (nameInput) State.onboarding.name = nameInput.value.trim() || "Mia";
    }
    onbGoto(1);
  },
  onbBack:        () => onbGoto(-1),
  onbAllowCamera: async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false });
      State.cameraStream = stream;
      State.onboarding.privacy.camera = true;
    } catch {
      State.onboarding.privacy.camera = false;
    }
    onbGoto(1);
  },
  onbComplete:    () => completeOnboarding(),
  onbEditPlan:    () => onbGoto(-1),
};

// Delegate pointer handlers for goals / pills / toggles
document.addEventListener("click", (e) => {
  const goal = e.target.closest("[data-goal]");
  if (goal) {
    toggleGoal(goal.dataset.goal, goal);
    return;
  }
  const pill = e.target.closest(".onb-pill-row .onb-pill");
  if (pill) {
    const group = pill.closest(".onb-pill-row");
    const val = pill.dataset.val;
    if (group?.id === "onbExperience") { State.onboarding.experience = val; pickPill("onbExperience", val); }
    if (group?.id === "onbTime")       { State.onboarding.dailyMinutes = Number(val); pickPill("onbTime", val); }
  }
});
document.addEventListener("input", (e) => {
  if (e.target?.id === "onbReminder" && State.onboarding) {
    State.onboarding.reminderTime = e.target.value;
    const mirror = document.getElementById("onbReminderTime2");
    if (mirror) mirror.textContent = e.target.value;
  }
});
// Toggle rows
document.addEventListener("change", (e) => {
  const inp = e.target.closest(".onb-toggle input[type=checkbox]");
  if (inp && State.onboarding?.privacy) {
    State.onboarding.privacy[inp.dataset.key] = inp.checked;
  }
});

// =========================================================
// HOME
// =========================================================
function scrollFlow(direction) {
  const list = document.getElementById("movesPreviewHome");
  list.scrollBy({ left: direction * list.clientWidth * .85,
    behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
}

function renderHome() {
  const data = loadStore();
  const streak = data.streak || 0;
  const total  = data.sessions?.length || 0;

  document.getElementById("homeDate").textContent = formatDate(new Date());
  document.getElementById("streakDay").textContent = Math.max(1, streak);
  document.getElementById("streakPill").textContent = streak > 0 ? `${streak}-day streak` : "First day";
  document.getElementById("totalSessions").textContent = total;

  // Week dots: 7 days ending today
  const dotsEl = document.getElementById("weekDots");
  dotsEl.innerHTML = "";
  const today = new Date(); today.setHours(0,0,0,0);
  const activeDates = new Set((data.sessions || []).map(s => s.date));
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today); d.setDate(d.getDate() - i);
    const span = document.createElement("span");
    span.className = "d";
    span.textContent = d.toLocaleDateString("en-US", { weekday: "narrow" });
    span.setAttribute("aria-label", `${formatDate(d)}${activeDates.has(iso(d)) ? ", practiced" : ", no practice"}${i === 0 ? ", today" : ""}`);
    if (activeDates.has(iso(d))) span.classList.add("on");
    if (i === 0) span.classList.add("today");
    dotsEl.appendChild(span);
  }
  const doneThisWeek = [...activeDates].filter(d => {
    const dt = new Date(d);
    return (today - dt) <= 6 * 86400000;
  }).length;
  document.getElementById("weekSummary").textContent = doneThisWeek > 0 ? `${doneThisWeek} this week` : "Start your first";

  // Mini moves preview
  const list = document.getElementById("movesPreviewHome");
  list.innerHTML = "";
  State.routine.moves.forEach((m) => {
    const li = document.createElement("li");
    li.innerHTML = `<button class="move-preview" data-action="startSession" aria-label="View routine: ${m.title.en}">
      <span class="idx">${String(m.order).padStart(2, "0")}</span>
      <span class="move-art" aria-hidden="true"></span>
      <span class="move-name">${m.title.en}</span>
      <span class="dur">${Math.round(m.activeMs/1000)} seconds</span>
    </button>`;
    list.appendChild(li);
  });
}

function renderPreviewList() {
  const list = document.getElementById("movesListFull");
  list.innerHTML = "";
  State.routine.moves.forEach((m) => {
    const li = document.createElement("li");
    const mode = m.preferredMode === "camera_assisted_candidate" ? "Optional camera" : "Guided";
    li.innerHTML = `
      <span class="idx">${m.order}</span>
      <span class="meta">
        <span class="ttl">${m.title.en}</span>
        <span class="mode">${mode}</span>
      </span>
      <span class="time">${Math.round(m.activeMs/1000)}s</span>
    `;
    list.appendChild(li);
  });
}

// =========================================================
// CAMERA SETUP + CALIBRATION
// =========================================================
async function beginCameraSetup() {
  stopCamera();
  State.calibration = null;
  State.blendshapes = {};
  show("setup");
  const statusEl = document.getElementById("setupStatus");
  const videoEl  = document.getElementById("setupVideo");
  const ovalEl   = document.getElementById("faceOval");
  ovalEl.classList.remove("ok");

  try {
    statusEl.textContent = "Requesting camera…";
    State.cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false,
    });
    videoEl.srcObject = State.cameraStream;
    await videoEl.play().catch(()=>{});

    statusEl.textContent = "Loading model…";
    if (!State.landmarker) {
      const vision = await FilesetResolver.forVisionTasks(
        `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/wasm`
      );
      State.landmarker = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
        runningMode: "VIDEO",
        numFaces: 1,
        outputFaceBlendshapes: true,
      });
    }

    runSetupLoop(videoEl, statusEl, ovalEl);
  } catch (e) {
    statusEl.textContent = "Camera unavailable — you can switch to guided mode.";
    showDiag("camera error: " + e.message);
  }
}

function runSetupLoop(videoEl, statusEl, ovalEl) {
  const meshEl = document.getElementById("setupMesh");
  if (!Stickers.setup) Stickers.setup = new StickerLayer("setupStickers");
  let stableStart = 0;
  let lastVidTime = -1;
  const tick = () => {
    State.timers.setup = requestAnimationFrame(tick);
    if (State.landmarker && videoEl.currentTime !== lastVidTime) {
      lastVidTime = videoEl.currentTime;
      try {
        const res = State.landmarker.detectForVideo(videoEl, performance.now());
        recordTrackingFrame(res, videoEl);
        const hasFace = res.faceLandmarks?.length > 0;
        updateAurora();
        drawMesh(meshEl, videoEl, res.faceLandmarks);
        Stickers.setup.update(res.faceLandmarks, meshEl);
        if (hasFace) {
          meshEl.classList.add("on");
          ovalEl.classList.add("ok");
          if (!stableStart) stableStart = performance.now();
          const held = performance.now() - stableStart;
          if (held < 2000) {
            statusEl.textContent = `Hold still…${Math.ceil((2000 - held) / 1000)}s`;
          } else {
            statusEl.textContent = "Looking good — calibrating next";
            cancelAnimationFrame(State.timers.setup);
            State.timers.setup = setTimeout(() => beginCalibration(), 500);
            return;
          }
        } else {
          meshEl.classList.remove("on");
          ovalEl.classList.remove("ok");
          stableStart = 0;
          statusEl.textContent = "Fit your face in the circle";
        }
      } catch (e) {
        showDiag("detect error: " + e.message);
      }
    }
  };
  tick();
}

// Keep the mesh animated throughout the exercise too.
function runExerciseMeshLoop() {
  const videoEl = document.getElementById("exerciseVideo");
  const meshEl  = document.getElementById("exerciseMesh");
  if (!State.landmarker || !State.cameraStream) return;
  if (!Stickers.exercise) Stickers.exercise = new StickerLayer("exerciseStickers");
  let lastVidTime = -1;
  const tick = () => {
    if (!State.session || State.mode !== "camera_assisted_candidate") {
      meshEl.classList.remove("on");
      Stickers.exercise.update(null, meshEl);
      return;
    }
    State.timers.mesh = requestAnimationFrame(tick);
    if (videoEl.currentTime !== lastVidTime && videoEl.readyState >= 2) {
      lastVidTime = videoEl.currentTime;
      try {
        const res = State.landmarker.detectForVideo(videoEl, performance.now());
        recordTrackingFrame(res, videoEl);
        updateAurora();
        advanceGate();
        drawMesh(meshEl, videoEl, res.faceLandmarks);
        Stickers.exercise.update(res.faceLandmarks, meshEl);
        if (res.faceLandmarks?.length) meshEl.classList.add("on");
        else meshEl.classList.remove("on");
      } catch {
        State.lastLandmarks = null;
        State.blendshapes = {};
      }
    }
    if (performance.now()-State.lastFrameAt > 250) {
      meshEl.classList.remove("on");
      if (State.phaseGate) {
        State.phaseGate.fill = 0;
        renderHoldProgress();
        if (!State.paused) document.getElementById("phaseSub").textContent = "Tracking paused — bring your face into view.";
      }
    }
  };
  tick();
}

// Calibration records comfortable poses only while the face is visible and stable.
// Samples live in memory for this session; no image or face template is persisted.
function beginCalibration() {
  stopCalibration();
  State.calibration = null;
  show("calibration");
  const video = document.getElementById("calibVideo");
  video.srcObject = State.cameraStream;
  video.play().catch(() => {});
  const run = { index: 0, profile: {}, frames: [], heldFrom: 0, lastTime: -1, lastFrameAt: 0, readyAt: 0 };
  State.calibrationRun = run;
  const present = () => {
    const key = CALIBRATION_STEPS[run.index];
    document.getElementById("calibStep").textContent = `${run.index+1} / ${CALIBRATION_STEPS.length} · your comfortable range`;
    document.getElementById("calibCue").textContent = POSES[key].title;
    document.getElementById("calibSub").textContent = POSES[key].detail;
    document.getElementById("calibIllustration").innerHTML = calibrationDiagram(key);
    document.getElementById("calibStatus").textContent = "Try the illustrated pose, then hold gently.";
    document.getElementById("calibProgress").value = 0;
    run.readyAt = performance.now()+800;
    run.frames = []; run.heldFrom = 0;
  };
  present();
  const tick = () => {
    if (State.calibrationRun !== run) return;
    State.timers.calibration = requestAnimationFrame(tick);
    const now = performance.now();
    if (video.readyState < 2 || video.currentTime === run.lastTime) {
      if (now-run.lastFrameAt > 500) {
        run.frames = []; run.heldFrom = 0;
        document.getElementById("calibProgress").value = 0;
        document.getElementById("calibStatus").textContent = "Waiting for the camera. You can also continue with guided practice.";
      }
      return;
    }
    run.lastTime = video.currentTime;
    if (now-run.lastFrameAt > 250 || document.hidden) { run.frames = []; run.heldFrom = 0; }
    run.lastFrameAt = now;
    try {
      const result = State.landmarker.detectForVideo(video, now);
      recordTrackingFrame(result, video);
      const canvas = document.getElementById("calibMesh");
      drawMesh(canvas, video, result.faceLandmarks);
      canvas.classList.toggle("on", !!result.faceLandmarks?.length);
      if (now < run.readyAt || document.hidden) return;
      const face = currentFace();
      const key = CALIBRATION_STEPS[run.index];
      const issue = calibrationIssue(key, face, run.profile);
      const status = document.getElementById("calibStatus");
      if (issue) {
        run.frames = []; run.heldFrom = 0;
        document.getElementById("calibProgress").value = 0;
        status.textContent = issue;
        return;
      }
      if (!run.heldFrom) run.heldFrom = now;
      run.frames.push(face);
      const progress = Math.min(1, (now-run.heldFrom)/1200);
      document.getElementById("calibProgress").value = progress;
      status.textContent = `Hold gently · ${Math.min(1.2, Math.floor((now-run.heldFrom)/100)/10).toFixed(1)} / 1.2 s`;
      if (progress < 1) return;
      if (!samplesAreStable(run.frames)) {
        run.frames = []; run.heldFrom = 0;
        status.textContent = "Almost — settle into the pose and hold still.";
        return;
      }
      run.profile[key] = medianSample(run.frames);
      run.index++;
      if (run.index === CALIBRATION_STEPS.length) {
        State.calibration = run.profile;
        stopCalibration();
        startSession("camera_assisted_candidate");
      } else present();
    } catch (error) {
      run.frames = []; run.heldFrom = 0;
      document.getElementById("calibProgress").value = 0;
      document.getElementById("calibStatus").textContent = "Tracking interrupted. Retry calibration or continue with guided practice.";
    }
  };
  tick();
}
function stopCalibration() {
  State.calibrationRun = null;
  cancelAnimationFrame(State.timers.calibration);
  clearTimeout(State.timers.setup);
  cancelAnimationFrame(State.timers.setup);
}
function stopCamera() {
  stopCalibration();
  if (State.cameraStream) {
    State.cameraStream.getTracks().forEach(t => t.stop());
    State.cameraStream = null;
  }
  cancelAnimationFrame(State.timers.mesh);
  State.calibration = null;
  State.lastLandmarks = null;
  State.blendshapes = {};
  State.lastFrameAt = 0;
}
function recordTrackingFrame(result, video) {
  State.lastLandmarks = result.faceLandmarks;
  State.frameSize = { width: video.videoWidth, height: video.videoHeight };
  State.lastFrameAt = performance.now();
  readBlendshapes(result);
}
function currentFace() {
  if (performance.now()-State.lastFrameAt > 250) return null;
  return measureFace(State.lastLandmarks?.[0], State.blendshapes, State.frameSize.width, State.frameSize.height);
}

// =========================================================
// EXERCISE SESSION
// =========================================================
function startSession(mode) {
  State.mode = mode;
  State.session = {
    startedAt: new Date().toISOString(),
    date: iso(new Date()),
    mode,
    routineVersion: State.routine.routineVersion,
    moveIndex: -1,
    moves: State.routine.moves.map((m) => ({
      id: m.id,
      mode,
      plannedActiveMs: m.activeMs,
      activeElapsedMs: 0,
      status: "not_started",
      userConfirmed: null,
      attempts: 0,
    })),
  };
  State.observations = { matchedMs: 0, smileWarmth: 0, samples: 0 };

  requestWakeLock();
  show("exercise");

  // Camera visible as a soft mirror backdrop if camera mode
  const exerciseScreen = document.querySelector("[data-screen='exercise']");
  document.getElementById("sessionMode").textContent = mode === "guided" ? "Guided practice" : State.calibration ? "Calibrated practice" : "Mirror · timed guidance";
  const vid = document.getElementById("exerciseVideo");
  if (mode === "camera_assisted_candidate" && State.cameraStream) {
    vid.srcObject = State.cameraStream;
    vid.classList.add("show");
    vid.play().catch(()=>{});
    exerciseScreen.classList.add("in-camera-mode");
    runExerciseMeshLoop();
  } else {
    vid.classList.remove("show");
    exerciseScreen.classList.remove("in-camera-mode");
    document.getElementById("exerciseMesh").classList.remove("on");
  }

  nextMove();
}

function teardownExercise() {
  clearAllTimers();
  State.session = null;
  State.active = null;
  State.paused = false;
  document.getElementById("pauseOverlay").hidden = true;
  document.getElementById("selfcheck").hidden = true;
  document.getElementById("demoOverlay").hidden = true;
  document.querySelector("[data-screen='exercise']").classList.remove("in-camera-mode");
  stopCamera();
  releaseWakeLock();
}

function clearAllTimers() {
  Object.keys(State.timers).forEach((k) => {
    const t = State.timers[k];
    if (!t) return;
    clearTimeout(t); clearInterval(t); cancelAnimationFrame(t);
    State.timers[k] = null;
  });
}

// Stop every move-related timer so the current phase cannot bleed into
// the next one. Called before Skip / Retry / Self-check transitions.
function clearPhaseTimers() {
  ["phase", "demo", "ready", "rest", "active"].forEach((k) => {
    const t = State.timers[k];
    if (t) { clearTimeout(t); clearInterval(t); State.timers[k] = null; }
  });
  State.active = null;
  State.phaseGate = null;
  renderHoldProgress();
}

function nextMove() {
  const s = State.session;
  s.moveIndex++;
  if (s.moveIndex >= s.moves.length) {
    finishSession();
    return;
  }
  const move = State.routine.moves[s.moveIndex];
  s.moves[s.moveIndex].attempts++;
  updateSessionProgress();

  runDemo(move);
}

function updateSessionProgress() {
  const s = State.session;
  document.getElementById("moveIndex").textContent = s.moveIndex + 1;
  const pct = Math.round(((s.moveIndex) / s.moves.length) * 100);
  document.getElementById("sessionProgress").style.width = pct + "%";
}

// --- Demo phase ---
function runDemo(move) {
  const demoMs = State.routine.defaults.demoMs;
  renderMoveGuide(move.id, move.phaseSchedule[0].phase);
  renderHoldProgress();
  setStageLabel("Demo");
  document.getElementById("phaseCue").textContent = move.title.en;
  document.getElementById("phaseSub").textContent = move.script.introEn;
  setPhaseTrack(trackTypeFor(move.id));
  setPhaseVisual(demoVisualFor(move.id));
  renderRhythmDots(cycleCountFor(move), -1);

  State.timers.demo = setTimeout(() => runReady(move), demoMs);
}

function runReady(move) {
  const readyMs = State.routine.defaults.readyMs;
  setStageLabel("Ready");
  let left = Math.ceil(readyMs / 1000);
  document.getElementById("phaseCue").textContent = `${left}`;
  document.getElementById("phaseSub").textContent = move.script.introEn;
  setPhaseVisual("ready");

  State.timers.ready = setInterval(() => {
    left--;
    if (left <= 0) {
      clearInterval(State.timers.ready);
      runActive(move);
      return;
    }
    document.getElementById("phaseCue").textContent = `${left}`;
  }, 1000);
}

// --- Active phase: router between detection-gated and timer-paced flows ---
const DETECTION_MOVES = new Set(["vowel_a_u", "vowel_e_u", "pucker_side_to_side", "pucker_circles"]);
function usesDetection(moveId) {
  return State.mode === "camera_assisted_candidate" && canMatch(moveId, State.calibration);
}
// Reps per detected move: deliberately shorter than timer-based repeat so the
// gameplay doesn't take forever when every rep needs a real snap.
const DETECTION_REPS = { vowel_a_u: 4, vowel_e_u: 4, pucker_side_to_side: 4, pucker_circles: 4 };

function runActive(move) {
  if (usesDetection(move.id)) {
    runActiveDetection(move);
  } else {
    runActivePaced(move);
  }
}

// Detection-gated: each phase is held until the user actually matches the
// target shape for long enough to "snap". No per-phase timer — the user
// drives the pace. A soft overall timeout protects against hanging.
function runActiveDetection(move) {
  const s = State.session;
  const moveState = s.moves[s.moveIndex];
  const requiredReps = DETECTION_REPS[move.id] || move.repeat || 4;
  const schedule = move.phaseSchedule;

  setStageLabel("Match");
  renderRepDots(requiredReps, []);

  State.phaseGate = {
    moveId: move.id,
    phases: schedule,
    phaseIdx: 0,
    fill: 0,
    peakPrecision: 0,
    reps: 0,
    requiredReps,
    startTime: performance.now(),
    lastTick: performance.now(),
    lastTextUpdate: 0,
    lastBucket: null,
    lastOvershoot: null,
    lastSoundBucket: null,
    petals: [],
  };
  stepGatedPhase();

  // Count active camera time, not wall-clock time, so pause/replay cannot expire a move.
  State.phaseGate.elapsedMs = 0;
  State.phaseGate.maxMs = Math.max(60000, (move.activeMs || 20000)*3);
}

function stepGatedPhase() {
  const g = State.phaseGate;
  if (!g) return;
  const phaseInCycle = g.phaseIdx % g.phases.length;
  const reverse = State.routine.moves.find(m => m.id === g.moveId)?.reversePhaseOrder;
  const p = g.moveId === "pucker_circles" && reverse && g.reps >= g.requiredReps/2
    ? g.phases.find(p => p.phase === reverse[phaseInCycle]) : g.phases[phaseInCycle];
  State.active = { moveId: g.moveId, phase: p.phase };
  g.fill = 0;
  g.peakPrecision = 0;
  g.lastTick = performance.now();
  g.lastTextUpdate = 0;
  g.lastBucket = null;
  g.lastOvershoot = null;
  document.getElementById("phaseCue").textContent = p.cue.en;
  document.getElementById("phaseSub").textContent = "Follow the shape below, then hold gently.";
  renderMoveGuide(g.moveId, p.phase);
  renderHoldProgress();
  setPhaseVisual(phaseVisualFor(g.moveId, p.phase));
}

function evaluatePrecision() {
  const a = State.active;
  return a ? evaluatePose(a.moveId, a.phase, currentFace(), State.calibration) : null;
}
function updateFeedback(precision, result) {
  const el = document.getElementById("phaseSub");
  if (el && result) el.textContent = result.hint;
}
function renderMoveGuide(moveId, phase) {
  const key = guideKey(moveId, phase);
  const el = document.getElementById("moveGuide");
  if (el) {
    el.hidden = !key;
    el.innerHTML = key ? `${mouthDiagram(key)}<div><span class="eyebrow">${POSES[key].label}</span><p>${POSES[key].detail}</p></div>` : "";
  }
  document.getElementById("phaseStage")?.classList.toggle("has-guide", !!key && !!el);
}
function renderHoldProgress() {
  const g = State.phaseGate;
  const wrap = document.getElementById("holdFeedback");
  if (!wrap) return;
  wrap.hidden = !g;
  if (g) {
    document.getElementById("holdProgress").value = g.fill;
    document.getElementById("holdLabel").textContent = `Hold gently · ${(Math.floor(g.fill*10)/10).toFixed(1)} / 1.0 s`;
  }
}

function advanceGate() {
  const g = State.phaseGate;
  if (!g) return;
  const now = performance.now();
  const elapsed = now-g.lastTick;
  g.lastTick = now;
  if (State.paused) { g.fill = 0; renderHoldProgress(); return; }
  g.elapsedMs += Math.min(250, elapsed);
  const result = evaluatePrecision();
  const precision = result?.precision || 0;
  g.fill = advanceHold(g.fill, precision, elapsed);
  if (g.fill > 0) {
    g.peakPrecision = Math.max(g.peakPrecision || 0, precision);
    if (State.observations) State.observations.matchedMs += Math.min(250, elapsed);
  }
  if (now-(g.lastTextUpdate || 0) > 300) {
    g.lastTextUpdate = now;
    updateFeedback(precision, result);
    renderHoldProgress();
  }
  if (g.fill >= 1) { snapRep(); return; }
  if (g.elapsedMs >= g.maxMs) {
    const move = State.routine.moves.find(m => m.id === g.moveId);
    const moveState = State.session.moves[State.session.moveIndex];
    moveState.activeElapsedMs = g.elapsedMs;
    State.phaseGate = null;
    showSelfCheck(move);
    document.getElementById("phaseCue").textContent = "Let's check in";
    document.getElementById("phaseSub").textContent = "The camera could not confirm every cycle. You can confirm your practice, retry, or skip.";
    renderHoldProgress();
  }
}

function snapRep() {
  const g = State.phaseGate;
  if (!g) return;
  const peak = g.peakPrecision || 0;
  const petals = peak >= 0.9 ? 3 : peak >= 0.7 ? 2 : peak >= 0.5 ? 1 : 0;
  g.petals = g.petals || [];
  g.phasePetals = [...(g.phasePetals || []), petals];
  g.phaseIdx++;
  if (g.phaseIdx % g.phases.length === 0) {
    g.petals.push(Math.min(...g.phasePetals));
    g.phasePetals = [];
    g.reps++;
  }
  g.fill = 0;
  g.peakPrecision = 0;
  g.lastBucket = null;
  g.lastOvershoot = null;
  g.lastSoundBucket = null;
  renderRepDots(g.requiredReps, g.petals);
  flashSnap(petals);
  AudioEngine.snap(petals);

  if (g.reps >= g.requiredReps) {
    const moveState = State.session.moves[State.session.moveIndex];
    moveState.activeElapsedMs = g.elapsedMs;
    moveState.status = "completed";
    moveState.userConfirmed = false;
    moveState.cameraConfirmed = true;
    moveState.endedAt = new Date().toISOString();
    moveState.repPetals = [...g.petals];
    moveState.quality = g.petals.reduce((s, p) => s + p, 0);          // 0..12
    State.phaseGate = null;
    State.active = null;
    if (State.timers.active) { clearTimeout(State.timers.active); State.timers.active = null; }
    autoAdvance(moveState.quality);
  } else {
    stepGatedPhase();
  }
}

// Rep dots: solid gradient = this rep earned petals; dim circle = still to do.
// Also records petal rating as text ("•••", "••·", etc.) inside the dot.
function renderRepDots(total, petalsPerRep) {
  const el = document.getElementById("rhythmDots");
  if (!el) return;
  el.innerHTML = "";
  for (let i = 0; i < total; i++) {
    const s = document.createElement("span");
    const p = petalsPerRep?.[i];
    if (p === undefined) {
      s.className = i === (petalsPerRep?.length || 0) ? "r on" : "r";
    } else {
      s.className = "r done p" + p;
    }
    el.appendChild(s);
  }
}

// Detection-driven moves auto-complete after all reps — no self-check.
// The headline + glow scale with the earned quality so a 12/12 move
// feels different from a 4/12 one.
function autoAdvance(quality) {
  showCompletionFlash(quality);
  AudioEngine.complete(quality);
  setStageLabel("Done");
  renderMoveGuide("", "");
  renderHoldProgress();
  const cueEl = document.getElementById("phaseCue");
  const subEl = document.getElementById("phaseSub");
  const text = quality === undefined
    ? "nice."
    : quality >= 10 ? "stunning."
    : quality >= 7  ? "that was lovely."
    : quality >= 4  ? "nice work."
    : "you kept going.";
  if (cueEl) cueEl.textContent = text;
  if (subEl) subEl.textContent = "";
  State.timers.rest = setTimeout(() => nextMove(), 1800);
}

function showCompletionFlash(quality) {
  const flash = document.createElement("div");
  flash.className = "completion-flash";
  if (quality !== undefined) flash.dataset.quality = quality;
  flash.innerHTML = '<span class="mark">✓</span>';
  document.body.appendChild(flash);
  setTimeout(() => flash.remove(), 1600);
}

function flashSnap(petals) {
  const stage = document.getElementById("phaseStage");
  if (stage) {
    stage.classList.remove("snap", "snap-1", "snap-2", "snap-3");
    void stage.offsetWidth;
    stage.classList.add("snap", "snap-" + (petals ?? 1));
    setTimeout(() => stage.classList.remove("snap", "snap-1", "snap-2", "snap-3"), 700);
  }
  // Snap also pulses the cue card so it reads even when phase-stage is hidden
  const cue = document.querySelector(".phase-copy") || document.querySelector(".cue-card");
  if (cue) {
    cue.classList.remove("snap-pulse", "pq-1", "pq-2", "pq-3");
    void cue.offsetWidth;
    cue.classList.add("snap-pulse", "pq-" + (petals ?? 1));
    setTimeout(() => cue.classList.remove("snap-pulse", "pq-1", "pq-2", "pq-3"), 700);
  }
}

// =====================================================
// AudioEngine — simple Web Audio chimes. Muted by default, user toggles.
// =====================================================
const AudioEngine = {
  ctx: null,
  enabled: false,
  init() {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) this.ctx = new AC();
    } catch {}
  },
  resume() {
    if (this.ctx?.state === "suspended") this.ctx.resume();
  },
  setEnabled(on) {
    this.enabled = on;
    if (on && !this.ctx) this.init();
    if (on) this.resume();
  },
  tone(freq, duration = 180, type = "sine", vol = 0.08) {
    if (!this.enabled || !this.ctx) return;
    try {
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(vol, t + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.0005, t + duration / 1000);
      osc.connect(gain).connect(this.ctx.destination);
      osc.start(t);
      osc.stop(t + duration / 1000 + 0.05);
    } catch {}
  },
  transition(freq = 494) {
    this.tone(freq, 140, "sine", 0.06);
  },
  snap(petals) {
    if (!this.enabled) return;
    const base = petals === 3 ? 523 : petals === 2 ? 494 : petals === 1 ? 440 : 294;
    this.tone(base, 220, "triangle", 0.1);
    if (petals >= 2) setTimeout(() => this.tone(base * 1.25, 220, "triangle", 0.09), 90);
    if (petals >= 3) setTimeout(() => this.tone(base * 1.5, 280, "triangle", 0.11), 180);
  },
  complete(quality) {
    if (!this.enabled) return;
    const notes = quality >= 10 ? [523, 659, 784, 1047]
                : quality >= 7  ? [523, 659, 784]
                : quality >= 4  ? [440, 523, 659]
                : [392, 440];
    notes.forEach((f, i) => setTimeout(() => this.tone(f, 260, "triangle", 0.09), i * 110));
  },
};
window.AudioEngine = AudioEngine;

// Timer-paced active (original flow): used in Guided mode and for moves
// MediaPipe cannot honestly observe (tongue, air, cheek draw-in, circles).
function runActivePaced(move) {
  const sched = buildPhaseTimeline(move);
  const s = State.session;
  const moveState = s.moves[s.moveIndex];

  setStageLabel("Follow");
  renderRhythmDots(cycleCountFor(move), 0);

  let i = 0;
  const activeStart = performance.now();
  let lastCycleIdx = -1;

  const runPhase = () => {
    if (State.paused) {
      State.timers.phase = setTimeout(runPhase, 100);
      return;
    }
    if (i >= sched.length) {
      moveState.activeElapsedMs = performance.now() - activeStart;
      showSelfCheck(move);
      return;
    }
    const p = sched[i];
    State.active = { moveId: move.id, phase: p.phase };
    document.getElementById("phaseCue").textContent = p.cue.en;
    document.getElementById("phaseSub").textContent = State.mode === "guided" ? "Follow at your own pace." : "Timed guidance · no camera matching for this move.";
    renderMoveGuide(move.id, p.phase);
    renderHoldProgress();
    setPhaseVisual(phaseVisualFor(move.id, p.phase));

    if (p.cycleIdx !== lastCycleIdx) {
      lastCycleIdx = p.cycleIdx;
      renderRhythmDots(cycleCountFor(move), p.cycleIdx);
    }

    i++;
    State.timers.phase = setTimeout(runPhase, p.durationMs);
  };
  runPhase();
}

// Build a flat timeline of {phase, cue, durationMs, cycleIdx} for a move.
function buildPhaseTimeline(move) {
  const timeline = [];
  const schedule = move.phaseSchedule;
  const repeat = move.repeat;

  if (move.id === "pucker_circles") {
    // 2 forward circles, then 2 reverse circles.
    const forward = schedule; // left,up,right,down
    const reverseOrder = move.reversePhaseOrder; // left,down,right,up
    const reverse = reverseOrder.map((ph) => forward.find((f) => f.phase === ph));
    for (let c = 0; c < 2; c++) forward.forEach((p) => timeline.push({ ...p, cycleIdx: c }));
    for (let c = 0; c < 2; c++) reverse.forEach((p) => timeline.push({ ...p, cycleIdx: c + 2 }));
    return timeline;
  }

  for (let c = 0; c < repeat; c++) {
    schedule.forEach((p) => timeline.push({ ...p, cycleIdx: c }));
  }

  if (move.afterRepeats?.length) {
    const holdCycle = repeat;
    move.afterRepeats.forEach((p) => timeline.push({ ...p, cycleIdx: holdCycle }));
  }
  return timeline;
}

function cycleCountFor(move) {
  if (move.id === "pucker_circles") return 4;
  const base = move.repeat;
  return base + (move.afterRepeats?.length ? 1 : 0);
}

// --- Self check overlay ---
function showSelfCheck(move) {
  State.active = null;
  renderMoveGuide("", "");
  renderHoldProgress();
  setStageLabel("Done?");
  setPhaseVisual("done");
  document.getElementById("phaseCue").textContent = move.script.outroEn;
  document.getElementById("phaseSub").textContent = "";
  document.getElementById("selfcheck").hidden = false;
}

function handleSelfResult(status) {
  const s = State.session;
  if (!s) return;
  // Kill any in-flight phase / demo / ready / rest timer BEFORE we transition,
  // so a Skip during active cannot race with the natural phase advance.
  clearPhaseTimers();

  const moveState = s.moves[s.moveIndex];
  document.getElementById("selfcheck").hidden = true;

  if (status === "retry") {
    const move = State.routine.moves[s.moveIndex];
    moveState.attempts++;
    runDemo(move);
    return;
  }

  moveState.status = status;                   // completed | partial | skipped
  moveState.userConfirmed = status === "completed";
  moveState.endedAt = new Date().toISOString();

  // Short rest with outro
  setStageLabel("Rest");
  const restMs = Math.min(2500, State.routine.defaults.resultRestMs);
  State.timers.rest = setTimeout(() => nextMove(), restMs);
}

// --- Pause / resume ---
function pauseExercise(fromVisibility) {
  if (!State.session) return;
  State.paused = true;
  if (State.phaseGate) State.phaseGate.fill = 0;
  renderHoldProgress();
  document.getElementById("pauseOverlay").hidden = fromVisibility ? true : false;
  document.getElementById("pauseBtn").textContent = "▶";
  document.getElementById("pauseBtn").setAttribute("aria-label", "Resume");
}
function resumeExercise() {
  State.paused = false;
  document.getElementById("pauseOverlay").hidden = true;
  document.getElementById("pauseBtn").textContent = "II";
  document.getElementById("pauseBtn").setAttribute("aria-label", "Pause");
}

// --- Demo replay overlay ---
function showDemoOverlay() {
  const s = State.session;
  if (!s) return;
  const m = State.routine.moves[s.moveIndex];
  document.getElementById("demoIllustrations").innerHTML = guideSequence(m);
  document.getElementById("demoTitle").textContent = m.title.en;
  document.getElementById("demoCue").textContent = m.script.introEn;
  document.getElementById("demoOverlay").hidden = false;
  pauseExercise(true);
}
function hideDemoOverlay() {
  document.getElementById("demoOverlay").hidden = true;
  resumeExercise();
}

function endSessionConfirm() {
  if (!State.session) { Actions.goHome(); return; }
  finishSession(true);
}

// --- Finish and report ---
function finishSession(partial = false) {
  clearAllTimers();
  const s = State.session;
  if (!s) { Actions.goHome(); return; }

  // Mark any un-touched moves as skipped if partial
  s.moves.forEach((m) => { if (m.status === "not_started") m.status = partial ? "skipped" : m.status; });
  s.endedAt = new Date().toISOString();
  s.partial = partial;

  // Streak logic — per handoff: only count if all 7 have terminal states
  // AND at least one is "completed"
  const allTerminal = s.moves.every((m) => ["completed","partial","skipped"].includes(m.status));
  const anyCompleted = s.moves.some((m) => m.status === "completed");
  const countsForStreak = allTerminal && anyCompleted;

  const data = loadStore();
  data.sessions = data.sessions || [];
  data.sessions.push({
    date: s.date,
    startedAt: s.startedAt,
    endedAt: s.endedAt,
    mode: s.mode,
    routineVersion: s.routineVersion,
    partial,
    moves: s.moves,
  });
  // Keep last 30
  if (data.sessions.length > 30) data.sessions = data.sessions.slice(-30);

  if (countsForStreak) {
    const last = data.lastStreakDate;
    const today = s.date;
    if (last === today) {
      // already counted today; no change
    } else if (last && dayDiff(last, today) === 1) {
      data.streak = (data.streak || 0) + 1;
    } else {
      data.streak = 1;
    }
    data.lastStreakDate = today;
  }

  saveStore(() => data);
  renderReport(s, data);
  show("report");
  stopCamera();
  releaseWakeLock();
  State.session = null;
}

function renderReport(session, data) {
  const completed = session.moves.filter((m) => m.status === "completed").length;
  const partial   = session.moves.filter((m) => m.status === "partial").length;
  const skipped   = session.moves.filter((m) => m.status === "skipped").length;

  document.getElementById("reportTime").textContent = formatTime(new Date());
  document.getElementById("reportCompleted").textContent = completed;
  document.getElementById("reportPartial").textContent = partial;
  document.getElementById("reportSkipped").textContent = skipped;
  document.getElementById("reportStreak").textContent = data.streak || 0;

  const headline = completed === 7 ? "Today's<br>full bloom" :
                  completed > 0   ? `A ${completed}-petal<br>bloom` :
                                    "A quiet<br>pause";
  document.getElementById("reportHeadline").innerHTML = headline;
  document.getElementById("reportSub").textContent =
    session.partial ? "Partial counts too" : "Breathe, relax a moment";

  document.getElementById("reportReflect").textContent = reflectionFor(session, data);
  renderMandala(session);

  document.getElementById("streakNote").textContent =
    (data.streak || 0) >= 3 ? "Nice rhythm" : "Keep this pace";

  const list = document.getElementById("reportList");
  list.innerHTML = "";
  session.moves.forEach((m, i) => {
    const def = State.routine.moves[i];
    const chip = m.status === "completed" ? "completed" :
                 m.status === "partial"   ? "partial"   : "skipped";
    const label = m.status === "completed" ? "Completed" :
                  m.status === "partial"   ? "Partial" :
                  m.status === "skipped"   ? "Skipped" : "Not done";
    const li = document.createElement("li");
    li.innerHTML = `
      <span class="idx">${def.order}</span>
      <span class="meta"><span class="ttl">${def.title.en}</span></span>
      <span class="status-chip ${chip}">${label}</span>
    `;
    list.appendChild(li);
  });
}

// =========================================================
// Visual helpers (phase glow, cue animation, rhythm dots)
// =========================================================
function setStageLabel(txt) {
  document.getElementById("stageLabel").textContent = txt;
}

function setPhaseTrack(trackClass) {
  const t = document.getElementById("phaseTrack");
  t.className = "phase-track" + (trackClass ? " " + trackClass + " on" : "");
}

function trackTypeFor(moveId) {
  switch (moveId) {
    case "pucker_side_to_side":
    case "air_side_to_side":
    case "tongue_inner_cheek":
      return "lateral";
    case "pucker_circles":
      return "circular";
    case "cheek_draw_in":
      return "hold-track";
    default:
      return "";  // vowels — letter speaks for itself
  }
}

function setPhaseVisual(kind) {
  const visual = document.getElementById("phaseVisual");
  const letter = document.getElementById("phaseLetter");
  const dot    = document.getElementById("phaseDot");

  visual.className = "phase-visual " + (kind || "");
  letter.classList.remove("show");
  dot.classList.remove("show");
  dot.style.transform = "translate(0,0)";

  const tokens = (kind || "").split(/\s+/);
  const letterTok = tokens.find((t) => t.startsWith("letter-"));
  if (letterTok) {
    letter.textContent = letterTok.replace("letter-", "").toUpperCase();
    letter.classList.add("show");
  } else {
    letter.textContent = "";
  }

  const dotTok = tokens.find((t) => t.startsWith("dot-"));
  if (dotTok) {
    dot.classList.add("show");
    const map = {
      "dot-left":  "translate(-70px, 0)",
      "dot-right": "translate( 70px, 0)",
      "dot-up":    "translate(0, -70px)",
      "dot-down":  "translate(0,  70px)",
    };
    dot.style.transform = map[dotTok] || "translate(0,0)";
  }
}

function demoVisualFor(moveId) {
  // Return a neutral breathing visual for demo
  return "ready";
}

function phaseVisualFor(moveId, phase) {
  switch (moveId) {
    case "pucker_side_to_side":
      return phase === "left" ? "shift-left dot-left" : "shift-right dot-right";
    case "pucker_circles":
      return `dot-${phase} shift-${phase}`;
    case "vowel_a_u":
      return phase === "a" ? "letter-A vowel-a" : "letter-U vowel-u";
    case "vowel_e_u":
      return phase === "e" ? "letter-E vowel-e" : "letter-U vowel-u";
    case "tongue_inner_cheek":
      return phase.includes("left") ? "shift-left dot-left" : "shift-right dot-right";
    case "air_side_to_side":
      return phase === "left" ? "shift-left dot-left" : "shift-right dot-right";
    case "cheek_draw_in":
      if (phase === "hold") return "hold";
      return phase === "draw_in" ? "draw-in" : "release";
    default:
      return "";
  }
}

function renderRhythmDots(total, activeIdx) {
  const el = document.getElementById("rhythmDots");
  el.innerHTML = "";
  for (let i = 0; i < total; i++) {
    const s = document.createElement("span");
    s.className = "r";
    if (i === activeIdx) s.classList.add("on");
    else if (i < activeIdx) s.classList.add("done");
    el.appendChild(s);
  }
}

// =========================================================
// Wake lock
// =========================================================
async function requestWakeLock() {
  try {
    if ("wakeLock" in navigator) {
      State.wakeLock = await navigator.wakeLock.request("screen");
    }
  } catch { /* ok */ }
}
function releaseWakeLock() {
  try { State.wakeLock?.release(); } catch {}
  State.wakeLock = null;
}

// =========================================================
// Storage
// =========================================================
function loadStore() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"); }
  catch { return {}; }
}
function saveStore(mutate) {
  const data = typeof mutate === "function" ? (mutate(loadStore()) || loadStore()) : loadStore();
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch {}
  return data;
}

// =========================================================
// Utilities
// =========================================================
function iso(d) { return d.toISOString().slice(0,10); }
function dayDiff(a, b) {
  return Math.round((new Date(b) - new Date(a)) / 86400000);
}
function formatDate(d) {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", weekday: "short" });
}
function formatTime(d) {
  return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
}
function showDiag(msg) {
  const el = document.getElementById("diag");
  if (!el) return;
  el.hidden = false;
  el.textContent = String(msg).slice(0, 160);
}

// =========================================================
// FACE MESH DRAWING
// =========================================================
function fitCanvasToVideo(canvas, video) {
  if (!canvas || !video.videoWidth || !video.videoHeight) return false;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return false;
  const dpr = window.devicePixelRatio || 1;
  const pw = Math.round(w*dpr), ph = Math.round(h*dpr);
  if (canvas.width !== pw || canvas.height !== ph) { canvas.width = pw; canvas.height = ph; }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr,0,0,dpr,0,0);
  ctx.fillStyle = "#faf7ef";
  ctx.fillRect(0,0,w,h);
  const t = containTransform(video.videoWidth, video.videoHeight, w, h);
  ctx.setTransform(dpr*t.scale,0,0,dpr*t.scale,dpr*t.x,dpr*t.y);
  return true;
}

function drawMesh(canvas, video, landmarks) {
  if (!fitCanvasToVideo(canvas, video)) return;
  const ctx = canvas.getContext("2d");
  const w = video.videoWidth, h = video.videoHeight;

  // Warm ivory ground. The camera video is hidden via CSS so the
  // canvas is the whole image the user sees.
  ctx.fillStyle = "#faf7ef";
  ctx.fillRect(0, 0, w, h);

  if (!landmarks || !landmarks.length) return;
  const pts = landmarks[0];
  const scale = Math.max(0.6, w / 640);

  // Face oval — whisper-thin outer silhouette
  drawSmoothContour(ctx, pts, CONTOURS.oval, w, h, {
    close: true, stroke: "rgba(97,63,53,0.22)", lw: 0.9 * scale,
  });

  // Brows — thin closed arcs
  drawSmoothContour(ctx, pts, CONTOURS.leftBrow, w, h, {
    close: true, stroke: "rgba(97,63,53,0.55)", lw: 1.0 * scale,
  });
  drawSmoothContour(ctx, pts, CONTOURS.rightBrow, w, h, {
    close: true, stroke: "rgba(97,63,53,0.55)", lw: 1.0 * scale,
  });

  // Nose bridge — subtle axis
  drawSmoothContour(ctx, pts, CONTOURS.noseBridge, w, h, {
    stroke: "rgba(97,63,53,0.2)", lw: 0.7 * scale,
  });

  // Eyes — crisper, closed
  drawSmoothContour(ctx, pts, CONTOURS.leftEye, w, h, {
    close: true, stroke: "rgba(97,63,53,0.78)", lw: 1.1 * scale,
  });
  drawSmoothContour(ctx, pts, CONTOURS.rightEye, w, h, {
    close: true, stroke: "rgba(97,63,53,0.78)", lw: 1.1 * scale,
  });

  // Lips — the single colour accent on the whole model
  drawSmoothContour(ctx, pts, CONTOURS.lipsOuter, w, h, {
    close: true,
    fill:   "rgba(196,95,63,0.12)",
    stroke: "rgba(97,63,53,0.92)",
    lw: 1.3 * scale,
  });
  drawSmoothContour(ctx, pts, CONTOURS.lipsInner, w, h, {
    close: true, stroke: "rgba(97,63,53,0.32)", lw: 0.6 * scale,
  });

  // Seven key control points — tiny bright dots with soft halo
  const dotR = Math.max(2.2, w / 260);
  for (const idx of KEY_DOTS) {
    const p = pts[idx];
    if (!p) continue;
    ctx.save();
    ctx.shadowColor = "rgba(97,63,53,0.7)";
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#898e46";
    ctx.beginPath();
    ctx.arc(p.x * w, p.y * h, dotR, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

}

// Draws a smooth curve through the landmark path using quadratic
// Bezier midpoints. Any missing landmark is skipped silently.
function drawSmoothContour(ctx, pts, indices, w, h, opts) {
  const path = [];
  for (const i of indices) {
    const p = pts[i];
    if (!p) continue;
    path.push([p.x * w, p.y * h]);
  }
  if (path.length < 2) return;

  ctx.save();
  ctx.beginPath();
  if (path.length >= 3) {
    const n = path.length;
    const start = opts.close
      ? [(path[n-1][0] + path[0][0]) / 2, (path[n-1][1] + path[0][1]) / 2]
      : path[0];
    ctx.moveTo(start[0], start[1]);
    for (let i = 0; i < n - 1; i++) {
      const [cx, cy] = path[i];
      const [nx, ny] = path[i + 1];
      ctx.quadraticCurveTo(cx, cy, (cx + nx) / 2, (cy + ny) / 2);
    }
    if (opts.close) {
      const [cx, cy] = path[n - 1];
      ctx.quadraticCurveTo(cx, cy, (cx + path[0][0]) / 2, (cy + path[0][1]) / 2);
      ctx.closePath();
    } else {
      const [cx, cy] = path[n - 1];
      ctx.lineTo(cx, cy);
    }
  } else {
    ctx.moveTo(path[0][0], path[0][1]);
    ctx.lineTo(path[1][0], path[1][1]);
  }

  if (opts.fill) {
    ctx.fillStyle = opts.fill;
    ctx.fill();
  }
  if (opts.stroke) {
    ctx.strokeStyle = opts.stroke;
    ctx.lineWidth = opts.lw || 1;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke();
  }
  ctx.restore();
}

// =====================================================
// Aurora responder — ambient background reacts to blendshapes.
// Writes CSS variables; CSS maps them to blob opacity, blur, hue.
// =====================================================
function updateAurora() {
  const bs = State.blendshapes;
  const smile = ((bs.mouthSmileLeft || 0) + (bs.mouthSmileRight || 0)) / 2;
  const open  = bs.jawOpen || 0;
  const brow  = bs.browInnerUp || 0;
  const puck  = bs.mouthPucker || 0;
  const root  = document.documentElement;
  root.style.setProperty("--sm-smile", smile.toFixed(2));
  root.style.setProperty("--sm-open",  open.toFixed(2));
  root.style.setProperty("--sm-brow",  brow.toFixed(2));
  root.style.setProperty("--sm-puck",  puck.toFixed(2));

  if (State.observations) {
    State.observations.smileWarmth = (State.observations.smileWarmth || 0) + smile;
    State.observations.samples = (State.observations.samples || 0) + 1;
  }
}

function readBlendshapes(result) {
  const cats = result.faceBlendshapes?.[0]?.categories;
  if (!result.faceLandmarks?.length || !cats) { State.blendshapes = {}; return; }
  const alpha = 0.35;
  for (const c of cats) {
    const prev = State.blendshapes[c.categoryName] || 0;
    State.blendshapes[c.categoryName] = prev + alpha * (c.score - prev);
  }
}

// =====================================================
// Session mandala — one petal per move, colored by move family.
// =====================================================
const PETAL_PRESETS = [
  { grad: "linear-gradient(160deg, #f8eee2, #ffc0c0)", rot: 0.0 },
  { grad: "linear-gradient(160deg, #f8eee2, #e2aa9e)", rot: 51.4 },
  { grad: "linear-gradient(160deg, #f8eee2, #c3c78d)", rot: 102.9 },
  { grad: "linear-gradient(160deg, #f8eee2, #f3b9b6)", rot: 154.3 },
  { grad: "linear-gradient(160deg, #f8eee2, #d6d35f)", rot: 205.7 },
  { grad: "linear-gradient(160deg, #f8eee2, #a9af70)", rot: 257.1 },
  { grad: "linear-gradient(160deg, #f8eee2, #e9c2b6)", rot: 308.6 },
];

function renderMandala(session) {
  const el = document.getElementById("mandala");
  if (!el) return;
  el.innerHTML = "";

  session.moves.forEach((m, i) => {
    if (m.status !== "completed" && m.status !== "partial") return;
    const preset = PETAL_PRESETS[i];
    const petal = document.createElement("div");
    // Petal richness reflects session quality (0..12) if we tracked petals,
    // otherwise falls back to the status.
    const q = typeof m.quality === "number" ? m.quality : (m.status === "completed" ? 7 : 3);
    const tier = q >= 10 ? "q3" : q >= 7 ? "q2" : q >= 4 ? "q1" : "q0";
    petal.className = `petal show ${tier}` + (m.status === "partial" ? " partial" : "");
    petal.style.background = preset.grad;
    petal.style.setProperty("--rot", preset.rot + "deg");
    petal.style.animationDelay = (0.15 + i * 0.14) + "s";
    el.appendChild(petal);
  });

  const core = document.createElement("div");
  core.className = "core";
  el.appendChild(core);

  // Deterministic sparkle positions so the mandala is reproducible per session
  const sparkles = [
    { x: -70, y: -40, delay: 1.3 },
    { x:  60, y:  70, delay: 1.6 },
    { x: -45, y:  80, delay: 1.9 },
    { x:  75, y: -55, delay: 2.2 },
  ];
  sparkles.forEach(({ x, y, delay }) => {
    const s = document.createElement("div");
    s.className = "sparkle";
    s.style.left = `calc(50% + ${x}px - 7px)`;
    s.style.top  = `calc(50% + ${y}px - 7px)`;
    s.style.animationDelay = delay + "s";
    el.appendChild(s);
  });
}

function reflectionFor(session, data) {
  const c = session.moves.filter((m) => m.status === "completed").length;
  const p = session.moves.filter((m) => m.status === "partial").length;
  const anyDone = c + p > 0;
  const streak = data.streak || 0;
  const matchedSec = Math.round((State.observations?.matchedMs || 0) / 1000);

  if (!anyDone) return "Rest is practice too. Come back tomorrow.";

  if (c === 7) {
    if (streak <= 1) return "Full seven, first time through. Save this feeling.";
    if (streak >= 7) return `Seven moves, ${streak} days. The habit is here.`;
    return "You stayed with every move today.";
  }
  if (c >= 4) {
    return matchedSec > 5
      ? "A steady session — your lips really found the shapes a few times."
      : "A steady session. The ones that fit today, you kept.";
  }
  if (c >= 1) {
    if (matchedSec > 3) return "Short, but a couple of moves really landed.";
    return "You showed up. Shorter is still practice.";
  }
  return "Softer today. Tomorrow is a new one.";
}

// Expose the pieces the test harness needs to drive the pipeline
// without a camera. Only ever imported by test.html / test.js.
window.FaceYoga = {
  State,
  DETECTION_MOVES,
  DETECTION_REPS,
  Stickers,
  StickerLayer,
  AudioEngine,
  show,
  startSession,
  runActive,
  runActiveDetection,
  runActivePaced,
  advanceGate,
  snapRep,
  stepGatedPhase,
  drawMesh,
  autoAdvance,
  flashSnap,
  nextMove,
  teardownExercise,
  bindActions,
  renderMandala,
  renderRepDots,
  evaluatePrecision,
  beginCalibration,
  recordTrackingFrame,
  renderMoveGuide,
  bindExerciseDialogs,
  async loadRoutine() {
    const res = await fetch("routine.v2.json");
    State.routine = await res.json();
    return State.routine;
  },
};

// Signal readiness for diagnostics
window.__appReady = true;
