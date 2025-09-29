# Plan of Action

1. **Document foundations**
   - Capture all functional and non-functional requirements in `docs/requirements.md`.
   - Summarize the development roadmap in this plan prior to implementation.

2. **Project scaffolding**
   - Initialize backend (`/server`) with Express, TypeScript, and OpenAI Agents SDK dependencies.
   - Scaffold frontend (`/client`) with Vite + React + TypeScript; configure Vitest for testing.
   - Establish root-level npm scripts to run backend and frontend concurrently.

3. **Backend implementation**
   - Configure environment handling (`.env` for `OPENAI_API_KEY`).
   - Build agent modules: manager orchestrator plus four specialized agents (greeting, summarizer, time helper, input coach).
   - Implement conversation routing logic that invokes micro-agents on demand and enables them to pass control back to the manager.
   - Create REST endpoints for sending messages, retrieving active conversation history, and exposing interaction logs.
   - Implement per-conversation log files capturing prompts, agent invocations, and responses.

4. **Frontend chat interface**
   - Build a minimal React UI with chat history display and message input form.
   - Connect to backend endpoints to send messages and render agent responses, including agent attribution if provided.
   - Maintain chat history in component state (ephemeral, cleared on reload).

5. **Testing and tooling**
   - Add Vitest tests for critical frontend logic (e.g., message reducer, API client).
   - Optionally add backend tests for agent routing helpers if time permits.
   - Ensure linting/formatting scripts or configuration are documented if added.

6. **Final verification**
   - Run available tests and manual end-to-end checks.
   - Update documentation as needed with run instructions and observations.
