# Current Plan

## Voice Live Mode (WebRTC)
- ✅ Plan documented in `docs/voice_webrtc_plan.md` and initial scaffolding shipped under feature flag.
- 🛠️ Next: implement OpenAI Realtime handshake (`/api/voice/live/offer`), mint ephemeral keys, and pipe transcript events back into the orchestrator via `LiveVoiceService`.
- 🔜 After handshake: stream transcripts into the conversation log, then layer live captions/UX polish and automated tests.

## Time Helper Follow-Up
- ✅ Documented future enhancement in `docs/later_improvements.md`.
- 🛠️ Next: update `server/src/agents/timeHelperAgent.ts` to reuse resolved locations for future-time requests and return offset timestamps.
- 🔜 Add unit coverage in `server/src/agents/__tests__/timeHelperAgent.test.ts` for future-date scenarios and DST edge cases.

## Usage Tracking
- ✅ Persistent token usage tracking landed with optional `usage` log emission (flagged by `ENABLE_USAGE_LOGS`).
- 📌 Consider adding an integration test to confirm log emission when the flag is enabled.

_Last updated: pending transfer to new device; keep this file refreshed as work progresses._
