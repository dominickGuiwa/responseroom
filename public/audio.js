// Voice for the trainee console, shared by the browser and the tests (no browser globals are touched at import time).
// Incoming caller and unit lines are read aloud as they arrive: ElevenLabs through the server when it is connected,
// otherwise the device's own voices. What the trainee says is recorded on push-to-talk and sent to the server for
// transcription. Nothing here writes to the log: only text the trainee actually sends becomes a message.
export const SPEAKERS=['Caller','Fire','EMS'];
export const isExternal=e=>['message','ack'].includes(e?.kind)&&SPEAKERS.includes(e?.data?.from);

// Which external lines are new since the last look. A session this tab has just loaded starts from "now" (a reload
// mid-call does not replay the whole conversation), except a call that has only just begun, so its first line is heard.
export function newMessages(cursor,session,{youngMs=6000}={}){
 const latest=session.events.at(-1)?.seq||0;
 if(cursor.id!==session.id){cursor.id=session.id;cursor.seq=(session.elapsed??Infinity)<youngMs?0:latest}
 const fresh=session.events.filter(e=>e.seq>cursor.seq&&isExternal(e));
 cursor.seq=latest;return fresh;
}

// One voice at a time, in arrival order. fetchClip(event) resolves to encoded audio (ArrayBuffer) or null when the
// server has no voice for it; fallback(event) speaks with the device's voices and resolves when done.
export function createSpeaker({fetchClip,fallback,cancelFallback,onStart,onEnd,AudioContextImpl=globalThis.AudioContext||globalThis.webkitAudioContext}={}){
 const queue=[];let playing=false,ctx=null,current=null,generation=0;
 const context=()=>{if(!ctx&&AudioContextImpl){try{ctx=new AudioContextImpl()}catch{ctx=null}}return ctx};
 async function playBuffer(bytes){
  const c=context();if(!c)throw Error('No audio output');
  if(c.state==='suspended')await c.resume();
  const buffer=await c.decodeAudioData(bytes.slice(0));
  await new Promise(resolve=>{const src=c.createBufferSource();src.buffer=buffer;src.connect(c.destination);current=src;src.onended=()=>{if(current===src)current=null;resolve()};src.start()});
 }
 async function drain(){
  if(playing)return;playing=true;
  try{while(queue.length){
   const {event,fetch}=queue.shift(),gen=generation;let spoken=false;
   onStart?.(event);
   if(fetch){try{const bytes=await fetch(event);if(gen===generation&&bytes&&bytes.byteLength){await playBuffer(bytes);spoken=true}}catch{}}
   if(!spoken&&gen===generation&&fallback){try{await fallback(event)}catch{}}
   onEnd?.(event);
  }}finally{playing=false}
 }
 return {
  // A line may bring its own clip source (the welcome demo does); otherwise the speaker's fetchClip is used.
  say(event,fetch=fetchClip){queue.push({event,fetch});drain()},
  // Stops the current line and forgets the rest: used the moment a call pauses or ends.
  stop(){generation++;queue.length=0;try{current?.stop()}catch{}current=null;try{cancelFallback?.()}catch{}},
  // Browsers only play sound after the person has interacted with the page; call this from the first click or key press.
  unlock(){const c=context();if(c&&c.state==='suspended')c.resume().catch(()=>{})},
  get pending(){return queue.length},
  get busy(){return playing},
 };
}

// Device voices: an installed English voice, enhanced ones first. Returns null when the browser has none.
export function browserVoice(synth=globalThis.speechSynthesis,Utterance=globalThis.SpeechSynthesisUtterance){
 if(!synth||!Utterance)return null;
 const pick=()=>{const voices=synth.getVoices().filter(v=>/^en([-_]|$)/i.test(v.lang));const score=v=>(v.localService?20:0)+(/premium|enhanced|natural|neural/i.test(v.name)?100:0)+(/^en-US$/i.test(v.lang)?5:0);return voices.sort((a,b)=>score(b)-score(a))[0]};
 return {
  speak:event=>new Promise(resolve=>{const u=new Utterance(`${event.data.from}. ${event.data.text}`);const voice=pick();if(voice)u.voice=voice;u.lang=voice?.lang||'en-US';u.rate=event.data.from==='Caller'?1.02:0.95;u.pitch=1;u.onend=()=>resolve();u.onerror=()=>resolve();synth.speak(u)}),
  cancel:()=>synth.cancel(),
 };
}

// Push-to-talk. start() asks for the microphone and records; stop() resolves with the clip (a Blob) for transcription.
// Clips are capped so a stuck key cannot record for minutes.
export function createRecorder({getMedia,Recorder=globalThis.MediaRecorder,maxMs=45000,onTick,now=Date.now}={}){
 const media=getMedia||(()=>globalThis.navigator.mediaDevices.getUserMedia({audio:true}));
 const supported=!!Recorder&&!!(getMedia||globalThis.navigator?.mediaDevices?.getUserMedia);
 const mime=()=>['audio/webm;codecs=opus','audio/webm','audio/mp4','audio/ogg;codecs=opus'].find(t=>Recorder.isTypeSupported?.(t))||'';
 let rec=null,stream=null,chunks=[],timer=null,startedAt=0,settle=null;
 async function start(){
  if(rec)return;
  stream=await media();const type=mime();
  rec=new Recorder(stream,type?{mimeType:type,audioBitsPerSecond:32000}:undefined);chunks=[];
  rec.ondataavailable=e=>{if(e.data?.size)chunks.push(e.data)};
  rec.onstop=()=>{const blob=new Blob(chunks,{type:rec?.mimeType||type||'audio/webm'});for(const t of stream?.getTracks?.()||[])t.stop();stream=null;rec=null;clearInterval(timer);timer=null;const done=settle;settle=null;done?.(blob)};
  startedAt=now();rec.start(250);
  timer=setInterval(()=>{const ms=now()-startedAt;onTick?.(ms);if(ms>=maxMs)stop()},200);timer.unref?.();
 }
 function stop(){return new Promise(resolve=>{if(!rec){resolve(null);return}settle=resolve;try{rec.stop()}catch{settle=null;resolve(null)}})}
 return {start,stop,supported,get recording(){return !!rec},get elapsed(){return rec?now()-startedAt:0}};
}
