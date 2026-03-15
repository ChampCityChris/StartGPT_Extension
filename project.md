# project.md

## Project identity

This repository is a Firefox WebExtension project named **Startpage + ChatGPT Sidebar**.

Its purpose is to provide a personal-use browser extension that:

- runs on Firefox and Zen-style Mozilla-based browsers
- reads visible search results from Startpage
- opens or reuses a ChatGPT bridge tab on `chatgpt.com`
- submits a grounded prompt based on the visible Startpage results
- shows the returned overview in an extension sidebar
- optionally injects a compact overview card into the Startpage results page
- does not use the OpenAI API
- does not include any backend
- does not store or expose any API key

Optimize for:

1. correctness
2. maintainability
3. clear file structure
4. deterministic behavior
5. low complexity
6. easy debugging
7. minimal assumptions about site DOM

---

## Architecture constraints

You MUST follow this architecture:

- Startpage content script extracts query and visible search results
- background script coordinates state and messaging
- sidebar page shows answer, status, and actions
- ChatGPT bridge content script is the only code that automates `chatgpt.com`

You MUST keep all site-specific selectors isolated in dedicated selector files.

You MUST keep extraction logic in pure helper modules when possible.

You MUST keep UI rendering separate from extraction logic.

---

## Hard rules

1. Do not add any backend.
2. Do not add OpenAI API usage.
3. Do not ask for an API key.
4. Do not add analytics or telemetry.
5. Do not add code that attempts to automate login or bypass CAPTCHA.
6. Do not inject unsanitized HTML from Startpage or ChatGPT into extension UI.
7. Do not scatter raw selector strings across multiple files.
8. Do not use frameworks unless explicitly requested.
9. Do not refactor unrelated files when working on a targeted task.
10. Do not silently swallow failures.
11. Do not create hidden background polling loops without explicit need.
12. Do not hardcode one fragile ChatGPT selector and call it done.
13. Do not store full raw page HTML in persistent storage.
14. Do not use TypeScript unless explicitly requested.
15. Do not over-engineer v1.

---

## File design rules

### `background/`

Keep `background.js` small. Put logic into helpers such as:

- `state.js`
- `tab-manager.js`
- `prompt-builder.js`
- `message-router.js`
- `constants.js`

### `content/`

Split by concern:

- `startpage.js` for Startpage page integration
- `chatgpt-bridge.js` for ChatGPT automation
- `dom/` for selectors and extraction helpers
- `inject/` for UI injected into pages
- `shared/` for message constants, schemas, sanitize helpers

### `sidebar/`

Sidebar files must only handle sidebar UI and events.

### `popup/`

Popup files must only handle quick controls.

### `options/`

Options page owns settings storage UI.

---

## Messaging rules

All extension messaging MUST use named message constants.

Do not use magic strings directly in send/listener code.

Every message payload should have a predictable shape.

Where appropriate, validate payload structure before use.

Preferred pattern:

- define constants in `message-types.js`
- validate in `schema.js`
- route centrally through `message-router.js`

---

## State rules

Use a single runtime state model for:

- settings
- Startpage tab sessions
- bridge tab linkage
- latest response
- last error
- current status

Rules:

1. Settings may persist in `browser.storage.local`.
2. Runtime session state should remain in memory unless persistence is clearly needed.
3. All state updates should happen through small named functions.
4. Avoid ad hoc state mutation across files.

---

## DOM automation rules

### Startpage

Extract only what is visible and needed:

- query
- title
- URL
- snippet
- rank
- optional display URL

Ignore ads and irrelevant widgets where practical.

Fail clearly if selectors no longer match.

### ChatGPT

Treat ChatGPT DOM as unstable.

Requirements:

- use multiple candidate selectors
- isolate them in one selector module
- detect missing composer cleanly
- detect likely logged-out state
- detect response start and completion
- extract latest assistant response only
- extract source links if present
- return normalized text and sources

Do not assume a single selector will survive.

---

## Sanitization rules

Sanitize all text before rendering.

Rules:

1. Prefer `textContent` over `innerHTML`.
2. Escape strings before building HTML.
3. Never trust text or HTML extracted from web pages.
4. If limited HTML rendering is needed, build it from safe primitives you control.

---

## Error handling rules

Every user-visible failure must produce:

- a stable error code
- a readable message
- a recoverable flag when appropriate

Suggested error families:

- Startpage extraction failures
- ChatGPT readiness failures
- prompt submission failures
- response timeout failures
- response parsing failures
- tab lifecycle failures
- message routing failures

Do not hide errors in console only.

Show them in sidebar and page card when relevant.

---

## Testing rules

Write tests for pure helpers.

At minimum, cover:

- prompt builder
- Startpage extraction helper
- ChatGPT response extraction helper
- state helpers

Use HTML fixtures for extraction tests.

Do not try to fully automate real ChatGPT end-to-end tests in CI for v1.

Manual smoke testing is acceptable for full browser behavior.

---

## Project-specific debugging checklist

For this extension, the most deceptive failures are usually lifecycle and readiness issues rather than pure selector mismatches.

Check these in order:

1. Was the Startpage context captured correctly?
2. Did the sidebar panel actually open in the relevant tab?
3. Did the ChatGPT bridge loader run?
4. Did the bridge module load successfully?
5. Did the runtime port register with background?
6. Did background confirm bridge readiness with a ping?
7. Is ChatGPT logged in?
8. Is the composer available and interactive?
9. Did submit change the page state?
10. Did the response start?
11. Did the response complete and parse?

Do not skip ahead to response parsing if bridge readiness is still unproven.

---

## Delivery strategy

Build in this order:

1. scaffold extension structure
2. manifest + popup + sidebar shell
3. Startpage page detection
4. Startpage extraction
5. background state and message flow
6. page card injection
7. ChatGPT bridge tab handling
8. prompt submission
9. response extraction
10. end-to-end orchestration
11. follow-up flow
12. polish and hardening

Do not start by overbuilding the hardest automation piece.

---

## Definition of done for v1

The extension is v1-complete only when all of the following are true:

1. loads in Firefox as a temporary add-on
2. detects Startpage search results pages
3. extracts query and top results reliably
4. shows captured state in the sidebar
5. opens or reuses a ChatGPT bridge tab
6. submits a grounded prompt to ChatGPT
7. extracts the returned answer
8. renders answer in sidebar
9. optionally renders a compact overview card on Startpage
10. shows user-visible errors for failures
11. contains no backend and no API key usage
12. includes tests for pure helpers
13. README accurately matches implementation

---

## When asked to code

When given a coding task:

1. identify the exact files to create or edit
2. preserve the existing architecture
3. make the smallest coherent change
4. update tests if relevant
5. explain any selector assumptions
6. avoid speculative features not requested

---

## When blocked

If a required DOM selector or browser API behavior is uncertain:

1. isolate the assumption in one place
2. label it clearly
3. implement the safest fallback
4. expose a visible debug signal
5. do not invent fake reliability

Use short `TODO (human):` notes only when absolutely necessary.

---

## Summary directive

Build a clean, modular, no-API Firefox extension that uses:

- Startpage for retrieval
- ChatGPT web UI for synthesis
- a sidebar for the main user experience
- defensive DOM automation
- explicit errors
- small testable helpers
