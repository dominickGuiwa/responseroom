// Aerial street map for a run: a fictional district, the incident building with every entrance (or lanes, gates,
// units, elevators), the Fire station, the ambulance (Medic) base, a hospital and the dispatch center.
// Shared by the server (which sends a sanitized spec plus the live state to trainees) and the browser (which draws
// it, and lets instructors replay any moment from the full scenario). Plain functions, no DOM except mountMap().
//
// No-hints rule, built in: every entrance is drawn whether or not it matters; units go wherever the trainee LAST told
// them (corrected detail → that entrance, first-report detail → that one, nothing → the main approach); the caller's
// marker sits where the caller SAID they are and moves when the caller corrects it; the map focuses when the trainee
// saves a location that names the street or building. The actual location is drawn only in the instructor view.
export const W = 1000, H = 700;
const STOP = new Set(['the', 'a', 'an', 'entrance', 'door', 'side', 'unit', 'floor', 'lot', 'parking', 'lane', 'lanes', 'of', 'at', 'by', 'near', 'to', 'and', 'street', 'road', 'avenue', 'center']);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const lower = s => String(s ?? '').toLowerCase().trim();
const pattern = k => new RegExp(`(^|[^a-z0-9])${String(k).replace(/-/g, ' ').replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '[\\s-]+')}($|[^a-z0-9])`, 'i');
const mentionsAny = (text, keys) => (keys || []).some(k => k && pattern(k).test(String(text ?? '')));
const mmss = ms => `${String(Math.floor(ms / 60000)).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
function seeded(seed) { let h = 2166136261; for (const c of String(seed)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) } return () => { h += 0x6D2B79F5; let t = Math.imul(h ^ (h >>> 15), 1 | h); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 } }

// Streets are fixed; situations name them. Horizontal at y 150/400/620, vertical at x 170/500/830. Main street is y=400.
const GRID = { h: [150, 400, 620], v: [170, 500, 830] };
const DEFAULT_STREETS = { north: 'Elm Street', main: 'Main Street', south: 'Harbor Street', west: 'First Avenue', center: 'Center Avenue', east: 'Ninth Avenue' };

export function buildMap(scenario) {
 const m = scenario?.map || {};
 const kind = m.kind || 'town';
 const b = kind === 'road' ? null : { x: 530, y: 270, w: 160, h: 100, label: m.buildingLabel || scenario?.title || 'Incident', ...(m.building || {}) };
 const approach = kind === 'road' ? { id: 'approach', label: m.approachLabel || 'the shoulder at the marker', short: 'Shoulder', x: 610, y: 428 } : { id: 'approach', label: m.approachLabel || 'the main approach', short: 'Approach', x: 610, y: 400 };
 const kw = scenario?.keywords || {};
 const defs = m.points || [{ id: 'north', label: 'the north entrance', short: 'North entrance', side: 'north' }, { id: 'east', label: 'the east entrance', short: 'East entrance', side: 'east' }, { id: 'south', label: 'the south entrance', short: 'South entrance', side: 'south' }, { id: 'west', label: 'the west entrance', short: 'West entrance', side: 'west' }];
 const slots = side => defs.filter(q => q.slot != null && q.side === side).length;
 const points = defs.map(p => {
  let { x, y } = p;
  if (x == null && b) {
   if (p.slot != null) { const n = slots(p.side); if (p.side === 'north') { x = b.x + b.w * (p.slot + 1) / (n + 1); y = b.y - 12 } else { x = b.x + b.w * (p.slot + 1) / (n + 1); y = b.y + b.h + 14 } }
   else if (p.side === 'north') { x = b.x + b.w / 2; y = b.y - 12 } else if (p.side === 'south') { x = b.x + b.w / 2; y = b.y + b.h + 14 } else if (p.side === 'east') { x = b.x + b.w + 14; y = b.y + b.h / 2 } else { x = b.x - 14; y = b.y + b.h / 2 }
  }
  const keywords = p.id === m.corrected && kw.corrected ? [].concat(kw.corrected) : p.id === m.original && kw.original ? [].concat(kw.original) : p.keywords || lower(p.short || p.label).split(/[^a-z0-9]+/).filter(w => w && !STOP.has(w));
  return { id: p.id, label: p.label, short: p.short || p.label, side: p.side || null, x, y, lx: p.lx, ly: p.ly, anchor: p.anchor, keywords: keywords.map(lower) };
 });
 // Authored scenarios have no map params: the corrected point is whichever entrance the hidden entrance text names.
 const corrected = m.corrected || points.find(p => mentionsAny(scenario?.truth?.entrance, p.keywords))?.id || null;
 const travel = scenario?.difficulty?.travel || {};
 const stations = {
  Fire: { label: m.fire?.label || 'Fire Station 4', x: 80, y: 150, km: m.fire?.km ?? 1.3, seconds: travel.Fire ?? m.fire?.seconds ?? 60, route: [[170, 150], [500, 150], [500, 400], [610, 400]] },
  EMS: { label: m.ems?.label || 'Medic 2 base (ambulance)', x: 920, y: 620, km: m.ems?.km ?? 1.9, seconds: travel.EMS ?? m.ems?.seconds ?? 75, route: [[830, 620], [830, 400], [610, 400]] },
 };
 const units = scenario?.units || { Fire: 'Fire unit', EMS: 'Ambulance' };
 const place = [...(m.place || []), ...lower(scenario?.truth?.location).split(/[^a-z0-9]+/).filter(w => w.length >= 3 && !STOP.has(w))].map(lower);
 const rng = seeded(scenario?.version || 'default');
 const avoid = [b ? { x: b.x - 30, y: b.y - 40, w: b.w + 60, h: b.h + 80 } : { x: 520, y: 340, w: 180, h: 120 }];
 const decor = [];
 for (let tries = 0; tries < 260 && decor.length < 34; tries++) {
  const w = 28 + rng() * 50, h = 24 + rng() * 40, x = 14 + rng() * (W - w - 28), y = 14 + rng() * (H - h - 28);
  const r = { x, y, w, h };
  const nearRoad = GRID.h.some(yy => y < yy + 28 && y + h > yy - 28) || GRID.v.some(xx => x < xx + 24 && x + w > xx - 24);
  const nearEdge = [[80, 150], [920, 620], [920, 150], [80, 620]].some(([px, py]) => x < px + 60 && x + w > px - 60 && y < py + 60 && y + h > py - 60);
  if (nearRoad || nearEdge || avoid.some(a => x < a.x + a.w && x + w > a.x && y < a.y + a.h && y + h > a.y)) continue;
  decor.push({ x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) });
 }
 return { kind, streets: { ...DEFAULT_STREETS, ...(m.streets || {}) }, building: b, approach, points, corrected, original: m.original || null, stations, units,
  hospital: { label: m.hospital?.label || 'General Hospital', x: 920, y: 150, km: m.hospital?.km ?? 2.6 }, dispatch: { label: 'Dispatch center (you)', x: 80, y: 620 },
  place, focus: { x: 610, y: kind === 'road' ? 400 : 330, zoom: m.zoom || 2.3 }, decor, marker: m.marker || null };
}

// What trainees receive: geometry only. Which point is the actual one, and how messages are matched, stay on the server.
export function sanitizeSpec(spec) {
 const { corrected, original, place, points, ...rest } = spec;
 return { ...rest, points: points.map(({ keywords, ...p }) => p) };
}

const polyLen = pts => pts.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]), 0);
function alongPolyline(pts, frac) {
 const total = polyLen(pts); let left = Math.max(0, Math.min(1, frac)) * total;
 for (let i = 1; i < pts.length; i++) { const seg = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); if (left <= seg || i === pts.length - 1) { const f = seg ? Math.min(1, left / seg) : 1; return { x: pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f, y: pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f, index: i } } left -= seg }
 return { x: pts[0][0], y: pts[0][1], index: 1 };
}
const legTime = d => Math.max(6000, Math.round(d / 10) * 1000); // around the block: ~10 map units per second, at least 6s
const xy = p => ({ x: p.x, y: p.y });
const posOnLeg = (leg, t) => { const f = leg.t1 > leg.t0 ? Math.max(0, Math.min(1, (t - leg.t0) / (leg.t1 - leg.t0))) : 1; return { x: leg.from.x + (leg.to.x - leg.from.x) * f, y: leg.from.y + (leg.to.y - leg.from.y) * f } };

// Movement of one unit from its first dispatch: along the street route to the approach, then to whatever it was last
// told, re-routing from wherever it is whenever a later message names a different point.
function unitPlan(spec, key, toUnit, targetFor) {
 const st = spec.stations[key], A = xy(spec.approach);
 const route = [[st.x, st.y], ...st.route, [A.x, A.y]];
 if (!toUnit.length) return { route, dispatchAt: null, arriveApproach: null, changes: [], legs: [] };
 const dispatchAt = toUnit[0].time, arriveApproach = dispatchAt + st.seconds * 1000;
 const changes = []; let cur = null;
 for (const msg of toUnit) { const p = targetFor(msg.data.text); if (p && p !== cur) { cur = p; changes.push({ at: msg.time, point: p }) } }
 const targetAt = t => { let p = null; for (const c of changes) if (c.at <= t) p = c.point; return p };
 const first = targetAt(arriveApproach) || spec.approach;
 const legs = [{ from: A, to: xy(first), t0: arriveApproach, t1: arriveApproach + (first === spec.approach ? 0 : legTime(dist(A, first))), until: Infinity, point: first }];
 for (const c of changes.filter(c => c.at > arriveApproach)) {
  const last = legs.at(-1); if (last.point === c.point) continue;
  const pos = posOnLeg(last, c.at); last.until = c.at;
  legs.push({ from: pos, to: xy(c.point), t0: c.at, t1: c.at + legTime(dist(pos, c.point)), until: Infinity, point: c.point });
 }
 return { route, dispatchAt, arriveApproach, changes, legs, targetAt };
}
function unitAt(spec, key, plan, t) {
 const st = spec.stations[key], name = spec.units[key] || key;
 if (plan.dispatchAt == null || t < plan.dispatchAt) return { name, status: 'station', x: st.x, y: st.y, targetId: null, targetLabel: null, eta: null, remaining: [] };
 if (t < plan.arriveApproach) {
  const frac = (t - plan.dispatchAt) / (plan.arriveApproach - plan.dispatchAt), pos = alongPolyline(plan.route, frac);
  const target = plan.targetAt(t) || spec.approach, arrive = plan.arriveApproach + (target === spec.approach ? 0 : legTime(dist(xy(spec.approach), target)));
  return { name, status: 'enroute', x: pos.x, y: pos.y, targetId: target.id, targetLabel: target.label, eta: arrive - t, remaining: [[pos.x, pos.y], ...plan.route.slice(pos.index), ...(target === spec.approach ? [] : [[target.x, target.y]])] };
 }
 const leg = plan.legs.find(l => t < l.until) || plan.legs.at(-1), pos = posOnLeg(leg, t), arrived = t >= leg.t1;
 return { name, status: arrived ? 'onscene' : 'enroute', x: pos.x, y: pos.y, targetId: leg.point.id, targetLabel: leg.point.label, eta: arrived ? 0 : leg.t1 - t, remaining: arrived ? [] : [[pos.x, pos.y], [leg.to.x, leg.to.y]] };
}

export function mapState(spec, events, elapsed) {
 const byId = Object.fromEntries(spec.points.map(p => [p.id, p]));
 const targetFor = text => {
  const hits = spec.points.filter(p => mentionsAny(text, p.keywords));
  if (!hits.length) return null;
  if (spec.corrected && hits.some(p => p.id === spec.corrected)) return byId[spec.corrected];
  if (spec.original && hits.some(p => p.id === spec.original)) return byId[spec.original];
  const t = lower(text); return hits.map(p => ({ p, i: Math.max(...p.keywords.map(k => t.lastIndexOf(k))) })).sort((a, b) => b.i - a.i)[0].p;
 };
 const msgs = events.filter(e => e.kind === 'message');
 const notices = [];
 const focusLabel = spec.building?.label || spec.streets.main;
 notices.push({ at: 0, kind: 'centers', text: `Nearest centers: ${spec.stations.Fire.label}, ${spec.stations.Fire.km} km · ${spec.stations.EMS.label}, ${spec.stations.EMS.km} km · ${spec.hospital.label}, ${spec.hospital.km} km.` });
 let callerPoint = null;
 for (const msg of msgs.filter(e => e.data.from === 'Caller')) { const p = targetFor(msg.data.text); if (p && p !== callerPoint) { notices.push({ at: msg.time, kind: 'caller', text: `${callerPoint ? 'Caller now reports' : 'Caller reports'} ${p.label}.` }); if (msg.time <= elapsed) callerPoint = p } }
 const focusEvent = events.find(e => e.kind === 'record' && e.data.field === 'location' && spec.place.some(k => lower(e.data.value).includes(k)));
 const focusAt = focusEvent ? focusEvent.time : null;
 if (focusAt !== null) notices.push({ at: focusAt, kind: 'focus', text: `Map focused on ${focusLabel}.` });
 const units = {};
 for (const key of ['Fire', 'EMS']) {
  const plan = unitPlan(spec, key, msgs.filter(e => e.data.from === 'Dispatcher' && e.data.to === key), targetFor);
  units[key] = unitAt(spec, key, plan, elapsed);
  if (plan.dispatchAt == null) continue;
  const name = spec.units[key] || key, st = spec.stations[key];
  const planned = (target, at) => plan.arriveApproach + (target === spec.approach ? 0 : legTime(dist(xy(spec.approach), target))) - at;
  const first = plan.targetAt(plan.dispatchAt) || spec.approach;
  notices.push({ at: plan.dispatchAt, kind: 'dispatch', text: `${name} leaving ${st.label} for ${first.label} · ETA ${mmss(planned(first, plan.dispatchAt))}.` });
  for (const c of plan.changes.filter(c => c.at > plan.dispatchAt)) {
   const leg = plan.legs.find(l => l.t0 === c.at && l.point === c.point);
   const eta = c.at < plan.arriveApproach ? planned(c.point, c.at) : leg ? leg.t1 - c.at : null;
   if (eta !== null) notices.push({ at: c.at, kind: 'reroute', text: `${name} now heading to ${c.point.label} · ETA ${mmss(eta)}.` });
  }
  for (const leg of plan.legs) if (leg.until >= leg.t1) notices.push({ at: leg.t1, kind: 'arrival', text: `${name} arrived at ${leg.point.label}.` });
 }
 const shown = notices.filter(n => n.at <= elapsed).sort((a, b) => a.at - b.at || ['centers', 'caller', 'focus', 'dispatch', 'reroute', 'arrival'].indexOf(a.kind) - ['centers', 'caller', 'focus', 'dispatch', 'reroute', 'arrival'].indexOf(b.kind));
 const caller = callerPoint || spec.approach;
 return { elapsed, focused: focusAt !== null && focusAt <= elapsed, focusAt, focusLabel, caller: { x: caller.x, y: caller.y, pointId: callerPoint ? callerPoint.id : null, label: caller.label }, units, notices: shown };
}

// ---------- Rendering ----------
// Zoom is done with the viewBox (not a CSS transform), so a fresh render is correct everywhere and the live view can animate it.
const viewBoxFor = (spec, focused) => focused ? [spec.focus.x - W / spec.focus.zoom / 2, spec.focus.y - H / spec.focus.zoom / 2, W / spec.focus.zoom, H / spec.focus.zoom] : [0, 0, W, H];
const vbString = vb => vb.map(n => Number(n.toFixed(1))).join(' ');
function animateViewBox(svg, target) {
 const from = (svg.getAttribute('viewBox') || `0 0 ${W} ${H}`).split(/\s+/).map(Number);
 if (vbString(from) === vbString(target)) return;
 if (svg._vbAnim) cancelAnimationFrame(svg._vbAnim);
 const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
 if (reduce) { svg.setAttribute('viewBox', vbString(target)); return }
 const start = performance.now(), dur = 700, ease = t => 1 - Math.pow(1 - t, 3);
 const step = now => { const t = Math.min(1, (now - start) / dur), k = ease(t); svg.setAttribute('viewBox', vbString(from.map((v, i) => v + (target[i] - v) * k))); if (t < 1) svg._vbAnim = requestAnimationFrame(step); else svg._vbAnim = null };
 svg._vbAnim = requestAnimationFrame(step);
}
const labelPos = p => p.lx != null ? { dx: p.lx, dy: p.ly ?? 5, anchor: p.anchor || 'start' } : p.side === 'north' ? { dx: 0, dy: -14, anchor: 'middle' } : p.side === 'east' ? { dx: 14, dy: 5, anchor: 'start' } : p.side === 'west' ? { dx: -14, dy: 5, anchor: 'end' } : { dx: 0, dy: 24, anchor: 'middle' };
function base(spec, { instructor = false } = {}) {
 const s = spec.streets, roadW = y => y === 400 ? 34 : 24;
 const streets = GRID.h.map(y => `<line class="road" x1="0" x2="${W}" y1="${y}" y2="${y}" stroke-width="${roadW(y)}"/>`).join('') + GRID.v.map(x => `<line class="road" x1="${x}" x2="${x}" y1="0" y2="${H}" stroke-width="24"/>`).join('');
 const lanes = spec.kind === 'road' ? `<line class="lane-divider" x1="0" x2="${W}" y1="400" y2="400"/><text class="lane-label" x="700" y="393">westbound →</text><text class="lane-label" x="700" y="415">← eastbound</text>` : '';
 const names = `<text class="street-name" x="190" y="138">${esc(s.north)}</text><text class="street-name" x="190" y="${spec.kind === 'road' ? 372 : 386}">${esc(s.main)}</text><text class="street-name" x="190" y="608">${esc(s.south)}</text>` +
  [[170, s.west], [500, s.center], [830, s.east]].map(([x, n]) => `<text class="street-name" transform="rotate(-90 ${x - 16} 560)" x="${x - 16}" y="560">${esc(n)}</text>`).join('');
 const b = spec.building;
 const building = b ? `<rect class="incident" x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="4"/><text class="building-label" x="${b.x + b.w / 2}" y="${b.y + b.h / 2 + 6}" text-anchor="middle">${esc(b.label)}</text>` : `<rect class="mile-marker" x="602" y="358" width="16" height="12"/><text class="fine" x="624" y="368" text-anchor="start">${esc(spec.marker || 'Mile marker 14')}</text>`;
 const pois = spec.points.map(p => { const l = labelPos(p); return `<g class="poi"><circle cx="${p.x}" cy="${p.y}" r="6"/><text class="fine" x="${p.x + l.dx}" y="${p.y + l.dy}" text-anchor="${l.anchor}">${esc(p.short)}</text></g>` }).join('');
 const sq = (x, y, letter, label, cls, anchor = 'start', dx = 24) => `<g class="place ${cls}">${cls === 'dispatch' ? `<circle class="ring" cx="${x}" cy="${y}" r="26"/>` : ''}<rect x="${x - 16}" y="${y - 16}" width="32" height="32" rx="6"/><text class="place-letter" x="${x}" y="${y + 6}" text-anchor="middle">${letter}</text><text class="place-label" x="${x + dx}" y="${y + 6}" text-anchor="${anchor}">${esc(label)}</text></g>`;
 const st = spec.stations;
 const places = sq(st.Fire.x, st.Fire.y, 'F', st.Fire.label, 'fire', 'start', 26) + sq(st.EMS.x, st.EMS.y, 'E', st.EMS.label, 'ems', 'end', -26) + sq(spec.hospital.x, spec.hospital.y, 'H', spec.hospital.label, 'hospital', 'end', -26) + sq(spec.dispatch.x, spec.dispatch.y, 'D', spec.dispatch.label, 'dispatch', 'start', 26).replace('class="place dispatch"', 'class="place dispatch marker" data-node="You"');
 const truth = instructor && spec.corrected ? (p => `<g class="truth"><circle cx="${p.x}" cy="${p.y}" r="18"/><text class="fine truth-label" x="${p.x - 24}" y="${p.y - 32}" text-anchor="end">Actual: ${esc(p.short)}</text></g>`)(spec.points.find(p => p.id === spec.corrected)) : '';
 return `<rect class="ground" width="${W}" height="${H}"/>${spec.decor.map(d => `<rect class="lot" x="${d.x}" y="${d.y}" width="${d.w}" height="${d.h}" rx="3"/>`).join('')}${streets}${lanes}${names}${building}${pois}${places}${truth}<g class="routes"></g><g class="movers"></g>`;
}
const routesHtml = state => Object.values(state.units).filter(u => u.remaining.length > 1).map(u => `<polyline class="route" points="${u.remaining.map(p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')}"/>`).join('');
const etaText = u => u.status === 'station' ? '' : u.status === 'onscene' ? 'On scene' : `ETA ${mmss(u.eta)}`;
const moversHtml = state => `<g class="marker caller" data-node="Caller" style="transform:translate(${(state.caller.x - 14).toFixed(1)}px,${(state.caller.y - 16).toFixed(1)}px)"><g class="m"><circle class="ring" r="18"/><circle class="body" r="14"/><text class="letter" text-anchor="middle" dy="5">C</text><text class="tag" text-anchor="middle" y="-22">Caller</text></g></g>` +
 Object.entries(state.units).map(([key, u]) => `<g class="marker unit ${key.toLowerCase()} ${u.status}" data-node="${key}" style="transform:translate(${u.x.toFixed(1)}px,${u.y.toFixed(1)}px)"><g class="m"><circle class="ring" r="22"/><circle class="body" r="17"/><text class="letter" text-anchor="middle" dy="6">${key === 'Fire' ? 'F' : 'E'}</text><text class="tag" text-anchor="middle" y="34">${esc(u.name)}</text><text class="eta" text-anchor="middle" y="50">${etaText(u)}</text></g></g>`).join('');
// One popup at a time (the newest, for seven seconds); the full list sits under the map.
const toastsHtml = state => state.notices.filter(n => state.elapsed - n.at <= 7000).slice(-1).map(n => `<div class="toast"><time>${mmss(n.at)}</time>${esc(n.text)}</div>`).join('');
const updatesHtml = state => [...state.notices].reverse().map(n => `<li><time>${mmss(n.at)}</time><span>${esc(n.text)}</span></li>`).join('') || '<li class="muted">No updates yet.</li>';
const statusText = state => state.focused ? `Focused on ${state.focusLabel}.` : 'Showing the district. Save the incident location in your record to focus the map.';

export function renderMap(spec, state, opts = {}) {
 return `<div class="map-wrap"><svg class="street-map${state.focused ? ' focused' : ''}${opts.live ? ' live' : ''}" viewBox="${vbString(viewBoxFor(spec, state.focused))}" data-layout="street" ${opts.live ? 'data-live' : ''} role="img" aria-label="Aerial map of the district with the caller, ${esc(state.units.Fire.name)} and ${esc(state.units.EMS.name)}"><g class="world">${base(spec, opts).replace('<g class="routes"></g><g class="movers"></g>', `<g class="routes">${routesHtml(state)}</g><g class="movers">${moversHtml(state)}</g>`)}</g></svg><div class="map-toasts" aria-hidden="true">${opts.live ? toastsHtml(state) : ''}</div></div><p class="map-status">${esc(statusText(state))}</p><ol class="map-updates" aria-label="Map updates">${updatesHtml(state)}</ol>`;
}

// Live view: draw once per run, then patch positions so CSS transitions can animate the movement and the zoom.
export function mountMap(container, spec, state, id) {
 if (!container) return;
 if (container.dataset.mapId !== id || !container.querySelector('svg')) { container.dataset.mapId = id; container.innerHTML = renderMap(spec, state, { live: true }); return }
 const svg = container.querySelector('svg');
 svg.classList.toggle('focused', state.focused);
 animateViewBox(svg, viewBoxFor(spec, state.focused));
 svg.querySelector('.routes').innerHTML = routesHtml(state);
 const caller = svg.querySelector('.marker.caller'); caller.style.transform = `translate(${(state.caller.x - 14).toFixed(1)}px,${(state.caller.y - 16).toFixed(1)}px)`;
 for (const [key, u] of Object.entries(state.units)) { const g = svg.querySelector(`.marker.unit.${key.toLowerCase()}`); g.style.transform = `translate(${u.x.toFixed(1)}px,${u.y.toFixed(1)}px)`; g.classList.remove('station', 'enroute', 'onscene'); g.classList.add(u.status); g.querySelector('.eta').textContent = etaText(u) }
 const toasts = toastsHtml(state), t = container.querySelector('.map-toasts'); if (t.innerHTML !== toasts) t.innerHTML = toasts;
 const updates = updatesHtml(state), u = container.querySelector('.map-updates'); if (u.innerHTML !== updates) u.innerHTML = updates;
 container.querySelector('.map-status').textContent = statusText(state);
}
