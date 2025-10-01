# Voice Interaction Feature Plan

## Overview
- Introduce a voice-capable sub-agent that can handle audio input/output within the existing multi-agent workflow.
- Keep the initial scope to file passthrough and validation; defer heavy audio processing (e.g., FFmpeg transcoding) to a later iteration.

## Goals
- Allow users to upload short audio clips (supported formats only) that the manager agent can route to a new voice agent.
- Return synthesized speech responses to the frontend while preserving text transcripts for logging and storage consistency.
- Maintain the existing interaction logging conventions so MCP and SDK tool activity remains traceable.

## Deliverables
- Backend scaffolding for audio handling, including validation and future transcoding hooks.
- Voice agent definition wired into the manager routing logic and conversation history.
- Frontend UI updates to capture audio input, trigger playback of agent responses, and fall back to text when audio is unavailable.
- Tests covering audio validation, routing decisions, and UI state transitions.

## Implementation Steps

### 1. Backend Foundation
- Create `server/src/services/audioService.ts` with `validateMimeType` and `transcodeAudio` stubs (currently pass-through returning the original buffer) plus TODO for FFmpeg integration.
- Add unit tests (e.g., `server/src/services/__tests__/audioService.test.ts`) verifying accepted/rejected MIME types and pass-through behavior.
- Extend storage utilities to persist uploaded audio alongside generated transcripts in `server/storage`, following the timestamped naming scheme.

### 2. Voice Agent
- Define `VoiceAgent` using the Agents SDK with tools to:
  - Accept audio attachments from the manager (validated and stored via `audioService`).
  - Call OpenAI speech-to-text for transcription and text-to-speech for responses (now implemented with real OpenAI APIs, returning synthesized audio to the UI).
- Ensure the agent logs its tool inputs/outputs to the existing interaction log files for traceability.
- Update the manager agent routing rules so it detects audio inputs and delegates to `VoiceAgent`; allow `VoiceAgent` to hand control back when appropriate.

### 3. Frontend Enhancements
- Add audio recording/upload controls to the React chat UI (using the browser MediaRecorder API where available, with manual file upload fallback).
- Display audio message bubbles with play/pause controls; surface textual transcripts inline for accessibility.
- Update the attachment handling code path to recognize audio files and flag them for `VoiceAgent` routing.
- When `ENABLE_TTS_RESPONSES=true`, render synthesized audio clips for textual agent replies (default allowlist targets the time helper agent).

### 4. Configuration & Environment
- Document new environment variables (e.g., maximum audio duration, speech model names) in `README.md` and `.env.example` as needed. (Current defaults: `OPENAI_SPEECH_MODEL`, `OPENAI_SPEECH_VOICE`, `OPENAI_SPEECH_FORMAT`.)
- Provide developer setup instructions for enabling microphone permissions and testing audio playback locally.

### 5. Logging & Observability
- Augment existing logging so audio uploads, transcriptions, and synthesized outputs are captured with agent attribution in the per-interaction log files.
- Consider optional debug logging to show raw MCP tool payloads when dealing with audio attachments.

### 6. Testing & QA
- Backend: Jest/Vitest coverage for `audioService`, agent routing decisions, and mock speech API integrations.
- Frontend: Vite component tests (or Cypress smoke flows) ensuring the recorder, uploader, and playback controls behave across success/failure states.
- Manual scenario checklist covering upload-only, record-only, combined audio+text messages, and fallback paths when audio features are unavailable.

## Future Enhancements
- Integrate FFmpeg-based transcoding in `audioService.transcodeAudio` to normalize sample rates and formats.
- Expand voice agent to support streaming responses (real-time transcription/playback) once the Agents SDK supports streaming tool calls for audio.
- Add retention policies or cleanup tasks for stored audio files if storage volume becomes a concern.

## Approval Checklist
- [ ] Plan reviewed and approved.
- [ ] Development tasks scheduled with corresponding conventional commits.
- [ ] QA plan agreed upon before implementation.
