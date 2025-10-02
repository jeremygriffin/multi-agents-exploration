# Agents Overview

This project orchestrates a set of specialist agents using the OpenAI Agents SDK and a local MCP server. The manager agent routes user requests to the appropriate specialist and re-integrates their responses.

## Agent Roster

| Agent ID          | Role / Responsibilities                                                                                   |
|-------------------|------------------------------------------------------------------------------------------------------------|
| `manager`         | Primary orchestrator; plans actions, delegates to specialists, and writes summary notes for the client UI. |
| `greeting`        | Welcomes the user, provides onboarding guidance, and handles light small talk.                             |
| `summarizer`      | Generates recaps of the conversation on demand.                                                            |
| `time_helper`     | Resolves locations, time zones, sunrise/sunset, moon phases, and calendar events via SDK or MCP tools.     |
| `input_coach`     | Suggests grammar and clarity improvements for user prompts.                                                 |
| `document_store`  | Stores uploaded files, writes analysis stubs, and responds with storage details.                           |
| `voice`           | Transcribes uploaded/recorded audio, optionally echoes the clip, and synthesizes replies when enabled.     |
| `guardrail`       | Virtual agent that surfaces safety/mismatch feedback from input and response guard services.               |

The voice and time helper agents support both native Agents SDK tools and an MCP bridge so you can compare workflows.

## Logging Expectations

- Every agent writes debug payloads that surface inputs, tool invocations, and notable metadata into the per-conversation log files under `server/logs/`.
- The server console should include descriptive debug statements (e.g., `[guardrails][input]`, `[speechService]`, `[MCP]`) so behaviour can be traced live. New features must add similar logs for observability.
- When extending agents or adding tools, ensure their actions appear in the interaction logs so a reviewer can follow the entire request/response chain.

## Contribution Guidelines

- Use [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) for all commits **and always include a body** explaining why the change is needed (the upstream spec treats the body as optional; this project requires it).
- Keep commits logically scoped so reviewers can follow the evolution of each feature or fix without sifting through unrelated edits.
- When introducing new behaviours, add targeted debug logging to aid testing and future troubleshooting.
