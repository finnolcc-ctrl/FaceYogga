import { portraitSVG } from "./portrait.mjs";
// Shared, explicit mouth diagrams for calibration, live guidance and replay.
export const POSES = {
  neutral: { title: 'Rest naturally', detail: 'Look straight ahead. Let your lips rest and release your jaw.', label: 'Relaxed' },
  a: { title: 'A · open vertically', detail: 'Lower your jaw gently. Keep the corners soft and make a tall opening. No sound needed.', label: 'Tall opening' },
  u: { title: 'U · small and round', detail: 'Draw both corners inward. Bring your lips slightly forward, leaving a small round opening.', label: 'Small, round lips' },
  e: { title: 'E · widen sideways', detail: 'Move both corners outward into a gentle E. Keep a narrow opening and avoid clenching your teeth.', label: 'Wide, relaxed corners' },
  left: { title: 'Pucker to your left', detail: 'Make a small pucker, then slide only your lips to your left. Keep your nose facing forward.', label: 'Your left ←' },
  right: { title: 'Pucker to your right', detail: 'Keep your lips rounded and slide them to your right. Let your head stay still.', label: 'Your right →' },
  up: { title: 'Pucker upward', detail: 'Keep a small pucker and lift it toward your nose. Keep your chin still.', label: 'Lips upward ↑' },
  down: { title: 'Pucker downward', detail: 'Keep a small pucker and lower it gently. Do not lower your whole head.', label: 'Lips downward ↓' },
  smile: { title: 'A soft smile', detail: 'Gently lift both mouth corners with your lips together.', label: 'Corners outward' },
  brow: { title: 'Lift your brows', detail: 'Raise both eyebrows gently while keeping your head still.', label: 'Brows upward' },
  cheek: { title: 'Puff your cheeks', detail: 'Close your lips and gently fill both cheeks with air.', label: 'Cheeks outward' },
};
Object.assign(POSES, {
  air_left: { title:'Air to your left', label:'Left cheek', detail:'Close your lips and gently move the air into your left cheek.' },
  air_right: { title:'Air to your right', label:'Right cheek', detail:'Keep your lips closed and move the air into your right cheek.' },
  draw_in: { title:'Draw your cheeks inward', label:'Cheeks inward', detail:'Gently draw both cheeks in. Keep your jaw relaxed.' },
  hold: { title:'Hold gently', label:'Soft, steady hold', detail:'Keep your cheeks gently drawn in. Relax your forehead.' },
});
for (const side of ['left','right']) for (const level of ['up','down']) {
  POSES[`tongue_${side}_${level}`] = { title:`Tongue to your ${side}`, label:`Inside your ${side} cheek`, detail:`With lips closed, move your tongue along the ${level === 'up' ? 'upper' : 'lower'} inside of your ${side} cheek. The dot marks the contact area.` };
}
export const CALIBRATION_STEPS = ['neutral', 'a', 'u', 'e', 'left', 'right', 'up', 'down'];
export function mouthDiagram(key) {
  return portraitSVG(key, (POSES[key] || POSES.neutral).label);
}
export function calibrationDiagram(key) {
  const start = ['left','right','up','down'].includes(key) ? 'u' : 'neutral';
  return `<div class="pose-pair"><figure>${mouthDiagram(start)}<figcaption>${start === 'u' ? 'Start with U' : 'Start relaxed'}</figcaption></figure><span class="pose-next" aria-hidden="true">→</span><figure>${mouthDiagram(key)}<figcaption>${POSES[key].label}</figcaption></figure></div>`;
}
export function guideKey(moveId, phase) {
  if (moveId.startsWith('vowel_') || moveId.startsWith('pucker_')) return phase;
  if (moveId === 'air_side_to_side') return `air_${phase}`;
  if (moveId === 'tongue_inner_cheek') return `tongue_${phase}`;
  if (moveId === 'cheek_draw_in') return phase === 'release' ? 'neutral' : phase;
  return 'neutral';
}
export function guideSequence(move) {
  const keys = [...new Set(move.phaseSchedule.map(p => guideKey(move.id, p.phase)).filter(Boolean))];
  return keys.map(key => `<figure>${mouthDiagram(key)}<figcaption>${POSES[key].label}</figcaption></figure>`).join('');
}
