# Current Plan

## Voice Live Mode (WebRTC)
- ✅ Plan documented in `docs/voice_webrtc_plan.md`, handshake routed through `/api/voice/live/offer`, and transcripts stream into the orchestrator under the feature flag.
- 🛠️ Next: harden transcript parsing/stream teardown, surface live captions in the UI, and add a dedicated teardown endpoint for idle sessions.
- 🔜 Follow-up with automated coverage (service + client smoke), plus UX polish for reconnect/latency states once the pipeline proves stable.

## Time Helper Follow-Up
- ✅ Documented future enhancement in `docs/later_improvements.md`.
- 🛠️ Next: update `server/src/agents/timeHelperAgent.ts` to reuse resolved locations for future-time requests and return offset timestamps.
- 🔜 Add unit coverage in `server/src/agents/__tests__/timeHelperAgent.test.ts` for future-date scenarios and DST edge cases.

## Usage Tracking
- ✅ Persistent token usage tracking landed with optional `usage` log emission (flagged by `ENABLE_USAGE_LOGS`).
- 📌 Consider adding an integration test to confirm log emission when the flag is enabled.

_Last updated: pending transfer to new device; keep this file refreshed as work progresses._
