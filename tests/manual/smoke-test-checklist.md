# Smoke Test Checklist

## Setup
- Load extension as a temporary add-on in Firefox.
- Confirm the browser sidebar opens once with the "StartGPT is loaded" message.
- Close the sidebar and confirm it stays closed until a Startpage results page is captured.
- Open DevTools for:
  - Startpage tab
  - ChatGPT sidebar page
  - extension background page
- Open the options page and verify default settings load.

## Settings Persistence
- Toggle each setting and click `Save settings`:
  - auto-run on Startpage
  - auto-inject overview card
  - max results
  - prompt mode
  - debug mode
- Reload the options page and confirm all values persist.

## Startpage Capture + Card
- Visit a Startpage results page.
- Confirm the overview card appears above results.
- Confirm status transitions at minimum through:
  - captured
  - opening_bridge
  - waiting_for_response
  - completed (or failed)
- Confirm errors are visible on the card if a run fails.

## Sidebar + Debug Surface
- Open the sidebar while on a Startpage results tab.
- Confirm query, status, response, and sources are shown.
- Enable debug mode in options and reload sidebar.
- Confirm debug panel shows:
  - last prompt
  - last error code
  - bridge runtime instance
  - submit diagnostics (`submitPath`, `ackReason`, attempts)
  - run timeline with per-stage durations
  - selector hit/miss diagnostics

## Sidebar Bridge Lifecycle
- Trigger `Open ChatGPT Sidebar` from the diagnostics UI.
- Confirm the browser sidebar opens to `chatgpt.com`.
- Confirm a sidebar bridge instance appears in popup/sidebar diagnostics once ChatGPT finishes loading.
- Confirm a Startpage results capture reopens the sidebar after you manually close it.

## Follow-up Flow
- Submit a follow-up question from sidebar.
- Confirm status transitions update and a new response arrives.
- Confirm follow-up reuses the same sidebar bridge instance when available.

## Selector Drift / Timeout Checks
- In the ChatGPT sidebar, force a non-ready state (for example logged out or UI mismatch).
- Trigger a run and confirm user-visible failure with clear code/message.
- Confirm debug panel selector diagnostics indicate misses.
- Confirm popup diagnostics include a run timeline that makes the slowest stage obvious.
- Confirm timeout failures include retry-aware messaging.

## Regression Sanity
- Popup opens and sidebar action still works.
- Options save still updates runtime behavior without extension reload.
- No API keys, backend calls, or telemetry are introduced.
