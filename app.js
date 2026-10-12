// Face Yoga — Week 1
// Goal: prove MediaPipe Face Landmarker runs on a real phone and emits live blendshape scores.

import {
  FaceLandmarker,
  FilesetResolver,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/vision_bundle.mjs";

const MP_VERSION = "0.10.22";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

// Blendshapes we'll watch in week 1. These map to likely moves later.
const WATCH = [
  "mouthSmileLeft",
  "mouthSmileRight",
  "mouthPucker",
  "jawOpen",
  "browInnerUp",
  "browOuterUpLeft",
  "browOuterUpRight",
  "eyeBlinkLeft",
  "eyeBlinkRight",
];

const video = document.getElementById("video");
const intro = document.getElementById("intro");
const stage = document.getElementById("stage");
const startBtn = document.getElementById("start");
const errorEl = document.getElementById("error");
const statusEl = document.getElementById("status");
const fpsEl = document.getElementById("fps");
const scoresEl = document.getElementById("scores");

let faceLandmarker = null;
let wakeLock = null;
let running = false;
let lastVideoTime = -1;
let frameCount = 0;
let fpsWindowStart = 0;

function showError(msg) {
  errorEl.textContent = msg;
  errorEl.hidden = false;
}

function setStatus(msg) {
  statusEl.textContent = msg;
}

async function loadLandmarker() {
  setStatus("loading model…");
  const vision = await FilesetResolver.forVisionTasks(
    `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/wasm`
  );
  faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: MODEL_URL,
      delegate: "GPU",
    },
    runningMode: "VIDEO",
    numFaces: 1,
    outputFaceBlendshapes: true,
    outputFacialTransformationMatrixes: false,
  });
}

async function requestCamera() {
  setStatus("requesting camera…");
  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: "user",
      width: { ideal: 640 },
      height: { ideal: 480 },
    },
    audio: false,
  });
  video.srcObject = stream;
  await new Promise((resolve, reject) => {
    video.onloadedmetadata = () => {
      video.play().then(resolve).catch(reject);
    };
  });
}

async function requestWakeLock() {
  try {
    if ("wakeLock" in navigator) {
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLock.addEventListener("release", () => {
        wakeLock = null;
      });
    }
  } catch {
    // non-fatal — some iOS versions reject in certain contexts
  }
}

function buildScoreRows() {
  scoresEl.innerHTML = "";
  for (const name of WATCH) {
    const li = document.createElement("li");
    li.innerHTML = `<span class="name">${name}</span><div class="bar"><span></span></div><span class="val">0.00</span>`;
    scoresEl.appendChild(li);
  }
}

function updateScoreRows(categories) {
  const map = new Map();
  for (const c of categories) map.set(c.categoryName, c.score);
  const rows = scoresEl.children;
  for (let i = 0; i < WATCH.length; i++) {
    const v = map.get(WATCH[i]) ?? 0;
    const li = rows[i];
    li.querySelector(".val").textContent = v.toFixed(2);
    li.querySelector(".bar > span").style.width = `${Math.round(v * 100)}%`;
  }
}

function tick() {
  if (!running) return;
  requestAnimationFrame(tick);

  if (!faceLandmarker || video.readyState < 2) return;
  if (video.currentTime === lastVideoTime) return;
  lastVideoTime = video.currentTime;

  const now = performance.now();
  const result = faceLandmarker.detectForVideo(video, now);
  const bs = result.faceBlendshapes?.[0]?.categories;
  if (bs && bs.length) {
    updateScoreRows(bs);
    const points = result.faceLandmarks?.[0]?.length ?? 0;
    setStatus(`face · ${points} landmarks`);
  } else {
    setStatus("no face in view");
  }

  frameCount++;
  if (now - fpsWindowStart >= 500) {
    const fps = (frameCount * 1000) / (now - fpsWindowStart);
    fpsEl.textContent = `${fps.toFixed(0)} fps`;
    frameCount = 0;
    fpsWindowStart = now;
  }
}

async function start() {
  startBtn.disabled = true;
  errorEl.hidden = true;
  try {
    await loadLandmarker();
    await requestCamera();
    requestWakeLock();
    intro.hidden = true;
    stage.hidden = false;
    buildScoreRows();
    running = true;
    fpsWindowStart = performance.now();
    tick();
  } catch (e) {
    startBtn.disabled = false;
    const msg = e?.message || String(e);
    showError(msg);
    // Common hints for iOS Safari failures
    if (/https/i.test(msg) || location.protocol !== "https:") {
      showError(`${msg} — this page must be served over HTTPS for the camera to work on iOS.`);
    } else if (/NotAllowed/i.test(msg)) {
      showError("Camera permission denied. Re-enable it in Settings → Safari → Camera.");
    } else if (/NotFound/i.test(msg)) {
      showError("No front camera found on this device.");
    }
  }
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && !wakeLock && running) {
    requestWakeLock();
  }
});

startBtn.addEventListener("click", start, { once: false });

// Signal to the pre-flight diag block that the module loaded successfully.
window.__appReady = true;
document.getElementById("diag").textContent += " | app: loaded";
