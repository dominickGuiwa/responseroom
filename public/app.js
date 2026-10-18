import {finished,goalRates,summarize,focusAreas,tasks,outcomeBadge,goalBars,columnChart,outcomeStrip,seconds} from '/insights.js';
import {buildMap,mapState,mountMap,renderMap} from '/streetmap.js';
const LEVEL_LABEL={easy:'Easy',standard:'Standard',hard:'Hard'};
const app=document.querySelector('#app');
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const time=n=>`${String(Math.floor(n/60000)).padStart(2,'0')}:${String(Math.floor(n/1000)%60).padStart(2,'0')}`;
const isInstructor=location.pathname==='/instructor';
const reduceMotion=window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const FIELDS=[['location','Location'],['entrance','Entrance, unit or side'],['caller','Caller name or callback number'],['notes','Notes']];
const FIELD_LABEL=Object.fromEntries(FIELDS);
// Drafts are keyed by session id so tabs on different exercises never share them. The active session is per tab (sessionStorage); localStorage only seeds new tabs.
const store={get(k,f){try{const v=localStorage.getItem(k);return v===null?f:JSON.parse(v)}catch{return f}},set(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch{}},del(k){try{localStorage.removeItem(k)}catch{}}};
const tabStore={get(k){try{return JSON.parse(sessionStorage.getItem(k)||'null')}catch{return null}},set(k,v){try{sessionStorage.setItem(k,JSON.stringify(v))}catch{}},del(k){try{sessionStorage.removeItem(k)}catch{}}};
let auth=tabStore.get('rr-session')||store.get('rr-session',null),recordDrafts={},draft='',recipient='Fire';
const draftKey=k=>`rr-${k}:${auth?.id}`;
function loadDrafts(){if(!auth){recordDrafts={};draft='';recipient='Fire';return}recordDrafts=store.get(draftKey('record-drafts'),{});draft=store.get(draftKey('draft'),'');recipient=store.get(draftKey('to'),'Fire')}
function clearDrafts(){if(auth)for(const k of ['record-drafts','draft','to'])store.del(draftKey(k));recordDrafts={};draft=''}
function setAuth(next){auth=next;if(next){tabStore.set('rr-session',next);store.set('rr-session',next)}else{tabStore.del('rr-session');store.del('rr-session')}loadDrafts()}
// One-time migration of drafts saved under the old global keys to the session they belonged to.
try{if(auth&&localStorage.getItem('rr-draft')!==null&&localStorage.getItem(draftKey('draft'))===null){store.set(draftKey('draft'),localStorage.getItem('rr-draft'));const r=localStorage.getItem('rr-record-drafts');if(r)localStorage.setItem(draftKey('record-drafts'),r);const t=localStorage.getItem('rr-to');if(t)store.set(draftKey('to'),t)}for(const k of ['rr-draft','rr-record-drafts','rr-to'])localStorage.removeItem(k)}catch{}
loadDrafts();
let showProgress=false,needName=false,history=store.get('rr-history',[]);
// Calls this device has run for each trainee name (id + token), so trainees can see their own progress over time.
const myRuns=()=>history.filter(h=>h.name===traineeName).slice(-40);
let session=null,connection='',adminKey='',info=null,busy=false,incomingUntil=0,lastSaved=null;
// A trainee "session" is a run of situations in this tab: the name, each situation handled, and the situations seen recently on this device (so the next one is different).
let traineeName=store.get('rr-trainee-name',''),shift=tabStore.get('rr-shift')||[],recent=store.get('rr-recent',[]),showSummary=!!tabStore.get('rr-summary');
async function api(path,body,key=auth?.token){const r=await fetch('/api/'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(key?{Authorization:'Bearer '+key}:{})},...(body?{body:JSON.stringify(body)}:{})});const data=await r.json();if(!r.ok)throw Object.assign(Error(data.error),{status:r.status});return data}
function notify(text){document.querySelector('#notice')?.remove();const el=document.createElement('div');el.id='notice';el.className='notice';el.setAttribute('role','status');el.textContent=text;app.prepend(el);setTimeout(()=>el.remove(),6000)}
function error(e){document.querySelector('#error')?.remove();const el=document.createElement('div');el.id='error';el.className='error';el.setAttribute('role','alert');el.textContent=e?.message||e;app.prepend(el);setTimeout(()=>el.remove(),9000)}
// Uncaught browser errors go to the server, which forwards a scrubbed copy to Sentry when configured.
// Only the error message, stack and page path are sent; never drafts, messages or record contents.
let clientErrorsSent=0;function reportClientError(message,stack){if(clientErrorsSent++>=10)return;fetch('/api/client-error',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:String(message).slice(0,500),stack:String(stack||'').slice(0,4000),path:location.pathname})}).catch(()=>{})}
window.addEventListener('error',e=>reportClientError(e.message,e.error?.stack));window.addEventListener('unhandledrejection',e=>reportClientError(e.reason?.message||e.reason,e.reason?.stack));
const speechAvailable='speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
let voiceOn=false,voiceSession=null,voiceCursor=0;
function speakMessage(event){
 if(!speechAvailable||!voiceOn||session?.status!=='active')return;
 const utterance=new SpeechSynthesisUtterance(`${event.data.from}. ${event.data.text}`);
 const voices=window.speechSynthesis.getVoices().filter(v=>/^en([-_]|$)/i.test(v.lang));
 // Prefer enhanced installed voices without requiring an external speech service.
 const score=v=>(v.localService?20:0)+(/premium|enhanced|natural|neural/i.test(v.name)?100:0)+(/samantha|ava|allison|evan|nathan|serena/i.test(v.name)?10:0)+(/^en-US$/i.test(v.lang)?5:0);
 const voice=voices.sort((a,b)=>score(b)-score(a))[0];
 if(voice)utterance.voice=voice;
 utterance.lang=voice?.lang||'en-US';utterance.rate=0.95;utterance.pitch=1;
 utterance.onerror=e=>{if(!['canceled','interrupted'].includes(e.error)){voiceOn=false;updateVoiceButton();error('Reading aloud is not available on this device. Messages are still shown as text.')}};
 window.speechSynthesis.speak(utterance);
}
function updateVoiceButton(){const b=document.querySelector('#voice');if(b){b.innerHTML=speechAvailable?`Read aloud<span class="state">: ${voiceOn?'on':'off'}</span>`:'Read aloud unavailable';b.setAttribute('aria-pressed',String(voiceOn));b.disabled=!speechAvailable}}
function processVoice(){
 const latest=session.events.at(-1)?.seq||0;
 if(voiceSession!==session.id){voiceSession=session.id;voiceCursor=latest;return}
 if(session.status!=='active'){if(speechAvailable)window.speechSynthesis.cancel();voiceCursor=latest;return}
 for(const event of session.events){if(event.seq>voiceCursor&&['message','ack'].includes(event.kind)&&['Caller','Fire','EMS'].includes(event.data.from))speakMessage(event)}
 voiceCursor=latest;
}
function header(right='',center=''){return `<header class="topbar"><a class="brand" href="${isInstructor?'/instructor':'/'}">ResponseRoom</a>${center}<div class="topbar-right">${right}</div></header>`}

