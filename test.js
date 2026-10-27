import { measureFace } from "./tracking.mjs";
// Test harness — drives the detection pipeline from UI sliders.
// Builds a mock face: hand-placed landmark positions in a 478-length array,
// applies the lip Δx/Δy sliders to the mouth landmarks, and runs the real
// advanceGate() / drawMesh() / Stickers.update() loop at ~60fps.

await untilReady();
const FY = window.FaceYoga;

const BASE_LANDMARKS = buildBaseLandmarks();
const fakeVideo = { videoWidth: 480, videoHeight: 640, currentTime: 0 };

// --- UI wiring ---
const sliderIds = ["sJaw", "sPuck", "sSmile", "sDx", "sDy"];
const valIds    = ["vJaw", "vPuck", "vSmile", "vDx", "vDy"];
const sliders = {};
const vals = {};
sliderIds.forEach((id, i) => {
  sliders[id] = document.getElementById(id);
  vals[valIds[i]] = document.getElementById(valIds[i]);
  sliders[id].addEventListener("input", () => {
    vals[valIds[i]].textContent = (+sliders[id].value).toFixed(2);
  });
  sliders[id].dispatchEvent(new Event("input"));
});

// --- Boot ---
await FY.loadRoutine();
populateMoveSelect();
buildMockSession();
startMockLoop();

document.getElementById("testStart").addEventListener("click", () => {
  const idx = +document.getElementById("testMove").value;
  startMoveFromIndex(idx);
});
document.getElementById("testReset").addEventListener("click", () => {
  resetMoveState();
  document.getElementById("phaseCue").textContent = "Pick a move";
  document.getElementById("phaseSub").textContent = "then press Start";
  document.getElementById("stageLabel").textContent = "Ready";
  document.getElementById("moveIndex").textContent = "—";
  document.getElementById("sessionProgress").style.width = "0%";
  renderRhythmDots(0, -1);
});

document.getElementById("testPause").addEventListener("click", () => {
  FY.State.paused = !FY.State.paused;
  document.getElementById("testPause").textContent = FY.State.paused ? "▶" : "II";
});

// Preset buttons
document.getElementById("testHoldA").addEventListener("click", () =>
  setSliders({ jaw: 0.6, puck: 0, smile: 0, dx: 0, dy: 0 }));
document.getElementById("testHoldU").addEventListener("click", () =>
  setSliders({ jaw: 0, puck: 0.7, smile: 0, dx: 0, dy: 0 }));
document.getElementById("testHoldE").addEventListener("click", () =>
  setSliders({ jaw: 0.05, puck: 0, smile: 0.5, dx: 0, dy: 0 }));
document.getElementById("testPuckL").addEventListener("click", () =>
  setSliders({ jaw: 0, puck: 0.4, smile: 0, dx:  0.12, dy: 0 }));
document.getElementById("testPuckR").addEventListener("click", () =>
  setSliders({ jaw: 0, puck: 0.4, smile: 0, dx: -0.12, dy: 0 }));
document.getElementById("testPuckUp").addEventListener("click", () =>
  setSliders({ jaw: 0, puck: 0.4, smile: 0, dx: 0, dy: -0.07 }));
document.getElementById("testPuckDn").addEventListener("click", () =>
  setSliders({ jaw: 0, puck: 0.4, smile: 0, dx: 0, dy: 0.07 }));
document.getElementById("testRelease").addEventListener("click", () =>
  setSliders({ jaw: 0, puck: 0, smile: 0, dx: 0, dy: 0 }));
document.getElementById("testForceSnap").addEventListener("click", () => {
  if (FY.State.phaseGate) FY.State.phaseGate.fill = 1.01;
});
document.getElementById("testSound").addEventListener("click", (e) => {
  FY.AudioEngine.setEnabled(!FY.AudioEngine.enabled);
  e.target.textContent = FY.AudioEngine.enabled ? "♪ on" : "♪ sound";
  if (FY.AudioEngine.enabled) FY.AudioEngine.tone(660, 120, "sine", 0.08);
});

function setSliders({ jaw, puck, smile, dx, dy }) {
  sliders.sJaw.value = jaw;
  sliders.sPuck.value = puck;
  sliders.sSmile.value = smile;
  sliders.sDx.value = dx;
  sliders.sDy.value = dy;
  sliderIds.forEach((id) => sliders[id].dispatchEvent(new Event("input")));
}

function populateMoveSelect() {
  const sel = document.getElementById("testMove");
  FY.State.routine.moves.forEach((m, i) => {
    const opt = document.createElement("option");
    opt.value = i;
    const star = FY.DETECTION_MOVES.has(m.id) ? " ★" : "";
    opt.textContent = `${i + 1}. ${m.title.en}${star}`;
    sel.appendChild(opt);
  });
}

function buildMockSession() {
  FY.State.mode = "camera_assisted_candidate";
  // Explicit synthetic reference poses: this harness never substitutes for live calibration.
  const neutral = measureFace(BASE_LANDMARKS, {}, 480, 640);
  const u = { ...neutral, pucker: .7 };
  FY.State.calibration = {
    neutral, a: { ...neutral, jaw: .6 }, u, e: { ...neutral, smile: .5 },
    left: { ...u, x: neutral.x + .12 }, right: { ...u, x: neutral.x - .12 },
    up: { ...u, y: neutral.y - .07 * 640/480 }, down: { ...u, y: neutral.y + .07 * 640/480 },
  };
  FY.State.session = {
    startedAt: new Date().toISOString(),
    date: new Date().toISOString().slice(0, 10),
    mode: FY.State.mode,
    routineVersion: FY.State.routine.routineVersion,
    moveIndex: -1,
    moves: FY.State.routine.moves.map((m) => ({
      id: m.id, mode: FY.State.mode, plannedActiveMs: m.activeMs,
      activeElapsedMs: 0, status: "not_started", userConfirmed: null, attempts: 0,
    })),
  };
  FY.State.observations = { matchedMs: 0, smileWarmth: 0, samples: 0 };
  FY.Stickers.exercise = new FY.StickerLayer("exerciseStickers");
}

