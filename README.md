# Multi-Agent Lab

Local playground demonstrating the [OpenAI Agents SDK](https://github.com/openai/openai-agents-js) with a manager-directed multi-agent workflow. The backend orchestrates a half-dozen specialist agents—greeting, summarizer, time helper, input coach, document store, and the new voice agent—and logs the full interaction trail so you can study how prompts are routed and answered. A lightweight React UI provides an ephemeral chat experience for experimenting from your localhost.

## Features
- Manager agent that selects and coordinates micro-agents per user message
- Greeting, summarizer, time helper, input coach, document store, and voice agents powered by OpenAI
- Time helper with selectable location resolver: built-in Agents SDK tool or MCP endpoint mounted locally
- Extended time helper answers (current time, sunrise/sunset, moonrise/moonset, public holidays) via MCP tools
- Express backend with per-conversation log files under `server/logs/`
- Input and response guardrails for moderation, attachment validation, and answer quality checks
- Session-aware conversations with a "New Session" reset in the UI plus configurable per-session/IP usage limits for messages, uploads, audio transcription, and TTS generation
- Optional usage telemetry flag that, when enabled, logs per-request counters and token consumption for auditing quotas
- Document storage workflow that saves uploads to `server/storage/` with auto-generated analysis notes
- React/Vite chat client showing agent attribution, manager notes, and inline audio playback for captured and synthesized voice responses
- TypeScript across backend and frontend with Vitest coverage for shared helpers

## Prerequisites
- Node.js 18+
- An OpenAI API key with access to the specified models

## Setup
1. Clone the repository and install workspace dependencies:
   ```bash
   npm install
   ```
2. Create `server/.env` with your API key and Prompt Security App ID (or export them in the shell):
   ```bash
   cat <<'EOF' > server/.env
   OPENAI_API_KEY=sk-...
   PROMPT_SECURITY_APP_ID=ps-...
   EOF
   ```
   Alternatively, export both variables before starting the server. Set `USE_PROMPT_SECURITY=true` to send all OpenAI traffic
   through the Prompt Security gateway at `https://useast.prompt.security/v1/`; otherwise requests go directly to OpenAI.

## Running Locally
Open two terminals:
1. Start the backend orchestrator on port 3001:
   ```bash
   npm run dev:server
   ```
2. Launch the React client on port 5173:
   ```bash
   npm run dev:client
   ```
Visit http://localhost:5173 to chat with the agents. Each conversation creates a UUID-named log file in `server/logs/` capturing user messages, manager plans, and agent responses. Attach a `.pdf`, `.doc`, `.docx`, `.txt`, or `.md` file alongside a prompt such as “store this file” to trigger the document store agent.

When testing voice features, grant microphone access in your browser. Recordings are optional—drag and drop or upload existing audio clips if you prefer.

### Time Helper configuration

By default the time helper uses the Agents SDK function tool. To switch to the MCP-backed resolver, set:

```bash
export TIME_HELPER_LOCATION_PROVIDER=mcp
```

Optional overrides:

- `TIME_HELPER_MCP_URL` – defaults to `http://127.0.0.1:${PORT:-3001}/mcp/location`. Point to another MCP server if desired.

When MCP mode is enabled the agent can:
- Fetch current local time (default behaviour)
- Compute sunrise and sunset times using the `get_sun_times` tool (requires location coordinates)
- Compute moonrise and moonset via `get_moon_times`
- Surface notable calendar events/holidays with `get_calendar_events`

These tools return ISO timestamps that the agent reformats for conversation responses, and each invocation is logged in the conversation log with `tool` metadata for auditing.

The MCP resolver is exposed locally at `/mcp/location` via the Streamable HTTP transport so you can observe raw tool calls separately from the Agents SDK workflow.

## Voice interactions
- Start a recording from the client UI or upload a prerecorded audio file (supported types include MP3, WAV, WebM/Opus, AAC, FLAC, and MP4 audio).
- Recordings are stored under `server/storage/` with timestamped filenames alongside a Markdown transcript placeholder (`*.transcript.md`) ready for a speech-to-text integration.
- Agent replies include the original audio as a base64 data URI when transcription fails, or a synthesized text-to-speech rendition of the transcript when available.
- For browsers without MediaRecorder support, upload mode remains available.
- Environment knobs:
  - `OPENAI_SPEECH_MODEL` (default `gpt-4o-mini-tts`)
  - `OPENAI_SPEECH_VOICE` (default `alloy`)
  - `OPENAI_SPEECH_FORMAT` (default `mp3`)
- `ENABLE_TTS_RESPONSES` (`true` to synthesize agent replies)
- `TTS_RESPONSE_AGENTS` (comma-separated allowlist, default `time_helper`)
- `ENABLE_VOICE_ECHO` (`true` to have the voice agent replay the user’s recording)

### Available agents

Agent identifiers referenced by `TTS_RESPONSE_AGENTS` (and in logs) are:
- `greeting` – welcomes the user and handles small-talk context switches.
- `summarizer` – produces conversation recaps on demand.
- `time_helper` – resolves locations/time zones and returns current time information.
- `input_coach` – suggests grammar/spelling improvements for user prompts.
- `document_store` – ingests uploaded documents, stores them, and generates summaries.
- `voice` – processes audio inputs (transcription + optional echo playback).
- `guardrail` – virtual responder used when safety checks block a request or ask for clarification.

See `docs/AGENTS.md` for a full roster overview, logging expectations, and contribution guidelines.

## Guardrails

Two safeguard layers run around every interaction and can be tuned via environment variables found in `server/.env.example`:

- **Input guardrails** (`ENABLE_INPUT_MODERATION`, `INPUT_MODERATION_THRESHOLD`, `INPUT_ATTACHMENT_MAX_BYTES`, `ENABLE_TRANSCRIPTION_CONFIRMATION`)
  - Blocks disallowed prompts using OpenAI moderation, enforces attachment type/size rules, and double-checks very short voice transcripts before routing them to specialists.
  - When triggered the user sees a guardrail response and the conversation log records the reason under `stage: "input"`.
- **Response guardrails** (`ENABLE_RESPONSE_GUARD`, `RESPONSE_GUARD_AGENTS`, `RESPONSE_GUARD_MODEL`, `RESPONSE_GUARD_RECOVERY`)
  - Validates specialist answers before they reach the client. If a mismatch is detected it can log the issue, ask the user for clarification, or retry the specialist with corrective instructions.
  - All outcomes are appended to the conversation log (`stage: "response"`) so you can audit why a reply was accepted, retried, or replaced with a guardrail clarification.

Console output includes `[guardrails][input]` and `[guardrails][response]` debug lines so you can follow the decision flow while developing locally.

## Environment Variables

Use `server/.env` (or shell exports) to override the defaults shown in `server/.env.example`. Unless noted otherwise, omit a variable to fall back to the documented default.

- `OPENAI_API_KEY` *(required)* – API key with access to the referenced models.
- `TIME_HELPER_LOCATION_PROVIDER` – choose how the time helper resolves locations; allowed values: `agents_sdk` or `mcp` (default `agents_sdk`).
- `TIME_HELPER_MCP_URL` – optional URL for an alternate MCP server.
- `OPENAI_SPEECH_MODEL` – text-to-speech model name (default `gpt-4o-mini-tts`).
- `OPENAI_SPEECH_VOICE` – voice preset supported by the chosen speech model (default `alloy`).
- `OPENAI_SPEECH_FORMAT` – audio container returned by synthesized speech, e.g., `mp3`, `opus`, `wav` (default `mp3`).
- `ENABLE_TTS_RESPONSES` – `true`/`false`; synthesize specialist replies for agents listed in `TTS_RESPONSE_AGENTS` (default `false`).
- `TTS_RESPONSE_AGENTS` – comma-separated agent IDs (see “Available agents”) eligible for TTS synthesis (default `time_helper`).
- `ENABLE_VOICE_ECHO` – `true`/`false`; when `true` the voice agent echoes user recordings back after transcription (default `false`).
- `ENABLE_INPUT_MODERATION` – `true`/`false`; enable OpenAI moderation checks on user text before routing (default `false`).
- `INPUT_MODERATION_THRESHOLD` – number between `0` and `1`; minimum category score required to block a moderated request (default `0.5`).
- `INPUT_ATTACHMENT_MAX_BYTES` – positive integer byte limit for uploaded attachments (default `10485760`, i.e., 10 MB).
- `ENABLE_TRANSCRIPTION_CONFIRMATION` – `true`/`false`; require confirmation for very short voice transcripts before continuing (default `false`).
- `ENABLE_RESPONSE_GUARD` – `true`/`false`; turn on the response validation layer (default `false`).
- `RESPONSE_GUARD_AGENTS` – comma-separated agent IDs to evaluate (default `time_helper`).
- `RESPONSE_GUARD_RECOVERY` – recovery strategy when a mismatch is detected; allowed values: `clarify`, `retry`, `log_only` (default `clarify`).
- `RESPONSE_GUARD_MODEL` – language model used by the response guard evaluator (default `gpt-4o-mini`).
- **Usage limits** (all values are positive integers; set to `0` or omit the variable to disable the corresponding cap):
  - `USAGE_LIMIT_MESSAGES_PER_SESSION` / `USAGE_LIMIT_MESSAGES_PER_IP` – daily cap on routed text messages (defaults: `200` per session, `400` per IP).
  - `USAGE_LIMIT_FILE_UPLOADS_PER_SESSION` / `USAGE_LIMIT_FILE_UPLOADS_PER_IP` – daily cap on stored document uploads (defaults: `20` per session, `40` per IP).
  - `USAGE_LIMIT_AUDIO_TRANSCRIPTIONS_PER_SESSION` / `USAGE_LIMIT_AUDIO_TRANSCRIPTIONS_PER_IP` – daily cap on audio-to-text requests handled by the voice agent (defaults: `50` per session, `80` per IP).
  - `USAGE_LIMIT_TTS_PER_SESSION` / `USAGE_LIMIT_TTS_PER_IP` – daily cap on synthesized text-to-speech responses (defaults: `200` per session, `400` per IP).
  - `ENABLE_USAGE_LOGS` – when set to `true`, emit dedicated `usage` log entries (including token counts) alongside normal interaction logs.

## Testing & Builds
- Run tests across workspaces:
  ```bash
  npm run test
  ```
- Build the client for production:
  ```bash
  npm run build
  ```

## Project Structure
```
project/
├─ docs/                 # Requirements and high-level plan
├─ server/               # Express orchestrator, agents, and logging utilities
├─ client/               # React/Vite chat UI
├─ logs/                 # Generated per-conversation logs (gitignored)
└─ storage/             # Uploaded documents and analysis notes (gitignored)
```

Feel free to extend the agent roster, adjust routing logic, or integrate additional tools as you explore the SDK.
