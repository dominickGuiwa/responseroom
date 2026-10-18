// One-button situation generation. The server asks the CREAO Scenario Builder for a situation unlike anything in the
// current rotation, then turns the checked result into a complete situation (title, caller lines, hidden truth,
// keywords, units, map) and adds it to the rotation. Everything here is deterministic parsing and checks; the
// creative work is CREAO's. Generated situations are DEMO ONLY and can be removed from the rotation at any time.
import { mentions, mentionsAny } from './observations.mjs';

const STOP = new Set(['the', 'a', 'an', 'of', 'at', 'in', 'on', 'to', 'is', 'it', 'its', 'and', 'or', 'for', 'by', 'near', 'with', 'from', 'this', 'that', 'there', 'here', 'location', 'entrance', 'corrected', 'correction', 'initial', 'initially', 'caller', 'named', 'reported', 'report', 'fictional', 'incident', 'side', 'unit', 'floor', 'lane', 'lanes', 'lot', 'parking', 'door', 'gate', 'elevator', 'level', 'area', 'building', 'street', 'road', 'avenue', 'center', 'centre', 'community', 'room', 'place', 'spot', 'not', 'now', 'actually', 'sorry', 'wait', 'wrong', 'right', 'first', 'later', 'says', 'said', 'state', 'states', 'stated', 'version', 'value', 'detail']);
const lower = s => String(s ?? '').toLowerCase();
const words = s => lower(s).replace(/[’']/g, '').split(/[^a-z0-9]+/).filter(Boolean);
const content = s => words(s).filter(w => !STOP.has(w) && (w.length >= 3 || /\d/.test(w)));
const tidy = s => String(s ?? '').replace(/\s+/g, ' ').trim();
const sentenceCase = s => tidy(s).split(' ').map((w, i) => w.length > 1 && w === w.toUpperCase() ? w[0] + w.slice(1).toLowerCase() : i === 0 ? w[0].toUpperCase() + w.slice(1) : w).join(' ');
const afterColon = s => { const t = tidy(s); const i = t.indexOf(':'); return i >= 0 ? t.slice(i + 1).trim() : t };
const cut = s => tidy(s).split(/ of | at |,|\.|\(|;/)[0].replace(/^(the|a|an)\s+/i, '').trim();

// The one fact CREAO wrote in two versions: version 1 (superseded) is what the caller first said, the last version is the truth.
export function detailPair(facts) {
 const byId = {};
 for (const f of facts || []) if (f && f.fact_id) (byId[f.fact_id] ||= []).push(f);
 for (const list of Object.values(byId)) {
  if (list.length < 2) continue;
  const sorted = [...list].sort((a, b) => (a.version || 0) - (b.version || 0)), orig = sorted[0], corr = sorted.at(-1);
  if (!orig?.statement || !corr?.statement) continue;
  const ow = content(orig.statement), cw = content(corr.statement);
  const corrected = [...new Set(cw.filter(w => !ow.includes(w)))], original = [...new Set(ow.filter(w => !cw.includes(w)))];
  if (corrected.length && original.length) return { origStatement: orig.statement, corrStatement: corr.statement, corrected, original, factId: list[0].fact_id };
 }
 return null;
}

export function splitTitle(briefing) {
 const m = tidy(briefing).match(/^\[([^\]]{3,70})\]\s*(.*)$/s);
 return m ? { title: sentenceCase(m[1]), briefing: m[2].trim() || tidy(briefing) } : { title: null, briefing: tidy(briefing) };
}

function labelFrom(statement, keywords) {
 const label = cut(afterColon(statement));
 return label.length >= 2 && label.length <= 60 ? sentenceCase(label) : sentenceCase(keywords.join(' '));
}
function detailType(corrStatement) {
 const head = tidy(corrStatement).split(':')[0];
 const kept = words(head).filter(w => !['corrected', 'correction', 'initial', 'caller', 'named', 'location', 'the', 'of', 'now', 'actual', 'final'].includes(w));
 return kept.length ? kept.join(' ') : 'location detail';
}
function deriveLocation(facts, pair, form) {
 const other = (facts || []).find(f => f?.fact_id !== pair.factId && f?.statement);
 if (other) {
  let t = afterColon(other.statement);
  const at = t.lastIndexOf(' at '); if (at >= 0) t = t.slice(at + 4);
  t = t.replace(/^(the|a|an)\s+/i, '').split(/[.,;(]/)[0].trim();
  if (t.length >= 3 && t.length <= 80) return sentenceCase(t);
 }
 const m = tidy(form.initialMessage).match(/\bat (?:the )?([A-Z][^.,!?]{3,60})/);
 return m ? tidy(m[1]) : 'the reported location';
}
const placePhrase = label => /^(gate|unit|elevator|suite|car|bay|dock|pier|floor|\d)/i.test(label) ? label : 'the ' + label[0].toLowerCase() + label.slice(1);
const CARDINAL = { north: 'north', south: 'south', east: 'east', west: 'west' };
const DECOYS = { entrance: ['Side door', 'Service door'], door: ['Side door', 'Service door'], gate: ['Service gate', 'Delivery gate'], floor: ['Lobby', 'Roof access'], unit: ['Office', 'Laundry room'], lot: ['Overflow lot', 'Bus loop'], elevator: ['Freight elevator', 'Lobby'], dock: ['Fuel dock', 'Boat ramp'], default: ['Side entrance', 'Service entrance'] };
const STREETS = ['Cypress', 'Willow', 'Juniper', 'Granite', 'Beacon', 'Meadow', 'Heron', 'Quarry', 'Linden', 'Foxglove', 'Harrow', 'Kestrel', 'Marble', 'Tamarack', 'Osprey', 'Saddle'];
function seeded(seed) { let h = 2166136261; for (const c of String(seed)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) } return () => { h += 0x6D2B79F5; let t = Math.imul(h ^ (h >>> 15), 1 | h); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 } }

// Builds a full situation from CREAO's checked output. Throws with a plain reason when the output cannot be used.
export function buildGenerated({ raw, imported, run, rotation = [] }) {
 const pair = detailPair(raw?.instructor_only?.hidden_truth);
 if (!pair) throw Error('CREAO did not give a before-and-after location detail (one hidden fact with two versions)');
 const f = imported.form;
 const corrected = pair.corrected.filter(w => mentions(f.correctionMessage, w)).slice(0, 3);
 const original = pair.original.filter(w => mentions(f.initialMessage, w)).slice(0, 3);
 if (!corrected.length) throw Error('The caller’s correction does not say the corrected detail named in the hidden truth');
 if (!original.length) throw Error('The caller’s first report does not say the original detail named in the hidden truth');
 if (mentionsAny(f.initialMessage, corrected)) throw Error('The caller’s first report already contains the corrected detail');
 const { title: bracketTitle, briefing } = splitTitle(f.briefing);
 const location = deriveLocation(raw.instructor_only.hidden_truth, pair, f);
 const entrance = labelFrom(pair.corrStatement, corrected), originalLabel = labelFrom(pair.origStatement, original);
 const detail = detailType(pair.corrStatement);
 const title = bracketTitle || `Call at ${location}`;
 const rng = seeded(run);
 const used = new Set(rotation.flatMap(s => Object.values(s.units || {}).map(u => lower(u))));
 const pick = (prefix, max) => { for (let i = 0; i < 40; i++) { const n = 1 + Math.floor(rng() * max); if (!used.has(lower(`${prefix} ${n}`))) { used.add(lower(`${prefix} ${n}`)); return `${prefix} ${n}` } } return `${prefix} ${max + 1}` };
 const engine = pick('Engine', 30), medic = pick('Medic', 20);
 const km = (a, b) => Math.round((a + rng() * (b - a)) * 10) / 10;
 const kw = { corrected, original };
 const side = k => CARDINAL[k[0]] || null;
 let cSide = side(corrected) || 'north', oSide = side(original) || (cSide === 'south' ? 'east' : 'south');
 if (oSide === cSide) oSide = cSide === 'east' ? 'west' : 'east';
 const decoys = DECOYS[Object.keys(DECOYS).find(k => detail.includes(k))] || DECOYS.default;
 const freeSides = ['north', 'east', 'south', 'west'].filter(s => s !== cSide && s !== oSide);
 const names = [...STREETS].sort(() => rng() - 0.5);
 const correctionAt = Math.max(1000, (f.seconds || 30) * 1000);
 const extraCallerLines = (f.extraCallerLines || []).map(l => ({ at: l.seconds * 1000, text: tidy(l.text) })).filter(l => l.at > correctionAt && l.text).sort((a, b) => a.at - b.at);
 const lastAt = extraCallerLines.at(-1)?.at ?? correctionAt;
 const endAt = Math.min(3600000, Math.max((f.endSeconds || 180) * 1000, lastAt + 20000));
 const input = {
  title, objective: `Record and relay a corrected ${detail}.`, procedures: `None supplied. Generated by CREAO run ${run}; not a validated operational procedure. DEMO ONLY.`,
  briefing, initialMessage: tidy(f.initialMessage), correctionMessage: tidy(f.correctionMessage), correctionAt, extraCallerLines,
  replies: { Fire: `${engine} copies: “{message}”`, EMS: `${medic} copies: “{message}”`, Caller: 'Okay. You said: “{message}”' }, endAt, location, entrance,
 };
 const extras = {
  keywords: kw, units: { Fire: engine, EMS: medic }, detail,
  places: { corrected: placePhrase(entrance), original: placePhrase(originalLabel) },
  notes: { success: `Crews reached the caller at ${placePhrase(entrance)}.`, failure: `Crews went to ${placePhrase(originalLabel)} first, away from the caller.` },
  map: { streets: { north: `${names[0]} Street`, main: `${names[1]} Road`, south: `${names[2]} Street`, west: `${names[3]} Avenue`, center: `${names[4]} Avenue`, east: `${names[5]} Avenue` }, buildingLabel: location.length > 26 ? location.slice(0, 24).trim() + '…' : location,
   points: [{ id: 'corrected', label: placePhrase(entrance), short: entrance, side: cSide }, { id: 'original', label: placePhrase(originalLabel), short: originalLabel, side: oSide }, { id: 'decoy1', label: placePhrase(decoys[0]), short: decoys[0], side: freeSides[0] }, { id: 'decoy2', label: placePhrase(decoys[1]), short: decoys[1], side: freeSides[1] }],
   original: 'original', corrected: 'corrected', fire: { label: `Fire Station ${engine.split(' ')[1]}`, km: km(0.8, 3.5) }, ems: { label: `${medic} base (ambulance)`, km: km(1, 4) }, hospital: { label: 'General Hospital', km: km(1.5, 6) },
   place: [...new Set([lower(location), ...content(location).filter(w => w.length >= 4)])].slice(0, 6) },
 };
 return { input, extras, summary: { title, location, original: originalLabel, corrected: entrance } };
}

const overlap = (a, b) => { const A = new Set(content(a)), B = new Set(content(b)); const inter = [...A].filter(x => B.has(x)).length; return inter / Math.max(1, Math.min(A.size, B.size)) };
// A generated situation must differ from every situation in the rotation in place, title, correction pair and caller report.
export function tooSimilar(candidate, rotation) {
 const cLoc = content(candidate.input.location).filter(w => w.length >= 4), ck = candidate.extras.keywords;
 for (const s of rotation) {
  if (lower(s.title) === lower(candidate.input.title)) return `it has the same title as “${s.title}”`;
  const shared = content(s.truth?.location).filter(w => w.length >= 4 && cLoc.includes(w));
  if (shared.length) return `it uses the same place as “${s.title}” (${shared[0]})`;
  const sk = s.keywords || {}; const sc = [].concat(sk.corrected || []).map(lower), so = [].concat(sk.original || []).map(lower);
  if (sc.length && so.length && ck.corrected.some(k => sc.includes(k)) && ck.original.some(k => so.includes(k))) return `it has the same correction (${ck.original[0]} → ${ck.corrected[0]}) as “${s.title}”`;
  if (overlap(s.initialMessage, candidate.input.initialMessage) > 0.6) return `the caller’s report reads like “${s.title}”`;
 }
 return null;
}

// What we ask CREAO for. The rules go in the objective, the avoid-list in the seed, so each stays within the 2000-character limits.
export function generateInputs(rotation) {
 const avoid = rotation.slice(0, 14).map(s => `${s.title} (${s.truth?.location || 'unknown place'}; ${[].concat(s.keywords?.original || [])[0] || 'first detail'} → ${[].concat(s.keywords?.corrected || [])[0] || s.truth?.entrance || 'corrected detail'})`).join('; ');
 return {
  learning_objective: 'Practice recording and relaying ONE corrected location detail. The caller first names the wrong detail, then corrects it later in the call; the trainee must update the incident record and tell Fire and EMS. Format rules for this output: (1) Begin trainee_briefing.neutral_starting_context with a short title in square brackets, like [Smoke at a boathouse]. (2) The caller’s first message must plainly name the wrong detail and the later correction must plainly name the right one. (3) In instructor_only.hidden_truth give that detail as ONE fact with two versions: version 1 superseded with statement "Initial caller-named <detail>: the <wrong value> of <place>", version 2 active with statement "Corrected <detail>: the <right value> of <place>"; plus one separate fact "Fictional incident: <what is happening> at <place>". (4) Every place and name is fictional. No real procedures.',
  scenario_seed: `Create a brand-new situation that is clearly different from all of these existing ones: different incident type, different fictional place name, and a different kind of location detail that gets corrected. Existing: ${avoid || 'none yet'}.`.slice(0, 2000),
  difficulty: 'Standard', duration: 180,
 };
}