// Agent map: the caller agent, the trainee and the Fire/EMS agents. The live view only animates messages that were
// actually sent; it never marks anyone as "not contacted yet", so it cannot act as a hint.
// "tall" is used on the welcome page and in instructor replays; "wide" fits the trainee's side column.
const LAYOUTS={
 tall:{box:'0 0 420 256',nodes:{Caller:[70,125],You:[210,125],Fire:[350,60],EMS:[350,190]},label:{Caller:[0,52,'middle'],You:[0,52,'middle'],Fire:[0,52,'middle'],EMS:[0,52,'middle']}},
 wide:{box:'0 0 600 150',nodes:{Caller:[60,58],You:[250,58],Fire:[430,32],EMS:[430,112]},label:{Caller:[0,52,'middle'],You:[0,52,'middle'],Fire:[38,6,'start'],EMS:[38,6,'start']}},
};
const NODE_TEXT={Caller:['C','Caller agent'],You:['You','Dispatcher (you)'],Fire:['F','Fire agent'],EMS:['E','EMS agent']};
function agentMap({live=false,demo=false,counts=null,layout='tall'}={}){
 const L=LAYOUTS[layout],P=L.nodes;
 const c=k=>counts?.[k]||0,volume=(a,b)=>c(a+'>'+b)+c(b+'>'+a);
 const line=(a,b)=>`<line class="link${counts&&!volume(a,b)?' quiet':''}" x1="${P[a][0]}" y1="${P[a][1]}" x2="${P[b][0]}" y2="${P[b][1]}"${counts?` stroke-width="${3+2*Math.min(volume(a,b),5)}"`:''}/>`;
 const node=name=>{const [x,y]=P[name],[initial,label]=counts&&name==='You'?['T','Trainee']:NODE_TEXT[name],[lx,ly,anchor]=L.label[name];return `<g class="node node-${name.toLowerCase()}" data-node="${name}" transform="translate(${x} ${y})"><circle class="ring" r="28"/><circle class="body" r="28"/><text class="initial" text-anchor="middle" dy="6">${initial}</text><text class="node-label" text-anchor="${anchor}" x="${lx}" y="${ly}">${label}</text></g>`};
 const label=counts?`Messages so far. Caller to trainee ${c('Caller>You')}, trainee to caller ${c('You>Caller')}, trainee to Fire ${c('You>Fire')}, Fire replies ${c('Fire>You')}, trainee to EMS ${c('You>EMS')}, EMS replies ${c('EMS>You')}.`:'The caller agent talks to you. You message the Fire and EMS agents, and they reply.';
 return `<svg class="agent-map map-${layout}" viewBox="${L.box}" role="img" aria-label="${esc(label)}" data-layout="${layout}" ${live?'data-live':''} ${demo?'data-demo':''}><g>${line('Caller','You')}${line('You','Fire')}${line('You','EMS')}</g><g class="dots"></g>${Object.keys(P).map(node).join('')}</svg>${counts?`<ul class="flow"><li><span>Caller → trainee</span><strong>${c('Caller>You')}</strong></li><li><span>Trainee → caller</span><strong>${c('You>Caller')}</strong></li><li><span>Trainee → Fire</span><strong>${c('You>Fire')}</strong></li><li><span>Fire replies</span><strong>${c('Fire>You')}</strong></li><li><span>Trainee → EMS</span><strong>${c('You>EMS')}</strong></li><li><span>EMS replies</span><strong>${c('EMS>You')}</strong></li></ul>`:''}`;
}
function pulse(svg,from,to){
 const P=LAYOUTS[svg?.dataset.layout||'tall']?.nodes,a=P?.[from],b=P?.[to];if(!svg||!a||!b)return;
 const node=svg.querySelector(`[data-node="${from}"]`);
 if(node){node.classList.remove('speaking');void node.getBoundingClientRect();node.classList.add('speaking');setTimeout(()=>node.classList.remove('speaking'),1300)}
 if(reduceMotion)return;
 const ns='http://www.w3.org/2000/svg',dot=document.createElementNS(ns,'circle'),move=document.createElementNS(ns,'animateMotion');
 dot.setAttribute('r','8');dot.setAttribute('class','travel');
 move.setAttribute('dur','0.9s');move.setAttribute('fill','freeze');move.setAttribute('begin','indefinite');move.setAttribute('path',`M${a[0]},${a[1]} L${b[0]},${b[1]}`);
 dot.append(move);svg.querySelector('.dots').append(dot);
 try{move.beginElement()}catch{}
 setTimeout(()=>dot.remove(),1000);
}
function pulseMarker(svg,name){const node=svg?.querySelector(`[data-node="${name}"]`);if(!node)return;node.classList.remove('speaking');void node.getBoundingClientRect();node.classList.add('speaking');setTimeout(()=>node.classList.remove('speaking'),1300)}
let mapCursor={id:null,seq:0};
function animateAgents(){
 const latest=session.events.at(-1)?.seq||0;
 if(mapCursor.id!==session.id)mapCursor={id:session.id,seq:session.elapsed<6000?0:latest};
 const fresh=session.events.filter(e=>e.seq>mapCursor.seq&&['message','ack'].includes(e.kind));
 mapCursor.seq=latest;
 fresh.slice(-4).forEach((e,i)=>setTimeout(()=>{const from=e.data.from==='Dispatcher'?'You':e.data.from,to=e.data.to==='Dispatcher'?'You':e.data.to;pulse(document.querySelector('.agent-map[data-live]'),from,to);pulseMarker(document.querySelector('.street-map[data-live]'),from)},i*380));
}
let demoTimer=null;
function startDemoLoop(){clearInterval(demoTimer);const steps=[['Caller','You'],['You','Fire'],['Fire','You'],['You','EMS'],['EMS','You']];let i=0;demoTimer=setInterval(()=>{const svg=document.querySelector('.agent-map[data-demo]');if(!svg)return clearInterval(demoTimer);pulse(svg,...steps[i++%steps.length])},1400)}

