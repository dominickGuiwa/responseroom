// Random difficulty and caller timing for each run. Chosen when a situation starts and pinned into that run's
// scenario copy, so the trainee sees one consistent call and the instructor's replay matches it exactly.
// Difficulty changes WHEN things happen (correction timing, extra caller updates, unit travel time, time limit),
// never WHAT the trainee is told: the authored caller lines keep their text, and filler updates carry no location detail.
export const LEVELS = Object.freeze({
 easy: { label: 'Easy', correction: [25, 40], gap: [15, 30], updates: [1, 1], endAt: 240, travel: { Fire: [70, 85], EMS: [85, 100] } },
 standard: { label: 'Standard', correction: [35, 70], gap: [12, 30], updates: [1, 2], endAt: 200, travel: { Fire: [55, 70], EMS: [65, 85] } },
 hard: { label: 'Hard', correction: [60, 110], gap: [10, 25], updates: [2, 3], endAt: 170, travel: { Fire: [40, 55], EMS: [48, 62] } },
});
// Neutral caller lines: pressure and texture, but no place, side, floor, gate or unit detail that a map or outcome could key on.
export const FILLERS = Object.freeze([
 'Are they on the way?', 'Please hurry, it’s getting worse.', 'I think I can hear sirens now.', 'Do you need anything else from me?',
 'There are a few other people here with me.', 'My phone is almost out of battery.', 'Should I stay on the line?', 'Sorry, it’s hard to hear you. Hold on.',
]);
const between = (rng, [a, b]) => a + Math.floor(rng() * (b - a + 1));
const shuffled = (list, rng) => { const a = [...list]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]] } return a };

export function pickLevel(rng = Math.random) { return ['easy', 'standard', 'standard', 'hard'][Math.floor(rng() * 4) % 4] }

export function applyDifficulty(scenario, rng = Math.random, level = pickLevel(rng)) {
 const L = LEVELS[level]; if (!L) throw Error('Unknown difficulty');
 const correctionAt = between(rng, L.correction) * 1000;
 // Authored scenarios without a time limit keep none; everything else gets the level's limit.
 const endAt = scenario.endAt == null ? null : L.endAt * 1000;
 const authored = (scenario.extraCallerLines || []).map(l => l.text);
 const texts = [...authored.slice(0, 1), ...shuffled(FILLERS.filter(f => !authored.includes(f)), rng)].slice(0, between(rng, L.updates));
 const latest = (endAt ?? 3600000) - 15000;
 const extraCallerLines = [];
 let t = correctionAt;
 for (const text of texts) { t += between(rng, L.gap) * 1000; if (t > latest) break; extraCallerLines.push({ at: t, text }) }
 const travel = { Fire: between(rng, L.travel.Fire), EMS: between(rng, L.travel.EMS) };
 return { ...scenario, correctionAt, extraCallerLines, endAt, difficulty: { level, label: L.label, travel } };
}
