# ResponseRoom Caller — CREAO agent

A third CREAO agent that plays the caller during a call. ResponseRoom sends it only what the caller knows (the caller's
own lines so far, the recent conversation and what the trainee just said) and gets back one or two spoken sentences with
a distress level. The reply replaces the caller's brief scripted acknowledgment when it arrives in time; the distress level also
drives the caller's ElevenLabs voice. Without this agent the caller only acknowledges briefly (“Okay.”, “Alright, I’m still here.”).

## Create it on agent.creao.ai

1. New agent → name it **ResponseRoom Caller**.
2. **Advanced → Input Form:** three text inputs with exactly these keys:
   - `caller_brief` (required, long text) — who the caller is, what they have said, the rules for this moment of the call
   - `dispatcher_message` (required) — what the trainee just said to the caller
   - `conversation` (optional, long text) — the recent lines
3. **System prompt:** paste the block below.
4. **Advanced → API Trigger:** create an app-scoped key (`capi_…`). The app id is in the page URL.
5. In the app folder add to `.env` (never commit it):
   ```
   CREAO_CALLER_APP_ID=<app id>
   CREAO_CALLER_API_KEY=<capi_ key>
   ```
   Restart the server. The startup line shows `Caller agent: CREAO`.

## System prompt

```
You are the CALLER in a fictional dispatcher-training exercise (DEMO ONLY; nothing here is real emergency guidance).
Each run gives you three inputs: caller_brief (who you are, what you have said so far, the rules for this moment),
dispatcher_message (what the trainee dispatcher just said to you) and conversation (the recent lines).

Answer the way the caller would on the phone: one or two short spoken sentences, plain words. No stage directions,
no brackets, no emojis, no narration.

Stay inside what you know. Use only facts from your own earlier lines and from what the dispatcher has told you.
Never invent or change addresses, sides, floors, gates, lanes, unit numbers, names or injuries. If you are asked
something you do not know, say you do not know or cannot see.

You are a worried member of the public, not a trainer. Never advise, instruct, grade or reassure the dispatcher about
their job, and never tell them which units to send.

Show distress through your words (hesitation, urgency, repeating yourself) and rate it.

Output JSON only, nothing else:
{"reply": "<what you say>", "distress": 0 | 1 | 2 | 3}
(0 calm, 1 worried, 2 upset, 3 frantic)
```

## What ResponseRoom does with the reply

- Accepts `{"reply", "distress"}` or a plain spoken line; cuts the reply at 280 characters; clamps distress to 0–3.
- Holds the scripted acknowledgment for `CREAO_CALLER_HOLD_MS` (default 45 s, 5–60 s) so the reply can take its place; the
  trainee sees “Caller is answering…” meanwhile. If the run is slower than that, a brief acknowledgment goes out and the late
  reply is dropped. Measured on 2026-10-18 through the API Trigger: about 25 s from start to completed.
- Refuses the reply and falls back to the acknowledgment when it coaches the trainee ("you should…"), names the corrected
  detail before the caller has actually said it, contains links, brackets or asterisks, or arrives after the call ended.
  Refusals are reported to Sentry with the reason.
- Never sends the agent the hidden truth, the keywords, the units, the record or anything from the instructor side.
  See `callerInputs` in `generate.mjs` and `caller.test.mjs`.
