# Later Improvements

## Harden OpenAI API integrations
- Generalise error handling for all OpenAI client calls so provider responses (429s, 5xx, network faults) surface consistent status codes, hints, and retry behaviour.
- Centralise retry/backoff logic and honour recommended patterns from OpenAI’s latest guidance.
- Review official documentation and align with future error structures: https://platform.openai.com/docs/guides/error-codes/api-errors.
- Consider pluggable provider abstraction so alternative speech/text services can reuse the same resilience policies.
- Implement configurable usage limits: cap daily tokens/calls globally and per end-user (e.g., authenticated account, IP, or session) to keep experimentation from exhausting shared quotas.

## Additional follow-ups
- Add structured logging for cross-service tracing (request IDs, latency buckets).
- Monitor storage usage and institute cleanup/retention policies for persisted audio/transcripts.
- Expand test coverage for voice workflows with mocked API responses (success, rate limit, transient failure).
- Integrate FFmpeg-based transcoding in the audio service to normalise formats and unlock richer post-processing (waveforms, loudness checks).
