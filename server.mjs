import http from 'node:http';
import {readFileSync,existsSync,writeFileSync} from 'node:fs';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {Engine,scenario} from './engine.mjs';
import {creaoConfig,debriefConfig,callerConfig,acceptDebrief,acceptCallerReply,startRun,pollRun,validateRequest,importScenario} from './creao.mjs';
import {noopSentry,sentryFromEnv,routeTemplate} from './sentry.mjs';
import {SITUATIONS,pickSituation} from './situations.mjs';
import {observe,outcome,callMetrics,mentionsAny,GOALS} from './observations.mjs';
import {applyDifficulty} from './difficulty.mjs';
import {audioConfig,createAudio,inferDistress} from './audio.mjs';
import {demoLines} from './public/demo.js';
import {generateInputs,buildGenerated,tooSimilar,debriefInputs,callerInputs} from './generate.mjs';
import {execFileSync} from 'node:child_process';
export function createServer(engine,instructor,{creao=null,debrief=null,caller=null,audio=null,fetchImpl=fetch,sentry=noopSentry,generationPollMs=12000,callerPollMs=3000,pool={},log=null}={}){
// Opt-in stage log for the caller agent (RESPONSEROOM_DEBUG=1): run ids, timings and refusal reasons, never message text or keys.
const debug=log||(process.env.RESPONSEROOM_DEBUG?(...a)=>console.log(new Date().toISOString().slice(11,19),'[caller]',...a):()=>{});
const root=fileURLToPath(new URL('.',import.meta.url));
// ElevenLabs voice (optional): reads lines already in a call's log and transcribes push-to-talk clips. The key stays here.
const voice=audio?createAudio(audio,{fetchImpl,store:{get:k=>engine.audioGet(k),set:(k,v)=>engine.audioPut(k,v)}}):null;
// Caller agent (optional third CREAO agent). When the trainee talks to the caller, the scripted readback is held for a
// short while and a run is started with only what the caller knows. A reply that arrives in time, passes the guard and
// is still wanted replaces the readback; otherwise the readback goes out as before. Nothing here blocks the request.
// Refusals: coaching the trainee on dispatcher procedure, naming units (a hint about what to send), stage directions,
// or naming the corrected detail before the caller has said it. A plea like "please hurry" is distress, not coaching.
const COACHING=/\b(?:you (?:should|need to|must|have to|ought to)|make sure (?:you|to)|don['’]t forget to|remember to)\s+(?:send|dispatch|record|write|note|log|ask|tell|call|check|update|relay|contact|get)\b/i;
const UNITS=/\b(?:fire ?(?:department|dept|truck|engine|fighters?)|firemen|ambulance|paramedics?|medics?|ems|engine \d+|a truck|the trucks?)\b/i;
const callerGuard=(text,s)=>{const t=String(text||'');if(/https?:\/\//i.test(t)||/\bas an ai\b/i.test(t)||/[\[\]*]/.test(t))return 'off-character';if(COACHING.test(t))return 'coaching';if(UNITS.test(t))return 'names units';const k=s.scenario?.keywords;const specific=(k?.corrected||[]).filter((w,i)=>i===0||/^(north|south|east|west)\b/i.test(w));if(!s.corrected&&specific.length&&mentionsAny(t,specific))return 'names the correction early';return null};
const callerRuns=new Map(),asked=new Set();
// Only the message just sent is asked about, once: a replayed request or an older message whose reply was refused never starts another run.
function askCaller(s){if(!caller)return;const p=s.pending.filter(x=>x.to==='Caller'&&!x.reply).at(-1);if(!p||asked.has(p.id))return;asked.add(p.id);if(asked.size>5000)asked.delete(asked.values().next().value);callerRuns.set(p.id,{started:Date.now()});
 const tx=sentry.startTransaction('caller reply','ai.agent');const span=tx.startChild('ai.agent.run','CREAO Caller: start run');
 const t0=Date.now();debug('ask',p.id.slice(0,8));
 (async()=>{let run;try{run=await startRun(caller,callerInputs({session:s,events:engine.history(s.id),message:p}),fetchImpl);span.finish()}catch(e){span.finish('internal_error');sentry.captureException(e,{tags:{integration:'creao',stage:'caller-start'}});debug('start failed',e.message);callerRuns.delete(p.id);try{engine.replyFromAgent(s.id,p.id,null)}catch{}return tx.finish('internal_error')}
  debug('run',run,'started in',Date.now()-t0,'ms');callerRuns.set(p.id,{started:Date.now(),run});
  const t=setInterval(async()=>{const entry=callerRuns.get(p.id);if(!entry||Date.now()-entry.started>caller.holdMs){clearInterval(t);callerRuns.delete(p.id);tx.setTag('creao.caller','timeout');return tx.finish('deadline_exceeded')}
   let result;try{result=await pollRun(caller,run,fetchImpl,acceptCallerReply)}catch(e){sentry.captureException(e,{tags:{integration:'creao',stage:'caller-poll'}});debug('poll error',e.message);return}
   if(result.status==='pending')return;clearInterval(t);callerRuns.delete(p.id);
   if(result.status!=='completed'){tx.setTag('creao.caller','failed');sentry.captureMessage('CREAO caller run failed',{tags:{integration:'creao',reason:result.error}});debug('run failed',result.error);try{engine.replyFromAgent(s.id,p.id,null)}catch{}return tx.finish('internal_error')}
   const live=engine.get(s.id);const why=live?callerGuard(result.output.reply,live):'ended';
   if(why){tx.setTag('creao.caller','guarded');sentry.captureMessage('CREAO caller reply not used',{tags:{integration:'creao',reason:why}});debug('reply refused:',why,'after',Date.now()-t0,'ms');try{engine.replyFromAgent(s.id,p.id,null)}catch{}return tx.finish('ok')}
   try{const used=engine.replyFromAgent(s.id,p.id,result.output);tx.setTag('creao.caller',used?'replied':'late');debug(used?'replied':'late','distress',result.output.distress,'after',Date.now()-t0,'ms')}catch(e){sentry.captureException(e,{tags:{integration:'creao',stage:'caller-reply'}})}
   tx.finish('ok')},callerPollMs);t.unref?.()})()}
// Browser error forwarding is rate-limited so a broken page cannot flood Sentry.
let clientErrors={minute:0,count:0};
const same=(a,b)=>{const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y)};
const rotation=()=>[...SITUATIONS,...engine.scenarios().filter(x=>x.approved)];
// CREAO is the source of trainees' situations. A small pool of generated situations is kept topped up in the background;
// built-in situations are the fallback when no generated one is fresh for a trainee. Caps protect CREAO credits.
const POOL={target:3,minIntervalMs:90000,dailyCap:10,refusalStop:3,...pool};
const auto={lastStart:0,day:'',startsToday:0,refusals:0};
const generatedPool=()=>engine.scenarios().filter(x=>x.approved&&x.source?.kind==='creao');
const pendingAuto=()=>engine.generations().some(g=>g.status==='pending'&&g.mode==='auto');
const today=()=>{const d=new Date().toISOString().slice(0,10);if(auto.day!==d){auto.day=d;auto.startsToday=0}};
async function startAuto(tx=noopSentry.startTransaction()){
 if(!creao)throw Object.assign(Error('CREAO is not connected. Add CREAO_API_KEY to .env and restart the server.'),{status:503});
 const inputs=generateInputs(rotation());const span=tx.startChild('ai.agent.run','CREAO Scenario Builder: start run');let run;
 try{run=await startRun(creao,inputs,fetchImpl);span.finish()}catch(e){span.finish('internal_error');sentry.captureException(e,{tags:{integration:'creao',stage:'start'}});throw e}
 engine.startGeneration(run,inputs,'auto');scheduleGeneration(run);today();auto.lastStart=Date.now();auto.startsToday++;return run;
}
async function topUpPool(){
 if(!creao)return;today();
 if(pendingAuto()||generatedPool().length>=POOL.target||auto.refusals>=POOL.refusalStop||auto.startsToday>=POOL.dailyCap||Date.now()-auto.lastStart<POOL.minIntervalMs)return;
 try{await startAuto()}catch(e){sentry.captureException(e,{tags:{integration:'creao',stage:'auto-start'}})}
}
const poolStatus=()=>{today();return {ready:generatedPool().length,target:POOL.target,pending:pendingAuto(),startsToday:auto.startsToday,cap:POOL.dailyCap,paused:auto.refusals>=POOL.refusalStop?'paused after repeated refusals; press Generate to resume':auto.startsToday>=POOL.dailyCap?'daily limit reached':null}};
// Resolves one pending generation: polls CREAO once; a finished run is checked and either added to the rotation
// (one-button generation) or kept as an import for the authoring form (older manual flow).
async function resolveGeneration(row,tx=noopSentry.startTransaction()){
 const span=tx.startChild('ai.agent.poll','CREAO Scenario Builder: poll run');let result;
 try{result=await pollRun(creao,row.run,fetchImpl);span.finish()}catch(e){span.finish('internal_error');sentry.captureException(e,{tags:{integration:'creao',stage:'poll'}});throw e}
 tx.setTag('creao.run_status',result.status);
 if(result.status==='completed'){const check=tx.startChild('ai.validate','Validate scenario output');
  try{const imported=importScenario(result.output);
   if(row.mode==='auto'){const built=buildGenerated({raw:result.output,imported,run:row.run,rotation:rotation()});const reason=tooSimilar(built,rotation());
    if(reason){engine.failGeneration(row.run,'Not added: '+reason+'.');auto.refusals++;tx.setTag('creao.outcome','similar');sentry.captureMessage('CREAO situation too similar to the rotation',{tags:{integration:'creao',reason:reason.slice(0,150)}})}
    else{engine.addGenerated(row.run,built.input,built.extras);auto.refusals=0;tx.setTag('creao.outcome','added');setTimeout(()=>topUpPool().catch(()=>{}),0)}}
   else{engine.readyGeneration(row.run,imported);tx.setTag('creao.outcome','ready')}
   check.finish()}
  catch(e){check.finish('invalid_argument');engine.failGeneration(row.run,'Rejected: '+e.message);if(row.mode==='auto')auto.refusals++;tx.setTag('creao.outcome','rejected');sentry.captureMessage('CREAO output rejected by validator',{tags:{integration:'creao',reason:e.message.slice(0,150)}})}}
 else if(result.status==='failed'){engine.failGeneration(row.run,result.error);tx.setTag('creao.outcome','failed');sentry.captureMessage('CREAO run failed',{tags:{integration:'creao',reason:result.error}})}
}
// Background polling, so a generated situation lands in the rotation even if the instructor closes the page.
const timers=new Map();
function scheduleGeneration(run){if(!creao||timers.has(run))return;const started=Date.now();const t=setInterval(async()=>{const row=engine.generations().find(g=>g.run===run);if(!row||row.status!=='pending'||Date.now()-started>15*60*1000){clearInterval(t);timers.delete(run);return}try{await resolveGeneration(row)}catch{}},generationPollMs);t.unref?.();timers.set(run,t)}
if(creao)for(const g of engine.generations())if(g.status==='pending'&&g.mode==='auto')scheduleGeneration(g.run);
// Debrief drafts: the Debrief Coach writes, the instructor edits and releases. Same background polling pattern.
async function resolveDebrief(row,tx=noopSentry.startTransaction()){
 const span=tx.startChild('ai.agent.poll','CREAO Debrief Coach: poll run');let result;
 try{result=await pollRun(debrief,row.run,fetchImpl,acceptDebrief);span.finish()}catch(e){span.finish('internal_error');sentry.captureException(e,{tags:{integration:'creao',stage:'debrief-poll'}});throw e}
 if(result.status==='completed'){try{engine.completeDebrief(row.run,result.output);tx.setTag('creao.debrief','ready')}catch(e){engine.failDebrief(row.run,e.message);tx.setTag('creao.debrief','rejected')}}
 else if(result.status==='failed'){engine.failDebrief(row.run,result.error);sentry.captureMessage('CREAO debrief run failed',{tags:{integration:'creao',reason:result.error}})}
}
function scheduleDebrief(run){if(!debrief||timers.has('d:'+run))return;const started=Date.now();const t=setInterval(async()=>{const row=engine.pendingDebriefs().find(d=>d.run===run);if(!row||Date.now()-started>15*60*1000){clearInterval(t);timers.delete('d:'+run);return}try{await resolveDebrief(row)}catch{}},generationPollMs);t.unref?.();timers.set('d:'+run,t)}
if(debrief)for(const d of engine.pendingDebriefs())scheduleDebrief(d.run);
{const t=setTimeout(()=>topUpPool().catch(()=>{}),1500);t.unref?.()}
// A slow periodic check covers removals and refusals that happened while no runs were starting.
{const t=setInterval(()=>topUpPool().catch(()=>{}),Math.max(generationPollMs*5,10000));t.unref?.()}
const server=http.createServer(async(req,res)=>{res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Security-Policy',"default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'");
 const url=new URL(req.url,'http://localhost');const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data))};
 // One performance transaction per state-changing API call, named by route template (no IDs). Read-only GET polling (trainee clock, dashboard refresh) is not traced.
 const route=routeTemplate(url.pathname);const traced=url.pathname.startsWith('/api/')&&req.method!=='GET';
 const tx=traced?sentry.startTransaction(`${req.method} ${route}`,'http.server'):noopSentry.startTransaction();
 res.on('finish',()=>{tx.setTag('http.status_code',res.statusCode);tx.finish(res.statusCode>=500?'internal_error':res.statusCode>=400?'invalid_argument':'ok')});
 try{if(req.method==='POST'&&req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`)return send(403,{error:'Origin rejected'});
 if(!url.pathname.startsWith('/api/')){const file={'/':'index.html','/instructor':'index.html','/app.js':'app.js','/insights.js':'insights.js','/streetmap.js':'streetmap.js','/audio.js':'audio.js','/demo.js':'demo.js','/style.css':'style.css'}[url.pathname];if(!file)return send(404,{error:'Not found'});res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');return res.end(readFileSync(root+'public/'+file))}
 // Bodies are JSON, except a push-to-talk clip posted to …/speech, which is raw audio (a few hundred KB at most).
 let body={},clip=null;if(req.method==='POST'){const binary=url.pathname.endsWith('/speech')&&!/json/i.test(req.headers['content-type']||'');const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>(binary?3000000:20000))return send(413,{error:binary?'That clip is too long. Keep it under 45 seconds.':'Request too large'});chunks.push(chunk)}if(binary)clip=Buffer.concat(chunks);else{try{body=JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}')}catch{return send(400,{error:'Request body is not valid JSON'})}}}
 if(url.pathname==='/api/client-error'&&req.method==='POST'){const minute=Math.floor(Date.now()/60000);if(clientErrors.minute!==minute)clientErrors={minute,count:0};if(typeof body.message==='string'&&++clientErrors.count<=20)sentry.captureException({name:'BrowserError',message:body.message,stack:typeof body.stack==='string'?body.stack:''},{tags:{source:'browser',page:routeTemplate(String(body.path||''))}});res.writeHead(204);return res.end()}
 // Welcome-page demo voices: one of the fixed demo lines, no sign-in needed. The cache means each line costs credits once per server start.
 if(url.pathname==='/api/demo/audio'){if(req.method!=='GET')return send(405,{error:'Method not allowed'});if(!voice)return send(503,{error:'Voice is not connected.'});const line=demoLines()[Number(url.searchParams.get('i'))];if(!line)return send(404,{error:'No such line'});let out;try{out=await voice.synthesize({text:line.text,speaker:line.from,distress:line.distress})}catch(e){if(e.status===502)sentry.captureException(e,{tags:{integration:'elevenlabs',stage:'demo'}});throw e}res.writeHead(200,{'Content-Type':out.type,'Content-Length':out.bytes.length,'Cache-Control':'public, max-age=3600'});return res.end(out.bytes)}
 if(url.pathname==='/api/scenarios'){
  if(!same((req.headers.authorization||'').replace(/^Bearer /,''),instructor))return send(403,{error:'Instructor access required'});
  if(req.method==='POST'){
   if(body.action==='save'){if(body.creaoRun)engine.saveImportedScenario(String(body.creaoRun),body.scenario);else engine.saveScenario(body.scenario)}
   else if(body.action==='remove'){if(!engine.removeFromRotation(String(body.id)))return send(404,{error:'That situation is not in the rotation'});{const t=setTimeout(()=>topUpPool().catch(()=>{}),0);t.unref?.()}}
   else if(body.action==='approve')engine.approveScenario(body.id,body.name);
   else if(body.action==='launch'){const created=engine.launchScenario(body.id);return send(201,{...engine.public(created),token:created.token})}
   else return send(400,{error:'Unknown scenario action'});
  }else if(req.method!=='GET')return send(405,{error:'Method not allowed'});
  return send(200,engine.scenarios());
 }
 // CREAO generation is instructor-only; the API key stays in this process and is never echoed.
 if(url.pathname==='/api/creao'){
  if(!same((req.headers.authorization||'').replace(/^Bearer /,''),instructor))return send(403,{error:'Instructor access required'});
  if(req.method==='POST'){
   if(!creao)return send(503,{error:'CREAO is not connected. Add CREAO_API_KEY to .env and restart the server.'});
   if(body.action==='generate'){auto.refusals=0;await startAuto(tx)}
   else if(body.action==='start'){const inputs=validateRequest(body.inputs);const span=tx.startChild('ai.agent.run','CREAO Scenario Builder: start run');try{engine.startGeneration(await startRun(creao,inputs,fetchImpl),inputs);span.finish()}catch(e){span.finish('internal_error');sentry.captureException(e,{tags:{integration:'creao',stage:'start'}});throw e}}
   else if(body.action==='poll'||body.action==='recheck'){if(body.action==='recheck'&&!engine.reopenGeneration(String(body.run)))return send(409,{error:'Only rejected runs can be rechecked'});const row=engine.generations().find(g=>g.run===body.run);if(!row)return send(404,{error:'Unknown generation'});if(row.status==='pending')await resolveGeneration(row,tx)}
   else return send(400,{error:'Unknown CREAO action'});
  }else if(req.method!=='GET')return send(405,{error:'Method not allowed'});
  return send(200,{connected:!!creao,debriefConnected:!!debrief,callerConnected:!!caller,services:{scenario:!!creao,debrief:!!debrief,caller:!!caller,voice:voice?{provider:'ElevenLabs',...voice.usage}:null},pool:poolStatus(),generations:engine.generations(),scenarios:engine.scenarios()});
 }
 if(url.pathname==='/api/info')return send(200,{title:scenario.title,briefing:scenario.briefing,version:scenario.version,goals:GOALS,creao:creao?'Key configured':'Not connected',debrief:debrief?'Key configured':'Not connected',sentry:sentry.enabled?'Connected':'Not connected',audio:{connected:!!voice,provider:voice?'ElevenLabs':null},caller:{connected:!!caller}});
 if(url.pathname==='/api/sessions'&&req.method==='GET'){if(!same((req.headers.authorization||'').replace(/^Bearer /,''),instructor))return send(403,{error:'Instructor access required'});return send(200,engine.sessionsSummary())}
 // Each new run gets a different situation. CREAO-written and instructor-approved situations come first; built-ins only when none of those is fresh for this trainee.
 if(url.pathname==='/api/sessions'&&req.method==='POST'){const name=typeof body.name==='string'?body.name.trim():'';if(name.length>60)return send(400,{error:'Please use a name of 60 characters or fewer.'});
  const recent=new Set((Array.isArray(body.avoid)?body.avoid:[]).slice(-20).map(String)),fresh=list=>list.filter(x=>!recent.has(x.version));
  const approved=engine.scenarios().filter(x=>x.approved),primary=[...approved.filter(x=>x.source?.kind==='creao'),...approved.filter(x=>x.source?.kind!=='creao')];
  const chosen=fresh(primary).length?pickSituation(fresh(primary)):fresh(SITUATIONS).length?pickSituation(fresh(SITUATIONS)):pickSituation([...primary,...SITUATIONS],[...recent]);
  // Difficulty and caller timing are drawn now and pinned to this run.
  const picked=applyDifficulty(structuredClone(chosen));const s=engine.create(picked,{trainee:name||null});{const t=setTimeout(()=>topUpPool().catch(()=>{}),0);t.unref?.()}return send(201,{...engine.public(s),token:s.token})}
 // Instructor view of the rotation: what trainees can be given, with hidden truth for reference.
 if(url.pathname==='/api/situations'){if(!same((req.headers.authorization||'').replace(/^Bearer /,''),instructor))return send(403,{error:'Instructor access required'});return send(200,[...SITUATIONS,...engine.scenarios().filter(x=>x.approved)].map(x=>({id:x.id||null,version:x.version,title:x.title,builtIn:!!x.builtIn,generated:x.source?.kind==='creao',truth:x.truth,initialMessage:x.initialMessage,correctionMessage:x.correctionMessage,correctionAt:x.correctionAt,endAt:x.endAt??null})))}
 const match=url.pathname.match(/^\/api\/sessions\/([\w-]+)(?:\/(\w+))?$/);if(!match)return send(404,{error:'Not found'});let s=engine.get(match[1]);if(!s)return send(404,{error:'Not found'});
 const secret=(req.headers.authorization||'').replace(/^Bearer /,'');const admin=same(secret,instructor);if(!admin&&!same(secret,s.token))return send(403,{error:'Access denied'});
 const route=match[2];if(route&&!['review','debrief','audio','speech'].includes(route))return send(404,{error:'Not found'});if(!['GET','POST'].includes(req.method))return send(405,{error:'Method not allowed'});const trainee=same(secret,s.token);
 // Voice. A line already in this call's log is read by ElevenLabs (never arbitrary text); a push-to-talk clip is transcribed and returned, not logged. Only the trainee can speak; the instructor may listen.
 if(route==='audio'){if(req.method!=='GET')return send(405,{error:'Method not allowed'});if(!voice)return send(503,{error:'Voice is not connected. Add ELEVENLABS_API_KEY to .env and restart the server.'});const id=url.searchParams.get('event');const line=engine.history(s.id).find(e=>['message','ack'].includes(e.kind)&&e.data?.id===id&&['Caller','Fire','EMS'].includes(e.data.from));if(!line)return send(404,{error:'No such line'});
  let out;try{out=await voice.synthesize({text:line.data.text,speaker:line.data.from,distress:line.data.distress??(line.data.from==='Caller'?inferDistress(line.data.text):0)})}catch(e){if(e.status===502)sentry.captureException(e,{tags:{integration:'elevenlabs',stage:'speak'}});throw e}
  res.writeHead(200,{'Content-Type':out.type,'Content-Length':out.bytes.length,'Cache-Control':'private, max-age=600'});return res.end(out.bytes)}
 if(route==='speech'){if(req.method!=='POST')return send(405,{error:'Method not allowed'});if(!trainee)return send(403,{error:'Only the trainee on this call can speak on it'});if(!voice)return send(503,{error:'Voice input is not connected. Add ELEVENLABS_API_KEY to .env and restart the server.'});if(s.status==='ended')return send(409,{error:'Exercise has ended'});
  const span=tx.startChild('ai.audio.transcribe','ElevenLabs: transcribe clip');let out;try{out=await voice.transcribe({audio:clip,type:req.headers['content-type']});span.finish()}catch(e){span.finish(e.status===502?'internal_error':'invalid_argument');if(e.status===502)sentry.captureException(e,{tags:{integration:'elevenlabs',stage:'transcribe'}});throw e}
  return send(200,out)}
 if(route==='debrief'){if(!admin)return send(403,{error:'Instructor access required'});
  if(req.method==='POST'){if(s.status!=='ended')return send(409,{error:'End the exercise before drafting feedback'});
   if(body.action==='draft'){if(!debrief)return send(503,{error:'Debrief drafting is not connected. Add CREAO_DEBRIEF_APP_ID and CREAO_DEBRIEF_API_KEY to .env and restart the server.'});if(engine.debriefsFor(s.id).some(d=>d.status==='pending'))return send(409,{error:'A draft is already being written.'});
    const events=engine.history(s.id);const inputs=debriefInputs({session:s,events,observations:observe(s.scenario,events),outcome:outcome(s.scenario,events),performance:callMetrics(s.scenario,events),goals:GOALS});
    const span=tx.startChild('ai.agent.run','CREAO Debrief Coach: start run');let run;try{run=await startRun(debrief,inputs,fetchImpl);span.finish()}catch(e){span.finish('internal_error');sentry.captureException(e,{tags:{integration:'creao',stage:'debrief-start'}});throw e}
    engine.startDebrief(run,s.id);scheduleDebrief(run)}
   else if(body.action==='poll'){const row=engine.debriefsFor(s.id).find(d=>d.run===body.run&&d.status==='pending');if(row)await resolveDebrief({...row,session:s.id},tx)}
   else return send(400,{error:'Unknown debrief action'})}
  return send(200,{connected:!!debrief,debriefs:engine.debriefsFor(s.id)})}
 if(route==='review'){if(!admin)return send(403,{error:'Instructor access required'});// Instructors may watch a live run; feedback can only be written once it has ended.
 if(req.method==='POST'){if(s.status!=='ended')return send(409,{error:'End the exercise before review'});s=engine.review(s.id,body)}else if(s.status==='active')s=engine.tick(s);return send(200,{...engine.public(s),scenario:s.scenario,review:s.review,released:s.released,reviews:engine.reviewHistory(s.id),observations:observe(s.scenario,engine.history(s.id))})}
 if(req.method==='POST'){if(!trainee&&body.action!=='end')return send(403,{error:'The instructor key can only end an exercise'});s=engine.act(s.id,body.action,body.data||{},body.key,trainee?'trainee':'instructor',{callerHoldMs:caller?caller.holdMs:null});if(caller&&trainee&&body.action==='send'&&body.data?.to==='Caller')askCaller(s)}else{s=engine.tick(s)}return send(200,engine.public(s));
 }catch(e){
  // Plain Error = an expected validation message for the user. Anything else (TypeError, SQLite, network) is a bug: report it, return a generic 500.
  const expected=e?.status||(e?.constructor===Error&&!e?.code);
  if(expected)return send(e.status||400,{error:e.message});
  sentry.captureException(e,{tags:{route,method:req.method}});send(500,{error:'Something went wrong on the server.'})}});
return server;
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
const root=fileURLToPath(new URL('.',import.meta.url));
const keyFile=root+'.instructor-key';
if(!existsSync(keyFile))writeFileSync(keyFile,randomBytes(24).toString('hex'),{mode:0o600});
try{process.loadEnvFile(root+'.env')}catch{}
const instructor=readFileSync(keyFile,'utf8').trim();const engine=new Engine(root+'responseroom.sqlite');
let release='responseroom@dev';try{release='responseroom@'+execFileSync('git',['rev-parse','--short','HEAD'],{cwd:root,encoding:'utf8'}).trim()}catch{}
const sentry=sentryFromEnv(process.env,release);
process.on('uncaughtException',async e=>{sentry.captureException(e,{tags:{source:'process'},level:'fatal'});await sentry.flush();process.exit(1)});
process.on('unhandledRejection',e=>sentry.captureException(e instanceof Error?e:Error(String(e)),{tags:{source:'process'}}));
const audio=audioConfig();
const callerAgent=callerConfig();
const server=createServer(engine,instructor,{creao:creaoConfig(),debrief:debriefConfig(),caller:callerAgent,audio,sentry});
server.listen(Number(process.env.PORT||4173),'127.0.0.1',()=>console.log('ResponseRoom: http://127.0.0.1:'+server.address().port+'\nInstructor key stored locally in .instructor-key (never commit).\nSentry: '+(sentry.enabled?'connected ('+release+')':'not connected')+'\nVoice: '+(audio?'ElevenLabs':'device voices and typed input (no ELEVENLABS_API_KEY)')+'\nCaller agent: '+(callerAgent?'CREAO':'scripted readback (no CREAO_CALLER_APP_ID / CREAO_CALLER_API_KEY)')));

}