// ---------- Trainee ----------
const goals=()=>info?.goals||[];
const firstName=n=>String(n||'').split(' ')[0];
function goalsHtml(){return goals().length?`<section class="card goals-card" aria-labelledby="goals-title"><h2 id="goals-title">Your goals on every call</h2><ul class="goal-list">${goals().map(g=>`<li><strong>${esc(g.label)}</strong><span>${esc(g.target)}</span></li>`).join('')}</ul><p class="note">You see how you did after each call ends, never during it.</p></section>`:''}
function welcome(){
 const hasProgress=!!traineeName&&myRuns().length>0;
 app.innerHTML=header('<span class="chip">Training demo</span>')+`<main class="welcome">
 <section class="card welcome-card">
  <p class="kicker">Dispatcher practice</p>
  <h1>Take the call. Keep the record. Send help.</h1>
  <p class="lead">Every run is a new situation. Talk with the caller, message Fire and EMS when you decide to, and keep your own incident record.</p>
  <form id="start-form"><label for="trainee-name">Your name</label><p class="field-help${needName?' needed':''}" id="name-help">${needName?'Please add your name first. ':''}Your instructor sees this name next to your calls.</p><input id="trainee-name" autocomplete="name" maxlength="60" required aria-describedby="name-help" value="${esc(traineeName)}" placeholder="First and last name"><button class="primary big">Start a situation</button></form>
  ${hasProgress?`<p class="progress-link"><button class="link-btn" data-act="progress">See your progress, ${esc(firstName(traineeName))}</button></p>`:''}
  <p class="fineprint">Fictional training only. Nothing here is real emergency guidance.</p>
 </section>
 <div class="welcome-side">${goalsHtml()}
 <section class="how" aria-labelledby="how-title">
  <h2 id="how-title">How it works</h2>
  <div class="card how-map">${agentMap({demo:true})}</div>
  <ol class="steps"><li>You get a <strong>new situation</strong> each time.</li><li>The <strong>caller agent</strong> tells you what is happening.</li><li><strong>You</strong> keep the incident record and message the caller, Fire or EMS.</li><li>The <strong>Fire and EMS agents</strong> act on exactly what you sent them.</li><li>When the call ends you see the <strong>outcome</strong>, and your instructor can add feedback.</li></ol>
 </section></div></main>
 <footer class="sitefoot"><a href="/instructor">Instructor dashboard</a></footer>`;
 document.querySelector('#start-form').onsubmit=async e=>{e.preventDefault();const name=document.querySelector('#trainee-name').value.trim();if(!name||busy)return;traineeName=name;store.set('rr-trainee-name',name);needName=false;shift=[];tabStore.set('rr-shift',shift);busy=true;try{await startSituation()}catch(e){error(e)}finally{busy=false}};
 if(!traineeName||needName)document.querySelector('#trainee-name').focus();
 startDemoLoop();
}
async function startSituation(){
 const created=await api('sessions',{name:traineeName,avoid:recent});
 recent=[...recent.filter(v=>v!==created.version),created.version].slice(-6);store.set('rr-recent',recent);
 shift=[...shift,{id:created.id,token:created.token,title:created.title}];tabStore.set('rr-shift',shift);
 history=[...history,{id:created.id,token:created.token,name:traineeName,title:created.title,version:created.version,at:Date.now()}].slice(-80);store.set('rr-history',history);
 showSummary=false;showProgress=false;tabStore.del('rr-summary');lastSaved=null;
 session=created;setAuth({id:created.id,token:created.token});incomingUntil=Date.now()+4500;render();
 document.querySelector('#draft')?.focus();
}
// Every run is tied to a name. Without one (e.g. an old saved run), ask for it before the next situation.
async function askForName(){if(session&&session.status!=='ended')await action('end');setAuth(null);session=null;showSummary=false;showProgress=false;needName=true;render()}
async function nextSituation(){if(busy)return;busy=true;try{if(!traineeName)return await askForName();if(session?.status!=='ended')await action('end',{reason:'next'});clearDrafts();await startSituation()}catch(e){error(e)}finally{busy=false}}
async function finishCall(){if(busy)return;busy=true;try{if(session&&session.status!=='ended')await action('end');render();scrollTo(0,0)}catch(e){error(e)}finally{busy=false}}
async function endSession(){if(busy)return;busy=true;try{if(session&&session.status!=='ended')await action('end');clearDrafts();setAuth(null);session=null;showSummary=true;tabStore.set('rr-summary',true);render()}catch(e){error(e)}finally{busy=false}}
async function restartSession(){if(busy)return;busy=true;try{if(!traineeName)return await askForName();shift=[];tabStore.set('rr-shift',shift);await startSituation()}catch(e){error(e)}finally{busy=false}}
function changeName(){traineeName='';store.del('rr-trainee-name');shift=[];tabStore.set('rr-shift',shift);showSummary=false;showProgress=false;tabStore.del('rr-summary');setAuth(null);session=null;render()}
function render(){
 if(session?.status!=='active'&&speechAvailable)window.speechSynthesis.cancel();
 if(isInstructor)return renderInstructor();
 if(showSummary)return summaryScreen();
 if(showProgress)return progressScreen(false);
 if(!session)return welcome();
 if(session.status==='ended')return ended();
 consoleScreen();
}
const timerText=()=>`${time(session.elapsed)}${session.endAt?` <span class="limit">/ ${time(session.endAt)}</span>`:''}`;
function updateTimer(){const t=document.querySelector('#timer');if(t)t.innerHTML=timerText()}
function recordStatus(){if(FIELDS.some(([k])=>recordDrafts[k]!==undefined&&recordDrafts[k]!==session.record[k]))return 'Not saved yet';return lastSaved?.id===session.id?`Saved at ${time(lastSaved.at)}`:''}
// After a call ends: the outcome (judged on what was actually sent and recorded) and this call's goals.
function endedCard(){
 const reason=session.events.findLast(e=>e.kind==='ended')?.data.reason;
 const why={time_limit:'The time limit was reached',instructor:'Your instructor ended this call',next:'You moved on'}[reason]||'You finished this call';
 const o=session.outcome,p=session.performance;
 const goalRows=goalChecks(p);
 return `<div class="ended-card"><section class="card outcome-card" role="status">
  <div class="outcome-main"><p class="kicker">${esc(why)}</p>${o?outcomeBadge(o.result):''}<h2>${esc(o?.headline||'This call has ended.')}</h2>${o?.lines?.length?`<ul class="outcome-lines">${o.lines.map(l=>`<li>${esc(l)}</li>`).join('')}</ul>`:''}${o?.note?`<p class="outcome-note">${esc(o.note)}</p>`:''}${o&&o.result!=='incomplete'?`<p class="note">${esc(o.rule)}</p>`:''}</div>
  ${goalRows?`<div class="outcome-goals"><h3>Goals on this call</h3><ul class="checks">${goalRows}</ul></div>`:''}
  <div class="actions outcome-actions"><button class="secondary" data-act="end-session">End session</button><button class="primary" data-act="next">New situation</button></div></section></div>`;
}
function consoleScreen(){
 lastMessages='';
 const isEnded=session.status==='ended',paused=session.status==='paused',locked=isEnded||paused;
 const number=Math.max(1,shift.findIndex(x=>x.id===session.id)+1);
 const right=(traineeName?`<span class="chip name-chip">${esc(traineeName)}</span>`:'')+(isEnded?'':`<button class="ghost" id="voice" aria-pressed="false">Read aloud: off</button><button class="ghost" id="pause">${paused?'Resume':'Pause'}</button>`);
 const center=`<div class="call-meta"><span class="call-label">Situation ${number}</span><span class="call-title">${esc(session.title||'')}</span><span class="timer" id="timer">${timerText()}</span></div>`;
 app.innerHTML=header(right,center)+(paused?'<div class="notice" role="status">Paused. The clock and all messages are on hold.</div>':'')+(isEnded?endedCard():'')+`<main class="console has-map">
 <section class="card mapcard" aria-label="Map"><div class="card-head"><div><h2>Map</h2><p class="card-sub">Units go where you send them. Updates appear as they happen.</p></div></div><div id="street-map"></div></section>
 <section class="card convo" aria-label="Conversation">
  <div class="feed" id="messages" role="log" aria-live="off" aria-label="Messages" tabindex="0"></div>
  <form id="composer" class="composer"><fieldset ${locked?'disabled':''}><legend>Send to</legend>
   <div class="send-to">${['Caller','Fire','EMS'].map(c=>`<button type="button" class="to" data-to="${c}" aria-pressed="${recipient===c}">${c}</button>`).join('')}</div>
   <label for="draft" class="sr-only" id="draft-label">Message to ${esc(recipient)}</label>
   <div class="compose-row"><textarea id="draft" rows="2" maxlength="4000" placeholder="Message to ${esc(recipient)}…">${esc(draft)}</textarea><button id="send" class="primary">Send</button></div>
   <p class="compose-help">Enter sends. Shift + Enter starts a new line.</p>
  </fieldset></form>
 </section>
 <aside class="side">
  <section class="card"><div class="card-head"><div><h2>Incident record</h2><p class="card-sub">Only you fill this in. <span id="record-status" role="status">${recordStatus()}</span></p></div><button class="secondary" id="save-record" form="record-form" ${locked?'disabled':''}>Save record</button></div>
   <form id="record-form"><fieldset class="record-form" ${locked?'disabled':''}>
    ${FIELDS.map(([k,label])=>`<div><label for="${k}">${label}</label>${k==='notes'?`<textarea id="${k}" rows="2">${esc(recordDrafts[k]??session.record[k])}</textarea>`:`<input id="${k}" autocomplete="off" value="${esc(recordDrafts[k]??session.record[k])}">`}</div>`).join('')}
   </fieldset></form>
  </section>
 </aside></main>
 <div class="nextbar" id="nextbar"></div>
 <div id="announce" class="sr-only" aria-live="polite"></div>
 <p class="connection" id="connection" role="status">${esc(connection)}</p>`;
 updateVoiceButton();
 const voice=document.querySelector('#voice');if(voice)voice.onclick=()=>{voiceOn=!voiceOn;if(speechAvailable)window.speechSynthesis.cancel();voiceCursor=session.events.at(-1)?.seq||0;updateVoiceButton();if(voiceOn){const latest=session.events.findLast(e=>['message','ack'].includes(e.kind)&&['Caller','Fire','EMS'].includes(e.data.from));if(latest)speakMessage(latest)}};
 document.querySelectorAll('.to').forEach(b=>b.onclick=()=>{recipient=b.dataset.to;store.set(draftKey('to'),recipient);document.querySelectorAll('.to').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));const box=document.querySelector('#draft');box.placeholder=`Message to ${recipient}…`;document.querySelector('#draft-label').textContent=`Message to ${recipient}`;box.focus()});
 const box=document.querySelector('#draft');
 box.oninput=()=>{draft=box.value;store.set(draftKey('draft'),draft)};
 box.onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();document.querySelector('#composer').requestSubmit()}};
 document.querySelector('#composer').onsubmit=async e=>{e.preventDefault();if(busy||!draft.trim())return;busy=true;const sentText=draft,sendButton=document.querySelector('#send');sendButton.disabled=true;try{if(await action('send',{to:recipient,text:sentText})&&draft===sentText){draft='';store.del(draftKey('draft'));const input=document.querySelector('#draft');if(input)input.value=''}paintMessages()}catch(e){error(e)}finally{busy=false;sendButton.disabled=false;document.querySelector('#draft')?.focus()}};
 for(const [k] of FIELDS){const el=document.getElementById(k);el.oninput=()=>{recordDrafts[k]=el.value;store.set(draftKey('record-drafts'),recordDrafts);document.querySelector('#record-status').textContent=recordStatus()}}
 document.querySelector('#record-form').onsubmit=e=>{e.preventDefault();saveRecord()};
 const pause=document.querySelector('#pause');if(pause)pause.onclick=async()=>{try{if(await action(session.status==='paused'?'resume':'pause')){render();document.querySelector('#pause')?.focus()}}catch(e){error(e)}};
 paintMessages();
}
async function saveRecord(){
 const status=document.querySelector('#record-status');
 const changes=FIELDS.map(([k])=>[k,document.getElementById(k).value]).filter(([k,v])=>v!==session.record[k]);
 if(!changes.length){status.textContent='Nothing new to save.';return}
 if(busy)return;busy=true;const button=document.querySelector('#save-record');button.disabled=true;
 try{for(const [field,value] of changes){if(!await action('record',{field,value}))return;if(recordDrafts[field]===value)delete recordDrafts[field]}store.set(draftKey('record-drafts'),recordDrafts);lastSaved={id:session.id,at:session.elapsed};document.querySelector('#record-status').textContent=recordStatus()}catch(e){error(e)}finally{busy=false;const b=document.querySelector('#save-record');if(b)b.disabled=false}
}
function paintNextBar(){const bar=document.querySelector('#nextbar');if(!bar)return;const show=session.status!=='ended'&&session.events.some(e=>e.kind==='message'&&e.data.from==='Dispatcher');const html=show?'<span>Whenever you’re ready</span><button class="secondary" data-act="end-session">End session</button><button class="primary" data-act="finish">Finish call</button>':'';if(bar.innerHTML!==html)bar.innerHTML=html}
// Screen readers hear only newly arrived external messages (neutral content, same as on screen), not the whole list on every poll.
let announceCursor={id:null,seq:0};
function announceNew(){const latest=session.events.at(-1)?.seq||0;if(announceCursor.id!==session.id){announceCursor={id:session.id,seq:latest};return}const fresh=session.events.filter(e=>e.seq>announceCursor.seq&&['message','ack'].includes(e.kind)&&['Caller','Fire','EMS'].includes(e.data.from));announceCursor.seq=latest;const el=document.querySelector('#announce');if(el&&fresh.length)el.textContent=fresh.map(e=>`${e.data.from}: ${e.data.text}`).join('. ')}
function paintMap(){if(session?.map)mountMap(document.querySelector('#street-map'),session.map.spec,session.map.state,session.id)}
let lastMessages='';function paintMessages(){processVoice();announceNew();animateAgents();paintNextBar();updateTimer();paintMap();const el=document.querySelector('#messages');if(!el)return;
 const replied=new Set(session.events.filter(e=>e.kind==='ack').map(e=>e.data.messageId));
 const bubble=(cls,who,e,extra='')=>`<article class="bubble ${cls}"><div class="who"><span>${esc(who)}</span><time>${time(e.time)}</time></div><p>${esc(e.data.text)}</p>${extra}</article>`;
 const html=(Date.now()<incomingUntil?'<div class="incoming">New call · the caller is on the line</div>':'')+session.events.filter(e=>['message','ack'].includes(e.kind)).map(e=>e.kind==='ack'?bubble('unit',e.data.from,e):e.data.from==='Dispatcher'?bubble('mine',`You → ${e.data.to}`,e,`<p class="status">Delivered${replied.has(e.data.id)?` · ${esc(e.data.to)} replied`:''}</p>`):bubble('caller','Caller',e)).join('');
 if(html!==lastMessages){lastMessages=html;const bottom=el.scrollHeight-el.scrollTop-el.clientHeight<120;el.innerHTML=html;if(bottom)el.scrollTop=el.scrollHeight}}
