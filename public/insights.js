// Progress insights for finished calls: goal rates, tasks, focus areas and small SVG charts.
// Pure functions returning HTML strings (no DOM access), shared by the trainee progress page and the instructor's
// trainee profile, and unit-tested in Node. Nothing here runs during a call: it only reads finished runs.
// Charts follow one rule set: a single navy hue, thin marks, solid hairline grid, a labelled goal line, a hover
// <title> on every mark, and a table elsewhere on the page carrying the same numbers.
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const seconds = ms => ms == null ? '—' : `${Math.round(ms / 1000)}s`;
const median = list => { const s = list.filter(v => v != null).sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : null };

// Runs that ended and have results, oldest first.
export const finished = runs => runs.filter(r => r?.performance && r?.outcome).sort((a, b) => (a.created ?? 0) - (b.created ?? 0));

export function goalRates(runs, goals) {
 const done = finished(runs);
 return goals.map(g => {
  const values = done.map(r => r.performance.goals[g.id]).filter(v => v === true || v === false);
  const met = values.filter(Boolean).length;
  return { ...g, n: values.length, met, rate: values.length ? Math.round(100 * met / values.length) : null };
 });
}

export function summarize(runs) {
 const done = finished(runs), judged = done.filter(r => r.outcome.result !== 'incomplete');
 const successes = judged.filter(r => r.outcome.result === 'success').length;
 return { calls: done.length, judged: judged.length, successes, successRate: judged.length ? Math.round(100 * successes / judged.length) : null,
  medianFirst: median(done.map(r => r.performance.metrics.firstDispatchMs)), medianRelay: median(done.map(r => r.performance.metrics.relayMs)) };
}

// Focus areas: goals below their aim, biggest gap first, with the evidence behind them. Strengths: goals at or above aim.
export function focusAreas(runs, goals) {
 const done = finished(runs);
 if (done.length < 2) return { focus: [], strengths: [], note: 'Finish a few more calls to see what to practice next.' };
 const s = summarize(done), rates = goalRates(done, goals), missed = { Fire: 0, EMS: 0 };
 for (const r of done) for (const u of r.performance.metrics.missedUnits || []) missed[u] = (missed[u] || 0) + 1;
 const worstUnit = ['Fire', 'EMS'].filter(u => missed[u] > 0).sort((a, b) => missed[b] - missed[a])[0];
 const unitNote = worstUnit ? ` ${worstUnit} missed the change in ${missed[worstUnit]} of your calls.` : '';
 const advice = {
  fastDispatch: r => `Send your first message to Fire or EMS sooner. You did it within 30 seconds in ${r.met} of ${r.n} calls${s.medianFirst != null ? `, and your typical time is ${seconds(s.medianFirst)}` : ''}.`,
  quickRelay: r => `When the caller changes a detail, pass it on right away. You got it to every unit within 45 seconds in ${r.met} of ${r.n} calls.${unitNote}`,
  accurateRecord: r => `Update your incident record when a detail changes. It was correct at the end of ${r.met} of ${r.n} calls.`,
  rightPlace: r => `Make sure every unit you send hears the change. Every unit ended up in the right place in ${r.met} of ${r.n} calls.${unitNote}`,
 };
 const focus = rates.filter(r => r.n > 0 && r.rate < r.aim).sort((a, b) => (b.aim - b.rate) - (a.aim - a.rate)).slice(0, 3)
  .map(r => ({ id: r.id, label: r.label, text: advice[r.id](r) }));
 const strengths = rates.filter(r => r.n >= 2 && r.rate >= r.aim).map(r => ({ id: r.id, label: r.label, text: `${r.met} of ${r.n} calls` }));
 return { focus, strengths, note: focus.length ? '' : 'Every goal is at or above its aim. Keep it up on new situations.' };
}

// Milestones a trainee can work toward. `have`/`need` drive a progress count.
export function tasks(runs) {
 const done = finished(runs), results = done.map(r => r.outcome.result);
 let streak = 0, best = 0;
 for (const x of results) { if (x === 'success') best = Math.max(best, ++streak); else if (x === 'failure') streak = 0 }
 const count = id => done.filter(r => r.performance.goals[id] === true).length;
 const distinct = new Set(done.map(r => r.version)).size, builtIn = new Set(done.filter(r => /^demo-/.test(r.version || '')).map(r => r.version)).size;
 return [
  { label: 'Finish your first call', have: done.length, need: 1 },
  { label: 'Get your first success', have: results.filter(x => x === 'success').length, need: 1 },
  { label: 'Three successes in a row', have: best, need: 3 },
  { label: 'Try 5 different situations', have: distinct, need: 5 },
  { label: 'Quick first dispatch in 5 calls', have: count('fastDispatch'), need: 5 },
  { label: 'Relay a change within 45 seconds in 5 calls', have: count('quickRelay'), need: 5 },
  { label: 'Complete all 8 built-in situations', have: builtIn, need: 8 },
 ].map(t => ({ ...t, have: Math.min(t.have, t.need), done: t.have >= t.need }));
}

export function outcomeBadge(result) {
 const [label, glyph] = { success: ['Success', '✓'], failure: ['Failure', '✕'], incomplete: ['No outcome', '–'] }[result] || ['Running', '…'];
 return `<span class="badge badge-${esc(result || 'live')}"><span aria-hidden="true">${glyph}</span> ${label}</span>`;
}

