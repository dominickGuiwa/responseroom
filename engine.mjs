import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
export const scenario = Object.freeze({version:'cedar-demo-1', title:'Cedar Court',truth:{location:'18 Cedar Court',entrance:'North entrance'},briefing:'You are the dispatcher for a fictional incident. Communicate with the caller, Fire, and EMS. Maintain your own incident record. Messages and record edits are separate actions.'});
export class Engine {
 constructor(path){this.db=new DatabaseSync(path);this.db.exec(`PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS scenarios(id TEXT PRIMARY KEY, data TEXT, approved INTEGER DEFAULT 0, approver TEXT); CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY, token TEXT, data TEXT); CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY AUTOINCREMENT,session TEXT, time INTEGER, kind TEXT, data TEXT, request TEXT, UNIQUE(session,request)); CREATE TABLE IF NOT EXISTS requests(session TEXT, request TEXT, payload TEXT, PRIMARY KEY(session,request)); CREATE TABLE IF NOT EXISTS reviews(id INTEGER PRIMARY KEY AUTOINCREMENT, session TEXT, version INTEGER, text TEXT, reviewer TEXT, released INTEGER, created INTEGER, UNIQUE(session,version)); CREATE TABLE IF NOT EXISTS audit(time INTEGER,session TEXT,reason TEXT); CREATE TABLE IF NOT EXISTS generations(run TEXT PRIMARY KEY, brief TEXT, status TEXT, scenario TEXT, error TEXT, created INTEGER, import TEXT);`);if(!this.db.prepare('PRAGMA table_info(generations)').all().some(c=>c.name==='import'))this.db.exec('ALTER TABLE generations ADD COLUMN import TEXT')}
 save(s){this.db.prepare('INSERT OR REPLACE INTO sessions VALUES(?,?,?)').run(s.id,s.token,JSON.stringify(s));return s}
 get(id){const r=this.db.prepare('SELECT data FROM sessions WHERE id=?').get(id);return r?JSON.parse(r.data):null}
 history(id){return this.db.prepare('SELECT seq,time,kind,data FROM events WHERE session=? ORDER BY seq').all(id).map(e=>({...e,data:JSON.parse(e.data)}))}
 event(s,kind,data,request=null,at=s.elapsed){this.db.prepare('INSERT INTO events(session,time,kind,data,request) VALUES(?,?,?,?,?)').run(s.id,at,kind,JSON.stringify(data),request)}
 create(selected=scenario){const s={id:randomUUID(),token:randomUUID(),version:selected.version,scenario:structuredClone(selected),elapsed:0,last:Date.now(),created:Date.now(),status:'active',record:{location:'',entrance:'',caller:'',notes:''},pending:[],corrected:false,review:null,released:false};this.save(s);this.event(s,'started',{version:s.version});this.event(s,'message',{id:randomUUID(),from:'Caller',to:'Dispatcher',text:selected.initialMessage||'There is smoke at 18 Cedar Court. I am by the south entrance.'});return s}
 tick(s,now=Date.now()){
  if(s.status!=='active')return s;
  const owned=!this.db.isTransaction;
  if(owned)this.db.exec('BEGIN');
  try {
   s.elapsed+=Math.max(0,now-s.last);s.last=Math.max(now,s.last);
   // A time limit ends the exercise at exactly that scenario time; nothing scheduled after it is delivered.
   const limit=s.scenario.endAt??null,horizon=limit===null?s.elapsed:Math.min(s.elapsed,limit);
   // Participant replies are readbacks of what the trainee actually sent: an authored template wraps the raw text, never adds facts.
   const reply=p=>{const t=s.scenario.replies?.[p.to];return t?t.split('{message}').join(p.text):`Received: “${p.text}”`};
   const due=s.pending.filter(p=>p.due<=horizon).map(p=>({at:p.due,kind:'ack',data:{id:randomUUID(),from:p.to,to:'Dispatcher',text:reply(p),messageId:p.id,contentVersion:p.id}}));
   const lines=[{at:s.scenario.correctionAt??30000,text:s.scenario.correctionMessage||'I need to correct that. I am at the north entrance, not the south entrance.'},...(s.scenario.extraCallerLines||[])];
   let sent=s.callerSent??(s.corrected?1:0);
   while(sent<lines.length&&lines[sent].at<=horizon){due.push({at:lines[sent].at,kind:'message',data:{id:randomUUID(),from:'Caller',to:'Dispatcher',text:lines[sent].text}});sent++}
   s.callerSent=sent;s.corrected=sent>0;
   due.sort((a,b)=>a.at-b.at);for(const e of due)this.event(s,e.kind,e.data,null,e.at);
   s.pending=s.pending.filter(p=>p.due>horizon);
   if(limit!==null&&s.elapsed>=limit){s.elapsed=limit;s.status='ended';const cancelled=s.pending.map(p=>p.id);s.pending=[];this.event(s,'ended',{reason:'time_limit',cancelledAcknowledgments:cancelled},null,limit)}
   this.save(s);
   if(owned)this.db.exec('COMMIT');return s;
  }catch(e){if(owned)this.db.exec('ROLLBACK');throw e}
 }

