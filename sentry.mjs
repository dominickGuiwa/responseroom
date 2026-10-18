// Minimal, dependency-free Sentry reporter (errors + performance transactions) using the envelope endpoint:
//   POST https://<host>/api/<project_id>/envelope/  with  X-Sentry-Auth: Sentry sentry_version=7, sentry_key=<public key>
// See develop.sentry.dev/sdk/foundations/envelopes/. Off unless SENTRY_DSN is set.
// Privacy: callers pass only operational data (route templates, error types, outcomes). Every string is scrubbed again here:
// IDs, keys and bearer tokens are redacted and lengths capped. Message text, record values, reviews and request bodies are never passed in.
import { randomBytes } from 'node:crypto';

const hex = n => randomBytes(n).toString('hex');
const now = () => Date.now() / 1000;
export function scrub(value, max = 500) {
 return String(value ?? '')
  .replace(/Bearer\s+\S+/gi, 'Bearer <redacted>')
  .replace(/\b(capi|cr_sk|sntrys|ghp|sk)[_-][A-Za-z0-9_-]{8,}/g, '<redacted-key>')
  .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<id>')
  .replace(/\b[0-9a-f]{24,}\b/gi, '<id>')
  .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '<email>')
  .slice(0, max);
}
// Turns a request path into a low-cardinality route name without identifiers.
export const routeTemplate = path => scrub(path, 200).replace(/<id>/g, ':id');

export function parseDsn(dsn) {
 try {
  const u = new URL(dsn);
  const projectId = u.pathname.replace(/^\/+|\/+$/g, '');
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  if (!u.username || !/^\d+$/.test(projectId)) return null;
  return { publicKey: u.username, endpoint: `${u.protocol}//${u.host}/api/${projectId}/envelope/` };
 } catch { return null }
}

const noopSpan = { startChild: () => noopSpan, setTag() {}, finish() {} };
export const noopSentry = { enabled: false, captureException() {}, captureMessage() {}, startTransaction: () => noopSpan, flush: async () => {} };

export function createSentry({ dsn, environment = 'local-demo', release, tracesSampleRate = 1, fetchImpl = fetch } = {}) {
 const parsed = dsn ? parseDsn(dsn) : null;
 if (!parsed) return noopSentry;
 const inflight = new Set();
 const base = () => ({ platform: 'node', environment: scrub(environment, 64), ...(release ? { release: scrub(release, 100) } : {}), sdk: { name: 'responseroom.minimal', version: '1.0.0' }, server_name: 'responseroom-local' });
 const cleanTags = tags => Object.fromEntries(Object.entries(tags || {}).slice(0, 20).map(([k, v]) => [scrub(k, 32), scrub(v, 200)]));
 function send(item) {
  const payload = JSON.stringify(item);
  const body = JSON.stringify({ event_id: item.event_id, sent_at: new Date().toISOString() }) + '\n' + JSON.stringify({ type: item.type || 'event', length: Buffer.byteLength(payload) }) + '\n' + payload + '\n';
  // Fire-and-forget: Sentry being slow or down never affects the exercise.
  const p = fetchImpl(parsed.endpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-sentry-envelope', 'X-Sentry-Auth': `Sentry sentry_version=7, sentry_key=${parsed.publicKey}, sentry_client=responseroom.minimal/1.0.0` }, body, signal: AbortSignal.timeout(5000) })
   .catch(() => {}).finally(() => inflight.delete(p));
  inflight.add(p);
 }
 const frames = stack => String(stack || '').split('\n').slice(1, 30).map(l => l.trim().match(/^at (?:(.*?) \()?(.*?):(\d+):(\d+)\)?$/)).filter(Boolean)
  .map(([, fn, file, line, col]) => ({ function: scrub(fn || '<anonymous>', 120), filename: scrub(file.replace(/^.*\/responseroom\//, ''), 200), lineno: +line, colno: +col, in_app: !/node:|node_modules/.test(file) })).reverse();
 return {
  enabled: true,
  captureException(error, { tags, level = 'error' } = {}) {
   send({ ...base(), event_id: hex(16), timestamp: now(), level, tags: cleanTags(tags),
    exception: { values: [{ type: scrub(error?.name || 'Error', 80), value: scrub(error?.message), stacktrace: { frames: frames(error?.stack) } }] } });
  },
  captureMessage(message, { tags, level = 'warning' } = {}) {
   send({ ...base(), event_id: hex(16), timestamp: now(), level, tags: cleanTags(tags), message: { formatted: scrub(message) } });
  },
  startTransaction(name, op) {
   const sampled = Math.random() < tracesSampleRate, traceId = hex(16), rootId = hex(8), start = now(), spans = [], tags = {};
   const makeSpan = (parentId, spanOp, description) => { const s = { span_id: hex(8), parent_span_id: parentId, trace_id: traceId, op: scrub(spanOp, 64), description: scrub(description, 200), start_timestamp: now() };
    return { startChild: (o, d) => makeSpan(s.span_id, o, d), setTag() {}, finish(status = 'ok') { s.timestamp = now(); s.status = status; spans.push(s) } } };
   return {
    startChild: (o, d) => makeSpan(rootId, o, d),
    setTag(k, v) { tags[k] = v },
    finish(status = 'ok') {
     if (!sampled) return;
     send({ ...base(), type: 'transaction', event_id: hex(16), transaction: scrub(name, 200), start_timestamp: start, timestamp: now(), tags: cleanTags(tags),
      contexts: { trace: { trace_id: traceId, span_id: rootId, op: scrub(op, 64), status } }, spans });
    },
   };
  },
  async flush() { await Promise.all([...inflight]) },
 };
}

export function sentryFromEnv(env = process.env, release) {
 const rate = Number(env.SENTRY_TRACES_SAMPLE_RATE ?? 1);
 return createSentry({ dsn: env.SENTRY_DSN?.trim(), environment: env.SENTRY_ENVIRONMENT?.trim() || 'local-demo', release, tracesSampleRate: Number.isFinite(rate) ? Math.min(1, Math.max(0, rate)) : 1 });
}
