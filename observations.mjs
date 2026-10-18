// Instructor-only observations from one run's event log. Deterministic keyword matching, shown to instructors as
// "automatic observations, please confirm" — never to trainees, and never a score or pass/fail.
const STOP = new Set(['the', 'a', 'an', 'entrance', 'door', 'side', 'unit', 'floor', 'lot', 'parking', 'lane', 'lanes', 'of', 'at', 'by', 'near', 'to']);
const lower = s => String(s ?? '').toLowerCase().trim();
const pattern = k => new RegExp(`(^|[^a-z0-9])${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')}($|[^a-z0-9])`, 'i');
export const mentions = (text, keyword) => !!keyword && pattern(keyword).test(String(text ?? ''));

// Built-in situations name their keywords; for authored or CREAO scenarios the corrected detail is derived from the
// hidden entrance text (e.g. "North entrance" -> "north"), and there is no "original" keyword to look for.
export function keywordsFor(scenario) {
 if (scenario?.keywords?.corrected) return { corrected: lower(scenario.keywords.corrected), original: scenario.keywords.original ? lower(scenario.keywords.original) : null };
 const words = lower(scenario?.truth?.entrance).split(/[^a-z0-9]+/).filter(w => w && !STOP.has(w));
 return { corrected: words.join(' ') || lower(scenario?.truth?.entrance) || null, original: null };
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
  if (recordCorrectedAt === null && mentions(Object.values(record).join(' '), k.corrected)) recordCorrectedAt = e.time;
 }
 const recordText = Object.values(record).join(' ');
 const unit = to => {
  const msgs = sent.filter(m => m.data.to === to);
  const told = msgs.find(m => mentions(m.data.text, k.corrected));
  return { sent: msgs.length, replies: replies.filter(r => r.data.from === to).length, firstAt: msgs[0]?.time ?? null, correctedAt: told?.time ?? null,
   originalAfterCorrection: correctionAt !== null && !!k.original && msgs.some(m => m.time >= correctionAt && mentions(m.data.text, k.original)) };
 };
 const end = events.findLast(e => e.kind === 'ended');
 const firstUnit = sent.find(m => m.data.to === 'Fire' || m.data.to === 'EMS');
 return {
  keywords: k, correctionAt, firstMessageAt: sent[0]?.time ?? null, firstUnitMessageAt: firstUnit?.time ?? null, messagesSent: sent.length,
  ...(includeRecord ? { record } : {}), recordUpdates, recordCorrectedAt,
  recordHasCorrected: mentions(recordText, k.corrected), recordHasOriginal: mentions(recordText, k.original),
  units: { Fire: unit('Fire'), EMS: unit('EMS'), Caller: unit('Caller') },
  ended: end ? { at: end.time, reason: end.data.reason || 'trainee' } : null,
 };
}
