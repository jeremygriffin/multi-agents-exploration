# Guardrails Plan

## Goals
- Introduce proactive safeguards that block unsafe inputs before agents act.
- Validate outbound responses so the system can catch mismatches (e.g., wrong city/time) and recover gracefully.
- Keep configuration flexible with environment flags for incremental rollout per agent.

## User Input Guardrails
1. **Moderation layer**
   - Use OpenAI moderation (or future policy service) on every user prompt and extracted attachment text.
   - Reject or sanitize disallowed content; respond with safe fallback messaging.
2. **Transcription confidence check**
   - If voice transcripts look truncated or ambiguous (e.g., very short text compared to audio length), ask the user to confirm before routing.
3. **Attachment policies**
   - Enforce file-type/size limits.
   - Optional virus scan or PII redaction before handing data to downstream agents.
4. **Configuration**
   - `ENABLE_INPUT_MODERATION`
   - `INPUT_MODERATION_THRESHOLD`
   - `ENABLE_TRANSCRIPTION_CONFIRMATION`

## Agent Response Guardrails
1. **Response guard agent**
   - After a specialist responds, pass the original user message + agent answer to a lightweight validator prompt (“Does the answer address the request? If not, why?”).
   - Returns `ok` or `mismatch` plus rationale.
2. **Recovery strategies** (configurable)
   - Ask user for clarification.
   - Retry with the same agent but stronger instructions.
   - Escalate to a human-visible log entry without interrupting the flow.
3. **Logging**
   - Append `response_guard` events to conversation logs for auditing.
4. **Configuration**
   - `ENABLE_RESPONSE_GUARD`
   - `RESPONSE_GUARD_AGENTS` (comma-separated list; default `time_helper`)
   - `RESPONSE_GUARD_RECOVERY` (`clarify`, `retry`, `log_only`)

## Implementation Roadmap
1. Build `InputGuardService`
   - Hook into `orchestrator.handleUserMessage` before manager planning.
   - Respect moderation + transcription confirmation flags.
2. Implement `ResponseGuardAgent`
   - Lean wrapper around OpenAI completion with structured JSON output.
   - Integrate into the orchestrator post-response pipeline.
3. Config & Docs
   - Extend `.env.example`, README, and existing docs with new flags.
4. Tests & Observability
   - Unit tests for guard pass/fail scenarios.
   - Smokes to ensure recovery paths work.
   - Log field validation for auditing.

## Future Enhancements
- Rate-limit agents per user/IP to complement moderation.
- Policy-driven guardrails (custom rule engines).
- Metrics dashboard for guardrail activation rate.

---

## Implementation Notes
- `InputGuardService` now enforces moderation, attachment limits, and short transcription confirmation before any manager planning occurs. Guard responses surface as the synthetic `guardrail` agent and include detailed log payloads.
- `ResponseGuardService` validates specialist answers, supports retry/clarify/log-only recovery strategies, and records both the evaluation decision and any suppressed responses for auditing.
- New environment flags in `server/.env.example` toggle the guard layers; defaults keep the features off so they can be enabled incrementally.
- Added Vitest coverage for both services so moderation/attachment heuristics and response parsing stay reliable as we iterate.
