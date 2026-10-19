// Test harness — drives the detection pipeline from UI sliders.
// Builds a mock face: ~25 hand-placed landmark positions wrapped in a
// 478-length array, applies the lip Δx/Δy sliders to the mouth landmarks,
// and runs the real advanceGate() / drawMesh() / Stickers.update() loop.

// Wait until app.js has published its API on window.FaceYoga.
await untilReady();
const FY = window.FaceYoga;

const BASE_LANDMARKS = buildBaseLandmarks();

// --- UI wiring ---
const slidersIds = ["sJaw", "sPuck", "sSmile", "sDx", "sDy"];
const valIds    = ["vJaw", "vPuck", "vSmile", "vDx", "vDy"];
const sliders = Object.fromEntries(slidersIds.map((id) => [id, document.getElementById(id)]));
const vals    = Object.fromEntries(valIds.map((id) => [id, document.getElementById(id)]));
slidersIds.forEach((id, i) => {
  sliders[id].addEventListener("input", () => {
    vals[valIds[i]].textContent = (+sliders[id].value).toFixed(2);
  });
  sliders[id].dispatchEvent(new Event("input"));
});

// --- Boot ---
await FY.loadRoutine();
populateMoveSelect();
await buildMockSession();
startMockLoop();

document.getElementById("testStart").addEventListener("click", () => {
  const idx = +document.getElementById("testMove").value;
  startMoveFromIndex(idx);
});
document.getElementById("testReset").addEventListener("click", () => {
  resetMoveState();
  document.getElementById("phaseCue").textContent = "pick a move below";
  document.getElementById("stageLabel").textContent = "Ready";
  document.getElementById("phaseSub").textContent = "—";
  renderRhythmDots(0, 0);
});
document.getElementById("testCollapse").addEventListener("click", () => {
  document.getElementById("testPanel").classList.toggle("collapsed");
});

// Hold / release shortcuts
document.getElementById("testHoldL").addEventListener("click", () => {
  setSliders({ jaw: 0.6, puck: 0, smile: 0.5, dx:  0.12, dy: 0 });
});
document.getElementById("testHoldR").addEventListener("click", () => {
  setSliders({ jaw: 0, puck: 0.7, smile: 0, dx: -0.12, dy: 0 });
});
document.getElementById("testHoldU").addEventListener("click", () => {
  setSliders({ jaw: 0, puck: 0.4, smile: 0, dx:  0, dy: -0.07 });
});
document.getElementById("testHoldD").addEventListener("click", () => {
  setSliders({ jaw: 0, puck: 0.4, smile: 0, dx:  0, dy:  0.07 });
});
document.getElementById("testRelease").addEventListener("click", () => {
  setSliders({ jaw: 0, puck: 0, smile: 0, dx: 0, dy: 0 });
});
document.getElementById("testForceSnap").addEventListener("click", () => {
  if (FY.State.phaseGate) {
    FY.State.phaseGate.fill = 1.01;
  }
});
document.getElementById("testPause").addEventListener("click", () => {
  FY.State.paused = !FY.State.paused;
  document.getElementById("testPause").textContent = FY.State.paused ? "▶" : "II";
});

function setSliders({ jaw, puck, smile, dx, dy }) {
  sliders.sJaw.value   = jaw;
  sliders.sPuck.value  = puck;
  sliders.sSmile.value = smile;
  sliders.sDx.value    = dx;
  sliders.sDy.value    = dy;
  slidersIds.forEach((id) => sliders[id].dispatchEvent(new Event("input")));
}

function populateMoveSelect() {
  const sel = document.getElementById("testMove");
  FY.State.routine.moves.forEach((m, i) => {
    const opt = document.createElement("option");
    opt.value = i;
    opt.textContent = `${i + 1}. ${m.title.en}${FY.DETECTION_MOVES.has(m.id) ? " ★" : ""}`;
    sel.appendChild(opt);
  });
}

// Minimal session scaffolding so startMoveFromIndex() can mutate it.
async function buildMockSession() {
  FY.State.mode = "camera_assisted_candidate";
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
  // Clear any running phase timers
  ["phase", "active", "demo", "ready", "rest"].forEach((k) => {
    const t = FY.State.timers[k];
    if (t) { clearTimeout(t); clearInterval(t); FY.State.timers[k] = null; }
  });
}

