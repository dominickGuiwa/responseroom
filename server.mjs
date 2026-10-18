import http from 'node:http';
import {readFileSync,existsSync,writeFileSync} from 'node:fs';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {Engine,scenario} from './engine.mjs';
import {creaoConfig,startRun,pollRun,validateRequest,importScenario} from './creao.mjs';
export function createServer(engine,instructor,{creao=null,fetchImpl=fetch}={}){
const root=fileURLToPath(new URL('.',import.meta.url));
const same=(a,b)=>{const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y)};
const server=http.createServer(async(req,res)=>{res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Security-Policy',"default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'");
 const url=new URL(req.url,'http://localhost');const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data))};
 try{if(req.method==='POST'&&req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`)return send(403,{error:'Origin rejected'});
 if(!url.pathname.startsWith('/api/')){const file={'/':'index.html','/instructor':'index.html','/app.js':'app.js','/style.css':'style.css'}[url.pathname];if(!file)return send(404,{error:'Not found'});res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');return res.end(readFileSync(root+'public/'+file))}
 let body={};if(req.method==='POST'){let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>20000)return send(413,{error:'Request too large'})}body=JSON.parse(raw||'{}')}
 if(url.pathname==='/api/scenarios'){
  if(!same((req.headers.authorization||'').replace(/^Bearer /,''),instructor))return send(403,{error:'Instructor access required'});
  if(req.method==='POST'){
   if(body.action==='save'){if(body.creaoRun)engine.saveImportedScenario(String(body.creaoRun),body.scenario);else engine.saveScenario(body.scenario)}
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
   if(body.action==='start'){const inputs=validateRequest(body.inputs);engine.startGeneration(await startRun(creao,inputs,fetchImpl),inputs)}
   else if(body.action==='poll'||body.action==='recheck'){if(body.action==='recheck'&&!engine.reopenGeneration(String(body.run)))return send(409,{error:'Only rejected runs can be rechecked'});const row=engine.generations().find(g=>g.run===body.run);if(!row)return send(404,{error:'Unknown generation'});if(row.status==='pending'){const result=await pollRun(creao,row.run,fetchImpl);if(result.status==='completed'){try{engine.readyGeneration(row.run,importScenario(result.output))}catch(e){engine.failGeneration(row.run,'Rejected: '+e.message)}}else if(result.status==='failed')engine.failGeneration(row.run,result.error)}}
   else return send(400,{error:'Unknown CREAO action'});
  }else if(req.method!=='GET')return send(405,{error:'Method not allowed'});
  return send(200,{connected:!!creao,generations:engine.generations(),scenarios:engine.scenarios()});
 }
 if(url.pathname==='/api/info')return send(200,{title:scenario.title,briefing:scenario.briefing,version:scenario.version,creao:creao?'Key configured':'Not connected',sentry:'Not connected'});
 if(url.pathname==='/api/sessions'&&req.method==='GET'){if(!same((req.headers.authorization||'').replace(/^Bearer /,''),instructor))return send(403,{error:'Instructor access required'});return send(200,engine.sessionsSummary())}
 if(url.pathname==='/api/sessions'&&req.method==='POST'){const s=engine.create();return send(201,{...engine.public(s),token:s.token})}
 const match=url.pathname.match(/^\/api\/sessions\/([\w-]+)(?:\/(\w+))?$/);if(!match)return send(404,{error:'Not found'});let s=engine.get(match[1]);if(!s)return send(404,{error:'Not found'});
 const secret=(req.headers.authorization||'').replace(/^Bearer /,'');const admin=same(secret,instructor);if(!admin&&!same(secret,s.token))return send(403,{error:'Access denied'});
 const route=match[2];if(route&&route!=='review')return send(404,{error:'Not found'});if(!['GET','POST'].includes(req.method))return send(405,{error:'Method not allowed'});if(route==='review'){if(!admin)return send(403,{error:'Instructor access required'});if(s.status!=='ended')return send(409,{error:'End the exercise before review'});if(req.method==='POST')s=engine.review(s.id,body);return send(200,{...engine.public(s),scenario:s.scenario,review:s.review,released:s.released,reviews:engine.reviewHistory(s.id)})}
 if(req.method==='POST'){s=engine.act(s.id,body.action,body.data||{},body.key)}else{s=engine.tick(s)}return send(200,engine.public(s));
 }catch(e){send(e.status||400,{error:e.message})}});
return server;
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
const root=fileURLToPath(new URL('.',import.meta.url));
const keyFile=root+'.instructor-key';
if(!existsSync(keyFile))writeFileSync(keyFile,randomBytes(24).toString('hex'),{mode:0o600});
try{process.loadEnvFile(root+'.env')}catch{}
const instructor=readFileSync(keyFile,'utf8').trim();const engine=new Engine(root+'responseroom.sqlite');
const server=createServer(engine,instructor,{creao:creaoConfig()});
server.listen(Number(process.env.PORT||4173),'127.0.0.1',()=>console.log('ResponseRoom: http://127.0.0.1:'+server.address().port+'\nInstructor key stored locally in .instructor-key (never commit).'));

}
