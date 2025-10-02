# Time Helper Extension Plan

Goal: teach the existing `time_helper` agent to answer broader time-based queries — current time, sunrise/sunset, moonrise/moonset, and notable calendar events — while keeping all tooling inside the existing MCP framework.

## Overview
- Expand the current MCP location server (and client tool) so the time helper can call additional MCP tools.
- New MCP endpoints:
  1. `resolve_location` *(existing)* — already returns timezone metadata.
  2. `get_sun_times` — returns sunrise and sunset timestamps for the resolved location/date.
  3. `get_moon_times` — returns moonrise and moonset timestamps for the resolved location/date.
  4. `get_calendar_events` — surfaces notable calendar items (e.g., public holidays) for the location/date.
- The time helper agent will decide which tool to invoke based on manager instructions or user phrasing after location resolution.

## Implementation Steps

1. **MCP Server Enhancements**
   - Extend the existing MCP server (`server/src/mcp/locationServer.ts`) with additional tool definitions.
   - Use astronomy libraries (e.g., `suncalc`) for sun/moon calculations; preload or lazily cache results.
   - For calendar data, start with a static/on-the-fly provider (e.g., `date-holidays`) scoped to supported countries/states.
   - Log each tool invocation with enough context to reuse existing guardrail analysis.

2. **MCP Client Wiring**
   - Update the MCP client adapter used by the time helper (`server/src/agents/timeHelperAgent.ts`) to expose the new tool names.
   - Normalize responses (e.g., ISO datetime strings) so prompts stay simple.

3. **Time Helper Prompt Logic**
   - Adjust the agent’s system prompt to describe the richer toolset.
   - Add intent detection to choose between current time, sun times, moon times, or calendar queries.
   - Maintain a single MCP session per request so multiple tools (e.g., location + sunset) can run sequentially.

4. **Guardrails + Logging**
   - Ensure guardrail metadata includes the chosen tool so audits can see why a response path was selected.
   - Add debug statements around tool selection and fallback flows.

5. **Configuration & Documentation**
   - Introduce any env flags for enabling/disabling specific tools (e.g., `ENABLE_SUN_TIMES`, `ENABLE_CALENDAR_EVENTS`).
   - Document new capabilities in the README and relevant docs.

6. **Testing**
   - Unit tests for MCP tool wrappers (mock astronomy/calendar libraries).
   - Integration tests that exercise full conversation flows (sunset, holiday, moonrise) under guardrails.

## Future Considerations
- Add planetary visibility or meteor shower data via additional MCP tools.
- Allow the manager to combine multiple results (e.g., “What’s the time and sunset today?”) by composing tool calls.
- Cache common holiday lookups to avoid repeated calculations.

---

## Implementation Notes (2025-10-01)
- MCP server now exposes `get_sun_times`, `get_moon_times`, and `get_calendar_events` alongside the existing `resolve_location` tool. Helpers in `server/src/mcp/timeUtils.ts` handle timezone-aware conversions.
- `TimeHelperAgent` classifies each request (current time, sun, moon, calendar), routes to the appropriate tool, and formats the response. When the resolver returns multiple matches it pauses for clarification before making downstream calls.
- Conversation logs capture every tool invocation with `tool` metadata so you can trace why a particular answer was produced.
- Vitest coverage exercises the new utilities and formatter routines to guard against formatting regressions.