// Returns true only if the response still belongs to this tab's current session; a late reply for a session this tab has left is dropped.
// Retry IDs are per tab, so two tabs on one session never deduplicate each other's intentional sends.
async function action(action,data={}){
 const {id,token}=auth,storageKey='rr-request-'+id+'-'+action;
 const previous=tabStore.get(storageKey);
 const payload=previous&&JSON.stringify(previous.data)===JSON.stringify(data)?previous:{action,data,key:crypto.randomUUID()};
 tabStore.set(storageKey,payload);
 let next;try{next=await api('sessions/'+id,payload,token)}catch(e){if(e.status)tabStore.del(storageKey);throw e}
 tabStore.del(storageKey);
 if(auth?.id!==id)return false;
 session=next;paintMessages();return true;
}
function ended(){consoleScreen()}
async function summaryScreen(){return progressScreen(true)}
const tile=(num,label)=>`<div class="stat"><span class="num">${num}</span><span class="lbl">${label}</span></div>`;
function shiftItem(v){const sent=v.events.filter(e=>e.kind==='message'&&e.data.from==='Dispatcher').length;return `<div class="shift-head"><strong>${esc(v.title||'Situation')}</strong>${v.outcome?outcomeBadge(v.outcome.result):''}</div>${v.outcome?`<p>${esc(v.outcome.headline)}</p>`:''}<p class="muted">${time(v.elapsed)} on the call · ${sent} message${sent===1?'':'s'} sent</p>${v.review?`<p class="feedback-label">Feedback from your instructor</p><p class="feedback-text">${esc(v.review)}</p>`:'<p class="muted">Instructor feedback: not yet.</p>'}`}
// Progress across every call this device has run under this name: focus areas, goal rates and tasks.
function progressHtml(runs){
 const done=finished(runs);
 if(!done.length)return '<p class="muted">Finish a call to start tracking your progress.</p>';
 const s=summarize(done),f=focusAreas(done,goals()),t=tasks(done);
 return `<h2 class="section-title">Your progress</h2><p class="note">From ${s.calls} finished call${s.calls===1?'':'s'} on this device. These are automatic checks of what you sent and recorded.</p>
 <div class="stats">${tile(s.calls,'calls finished')}${tile(s.successes,'successes')}${tile(s.successRate==null?'—':s.successRate+'%','success rate')}${tile(seconds(s.medianFirst),'typical first dispatch')}</div>
 <div class="progress-grid">
  <section class="card"><h2>Practice next</h2>${f.focus.length?`<ul class="focus-list">${f.focus.map(x=>`<li><strong>${esc(x.label)}</strong><p>${esc(x.text)}</p></li>`).join('')}</ul>`:`<p class="muted">${esc(f.note)}</p>`}${f.strengths.length?`<h3 class="sub">Going well</h3><ul class="strength-list">${f.strengths.map(x=>`<li><span class="glyph" aria-hidden="true">✓</span><span><strong>${esc(x.label)}</strong> <span class="muted">${esc(x.text)}</span></span></li>`).join('')}</ul>`:''}</section>
  <section class="card"><h2>Your goals</h2>${goalBars(goalRates(done,goals()))}</section>
  <section class="card"><h2>Tasks</h2><ul class="task-list">${t.map(x=>`<li class="${x.done?'done':''}"><span class="glyph" aria-hidden="true">${x.done?'✓':'○'}</span><span>${esc(x.label)}</span><span class="muted">${x.have} of ${x.need}</span></li>`).join('')}</ul></section>
 </div>`;
}
async function progressScreen(sessionDone){
 const name=firstName(traineeName);
 app.innerHTML=header('<span class="chip">Training demo</span>')+`<main class="narrow wide">
 ${sessionDone?`<p class="kicker">Session complete</p><h1>Thanks${name?', '+esc(name):''}.</h1><p class="lead">You worked through ${shift.length} situation${shift.length===1?'':'s'}. Here’s how each call went. Your instructor may add feedback too.</p><ol class="shift-list" id="shift-list">${shift.map(s=>`<li data-id="${esc(s.id)}"><strong>${esc(s.title||'Situation')}</strong><p class="muted">Loading…</p></li>`).join('')}</ol>`:`<p class="kicker">Your progress</p><h1>${esc(traineeName)}</h1>`}
 <section id="progress" aria-live="polite"><p class="muted">Loading your progress…</p></section>
 <div class="actions">${sessionDone?'<button class="primary big" data-act="restart">Start a new session</button>':'<button class="primary big" data-act="restart">Start a situation</button><button class="secondary" data-act="home">Back</button>'}${name?`<button class="secondary" data-act="change-name">I’m not ${esc(name)}</button>`:''}</div></main>`;
 const refs=[...myRuns(),...shift.filter(s=>!history.some(h=>h.id===s.id))],runs=[];
 for(const ref of refs){try{const v=await api('sessions/'+ref.id,null,ref.token);runs.push(v);const li=document.querySelector(`#shift-list li[data-id="${ref.id}"]`);if(li)li.innerHTML=shiftItem(v)}catch{}}
 const el=document.querySelector('#progress');if(el)el.innerHTML=progressHtml(runs);
}

