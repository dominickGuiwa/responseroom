import http from 'node:http';
import {readFileSync,existsSync,writeFileSync} from 'node:fs';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {Engine,scenario} from './engine.mjs';
import {creaoConfig,startRun,pollRun,validateRequest,importScenario} from './creao.mjs';
import {noopSentry,sentryFromEnv,routeTemplate} from './sentry.mjs';
import {SITUATIONS,pickSituation} from './situations.mjs';
import {observe,GOALS} from './observations.mjs';
import {applyDifficulty} from './difficulty.mjs';
import {generateInputs,buildGenerated,tooSimilar} from './generate.mjs';
import {execFileSync} from 'node:child_process';
export function createServer(engine,instructor,{creao=null,fetchImpl=fetch,sentry=noopSentry,generationPollMs=12000}={}){
const root=fileURLToPath(new URL('.',import.meta.url));
// Browser error forwarding is rate-limited so a broken page cannot flood Sentry.
let clientErrors={minute:0,count:0};
const same=(a,b)=>{const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y)};
const rotation=()=>[...SITUATIONS,...engine.scenarios().filter(x=>x.approved)];
// Resolves one pending generation: polls CREAO once; a finished run is checked and either added to the rotation
// (one-button generation) or kept as an import for the authoring form (older manual flow).
async function resolveGeneration(row,tx=noopSentry.startTransaction()){
 const span=tx.startChild('ai.agent.poll','CREAO Scenario Builder: poll run');let result;
 try{result=await pollRun(creao,row.run,fetchImpl);span.finish()}catch(e){span.finish('internal_error');sentry.captureException(e,{tags:{integration:'creao',stage:'poll'}});throw e}
 tx.setTag('creao.run_status',result.status);
 if(result.status==='completed'){const check=tx.startChild('ai.validate','Validate scenario output');
  try{const imported=importScenario(result.output);
   if(row.mode==='auto'){const built=buildGenerated({raw:result.output,imported,run:row.run,rotation:rotation()});const reason=tooSimilar(built,rotation());
    if(reason){engine.failGeneration(row.run,'Not added: '+reason+'.');tx.setTag('creao.outcome','similar');sentry.captureMessage('CREAO situation too similar to the rotation',{tags:{integration:'creao',reason:reason.slice(0,150)}})}
    else{engine.addGenerated(row.run,built.input,built.extras);tx.setTag('creao.outcome','added')}}
   else{engine.readyGeneration(row.run,imported);tx.setTag('creao.outcome','ready')}
   check.finish()}
  catch(e){check.finish('invalid_argument');engine.failGeneration(row.run,'Rejected: '+e.message);tx.setTag('creao.outcome','rejected');sentry.captureMessage('CREAO output rejected by validator',{tags:{integration:'creao',reason:e.message.slice(0,150)}})}}
 else if(result.status==='failed'){engine.failGeneration(row.run,result.error);tx.setTag('creao.outcome','failed');sentry.captureMessage('CREAO run failed',{tags:{integration:'creao',reason:result.error}})}
}
// Background polling, so a generated situation lands in the rotation even if the instructor closes the page.
const timers=new Map();
function scheduleGeneration(run){if(!creao||timers.has(run))return;const started=Date.now();const t=setInterval(async()=>{const row=engine.generations().find(g=>g.run===run);if(!row||row.status!=='pending'||Date.now()-started>15*60*1000){clearInterval(t);timers.delete(run);return}try{await resolveGeneration(row)}catch{}},generationPollMs);t.unref?.();timers.set(run,t)}
if(creao)for(const g of engine.generations())if(g.status==='pending'&&g.mode==='auto')scheduleGeneration(g.run);
const server=http.createServer(async(req,res)=>{res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Security-Policy',"default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'");
 const url=new URL(req.url,'http://localhost');const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data))};
 // One performance transaction per state-changing API call, named by route template (no IDs). Read-only GET polling (trainee clock, dashboard refresh) is not traced.
 const route=routeTemplate(url.pathname);const traced=url.pathname.startsWith('/api/')&&req.method!=='GET';
 const tx=traced?sentry.startTransaction(`${req.method} ${route}`,'http.server'):noopSentry.startTransaction();
 res.on('finish',()=>{tx.setTag('http.status_code',res.statusCode);tx.finish(res.statusCode>=500?'internal_error':res.statusCode>=400?'invalid_argument':'ok')});
 try{if(req.method==='POST'&&req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`)return send(403,{error:'Origin rejected'});
 if(!url.pathname.startsWith('/api/')){const file={'/':'index.html','/instructor':'index.html','/app.js':'app.js','/insights.js':'insights.js','/streetmap.js':'streetmap.js','/style.css':'style.css'}[url.pathname];if(!file)return send(404,{error:'Not found'});res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');return res.end(readFileSync(root+'public/'+file))}
 let body={};if(req.method==='POST'){let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>20000)return send(413,{error:'Request too large'})}try{body=JSON.parse(raw||'{}')}catch{return send(400,{error:'Request body is not valid JSON'})}}
 if(url.pathname==='/api/client-error'&&req.method==='POST'){const minute=Math.floor(Date.now()/60000);if(clientErrors.minute!==minute)clientErrors={minute,count:0};if(typeof body.message==='string'&&++clientErrors.count<=20)sentry.captureException({name:'BrowserError',message:body.message,stack:typeof body.stack==='string'?body.stack:''},{tags:{source:'browser',page:routeTemplate(String(body.path||''))}});res.writeHead(204);return res.end()}
 if(url.pathname==='/api/scenarios'){
  if(!same((req.headers.authorization||'').replace(/^Bearer /,''),instructor))return send(403,{error:'Instructor access required'});
  if(req.method==='POST'){
   if(body.action==='save'){if(body.creaoRun)engine.saveImportedScenario(String(body.creaoRun),body.scenario);else engine.saveScenario(body.scenario)}
   else if(body.action==='remove'){if(!engine.removeFromRotation(String(body.id)))return send(404,{error:'That situation is not in the rotation'})}
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
   if(body.action==='generate'){const inputs=generateInputs(rotation());const span=tx.startChild('ai.agent.run','CREAO Scenario Builder: start run');let run;try{run=await startRun(creao,inputs,fetchImpl);span.finish()}catch(e){span.finish('internal_error');sentry.captureException(e,{tags:{integration:'creao',stage:'start'}});throw e}engine.startGeneration(run,inputs,'auto');scheduleGeneration(run)}
   else if(body.action==='start'){const inputs=validateRequest(body.inputs);const span=tx.startChild('ai.agent.run','CREAO Scenario Builder: start run');try{engine.startGeneration(await startRun(creao,inputs,fetchImpl),inputs);span.finish()}catch(e){span.finish('internal_error');sentry.captureException(e,{tags:{integration:'creao',stage:'start'}});throw e}}
   else if(body.action==='poll'||body.action==='recheck'){if(body.action==='recheck'&&!engine.reopenGeneration(String(body.run)))return send(409,{error:'Only rejected runs can be rechecked'});const row=engine.generations().find(g=>g.run===body.run);if(!row)return send(404,{error:'Unknown generation'});if(row.status==='pending')await resolveGeneration(row,tx)}
   else return send(400,{error:'Unknown CREAO action'});
  }else if(req.method!=='GET')return send(405,{error:'Method not allowed'});
  return send(200,{connected:!!creao,generations:engine.generations(),scenarios:engine.scenarios()});
 }
 if(url.pathname==='/api/info')return send(200,{title:scenario.title,briefing:scenario.briefing,version:scenario.version,goals:GOALS,creao:creao?'Key configured':'Not connected',sentry:sentry.enabled?'Connected':'Not connected'});
 if(url.pathname==='/api/sessions'&&req.method==='GET'){if(!same((req.headers.authorization||'').replace(/^Bearer /,''),instructor))return send(403,{error:'Instructor access required'});return send(200,engine.sessionsSummary())}
 // Each new run gets a different situation: built-in demo situations plus instructor-approved scenarios, avoiding recent ones.
 if(url.pathname==='/api/sessions'&&req.method==='POST'){const name=typeof body.name==='string'?body.name.trim():'';if(name.length>60)return send(400,{error:'Please use a name of 60 characters or fewer.'});const pool=[...SITUATIONS,...engine.scenarios().filter(x=>x.approved)];// Difficulty and caller timing are drawn now and pinned to this run.
 const picked=applyDifficulty(structuredClone(pickSituation(pool,Array.isArray(body.avoid)?body.avoid:[])));const s=engine.create(picked,{trainee:name||null});return send(201,{...engine.public(s),token:s.token})}
 // Instructor view of the rotation: what trainees can be given, with hidden truth for reference.
 if(url.pathname==='/api/situations'){if(!same((req.headers.authorization||'').replace(/^Bearer /,''),instructor))return send(403,{error:'Instructor access required'});return send(200,[...SITUATIONS,...engine.scenarios().filter(x=>x.approved)].map(x=>({id:x.id||null,version:x.version,title:x.title,builtIn:!!x.builtIn,generated:x.source?.kind==='creao',truth:x.truth,initialMessage:x.initialMessage,correctionMessage:x.correctionMessage,correctionAt:x.correctionAt,endAt:x.endAt??null})))}
 const match=url.pathname.match(/^\/api\/sessions\/([\w-]+)(?:\/(\w+))?$/);if(!match)return send(404,{error:'Not found'});let s=engine.get(match[1]);if(!s)return send(404,{error:'Not found'});
 const secret=(req.headers.authorization||'').replace(/^Bearer /,'');const admin=same(secret,instructor);if(!admin&&!same(secret,s.token))return send(403,{error:'Access denied'});
 const route=match[2];if(route&&route!=='review')return send(404,{error:'Not found'});if(!['GET','POST'].includes(req.method))return send(405,{error:'Method not allowed'});if(route==='review'){if(!admin)return send(403,{error:'Instructor access required'});// Instructors may watch a live run; feedback can only be written once it has ended.
 if(req.method==='POST'){if(s.status!=='ended')return send(409,{error:'End the exercise before review'});s=engine.review(s.id,body)}else if(s.status==='active')s=engine.tick(s);return send(200,{...engine.public(s),scenario:s.scenario,review:s.review,released:s.released,reviews:engine.reviewHistory(s.id),observations:observe(s.scenario,engine.history(s.id))})}
 if(req.method==='POST'){const trainee=same(secret,s.token);if(!trainee&&body.action!=='end')return send(403,{error:'The instructor key can only end an exercise'});s=engine.act(s.id,body.action,body.data||{},body.key,trainee?'trainee':'instructor')}else{s=engine.tick(s)}return send(200,engine.public(s));
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
const server=createServer(engine,instructor,{creao:creaoConfig(),sentry});
server.listen(Number(process.env.PORT||4173),'127.0.0.1',()=>console.log('ResponseRoom: http://127.0.0.1:'+server.address().port+'\nInstructor key stored locally in .instructor-key (never commit).\nSentry: '+(sentry.enabled?'connected ('+release+')':'not connected')));

}
