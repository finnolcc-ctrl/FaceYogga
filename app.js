// Face Yoga MVP — Guided-first prototype.
// Spec: CLAUDE_HANDOFF v0.2 + routine.v2.json.
// Camera-assisted mode is intentionally labelled "experimental" and does NOT
// drive scoring or cycle counting in this build.

import {
  FaceLandmarker,
  FilesetResolver,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.0/vision_bundle.mjs";

const STORAGE_KEY = "faceyoga.v2";
const MP_VERSION = "1.1.0";
const MODEL_URL  = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

// =====================================================
// FACE MESH OVERLAY
// Dots + lines that follow the user's face in real time.
// Sticker slots take image URLs — drop files into
// /stickers/ and update STICKER_SLOTS[x].imageUrl.
// =====================================================
const MESH_POINTS = [
  10, 103, 332, 70, 300, 55, 285,
  33, 263, 133, 362,
  1, 234, 454,
  61, 291, 148, 377, 152,
];
const MESH_CONNECTIONS = [
  [10,103],[10,332],[103,332],[103,70],[332,300],
  [70,55],[55,285],[285,300],
  [70,33],[300,263],[55,133],[285,362],
  [33,1],[263,1],[133,1],[362,1],
  [1,234],[1,454],[234,33],[454,263],
  [234,61],[454,291],[1,61],[1,291],
  [61,148],[291,377],[148,377],[148,152],[377,152],
];
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
    if (this.built || !this.container) return;
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
  renderHome();
  renderPreviewList();
  show("home");

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && State.session && !State.paused) {
      pauseExercise(true);
    }
  });
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

const Actions = {
  startSession:   () => { renderPreviewList(); show("preview"); },
  goHome:         () => { teardownExercise(); show("home"); renderHome(); },
  toPreview:      () => show("preview"),
  toCameraChoice: () => show("cameraChoice"),
  chooseGuided:   () => { State.mode = "guided"; stopCamera(); startSession("guided"); },
  chooseCamera:   () => beginCameraSetup(),
  skipCalibration:() => { stopCalibration(); startSession("camera_assisted_candidate"); },
  togglePause:    () => (State.paused ? resumeExercise() : pauseExercise(false)),
  resume:         () => resumeExercise(),
  endSession:     () => endSessionConfirm(),
  skipMove:       () => handleSelfResult("skipped"),
  replayDemo:     () => showDemoOverlay(),
  demoDone:       () => hideDemoOverlay(),
  selfCompleted:  () => handleSelfResult("completed"),
  selfRetry:      () => handleSelfResult("retry"),
  selfSkip:       () => handleSelfResult("skipped"),
};

// =========================================================
// HOME
// =========================================================
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
    li.innerHTML = `<span class="idx">${m.order}</span><span>${m.title.en}</span><span class="dur">${Math.round(m.activeMs/1000)}s</span>`;
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
        State.lastLandmarks = res.faceLandmarks;
        const hasFace = res.faceLandmarks?.length > 0;
        readBlendshapes(res);
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
            setTimeout(() => beginCalibration(), 500);
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
        State.lastLandmarks = res.faceLandmarks;
        readBlendshapes(res);
        updateAurora();
        advanceGate();
        drawMesh(meshEl, videoEl, res.faceLandmarks);
        Stickers.exercise.update(res.faceLandmarks, meshEl);
        if (res.faceLandmarks?.length) meshEl.classList.add("on");
        else meshEl.classList.remove("on");
      } catch {}
    }
  };
  tick();
}