// ---------- Instructor ----------
let inst={view:'runs',runs:[],filter:'',runId:null,run:null,scrub:null,situations:[],libraryOpen:false,trainee:null};
let scenarioList=[],creaoState={connected:false,generations:[]},importRun=null,revisedFrom=null;
const when=ms=>ms?new Date(ms).toLocaleString([],{weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):'';
const END_REASON={time_limit:'Time limit reached',instructor:'Ended by an instructor',next:'Moved on to a new situation',trainee:'Ended by the trainee'};
const nameOf=r=>r.trainee||'Unnamed trainee';
function instHeader(){return header('<button class="ghost" id="lock">Lock</button>',`<nav class="tabs" aria-label="Instructor sections"><button data-view="runs" aria-current="${inst.view!=='library'}">Runs</button><button data-view="library" aria-current="${inst.view==='library'}">Situations</button></nav>`)}
function bindInstHeader(){document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>{inst.view=b.dataset.view;inst.run=null;renderInstructor()});document.querySelector('#lock').onclick=()=>{adminKey='';tabStore.del('rr-admin');inst.view='runs';inst.run=null;renderInstructor()}}
async function renderInstructor(){
 if(!adminKey)return instLogin();
 try{if(inst.view==='run'&&inst.run)return runScreen();if(inst.view==='trainee'&&inst.trainee)return traineeScreen();if(inst.view==='library')return await libraryScreen();inst.view='runs';await runsScreen()}
 catch(e){if(e.status===403){adminKey='';tabStore.del('rr-admin');return instLogin()}error(e)}
}
function instLogin(){
 app.innerHTML=header('')+`<main class="narrow"><section class="card login"><p class="kicker">Instructor</p><h1>See every run</h1><p class="lead">Each trainee’s situations, what they recorded and sent, and a place to give feedback.</p><form id="login"><label for="admin-key">Instructor key</label><input id="admin-key" type="password" autocomplete="current-password" required><button class="primary big">Open dashboard</button></form><p class="fineprint">The key is in the app folder, in the file named .instructor-key.</p></section></main>`;
 document.querySelector('#login').onsubmit=async e=>{e.preventDefault();const key=document.querySelector('#admin-key').value.trim();try{await api('sessions',null,key);adminKey=key;tabStore.set('rr-admin',key);inst.view='runs';renderInstructor()}catch(e){error(e.status===403?'That key didn’t work. Check the .instructor-key file and try again.':e)}};
 document.querySelector('#admin-key').focus();
}
// Goal results for one call, shared by the trainee's outcome card and the instructor's run view.
function goalChecks(p){if(!p)return '';const extra=g=>g.id==='fastDispatch'&&p.metrics.firstDispatchMs!=null?` · ${seconds(p.metrics.firstDispatchMs)}`:g.id==='quickRelay'&&p.metrics.relayMs!=null?` · ${seconds(p.metrics.relayMs)}`:'';return goals().map(g=>{const v=p.goals[g.id];return `<li><span class="glyph ${v===true?'':v===false?'no':'info'}" aria-hidden="true">${v===true?'✓':v===false?'–':'·'}</span><span><strong>${esc(g.label)}</strong> <span class="muted">${v===true?'Met':v===false?'Not met':'Not counted on this call'}${extra(g)}</span></span></li>`}).join('')}
const goalsMetText=r=>{const g=r.performance?.goals;if(!g)return '—';const vals=Object.values(g).filter(v=>v!==null);return vals.length?`${vals.filter(Boolean).length} of ${vals.length}`:'—'};
const outcomeCell=r=>r.status!=='ended'?`<span class="status-chip live">${r.status==='paused'?'Paused':'Live'}</span>`:r.outcome?outcomeBadge(r.outcome.result):'—';
const feedbackChip=r=>r.released?'<span class="status-chip">Released</span>':r.reviews?'<span class="status-chip">Draft</span>':r.status==='ended'?'<span class="status-chip">To review</span>':'';
async function runsScreen(fetched){
 inst.runs=fetched||await api('sessions',null,adminKey);
 const names=[...new Set(inst.runs.map(nameOf))].sort();
 if(inst.filter&&!names.includes(inst.filter))inst.filter='';
 const runs=inst.runs.filter(r=>!inst.filter||nameOf(r)===inst.filter),s=summarize(runs);
 const people=names.filter(n=>!inst.filter||n===inst.filter).map(n=>{const mine=inst.runs.filter(r=>nameOf(r)===n),sm=summarize(mine),f=focusAreas(mine,goals());return {name:n,live:mine.some(r=>r.status!=='ended'),...sm,focus:f.focus[0]?.label||(sm.calls>=2?'On track':'Needs more calls')}});
 app.innerHTML=instHeader()+`<main class="dash">
 <div class="dash-head"><div><h1>Runs</h1><p class="lead">Every situation a trainee works through. Open a trainee for their progress graphs, or a run to see exactly what happened.</p></div>
  <div class="filter"><label for="trainee-filter">Show</label><select id="trainee-filter"><option value="">All trainees</option>${names.map(n=>`<option ${n===inst.filter?'selected':''}>${esc(n)}</option>`).join('')}</select></div></div>
 <section class="stats" aria-label="Summary">${tile(runs.length,runs.length===1?'run':'runs')}${inst.filter?'':tile(names.length,names.length===1?'trainee':'trainees')}${tile(runs.filter(r=>r.status!=='ended').length,'running now')}${tile(s.successRate==null?'—':s.successRate+'%','success rate')}${tile(seconds(s.medianFirst),'typical first dispatch')}</section>
 <div class="dash-grid">
  <section class="card"><h2>Trainees</h2><p class="card-sub">Open a trainee for graphs and what to practice next.</p>${people.length?`<div class="table-wrap"><table><thead><tr><th>Trainee</th><th>Calls</th><th>Success rate</th><th>Practice next</th></tr></thead><tbody>${people.map(t=>`<tr data-trainee="${esc(t.name)}"><td><button class="link-btn" data-trainee-open="${esc(t.name)}">${esc(t.name)}</button>${t.live?' <span class="status-chip live">Live</span>':''}</td><td>${t.calls}</td><td>${t.successRate==null?'—':t.successRate+'%'}</td><td>${esc(t.focus)}</td></tr>`).join('')}</tbody></table></div>`:'<p class="empty">No trainees yet.</p>'}</section>
  <section class="card"><h2>Goals${inst.filter?` for ${esc(inst.filter)}`:' across all trainees'}</h2>${goalBars(goalRates(runs,goals()))}</section>
 </div>
 <p class="note">Outcomes, goals and focus areas come from automatic checks of what each trainee sent and recorded. Use them to decide what to review, and confirm against the run before giving feedback.</p>
 <section class="card"><h2>All runs</h2>${runs.length?`<div class="table-wrap"><table><thead><tr><th>Trainee</th><th>Situation</th><th>Difficulty</th><th>Started</th><th>Length</th><th>Outcome</th><th>Goals met</th><th>How it ended</th><th>Feedback</th></tr></thead><tbody>${runs.map(r=>`<tr data-run="${esc(r.id)}"><td><button class="link-btn" data-open="${esc(r.id)}">${esc(nameOf(r))}</button></td><td>${esc(r.title)}</td><td>${esc(LEVEL_LABEL[r.difficulty]||'—')}</td><td>${esc(when(r.created))}</td><td>${time(r.elapsed)}</td><td>${outcomeCell(r)}</td><td>${goalsMetText(r)}</td><td>${r.status==='ended'?esc(END_REASON[r.observations.ended?.reason]||'Ended'):''}</td><td>${feedbackChip(r)}</td></tr>`).join('')}</tbody></table></div>`:`<p class="empty">No runs yet. When a trainee starts a situation at ${esc(location.origin)}, it appears here on its own.</p>`}</section></main>`;
 bindInstHeader();
 document.querySelector('#trainee-filter').onchange=e=>{inst.filter=e.target.value;runsScreen().catch(error)};
 document.querySelectorAll('tr[data-run]').forEach(tr=>tr.onclick=()=>openRun(tr.dataset.run).catch(error));
 document.querySelectorAll('tr[data-trainee]').forEach(tr=>tr.onclick=()=>openTrainee(tr.dataset.trainee));
}
// One trainee's progress: graphs over their finished calls, goal rates, and focus areas with the evidence behind them.
function openTrainee(name){inst.view='trainee';inst.trainee=name;traineeScreen();scrollTo(0,0)}
function traineeScreen(){
 const name=inst.trainee,mine=inst.runs.filter(r=>nameOf(r)===name),done=finished(mine),s=summarize(mine),f=focusAreas(mine,goals());
 const recent=done.slice(-20),offset=done.length-recent.length,relayRuns=recent.filter(r=>r.performance.metrics.correctionHeard);
 const label=r=>r.outcome.result==='success'?'Success':r.outcome.result==='failure'?'Failure':'No outcome';
 const firstChart=columnChart({points:recent.map((r,i)=>({value:r.performance.metrics.firstDispatchMs,title:`Call ${offset+i+1}, ${r.title}`})),goalMs:30000,label:`Seconds to first Fire or EMS message in each of ${name}’s last ${recent.length} calls`,emptyText:'no message to Fire or EMS'});
 const relayChart=columnChart({points:relayRuns.map(r=>({value:r.performance.metrics.relayMs,title:`Call ${offset+recent.indexOf(r)+1}, ${r.title}`})),goalMs:45000,label:`Seconds to relay the caller’s change to every unit, ${name}’s recent calls`,emptyText:'the change never reached every unit'});
 const cell=v=>v===true?'<span class="mark" aria-label="Met">✓</span>':v===false?'<span class="mark no" aria-label="Not met">–</span>':'<span class="muted">n/a</span>';
 app.innerHTML=instHeader()+`<main class="dash">
 <button class="back" id="back-runs">← All runs</button>
 <div class="run-head"><div><p class="kicker">Trainee</p><h1>${esc(name)}</h1><p class="lead">${s.calls} finished call${s.calls===1?'':'s'}${mine.some(r=>r.status!=='ended')?', and one running now':''}.</p></div></div>
 <section class="stats" aria-label="Summary">${tile(s.calls,'calls finished')}${tile(s.successRate==null?'—':s.successRate+'%','success rate')}${tile(seconds(s.medianFirst),'typical first dispatch')}${tile(seconds(s.medianRelay),'typical time to relay a change')}${['easy','standard','hard'].map(l=>{const judged=done.filter(r=>r.difficulty===l&&r.outcome.result!=='incomplete');return judged.length?tile(`${judged.filter(r=>r.outcome.result==='success').length} of ${judged.length}`,`${LEVEL_LABEL[l]} calls succeeded`):''}).join('')}</section>
 <div class="dash-grid">
  <section class="card"><h2>Practice next</h2>${f.focus.length?`<ul class="focus-list">${f.focus.map(x=>`<li><strong>${esc(x.label)}</strong><p>${esc(x.text)}</p></li>`).join('')}</ul>`:`<p class="muted">${esc(f.note)}</p>`}${f.strengths.length?`<h3 class="sub">Going well</h3><ul class="strength-list">${f.strengths.map(x=>`<li><span class="glyph" aria-hidden="true">✓</span><span><strong>${esc(x.label)}</strong> <span class="muted">${esc(x.text)}</span></span></li>`).join('')}</ul>`:''}</section>
  <section class="card"><h2>Goals</h2>${goalBars(goalRates(mine,goals()))}</section>
 </div>
 <section class="card chart-card"><h2>Outcome of each call</h2><p class="card-sub">Oldest on the left. Hover a mark to see the situation.</p>${done.length?outcomeStrip(done,(r,i)=>`Call ${i+1}, ${r.title}: ${label(r)}`):'<p class="empty">No finished calls yet.</p>'}</section>
 <div class="dash-grid">
  <section class="card chart-card"><h2>Time to first Fire or EMS message</h2><p class="card-sub">Seconds from the start of each call. The line is the 30 second goal.</p>${recent.length?firstChart:'<p class="empty">No finished calls yet.</p>'}</section>
  <section class="card chart-card"><h2>Time to relay the caller’s change</h2><p class="card-sub">Seconds from the caller’s correction until every unit sent had it. An × means it never reached every unit.</p>${relayRuns.length?relayChart:'<p class="empty">No calls reached the caller’s correction yet.</p>'}</section>
 </div>
 <section class="card"><h2>Calls</h2><p class="card-sub">The numbers behind the graphs. Open a call to see its full timeline.</p>${done.length?`<div class="table-wrap"><table><thead><tr><th>#</th><th>Situation</th><th>Difficulty</th><th>Started</th><th>Outcome</th><th>First dispatch</th><th>Relay time</th><th>Record correct</th><th>Right place</th></tr></thead><tbody>${done.map((r,i)=>({r,i})).reverse().map(({r,i})=>`<tr data-run="${esc(r.id)}"><td>${i+1}</td><td><button class="link-btn" data-open="${esc(r.id)}">${esc(r.title)}</button></td><td>${esc(LEVEL_LABEL[r.difficulty]||'—')}</td><td>${esc(when(r.created))}</td><td>${outcomeBadge(r.outcome.result)}</td><td>${seconds(r.performance.metrics.firstDispatchMs)}</td><td>${r.performance.metrics.correctionHeard?seconds(r.performance.metrics.relayMs):'n/a'}</td><td>${cell(r.performance.goals.accurateRecord)}</td><td>${cell(r.performance.goals.rightPlace)}</td></tr>`).join('')}</tbody></table></div>`:'<p class="empty">No finished calls yet.</p>'}</section></main>`;
 bindInstHeader();
 document.querySelector('#back-runs').onclick=()=>{inst.view='runs';renderInstructor()};
 document.querySelectorAll('tr[data-run]').forEach(tr=>tr.onclick=()=>openRun(tr.dataset.run).catch(error));
}
async function openRun(id){inst.runId=id;inst.scrub=null;inst.view='run';await loadRun()}
async function loadRun(){inst.run=await api('sessions/'+inst.runId+'/review',null,adminKey);runScreen()}
function describe(e,r){
 const t=(r.trainee||'Trainee').split(' ')[0],o=r.observations;
 switch(e.kind){
  case 'started':return {who:'Call started',cls:'sys'};
  case 'message':if(e.data.from==='Caller')return {who:'Caller',say:e.data.text,cls:'caller',tag:e.seq===r.events.find(x=>x.kind==='message'&&x.data.from==='Caller')?.seq?'First report':e.time===o.correctionAt?'Correction':''};return {who:`${t} → ${e.data.to}`,say:e.data.text,cls:'mine'};
  case 'ack':return {who:`${e.data.from} replied`,text:e.data.text,cls:'unit'};
  case 'record':return {who:`${t} updated the record`,text:`${FIELD_LABEL[e.data.field]||e.data.field}: ${e.data.value?`“${e.data.value}”`:'(cleared)'}`,cls:'record'};
  case 'paused':return {who:'Paused',cls:'sys'};
  case 'resumed':return {who:'Resumed',cls:'sys'};
  case 'ended':{const n=e.data.cancelledAcknowledgments?.length||0;return {who:END_REASON[e.data.reason||'trainee']||'Ended',text:n?`${n} repl${n===1?'y was':'ies were'} still on the way.`:'',cls:'sys'}}
  default:return {who:e.kind,cls:'sys'};
 }
}
// Instructor replay: the map at that moment, with the actual location marked.
function replayMap(r,t){try{const spec=buildMap(r.scenario);return `<div class="replay-map">${renderMap(spec,mapState(spec,r.events,t),{instructor:true})}</div>`}catch{return ''}}
function snapshotHtml(r,idx){
 const evs=r.events.slice(0,idx+1),rec={location:'',entrance:'',caller:'',notes:''},told={Fire:[],EMS:[]},counts={},add=k=>counts[k]=(counts[k]||0)+1;
 for(const e of evs){if(e.kind==='record')rec[e.data.field]=e.data.value;if(e.kind==='message'){if(e.data.from==='Dispatcher'){told[e.data.to]?.push(e.data.text);add('You>'+e.data.to)}else add(e.data.from+'>You')}if(e.kind==='ack')add(e.data.from+'>You')}
 const list=a=>a.length?`<ul>${a.map(x=>`<li>“${esc(x)}”</li>`).join('')}</ul>`:'<p class="muted">Nothing yet.</p>';
 return `${replayMap(r,evs.at(-1)?.time||0)}${agentMap({counts})}<table class="compare"><thead><tr><th scope="col"><span class="sr-only">Field</span></th><th scope="col">What really happened</th><th scope="col">Trainee’s record</th></tr></thead><tbody><tr><th scope="row">Location</th><td>${esc(r.scenario.truth.location)}</td><td>${esc(rec.location)||'—'}</td></tr><tr><th scope="row">Entrance, unit or side</th><td>${esc(r.scenario.truth.entrance)}</td><td>${esc(rec.entrance)||'—'}</td></tr>${rec.caller?`<tr><th scope="row">Caller</th><td></td><td>${esc(rec.caller)}</td></tr>`:''}${rec.notes?`<tr><th scope="row">Notes</th><td></td><td>${esc(rec.notes)}</td></tr>`:''}</tbody></table><div class="knows"><h3>Fire has been sent</h3>${list(told.Fire)}<h3>EMS has been sent</h3>${list(told.EMS)}</div>`;
}
function outcomeHtml(r){const o=r.outcome;if(r.status!=='ended'||!o)return '';const first=nameOf(r).split(' ')[0];const checks=goalChecks(r.performance);return `<section class="card outcome-card instructor-outcome"><div class="outcome-main"><p class="kicker">Outcome ${esc(first)} saw</p>${outcomeBadge(o.result)}<h2>${esc(o.headline)}</h2>${o.lines?.length?`<ul class="outcome-lines">${o.lines.map(l=>`<li>${esc(l)}</li>`).join('')}</ul>`:''}${o.note?`<p class="outcome-note">${esc(o.note)}</p>`:''}${o.result!=='incomplete'?`<p class="note">${esc(o.rule)}</p>`:''}</div>${checks?`<div class="outcome-goals"><h3>Goals on this call</h3><ul class="checks">${checks}</ul></div>`:''}</section>`}
function observationsHtml(r){
 const o=r.observations,k=o.keywords,row=(ok,html)=>`<li><span class="glyph ${ok===true?'':ok===false?'no':'info'}" aria-hidden="true">${ok===true?'✓':ok===false?'–':'•'}</span><span>${html}</span></li>`,items=[];
 items.push(row(null,o.correctionAt!==null?`The caller corrected a detail at <strong>${time(o.correctionAt)}</strong>.`:'The run ended before the caller’s correction.'));
 if(k.corrected){
  items.push(row(o.recordHasCorrected,o.recordHasCorrected?`Record includes “${esc(k.corrected)}”${o.recordCorrectedAt!==null?` (from ${time(o.recordCorrectedAt)})`:''}.`:`Record does not include “${esc(k.corrected)}”.`));
  if(o.recordHasOriginal)items.push(row(null,`Record still includes the first report (“${esc(k.original)}”).`));
  for(const u of ['Fire','EMS']){const x=o.units[u];items.push(row(x.correctedAt!==null,x.correctedAt!==null?`${u} was sent “${esc(k.corrected)}” at ${time(x.correctedAt)}.`:`${u} was not sent “${esc(k.corrected)}” (${x.sent} message${x.sent===1?'':'s'} to ${u}).`));if(x.originalAfterCorrection)items.push(row(null,`${u} was sent “${esc(k.original)}” after the correction.`))}
 }
 items.push(row(null,o.firstUnitMessageAt!==null?`First message to Fire or EMS at <strong>${time(o.firstUnitMessageAt)}</strong>.`:'No messages to Fire or EMS.'));
 items.push(row(null,`Replies received: Fire ${o.units.Fire.replies}, EMS ${o.units.EMS.replies}, caller ${o.units.Caller.replies}.`));
 return `<section class="card observations-card"><h2>Automatic observations</h2><p class="note">Keyword checks of the log${k.corrected?` (looking for “${esc(k.corrected)}”)`:''}. Use them to find moments worth reviewing, and confirm against the timeline. They are not a grade.</p><ul class="checks">${items.join('')}</ul></section>`;
}
function feedbackHtml(r){
 const name=nameOf(r),first=name.split(' ')[0],last=r.reviews?.at(-1);
 if(r.status!=='ended')return `<section class="card"><h2>Feedback</h2><p class="muted">You can write feedback once this run ends.</p><div class="actions"><button class="secondary" id="end-run">End this run now</button></div></section>`;
 return `<section class="card"><h2>Feedback for ${esc(first)}</h2>${r.released?`<p class="status-line">Released to ${esc(first)}.</p>`:last?'<p class="status-line">Draft saved. Not released yet.</p>':''}
 <form id="feedback-form" class="feedback-form"><div><label for="reviewer">Your name</label><input id="reviewer" maxlength="100" required value="${esc(store.get('rr-reviewer','')||last?.reviewer||'')}"></div><div><label for="feedback">What should ${esc(first)} know?</label><textarea id="feedback" rows="6" maxlength="10000" required>${esc(last?.text||'')}</textarea></div>
 <label class="check"><input type="checkbox" id="verified" required aria-label="I checked this against the timeline"> I checked this against the timeline</label>
 <div class="actions"><button type="button" class="secondary" id="save-draft">Save draft</button><button class="primary">Release to ${esc(first)}</button></div></form>
 ${r.reviews?.length?`<ul class="versions">${r.reviews.map(v=>`<li>Version ${v.version}: ${v.released?'released':'draft'} by ${esc(v.reviewer)}, ${esc(when(v.created))}</li>`).join('')}</ul>`:''}</section>`;
}
function runScreen(){
 const r=inst.run,evs=r.events,live=r.status!=='ended',summary=inst.runs.find(x=>x.id===r.id);
 const idx=inst.scrub===null||inst.scrub>=evs.length-1?evs.length-1:inst.scrub;
 app.innerHTML=instHeader()+`<main class="dash">
 <button class="back" id="back-runs">← All runs</button>
 <div class="run-head"><div><p class="kicker">${live?'Live now':'Finished'}${summary?.created?' · '+esc(when(summary.created)):''}${r.scenario?.difficulty?.label?' · '+esc(r.scenario.difficulty.label):''}</p><h1>${esc(nameOf(r))} · ${esc(r.title||'Situation')}</h1><p class="lead">${live?`Running for ${time(r.elapsed)}.`:`${time(r.elapsed)} long. ${esc(END_REASON[r.observations.ended?.reason]||'Ended')}.`}</p></div></div>
 ${outcomeHtml(r)}${observationsHtml(r)}
 <div class="run-grid">
  <section class="card"><h2>What happened</h2><div class="scrub"><label for="scrub">Replay up to a moment</label><input type="range" id="scrub" min="0" max="${evs.length-1}" value="${idx}"><output id="scrub-time" for="scrub">${time(evs[idx]?.time||0)}</output></div>
   <ol class="timeline" id="timeline">${evs.map((e,i)=>{const d=describe(e,r);return `<li class="${d.cls}${i>idx?' future':''}" data-i="${i}"><time>${time(e.time)}</time><div><span class="who">${esc(d.who)}${d.tag?`<span class="tag">${esc(d.tag)}</span>`:''}</span>${d.say?`<p class="say">“${esc(d.say)}”</p>`:''}${d.text?`<p class="say">${esc(d.text)}</p>`:''}</div></li>`}).join('')}</ol></section>
  <div class="run-side">${feedbackHtml(r)}<section class="card"><h2>At <span id="snap-time">${time(evs[idx]?.time||0)}</span></h2><div id="snapshot">${snapshotHtml(r,idx)}</div></section></div>
 </div></main>`;
 bindInstHeader();
 document.querySelector('#back-runs').onclick=()=>{inst.view='runs';inst.run=null;renderInstructor()};
 const scrub=document.querySelector('#scrub');scrub.oninput=()=>{const i=Number(scrub.value);inst.scrub=i>=evs.length-1?null:i;document.querySelectorAll('#timeline li').forEach(li=>li.classList.toggle('future',Number(li.dataset.i)>i));const t=time(evs[i]?.time||0);document.querySelector('#scrub-time').textContent=t;document.querySelector('#snap-time').textContent=t;document.querySelector('#snapshot').innerHTML=snapshotHtml(r,i)};
 const end=document.querySelector('#end-run');if(end)end.onclick=()=>confirmDialog(`End ${esc(nameOf(r))}’s run?`,'Their call will stop and the log will be frozen. This can’t be undone.','End run',async()=>{await api('sessions/'+r.id,{action:'end',data:{},key:crypto.randomUUID()},adminKey);await loadRun()});
 const form=document.querySelector('#feedback-form');
 if(form){const save=async release=>{const reviewer=document.querySelector('#reviewer').value.trim();store.set('rr-reviewer',reviewer);try{await api('sessions/'+r.id+'/review',{release,reviewer,text:document.querySelector('#feedback').value,verified:document.querySelector('#verified').checked},adminKey);inst.runs=await api('sessions',null,adminKey).catch(()=>inst.runs);await loadRun();notify(release?`Feedback released to ${nameOf(r).split(' ')[0]}.`:'Draft saved. It stays private until you release it.')}catch(e){error(e)}};
  document.querySelector('#save-draft').onclick=()=>{if(!document.querySelector('#reviewer').value.trim()||!document.querySelector('#feedback').value.trim())return form.reportValidity();save(false)};form.onsubmit=e=>{e.preventDefault();save(true)}}
}
function confirmDialog(title,body,confirmLabel,run){const d=document.createElement('dialog');d.innerHTML=`<h2>${title}</h2><p>${body}</p><div class="actions"><button class="secondary" id="dialog-cancel">Cancel</button><button class="primary" id="dialog-ok">${confirmLabel}</button></div>`;app.append(d);d.showModal();d.querySelector('#dialog-cancel').onclick=()=>d.remove();d.querySelector('#dialog-ok').onclick=async()=>{try{await run()}catch(e){error(e)}d.remove()}}

