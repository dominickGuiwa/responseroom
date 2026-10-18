// Fills the instructor dashboard with fictional past runs so every metric and graph has something to show.
// Five fictional trainees with different habits (fast dispatcher, forgets to relay to EMS, thin record, slow start,
// improving over time) across the built-in situations, spread over the last ten days. Reversible:
//   node scripts/seed-demo.mjs            add the runs (skips if they already exist)
//   node scripts/seed-demo.mjs --remove   delete exactly those runs again
//   node scripts/seed-demo.mjs --prune-qa also delete the developer's own QA runs (listed by name below)
// Everything written is fictional and tagged seed = SEED_TAG inside the session row; no real people or places.
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { Engine } from '../engine.mjs';
import { SITUATIONS } from '../situations.mjs';
import { applyDifficulty } from '../difficulty.mjs';

const SEED_TAG = 'seed-demo-2026-10';
const QA_NAMES = ['QA Trainee', 'Voice QA', 'Live Rehearsal', 'Caller Rehearsal', 'Demo Trainee'];
const dbPath = fileURLToPath(new URL('../responseroom.sqlite', import.meta.url));
const engine = new Engine(dbPath);
const db = engine.db;
const args = new Set(process.argv.slice(2));

const deleteSessions = ids => { for (const id of ids) { db.prepare('DELETE FROM events WHERE session=?').run(id); db.prepare('DELETE FROM requests WHERE session=?').run(id); db.prepare('DELETE FROM reviews WHERE session=?').run(id); db.prepare('DELETE FROM debriefs WHERE session=?').run(id); db.prepare('DELETE FROM sessions WHERE id=?').run(id) } };
if (args.has('--remove')) { const ids = db.prepare("SELECT id FROM sessions WHERE json_extract(data,'$.seed')=?").all(SEED_TAG).map(r => r.id); deleteSessions(ids); console.log(`removed ${ids.length} seeded runs`); process.exit(0) }
if (args.has('--prune-qa')) { const rows = db.prepare(`SELECT id, json_extract(data,'$.trainee') AS t FROM sessions WHERE json_extract(data,'$.trainee') IN (${QA_NAMES.map(() => '?').join(',')})`).all(...QA_NAMES); console.log('pruning QA runs:', rows.map(r => r.t).join(', ') || 'none'); deleteSessions(rows.map(r => r.id)) }
if (db.prepare("SELECT count(*) AS n FROM sessions WHERE json_extract(data,'$.seed')=?").get(SEED_TAG).n > 0) { console.log('seed already present; run with --remove first to regenerate'); process.exit(0) }

// Deterministic randomness so the demo data is the same on every machine.
const seeded = seed => { let h = 2166136261; for (const c of String(seed)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) } return () => { h += 0x6D2B79F5; let t = Math.imul(h ^ (h >>> 15), 1 | h); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 } };
const between = (rng, [a, b]) => Math.round(a + rng() * (b - a));
const chance = (rng, p) => rng() < p;

// Habits: seconds to first dispatch, chance the record gets the corrected detail, relay delays (null = usually forgets),
// chance EMS is dispatched at all. "improving" switches from the weak habits to the strong ones halfway through.
const TRAINEES = [
 { name: 'Maya Chen', calls: 5, first: [10, 26], record: 0.9, relayFire: [12, 32], relayEMS: [18, 40], sendEMS: 0.9 },
 { name: 'Jordan Alvarez', calls: 4, first: [12, 28], record: 0.75, relayFire: [15, 35], relayEMS: null, sendEMS: 1 },
 { name: 'Priya Natarajan', calls: 4, first: [14, 30], record: 0.2, relayFire: [14, 30], relayEMS: [16, 34], sendEMS: 0.8 },
 { name: 'Samuel Okafor', calls: 3, first: [48, 72], record: 0.7, relayFire: [25, 50], relayEMS: [30, 60], sendEMS: 0.7 },
 { name: 'Lena Fischer', calls: 5, improving: true },
];
const WEAK = { first: [30, 55], record: 0.3, relayFire: [40, 70], relayEMS: null, sendEMS: 0.6 };
const STRONG = { first: [10, 22], record: 0.95, relayFire: [10, 25], relayEMS: [12, 30], sendEMS: 1 };
const REVIEWS = [
 'Your first message to Fire was out in {first}: good. When the caller corrected the detail you updated Fire quickly, but EMS never heard it: say it to every unit you have sent, every time.',
 'Both units were sent to the corrected place: well done. The incident record still showed the first detail at the end of the call, so update the record the moment the caller changes something.',
 'Solid call. Keep the readbacks short and confirm the corrected detail in your own words before you send it on.',
];

