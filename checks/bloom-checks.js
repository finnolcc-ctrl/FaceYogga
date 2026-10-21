// Bloom console checks. Run on test.html (needs the mock landmarks):
//   (await import('/checks/bloom-checks.js')).run()
// Pure helpers only — visuals are checked by eye and on device.

const EPS = 1e-6;

// --- Frame driver: the harness loop's steps, by hand (works with the pane hidden) ---
const FAKE_VIDEO = { videoWidth: 480, videoHeight: 640, currentTime: 0 };
let basePts = null;

export function frame(vals = {}) {
  const FY = window.FaceYoga;
  if (!basePts) basePts = FY.State.lastLandmarks[0].map((p) => ({ ...p }));
  const bs = FY.State.blendshapes;
  bs.jawOpen = vals.jaw || 0;
  bs.mouthPucker = vals.puck || 0;
  bs.mouthSmileLeft = bs.mouthSmileRight = vals.smile || 0;
  bs.browInnerUp = 0;
  const pts = basePts.map((p) => ({ ...p }));
  const sx = (vals.dx || 0) * 0.34, sy = (vals.dy || 0) * 0.34;
  for (const i of [13, 14, 61, 291]) { pts[i].x += sx; pts[i].y += sy; }
  FY.State.lastLandmarks = vals.noFace ? [] : [pts];
  FY.advanceGate();
  FY.drawMesh(document.getElementById("exerciseMesh"), FAKE_VIDEO, FY.State.lastLandmarks);
}

export function hash() {
  const c = document.getElementById("exerciseMesh");
  const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
  let h = 0;
  for (let i = 0; i < d.length; i++) h = (h * 31 + d[i]) >>> 0;
  return h;
}

// Same hand-placed face as test.js, for driving index.html without a camera.
const MOCK_FACE = {
  1: [0.50, 0.55], 10: [0.50, 0.21], 103: [0.33, 0.23], 332: [0.67, 0.23],
  70: [0.30, 0.33], 300: [0.70, 0.33], 55: [0.44, 0.33], 285: [0.56, 0.33],
  33: [0.33, 0.42], 263: [0.67, 0.42], 133: [0.44, 0.42], 362: [0.56, 0.42],
  234: [0.22, 0.55], 454: [0.78, 0.55], 13: [0.50, 0.72], 14: [0.50, 0.76],
  61: [0.42, 0.74], 291: [0.58, 0.74], 148: [0.42, 0.88], 377: [0.58, 0.88], 152: [0.50, 0.93],
};

export function mockFace(shiftY = 0) {
  const arr = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5 + shiftY, z: 0 }));
  for (const [k, [x, y]] of Object.entries(MOCK_FACE)) arr[+k] = { x, y: y + shiftY, z: 0 };
  return arr;
}

// index.html only: camera-mode session on move idx, skipping demo/ready.
export function cameraMove(idx, shiftY = 0) {
  const FY = window.FaceYoga;
  if (!FY.State.session) FY.startSession("camera_assisted_candidate");
  FY.State.mode = "camera_assisted_candidate";
  document.querySelector("[data-screen='exercise']").classList.add("in-camera-mode");
  document.getElementById("exerciseMesh").classList.add("on");
  ["phase", "active", "demo", "ready", "rest"].forEach((k) => {
    clearTimeout(FY.State.timers[k]); clearInterval(FY.State.timers[k]); FY.State.timers[k] = null;
  });
  FY.State.session.moveIndex = idx;
  basePts = mockFace(shiftY);
  FY.runActive(FY.State.routine.moves[idx]);
}

