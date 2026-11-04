// Face Yoga MVP — Guided-first prototype.
// Spec: CLAUDE_HANDOFF v0.2 + routine.v2.json.
// Camera matching uses per-session calibration; uncalibrated moves stay guided.

import {
  FaceLandmarker,
  FilesetResolver,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.0/vision_bundle.mjs";

import { measureFace, medianSample, calibrationIssue, samplesAreStable, canMatch,
  evaluatePose, advanceHold } from "./tracking.mjs";
import { POSES, CALIBRATION_STEPS, mouthDiagram, calibrationDiagram, guideKey, guidePoseKeys, guideSequence } from "./guidance.mjs";

import { portraitSVG, animatePortrait, faceFrame, trackedSketch, renderSketch, fitSketch, mouthBounds, traceLipHold } from "./portrait.mjs";

const STORAGE_KEY = "faceyoga.v2";
const MP_VERSION = "1.1.0";
const MODEL_URL  = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

// =====================================================
// FACE MODEL — shared fine line art with tracked facial proportions.
// Camera mode uses the native video element in a soft oval mirror.
// =====================================================
const SHOW_STICKERS = false;

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
  faceView: "line", intro: false, guideMotion: null, replayMotion: null, guideSVG: null,
  scheduled: {},
  mode: "guided",          // "guided" | "camera_assisted_candidate"
  cameraStream: null, cameraSetupId: 0, quickCamera: false,
  lipRippleAt: null,
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
  quickPractice: () => show("quickChoice"),
  quickGuided: () => { stopCamera(); startSession("guided", true); },
  quickCamera: () => beginCameraSetup(true),
  restartCamera: () => beginCameraSetup(State.quickCamera),
  backFromSetup: () => { const quick = State.quickCamera; stopCamera(); show(quick ? "quickChoice" : "cameraChoice"); },
  setupGuided: () => { const quick = State.quickCamera; stopCamera(); startSession("guided", quick, "vowel_a_u"); },
  startCountdown: () => beginCountdown(State.watchMove),
  flowPrevious:  () => scrollFlow(-1),
  flowNext:      () => scrollFlow(1),
  goHome:         () => { teardownExercise(); show("home"); renderHome(); },
  toPreview:      () => show("preview"),
  toCameraChoice: () => { stopCamera(); show("cameraChoice"); },
  chooseGuided:   () => { State.mode = "guided"; stopCamera(); startSession("guided"); },
  chooseCamera:   () => beginCameraSetup(),
  skipCalibration:() => { if (State.quickCamera) { Actions.setupGuided(); return; } stopCalibration(); State.calibration = null; startSession("camera_assisted_candidate"); },
  togglePause:    () => (State.paused ? resumeExercise() : pauseExercise(false)),
  resume:         () => resumeExercise(),
  endSession:     () => endSessionConfirm(),
  skipMove:       () => handleSelfResult("skipped"),
  replayDemo:     () => showDemoOverlay(),
  demoDone:       () => hideDemoOverlay(),
  selfCompleted:  () => handleSelfResult("completed"),
  selfRetry:      () => handleSelfResult("retry"),
  selfSkip:       () => handleSelfResult("skipped"),
  lineView: () => setFaceView("line"),
  cameraView: () => setFaceView("camera"),
  toggleSound:    () => {
    AudioEngine.setEnabled(!AudioEngine.enabled);
    document.getElementById("soundToggle")?.classList.toggle("on", AudioEngine.enabled);
    document.getElementById("soundToggle")?.setAttribute("aria-pressed", String(AudioEngine.enabled));
    if (AudioEngine.enabled) speakGuide(document.getElementById("guideDetail")?.textContent);
    else window.speechSynthesis?.cancel();
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
  const total  = data.sessions?.length || 0;

  document.getElementById("homeDate").textContent = formatDate(new Date());
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
  document.getElementById("weekSummary").textContent = doneThisWeek > 0 ? `${doneThisWeek} this week` : "0 this week";

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
async function beginCameraSetup(quick = false) {
  stopCamera();
  State.quickCamera = quick;
  const setupId = State.cameraSetupId;
  State.calibration = null;
  State.blendshapes = {};
  show("setup");
  const statusEl = document.getElementById("setupStatus");
  const videoEl  = document.getElementById("setupVideo");
  const ovalEl   = document.getElementById("faceOval");
  ovalEl.classList.remove("ok");

  try {
    statusEl.textContent = "Requesting camera…";
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false,
    });
    if (setupId !== State.cameraSetupId) { stream.getTracks().forEach(track => track.stop()); return; }
    State.cameraStream = stream;
    videoEl.srcObject = stream;
    await videoEl.play().catch(()=>{});

    if (setupId !== State.cameraSetupId) return;
    statusEl.textContent = "Loading model…";
    if (!State.landmarker) {
      const vision = await FilesetResolver.forVisionTasks(
        `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/wasm`
      );
      const model = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
        runningMode: "VIDEO",
        numFaces: 1,
        outputFaceBlendshapes: true,
      });
      if (setupId !== State.cameraSetupId) { model.close(); return; }
      State.landmarker = model;
    }

    runSetupLoop(videoEl, statusEl, ovalEl);
  } catch (e) {
    if (setupId !== State.cameraSetupId) return;
    State.cameraStream?.getTracks().forEach(track => track.stop());
    State.cameraStream = null;
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
        if (State.faceView === "line") drawMesh(meshEl, videoEl, res.faceLandmarks, !State.paused);
        Stickers.exercise.update(res.faceLandmarks, meshEl);
        if (res.faceLandmarks?.length) meshEl.classList.add("on");
        else meshEl.classList.remove("on");
      } catch {
        State.lastLandmarks = null;
        State.blendshapes = {};
      }
    }
    const faceVisible = !!State.lastLandmarks?.length && performance.now()-State.lastFrameAt <= 250;
    document.getElementById("liveFaceHint").hidden = State.intro || faceVisible;
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
  const steps = State.quickCamera ? ["neutral", "a", "u"] : CALIBRATION_STEPS;
  const run = { index: 0, profile: {}, frames: [], heldFrom: 0, lastTime: -1, lastFrameAt: 0, readyAt: 0 };
  State.calibrationRun = run;
  const present = () => {
    const key = steps[run.index];
    document.getElementById("calibStep").textContent = `${run.index+1} / ${steps.length} · your comfortable range`;
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
      const key = steps[run.index];
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
      if (run.index === steps.length) {
        State.calibration = run.profile;
        stopCalibration();
        startSession("camera_assisted_candidate", State.quickCamera, "vowel_a_u");
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
  State.cameraSetupId++;
  State.quickCamera = false;
  State.faceView = "line";
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
function startSession(mode, quick = false, quickMove = "pucker_side_to_side") {
  const moves = quick ? State.routine.moves.filter(m => m.id === quickMove) : State.routine.moves;
  State.mode = mode;
  State.paused = false;
  setFaceView("line");
  State.session = {
    startedAt: new Date().toISOString(),
    date: iso(new Date()),
    mode,
    routineVersion: State.routine.routineVersion,
    moveIndex: -1,
    quick,
    moves: moves.map((m) => ({
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

  document.getElementById("pauseBtn").textContent = "II";
  document.getElementById("pauseBtn").setAttribute("aria-label","Pause");
  requestWakeLock();
  show("exercise");

  // Camera visible as a soft mirror backdrop if camera mode
  const exerciseScreen = document.querySelector("[data-screen='exercise']");
  document.getElementById("sessionMode").textContent = quick ? "Quick practice" : mode === "guided" ? "Guided practice" : State.calibration ? "Calibrated practice" : "Mirror · timed guidance";
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
  clearPhaseTimers();
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
  State.lipRippleAt = null;
  State.watchMove = null;
  const steps=document.getElementById("demoSteps");
  if(steps) steps.hidden=true;
  document.getElementById("readyToStart").hidden = true;
  document.getElementById("demoCountdown").hidden = true;
  for (const entry of Object.values(State.scheduled)) clearTimeout(entry.timer);
  State.scheduled = {};
  State.guideMotion?.cancel(); State.replayMotion?.cancel();
  State.guideFlip?.cancel();
  window.speechSynthesis?.cancel();
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
  const move = currentMove();
  s.moves[s.moveIndex].attempts++;
  updateSessionProgress();

  runDemo(move);
}

function currentMove() {
  const s = State.session;
  return State.routine.moves.find(m => m.id === s.moves[s.moveIndex].id);
}

function updateSessionProgress() {
  const s = State.session;
  document.getElementById("moveIndex").textContent = s.moveIndex + 1;
  document.getElementById("moveTotal").textContent = s.moves.length;
  const pct = Math.round(((s.moveIndex + 1) / s.moves.length) * 100);
  document.getElementById("sessionProgress").style.width = pct + "%";
}

// Each scheduled cue retains its remaining time while the session is paused.
function scheduleCue(key, callback, ms) {
  clearTimeout(State.scheduled[key]?.timer);
  const entry = { callback, remaining: ms, started: performance.now(), timer: null };
  State.scheduled[key] = entry;
  const fire = () => {
    if (State.scheduled[key] !== entry) return;
    delete State.scheduled[key];
    callback();
  };
  entry.fire = fire;
  if (!State.paused) entry.timer = setTimeout(fire, ms);
}
function speakGuide(text) {
  if (!AudioEngine.enabled || !text || !window.speechSynthesis || State.paused) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "en-US"; utterance.rate = .88;
  window.speechSynthesis.speak(utterance);
}
function reducedMotion() { return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches || false; }
function placeGuide(inHero, animate = false, beforeRect) {
  const svg = State.guideSVG;
  const host = document.getElementById(inHero ? "heroGuide" : "guideDock");
  if (!svg || !host?.appendChild) return;
  const before = beforeRect || svg.getBoundingClientRect?.();
  host.appendChild(svg);
  if (animate && !reducedMotion() && before?.width && svg.animate) {
    const after = svg.getBoundingClientRect();
    if (after.width) State.guideFlip = svg.animate([
      { transform: `translate(${before.x-after.x}px,${before.y-after.y}px) scale(${before.width/after.width},${before.height/after.height})` },
      { transform: "none" }
    ], { duration: 520, easing: "cubic-bezier(.22,1,.36,1)", transformOrigin: "0 0" });
  }
}
function runDemo(move) {
  clearPhaseTimers();
  State.intro = true;
  State.watchMove = move;
  const screen = document.querySelector("[data-screen='exercise']");
  screen.classList.add("is-demonstrating"); screen.classList.remove("is-following");
  document.getElementById("practiceHeading").textContent = move.title.en;
  document.getElementById("faceViewSwitch").hidden = true;
  document.getElementById("readyToStart").hidden = false;
  renderMoveGuide(move.id, move.phaseSchedule[0].phase);
  placeGuide(true);
  State.guideMotion?.cancel();
  const demoMs = State.routine.defaults.demoMs;
  const keys = guidePoseKeys(move);
  const steps=document.getElementById("demoSteps");
  steps.innerHTML=guideSequence(move);
  steps.hidden=false;
  const showStep=key=>{
    const index=keys.indexOf(key);
    setStageLabel(`Demo · Step ${index+1} of ${keys.length}`);
    document.getElementById("phaseCue").textContent=POSES[key].title;
    document.getElementById("guideDetail").textContent=POSES[key].detail;
    steps.querySelectorAll("li").forEach((el,i)=>{
      if(i===index) el.setAttribute("aria-current","step");
      else el.removeAttribute("aria-current");
    });
  };
  showStep(keys[0]);
  State.guideMotion = animatePortrait(State.guideSVG, keys, {
    reduced: reducedMotion(), duration: demoMs / keys.length, onPose: showStep
  });
  const first = State.session.moveIndex === 0;
  document.getElementById("phaseSub").textContent = first ? "" : "Countdown starts after the demo.";
  renderRhythmDots(usesDetection(move.id) ? detectionReps(move) : cycleCountFor(move), -1);
  speakGuide(move.script.introEn);
  if (!first) scheduleCue("watch", () => beginCountdown(move), demoMs);
}
function beginCountdown(move) {
  if (!move || State.watchMove !== move || State.paused) return;
  State.watchMove = null;
  document.getElementById("demoSteps").hidden=true;
  clearTimeout(State.scheduled.watch?.timer); delete State.scheduled.watch;
  State.guideMotion?.cancel();
  window.speechSynthesis?.cancel();
  const host = document.getElementById("heroGuide");
  host.innerHTML = portraitSVG("neutral", "Relaxed starting position");
  State.guideSVG = host.querySelector("svg");
  document.getElementById("readyToStart").hidden = true;
  document.getElementById("demoCountdown").hidden = false;
  setStageLabel("Prepare");
  document.getElementById("phaseCue").textContent = "Get ready";
  document.getElementById("guideDetail").textContent = "Relax your jaw and face forward.";
  document.getElementById("phaseSub").textContent = "";
  let count = 3;
  const countdown = () => {
    document.querySelectorAll("#demoCountdown span").forEach((el,i) => el.classList.toggle("current", i === 3-count));
    document.getElementById("demoCountdown").setAttribute("aria-label", `Ready in ${count}`);
    scheduleCue("intro", () => { count--; if(count) countdown(); else runReady(move); }, 1000);
  };
  countdown();
}
function runReady(move) {
  const before = State.guideSVG?.getBoundingClientRect?.();
  State.intro = false;
  const camera = State.mode === "camera_assisted_candidate";
  const screen = document.querySelector("[data-screen='exercise']");
  screen.classList.remove("is-demonstrating"); screen.classList.add("is-following");
  document.getElementById("practiceHeading").textContent = move.title.en;
  document.getElementById("faceViewSwitch").hidden = !camera;
  document.getElementById("demoCountdown").hidden = true;
  placeGuide(!camera, camera, before);
  scheduleCue("enter", () => runActive(move), reducedMotion() ? 0 : 520);
}
function setFaceView(view) {
  if (view === "camera" && State.mode !== "camera_assisted_candidate") return;
  State.faceView = view === "camera" ? "camera" : "line";
  const camera = State.faceView === "camera";
  document.getElementById("lineViewButton")?.setAttribute("aria-pressed", String(!camera));
  document.getElementById("cameraViewButton")?.setAttribute("aria-pressed", String(camera));
  document.getElementById("cameraMirror")?.setAttribute("aria-hidden", String(!camera));
  document.querySelector("[data-screen='exercise']")?.classList.toggle("shows-camera", camera);
  // The same stream drives tracking and the native mirror. No extra model or frame copies.
}

// --- Active phase: router between detection-gated and timer-paced flows ---
const DETECTION_MOVES = new Set(["vowel_a_u", "vowel_e_u", "pucker_side_to_side", "pucker_circles"]);
function usesDetection(moveId) {
  return State.mode === "camera_assisted_candidate" && canMatch(moveId, State.calibration);
}
// Reps per detected move: deliberately shorter than timer-based repeat so the
// gameplay doesn't take forever when every rep needs a real snap.
const DETECTION_REPS = { vowel_a_u: 4, vowel_e_u: 4, pucker_side_to_side: 4, pucker_circles: 4 };

function detectionReps(move) {
  return State.session.quick && move.id === "vowel_a_u" ? 2 : DETECTION_REPS[move.id];
}

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
  const requiredReps = detectionReps(move);
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
  g.cue = g.pendingCue = null;
  g.lastBucket = null;
  g.lastOvershoot = null;
  document.getElementById("phaseCue").textContent = p.cue.en;
  document.getElementById("phaseSub").textContent = "Follow the guide, then hold gently.";
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
  const key = moveId ? guideKey(moveId, phase) : null;
  State.guideMotion?.cancel();
  document.getElementById("guideDetail").textContent = key ? POSES[key]?.detail || "Move gently." : "";
  if (!key) return;
  if (!State.guideSVG) {
    const host = document.getElementById("heroGuide");
    host.innerHTML = portraitSVG(key, "Animated face movement guide");
    State.guideSVG = host.querySelector?.("svg");
  }
  placeGuide(State.intro || State.mode === "guided");
  State.guideMotion = animatePortrait(State.guideSVG, [key], {reduced: reducedMotion()});
  if (State.paused) State.guideMotion.pause();
  if (!State.intro) speakGuide(POSES[key]?.title);
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
  const cue = g.fill > 0 ? "hold" : result?.correction;
  if (!cue || elapsed > 250) {
    g.cue = g.pendingCue = null;
    State.lipRippleAt = null;
  } else if (cue !== g.pendingCue) {
    g.pendingCue = cue;
    g.cueSince = now;
  } else if (now - g.cueSince >= 120) {
    g.cue = cue;
  }
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
  State.lipRippleAt = performance.now();
  if (State.faceView !== "line") flashSnap(petals);
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
  const done = petalsPerRep?.length || 0;
  document.getElementById("roundProgress").textContent = done === total ? total + " rounds complete" : "Round " + (done+1) + " of " + total;
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
  if (State.lipRippleAt == null || State.faceView !== "line") showCompletionFlash(quality);
  AudioEngine.complete(quality);
  setStageLabel("Done");
  renderMoveGuide("", "");
  renderHoldProgress();
  const cueEl = document.getElementById("phaseCue");
  const subEl = document.getElementById("phaseSub");
  if (cueEl) cueEl.textContent = "Move complete";
  if (subEl) subEl.textContent = "";
  scheduleCue("rest", () => nextMove(), 1800);
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
// inner-cheek movements that are paced rather than camera-confirmed.
function runActivePaced(move) {
  const sched = buildPhaseTimeline(move);
  const s = State.session;
  const moveState = s.moves[s.moveIndex];

  setStageLabel(State.mode === "guided" ? "Follow" : "Timed guide");
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
    State.active = { moveId: move.id, phase: p.phase, guideCue: guideKey(move.id, p.phase), startedAt: performance.now() };
    document.getElementById("phaseCue").textContent = p.cue.en;
    document.getElementById("phaseSub").textContent = State.mode === "guided" ? "" : "Timed guidance · self-confirmed.";
    renderMoveGuide(move.id, p.phase);
    renderHoldProgress();
    setPhaseVisual(phaseVisualFor(move.id, p.phase));

    if (p.cycleIdx !== lastCycleIdx) {
      lastCycleIdx = p.cycleIdx;
      renderRhythmDots(cycleCountFor(move), p.cycleIdx);
    }

    i++;
    scheduleCue("phase", runPhase, p.durationMs);
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
    const move = currentMove();
    moveState.attempts++;
    runDemo(move);
    return;
  }

  moveState.status = status;                   // completed | partial | skipped
  moveState.userConfirmed = status === "completed";
  moveState.endedAt = new Date().toISOString();

  if (s.quick) { finishSession(); return; }
  // Short rest with outro
  setStageLabel("Rest");
  const restMs = Math.min(2500, State.routine.defaults.resultRestMs);
  scheduleCue("rest", () => nextMove(), restMs);
}

// --- Pause / resume ---
function pauseExercise(fromVisibility) {
  if (!State.session) return;
  if (!State.paused) for (const entry of Object.values(State.scheduled)) {
    clearTimeout(entry.timer); entry.remaining = Math.max(0, entry.remaining - (performance.now()-entry.started));
  }
  State.paused = true;
  State.guideMotion?.pause(); State.guideFlip?.pause(); window.speechSynthesis?.pause();
  if (State.phaseGate) State.phaseGate.fill = 0;
  renderHoldProgress();
  document.getElementById("pauseOverlay").hidden = fromVisibility ? true : false;
  document.getElementById("pauseBtn").textContent = "▶";
  document.getElementById("pauseBtn").setAttribute("aria-label", "Resume");
}
function resumeExercise() {
  const wasPaused = State.paused;
  State.paused = false;
  if (wasPaused) for (const entry of Object.values(State.scheduled)) {
    entry.started = performance.now(); entry.timer = setTimeout(entry.fire, entry.remaining);
  }
  State.guideMotion?.resume(); State.guideFlip?.play(); window.speechSynthesis?.resume();
  document.getElementById("pauseOverlay").hidden = true;
  document.getElementById("pauseBtn").textContent = "II";
  document.getElementById("pauseBtn").setAttribute("aria-label", "Pause");
}

// --- Demo replay overlay ---
function showDemoOverlay() {
  const s = State.session;
  if (!s) return;
  const m = currentMove();
  document.getElementById("demoIllustrations").innerHTML = portraitSVG(guideKey(m.id,m.phaseSchedule[0].phase));
  State.replayMotion?.cancel();
  State.replayMotion = animatePortrait(document.getElementById("demoIllustrations").querySelector("svg"),guidePoseKeys(m),{reduced:reducedMotion(),onPose:key=>{document.getElementById("demoCue").textContent=POSES[key]?.detail||m.script.introEn;}});
  document.getElementById("demoTitle").textContent = m.title.en;
  document.getElementById("demoCue").textContent = m.script.introEn;
  document.getElementById("demoOverlay").hidden = false;
  pauseExercise(true);
}
function hideDemoOverlay() {
  State.replayMotion?.cancel();
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

  if (s.quick) {
    const completed = s.moves[0].status === "completed";
    if (completed) {
      const move = s.moves[0];
      const title = State.routine.moves.find(m => m.id === move.id).title.en;
      document.getElementById("quickResult").textContent = move.cameraConfirmed
        ? title + " · " + move.repPetals.length + " rounds · Camera confirmed"
        : title + " · Self-confirmed";
    }
    teardownExercise();
    if (completed) { show("quickDone"); } else { show("home"); renderHome(); }
    return;
  }

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

  document.getElementById("reportHeadline").textContent = session.partial ? "Session summary" : "Practice complete";
  renderMandala(session);

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
  document.getElementById("roundProgress").textContent = activeIdx < 0 ? total + " rounds" : "Round " + (activeIdx+1) + " of " + total;
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
  ctx.clearRect(0,0,w,h);
  return true;
}

function drawMesh(canvas, video, landmarks, showFeedback = false) {
  if (!fitCanvasToVideo(canvas, video) || !landmarks?.[0]) return;
  const raw = landmarks[0], w = video.videoWidth, h = video.videoHeight;
  const frame = faceFrame(raw,w,h);
  const face = measureFace(raw,State.blendshapes,w,h);
  if (!frame || !face) return;
  const pose = trackedSketch(raw,frame,w,h,face,State.calibration,State.blendshapes);
  const ctx = canvas.getContext("2d");
  ctx.save();
  fitSketch(ctx,canvas.clientWidth,canvas.clientHeight,Math.max(-.15,Math.min(.15,face.roll)));
  renderSketch(ctx,pose);
  if (showFeedback) drawFaceFeedback(ctx,pose);
  ctx.restore();
}

// Each mark has a tracked anchor, direction (x, y), and offset in portrait units.
// Paired cheek rings mark where to maintain a timed hold.
const INWARD_LIPS = [[61,1,0,-5,0],[291,-1,0,5,0]];
const OUTWARD_LIPS = [[61,-1,0,-17,0],[291,1,0,17,0]];
const LOWER_JAW = [[152,0,1,11,3]];
const FACE_MARKS = {
  "round-lips": INWARD_LIPS, u: INWARD_LIPS,
  "widen-lips": OUTWARD_LIPS, e: OUTWARD_LIPS,
  "lower-jaw": LOWER_JAW, a: LOWER_JAW,
  "lift-jaw": [[152,0,-1,11,-9]],
  left: [[291,1,0,18,0]], right: [[61,-1,0,-18,0]],
  up: [[291,0,-1,8,-12]], down: [[291,0,1,8,12]],
  tongue_left_up: [[425,0,-1,0,-6]], tongue_left_down: [[425,0,1,0,6]],
  tongue_right_up: [[205,0,-1,0,-6]], tongue_right_down: [[205,0,1,0,6]],
  air_left: [[425,1,0,2,0]], air_right: [[205,-1,0,-2,0]],
  draw_in: [[205,1,0,5,0],[425,-1,0,-5,0]],
  release: [[205,-1,0,-5,0],[425,1,0,5,0]],
  hold: [[205,0,0,0,0],[425,0,0,0,0]],
};

// Draw in the portrait's own coordinate system so camera mirroring, zoom
// and head movement affect the ink and the cue together.
function drawFaceFeedback(ctx, pose) {
  const gate = State.phaseGate;
  const cue = gate ? gate.cue : State.active?.guideCue;
  const now = performance.now();
  const ripple = State.lipRippleAt == null ? 1 : (now - State.lipRippleAt) / 480;
  if (ripple >= 1 && !cue) return;

  const {x:cx,y:cy,width,height} = mouthBounds(pose);
  const unit = 2.5;
  const anchors = {
    61:[cx-width/2,cy], 291:[cx+width/2,cy], 152:[433,785],
    205:[433-146*pose.faceWidth-pose.cheekL,633],425:[433+146*pose.faceWidth+pose.cheekR,633]
  };
  const still = reducedMotion();
  ctx.save();
  ctx.lineCap = ctx.lineJoin = "round";
  if (ripple < 1 || (gate && cue === "hold")) {
    ctx.strokeStyle = "#697442";
    if (ripple < 1) {
      const radius = width/2;
      const spread = (still ? 3 : 2 + 11*ripple) * unit;
      ctx.globalAlpha = .85*(1-ripple);
      ctx.lineWidth = 1.8*unit;
      ctx.beginPath();
      ctx.ellipse(cx,cy,radius+spread,height/2+spread,0,0,2*Math.PI);
      ctx.stroke();
    } else if (gate.fill > 0) {
      ctx.lineWidth = 2.3*unit;
      traceLipHold(ctx,pose,gate.fill);
    }
  } else {
    // Directions are in unmirrored source coordinates. Increasing x appears
    // on the user's left in the line portrait, just as in the guide illustration.
    const marks = FACE_MARKS[cue];
    const drift = still ? 0 : 1.5 * Math.sin((now - (gate?.cueSince ?? State.active.startedAt))/180);
    for (const [anchor,dx,dy,offsetX,offsetY] of marks || []) {
      const [x,y] = anchors[anchor];
      ctx.save();
      ctx.translate(x,y);
      ctx.scale(unit,unit);
      ctx.translate(offsetX+dx*drift,offsetY+dy*drift);
      ctx.strokeStyle = ctx.fillStyle = "#aa5b40";
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      if (dx || dy) {
        ctx.rotate(Math.atan2(dy,dx));
        ctx.moveTo(-12,1); ctx.quadraticCurveTo(-6,-1,0,0);
        ctx.moveTo(-4,-3.5); ctx.lineTo(0,0); ctx.lineTo(-4,3.5);
        ctx.stroke();
        if (cue.startsWith("tongue_")) {
          ctx.beginPath(); ctx.arc(4,0,1.7,0,2*Math.PI); ctx.fill();
        }
      } else {
        ctx.arc(0,0,3.5,0,2*Math.PI); ctx.stroke();
      }
      ctx.restore();
    }
  }
  ctx.restore();
}

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
  runDemo, beginCountdown, runReady, pauseExercise, resumeExercise, handleSelfResult, setFaceView, scheduleCue, clearPhaseTimers,
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