const DAY = 86400000, now = Date.now();
let made = 0;
for (const [ti, t] of TRAINEES.entries()) {
 for (let ci = 0; ci < t.calls; ci++) {
  const rng = seeded(`${SEED_TAG}:${t.name}:${ci}`);
  const habits = t.improving ? (ci < Math.ceil(t.calls / 2) ? WEAK : STRONG) : t;
  const sit = SITUATIONS[(ti * 3 + ci * 2 + 1) % SITUATIONS.length];
  const picked = applyDifficulty(structuredClone(sit), rng);
  const s = engine.create(picked, { trainee: t.name });
  const truth = picked.truth, k = picked.keywords || { original: [], corrected: [] };
  const units = picked.units || { Fire: 'Engine 1', EMS: 'Medic 1' };
  const original = k.original?.[0] || 'the first spot', corrected = k.corrected?.[0] || truth.entrance;
  const msg = (at, to, text) => { const m = { id: randomUUID(), from: 'Dispatcher', to, text }; engine.event(s, 'message', m, 'seed-' + randomUUID(), at); engine.event(s, 'ack', { id: randomUUID(), from: to, to: 'Dispatcher', text: `${units[to]} copies: “${text}”`, messageId: m.id, contentVersion: m.id }, null, at + 2500); return at + 2500 };
  const record = (at, field, value) => { s.record[field] = value; engine.event(s, 'record', { field, value }, 'seed-' + randomUUID(), at) };
  let last = 0;
  const firstAt = between(rng, habits.first) * 1000;
  last = msg(firstAt, 'Fire', `${units.Fire}, respond to ${truth.location}. Caller says ${original}.`);
  const emsSent = chance(rng, habits.sendEMS);
  if (emsSent) last = msg(firstAt + between(rng, [6, 18]) * 1000, 'EMS', `${units.EMS}, stage at ${truth.location}, caller says ${original}. Possible injuries.`);
  record(firstAt + between(rng, [3, 9]) * 1000, 'location', truth.location);
  if (chance(rng, 0.8)) record(firstAt + between(rng, [10, 20]) * 1000, 'entrance', String(original));
  // The scripted caller: correction, then the extra updates the difficulty draw scheduled.
  const correctionAt = picked.correctionAt;
  engine.event(s, 'message', { id: randomUUID(), from: 'Caller', to: 'Dispatcher', text: picked.correctionMessage }, null, correctionAt);
  let callerSent = 1;
  const relayFire = habits.relayFire ? correctionAt + between(rng, habits.relayFire) * 1000 : null;
  if (relayFire) last = Math.max(last, msg(relayFire, 'Fire', `Change that: it is ${corrected}, not ${original}.`));
  const relayEMS = emsSent && (habits.relayEMS ? correctionAt + between(rng, habits.relayEMS) * 1000 : (chance(rng, 0.3) ? correctionAt + between(rng, [40, 80]) * 1000 : null));
  if (relayEMS) last = Math.max(last, msg(relayEMS, 'EMS', `Update: ${corrected}, not ${original}.`));
  if (chance(rng, habits.record)) record(correctionAt + between(rng, [8, 40]) * 1000, 'entrance', String(corrected));
  for (const line of picked.extraCallerLines || []) { if (line.at < (picked.endAt ?? Infinity)) { engine.event(s, 'message', { id: randomUUID(), from: 'Caller', to: 'Dispatcher', text: line.text }, null, line.at); callerSent++; last = Math.max(last, line.at) } }
  const limit = picked.endAt ?? null;
  let end = last + between(rng, [15, 45]) * 1000, reason = chance(rng, 0.25) ? 'next' : undefined;
  if (limit !== null && end >= limit) { end = limit; reason = 'time_limit' }
  engine.event(s, 'ended', { cancelledAcknowledgments: [], ...(reason ? { reason } : {}) }, null, end);
  const created = now - (9 - Math.min(9, Math.round((ci / Math.max(1, t.calls - 1)) * 8 + rng()))) * DAY - between(rng, [0, 9]) * 3600000 - ti * 1800000;
  Object.assign(s, { status: 'ended', elapsed: end, last: created + end, created, pending: [], corrected: true, callerSent, seed: SEED_TAG });
  engine.save(s);
  made++;
  // A few released reviews so the Feedback column is not empty.
  if ((ti + ci) % 3 === 0 && ci > 0) { const text = REVIEWS[(ti + ci) % REVIEWS.length].replace('{first}', Math.round(firstAt / 1000) + ' s'); engine.review(s.id, { text, reviewer: 'Instructor A', verified: true, release: true }) }
  else if ((ti + ci) % 5 === 2) engine.review(s.id, { text: 'Draft: check the relay timing on this one before releasing.', reviewer: 'Instructor A' });
 }
}
console.log(`seeded ${made} fictional runs for ${TRAINEES.length} trainees (tag ${SEED_TAG})`);