// Calibration: 4 timed steps with breath ring. For MVP we record a marker
// but do NOT drive detection off these samples.
function beginCalibration() {
  show("calibration");
  const steps = [
    { label: "1 / 4", cue: "Keep a relaxed natural face", sub: "2 seconds · neutral" },
    { label: "2 / 4", cue: "Open your mouth for A",       sub: "2 seconds · no sound" },
    { label: "3 / 4", cue: "Round your lips for U",       sub: "2 seconds · gently" },
    { label: "4 / 4", cue: "Widen the corners for E",     sub: "2 seconds · no clenching" },
  ];
  let i = 0;
  const run = () => {
    if (i >= steps.length) {
      saveStore((d) => { d.lastCalibrationAt = new Date().toISOString(); });
      startSession("camera_assisted_candidate");
      return;
    }
    document.getElementById("calibStep").textContent = steps[i].label;
    document.getElementById("calibCue").textContent  = steps[i].cue;
    document.getElementById("calibSub").textContent  = steps[i].sub;
    i++;
    State.timers.setup = setTimeout(run, 2200);
  };
  run();
}

function stopCalibration() {
  clearTimeout(State.timers.setup);
}

function stopCamera() {
  if (State.cameraStream) {
    State.cameraStream.getTracks().forEach((t) => t.stop());
    State.cameraStream = null;
  }
  cancelAnimationFrame(State.timers.setup);
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
  return State.mode === "camera_assisted_candidate" && DETECTION_MOVES.has(moveId);
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
  renderRhythmDots(requiredReps, 0);

  State.phaseGate = {
    moveId: move.id,
    phases: schedule,
    phaseIdx: 0,
    fill: 0,
    reps: 0,
    requiredReps,
    startTime: performance.now(),
    lastTick: performance.now(),
  };
  stepGatedPhase();

  // Soft safety: 2× the planned active time. If stuck we mark the
  // move as partial (gracefully honest), flash a quiet checkmark,
  // and continue to the next move so the ritual flows.
  const maxMs = (move.activeMs || 20000) * 2;
  State.timers.active = setTimeout(() => {
    if (State.phaseGate) {
      moveState.activeElapsedMs = performance.now() - State.phaseGate.startTime;
      moveState.status = moveState.status === "not_started"
        ? (State.phaseGate.reps > 0 ? "partial" : "skipped")
        : moveState.status;
      moveState.endedAt = new Date().toISOString();
      State.phaseGate = null;
      State.active = null;
      autoAdvance();
    }
  }, maxMs);
}

function stepGatedPhase() {
  const g = State.phaseGate;
  if (!g) return;
  const p = g.phases[g.phaseIdx % g.phases.length];
  State.active = { moveId: g.moveId, phase: p.phase };
  g.fill = 0;
  g.lastTick = performance.now();
  document.getElementById("phaseCue").textContent = p.cue.en;
  document.getElementById("phaseSub").textContent = `Hold the ${p.phase.toUpperCase()} shape`;
  setPhaseVisual(phaseVisualFor(g.moveId, p.phase));
}

function matchForActivePhase() {
  const a = State.active;
  if (!a) return 0;
  const bs = State.blendshapes;
  const pts = State.lastLandmarks?.[0];
  const key = a.moveId + ":" + a.phase;
  switch (key) {
    case "vowel_a_u:a":
      return Math.min(1, (bs.jawOpen || 0) / 0.35);
    case "vowel_a_u:u":
    case "vowel_e_u:u":
      return Math.min(1, (bs.mouthPucker || 0) / 0.45);
    case "vowel_e_u:e":
      return Math.min(1, (((bs.mouthSmileLeft || 0) + (bs.mouthSmileRight || 0)) / 2) / 0.30);

    // Pucker side-to-side: must be puckering AND lip center deviated to the right side
    case "pucker_side_to_side:left":
    case "pucker_side_to_side:right": {
      if (!pts) return 0;
      const puck = bs.mouthPucker || 0;
      if (puck < 0.18) return 0;
      const dev = lipDeviation(pts);
      if (!dev) return 0;
      const sign = a.phase === "left" ? 1 : -1;
      return Math.min(1, Math.max(0, (dev.dx * sign) / 0.085));
    }

    // Pucker circles: 4-phase cycle; each phase requires lip in the matching quadrant
    case "pucker_circles:left":
    case "pucker_circles:right":
    case "pucker_circles:up":
    case "pucker_circles:down": {
      if (!pts) return 0;
      const puck = bs.mouthPucker || 0;
      if (puck < 0.18) return 0;
      const dev = lipDeviation(pts);
      if (!dev) return 0;
      let s = 0;
      switch (a.phase) {
        case "left":  s = Math.max(0,  dev.dx) / 0.075; break;
        case "right": s = Math.max(0, -dev.dx) / 0.075; break;
        case "up":    s = Math.max(0, -dev.dy) / 0.045; break;
        case "down":  s = Math.max(0,  dev.dy) / 0.045; break;
      }
      return Math.min(1, s);
    }

    default: return 0;
  }
}