// index.html only: lifecycle checks for the Bloom timers and pill gating.
//   (await import('/checks/bloom-checks.js')).lifecycle()
export async function lifecycle() {
  const FY = window.FaceYoga;
  const B = FY.Bloom;
  const rows = [];
  const check = (name, pass, detail = "") => rows.push({ name, pass: !!pass, detail: String(detail) });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const mp = (i) => document.querySelectorAll("#miniMandala .mp")[i].className;
  const pill = document.getElementById("hintPill");

  // Skip after Completed (during the rest): no petal, no blossom, no blooms.
  cameraMove(2, -0.25);
  for (let i = 0; i < 3; i++) frame({ jaw: 0.35 });
  B.burst(3, 0);
  B.completeMove(2, { status: "completed", quality: 12 });
  B.completeMove(2, { status: "skipped" });
  check("skip cancels in-flight blooms", B.bursts.length === 0, B.bursts.length);
  await sleep(3000);                    // longer than the whole bloom → fly chain
  check("skip after completed: no mini-mandala petal", mp(2) === "mp", mp(2));
  check("skip after completed: no blossom", !document.querySelector("#bloomGarden .blossom"));

  // Skip after the petal already landed: the petal is taken back.
  B.startPaced(5, 20000);
  B.completeMove(5, { status: "completed" });
  await sleep(1400);
  const landed = mp(5);
  B.completeMove(5, { status: "skipped" });
  check("skip after landing removes petal", landed.includes("q2") && mp(5) === "mp", landed + " → " + mp(5));

  // Stale gate from an ended session: pill stays hidden until a phase starts.
  FY.teardownExercise();
  FY.State.phaseGate = { fill: 0, reps: 0, petals: [] };
  FY.startSession("guided");
  document.querySelector("[data-screen='exercise']").classList.add("in-camera-mode");
  frame({ jaw: 0.2 }); frame({ jaw: 0.2 });
  check("no pill without an active phase", !pill.classList.contains("show"), pill.className);
  FY.teardownExercise();

  // Pause: a burst stays drawn, and a stalled pause (no frames) does not jump it.
  cameraMove(2, -0.25);
  frame({ jaw: 0.35 });
  B.burst(3, 0);
  const b = B.bursts[0];
  await sleep(300); frame({});
  const tBefore = (performance.now() - b.t0) / 1000;
  FY.State.paused = true;
  frame({});
  const layer = document.getElementById("bloomLayer");
  // Burst centre pixel (the bud's strokes sit on the target outline, not here).
  const dpr = layer.width / 480;
  const lit = layer.getContext("2d").getImageData(Math.round(b.x * dpr), Math.round(b.y * dpr), 1, 1).data[3];
  check("paused burst is still drawn", lit > 0, lit);
  await sleep(700);                     // no frames: like a backgrounded tab
  FY.State.paused = false;
  frame({});
  const tAfter = (performance.now() - b.t0) / 1000;
  check("stalled pause does not jump the burst", Math.abs(tAfter - tBefore) < 0.15,
    tBefore.toFixed(2) + " → " + tAfter.toFixed(2));
  FY.teardownExercise();

  const failed = rows.filter((r) => !r.pass).length;
  console.table(rows);
  return { passed: rows.length - failed, failed, failures: rows.filter((r) => !r.pass).map((r) => r.name + ": " + r.detail) };
}

function startMove(idx) {
  document.getElementById("testMove").value = String(idx);
  try { document.getElementById("testStart").click(); } catch {}
}

// Pixel hashes of each target at fill 0. Compare before/after a refactor.
export function characterize() {
  const FY = window.FaceYoga;
  const shot = (idx, vals, phase) => {
    startMove(idx);
    if (phase) FY.State.active = { moveId: FY.State.active.moveId, phase };
    frame(vals); frame(vals);
    return hash();
  };
  return {
    a: shot(2, { jaw: 0.2 }),
    u: shot(2, { puck: 0.1 }, "u"),
    e: shot(3, { smile: 0.1 }),
    puckL: shot(0, { puck: 0.1, dx: 0.02 }),
    puckR: shot(0, { puck: 0.1, dx: -0.02 }, "right"),
    circL: shot(1, { puck: 0.1, dx: 0.01 }),
    circUp: shot(1, { puck: 0.1 }, "up"),
  };
}

