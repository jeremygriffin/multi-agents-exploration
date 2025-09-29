# Multi-Agent Lab

Local playground demonstrating the [OpenAI Agents SDK](https://github.com/openai/openai-agents-js) with a manager-directed multi-agent workflow. The backend orchestrates four specialist agents—greeting, summarizer, time helper, and input coach—and logs the full interaction trail so you can study how prompts are routed and answered. A lightweight React UI provides an ephemeral chat experience for experimenting from your localhost.

## Features
- Manager agent that selects and coordinates micro-agents per user message
- Greeting, summarizer, time helper, and input coach agents powered by OpenAI
- Express backend with per-conversation log files under `server/logs/`
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
Visit http://localhost:5173 to chat with the agents. Each conversation creates a UUID-named log file in `server/logs/` capturing user messages, manager plans, and agent responses.

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
└─ logs/                 # Generated per-conversation logs (gitignored)
```

Feel free to extend the agent roster, adjust routing logic, or integrate additional tools as you explore the SDK.