export function goalBars(rates) {
 return `<ul class="goal-bars">${rates.map(r => `<li><div class="gb-head"><span class="gb-label">${esc(r.label)}</span><span class="gb-value">${r.rate == null ? '—' : r.rate + '%'}${r.n ? ` <span class="muted">(${r.met} of ${r.n} calls)</span>` : ''}</span></div>
  <svg class="gb" viewBox="0 0 100 12" preserveAspectRatio="none" aria-hidden="true"><rect class="track" y="1" width="100" height="10" rx="5"/>${r.rate ? `<rect class="fill" y="1" width="${r.rate}" height="10" rx="5"/>` : ''}<line class="aim" x1="${r.aim}" x2="${r.aim}" y1="0" y2="12"/></svg>
  <p class="gb-aim">Aim: ${r.aim}% of calls. ${esc(r.target)}</p></li>`).join('')}</ul>`;
}

const niceStep = raw => [5, 10, 15, 20, 30, 60, 120, 300].find(s => s >= raw) || 600;
// Column chart of a time per call (seconds), with a labelled goal line. Points: [{value: ms|null, title}].
export function columnChart({ points, goalMs, label, emptyText = 'none' }) {
 const W = 420, H = 230, L = 52, R = 14, T = 26, B = 34, iw = W - L - R, ih = H - T - B, n = Math.max(points.length, 1);
 const values = points.map(p => p.value).filter(v => v != null);
 const maxS = Math.max(goalMs || 0, ...values, 1000) / 1000, step = niceStep(maxS / 4), top = Math.ceil(maxS * 1.1 / step) * step;
 const y = s => T + ih * (1 - s / top), slot = iw / n, bw = Math.min(24, slot * 0.6), base = y(0);
 let grid = '';
 for (let t = 0; t <= top + 1e-9; t += step) grid += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}"/><text class="tick" x="${L - 8}" y="${y(t) + 5}" text-anchor="end">${t}s</text>`;
 const every = Math.ceil(n / 12);
 const marks = points.map((p, i) => {
  const cx = L + slot * (i + 0.5), xl = i % every === 0 || i === n - 1 ? `<text class="tick" x="${cx}" y="${H - 8}" text-anchor="middle">${i + 1}</text>` : '';
  if (p.value == null) return `<g class="nobar"><text class="miss" x="${cx}" y="${base - 6}" text-anchor="middle">×</text><rect class="hit" x="${cx - slot / 2}" y="${T}" width="${slot}" height="${ih}"/><title>${esc(p.title)}: ${esc(emptyText)}</title></g>${xl}`;
  const top4 = y(p.value / 1000), x0 = cx - bw / 2, x1 = cx + bw / 2, r = Math.max(0, Math.min(4, base - top4));
  return `<g class="bar"><path d="M${x0},${base} V${top4 + r} Q${x0},${top4} ${x0 + r},${top4} H${x1 - r} Q${x1},${top4} ${x1},${top4 + r} V${base} Z"/><rect class="hit" x="${cx - slot / 2}" y="${T}" width="${slot}" height="${ih}"/><title>${esc(p.title)}: ${Math.round(p.value / 1000)} seconds</title></g>${xl}`;
 }).join('');
 const goal = goalMs ? `<line class="goal-line" x1="${L}" x2="${W - R}" y1="${y(goalMs / 1000)}" y2="${y(goalMs / 1000)}"/><text class="goal-label" x="${W - R}" y="${y(goalMs / 1000) - 8}" text-anchor="end">Goal ${goalMs / 1000}s</text>` : '';
 return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">${grid}<line class="axis" x1="${L}" x2="${W - R}" y1="${base}" y2="${base}"/>${marks}${goal}</svg>`;
}

// One mark per finished call, in order: filled = success, hollow with a cross = failure, small = no outcome.
export function outcomeStrip(runs, titleFor) {
 const done = finished(runs), W = 420, H = 68, n = Math.max(done.length, 1), gap = Math.min(44, (W - 32) / n);
 const marks = done.map((r, i) => {
  const cx = 16 + gap * (i + 0.5), cy = 26, t = `<title>${esc(titleFor(r, i))}</title>`;
  const res = r.outcome.result;
  const mark = res === 'success' ? `<circle class="o-success" cx="${cx}" cy="${cy}" r="10"/><path class="o-glyph" d="M${cx - 4.5},${cy} l3,3 l6,-6"/>`
   : res === 'failure' ? `<circle class="o-failure" cx="${cx}" cy="${cy}" r="9"/><path class="o-cross" d="M${cx - 4},${cy - 4} l8,8 M${cx + 4},${cy - 4} l-8,8"/>`
   : `<circle class="o-none" cx="${cx}" cy="${cy}" r="4"/>`;
  return `<g>${mark}<rect class="hit" x="${cx - gap / 2}" y="6" width="${gap}" height="40"/>${t}</g><text class="tick" x="${cx}" y="${H - 4}" text-anchor="middle">${n <= 16 || i % 2 === 0 ? i + 1 : ''}</text>`;
 }).join('');
 return `<svg class="chart strip" viewBox="0 0 ${W} ${H}" role="img" aria-label="Outcome of each call, oldest first">${marks}</svg><ul class="legend" aria-hidden="true"><li><svg viewBox="0 0 24 24"><circle class="o-success" cx="12" cy="12" r="9"/><path class="o-glyph" d="M7.5,12 l3,3 l6,-6"/></svg>Success</li><li><svg viewBox="0 0 24 24"><circle class="o-failure" cx="12" cy="12" r="8"/><path class="o-cross" d="M8,8 l8,8 M16,8 l-8,8"/></svg>Failure</li><li><svg viewBox="0 0 24 24"><circle class="o-none" cx="12" cy="12" r="4"/></svg>No outcome</li></ul>`;
}
