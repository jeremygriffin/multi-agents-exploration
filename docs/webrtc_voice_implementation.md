# WebRTC Voice Implementation Plan

## Overview
Introduce live WebRTC voice chat that complements the existing multi-agent text workflow. The solution keeps the backend in control of sessions, logging, and usage limits while the client delivers a seamless voice UX with fallbacks to the current upload-driven flow.

## Goals
- Allow users to toggle a "Voice Mode" in the client, capture microphone audio, and receive streamed audio answers.
- Preserve the current manager/specialist agent routing so voice interactions benefit from every existing tool.
- Maintain observability, usage limits, and guardrails already enforced by the backend.

## Core Requirements
1. **Client Voice UX**
   - Add a voice mode toggle/button and display states (connecting, active, muted, error).
   - Use `RTCPeerConnection` to send microphone audio, render remote audio, and surface live captions in the existing message list.
   - Keep the text input/upload flow available as fallback when WebRTC is unsupported or fails.

2. **Backend Session Bridge**
   - Expose a route that mints OpenAI Realtime ephemeral keys, seeds the active conversation context, and attaches usage metadata.
   - Proxy relevant Realtime events so manager decisions and agent tool outputs flow back to the WebRTC session.
   - Ensure credentials and join tokens never reach the browser directly without server mediation.

3. **Conversation Orchestration**
   - When transcripts arrive from the voice session, wrap them as manager inbound messages so existing agents continue to participate.
   - Stream the manager's replies to both the chat transcript and the Realtime session for audio synthesis/playback.
   - Support bidirectional audio/text so back-and-forth feels continuous.

4. **Instrumentation & Guardrails**
   - Extend logging with clear tags for the WebRTC bridge and Realtime events.
   - Reuse existing usage limit checks (audio transcription, TTS, message counts) and add new caps if needed.
   - Handle disconnects (user hang-up, timeout, network loss) by tearing down sessions cleanly and notifying the client.

## Key Decisions
- **Backend Bridge Over Direct Client Connection**: The backend remains responsible for creating Realtime sessions and injecting agent results. This keeps conversation state, policies, logging, and tool routing centralized while still delivering low-latency audio streams to the browser.
- **Reuse Existing Agents**: No new agent types required—the manager continues to delegate to specialists, and responses are surfaced through the voice channel in addition to text.
- **Progressive Enhancement**: WebRTC voice is additive; the existing upload-and-transcribe workflow stays available for unsupported browsers or restricted environments.

## Next Steps
1. Detail API contract and event sequencing between client, backend, and OpenAI Realtime.
   - Include the session handshake: client supplies the persisted `sessionId` in `x-session-id` and active `conversationId` in the request body; backend middleware (`sessionMiddleware`) verifies/rotates the session, binds the conversation, mints the Realtime ephemeral key, and returns the SDP offer bundle.
   - Voice transcripts forwarded from the bridge into `Orchestrator.handleUserMessage(..., { source: 'voice_transcription' })` keep the same session/conversation context so existing agents and limits stay aligned.
2. Design the React state machine for voice mode (permissions, connection lifecycle, errors).
   - The state machine should surface the voice session identifiers so we can emit logical, frequent client logs in line with the expectations in `docs/AGENTS.md`.
3. Implement backend bridge route and orchestration hooks.
   - Instrument with structured logs around join/leave, transcript ingestion, and agent responses to maintain observability.
4. Wire the client UI/connection logic and integrate with the chat transcript.
   - Ensure we log state transitions (connecting, connected, muted, error) and capture test hooks for QA/regression passes.
5. Add logging, usage-limit coverage, and manual test checklists.
   - Extend the checklist to cover voice session lifecycle, usage-limit triggers, and the additional logs/metrics we introduced.