// Lip center deviation from nose, normalized by eye distance.
// dx > 0 means lips moved toward the user's own LEFT (camera's right).
function lipDeviation(pts) {
  const nose = pts[1], upperLip = pts[13], lowerLip = pts[14];
  const lipL = pts[61], lipR = pts[291];
  const eyeL = pts[33], eyeR = pts[263];
  if (!nose || !upperLip || !lowerLip || !lipL || !lipR || !eyeL || !eyeR) return null;
  const eyeDistX = Math.abs(eyeR.x - eyeL.x) || 0.001;
  const lipCX = (lipL.x + lipR.x) / 2;
  const lipCY = (upperLip.y + lowerLip.y) / 2;
  const dx = (lipCX - nose.x) / eyeDistX;
  // Vertical reference: estimate neutral lip Y as a fixed proportion below nose
  const neutralY = nose.y + eyeDistX * 0.35;
  const dy = (lipCY - neutralY) / eyeDistX;
  return { dx, dy, lipCX, lipCY, noseX: nose.x, noseY: nose.y, eyeDistX };
}

function advanceGate() {
  const g = State.phaseGate;
  if (!g || State.paused) { if (g) g.lastTick = performance.now(); return; }
  const now = performance.now();
  const dt = Math.min(0.1, (now - g.lastTick) / 1000);
  g.lastTick = now;

  const match = matchForActivePhase();
  const HOLD = 0.6;              // threshold to count as "matching"
  const FILL_TIME = 1.0;         // seconds of full match -> snap
  const DRAIN_TIME = 1.6;        // seconds to fully drain

  if (match >= HOLD) {
    g.fill = Math.min(1, g.fill + (match * dt) / FILL_TIME);
    if (State.observations) State.observations.matchedMs += dt * 1000;
  } else {
    g.fill = Math.max(0, g.fill - dt / DRAIN_TIME);
  }

  if (g.fill >= 1) snapRep();
}

function snapRep() {
  const g = State.phaseGate;
  if (!g) return;
  g.reps++;
  g.phaseIdx++;
  g.fill = 0;
  renderRhythmDots(g.requiredReps, g.reps);
  flashSnap();

  if (g.reps >= g.requiredReps) {
    const moveState = State.session.moves[State.session.moveIndex];
    moveState.activeElapsedMs = performance.now() - g.startTime;
    moveState.status = "completed";
    moveState.userConfirmed = true;
    moveState.endedAt = new Date().toISOString();
    State.phaseGate = null;
    State.active = null;
    if (State.timers.active) { clearTimeout(State.timers.active); State.timers.active = null; }
    autoAdvance();
  } else {
    stepGatedPhase();
  }
}

// Detection-driven moves auto-complete after all reps — no self-check.
function autoAdvance() {
  showCompletionFlash();
  setStageLabel("Done");
  const cueEl = document.getElementById("phaseCue");
  const subEl = document.getElementById("phaseSub");
  if (cueEl) cueEl.textContent = "Nice.";
  if (subEl) subEl.textContent = "";
  State.timers.rest = setTimeout(() => nextMove(), 1500);
}

