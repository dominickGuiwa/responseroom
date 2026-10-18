// Instructor observations and the after-call outcome for one run, computed from its event log.
// Deterministic keyword matching only. Observations are shown to instructors as "automatic, please confirm".
// The outcome is shown to the trainee only after a call has ended (never during it), with its rule spelled out.
const STOP = new Set(['the', 'a', 'an', 'entrance', 'door', 'side', 'unit', 'floor', 'lot', 'parking', 'lane', 'lanes', 'of', 'at', 'by', 'near', 'to']);
const lower = s => String(s ?? '').toLowerCase().trim();
const pattern = k => new RegExp(`(^|[^a-z0-9])${String(k).replace(/-/g, ' ').replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '[\\s-]+')}($|[^a-z0-9])`, 'i');
export const mentions = (text, keyword) => !!keyword && pattern(keyword).test(String(text ?? ''));
export const mentionsAny = (text, keywords) => (keywords || []).some(k => mentions(text, k));

// Built-in situations list their keywords (first one is shown); for authored or CREAO scenarios the corrected detail
// is derived from the hidden entrance text (e.g. "North entrance" -> "north"), and there is no "original" keyword.
export function keywordsFor(scenario) {
 const list = v => (Array.isArray(v) ? v : v ? [v] : []).map(lower).filter(Boolean);
 const given = scenario?.keywords;
 if (given && list(given.corrected).length) {
  const corrected = list(given.corrected), original = list(given.original);
  return { corrected: corrected[0], original: original[0] ?? null, correctedAll: corrected, originalAll: original };
 }
 const words = lower(scenario?.truth?.entrance).split(/[^a-z0-9]+/).filter(w => w && !STOP.has(w));
 const corrected = words.join(' ') || lower(scenario?.truth?.entrance) || null;
 return { corrected, original: null, correctedAll: corrected ? [corrected] : [], originalAll: [] };
}

export function observe(scenario, events, { includeRecord = true } = {}) {
 const k = keywordsFor(scenario);
 const callerLines = events.filter(e => e.kind === 'message' && e.data.from === 'Caller');
 const correctionAt = callerLines[1]?.time ?? null; // the first caller message after the opening report
 const sent = events.filter(e => e.kind === 'message' && e.data.from === 'Dispatcher');
 const replies = events.filter(e => e.kind === 'ack');
 const record = { location: '', entrance: '', caller: '', notes: '' };
 let recordUpdates = 0, recordCorrectedAt = null;
 for (const e of events) if (e.kind === 'record') {
  record[e.data.field] = e.data.value; recordUpdates++;
  if (recordCorrectedAt === null && mentionsAny(Object.values(record).join(' '), k.correctedAll)) recordCorrectedAt = e.time;
 }
 const recordText = Object.values(record).join(' ');
 const unit = to => {
  const msgs = sent.filter(m => m.data.to === to);
  const told = msgs.find(m => mentionsAny(m.data.text, k.correctedAll));
  return { sent: msgs.length, replies: replies.filter(r => r.data.from === to).length, firstAt: msgs[0]?.time ?? null, correctedAt: told?.time ?? null,
   originalAfterCorrection: correctionAt !== null && k.originalAll.length > 0 && msgs.some(m => m.time >= correctionAt && mentionsAny(m.data.text, k.originalAll) && !mentionsAny(m.data.text, k.correctedAll)) };
 };
 const end = events.findLast(e => e.kind === 'ended');
 const firstUnit = sent.find(m => m.data.to === 'Fire' || m.data.to === 'EMS');
 return {
  keywords: { corrected: k.corrected, original: k.original }, correctionAt, firstMessageAt: sent[0]?.time ?? null, firstUnitMessageAt: firstUnit?.time ?? null, messagesSent: sent.length,
  ...(includeRecord ? { record } : {}), recordUpdates, recordCorrectedAt,
  recordHasCorrected: mentionsAny(recordText, k.correctedAll), recordHasOriginal: mentionsAny(recordText, k.originalAll),
  units: { Fire: unit('Fire'), EMS: unit('EMS'), Caller: unit('Caller') },
  ended: end ? { at: end.time, reason: end.data.reason || 'trainee' } : null,
 };
}

export const OUTCOME_RULE = 'Success means every unit you sent ended up with the corrected detail, and your record shows it.';

