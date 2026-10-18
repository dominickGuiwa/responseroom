// CREAO adapter for the ResponseRoom Scenario Builder agent. Server-side only: the API key never leaves this process.
// Verified 2026-10-17 against docs.creao.ai/pro/api-trigger (app-scoped API Trigger, `capi_` keys):
//   POST {base}/api/v1/apps/{appId}/runs  body {inputs:{...}} -> {id, status:'pending', ...}
//   GET  {base}/api/v1/apps/{appId}/runs/{runId} -> status pending|running|completed|failed|cancelled; result.text, result.artifacts[]
//   Artifacts download via an authenticated GET that 302-redirects to temporary storage; the key must not follow the redirect.
// Agent inputs (from the agent's Advanced > Input Form): learning_objective*, reference_procedures, scenario_seed, difficulty, duration.
// Agent output: the agent's own contract "response-room-scenario/1.0.0", usually as a JSON file artifact.
export const CREAO_DEFAULT_APP = '94bd717e-a1a6-49bf-82d9-6a5d64c2c720';
const DIFFICULTIES = ['Introductory', 'Standard', 'Advanced'];

// The Debrief Coach is a second CREAO agent with its own app-scoped key. Optional; feedback drafting is off without it.
export function debriefConfig(env = process.env) {
 const appId = env.CREAO_DEBRIEF_APP_ID?.trim(), apiKey = env.CREAO_DEBRIEF_API_KEY?.trim();
 if (!appId || !apiKey) return null;
 return { apiKey, appId, base: (env.CREAO_BASE_URL?.trim() || 'https://agent.creao.ai').replace(/\/$/, '') };
}
// Debrief output: JSON {draft, citations} or plain prose; never shown to a trainee before a human edits and releases it.
export const acceptDebrief = text => {
 const t = String(text ?? '').trim();
 try { const v = JSON.parse(t); if (v && typeof v.draft === 'string' && v.draft.trim().length >= 20) return { draft: v.draft.trim().slice(0, 2000), citations: Array.isArray(v.citations) ? v.citations.map(Number).filter(Number.isInteger).slice(0, 40) : [] } } catch {}
 if (t.length >= 40 && !t.startsWith('{')) return { draft: t.slice(0, 2000), citations: [...t.matchAll(/#(\d{1,5})/g)].map(m => Number(m[1])).slice(0, 40) };
 return null;
};
const acceptScenario = text => { try { const v = JSON.parse(text); return v?.schema_version ? v : null } catch { return null } };
export function creaoConfig(env = process.env) {
 const apiKey = env.CREAO_API_KEY?.trim();
 if (!apiKey) return null;
 return { apiKey, appId: env.CREAO_APP_ID?.trim() || CREAO_DEFAULT_APP, base: (env.CREAO_BASE_URL?.trim() || 'https://agent.creao.ai').replace(/\/$/, '') };
}

// reference_procedures is never sent: this app has no validated procedures, so every generated draft stays DEMO ONLY.
export function validateRequest(input) {
 const text = (v, max, required) => { if (v === undefined || v === '') { if (required) throw Error('Learning objective is required'); return undefined } if (typeof v !== 'string' || !v.trim() || v.length > max) throw Error(`Text fields must be up to ${max} characters`); return v.trim() };
 const inputs = { learning_objective: text(input?.learning_objective, 2000, true) };
 const seed = text(input?.scenario_seed, 2000, false); if (seed) inputs.scenario_seed = seed;
 if (input?.difficulty) { if (!DIFFICULTIES.includes(input.difficulty)) throw Error('Unknown difficulty'); inputs.difficulty = input.difficulty }
 if (input?.duration !== undefined && input?.duration !== '') { const d = Number(input.duration); if (!Number.isInteger(d) || d < 60 || d > 3600) throw Error('Duration must be 60–3600 seconds'); inputs.duration = d }
 return inputs;
}

const authed = config => ({ Authorization: 'Bearer ' + config.apiKey });
const safeError = async (response) => {
 let detail = '';
 try { const text = await response.text(); try { const j = JSON.parse(text); detail = String(j?.error?.message ?? j?.error ?? j?.errorCode ?? text) } catch { detail = text } } catch {}
 return Error(`CREAO request failed (${response.status})${detail ? ': ' + detail.slice(0, 200) : ''}`);
};

export async function startRun(config, inputs, fetchImpl = fetch) {
 const response = await fetchImpl(`${config.base}/api/v1/apps/${config.appId}/runs`, { method: 'POST', headers: { ...authed(config), 'Content-Type': 'application/json' }, body: JSON.stringify({ inputs }) });
 if (!response.ok) throw await safeError(response);
 const runId = (await response.json())?.id;
 if (typeof runId !== 'string' || !/^[\w-]{1,100}$/.test(runId)) throw Error('CREAO did not return a run ID');
 return runId;
}

// Downloads one artifact. The key is sent only to the CREAO origin; the storage redirect is fetched without it.
async function downloadArtifact(config, url, fetchImpl) {
 const target = new URL(url, config.base);
 if (target.origin !== new URL(config.base).origin) throw Error('Artifact URL is not on the CREAO origin');
 const first = await fetchImpl(target.href, { headers: authed(config), redirect: 'manual' });
 if (first.status >= 300 && first.status < 400) {
  const location = first.headers.get('location');
  if (!location || new URL(location, target).protocol !== 'https:') throw Error('Artifact redirect is not https');
  const file = await fetchImpl(new URL(location, target).href, { redirect: 'follow' });
  if (!file.ok) throw Error(`Artifact download failed (${file.status})`);
  return await file.text();
 }
 if (!first.ok) throw await safeError(first);
 return await first.text();
}

// Returns {status:'pending'} | {status:'completed', output} | {status:'failed', error}.
export async function pollRun(config, runId, fetchImpl = fetch, accept = acceptScenario) {
 const response = await fetchImpl(`${config.base}/api/v1/apps/${config.appId}/runs/${runId}`, { headers: authed(config) });
 if (!response.ok) throw await safeError(response);
 const run = await response.json();
 const status = String(run?.status ?? '').toLowerCase();
 if (status === 'failed' || status === 'cancelled') return { status: 'failed', error: `Run ${status}${run?.errorCode ? ' (' + run.errorCode + ')' : ''}` };
 if (status !== 'completed') return { status: 'pending' };
 const inline = typeof run?.result?.text === 'string' ? accept(run.result.text.trim()) : null;
 if (inline) return { status: 'completed', output: inline };
 const artifacts = Array.isArray(run?.result?.artifacts) ? run.result.artifacts : [];
 const usable = artifacts.filter(a => typeof a?.url === 'string' && (/json|markdown|plain/i.test(a.type || '') || /\.(json|md|txt)$/i.test(a.id || a.title || '')));
 for (const artifact of usable.reverse()) { const parsed = accept(await downloadArtifact(config, artifact.url, fetchImpl)); if (parsed) return { status: 'completed', output: parsed } }
 return { status: 'failed', error: 'Run completed without a usable output' };
}

// Checks the agent's own contract and maps ONLY caller lines, timing and briefing into this app's authoring form.
// Hidden truth stays free text for the instructor to read; location/entrance are never guessed.
// Rejections: anything that self-approves, cites sources nobody supplied, or lets the exercise transmit for the trainee.
export function importScenario(raw) {
 const v = typeof raw === 'string' ? JSON.parse(raw) : raw;
 if (!v || typeof v !== 'object' || Array.isArray(v)) throw Error('Output must be a JSON object');
 if (v.schema_version !== 'response-room-scenario/1.0.0') throw Error('Unsupported schema_version: ' + String(v.schema_version).slice(0, 60));
 if (v.approval_status !== 'draft') throw Error('Agent output claims approval; only an instructor can approve');
 if (v.content_label !== 'DEMO ONLY') throw Error('Output must be labeled DEMO ONLY (no approved procedures were supplied)');
 if (Array.isArray(v.reference_sources) && v.reference_sources.length) throw Error('Output cites reference sources that were never supplied');
 const context = v.trainee_briefing?.neutral_starting_context;
 if (typeof context !== 'string' || !context.trim()) throw Error('Missing trainee_briefing.neutral_starting_context');
 const events = v.instructor_only?.event_script;
 if (!Array.isArray(events)) throw Error('Missing instructor_only.event_script');
 const lower = s => String(s ?? '').toLowerCase();
 const dispatcher = events.filter(e => lower(e?.sender) === 'dispatcher');
 const auto = dispatcher.filter(e => e.auto_send !== false || lower(e.initiated_by) !== 'trainee');
 if (auto.length) throw Error('Dispatcher events must be trainee-initiated with auto_send false: ' + auto.map(e => e.event_id).join(', '));
 // Live runs name the caller sender "scripted_caller" (earlier output used "caller") and prefix lines with a "Caller:" label.
 const caller = events.filter(e => ['caller', 'scripted_caller'].includes(lower(e?.sender)) && lower(e?.recipient) === 'dispatcher' && e?.trigger?.type === 'timed' && Number.isInteger(e.trigger.at_seconds) && typeof e.scripted_message === 'string' && e.scripted_message.trim())
  .sort((a, b) => a.trigger.at_seconds - b.trigger.at_seconds);
 if (caller.length < 2) throw Error('Need an initial and a later timed caller message');
 const [first, later] = caller;
 if (later.trigger.at_seconds < 1 || later.trigger.at_seconds > 3600) throw Error('Later caller message must be timed 1–3600 seconds');
 const warnings = [];
 const gated = dispatcher.filter(e => (e.preconditions || []).some(p => /TF-|record|manually_entered/i.test(String(p))));
 if (gated.length) warnings.push(`${gated.map(e => e.event_id).join(', ')}: transmission requires a record entry first. Not imported — in ResponseRoom, sending never depends on record contents.`);
 if (first.trigger.at_seconds !== 0) warnings.push(`Initial caller message was timed at ${first.trigger.at_seconds}s; ResponseRoom sends it at start.`);
 const extra = caller.slice(2, 12).filter(e => e.trigger.at_seconds > later.trigger.at_seconds);
 if (caller.length - 2 > extra.length) warnings.push(`${caller.length - 2 - extra.length} caller message(s) not imported (same time as an earlier line, or more than 10).`);
 // The agent guarantees a single timed end event (instructor_only.termination.guaranteed_end_event).
 const endEvent = events.find(e => e?.event_id && e.event_id === v.instructor_only.termination?.guaranteed_end_event && e.trigger?.type === 'timed' && Number.isInteger(e.trigger.at_seconds));
 const endSeconds = endEvent && endEvent.trigger.at_seconds > (extra.at(-1) ?? later).trigger.at_seconds && endEvent.trigger.at_seconds <= 3600 ? endEvent.trigger.at_seconds : null;
 warnings.push('Not imported: rubric, AI interpretations, participant replies and counterexamples. Authored Fire/EMS replies state facts the trainee may not have sent; use readback templates instead.');
 const hiddenTruth = (v.instructor_only.hidden_truth || []).filter(f => f?.status !== 'superseded').map(f => `${f.fact_id}@${f.version}: ${String(f.statement ?? '').slice(0, 500)}`);
 const text = s => String(s).slice(0, 4000);
 const spoken = s => text(String(s).replace(/^\s*caller\s*:\s*/i, ''));
 return {
  form: { title: text(`${v.scenario_id || 'CREAO scenario'} ${v.version || ''}`.trim()), briefing: text(context), initialMessage: spoken(first.scripted_message), correctionMessage: spoken(later.scripted_message), seconds: later.trigger.at_seconds, extraCallerLines: extra.map(e => ({ seconds: e.trigger.at_seconds, text: spoken(e.scripted_message) })), endSeconds },
  hiddenTruth, warnings, scenarioId: String(v.scenario_id || '').slice(0, 100), version: String(v.version || '').slice(0, 40),
 };
}