function showCompletionFlash() {
  const flash = document.createElement("div");
  flash.className = "completion-flash";
  flash.innerHTML = '<span class="mark">✓</span>';
  document.body.appendChild(flash);
  setTimeout(() => flash.remove(), 1500);
}

function flashSnap() {
  const stage = document.getElementById("phaseStage");
  if (!stage) return;
  stage.classList.remove("snap");
  // Force reflow so the class re-applies and the animation restarts.
  void stage.offsetWidth;
  stage.classList.add("snap");
  setTimeout(() => stage.classList.remove("snap"), 650);
}

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
    document.getElementById("phaseSub").textContent = "";
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
  document.getElementById("pauseOverlay").hidden = fromVisibility ? true : false;
  document.getElementById("pauseBtn").textContent = "▶";
}
function resumeExercise() {
  State.paused = false;
  document.getElementById("pauseOverlay").hidden = true;
  document.getElementById("pauseBtn").textContent = "II";
}

// --- Demo replay overlay ---
function showDemoOverlay() {
  const s = State.session;
  if (!s) return;
  const m = State.routine.moves[s.moveIndex];
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
  const dpr = window.devicePixelRatio || 1;
  const w = video.videoWidth, h = video.videoHeight;
  if (!w || !h) return false;
  if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
    canvas.width  = w * dpr;
    canvas.height = h * dpr;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  return true;
}

