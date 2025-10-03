# WebRTC Voice Mode Plan

## Goals
- Support an optional "Live Talking" mode that streams microphone audio to the assistant and plays synthesized responses in real time.
- Reuse the existing voice agent for transcripts, storage, and routing so recorded uploads continue to work.
- Keep the new workflow behind an explicit UI control and feature flag while the implementation stabilizes.

## Non-Goals (Initial Phase)
- Replacing the existing upload/record-and-send flow; users must opt in to the new mode.
- Building a full SFU/MCU. We rely on peer-to-peer WebRTC with OpenAI's Realtime service for media exchange.
- Streaming the entire multi-agent Orchestrator loop; the realtime mode focuses on voice helper interactions and pushes summaries back afterward.

## Current State
1. The React client records clips with `MediaRecorder`, packages them as file attachments, and submits them with the text payload (`client/src/App.tsx`).
2. The server routes audio attachments to `VoiceAgent` for validation, transcription, optional TTS echo, and transcript persistence (`server/src/agents/voiceAgent.ts`).
3. Responses arrive as standard agent messages; playback happens via HTML `<audio>` tags.

This batch-based pipeline introduces noticeable latency because recording must complete before the server can process audio.

## Target Experience
1. User clicks **Enter Live Talking Mode**.
2. Browser negotiates a WebRTC session; once connected, the microphone streams immediately.
3. Assistant replies stream back as synthesized audio; transcription snippets surface in the chat when the turn completes.
4. User can exit live mode to fall back to the capture/send/play loop.

## Architecture Overview
- **Client**: Manage an `RTCPeerConnection` to OpenAI's Realtime endpoint using an ephemeral key minted by our server. Capture microphone audio with `getUserMedia`, send via WebRTC, and play the remote audio track through a dedicated `<audio>` element. Provide UI affordances to enter/exit live mode and show connection state/errors.
- **Server**: Add a `POST /api/voice/live/session` endpoint that checks usage limits, requests an ephemeral token from OpenAI (`POST https://api.openai.com/v1/realtime/sessions`), and returns the SDP offer payload plus metadata required by the client. Track live sessions so transcripts can be persisted via the existing voice agent when the session concludes.
- **Voice Agent Integration**: Introduce a `LiveVoiceSession` helper that receives streamed transcripts/events from OpenAI, converts them into canonical agent replies, and appends them to the conversation log. For the initial milestone we can log the realtime conversation and append a summary message when the session ends.
- **Flags & Config**: Gate the feature with `ENABLE_VOICE_LIVE_MODE` (server) and `VITE_ENABLE_VOICE_LIVE_MODE` (client). When disabled, the UI control is hidden and the endpoint returns 404.

## API & Signaling Flow
1. Client requests `POST /api/voice/live/session` with `conversationId` and `sessionId` headers.
2. Server validates usage limits, obtains ephemeral token + base session description from OpenAI, and responds with `{ ephemeralKey, model, iceServers }`.
3. Client creates an `RTCPeerConnection`, sets local description, and POSTs its SDP offer to `POST /api/voice/live/offer`.
4. Server forwards the offer to OpenAI Realtime via WebRTC REST helper, returns the SDP answer, and begins relaying events back to the orchestrator.
5. Bi-directional audio flows directly between client and OpenAI; the server listens to the Realtime event stream (WebSocket) to collect transcripts/metadata.

## Incremental Delivery
1. **Scaffolding & Flags**: Ship the UI toggle, server routes, and interfaces behind feature flags with stubbed responses that explain the feature is experimental.
2. **Signaling MVP**: Implement the ephemeral key request and offer/answer pass-through; verify round-trip connectivity manually.
3. **Agent Integration**: Capture realtime transcript events and convert them into `AgentReply` records so the conversation history includes a summary of the live exchange.
4. **Polish**: Stream partial transcripts, add metrics/logging, implement graceful reconnect, and expand automated tests.

## Testing Strategy
- Unit tests for new server utilities that call OpenAI's Realtime REST endpoints (mocking network interactions).
- Browser-level smoke test instructions documenting how to verify the live mode end-to-end.
- Feature-flag checks ensuring legacy voice flow stays unaffected when live mode is disabled.

## Open Questions
- Do we need to surface live captions in the UI, or is a post-session summary sufficient for the first release?
- Should we allow live mode to hand control back to other agents mid-session, or constrain it to the voice helper until the call ends?
- What's the retention expectation for realtime session artifacts (raw audio, transcripts)?