function startMoveFromIndex(i) {
  resetMoveState();
  FY.State.session.moveIndex = i;
  const move = FY.State.routine.moves[i];
  document.getElementById("moveIndex").textContent = i + 1;
  document.getElementById("sessionProgress").style.width = (i / 7) * 100 + "%";
  FY.runActive(move);
}

function resetMoveState() {
  FY.State.phaseGate = null;
  FY.State.active = null;
  ["phase", "active", "demo", "ready", "rest"].forEach((k) => {
    const t = FY.State.timers[k];
    if (t) { clearTimeout(t); clearInterval(t); FY.State.timers[k] = null; }
  });
}

// --- Mock face landmarks (normalized 0..1 for a 480x640 "video") ---
function buildBaseLandmarks() {
  const positions = {
    1:   { x: 0.50, y: 0.55 },
    10:  { x: 0.50, y: 0.21 },
    103: { x: 0.33, y: 0.23 },
    332: { x: 0.67, y: 0.23 },
    70:  { x: 0.30, y: 0.33 },
    300: { x: 0.70, y: 0.33 },
    55:  { x: 0.44, y: 0.33 },
    285: { x: 0.56, y: 0.33 },
    33:  { x: 0.33, y: 0.42 },
    263: { x: 0.67, y: 0.42 },
    133: { x: 0.44, y: 0.42 },
    362: { x: 0.56, y: 0.42 },
    234: { x: 0.22, y: 0.55 },
    454: { x: 0.78, y: 0.55 },
    13:  { x: 0.50, y: 0.72 },
    14:  { x: 0.50, y: 0.76 },
    61:  { x: 0.42, y: 0.74 },
    291: { x: 0.58, y: 0.74 },
    148: { x: 0.42, y: 0.88 },
    377: { x: 0.58, y: 0.88 },
    152: { x: 0.50, y: 0.93 },
  };
  const arr = new Array(478);
  for (let i = 0; i < 478; i++) arr[i] = { x: 0.5, y: 0.5, z: 0 };
  for (const [k, p] of Object.entries(positions)) arr[+k] = { x: p.x, y: p.y, z: 0 };
  return arr;
}

function buildFrameLandmarks(dx, dy) {
  const eyeDist = 0.34;
  const sx = dx * eyeDist;
  const sy = dy * eyeDist;
  const copy = BASE_LANDMARKS.map((p) => ({ x: p.x, y: p.y, z: p.z }));
  for (const i of [13, 14, 61, 291]) {
    copy[i].x += sx;
    copy[i].y += sy;
  }
  return [copy];
}

function startMockLoop() {
  const meshEl = document.getElementById("exerciseMesh");
  const tick = () => {
    requestAnimationFrame(tick);

    const jaw   = +sliders.sJaw.value;
    const puck  = +sliders.sPuck.value;
    const smile = +sliders.sSmile.value;
    const dx    = +sliders.sDx.value;
    const dy    = +sliders.sDy.value;

    const bs = FY.State.blendshapes;
    bs.jawOpen = jaw;
    bs.mouthPucker = puck;
    bs.mouthSmileLeft = smile;
    bs.mouthSmileRight = smile;
    bs.browInnerUp = 0;

    FY.State.lastLandmarks = buildFrameLandmarks(dx, dy);
    FY.State.frameSize = { width: 480, height: 640 };
    FY.State.lastFrameAt = performance.now();

    FY.advanceGate();
    FY.drawMesh(meshEl, fakeVideo, FY.State.lastLandmarks);
    FY.Stickers.exercise.update(FY.State.lastLandmarks, meshEl);

    updateStatus();
  };
  tick();
}

function updateStatus() {
  const a = FY.State.active;
  const g = FY.State.phaseGate;
  document.getElementById("statusPhase").textContent = a?.phase || "—";
  document.getElementById("statusMatch").textContent = computeMatch().toFixed(2);
  const fill = g?.fill || 0;
  document.getElementById("statusFill").textContent = fill.toFixed(2);
  document.getElementById("fillSpan").style.width = Math.round(fill * 100) + "%";
  document.getElementById("statusReps").textContent = g ? `${g.reps}/${g.requiredReps}` : "—";

  // Keep the cue-card dots in sync (app.js renderRhythmDots targets same id)
  if (g) renderRhythmDots(g.requiredReps, g.reps);
}

function computeMatch() {
  return FY.evaluatePrecision()?.precision || 0;
}

function renderRhythmDots(total, active) {
  const el = document.getElementById("rhythmDots");
  el.innerHTML = "";
  for (let i = 0; i < total; i++) {
    const s = document.createElement("span");
    s.className = "r" + (i < active ? " done" : i === active ? " on" : "");
    el.appendChild(s);
  }
}

async function untilReady() {
  for (let i = 0; i < 120; i++) {
    if (window.FaceYoga && window.__appReady) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("FaceYoga did not initialise");
}