// Outcome of a finished call. Each unit acts on the last thing it was told about the detail that changed:
// a unit whose most recent relevant message named the corrected detail goes to the right place; one last told only
// the original detail goes to the wrong place; one never told either is dispatched without it.
// Result: 'success' | 'failure' | 'incomplete' (the call ended before the caller's correction). Null while running.
export function outcome(scenario, events) {
 const end = events.findLast(e => e.kind === 'ended');
 if (!end) return null;
 const k = keywordsFor(scenario);
 if (!k.correctedAll.length) return null;
 const o = observe(scenario, events);
 const name = to => scenario?.units?.[to] || String(scenario?.replies?.[to] || '').match(/^(.{1,40}?)\s+copies\b/i)?.[1] || to;
 const detail = scenario?.detail || 'location detail';
 const truthDetail = scenario?.truth?.entrance || k.corrected;
 const wentRight = n => scenario?.places?.corrected ? `${n} went to ${scenario.places.corrected}.` : `${n} went to the right place (${truthDetail}).`;
 const wentWrong = n => scenario?.places?.original ? `${n} went to ${scenario.places.original}, the wrong place.` : `${n} went to the wrong place.`;
 const base = { rule: OUTCOME_RULE, correctedDetail: truthDetail };
 if (o.correctionAt === null) return { ...base, result: 'incomplete', headline: 'This call ended before the caller corrected the location, so there is no outcome for it.', lines: [], units: {} };
 const sent = events.filter(e => e.kind === 'message' && e.data.from === 'Dispatcher');
 const units = {};
 for (const to of ['Fire', 'EMS']) {
  const msgs = sent.filter(m => m.data.to === to);
  if (!msgs.length) { units[to] = { name: name(to), status: 'not_sent' }; continue }
  const relevant = msgs.filter(m => mentionsAny(m.data.text, k.correctedAll) || mentionsAny(m.data.text, k.originalAll));
  const last = relevant.at(-1);
  const status = !last ? 'unclear' : mentionsAny(last.data.text, k.correctedAll) ? 'right' : 'wrong';
  units[to] = { name: name(to), status, lastTold: last?.data.text ?? null };
 }
 const dispatched = Object.values(units).filter(u => u.status !== 'not_sent');
 const success = dispatched.length > 0 && dispatched.every(u => u.status === 'right') && o.recordHasCorrected;
 const lines = [];
 for (const u of Object.values(units)) {
  if (u.status === 'right') lines.push(wentRight(u.name));
  else if (u.status === 'wrong') lines.push(`${wentWrong(u.name)} The last thing they were told was “${u.lastTold}”.`);
  else if (u.status === 'unclear') lines.push(`${u.name} was sent but never told the ${detail}.`);
  else lines.push(`${u.name} was not sent.`);
 }
 lines.push(o.recordHasCorrected ? 'Your record shows the corrected detail.' : o.recordHasOriginal ? `Your record still says “${k.original}”.` : `Your record doesn’t include the ${detail}.`);
 const misdirected = dispatched.some(u => u.status === 'wrong' || u.status === 'unclear');
 const note = success ? scenario?.notes?.success : misdirected ? scenario?.notes?.failure : null;
 let headline;
 if (success) headline = 'Help went to the right place.';
 else if (!dispatched.length) headline = 'No units were sent.';
 else if (dispatched.some(u => u.status === 'wrong')) headline = 'Help went to the wrong place.';
 else if (dispatched.some(u => u.status === 'unclear')) headline = `A unit was never told the ${detail}.`;
 else headline = 'Help went to the right place, but your record doesn’t show the corrected detail.';
 return { ...base, result: success ? 'success' : 'failure', headline, lines, note: note || null, units };
}

// Goals trainees aim for, judged per finished call (never live). `aim` is the share of calls to reach.
export const GOALS = Object.freeze([
 { id: 'fastDispatch', label: 'Quick first dispatch', target: 'Message Fire or EMS within 30 seconds of the call starting.', aim: 80, limitMs: 30000 },
 { id: 'quickRelay', label: 'Relay changes fast', target: 'When the caller changes a detail, get it to every unit you sent within 45 seconds.', aim: 80, limitMs: 45000 },
 { id: 'accurateRecord', label: 'Accurate record', target: 'Your record shows the correct detail when the call ends.', aim: 90 },
 { id: 'rightPlace', label: 'Right place', target: 'Every unit you send ends up at the right place.', aim: 90 },
]);

// Per-call numbers behind the goals. Null goal = not applicable (e.g. the call ended before the caller's correction).
export function callMetrics(scenario, events) {
 const end = events.findLast(e => e.kind === 'ended');
 if (!end) return null;
 const k = keywordsFor(scenario), o = observe(scenario, events, { includeRecord: false }), out = outcome(scenario, events);
 const heard = o.correctionAt !== null;
 const sent = events.filter(e => e.kind === 'message' && e.data.from === 'Dispatcher');
 const unitsSent = ['Fire', 'EMS'].filter(u => o.units[u].sent > 0);
 let relayMs = null;
 if (heard && unitsSent.length) {
  const told = unitsSent.map(u => sent.find(m => m.data.to === u && m.time >= o.correctionAt && mentionsAny(m.data.text, k.correctedAll))?.time ?? null);
  if (told.every(t => t !== null)) relayMs = Math.max(...told) - o.correctionAt;
 }
 const judged = out && out.result !== 'incomplete';
 const unitStatus = judged ? Object.entries(out.units) : [];
 const metrics = {
  firstDispatchMs: o.firstUnitMessageAt, relayMs, correctionHeard: heard, unitsSent,
  recordCorrect: heard ? o.recordHasCorrected : null,
  rightPlace: judged ? unitsSent.length > 0 && unitStatus.every(([, u]) => u.status === 'right' || u.status === 'not_sent') : null,
  missedUnits: unitStatus.filter(([, u]) => u.status === 'wrong' || u.status === 'unclear').map(([name]) => name),
  outcome: out?.result ?? null,
 };
 const goals = {
  fastDispatch: metrics.firstDispatchMs !== null && metrics.firstDispatchMs <= 30000,
  quickRelay: heard ? relayMs !== null && relayMs <= 45000 : null,
  accurateRecord: metrics.recordCorrect,
  rightPlace: metrics.rightPlace,
 };
 return { metrics, goals };
}
