# Voice Interaction Feature Plan

## Overview
- Voice agent is live: audio clips recorded or uploaded in the UI route to the `voice` agent, get transcribed via OpenAI Speech-to-Text, and responses are optionally synthesized back to audio for playback.
- Current scope intentionally keeps audio processing lightweight—`audioService` validates formats and stores originals; FFmpeg transcoding is deferred.
- Logging of audio interactions mirrors text flow, and transcripts plus generated TTS audio are written alongside other artifacts under `server/storage`.

- Allow users to upload or record short audio clips that the manager routes to the `voice` agent.
- Store validated audio attachments and transcripts using the shared timestamped naming convention in `server/storage`.
- Return synthesized speech responses (for agents listed in `TTS_RESPONSE_AGENTS` when `ENABLE_TTS_RESPONSES=true`) while always delivering text transcripts.
- Emit guardrail and debugging logs so audio events appear in both stdout and per-interaction files.

## Current Behavior Summary
- Frontend offers MediaRecorder capture plus manual upload; accepted MIME types mirror `audioService` configuration.
- `speechService.transcribeAudio` retries transient failures, surfaces explicit status/message on errors, and respects `ENABLE_TRANSCRIPTION_CONFIRMATION` for short clips.
- `speechService.synthesizeSpeech` generates agent replies when enabled; optional echo of the user clip is controlled by `ENABLE_VOICE_ECHO` (default off).
- Manager routing detects audio attachments, invokes the voice agent, and merges the agent's text + synthesized audio into conversation history.

## Deliverables
- ✅ Backend audio service with validation stubs and TODO for FFmpeg normalization.
- ✅ Voice agent definition, storage integration, and routing hand-offs back to manager after transcription.
- ✅ React UI updates for recording/uploading, transcript display, and audio playback of agent responses.
- ✅ Vitest coverage for audio validation, guardrails, and voice agent orchestration.

## Remaining Work & Enhancements
- Integrate FFmpeg-based transcoding in `audioService.transcodeAudio` to normalize sample rates and provide waveform previews.
- Expand automated tests to cover end-to-end audio flows (frontend + backend) and failure recovery scenarios.
- Tighten rate limiting / quota awareness for speech APIs; see `docs/later_improvements.md`.
- Expose per-agent configuration to toggle TTS output individually instead of the allowlist environment variable.
- Improve accessibility by providing captions/subtitles for synthesized audio.

## Implementation Notes

### Backend Foundation
- `server/src/services/audioService.ts` validates MIME types and leaves a placeholder for future transcoding.
- Tests in `server/src/services/__tests__/audioService.test.ts` and guardrail suites validate MIME enforcement and logging.
- Storage utilities persist audio artifacts using the `<timestamp>_<basename>` pattern, generating `.transcript.md` companions.

### Voice Agent
- `server/src/agents/voiceAgent.ts` orchestrates transcription, guardrail checks, and hand-off back to the manager.
- Tool calls use OpenAI Speech endpoints (`gpt-4o-mini-transcribe` for STT, `gpt-4o-mini-tts` by default for synthesis) and capture responses in the interaction logs.
- `ENABLE_VOICE_ECHO` governs whether the original user audio is echoed back as a TTS response.

- Audio recorder/upload controls live in the React chat UI (`client/src/App.tsx`) using the browser `MediaRecorder` API when available.
- Playback UI renders transcripts and audio players; falls back to text when TTS is disabled.
- Attachments flagged as audio trigger voice agent routing automatically.

### Configuration & Environment
- `.env.example` documents all audio-related variables (`ENABLE_TTS_RESPONSES`, `TTS_RESPONSE_AGENTS`, `ENABLE_VOICE_ECHO`, `ENABLE_TRANSCRIPTION_CONFIRMATION`, `OPENAI_SPEECH_MODEL`, `OPENAI_SPEECH_VOICE`, `OPENAI_SPEECH_FORMAT`). Defaults are reflected there and described in the README.
- Developers must populate `OPENAI_API_KEY`; audio features respect the same key.

- Audio uploads, transcription attempts, retries, and errors emit `[speechService]` logs to stdout, and the orchestrator writes the voice agent’s debug payload (stored paths, metadata, errors) into the per-conversation log entries.
- Guardrail checks log acceptance/blocks, including transcription confirmation prompts.
- Future improvement: merge MCP debug logs into the same interaction file (tracked separately).

### Testing & QA
- Backend: Vitest suites exercise audio service validation, speech service retry logic (with mocks), and guardrail pathways.
- Frontend: component tests cover recorder state transitions; manual smoke tests verify recording, upload, playback, and TTS toggles.
- Manual checklist maintained to ensure happy-path and error scenarios behave correctly across browsers.

## Approval Checklist
- [x] Plan reviewed and updated to reflect implementation.
- [x] Initial development tasks completed with conventional commits.
- [x] QA plan executed for current features; follow-up items tracked above.

## Future Enhancements
- Integrate FFmpeg-based transcoding in `audioService.transcodeAudio` to normalize sample rates and formats.
- Expand voice agent to support streaming responses (real-time transcription/playback) once the Agents SDK supports streaming tool calls for audio.
- Add retention policies or cleanup tasks for stored audio files if storage volume becomes a concern.
