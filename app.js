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

// -------- State --------
const State = {
  routine: null,
  mode: "guided",          // "guided" | "camera_assisted_candidate"
  cameraStream: null,
  landmarker: null,
  session: null,           // active session object
  timers: { phase: null, active: null, demo: null, ready: null, rest: null, setup: null },
  paused: false,
  wakeLock: null,
};

// -------- Boot --------
init().catch((e) => showDiag("init error: " + (e?.message || e)));

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
  document.getElementById("streakPill").textContent = streak > 0 ? `${streak} 天连续` : "开启第一天";
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
  document.getElementById("weekSummary").textContent = doneThisWeek > 0 ? `这周 ${doneThisWeek} 次` : "开始第一次";

  // Mini moves preview
  const list = document.getElementById("movesPreviewHome");
  list.innerHTML = "";
  State.routine.moves.forEach((m) => {
    const li = document.createElement("li");
    li.innerHTML = `<span class="idx">${m.order}</span><span>${m.title.zh}</span><span class="dur">${Math.round(m.activeMs/1000)}s</span>`;
    list.appendChild(li);
  });
}

function renderPreviewList() {
  const list = document.getElementById("movesListFull");
  list.innerHTML = "";
  State.routine.moves.forEach((m) => {
    const li = document.createElement("li");
    const mode = m.preferredMode === "camera_assisted_candidate" ? "可选摄像头" : "跟练";
    li.innerHTML = `
      <span class="idx">${m.order}</span>
      <span class="meta">
        <span class="ttl">${m.title.zh}</span>
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
    statusEl.textContent = "请求摄像头权限…";
    State.cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false,
    });
    videoEl.srcObject = State.cameraStream;
    await videoEl.play().catch(()=>{});

    statusEl.textContent = "加载识别模型…";
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
    statusEl.textContent = "摄像头无法打开，可切换为跟练模式。";
    showDiag("camera error: " + e.message);
  }
}

function runSetupLoop(videoEl, statusEl, ovalEl) {
  let stableStart = 0;
  let lastVidTime = -1;
  const tick = () => {
    State.timers.setup = requestAnimationFrame(tick);
    if (State.landmarker && videoEl.currentTime !== lastVidTime) {
      lastVidTime = videoEl.currentTime;
      try {
        const res = State.landmarker.detectForVideo(videoEl, performance.now());
        const hasFace = res.faceLandmarks?.length > 0;
        if (hasFace) {
          ovalEl.classList.add("ok");
          if (!stableStart) stableStart = performance.now();
          const held = performance.now() - stableStart;
          if (held < 2000) {
            statusEl.textContent = `保持住…${Math.ceil((2000 - held) / 1000)}s`;
          } else {
            statusEl.textContent = "好了，开始校准";
            cancelAnimationFrame(State.timers.setup);
            setTimeout(() => beginCalibration(), 500);
            return;
          }
        } else {
          ovalEl.classList.remove("ok");
          stableStart = 0;
          statusEl.textContent = "把脸放进圆圈";
        }
      } catch (e) {
        showDiag("detect error: " + e.message);
      }
    }
  };
  tick();
}

// Calibration: 4 timed steps with breath ring. For MVP we record a marker
// but do NOT drive detection off these samples.
function beginCalibration() {
  show("calibration");
  const steps = [
    { label: "1 / 4", cue: "保持自然放松的脸", sub: "2 秒 · 中立" },
    { label: "2 / 4", cue: "张开嘴做 A",        sub: "2 秒 · 不发声" },
    { label: "3 / 4", cue: "嘴唇收圆做 U",      sub: "2 秒 · 轻轻收圆" },
    { label: "4 / 4", cue: "嘴角展开做 E",      sub: "2 秒 · 不咬牙" },
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
      status: "not_started",      // not_started | completed | partial | skipped
      userConfirmed: null,
      attempts: 0,
    })),
  };

  requestWakeLock();
  show("exercise");

  // Camera visible as a soft mirror backdrop if camera mode
  const vid = document.getElementById("exerciseVideo");
  if (mode === "camera_assisted_candidate" && State.cameraStream) {
    vid.srcObject = State.cameraStream;
    vid.classList.add("show");
    vid.play().catch(()=>{});
  } else {
    vid.classList.remove("show");
  }

  nextMove();
}

function teardownExercise() {
  clearAllTimers();
  State.session = null;
  State.paused = false;
  document.getElementById("pauseOverlay").hidden = true;
  document.getElementById("selfcheck").hidden = true;
  document.getElementById("demoOverlay").hidden = true;
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
  setStageLabel("示范");
  document.getElementById("phaseCue").textContent = move.title.zh;
  document.getElementById("phaseSub").textContent = move.script.introZh;
  setPhaseVisual(demoVisualFor(move.id));
  renderRhythmDots(cycleCountFor(move), -1);

  State.timers.demo = setTimeout(() => runReady(move), demoMs);
}

function runReady(move) {
  const readyMs = State.routine.defaults.readyMs;
  setStageLabel("准备");
  let left = Math.ceil(readyMs / 1000);
  document.getElementById("phaseCue").textContent = `${left}`;
  document.getElementById("phaseSub").textContent = move.script.introZh;
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

// --- Active phase: schedule all phases across repeats ---
function runActive(move) {
  const sched = buildPhaseTimeline(move);
  const s = State.session;
  const moveState = s.moves[s.moveIndex];

  setStageLabel("跟着做");
  renderRhythmDots(cycleCountFor(move), 0);

  let i = 0;
  const activeStart = performance.now();
  let cycleOffset = 0;
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
    document.getElementById("phaseCue").textContent = p.cue.zh;
    document.getElementById("phaseSub").textContent = p.cue.en;
    setPhaseVisual(phaseVisualFor(move.id, p.phase));

    // Light up current cycle dot
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
  setStageLabel("完成了吗");
  setPhaseVisual("done");
  document.getElementById("phaseCue").textContent = move.script.outroZh;
  document.getElementById("phaseSub").textContent = "";
  document.getElementById("selfcheck").hidden = false;
}

function handleSelfResult(status) {
  const s = State.session;
  if (!s) return;
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
  setStageLabel("休息");
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
  document.getElementById("demoTitle").textContent = m.title.zh;
  document.getElementById("demoCue").textContent = m.script.introZh;
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

  const headline = completed === 7 ? "全部做完了<br>七组" :
                  completed > 0   ? `做完了<br>${completed} 组` :
                                    "下次再来<br>也可以";
  document.getElementById("reportHeadline").innerHTML = headline;
  document.getElementById("reportSub").textContent =
    session.partial ? "部分完成也算数" : "放松一下，呼吸几次";

  document.getElementById("streakNote").textContent =
    (data.streak || 0) >= 3 ? "节奏很稳" : "保持这个节奏就好";

  const list = document.getElementById("reportList");
  list.innerHTML = "";
  session.moves.forEach((m, i) => {
    const def = State.routine.moves[i];
    const chip = m.status === "completed" ? "completed" :
                 m.status === "partial"   ? "partial"   : "skipped";
    const label = m.status === "completed" ? "完成" :
                  m.status === "partial"   ? "部分" :
                  m.status === "skipped"   ? "跳过" : "未做";
    const li = document.createElement("li");
    li.innerHTML = `
      <span class="idx">${def.order}</span>
      <span class="meta"><span class="ttl">${def.title.zh}</span></span>
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
      return phase === "left" ? "shift-left" : "shift-right";
    case "pucker_circles":
      return `dot-${phase}`;
    case "vowel_a_u":
      return phase === "a" ? "letter-A vowel-a" : "letter-U vowel-u";
    case "vowel_e_u":
      return phase === "e" ? "letter-E vowel-e" : "letter-U vowel-u";
    case "tongue_inner_cheek":
      return phase.includes("left") ? "shift-left" : "shift-right";
    case "air_side_to_side":
      return phase === "left" ? "shift-left" : "shift-right";
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
  return d.toLocaleDateString("zh-CN", { month: "short", day: "numeric", weekday: "short" });
}
function formatTime(d) {
  return d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}
function showDiag(msg) {
  const el = document.getElementById("diag");
  if (!el) return;
  el.hidden = false;
  el.textContent = String(msg).slice(0, 160);
}

// Signal readiness for diagnostics
window.__appReady = true;