 // actor is 'trainee' or 'instructor'; the server only lets the instructor end an exercise, never act as the trainee.
 act(id,action,data,key,actor='trainee'){let s=this.get(id);if(!s)throw Error('Session not found');if(typeof key!=='string'||!key||key.length>100)throw Error('Request ID required');const payload=JSON.stringify([action,data]);const prior=this.db.prepare('SELECT payload FROM requests WHERE session=? AND request=?').get(id,key);if(prior){if(prior.payload!==payload)throw Object.assign(Error('Request ID reused with different content'),{status:409});return s;}
 // Request IDs recorded before the requests table existed have no stored payload; treat them as already applied.
 if(this.db.prepare('SELECT 1 FROM events WHERE session=? AND request=?').get(id,key))return s;
 if(s.status==='ended'){this.db.prepare('INSERT INTO audit VALUES(?,?,?)').run(Date.now(),id,'Rejected action after end');throw Error('Exercise has ended')}
 if(!['record','send','pause','resume','end'].includes(action))throw Error('Unknown action');if(s.status==='paused'&&!['resume','end'].includes(action))throw Error('Exercise is paused');
 if(action==='send'&&(!['Caller','Fire','EMS'].includes(data.to)||typeof data.text!=='string'||!data.text.trim()||data.text.length>4000))throw Error('Choose a recipient and enter a message (up to 4000 characters)');
 if(action==='record'&&(!['location','entrance','caller','notes'].includes(data.field)||typeof data.value!=='string'||data.value.length>4000))throw Error('Invalid record field');
 s=this.tick(s);if(s.status==='ended')throw Error('Exercise has ended');
 this.db.exec('BEGIN');try{if(action==='record'){s.record[data.field]=data.value;this.event(s,'record',data,key)}if(action==='send'){const m={id:randomUUID(),from:'Dispatcher',to:data.to,text:data.text};this.event(s,'message',m,key);s.pending.push({...m,due:s.elapsed+2500})}if(action==='pause'){s.status='paused';this.event(s,'paused',{},key)}if(action==='resume'){s.status='active';s.last=Date.now();this.event(s,'resumed',{},key)}if(action==='end'){s.status='ended';const cancelled=s.pending.map(p=>p.id);s.pending=[];this.event(s,'ended',{cancelledAcknowledgments:cancelled,...(actor==='instructor'?{reason:'instructor'}:{})},key)}this.save(s);this.db.prepare('INSERT INTO requests VALUES(?,?,?)').run(id,key,payload);this.db.exec('COMMIT');return s}catch(e){this.db.exec('ROLLBACK');throw e}}
 scenarios(){return this.db.prepare('SELECT * FROM scenarios ORDER BY rowid DESC').all().map(r=>({...JSON.parse(r.data),approved:!!r.approved,approver:r.approver}))}
 saveScenario(input,source={kind:'manual'}){
  for(const field of ['title','objective','procedures','briefing','initialMessage','correctionMessage','location','entrance'])if(typeof input[field]!=='string'||!input[field].trim()||input[field].length>4000)throw Error('Complete all scenario fields (maximum 4000 characters each)');
  if(!Number.isInteger(input.correctionAt)||input.correctionAt<1000||input.correctionAt>3600000)throw Error('Correction time must be between 1 and 3600 seconds');
  // Optional authored extras. Reply templates must read back the trainee's own text and may not mention the hidden truth.
  const extraCallerLines=input.extraCallerLines??[];
  if(!Array.isArray(extraCallerLines)||extraCallerLines.length>10)throw Error('Up to 10 additional caller messages');
  let previous=input.correctionAt;for(const line of extraCallerLines){if(!line||!Number.isInteger(line.at)||line.at<=previous||line.at>3600000||typeof line.text!=='string'||!line.text.trim()||line.text.length>4000)throw Error('Each additional caller message needs text and a time later than the previous message (up to 3600 seconds)');previous=line.at}
  const replies={};for(const [who,template] of Object.entries(input.replies??{})){if(template===''||template==null)continue;if(!['Caller','Fire','EMS'].includes(who)||typeof template!=='string'||template.length>500)throw Error('Reply templates are for Caller, Fire or EMS (up to 500 characters)');if(!template.includes('{message}'))throw Error(`${who} reply must include {message} so it reads back what the trainee sent`);const lower=template.toLowerCase();for(const fact of [input.location,input.entrance])if(fact.trim().length>=3&&lower.includes(fact.trim().toLowerCase()))throw Error(`${who} reply mentions the hidden truth; participants only know what the trainee sends`);replies[who]=template}
  const endAt=input.endAt??null;if(endAt!==null&&(!Number.isInteger(endAt)||endAt<=previous||endAt>3600000))throw Error('Time limit must be after the last caller message (up to 3600 seconds)');
  const revisedFrom=input.revisedFrom??null;if(revisedFrom!==null&&(typeof revisedFrom!=='string'||!this.db.prepare('SELECT 1 FROM scenarios WHERE id=?').get(revisedFrom)))throw Error('Revised version not found');
  const id=randomUUID(),draft={id,version:id,title:input.title,objective:input.objective,procedures:input.procedures,briefing:input.briefing,initialMessage:input.initialMessage,correctionMessage:input.correctionMessage,correctionAt:input.correctionAt,extraCallerLines,replies,endAt,truth:{location:input.location,entrance:input.entrance},source,revisedFrom,created:Date.now()};
  this.db.prepare('INSERT INTO scenarios(id,data) VALUES(?,?)').run(id,JSON.stringify(draft));return draft;
 }
 // CREAO generations: a finished run is only an import for the instructor form; it becomes a draft only when the instructor saves it.
 generations(){return this.db.prepare('SELECT run,brief,status,scenario,error,import,created FROM generations ORDER BY created DESC').all().map(g=>({...g,brief:JSON.parse(g.brief),import:g.import?JSON.parse(g.import):null}))}
 startGeneration(run,inputs){this.db.prepare("INSERT INTO generations(run,brief,status,created) VALUES(?,?,'pending',?)").run(run,JSON.stringify(inputs),Date.now())}
 readyGeneration(run,imported){this.db.prepare("UPDATE generations SET status='ready',import=? WHERE run=? AND status='pending'").run(JSON.stringify(imported),run)}
 // Re-reading a finished run is free (no new CREAO run), so a rejected import can be rechecked after validator fixes.
 reopenGeneration(run){return this.db.prepare("UPDATE generations SET status='pending',error=NULL WHERE run=? AND status='rejected'").run(run).changes>0}
 failGeneration(run,error){this.db.prepare("UPDATE generations SET status='rejected',error=? WHERE run=? AND status='pending'").run(String(error).slice(0,300),run)}
 saveImportedScenario(run,input){
  const row=this.db.prepare('SELECT status FROM generations WHERE run=?').get(run);if(!row||!['ready','drafted'].includes(row.status))throw Error('That CREAO run has no checked import');
  this.db.exec('BEGIN');try{const draft=this.saveScenario(input,{kind:'creao',run});this.db.prepare("UPDATE generations SET status='drafted',scenario=? WHERE run=?").run(draft.id,run);this.db.exec('COMMIT');return draft}catch(e){this.db.exec('ROLLBACK');throw e}
 }
 approveScenario(id,name){if(typeof name!=='string'||!name.trim()||name.length>100)throw Error('Approver name required');const result=this.db.prepare('UPDATE scenarios SET approved=1,approver=? WHERE id=? AND approved=0').run(name.trim(),id);if(!result.changes)throw Error('Draft not found or already approved')}
 launchScenario(id){const row=this.db.prepare('SELECT * FROM scenarios WHERE id=? AND approved=1').get(id);if(!row)throw Error('An approved scenario version is required');return this.create(JSON.parse(row.data))}
 // Instructor overview: no tokens, no hidden truth, no record contents.
 sessionsSummary(){return this.db.prepare('SELECT data FROM sessions').all().map(r=>JSON.parse(r.data)).map(s=>({id:s.id,title:s.scenario?.title||s.version,version:s.version,status:s.status,elapsed:s.elapsed,created:s.created??null,released:!!s.released,reviewVersion:s.reviewVersion||null,reviews:this.reviewHistory(s.id).length})).sort((a,b)=>(b.created??0)-(a.created??0))}
 reviewHistory(id){return this.db.prepare('SELECT version,text,reviewer,released,created FROM reviews WHERE session=? ORDER BY version').all(id)}
 review(id,{text,reviewer,verified,release=false}){
  const s=this.get(id);if(!s||s.status!=='ended')throw Error('End the exercise before review');
  if(typeof text!=='string'||!text.trim()||text.length>10000)throw Error('Review text is required');
  if(typeof reviewer!=='string'||!reviewer.trim()||reviewer.length>100)throw Error('Reviewer name is required');
  if(release&&verified!==true)throw Error('Instructor verification required');
  this.db.exec('BEGIN');try{
   const version=this.reviewHistory(id).length+1;
   this.db.prepare('INSERT INTO reviews(session,version,text,reviewer,released,created) VALUES(?,?,?,?,?,?)').run(id,version,text,reviewer.trim(),release?1:0,Date.now());
   if(release){s.review=text;s.released=true;s.reviewVersion=version;this.save(s)}
   this.db.exec('COMMIT');return this.get(id);
  }catch(e){this.db.exec('ROLLBACK');throw e}
 }
 public(s){return {id:s.id,version:s.version,status:s.status,elapsed:s.elapsed,record:s.record,events:this.history(s.id),review:s.released?s.review:null,endAt:s.scenario?.endAt??null,reviewVersion:s.reviewVersion||null}}
}
