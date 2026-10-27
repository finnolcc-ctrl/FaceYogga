// Pure geometry and calibrated matching, shared by the app and regression tests.
// All distances are measured in source pixels, then normalized by eye span.
export const clamp = (n, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, n));
export function measureFace(points, blends = {}, width = 640, height = 480) {
  if (!points || !width || !height) return null;
  const ids = [1, 13, 14, 61, 291, 33, 263];
  if (ids.some(i => !points[i] || !Number.isFinite(points[i].x) || !Number.isFinite(points[i].y))) return null;
  const p = i => ({ x: points[i].x * width, y: points[i].y * height });
  const left = p(33), right = p(263), nose = p(1);
  const span = Math.hypot(right.x - left.x, right.y - left.y);
  if (span < 10) return null;
  const ex = { x: (right.x - left.x) / span, y: (right.y - left.y) / span };
  const ey = { x: -ex.y, y: ex.x };
  const project = (a, b, axis) => ((a.x - b.x) * axis.x + (a.y - b.y) * axis.y) / span;
  const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const lip = mid(mid(p(61), p(291)), mid(p(13), p(14)));
  const eyeMid = mid(left, right);
  return {
    x: project(lip, nose, ex), y: project(lip, nose, ey),
    width: Math.abs(project(p(291), p(61), ex)),
    gap: Math.abs(project(p(14), p(13), ey)),
    jaw: blends.jawOpen || 0,
    pucker: Math.max(blends.mouthPucker || 0, blends.mouthFunnel || 0),
    smile: ((blends.mouthSmileLeft || 0) + (blends.mouthSmileRight || 0)) / 2,
    yaw: project(nose, eyeMid, ex), pitch: project(nose, eyeMid, ey),
    roll: Math.atan2(ex.y, ex.x),
  };
}
export function medianSample(samples) {
  if (!samples.length) return null;
  return Object.fromEntries(Object.keys(samples[0]).map(key => {
    const values = samples.map(s => s[key]).sort((a,b) => a-b);
    return [key, values[Math.floor(values.length / 2)]];
  }));
}
export function steadyHead(face, neutral) {
  return !!face && !!neutral && Math.abs(face.yaw-neutral.yaw) < .12
    && Math.abs(face.pitch-neutral.pitch) < .14 && Math.abs(face.roll-neutral.roll) < .30;
}
const reach = (value, target, floor) => clamp((value - Math.max(floor, target * .2)) / Math.max(floor, target * .8));
function roundScore(f, c) {
  const n = c.neutral, u = c.u;
  return Math.max(reach(f.pucker-n.pucker, Math.max(.06, (u.pucker-n.pucker)*.7), .018),
    reach(n.width-f.width, Math.max(.025, (n.width-u.width)*.7), .01));
}
export function calibrationIssue(key, f, samples) {
  if (!f) return 'Face not visible — look toward the camera.';
  const n = samples.neutral;
  if (key === 'neutral') return f.jaw > .25 || f.pucker > .3 || f.gap > .15
    ? 'Let your lips rest and relax your jaw.' : '';
  if (!steadyHead(f, n)) return 'Keep your head facing forward; move only your mouth.';
  if (key === 'a') return f.jaw-n.jaw > .055 || f.gap-n.gap > .035 ? '' : 'Let your jaw lower gently to make an A.';
  if (key === 'u') return f.pucker-n.pucker > .07 || n.width-f.width > .035 ? '' : 'Bring the corners inward and round your lips.';
  if (key === 'e') return f.smile-n.smile > .06 || f.width-n.width > .03 ? '' : 'Move both mouth corners gently outward.';
  const u = samples.u;
  if (!u || roundScore(f, samples) < .5) return 'Keep a small, rounded pucker as you move.';
  const axis = key === 'left' || key === 'right' ? 'x' : 'y';
  const sign = key === 'left' || key === 'down' ? 1 : -1;
  return (f[axis]-u[axis])*sign > (axis === 'x' ? .018 : .012)
    ? '' : `Slide your rounded lips ${key}; keep your head still.`;
}
export function samplesAreStable(samples) {
  if (samples.length < 8) return false;
  return ['x', 'y', 'gap', 'yaw', 'pitch'].every(key => {
    const values = samples.map(s => s[key]).sort((a,b) => a-b);
    return values[Math.floor(values.length*.9)] - values[Math.floor(values.length*.1)] < .045;
  });
}
export function canMatch(moveId, c) {
  const keys = moveId === 'pucker_side_to_side' ? ['neutral','u','left','right']
    : moveId === 'pucker_circles' ? ['neutral','u','left','up','right','down']
    : moveId === 'vowel_a_u' ? ['neutral','a','u']
    : moveId === 'vowel_e_u' ? ['neutral','e','u'] : [];
  return keys.length > 0 && keys.every(key => !!c?.[key]);
}
export function evaluatePose(moveId, phase, f, c) {
  const fail = hint => ({ precision: 0, hint });
  if (!f) return fail('Face not visible — return to the camera.');
  if (!canMatch(moveId, c)) return fail('Guided practice — calibration is incomplete.');
  if (!steadyHead(f, c.neutral)) return fail('Face forward and keep your head still.');
  const n = c.neutral;
  let score = 0, hint = '';
  if (moveId.startsWith('pucker_')) {
    const axis = phase === 'left' || phase === 'right' ? 'x' : 'y';
    const sign = phase === 'left' || phase === 'down' ? 1 : -1;
    const distance = (f[axis]-c.u[axis])*sign;
    const target = Math.max(axis === 'x' ? .014 : .01, (c[phase][axis]-c.u[axis])*sign*.7);
    const position = reach(distance, target, axis === 'x' ? .005 : .004);
    const rounded = roundScore(f, c);
    // Separate shape and direction; large valid movements never fall back to zero.
    score = Math.min(position, rounded);
    hint = rounded < .65 ? 'Keep the lips rounded, with the corners drawn inward.'
      : `Move your lips ${phase === "up" ? "upward" : phase === "down" ? "downward" : "to your " + phase}; keep your head still.`;
  } else if (phase === 'a') {
    score = Math.max(reach(f.jaw-n.jaw, Math.max(.055,(c.a.jaw-n.jaw)*.7), .02),
      reach(f.gap-n.gap, Math.max(.035,(c.a.gap-n.gap)*.7), .012));
    hint = 'Lower your jaw gently. Make a tall opening, without rounding forward.';
  } else if (phase === 'u') {
    score = roundScore(f, c);
    if (f.jaw > c.u.jaw+.18 || f.gap > c.u.gap+.09) score = 0;
    hint = f.jaw > c.u.jaw+.18 || f.gap > c.u.gap+.09
      ? 'Bring your jaw closer; keep a small, round opening.'
      : 'Draw the corners inward and bring your lips gently forward.';
  } else if (phase === 'e') {
    score = Math.max(reach(f.smile-n.smile, Math.max(.06,(c.e.smile-n.smile)*.7), .02),
      reach(f.width-n.width, Math.max(.03,(c.e.width-n.width)*.7), .01));
    if (f.jaw > c.e.jaw+.18) score = 0;
    hint = f.jaw > c.e.jaw+.18 ? 'Bring your jaw closer; widen the corners sideways.' : 'Widen both corners into a soft E. Keep your jaw relaxed.';
  }
  return { precision: score, hint: score >= .65 ? 'Shape found — hold gently.' : hint };
}
// A continuous hold is required; camera gaps and wrong poses cannot accumulate credit.
export function advanceHold(fill, score, elapsedMs, paused = false) {
  if (paused || elapsedMs > 250 || elapsedMs < 0 || score < .65) return 0;
  return clamp(fill + elapsedMs / 1000);
}
export function containTransform(sourceW, sourceH, viewW, viewH) {
  const scale = Math.min(viewW/sourceW, viewH/sourceH);
  return { scale, x: (viewW-sourceW*scale)/2, y: (viewH-sourceH*scale)/2 };
}
