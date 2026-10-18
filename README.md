# ResponseRoom local prototype

Demo only; not approved for operational training.

Run with Node 24+: `node server.mjs`. Open http://127.0.0.1:4173.
Tests: `node --test test.mjs http.test.mjs` (HTTP tests require localhost listening permission).

Implemented: navy Paper-derived responsive UI; briefing; empty manual incident record; separate Caller/Fire/EMS channels; preserved raw message content; delayed message-specific acknowledgments; pause/resume/end; SQLite persistence and ordered event history; instructor-key-gated replay; manually written and verified feedback release. No live scoring or hints. No third-party dependencies.

Local instructor key is generated in `.instructor-key` (mode 0600). Database and key are gitignored and are not served by HTTP. The key gates review at the server. This is a local capability model, not production identity/access management. Anyone who can read the project files can access the local instructor key.

Demo semantics: messages enter their recipient channel immediately when accepted. A scripted echo acknowledgment follows after 2.5 scenario seconds. Caller correction occurs at 30 scenario seconds. These scripts are a local demonstration, not the downloaded CREAO artifact. Pause freezes scenario time; end cancels pending acknowledgments and freezes exercise events. Polling advances the clock from persisted wall-clock deltas; time continues while active even if the browser is closed. GET polling is once per second. No SSE yet.

Validation: seven state-engine tests pass. Browser verified start, send-before-record, verbatim wrong transmission, manual record-only edit, correction message and pause. End/replay/release browser testing remains pending. Latest changes preserve field drafts through rerenders and reuse action request IDs on identical retries. These need additional browser regression coverage.

Incomplete: instructor scenario authoring/approval, real CREAO agent execution/API adapter, Sentry traces/logs, authored branching and rubric scoring, versioned feedback approval audit, production authentication, full participant simulator, wider accessibility/responsive tests. The current app explicitly labels integrations unconnected. Do not represent these as completed.

Claude received engine.mjs, server.mjs, public/app.js and test.mjs for a static review in the desktop session “ResponseRoom dispatcher simulator review”. No workspace access granted; source was pasted without credentials/database. Review was still in progress at handoff. Follow-up changes after that snapshot: transactional chronological tick processing, pending-ack cancellation references, local record drafts, identical retry IDs, polling overlap prevention.

## Verified follow-up

Ten tests pass, including HTTP authorization, review gating, frozen exercise history, chronological delayed events, and request-ID payload mismatch rejection. Browser verified end → instructor replay → save draft → draft hidden in trainee view → approve/release → feedback visible to trainee. Review history is append-only in a separate table, preserving frozen exercise events. Draft saves and releases carry reviewer name, version and timestamp. These are local reviewer labels, not authenticated identities. Explicit delivered labels distinguish accepted channel messages from delayed acknowledgments.

Fixed text clearing during in-flight save/send, unknown session subroutes, and byte-safe key comparisons. Complete multi-tab draft isolation and production identities remain open. CREAO/Sentry and instructor scenario authoring remain unfinished.

Incoming voice: during an exercise, toggle Voice on to read the latest incoming message and subsequent new Caller/Fire/EMS messages. Outgoing messages are never spoken. Pause/end cancels speech; turning voice off stops queued speech. Voice defaults off on reload and requires browser speech synthesis support. A mock-based voice test verifies filtering, duplicate suppression and pause cancellation; UI toggle was verified, but speaker audibility is device-dependent. Run `npm test` for all tests.

Instructor setup is available at `/instructor`, separately from an ongoing exercise. Authenticate with the local instructor key. Enter objective, attributed source procedures, trainee briefing, hidden location/entrance, initial caller text, later caller text and its time. Save creates an immutable draft; inspect it and approve that exact version with an approver name. Revise copies content into a new draft. Approved demos show the trainee briefing before launch and pin authored content to the session. All remain demo only; source text is not validated as operational policy. Engine approval/pinning test passes; instructor login/form visually verified. CREAO generation and richer branching remain pending.

Authoring validation follow-up: 13 tests pass including scenario HTTP permissions, approval gate and version pinning. Browser saved/approved/launched “Harbor House — QA demo” and verified its briefing and initial caller message. QA session left paused before the later message. Revision UI and later-message timing still need browser verification.

Timed-message browser check completed: Harbor House correction appeared at 00:05, record remained empty, no outgoing transmissions were generated. QA exercise paused afterward. Revision UI test is still outstanding. See HANDOFF.md for low-usage continuation state.

Session/storage reliability follow-up: drafts are scoped per session, the active session is per browser tab, retry IDs are per tab, late responses for a session a tab has left are ignored, and launching from /instructor moves to / so reload restores the exercise. Revise-as-new-version browser flow verified on a throwaway QA server. 19 tests pass (`npm test`). Restart the server to load the engine's legacy request-ID fix.

CREAO scenario generation (instructor setup): server-side adapter for the ResponseRoom Scenario Builder agent, matched to CREAO's app-scoped API Trigger docs. Disabled until `CREAO_API_KEY` (an app-scoped `capi_` key) is set in `.env` (never commit it). Output is checked against the agent's schema; only caller lines, timing and briefing load into the instructor's new-draft form, and the instructor saves it as an unapproved draft. Procedures are never sent or imported. Tested with mocks only; no live run yet. 26 tests pass.
