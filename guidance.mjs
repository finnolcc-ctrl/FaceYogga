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
export const CALIBRATION_STEPS = ['neutral', 'a', 'u', 'e', 'left', 'right', 'up', 'down'];
export function mouthDiagram(key) {
  const pose = POSES[key] || POSES.neutral;
  const x = key === 'left' ? 64 : key === 'right' ? 96 : 80;
  const y = key === 'up' ? 101 : key === 'down' ? 125 : 113;
  let mouth = '<path d="M59 113 Q80 120 101 113 M62 113 Q80 108 98 113"/>';
  if (key === 'a') mouth = '<ellipse cx="80" cy="116" rx="16" ry="24" fill="#ffc0c0" fill-opacity=".45"/><path d="M111 100 v27 m-4-5 4 5 4-5" class="motion-arrow"/>';
  if (key === 'e' || key === 'smile') mouth = '<path d="M49 110 Q80 102 111 110 Q80 132 49 110Z" fill="#ffc0c0" fill-opacity=".45"/><path d="M46 113 H33 l5-4 m-5 4 5 4 M114 113 h13 l-5-4 m5 4-5 4" class="motion-arrow"/>';
  if (['u','left','right','up','down'].includes(key)) {
    mouth = `<ellipse cx="${x}" cy="${y}" rx="11" ry="14" fill="#ffc0c0" fill-opacity=".6"/><ellipse cx="${x}" cy="${y}" rx="5" ry="8"/>`;
    if (key === 'u') mouth += '<path d="M47 113 h17 l-5-4 m5 4-5 4 M113 113 H96 l5-4 m-5 4 5 4" class="motion-arrow"/>';
    if (key === 'left') mouth += '<path d="M98 140 H57 l6-5 m-6 5 6 5" class="motion-arrow"/>';
    if (key === 'right') mouth += '<path d="M62 140 h41 l-6-5 m6 5-6 5" class="motion-arrow"/>';
    if (key === 'up') mouth += '<path d="M109 129 v-27 l-5 6 m5-6 5 6" class="motion-arrow"/>';
    if (key === 'down') mouth += '<path d="M109 104 v30 l-5-6 m5 6 5-6" class="motion-arrow"/>';
  }
  if (key === 'cheek') mouth += '<path d="M47 94 Q34 106 47 124 M113 94 Q126 106 113 124" class="motion-arrow"/>';
  const brow = key === 'brow' ? 57 : 65;
  return `<svg class="mouth-diagram" viewBox="0 0 160 180" role="img" aria-label="${pose.label}"><rect x="2" y="2" width="156" height="176" rx="42" fill="#f5eddf"/><g fill="none" stroke="#754e40" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M39 70 C39 18 121 18 121 70 L119 112 C116 144 96 160 80 160 S44 144 41 112Z" stroke-opacity=".35"/><path d="M51 ${brow} q10-5 19 0 M90 ${brow} q10-5 19 0"/><path d="M53 77 q8 6 16 0 M91 77 q8 6 16 0 M80 79 l-4 15 q4 4 8 0"/>${mouth}</g></svg>`;
}
export function calibrationDiagram(key) {
  const start = ['left','right','up','down'].includes(key) ? 'u' : 'neutral';
  return `<div class="pose-pair"><figure>${mouthDiagram(start)}<figcaption>${start === 'u' ? 'Start with U' : 'Start relaxed'}</figcaption></figure><span class="pose-next" aria-hidden="true">→</span><figure>${mouthDiagram(key)}<figcaption>${POSES[key].label}</figcaption></figure></div>`;
}
export function guideKey(moveId, phase) {
  if (moveId.startsWith('vowel_') || moveId.startsWith('pucker_')) return phase;
  return null;
}
export function guideSequence(move) {
  const keys = [...new Set(move.phaseSchedule.map(p => guideKey(move.id, p.phase)).filter(Boolean))];
  return keys.map(key => `<figure>${mouthDiagram(key)}<figcaption>${POSES[key].label}</figcaption></figure>`).join('');
}
