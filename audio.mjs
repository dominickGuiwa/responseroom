// ElevenLabs adapter: voices for incoming caller and unit lines, and transcription of what the trainee says.
// Server-side only: the key never reaches the browser. Without ELEVENLABS_API_KEY the app uses the device's own voices
// and typed input. Endpoints (elevenlabs.io/docs, checked 2026-10-17):
//   POST {base}/v1/text-to-speech/{voice_id}?output_format=…  header xi-api-key, JSON {text, model_id, voice_settings} -> audio bytes
//   POST {base}/v1/speech-to-text  header xi-api-key, multipart {model_id, file, language_code, …} -> {text, language_code, words}
import {createHash} from 'node:crypto';
// Premade library voices, in pools: every call draws a different caller, engine crew and medic from these (checked against
// the account on 2026-10-18). ELEVENLABS_VOICES_<ROLE>=id,id,… replaces a pool; ELEVENLABS_VOICE_<ROLE>=id pins one voice.
export const DEFAULT_POOLS=Object.freeze({
 Caller:['EXAVITQu4vr4xnSDxMaL','FGY2WhTYpPnrIDTdsKH5','cgSgspJ2msm6clMCkdW9','hpp4J3VqNfWAUOO0d1Us','pFZP5JQG7iQjIQuC4Bku','bIHbv24MWmeRgasZH58o','cjVigY5qzO86Huf0OWal','iP95p4xoKVk53GoZ742B','TX3LPaxmHKxFdv7VOQHJ','SAz9YHcvj6GT2YYXdXww'],
 Fire:['nPczCjzI2devNBz1zQrb','JBFqnCBsd6RMkjVDRZzb','onwK4e9ZLuTAKqWW03F9','pqHfZKP75CvOlQylNhV4','CwhRBWXzGAHq8TQ4Fs17'],
 EMS:['Xb7hH8MSUJpSbSDYk0k2','XrExE9yKIg1WjnnlVkGX','IKne3meq5aSn9XLyUdCD','pNInz6obpgDQGcFmaJgB'],
 Dispatcher:['XrExE9yKIg1WjnnlVkGX'],
});
export const DEFAULT_VOICES=Object.freeze(Object.fromEntries(Object.entries(DEFAULT_POOLS).map(([k,v])=>[k,v[0]])));
const idList=s=>String(s||'').split(',').map(x=>x.trim()).filter(x=>/^[A-Za-z0-9]{10,40}$/.test(x));
// Which voice speaks for a role on a given call: the pinned one if set, otherwise a stable pick from the pool by seed.
export function voiceFor(config,speaker,seed=''){const pinned=config.voices?.[speaker];if(pinned)return pinned;const pool=config.pools?.[speaker]||[];if(!pool.length)return null;let h=0;for(const c of String(seed))h=(h*31+c.charCodeAt(0))>>>0;return pool[h%pool.length]}
export function audioConfig(env=process.env){
 const apiKey=env.ELEVENLABS_API_KEY?.trim();if(!apiKey)return null;
 const pick=(k,d)=>env[k]?.trim()||d;
 return {apiKey,base:pick('ELEVENLABS_BASE_URL','https://api.elevenlabs.io').replace(/\/$/,''),ttsModel:pick('ELEVENLABS_TTS_MODEL','eleven_flash_v2_5'),sttModel:pick('ELEVENLABS_STT_MODEL','scribe_v1'),
  voices:{Caller:pick('ELEVENLABS_VOICE_CALLER',null),Fire:pick('ELEVENLABS_VOICE_FIRE',null),EMS:pick('ELEVENLABS_VOICE_EMS',null),Dispatcher:pick('ELEVENLABS_VOICE_DISPATCHER',null)},
  pools:Object.fromEntries(Object.entries(DEFAULT_POOLS).map(([role,ids])=>{const own=idList(env['ELEVENLABS_VOICES_'+role.toUpperCase()]);return [role,own.length?own:ids]})),
  dailyChars:Math.max(1000,Number(env.ELEVENLABS_DAILY_CHARS)||40000)};
}
// Units sound like a steady radio operator. The caller is less stable and more expressive as distress rises (0 calm … 3 frantic).
export function voiceSettings(speaker,distress=1){
 const d=Math.max(0,Math.min(3,Math.round(Number(distress)||0)));
 if(speaker==='Caller')return {stability:+(0.5-0.1*d).toFixed(2),similarity_boost:0.75,style:+(0.2+0.2*d).toFixed(2),use_speaker_boost:false};
 return {stability:0.8,similarity_boost:0.75,style:0,use_speaker_boost:false};
}
// Scripted caller lines carry no distress value; the words decide how the voice is set (the caller agent sends its own).
export const inferDistress=text=>{const t=String(text||'');if(/!{2,}|\b(help me|please hurry|oh (my )?god|can['’]t breathe|dying)\b/i.test(t))return 3;if(/!|\b(hurry|please|quick(ly)?|worse|scared|bleeding|trapped|smoke|fire|gas)\b/i.test(t))return 2;return 1};
const fail=(status,message)=>Object.assign(Error(message),{status});
// Error bodies are quoted briefly; they never include the key.
async function detail(response){try{const t=await response.text();try{const j=JSON.parse(t);return String(j?.detail?.message??j?.detail?.status??j?.detail??j?.message??t).slice(0,160)}catch{return t.slice(0,160)}}catch{return ''}}
const EXT={'audio/webm':'webm','video/webm':'webm','audio/mp4':'m4a','audio/x-m4a':'m4a','audio/aac':'aac','audio/mpeg':'mp3','audio/ogg':'ogg','audio/wav':'wav','audio/x-wav':'wav','audio/wave':'wav','audio/flac':'flac'};

// A cache (in memory, plus an optional persistent store such as the app's SQLite file) and a daily character budget keep
// repeated lines and runaway polling from spending credits: a situation's scripted lines are synthesized once, ever.
export function createAudio(config,{fetchImpl=fetch,now=Date.now,store=null}={}){
 const cache=new Map();const spend={day:'',chars:0};
 const today=()=>{const d=new Date(now()).toISOString().slice(0,10);if(spend.day!==d){spend.day=d;spend.chars=0}};
 return {
  config,
  get usage(){today();return {chars:spend.chars,cap:config.dailyChars,cached:cache.size}},
  async synthesize({text,speaker,distress=1,seed=''}){
   const line=String(text??'').replace(/\s+/g,' ').trim().slice(0,600);if(!line)throw fail(400,'Nothing to read');
   const voice=voiceFor(config,speaker,seed);if(!voice)throw fail(400,'Unknown speaker');
   const settings=voiceSettings(speaker,distress);
   const key=createHash('sha256').update([voice,config.ttsModel,JSON.stringify(settings),line].join('\n')).digest('hex');
   const hit=cache.get(key);if(hit){cache.delete(key);cache.set(key,hit);return hit}
   const stored=store?.get(key);if(stored){cache.set(key,stored);return stored}
   today();if(spend.chars+line.length>config.dailyChars)throw fail(429,'Today’s voice budget is used up; device voices are used instead');
   const response=await fetchImpl(`${config.base}/v1/text-to-speech/${voice}?output_format=mp3_22050_32`,{method:'POST',headers:{'xi-api-key':config.apiKey,'Content-Type':'application/json',Accept:'audio/mpeg'},body:JSON.stringify({text:line,model_id:config.ttsModel,voice_settings:settings})});
   if(!response.ok){const d=await detail(response);throw fail(502,`ElevenLabs speech failed (${response.status})${d?': '+d:''}`)}
   const bytes=Buffer.from(await response.arrayBuffer());if(!bytes.length)throw fail(502,'ElevenLabs returned no audio');
   spend.chars+=line.length;
   const clip={bytes,type:(response.headers.get('content-type')||'audio/mpeg').split(';')[0]};
   cache.set(key,clip);if(cache.size>400)cache.delete(cache.keys().next().value);
   try{store?.set(key,clip)}catch{}
   return clip;
  },
  async transcribe({audio,type}){
   if(!audio||audio.length<800)throw fail(400,'No speech was recorded. Hold the button while you talk.');
   const mime=String(type||'audio/webm').split(';')[0].trim().toLowerCase(),ext=EXT[mime];if(!ext)throw fail(415,'Unsupported audio format: '+mime.slice(0,40));
   const form=new FormData();form.append('model_id',config.sttModel);form.append('language_code','en');form.append('tag_audio_events','false');form.append('diarize','false');form.append('file',new Blob([audio],{type:mime}),'clip.'+ext);
   const response=await fetchImpl(`${config.base}/v1/speech-to-text`,{method:'POST',headers:{'xi-api-key':config.apiKey},body:form});
   if(!response.ok){const d=await detail(response);throw fail(502,`ElevenLabs transcription failed (${response.status})${d?': '+d:''}`)}
   const data=await response.json();
   const text=String(data?.text??'').replace(/\s+/g,' ').trim().slice(0,4000);
   return {text,language:typeof data?.language_code==='string'?data.language_code:null};
  },
 };
}