// --- Mock face landmarks (normalized 0..1 within a 480x640 "video") ---
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
  const shiftX = dx * eyeDist;
  const shiftY = dy * eyeDist;
  const copy = BASE_LANDMARKS.map((p) => ({ x: p.x, y: p.y, z: p.z }));
  for (const i of [13, 14, 61, 291]) {
    copy[i].x += shiftX;
    copy[i].y += shiftY;
  }
  return [copy];
}

// --- Fake video element (drawMesh reads videoWidth / videoHeight) ---
const fakeVideo = { videoWidth: 480, videoHeight: 640, currentTime: 0 };

function startMockLoop() {
  const meshEl = document.getElementById("exerciseMesh");
  let last = performance.now();
  const tick = () => {
    requestAnimationFrame(tick);
    const now = performance.now();
    const dt = now - last;
    last = now;

    const jaw   = +sliders.sJaw.value;
    const puck  = +sliders.sPuck.value;
    const smile = +sliders.sSmile.value;
    const dx    = +sliders.sDx.value;
    const dy    = +sliders.sDy.value;

    // Direct set (no EMA) so sliders feel responsive
    const bs = FY.State.blendshapes;
    bs.jawOpen = jaw;
    bs.mouthPucker = puck;
    bs.mouthSmileLeft = smile;
    bs.mouthSmileRight = smile;
    bs.browInnerUp = 0;

    FY.State.lastLandmarks = buildFrameLandmarks(dx, dy);

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
  document.getElementById("statusPhase").textContent = a ? (a.phase || "—") : "—";
  // Compute match score transparently (same logic as app.js)
  const match = computeMatch();
  document.getElementById("statusMatch").textContent = match.toFixed(2);
  const fill = g?.fill || 0;
  document.getElementById("statusFill").textContent = fill.toFixed(2);
  document.getElementById("phaseFillSpan").style.width = Math.round(fill * 100) + "%";
  document.getElementById("statusReps").textContent = g ? `${g.reps}/${g.requiredReps}` : "—";
}

function computeMatch() {
  const a = FY.State.active;
  if (!a) return 0;
  const bs = FY.State.blendshapes;
  const pts = FY.State.lastLandmarks?.[0];
  const key = a.moveId + ":" + a.phase;
  switch (key) {
    case "vowel_a_u:a": return Math.min(1, (bs.jawOpen || 0) / 0.35);
    case "vowel_a_u:u":
    case "vowel_e_u:u": return Math.min(1, (bs.mouthPucker || 0) / 0.45);
    case "vowel_e_u:e": return Math.min(1, (((bs.mouthSmileLeft || 0) + (bs.mouthSmileRight || 0)) / 2) / 0.30);
    case "pucker_side_to_side:left":
    case "pucker_side_to_side:right": {
      if (!pts) return 0;
      const puck = bs.mouthPucker || 0;
      if (puck < 0.18) return 0;
      const d = lipDev(pts);
      const sign = a.phase === "left" ? 1 : -1;
      return Math.min(1, Math.max(0, (d.dx * sign) / 0.085));
    }
    case "pucker_circles:left":
    case "pucker_circles:right":
    case "pucker_circles:up":
    case "pucker_circles:down": {
      if (!pts) return 0;
      const puck = bs.mouthPucker || 0;
      if (puck < 0.18) return 0;
      const d = lipDev(pts);
      switch (a.phase) {
        case "left":  return Math.min(1, Math.max(0,  d.dx) / 0.075);
        case "right": return Math.min(1, Math.max(0, -d.dx) / 0.075);
        case "up":    return Math.min(1, Math.max(0, -d.dy) / 0.045);
        case "down":  return Math.min(1, Math.max(0,  d.dy) / 0.045);
      }
    }
  }
  return 0;
}

function lipDev(pts) {
  const nose = pts[1], upperLip = pts[13], lowerLip = pts[14];
  const lipL = pts[61], lipR = pts[291];
  const eyeL = pts[33], eyeR = pts[263];
  const eyeDistX = Math.abs(eyeR.x - eyeL.x) || 0.001;
  const lipCX = (lipL.x + lipR.x) / 2;
  const lipCY = (upperLip.y + lowerLip.y) / 2;
  const dx = (lipCX - nose.x) / eyeDistX;
  const neutralY = nose.y + eyeDistX * 0.35;
  const dy = (lipCY - neutralY) / eyeDistX;
  return { dx, dy };
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
