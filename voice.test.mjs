import {test} from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
import {newMessages,createSpeaker,browserVoice,createRecorder,isExternal} from './public/audio.js';
// The browser voice module runs here with fakes for the audio context, speech synthesis and MediaRecorder.
const ev=(seq,kind,from,text,id=String(seq))=>({seq,kind,data:{id,from,text}});
const wait=ms=>new Promise(r=>setTimeout(r,ms));

test('new lines: a call that has just begun is heard from its first line; a reload mid-call starts from now; nothing is read twice',()=>{const cursor={id:null,seq:0};
 const young={id:'a',elapsed:1200,events:[ev(1,'message','Caller','Smoke at 18 Cedar Court')]};assert.deepEqual(newMessages(cursor,young).map(e=>e.seq),[1]);
 young.events.push(ev(2,'message','Dispatcher','Engine 4 go'),ev(3,'ack','Fire','Received'));assert.deepEqual(newMessages(cursor,young).map(e=>e.seq),[3],'the trainee’s own line is not read back');assert.deepEqual(newMessages(cursor,young),[]);
 const old={id:'b',elapsed:90000,events:[ev(1,'message','Caller','x'),ev(2,'ack','EMS','y')]};assert.deepEqual(newMessages(cursor,old),[],'a reload mid-call does not replay the conversation');old.events.push(ev(3,'message','Caller','Correction'));assert.deepEqual(newMessages(cursor,old).map(e=>e.seq),[3]);
 assert.equal(isExternal(ev(1,'record','Caller','x')),false);assert.equal(isExternal(ev(1,'message','Caller','x')),true)});

test('speaker: plays clips in order, falls back to device voices when the server has none, and stop() drops what is queued',async()=>{const played=[],spoken=[];let cancelled=0;
 function FakeContext(){this.state='running';this.destination={};this.decodeAudioData=async b=>({len:b.byteLength});this.createBufferSource=()=>{const src={connect(){},start(){setTimeout(()=>src.onended(),5)},stop(){}};return src}}
 const fetchClip=async e=>e.data.from==='Fire'?null:new Uint8Array([1,2,3]).buffer;
 const sp=createSpeaker({fetchClip,fallback:async e=>{spoken.push(e.data.text)},cancelFallback:()=>cancelled++,onStart:e=>played.push('start:'+e.data.text),onEnd:e=>played.push('end:'+e.data.text),AudioContextImpl:FakeContext});
 sp.say(ev(1,'message','Caller','One'));sp.say(ev(2,'ack','Fire','Two'));sp.say(ev(3,'ack','EMS','Three'));assert.equal(sp.pending,2);await wait(90);
 assert.deepEqual(played,['start:One','end:One','start:Two','end:Two','start:Three','end:Three']);assert.deepEqual(spoken,['Two'],'only the line without a server clip used the device voice');
 sp.say(ev(4,'message','Caller','Four'));sp.say(ev(5,'message','Caller','Five'));sp.stop();assert.equal(sp.pending,0);assert.equal(cancelled,1);await wait(40);assert.ok(!played.includes('start:Five'),'queued lines are dropped on stop');
 const noOutput=createSpeaker({fetchClip,fallback:async e=>{spoken.push('fb:'+e.data.text)},AudioContextImpl:undefined});noOutput.say(ev(6,'message','Caller','Six'));await wait(20);assert.ok(spoken.includes('fb:Six'),'without an audio context the device voice is used')});

test('device voices: picks an enhanced English voice, resolves when the line ends, cancels on demand',async()=>{const said=[];let cancelled=0;
 const synth={getVoices:()=>[{name:'Daniel',lang:'en-GB',localService:true},{name:'Samantha Enhanced',lang:'en-US',localService:true},{name:'Amélie',lang:'fr-FR',localService:true}],speak:u=>{said.push(u);setTimeout(()=>u.onend(),2)},cancel:()=>cancelled++};
 function U(text){this.text=text}const v=browserVoice(synth,U);await v.speak(ev(1,'ack','Fire','Received'));assert.equal(said[0].text,'Fire. Received');assert.equal(said[0].voice.name,'Samantha Enhanced');v.cancel();assert.equal(cancelled,1);assert.equal(browserVoice(undefined,undefined),null)});

test('recorder: records between start and stop, hands back a typed clip, releases the microphone, and stops itself at the cap',async()=>{let now=0;const tracks=[{stopped:0,stop(){this.stopped++}}];const stream={getTracks:()=>tracks};
 class FakeRecorder{static isTypeSupported(t){return t==='audio/webm;codecs=opus'}constructor(s,o){this.mimeType=o?.mimeType}start(){this.ondataavailable({data:new Blob(['abc'],{type:'audio/webm'})})}stop(){this.ondataavailable({data:new Blob(['defg'],{type:'audio/webm'})});this.onstop()}}
 const ticks=[];const r=createRecorder({getMedia:async()=>stream,Recorder:FakeRecorder,maxMs:1000,onTick:ms=>ticks.push(ms),now:()=>now});
 assert.equal(r.supported,true);assert.equal(await r.stop(),null,'stopping when idle is harmless');
 await r.start();assert.equal(r.recording,true);now=500;assert.equal(r.elapsed,500);const clip=await r.stop();assert.equal(clip.type,'audio/webm;codecs=opus');assert.equal(clip.size,7);assert.equal(r.recording,false);assert.equal(tracks[0].stopped,1);
 await r.start();now=1700;await wait(450);assert.equal(r.recording,false,'auto-stopped at the cap');assert.ok(ticks.some(t=>t>=1000));
 assert.equal(createRecorder({Recorder:undefined}).supported,false)});

test('screen-reader announcer reads only newly arrived external messages',()=>{const source=readFileSync(new URL('./public/app.js',import.meta.url),'utf8');const fn=source.slice(source.indexOf('let announceCursor='),source.indexOf('let lastMessages='));const el={textContent:''};const context=vm.createContext({document:{querySelector:()=>el},session:{id:'s',events:[{seq:1,kind:'message',data:{from:'Caller',text:'Initial'}}]}});vm.runInContext(fn+';announceNew()',context);assert.equal(el.textContent,'');context.session.events.push({seq:2,kind:'message',data:{from:'Dispatcher',text:'Outgoing'}});vm.runInContext('announceNew()',context);assert.equal(el.textContent,'');context.session.events.push({seq:3,kind:'ack',data:{from:'Fire',text:'Received'}});vm.runInContext('announceNew()',context);assert.equal(el.textContent,'Fire: Received');el.textContent='';vm.runInContext('announceNew()',context);assert.equal(el.textContent,'')});
