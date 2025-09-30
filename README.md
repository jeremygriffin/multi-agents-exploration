# Multi-Agent Lab

Local playground demonstrating the [OpenAI Agents SDK](https://github.com/openai/openai-agents-js) with a manager-directed multi-agent workflow. The backend orchestrates four specialist agents—greeting, summarizer, time helper, and input coach—and logs the full interaction trail so you can study how prompts are routed and answered. A lightweight React UI provides an ephemeral chat experience for experimenting from your localhost.

## Features
- Manager agent that selects and coordinates micro-agents per user message
- Greeting, summarizer, time helper, input coach, and document store agents powered by OpenAI
- Time helper with selectable location resolver: built-in Agents SDK tool or MCP endpoint mounted locally
- Express backend with per-conversation log files under `server/logs/`
- Document storage workflow that saves uploads to `server/storage/` with auto-generated analysis notes
- React/Vite chat client showing agent attribution and manager notes
- TypeScript across backend and frontend with Vitest coverage for shared helpers

## Prerequisites
- Node.js 18+
- An OpenAI API key with access to the specified models

## Setup
1. Clone the repository and install workspace dependencies:
   ```bash
   npm install
   ```
2. Create `server/.env` with your API key (or export it in the shell):
   ```bash
   echo "OPENAI_API_KEY=sk-..." > server/.env
   ```
   Alternatively, export `OPENAI_API_KEY` before starting the server.

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

### Time Helper configuration

By default the time helper uses the Agents SDK function tool. To switch to the MCP-backed resolver, set:

```bash
export TIME_HELPER_LOCATION_PROVIDER=mcp
```

Optional overrides:

- `TIME_HELPER_MCP_URL` – defaults to `http://127.0.0.1:${PORT:-3001}/mcp/location`. Point to another MCP server if desired.

The MCP resolver is exposed locally at `/mcp/location` via the Streamable HTTP transport so you can observe raw tool calls separately from the Agents SDK workflow.

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