// Situations: trainees get one at random per run (built-ins plus generated or approved ones). One button asks CREAO for
// a new situation unlike anything in the rotation; the server checks the result and adds it, marked "Generated".
const parseLines=t=>t.split('\n').map(l=>l.trim()).filter(Boolean).map(l=>{const m=l.match(/^(\d+)\s*\|\s*(.+)$/);if(!m)throw Error('More caller updates: write each one as seconds | text');return {at:Number(m[1])*1000,text:m[2].trim()}});
const formatLines=lines=>(lines||[]).map(l=>`${l.at/1000} | ${l.text}`).join('\n');
function fillExtras(lines,replies,endAt){document.getElementById('s-extra').value=formatLines(lines);for(const who of ['Fire','EMS','Caller'])document.getElementById('s-reply'+who).value=replies?.[who]||'';document.getElementById('s-endAt').value=endAt?endAt/1000:''}
const AUTHOR_FIELDS=[['title','Title (trainees see this)'],['objective','What should trainees practice?'],['procedures','Procedure source (or “None, demo only”)'],['briefing','What the trainee is told at the start'],['location','Hidden truth: location'],['entrance','Hidden truth: entrance, unit or side'],['initialMessage','Caller’s first report'],['correctionMessage','Caller’s later correction']];
let genTimer=null;
async function libraryScreen(){
 [inst.situations,scenarioList,creaoState]=await Promise.all([api('situations',null,adminKey),api('scenarios',null,adminKey),api('creao',null,adminKey)]);
 const auto=creaoState.generations.filter(g=>g.mode==='auto'),pending=auto.filter(g=>g.status==='pending'),recent=auto.slice(0,5);
 const titleOf=g=>scenarioList.find(s=>s.id===g.scenario)?.title;
 const genLine=g=>g.status==='pending'?'Generating with CREAO… usually 1–3 minutes. You can leave this page; it is added when ready.':g.status==='added'?`Added “${esc(titleOf(g)||'a new situation')}” to the rotation.`:g.status==='rejected'?`Couldn’t use CREAO’s result. ${esc(g.error||'')} Try again.`:esc(g.status);
 app.innerHTML=instHeader()+`<main class="dash"><h1>Situations</h1><p class="lead">Each trainee run gets one of these at random, skipping ones the trainee just had. Difficulty and caller timing are drawn fresh for every run.</p>
 <section class="card generate-card"><div class="card-head"><div><h2>Generate a new situation</h2><p class="card-sub">${creaoState.connected?'CREAO writes a situation unlike anything already in the rotation: a new place, a new incident and a new detail for the caller to correct. It is checked and added automatically. Demo only; remove it if it isn’t suitable.':'Not connected. Add CREAO_API_KEY (an app-scoped capi_ key from the agent page) to the .env file in the app folder, then restart the server.'}</p></div><button class="primary big" id="generate" ${!creaoState.connected||pending.length?'disabled':''}>${pending.length?'Generating…':'Generate with CREAO'}</button></div>
  ${recent.length?`<ol class="gen-list" aria-live="polite">${recent.map(g=>`<li class="gen-${esc(g.status)}"><time>${esc(when(g.created))}</time><span>${genLine(g)}</span></li>`).join('')}</ol>`:''}</section>
 <section class="card"><h2>In rotation · ${inst.situations.length}</h2><ul class="situations">${inst.situations.map(s=>`<li><div class="row"><strong>${esc(s.title)}</strong><span class="chip">${s.builtIn?'Built in':s.generated?'Generated':'Added by you'}</span></div><details><summary>Show the call</summary><p><strong>Really happening:</strong> ${esc(s.truth.location)} · ${esc(s.truth.entrance)}</p><p><strong>Caller first says:</strong> “${esc(s.initialMessage)}”</p><p><strong>Later:</strong> “${esc(s.correctionMessage)}”</p>${s.builtIn?'':`<div class="actions"><button class="secondary" data-remove="${esc(s.id)}" data-title="${esc(s.title)}">Remove from rotation</button></div>`}</details></li>`).join('')}</ul></section>
 <details class="card advanced" id="advanced" ${inst.libraryOpen?'open':''}><summary>Write your own situation (optional)</summary><div class="advanced-body">
  <section><h2>Write a situation</h2><p class="note">Saving creates a draft. Approving that exact version adds it to the rotation. All situations stay demo only.</p><p class="note" id="import-note" role="status"></p>
   <form id="scenario-form" class="form-grid">${AUTHOR_FIELDS.map(([id,label])=>`<div><label for="s-${id}">${label}</label><textarea id="s-${id}" name="${id}" required maxlength="4000" rows="2"></textarea></div>`).join('')}
    <div><label for="s-time">Correction arrives after (seconds)</label><input id="s-time" name="seconds" type="number" min="1" max="3600" value="30" required></div>
    <div><label for="s-extra">More caller updates (optional, one per line as seconds | text)</label><textarea id="s-extra" name="extra" rows="3" maxlength="20000"></textarea></div>
    <div><label for="s-replyFire">Fire reply (optional, must include {message})</label><input id="s-replyFire" name="replyFire" maxlength="500" placeholder="Engine 4 copies: “{message}”"></div>
    <div><label for="s-replyEMS">EMS reply (optional, must include {message})</label><input id="s-replyEMS" name="replyEMS" maxlength="500" placeholder="Medic 2 copies: “{message}”"></div>
    <div><label for="s-replyCaller">Caller reply (optional, must include {message})</label><input id="s-replyCaller" name="replyCaller" maxlength="500" placeholder="Okay. You said: “{message}”"></div>
    <div><label for="s-endAt">Time limit in seconds (optional)</label><input id="s-endAt" name="endAt" type="number" min="1" max="3600"></div>
    <div class="actions"><button class="primary">Save as draft</button></div></form></section>
  <section><h2>Your situations</h2><div class="versions-list">${scenarioList.map(s=>`<article><div class="row"><strong>${esc(s.title)}</strong><span class="chip">${s.approved?'In rotation':'Draft'}</span></div><p class="note">${s.approved?'Approved by '+esc(s.approver):'Not approved yet'}${s.source?.kind==='creao'?' · from CREAO':''}${s.revisedFrom?' · revision of an earlier version':''}</p><details><summary>Show everything</summary><p>Practice: ${esc(s.objective)}</p><p>Procedures: ${esc(s.procedures)}</p><p>Briefing: ${esc(s.briefing)}</p><p>Really happening: ${esc(s.truth.location)} · ${esc(s.truth.entrance)}</p><p>Caller first says: “${esc(s.initialMessage)}”</p><p>At ${s.correctionAt/1000}s: “${esc(s.correctionMessage)}”</p>${(s.extraCallerLines||[]).map(l=>`<p>At ${l.at/1000}s: “${esc(l.text)}”</p>`).join('')}${Object.entries(s.replies||{}).map(([w,t])=>`<p>${esc(w)} reply: ${esc(t)}</p>`).join('')}${s.endAt?`<p>Time limit: ${time(s.endAt)}</p>`:''}</details><div class="actions"><button class="secondary" data-copy="${esc(s.id)}">Edit as a new version</button></div>${s.approved?'':`<div class="form-grid"><div><label for="approve-${esc(s.id)}">Your name to approve</label><input id="approve-${esc(s.id)}" maxlength="100"></div><div class="actions"><button class="primary" data-approve="${esc(s.id)}">Approve and add to rotation</button></div></div>`}</article>`).join('')||'<p class="note">None yet.</p>'}</div></section>
 </div></details></main>`;
 bindInstHeader();
 const adv=document.querySelector('#advanced');adv.ontoggle=()=>{inst.libraryOpen=adv.open};
 document.querySelector('#generate').onclick=async()=>{const b=document.querySelector('#generate');b.disabled=true;b.textContent='Asking CREAO…';try{await api('creao',{action:'generate'},adminKey);await libraryScreen()}catch(e){error(e);await libraryScreen()}};
 document.querySelectorAll('[data-remove]').forEach(b=>b.onclick=()=>confirmDialog(`Remove “${esc(b.dataset.title)}” from the rotation?`,'Trainees will no longer get this situation. Runs that already used it keep their history.','Remove',async()=>{await api('scenarios',{action:'remove',id:b.dataset.remove},adminKey);await libraryScreen()}));
 // While a generation is pending, nudge the server to poll CREAO and refresh this page every few seconds.
 clearTimeout(genTimer);if(pending.length)genTimer=setTimeout(async()=>{for(const g of pending)await api('creao',{action:'poll',run:g.run},adminKey).catch(()=>{});if(inst.view==='library'&&adminKey)libraryScreen().catch(error)},6000);
 document.querySelector('#scenario-form').onsubmit=async e=>{e.preventDefault();try{const values=Object.fromEntries(new FormData(e.target));values.correctionAt=Number(values.seconds)*1000;values.extraCallerLines=parseLines(values.extra||'');values.replies={Fire:values.replyFire,EMS:values.replyEMS,Caller:values.replyCaller};values.endAt=values.endAt?Number(values.endAt)*1000:null;for(const k of ['extra','replyFire','replyEMS','replyCaller','seconds'])delete values[k];await api('scenarios',{action:'save',scenario:{...values,...(revisedFrom?{revisedFrom}:{})}},adminKey);revisedFrom=null;inst.libraryOpen=true;await libraryScreen()}catch(e){error(e)}};
 document.querySelectorAll('[data-approve]').forEach(b=>b.onclick=async()=>{try{await api('scenarios',{action:'approve',id:b.dataset.approve,name:document.getElementById('approve-'+b.dataset.approve).value},adminKey);inst.libraryOpen=true;await libraryScreen()}catch(e){error(e)}});
 document.querySelectorAll('[data-copy]').forEach(b=>b.onclick=()=>{revisedFrom=b.dataset.copy;document.querySelector('#import-note').textContent='Editing as a new version. Saving creates a new draft; the original stays as it is.';const s=scenarioList.find(s=>s.id===b.dataset.copy);for(const field of ['title','objective','procedures','briefing','initialMessage','correctionMessage'])document.getElementById('s-'+field).value=s[field];document.getElementById('s-location').value=s.truth.location;document.getElementById('s-entrance').value=s.truth.entrance;document.getElementById('s-time').value=s.correctionAt/1000;fillExtras(s.extraCallerLines,s.replies,s.endAt);document.getElementById('s-title').focus()});
}

