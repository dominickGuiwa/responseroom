// ElevenLabs adapter: voices for incoming caller and unit lines, and transcription of what the trainee says.
// Server-side only: the key never reaches the browser. Without ELEVENLABS_API_KEY the app uses the device's own voices
// and typed input. Endpoints (elevenlabs.io/docs, checked 2026-10-17):
//   POST {base}/v1/text-to-speech/{voice_id}?output_format=…  header xi-api-key, JSON {text, model_id, voice_settings} -> audio bytes
//   POST {base}/v1/speech-to-text  header xi-api-key, multipart {model_id, file, language_code, …} -> {text, language_code, words}
import {createHash} from 'node:crypto';
// Premade library voices. Override per role with ELEVENLABS_VOICE_CALLER / _FIRE / _EMS (any voice id on the account).
export const DEFAULT_VOICES=Object.freeze({Caller:'EXAVITQu4vr4xnSDxMaL',Fire:'nPczCjzI2devNBz1zQrb',EMS:'Xb7hH8MSUJpSbSDYk0k2',Dispatcher:'XB0fDUnXU5powFXDhCwa'});
export function audioConfig(env=process.env){
 const apiKey=env.ELEVENLABS_API_KEY?.trim();if(!apiKey)return null;
 const pick=(k,d)=>env[k]?.trim()||d;
 return {apiKey,base:pick('ELEVENLABS_BASE_URL','https://api.elevenlabs.io').replace(/\/$/,''),ttsModel:pick('ELEVENLABS_TTS_MODEL','eleven_flash_v2_5'),sttModel:pick('ELEVENLABS_STT_MODEL','scribe_v1'),
  voices:{Caller:pick('ELEVENLABS_VOICE_CALLER',DEFAULT_VOICES.Caller),Fire:pick('ELEVENLABS_VOICE_FIRE',DEFAULT_VOICES.Fire),EMS:pick('ELEVENLABS_VOICE_EMS',DEFAULT_VOICES.EMS),Dispatcher:pick('ELEVENLABS_VOICE_DISPATCHER',DEFAULT_VOICES.Dispatcher)},
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

// A small in-memory cache and a daily character budget keep repeated lines and runaway polling from spending credits.
export function createAudio(config,{fetchImpl=fetch,now=Date.now}={}){
 const cache=new Map();const spend={day:'',chars:0};
 const today=()=>{const d=new Date(now()).toISOString().slice(0,10);if(spend.day!==d){spend.day=d;spend.chars=0}};
 return {
  config,
  get usage(){today();return {chars:spend.chars,cap:config.dailyChars,cached:cache.size}},
  async synthesize({text,speaker,distress=1}){
   const line=String(text??'').replace(/\s+/g,' ').trim().slice(0,600);if(!line)throw fail(400,'Nothing to read');
   const voice=config.voices[speaker];if(!voice)throw fail(400,'Unknown speaker');
   const settings=voiceSettings(speaker,distress);
   const key=createHash('sha256').update([voice,config.ttsModel,JSON.stringify(settings),line].join('\n')).digest('hex');
   const hit=cache.get(key);if(hit){cache.delete(key);cache.set(key,hit);return hit}
   today();if(spend.chars+line.length>config.dailyChars)throw fail(429,'Today’s voice budget is used up; device voices are used instead');
   const response=await fetchImpl(`${config.base}/v1/text-to-speech/${voice}?output_format=mp3_22050_32`,{method:'POST',headers:{'xi-api-key':config.apiKey,'Content-Type':'application/json',Accept:'audio/mpeg'},body:JSON.stringify({text:line,model_id:config.ttsModel,voice_settings:settings})});
   if(!response.ok){const d=await detail(response);throw fail(502,`ElevenLabs speech failed (${response.status})${d?': '+d:''}`)}
   const bytes=Buffer.from(await response.arrayBuffer());if(!bytes.length)throw fail(502,'ElevenLabs returned no audio');
   spend.chars+=line.length;
   const clip={bytes,type:(response.headers.get('content-type')||'audio/mpeg').split(';')[0]};
   cache.set(key,clip);if(cache.size>400)cache.delete(cache.keys().next().value);
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
