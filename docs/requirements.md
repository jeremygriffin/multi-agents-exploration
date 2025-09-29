# Project Requirements

## Functional Requirements
- Provide a local-only learning tool demonstrating the OpenAI Agents SDK in a multi-agent workflow.
- Support four specialized agents:
  - Greeting agent for welcoming and identifying conversation intent.
  - Summarizing agent to condense conversation snippets on demand.
  - Time helper agent that answers world-time questions for various locales.
  - Input coach agent that analyzes conversation text for grammar/spelling improvements.
- Include a manager agent that routes user prompts to micro-agents and coordinates hand-offs between them.
- Trigger micro-agents on demand based on user prompts and agent responses.
- Maintain per-conversation interaction history accessible through the UI.
- Persist full interaction logs for each conversation in backend log files for later review.

## Non-Functional Requirements
- Run entirely on localhost for experimentation and learning.
- Use TypeScript across backend and frontend.
- Frontend built with React + Vite and provides a simple text chat interface with history.
- Backend implemented with Express (or similar) and integrates the OpenAI Agents SDK.
- Environment variable `OPENAI_API_KEY` sourced from a `.env` file.
- Ephemeral chat history in the frontend (reset on refresh); persistence handled server-side via logs only.
- Provide self-contained setup instructions and npm scripts to run client and server.
- Include automated tests using Vite/Vitest for the frontend (and backend if feasible).
- Log files stored per conversation, including prompts, agent routing decisions, and responses.
- Follow conventional commits with detailed bodies explaining why changes are required.