// ---------- Start ----------
app.addEventListener('click',e=>{const b=e.target.closest('[data-act]');if(!b)return;({next:nextSituation,finish:finishCall,'end-session':endSession,restart:restartSession,'change-name':changeName,progress:()=>{showProgress=true;render()},home:()=>{showProgress=false;render()}})[b.dataset.act]?.()});
try{info=await api('info')}catch{}
if(isInstructor)adminKey=tabStore.get('rr-admin')||'';
else if(auth&&!showSummary){const fromTab=!!tabStore.get('rr-session');try{session=await api('sessions/'+auth.id);/* A finished run saved by another tab is not reopened in a new tab: start at the welcome page instead. */if(session.status==='ended'&&!fromTab){setAuth(null);session=null}}catch(e){if([403,404].includes(e.status)){setAuth(null);session=null}else error(e)}}
render();
// Trainee clock: one read-only poll per second while a call is running.
let polling=false;setInterval(async()=>{if(isInstructor||!auth||!session||session.status==='ended'||showSummary||polling||busy)return;polling=true;const id=auth.id;try{const next=await api('sessions/'+id);if(auth?.id!==id)return;const change=next.status!==session.status||next.review!==session.review;session=next;connection='';if(change)render();else paintMessages()}catch(e){connection='Reconnecting… what you have typed is kept on this device.'}finally{polling=false;const c=document.querySelector('#connection');if(c)c.textContent=connection}},1000);
// Instructor dashboard: refresh the run list, or a live run, every few seconds without interrupting typing.
setInterval(async()=>{if(!isInstructor||!adminKey||document.querySelector('dialog'))return;const typing=document.activeElement?.matches?.('input,textarea,select');try{if(inst.view==='runs'&&!typing){const next=await api('sessions',null,adminKey);if(inst.view==='runs'&&JSON.stringify(next)!==JSON.stringify(inst.runs)){const y=scrollY;await runsScreen(next);scrollTo(0,y)}}else if(inst.view==='trainee'&&!typing){const next=await api('sessions',null,adminKey);if(inst.view==='trainee'&&JSON.stringify(next)!==JSON.stringify(inst.runs)){inst.runs=next;const y=scrollY;traineeScreen();scrollTo(0,y)}}else if(inst.view==='run'&&inst.run&&inst.run.status!=='ended'&&!typing){const y=scrollY;await loadRun();scrollTo(0,y)}}catch{}},4000);