export async function run() {
  const FY = window.FaceYoga;
  const rows = [];
  const check = (name, pass, detail = "") => rows.push({ name, pass: !!pass, detail: String(detail) });
  const near = (a, b) => Math.abs(a - b) < EPS;
  const safe = (name, fn) => {
    try { fn(); } catch (e) { check(name, false, e.message); }
  };

  safe("petalTier", () => {
    const cases = [[0.95, 3], [0.9, 3], [0.89, 2], [0.7, 2], [0.69, 1], [0.5, 1], [0.49, 0], [0, 0]];
    for (const [peak, want] of cases) {
      const got = FY.petalTier(peak);
      check(`petalTier(${peak})`, got === want, got);
    }
  });

  safe("mandalaTier", () => {
    const cases = [
      [{ status: "completed", quality: 12 }, "q3"],
      [{ status: "completed", quality: 10 }, "q3"],
      [{ status: "completed", quality: 9 }, "q2"],
      [{ status: "completed", quality: 4 }, "q1"],
      [{ status: "completed", quality: 3 }, "q0"],
      [{ status: "completed" }, "q2"],
      [{ status: "partial" }, "q0"],
      [{ status: "skipped" }, null],
      [{ status: "not_started" }, null],
    ];
    for (const [m, want] of cases) {
      const got = FY.mandalaTier(m);
      check(`mandalaTier(${JSON.stringify(m)})`, got === want, got);
    }
  });

  safe("easeOutCubic", () => {
    for (const [t, want] of [[0, 0], [1, 1], [0.5, 0.875], [-1, 0], [2, 1]]) {
      const got = FY.easeOutCubic(t);
      check(`easeOutCubic(${t})`, near(got, want), got);
    }
  });

  safe("targetGeometry", () => {
    const pts = FY.State.lastLandmarks?.[0];
    if (!pts) { check("targetGeometry: landmarks", false, "no mock landmarks — run on test.html"); return; }
    const w = 480, h = 640;
    const p = (i) => pts[i];
    const eyeDist = Math.hypot((p(263).x - p(33).x) * w, (p(263).y - p(33).y) * h);
    const vcx = ((p(61).x + p(291).x) / 2) * w;
    const vcy = ((p(13).y + p(14).y) / 2) * h;
    const eyeDistX = Math.abs(p(263).x - p(33).x);
    const noseX = p(1).x * w;
    const eyeDistPx = eyeDistX * w;
    const neutralLipY = (p(1).y + eyeDistX * 0.35) * h;

    const expect = (key, want) => {
      const [moveId, phase] = key.split(":");
      const got = FY.targetGeometry(pts, w, h, moveId, phase);
      if (want === null) { check(`targetGeometry(${key})`, got === null, JSON.stringify(got)); return; }
      const ok = got && ["cx", "cy", "rx", "ry"].every((k) => near(got[k], want[k]));
      check(`targetGeometry(${key})`, ok, JSON.stringify(got));
    };
    expect("vowel_a_u:a", { cx: vcx, cy: vcy, rx: eyeDist * 0.17, ry: eyeDist * 0.22 });
    expect("vowel_a_u:u", { cx: vcx, cy: vcy, rx: eyeDist * 0.09, ry: eyeDist * 0.11 });
    expect("vowel_e_u:u", { cx: vcx, cy: vcy, rx: eyeDist * 0.09, ry: eyeDist * 0.11 });
    expect("vowel_e_u:e", { cx: vcx, cy: vcy, rx: eyeDist * 0.26, ry: eyeDist * 0.08 });
    const lr = eyeDistPx * 0.045;
    expect("pucker_side_to_side:left",  { cx: noseX + eyeDistPx * 0.1, cy: neutralLipY, rx: lr, ry: lr });
    expect("pucker_side_to_side:right", { cx: noseX - eyeDistPx * 0.1, cy: neutralLipY, rx: lr, ry: lr });
    const cr = eyeDistPx * 0.038, ring = eyeDistPx * 0.095;
    expect("pucker_circles:up", {
      cx: noseX + Math.cos(-Math.PI / 2) * ring, cy: neutralLipY + Math.sin(-Math.PI / 2) * ring, rx: cr, ry: cr,
    });
    expect("pucker_circles:left", { cx: noseX + ring, cy: neutralLipY, rx: cr, ry: cr });
    expect("tongue_inner_cheek:left_up", null);
  });

  safe("stepGatedPhase without stage elements", () => {
    // test.html has no #phaseVisual; a snap must still advance the phase.
    startMove(2);
    const g = FY.State.phaseGate;
    let err = null;
    try { g.fill = 1.01; frame({}); } catch (e) { err = e.message; }
    check("snap on test.html does not throw", !err, err);
    check("snap advances to phase u", FY.State.active?.phase === "u", FY.State.active?.phase);
  });

  safe("BLOOM_MOVES", () => {
    check("BLOOM_MOVES has vowel_a_u", FY.BLOOM_MOVES.has("vowel_a_u"));
    check("BLOOM_MOVES size 1 (round 1)", FY.BLOOM_MOVES.size === 1, FY.BLOOM_MOVES.size);
  });

  const failed = rows.filter((r) => !r.pass).length;
  console.table(rows);
  return { passed: rows.length - failed, failed, failures: rows.filter((r) => !r.pass).map((r) => r.name) };
}
