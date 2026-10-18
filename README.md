# ResponseRoom

**A fictional, text-based dispatcher training simulator.** One trainee works a simulated call: a scripted caller, Fire and EMS on separate channels, and an incident record they keep by hand. Instructors author and approve every scenario version and write the debrief themselves.

> **DEMO ONLY.** Not approved for operational training. No real procedures, addresses or people are included, and nothing here is emergency guidance.

![Trainee console](docs/screenshots/console.png)

## Why

In dispatch, *what you wrote down*, *what you transmitted* and *who confirmed it* are three different things, and real mistakes live in the gaps between them. Most training tools blur them by auto-filling records, nudging the next step or scoring live. ResponseRoom keeps them separate and lets the trainee make real mistakes, so the debrief can show exactly what happened.

## What it does

**Trainee (no setup, plain language, large text)**
- Enter your name and start. Every run is a **new situation** from a rotating library of fictional calls (plus any the instructor approves), skipping ones you just had.
- **Live aerial street map:** a fictional district with the incident building and every one of its entrances (or lanes, gates, units, elevators), the Fire station, the ambulance (Medic) base, a hospital and the dispatch center. Fire and the ambulance leave their stations only when you message them and go wherever you last told them; the caller’s marker sits where the caller said they are and moves when they correct it. The map focuses on the street once you save the location in your record.
- **Popups:** nearest centers with distances at the start, then “Engine 4 leaving Station 4 for the east entrance · ETA 01:05”, re-routes and arrivals, all kept in an updates list under the map.
- **Random difficulty and timing:** each run draws Easy, Standard or Hard, which sets when the caller’s correction arrives, how many extra caller updates come, how fast units travel and the time limit. On Hard, units can reach the wrong place before the correction, so you have to re-route them.
- **Outcomes, judged after the call ends:** each unit acts on the last thing it was told. Success means every unit you sent ended up with the corrected detail and your record shows it; failure comes with plain reasons (“Medic 4 went to the eastbound lanes, the wrong place. The last thing they were told was…”). Nothing is judged or hinted during the call.
- **Goals and tasks:** four goals shown up front (quick first dispatch, relay changes fast, accurate record, right place) with per-call results, plus milestones like “three successes in a row”. A progress page shows success rate, goal rates against their aims, what to practice next and what is going well.
- After you have sent something, **Finish call**, **New situation** and **End session** are always one click away.
- Manual incident record (location, entrance, caller, notes). Nothing is prefilled or auto-corrected.
- Separate Caller / Fire / EMS channels. Messages are delivered exactly as typed, including wrong content.
- Delivery and acknowledgment are distinct events. Participants read back what they actually received, never facts they weren't sent.
- Recording and transmitting are independent. You can send before recording, record without sending, or both.
- Scripted caller corrections at authored times, optional time limit, pause/resume/end.
- No live hints, suggested replies, missing-step warnings, scores or hidden-truth leaks.
- Optional voice for incoming messages (browser speech synthesis); screen-reader announcements; phone-width layout.

**Instructor (dashboard first, setup optional)**
- **Runs dashboard:** every trainee run with status, length and automatic observations (was the caller’s correction recorded, and relayed to Fire and EMS?). Filter by trainee. These are keyword checks to guide review, not grades.
- **Trainee profiles with performance graphs:** outcome of each call, seconds to first dispatch and seconds to relay a change (each against its goal line), goal rates, and focus areas with the evidence behind them (“EMS missed the change in 2 of 3 calls”). Automatic keyword checks, shown as such, never a grade.
- **Run detail:** the map at any replayed moment with the actual location marked, the outcome the trainee saw, a plain-language timeline (no JSON), replay slider, “what really happened vs. the trainee’s record”, an agent map weighted by message volume, and feedback you release when ready. Live runs can be watched or ended.
- Author scenario versions: objective, attributed procedures, briefing, hidden truth, caller lines, readback reply templates, time limit.
- Every save is an immutable draft; only an approved version can launch. Revisions link to their parent.
- Generate a draft with **CREAO** (below). Output is checked, then loaded into the instructor's form, never auto-saved or auto-approved.
- Exercises list; end a running exercise; replay any ended exercise with hidden truth, trainee record and participant knowledge side by side.
- Write feedback as private drafts; release a version only after explicit verification. Review history is append-only.

![Instructor setup](docs/screenshots/instructor-setup.png)

## Design rules the code enforces

