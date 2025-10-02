# Usage Limits Implementation Plan

## Objectives
- Introduce persistent session identities (UUID-backed) so every interaction, log entry, and guardrail check can be tied to a known user context.
- Provide a deliberate UX control to reset identity (`New Session` button) which clears local state and signals the backend to rotate session identifiers.
- Layer configurable usage limits that can throttle activity per session and per originating IP across chat, tool usage, and audio operations.
- Ensure guardrails, logging, and storage subsystems include the session identity so enforcement decisions and audit trails align.

## Implementation status
- ✅ Phase 1 delivered via `SessionManager`, session-aware conversation store/logging, and a New Session control in the React client.
- ✅ Phase 2 delivered via `UsageTracker`, `UsageLimitService`, express wiring, and Vitest coverage for limits/service behaviour.
- ⏳ Phase 3 (future authentication) remains open as originally scoped.

## Phase 1: Session Identity Foundation
1. **Session generation & storage**
   - Generate UUID v4 per first visit; persist into browser `localStorage` and attach to every client request header (`x-session-id`).
   - On the server, trust-but-verify incoming IDs (validate UUID format, rotate if missing/invalid).
   - Maintain an in-memory cache keyed by session ID with metadata (`createdAt`, `lastSeen`, `ipAddress`). Persist to durable storage (existing `server/storage` JSON or lightweight SQLite) for restart resilience.

2. **Session reset UX**
   - Add `New Session` control in the chat UI. Clicking should:
     - Prompt for confirmation ~(optional)~, explain the chat will be cleared.
     - Clear local storage entries tied to session + chat history.
     - Request backend endpoint (`POST /sessions/reset`) to expire existing session state and respond with a fresh UUID.
   - Update frontend state management to rebuild conversation context when session changes.

3. **Propagation to subsystems**
   - Update orchestrator, agents, tool calls, logging, and guardrails to accept a `sessionId` argument.
   - Include the session ID in:
     - Interaction log filenames/entries (`sessionId`, `userIp`, `agentId`).
     - Guardrail evaluation payloads.
     - Storage metadata (uploaded files, audio transcripts, etc.).
   - Ensure fallback for voice uploads and MCP calls to carry the session ID (e.g., additional headers or request payload fields).

4. **Security considerations**
   - Avoid exposing raw IPs in the client. Store them server-side only.
   - Rate-limit session reset endpoint to prevent DoS attempts.
   - Prepare hooks for future authenticated users (nullable `userId` column), keeping session schema forward-compatible.

## Phase 2: Usage Tracking & Limits
1. **Configuration surface**
   - Define env-configurable thresholds (`USAGE_LIMITS_JSON` or discrete vars such as `MAX_REQUESTS_PER_DAY`, `MAX_AUDIO_MINUTES_PER_DAY`, `MAX_TOKENS_PER_SESSION`).
   - Document defaults and ranges in `server/.env.example` and README.
   - Allow per-environment overrides (development vs. demo).

2. **Usage Tracker service**
   - Implement `UsageTracker` module responsible for incrementing counters per event:
     - Text messages sent, tool invocations, audio transcriptions, TTS generations, file uploads.
   - For persistence choose a lightweight store (initially JSON file or SQLite via `better-sqlite3`). Pick one in implementation decision doc; design should allow swapping later.
   - Record entries keyed by `{ sessionId, ipAddress, eventType, timestamp, units }`.

3. **Limiter middleware**
   - Create guard middleware executed before orchestrator handling:
     - Fetch current usage snapshot.
     - Compare to configured thresholds per session and per IP.
     - If limits exceeded, respond with a structured guardrail message and log via `[guardrails][usage]`.
   - Apply middleware to conversation routes, file upload routes, and speech endpoints.
   - Expose helper for agents to check mid-flow (e.g., audio agent before calling TTS).

4. **Observability & feedback**
   - Extend logs to show usage counts at block time.
   - Emit metrics-style summaries (`usageTracker.dump()` for debugging) when in development mode.
   - Ensure frontend displays friendly error with remaining cooldown information if available.

5. **Testing strategy**
   - Unit tests for session generation/reset flow (front + back).
   - Service tests for `UsageTracker` aggregation logic.
   - Middleware tests covering allow/block scenarios, including simultaneous session/IP hits.
   - Integration test stub verifying UI resets session ID and clears chat state.

## Phase 3 (Future): Full Authentication
- Defer full login/JWT/OAuth to later improvements.
- When implemented, session IDs become secondary identifiers tied to authenticated accounts; usage limits can prioritize `userId` while maintaining IP-based safety net.

## Open Questions / Follow-ups
- Choose persistence backend: short-term file-based vs. SQLite. Decision required before coding Phase 2.
- Determine token measurement strategy (rough estimate via prompts vs. relying on OpenAI response usage). Need instrumentation at call sites.
- Decide on grace period messaging (e.g., warn at 80% of quota).

## Next Steps
1. Review and approve this plan.
2. Implement Phase 1 (session identity) with tests and documentation updates.
3. Proceed to Phase 2 once identity foundation validated.