function drawMesh(canvas, video, landmarks) {
  if (!fitCanvasToVideo(canvas, video)) return;
  const ctx = canvas.getContext("2d");
  const w = video.videoWidth, h = video.videoHeight;
  ctx.clearRect(0, 0, w, h);
  if (!landmarks || !landmarks.length) return;
  const pts = landmarks[0];

  ctx.strokeStyle = "rgba(255,255,255,0.55)";
  ctx.lineWidth = Math.max(1, w / 640);
  ctx.lineCap = "round";
  ctx.beginPath();
  for (const [a, b] of MESH_CONNECTIONS) {
    const pa = pts[a], pb = pts[b];
    if (!pa || !pb) continue;
    ctx.moveTo(pa.x * w, pa.y * h);
    ctx.lineTo(pb.x * w, pb.y * h);
  }
  ctx.stroke();

  ctx.fillStyle = "#fff";
  const r = Math.max(2.5, w / 240);
  for (const idx of MESH_POINTS) {
    if (STICKER_ANCHORS.has(idx)) continue;    // the sticker is the dot here
    const p = pts[idx];
    if (!p) continue;
    ctx.beginPath();
    ctx.arc(p.x * w, p.y * h, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Dotted target shape for vowel phases — the user matches their lips to this outline.
  if (State.active) {
    drawPhaseTarget(ctx, pts, w, h, State.active.moveId, State.active.phase);
    drawPuckerGuide(ctx, pts, w, h, State.active.moveId, State.active.phase);
  }
}

function drawPuckerGuide(ctx, pts, w, h, moveId, phase) {
  if (moveId !== "pucker_side_to_side" && moveId !== "pucker_circles") return;
  const dev = lipDeviation(pts);
  if (!dev) return;

  const noseX = dev.noseX * w;
  const neutralLipY = (dev.noseY + dev.eyeDistX * 0.35) * h;
  const eyeDistPx = dev.eyeDistX * w;
  const matchScore = matchForActivePhase();
  const warm = matchScore;
  const gateFill = State.phaseGate?.fill || 0;

  ctx.save();

  if (moveId === "pucker_side_to_side") {
    const sign = phase === "left" ? 1 : -1;
    const targetX = noseX + sign * eyeDistPx * 0.1;
    const targetR = eyeDistPx * 0.045;

    // Target zone
    ctx.strokeStyle = `rgba(255, ${210 - warm * 60}, ${160 - warm * 110}, ${0.6 + warm * 0.4})`;
    ctx.lineWidth = 2 + warm * 1.5;
    ctx.setLineDash(warm > 0.55 ? [] : [6, 5]);
    ctx.shadowColor = `rgba(255,210,170,${0.3 + warm * 0.6})`;
    ctx.shadowBlur = 10 + warm * 20;
    ctx.beginPath();
    ctx.arc(targetX, neutralLipY, targetR, 0, Math.PI * 2);
    ctx.stroke();

    // Fill (gateFill grows while matching)
    if (gateFill > 0.02) {
      ctx.setLineDash([]);
      ctx.shadowBlur = 0;
      const grad = ctx.createRadialGradient(targetX, neutralLipY, 0, targetX, neutralLipY, targetR);
      grad.addColorStop(0, `rgba(255,210,160,${gateFill * 0.6})`);
      grad.addColorStop(1, "rgba(255,160,110,0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(targetX, neutralLipY, targetR * (0.7 + gateFill * 0.3), 0, Math.PI * 2);
      ctx.fill();
    }

  }

  if (moveId === "pucker_circles") {
    const centerX = noseX;
    const centerY = neutralLipY;
    const radius = eyeDistPx * 0.095;

    // Dashed track
    ctx.strokeStyle = "rgba(255,255,255,0.3)";
    ctx.lineWidth = 1.4;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    ctx.stroke();

    // Target position on the ring
    const angles = { left: 0, up: -Math.PI / 2, right: Math.PI, down: Math.PI / 2 };
    const angle = angles[phase];
    if (angle === undefined) { ctx.restore(); return; }
    const tx = centerX + Math.cos(angle) * radius;
    const ty = centerY + Math.sin(angle) * radius;
    const targetR = eyeDistPx * 0.038;

    // Target marker
    ctx.strokeStyle = `rgba(255, ${210 - warm * 60}, ${160 - warm * 110}, ${0.75 + warm * 0.25})`;
    ctx.lineWidth = 2 + warm * 1.5;
    ctx.setLineDash(warm > 0.55 ? [] : [5, 4]);
    ctx.shadowColor = `rgba(255,210,170,${0.3 + warm * 0.6})`;
    ctx.shadowBlur = 10 + warm * 18;
    ctx.beginPath();
    ctx.arc(tx, ty, targetR, 0, Math.PI * 2);
    ctx.stroke();

    // Fill
    if (gateFill > 0.02) {
      ctx.setLineDash([]);
      ctx.shadowBlur = 0;
      const grad = ctx.createRadialGradient(tx, ty, 0, tx, ty, targetR);
      grad.addColorStop(0, `rgba(255,210,160,${gateFill * 0.6})`);
      grad.addColorStop(1, "rgba(255,160,110,0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(tx, ty, targetR * (0.7 + gateFill * 0.3), 0, Math.PI * 2);
      ctx.fill();
    }

  }

  ctx.restore();
}

function drawPhaseTarget(ctx, pts, w, h, moveId, phase) {
  const corners = [pts[61], pts[291]];
  const lips = [pts[13], pts[14]];
  const eyes = [pts[33], pts[263]];
  if (!corners[0] || !corners[1] || !lips[0] || !lips[1] || !eyes[0] || !eyes[1]) return;

  const cx = ((corners[0].x + corners[1].x) / 2) * w;
  const cy = ((lips[0].y + lips[1].y) / 2) * h;
  const eyeDist = Math.hypot((eyes[1].x - eyes[0].x) * w, (eyes[1].y - eyes[0].y) * h);

  let rx, ry, matchScore = 0;
  const bs = State.blendshapes;
  switch (moveId + ":" + phase) {
    case "vowel_a_u:a":
      rx = eyeDist * 0.17; ry = eyeDist * 0.22;
      matchScore = Math.min(1, (bs.jawOpen || 0) / 0.35);
      break;
    case "vowel_a_u:u":
    case "vowel_e_u:u":
      rx = eyeDist * 0.09; ry = eyeDist * 0.11;
      matchScore = Math.min(1, (bs.mouthPucker || 0) / 0.45);
      break;
    case "vowel_e_u:e":
      rx = eyeDist * 0.26; ry = eyeDist * 0.08;
      matchScore = Math.min(1, (((bs.mouthSmileLeft || 0) + (bs.mouthSmileRight || 0)) / 2) / 0.30);
      break;
    default: return;
  }

  // Count matched time for the final report (observable: visible lip envelope met the target).
  if (State.observations && matchScore > 0.6 && !State.phaseGate) {
    State.observations.matchedMs = (State.observations.matchedMs || 0) + 33;
  }

  // Outline shifts cool-dashed → warm-solid as the user matches the target.
  const warm = matchScore;

  // Fill meter inside the target: grows while the gate is accumulating.
  const gateFill = State.phaseGate?.fill || 0;
  if (gateFill > 0.02) {
    ctx.save();
    const alpha = Math.min(0.55, gateFill * 0.55);
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(rx, ry));
    grad.addColorStop(0, `rgba(255,210,160,${alpha})`);
    grad.addColorStop(1, "rgba(255,160,110,0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx * (0.75 + gateFill * 0.25), ry * (0.75 + gateFill * 0.25), 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  const r = 255;
  const g = Math.round(210 - warm * 70);
  const b = Math.round(170 - warm * 110);
  const alpha = 0.55 + warm * 0.4;

  ctx.save();
  // soft outer halo
  ctx.shadowColor = `rgba(${r},${g+30},${b+50},${0.3 + warm * 0.5})`;
  ctx.shadowBlur = 12 + warm * 20;
  ctx.strokeStyle = `rgba(${r},${g},${b},${alpha})`;
  ctx.lineWidth = Math.max(1.5, w / 320) + warm * 2;
  if (warm < 0.55) {
    ctx.setLineDash([Math.max(5, w / 110), Math.max(5, w / 140)]);
  } else {
    ctx.setLineDash([]);
  }
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.stroke();

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
  if (!cats) return;
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
  { grad: "radial-gradient(ellipse at 50% 30%, #ffd7a8 0%, #ff8a7a 55%, #ff5f8a 100%)", rot: 0 },
  { grad: "radial-gradient(ellipse at 50% 30%, #ffcfe0 0%, #ff8ac6 55%, #a94ce7 100%)", rot: 51.4 },
  { grad: "radial-gradient(ellipse at 50% 30%, #fff3b5 0%, #ffc772 55%, #ff8a3d 100%)", rot: 102.8 },
  { grad: "radial-gradient(ellipse at 50% 30%, #ffe3f0 0%, #f9a8d9 55%, #d35bb0 100%)", rot: 154.2 },
  { grad: "radial-gradient(ellipse at 50% 30%, #d9f6e2 0%, #85d9b3 55%, #4ab09a 100%)", rot: 205.7 },
  { grad: "radial-gradient(ellipse at 50% 30%, #d9ebff 0%, #9ac1ff 55%, #6a8bff 100%)", rot: 257.1 },
  { grad: "radial-gradient(ellipse at 50% 30%, #f1dcff 0%, #c89aff 55%, #8a5df0 100%)", rot: 308.5 },
];

function renderMandala(session) {
  const el = document.getElementById("mandala");
  if (!el) return;
  el.innerHTML = "";

  session.moves.forEach((m, i) => {
    if (m.status !== "completed" && m.status !== "partial") return;
    const preset = PETAL_PRESETS[i];
    const petal = document.createElement("div");
    petal.className = "petal show" + (m.status === "partial" ? " partial" : "");
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
  async loadRoutine() {
    const res = await fetch("routine.v2.json");
    State.routine = await res.json();
    return State.routine;
  },
};

// Signal readiness for diagnostics
window.__appReady = true;