| Rule | How |
|---|---|
| Trainee payload never contains hidden truth, procedures or drafts | Server builds a separate public view; tests check it |
| Participants only know what was delivered | Replies are readback templates that must include `{message}` and are rejected if they mention the hidden truth |
| Exercise log is append-only and replayable | Ordered SQLite event log; timed events stamped at their exact due time |
| Retries never duplicate actions | Per-request IDs; a reused ID with different content is rejected (409) |
| Instructor cannot act as the trainee | The instructor key can end an exercise but not send or record |
| Agent output has no authority | CREAO output that self-approves, cites unsupplied sources or auto-sends dispatcher messages is rejected |

## CREAO integration

ResponseRoom calls the **ResponseRoom Scenario Builder** agent through CREAO's app-scoped API Trigger (`POST /api/v1/apps/{appId}/runs`, then poll the run).
- The instructor gives a learning objective, seed, difficulty and duration. No procedures are sent, so every result stays DEMO ONLY.
- The agent returns a `response-room-scenario/1.0.0` JSON artifact. ResponseRoom validates it and imports only caller lines, timing, the time limit and the briefing.
- Participant replies, rubrics and AI interpretations are not imported. Hidden location and entrance are entered by the instructor, not guessed.
- The `capi_` key lives only in `.env` on the server; artifact downloads never forward it to storage redirects.

## Sentry monitoring

Optional, dependency-free reporting to Sentry's envelope endpoint (`sentry.mjs`), enabled by `SENTRY_DSN` in `.env`:
- **Errors:** unexpected server errors (the client only sees a generic 500), uncaught browser errors forwarded through the server (rate-limited), and process crashes.
- **Performance:** one transaction per API call, named by route template (`POST /api/sessions/:id`). The 1-second trainee poll is not traced.
- **AI agent monitoring:** CREAO calls are traced as `ai.agent.run`, `ai.agent.poll` and `ai.validate` spans, tagged with the outcome. Rejected agent output and failed runs are reported as warnings with the validator's reason.
- **Privacy by design:** only operational data is passed in. No message text, record contents, objectives, reviews, request bodies, tokens or keys are sent, and IDs, keys and emails are scrubbed again before sending. Tests parse the envelopes to check this.

## Quick start

Requires **Node.js 24+**. No dependencies to install.

```bash
git clone <this repo> && cd responseroom
npm start
```

Open http://127.0.0.1:4173.

- **Trainee:** click *Start demo*.
- **Instructor:** open http://127.0.0.1:4173/instructor. The instructor key is generated on first run in `.instructor-key` (local file, mode 600, gitignored).
- **CREAO / Sentry (optional):** `cp .env.example .env`, set `CREAO_API_KEY` (app-scoped `capi_` key) and/or `SENTRY_DSN`, restart.

## Tests

```bash
npm test               # 75 tests: engine, HTTP auth, knowledge boundaries, storage isolation, CREAO adapter and Sentry (both mocked), voice
npm run check:secrets  # fails if secrets/local state are tracked or appear anywhere in git history
```

## Security notes

- Binds to `127.0.0.1` only; strict Content-Security-Policy; POST origin check; constant-time key comparison.
- Secrets (`.env`, `.instructor-key`) and the SQLite database are gitignored and never served over HTTP.
- The instructor key is a local capability for a demo, not production identity or access control.

## Project structure

```
server.mjs      HTTP routes, auth, static files
engine.mjs      exercise state, event log, scenarios, reviews, CREAO generations (SQLite)
creao.mjs       CREAO API adapter and output validation
situations.mjs  built-in fictional situations with map params
difficulty.mjs  random difficulty and caller timing per run
observations.mjs outcomes, goals, metrics and instructor observations
public/streetmap.js shared aerial map: geometry, unit movement, popups, rendering
public/insights.js  progress charts, goal rates, focus areas
sentry.mjs      minimal Sentry envelope reporter (errors, transactions, scrubbing)
public/         vanilla JS/CSS client (trainee console + instructor UI)
*.test.mjs      node:test suites
scripts/        pre-publish secret check
docs/screenshots
```

## Limitations

Local single-machine demo; scripted (not conversational) participants; one hidden location/entrance per scenario; no production authentication.

## Built with

Node.js 24 (`node:http`, `node:sqlite`, `node:test`), vanilla JavaScript/CSS, CREAO agents, Sentry, browser speech synthesis. Development was assisted by AI coding tools.

## License

_Not yet chosen._
