# Startpage + ChatGPT Sidebar Extension

## Purpose

Build a Firefox WebExtension that:

- uses **Startpage** as the visible search engine
- adds a **persistent sidebar** inside Firefox
- keeps **ChatGPT** in the workflow without using the OpenAI API
- sends the active Startpage query and visible result snippets to the extension
- uses the browser sidebar on `chatgpt.com` plus content scripts to submit a grounded prompt into the user's logged-in ChatGPT session
- displays:
  - a full response inside the sidebar
  - an optional compact overview card above Startpage search results

This project is for **personal use** and is intentionally designed around browser automation of the ChatGPT web app. That makes it workable, but brittle. The most likely breakage points are changes to:

- Startpage DOM structure
- ChatGPT DOM structure
- Firefox extension behavior around tabs, sidebars, and permissions

---

## Product goals

### Core goals

1. Keep the user on **Startpage** for search results.
2. Avoid Google AI Overview entirely.
3. Use **ChatGPT in a sidebar-like experience**.
4. Ground the answer in the **actual visible Startpage query and top search results**.
5. Preserve a conversational workflow for follow-up questions.

### Non-goals

1. Do not use the OpenAI API.
2. Do not scrape remote pages from a backend.
3. Do not depend on unstable Google selectors.
4. Do not promise unattended reliability against ChatGPT UI changes.
5. Do not try to automate login, CAPTCHA solving, or account recovery.

---

## High-level architecture

```text
Startpage tab
  └─ content script
       ├─ extracts query + top results
       ├─ renders optional on-page overview card
       └─ sends page context to background

Background script
  ├─ stores latest query/result payload per tab
  ├─ manages extension state
  ├─ opens/reuses the ChatGPT sidebar bridge
  ├─ relays messages between Startpage, sidebar, and ChatGPT
  └─ handles failures, retries, and user commands

Sidebar page
  ├─ shows status and logs
  ├─ shows latest grounded overview
  ├─ allows regenerate / summarize / compare / ask follow-up
  └─ mirrors final answer and citations for the current search

ChatGPT sidebar bridge
  └─ content script
       ├─ waits for chatgpt.com UI readiness
       ├─ creates or reuses a conversation
       ├─ injects grounded prompt into composer
       ├─ optionally triggers Search mode
       ├─ detects response completion
       ├─ extracts answer text + source links
       └─ reports parsed output back to background
```

---

## Why this architecture

This design separates responsibilities cleanly:

- **Startpage content script** handles extraction from the current search page only.
- **Background script** is the controller and source of truth.
- **Sidebar** is the persistent user interface.
- **ChatGPT bridge script** is the only place that touches ChatGPT DOM.

That separation matters because both Startpage and ChatGPT will change over time. Keeping each site-specific automation isolated reduces blast radius.

---

## Extension file layout

```text
startpage-chatgpt-sidebar/
├─ README.md
├─ AGENTS.md
├─ agent.md
├─ PROMPTS.md
├─ package.json
├─ .gitignore
├─ web-ext.config.mjs
├─ scripts/
│  ├─ pack.mjs
│  ├─ lint.mjs
│  └─ release.mjs
├─ src/
│  ├─ manifest.json
│  ├─ background/
│  │  ├─ background.js
│  │  ├─ state.js
│  │  ├─ tab-manager.js
│  │  ├─ prompt-builder.js
│  │  ├─ message-router.js
│  │  └─ constants.js
│  ├─ sidebar/
│  │  ├─ sidebar.html
│  │  ├─ sidebar.css
│  │  ├─ sidebar.js
│  │  ├─ components/
│  │  │  ├─ status-banner.js
│  │  │  ├─ result-card.js
│  │  │  ├─ source-list.js
│  │  │  └─ action-bar.js
│  │  └─ store.js
│  ├─ popup/
│  │  ├─ popup.html
│  │  ├─ popup.css
│  │  └─ popup.js
│  ├─ content/
│  │  ├─ startpage.js
│  │  ├─ chatgpt-bridge.js
│  │  ├─ dom/
│  │  │  ├─ startpage-selectors.js
│  │  │  ├─ chatgpt-selectors.js
│  │  │  ├─ extract-startpage-results.js
│  │  │  ├─ extract-chatgpt-response.js
│  │  │  └─ dom-utils.js
│  │  ├─ inject/
│  │  │  ├─ overview-card.js
│  │  │  └─ loading-state.js
│  │  └─ shared/
│  │     ├─ message-types.js
│  │     ├─ schema.js
│  │     └─ sanitize.js
│  ├─ options/
│  │  ├─ options.html
│  │  ├─ options.css
│  │  └─ options.js
│  └─ assets/
│     ├─ icon-16.png
│     ├─ icon-32.png
│     ├─ icon-48.png
│     └─ icon-128.png
└─ tests/
   ├─ unit/
   │  ├─ prompt-builder.test.js
   │  ├─ extract-startpage-results.test.js
   │  ├─ extract-chatgpt-response.test.js
   │  └─ state.test.js
   ├─ fixtures/
   │  ├─ startpage-results.html
   │  ├─ chatgpt-response.html
   │  └─ chatgpt-loading.html
   └─ manual/
      └─ smoke-test-checklist.md
```

---

## File responsibilities

## `src/manifest.json`

Defines:

- Manifest V3 extension metadata
- sidebar entry
- action popup
- permissions
- host permissions
- content scripts for Startpage and ChatGPT
- background script

### Required permissions

Use the smallest set that still works:

- `storage`
- `tabs`
- `activeTab`
- `sidebarAction` if needed for older Firefox APIs
- `scripting` only if actually needed
- host permissions:
  - `https://www.startpage.com/*`
  - `https://chatgpt.com/*`

Avoid optional permissions until the core workflow works.

---

## `src/background/background.js`

Main controller.

Responsibilities:

- initialize extension state
- receive extracted Startpage search context
- manage latest query context by tab
- open or focus the ChatGPT sidebar
- send grounded prompt payload to ChatGPT bridge script
- receive parsed ChatGPT response
- forward response to sidebar and Startpage tab
- track active run lifecycle
- debounce repeated triggers
- handle timeouts, retries, and stale responses

This file should stay thin. Complex logic belongs in helpers.

---

## `src/background/state.js`

Single source of truth for runtime state.

Suggested state shape:

```js
{
  settings: {
    autoRunOnStartpage: true,
    autoInjectOverviewCard: true,
    maxResults: 5,
    promptMode: "grounded_overview"
  },
  sessions: {
    [tabId]: {
      query: "",
      startpageUrl: "",
      capturedAt: 0,
      results: [],
      status: "idle",
      runId: "",
      lastError: null,
      response: null,
      bridgeTabId: null
    }
  },
  global: {
    activeSidebarTabId: null
  }
}
```

Rules:

- never mutate state ad hoc in unrelated files
- all updates go through small named functions
- keep state serializable
- storage-backed settings, memory-backed transient sessions

---

## `src/background/tab-manager.js`

Handles ChatGPT sidebar bridge lifecycle.

Responsibilities:

- find an existing `chatgpt.com` tab if reuse is enabled
- open new tab if none exists
- choose active vs background opening behavior
- ensure bridge content script is reachable
- recover if tab was closed or navigated away

Functions to implement:

- `ensureSidebarBridgeReady()`
- `forgetClosedBridgeContext()`

---

## `src/background/prompt-builder.js`

Builds the exact prompt sent into ChatGPT.

Input:
- query
- Startpage results array
- user mode
- optional user follow-up

Output:
- final prompt string

This module should be deterministic and easy to test.

### Prompt style goals

Prompt must:

- identify the exact user query
- list the visible Startpage results in rank order
- tell ChatGPT to produce an overview grounded in those results
- ask for disagreements and uncertainty
- avoid pretending the results are exhaustive
- request concise formatting suitable for a sidebar and search overview card

### Example prompt template

```text
You are helping summarize a search results page.

User query:
{{query}}

Visible Startpage results:
1. {{title}} — {{snippet}} — {{url}}
2. {{title}} — {{snippet}} — {{url}}
3. ...

Task:
- Write a concise overview of what these results suggest.
- Call out conflicting claims or uncertainty.
- Recommend which 1-3 results the user should click first and why.
- Keep the answer factual and compact.
- Use short sections.
- Do not claim to have opened any result unless explicitly stated.
```

---

## `src/background/message-router.js`

Centralizes all extension message handling.

Benefits:

- avoids giant `switch` blocks in `background.js`
- keeps message schemas obvious
- easier debugging

Suggested message groups:

- Startpage -> background
- sidebar -> background
- background -> ChatGPT bridge
- ChatGPT bridge -> background
- background -> Startpage
- background -> sidebar

---

## `src/background/constants.js`

Put all tunables here:

- timeouts
- polling intervals
- max result count
- retry counts
- DOM settle delays
- status strings
- URL match patterns

---

## `src/sidebar/sidebar.html`

Persistent extension UI.

Must include:

- title/header
- current query
- status indicator
- overview section
- sources list
- follow-up input
- regenerate button
- button to open/focus the ChatGPT sidebar
- error area
- debug details toggle

Avoid frameworks for v1.

---

## `src/sidebar/sidebar.js`

Sidebar controller.

Responsibilities:

- load current state from background
- display status updates
- show current query/result count
- show latest overview text
- render sources
- submit follow-up prompt requests
- allow regenerate
- show sidebar bridge readiness

---

## `src/popup/popup.html`

Small quick-control UI from toolbar button.

Suggested controls:

- open sidebar
- toggle auto-run
- toggle page card injection
- open options
- show bridge status
- run on current tab now

Popup should remain simple.

---

## `src/options/options.html`

Longer-lived settings page.

Suggested settings:

- auto-run on Startpage results pages
- auto-inject compact overview card
- max visible results to send
- debug mode (show diagnostics in sidebar)
- prompt mode:
  - grounded overview
  - compare results
  - click recommendations
  - follow-up assistant

Keep values in `browser.storage.local`.

---

## `src/content/startpage.js`

Runs on Startpage result pages.

Responsibilities:

- detect whether the page is a search results page
- wait for DOM stabilization
- extract query and top results
- send normalized payload to background
- render compact on-page overview card when enabled
- update if Startpage performs client-side navigation

This script should not directly know anything about ChatGPT DOM.

### Extraction targets

For each result:

- title
- URL
- visible snippet
- rank
- optional display URL text

### Rules

- ignore ads if possible
- ignore “people also search” style blocks if present
- cap result count with settings
- sanitize all extracted text
- fail gracefully when selectors do not match

---

## `src/content/chatgpt-bridge.js`

Runs on `chatgpt.com`.

This is the most fragile file in the project.

Responsibilities:

- detect ChatGPT page readiness
- detect login-required or blocked states
- locate composer
- optionally select Search tool if needed
- submit prompt text
- watch for streaming response completion
- parse response body
- extract source links if available
- return clean structured data to background

### Design rule

Keep site selectors centralized in `chatgpt-selectors.js`.
Do not scatter raw selectors through the logic.

### Required capabilities

1. `isChatGptReady()`
2. `isLoginRequired()`
3. `findComposer()`
4. `injectPrompt(text)`
5. `submitPrompt()`
6. `waitForAssistantResponseStart()`
7. `waitForAssistantResponseComplete()`
8. `extractLatestAssistantMessage()`
9. `extractCitations()`

### Failure states to handle

- not logged in
- composer not found
- send button disabled
- response never starts
- response starts but never completes
- DOM selector drift
- unexpected modals or onboarding UI

---

## `src/content/dom/startpage-selectors.js`

Single place for Startpage selectors.

Must expose functions rather than constants where practical:

- `getQueryNode(document)`
- `getResultNodes(document)`
- `getTitleNode(resultNode)`
- `getSnippetNode(resultNode)`
- `getLinkNode(resultNode)`

This makes fallback ordering easier.

---

## `src/content/dom/chatgpt-selectors.js`

Single place for ChatGPT selectors.

Must support multiple selector candidates for each target because ChatGPT UI changes.

Suggested pattern:

```js
export function findComposer(doc) {
  const selectors = [
    'textarea',
    '[contenteditable="true"]',
    '[data-testid="composer"]'
  ];
  for (const selector of selectors) {
    const node = doc.querySelector(selector);
    if (node) return node;
  }
  return null;
}
```

Never assume one selector will survive.

---

## `src/content/dom/extract-startpage-results.js`

Pure extraction helper.

Input:
- `document`
- `maxResults`

Output:

```js
{
  query: "...",
  results: [
    {
      rank: 1,
      title: "...",
      url: "https://...",
      snippet: "...",
      displayUrl: "..."
    }
  ]
}
```

Should be testable against saved HTML fixtures.

---

## `src/content/dom/extract-chatgpt-response.js`

Pure extraction helper.

Input:
- `document`

Output:

```js
{
  text: "...",
  html: "...",
  sources: [
    { title: "...", url: "https://..." }
  ]
}
```

Rules:

- return the latest assistant message only
- strip UI chrome
- normalize whitespace
- keep source order stable
- never execute remote HTML
- sanitize before any injection into extension UI

---

## `src/content/inject/overview-card.js`

Renders the compact card injected into Startpage results.

Card should include:

- "ChatGPT Overview" header
- status line
- summary text
- top 1-3 recommended clicks
- compact source list
- actions:
  - regenerate
  - open sidebar
  - open ChatGPT sidebar

Keep the card visually distinct from Startpage native UI.

---

## `src/content/shared/message-types.js`

Use constants, not magic strings.

Example:

```js
export const MSG = {
  STARTPAGE_CONTEXT_FOUND: "STARTPAGE_CONTEXT_FOUND",
  REQUEST_RUN_FOR_TAB: "REQUEST_RUN_FOR_TAB",
  BRIDGE_RUN_PROMPT: "BRIDGE_RUN_PROMPT",
  BRIDGE_RESPONSE_READY: "BRIDGE_RESPONSE_READY",
  RUN_FAILED: "RUN_FAILED",
  SIDEBAR_GET_STATE: "SIDEBAR_GET_STATE",
  SIDEBAR_REGENERATE: "SIDEBAR_REGENERATE",
  SIDEBAR_FOLLOW_UP: "SIDEBAR_FOLLOW_UP",
  PAGE_CARD_RENDER: "PAGE_CARD_RENDER"
};
```

---

## `src/content/shared/schema.js`

Provide lightweight runtime validators for message payloads.

Examples:

- `assertStartpageContext(payload)`
- `assertBridgeResponse(payload)`

This project does not need a heavy schema library in v1.

---

## `src/content/shared/sanitize.js`

Single place for sanitizing strings before UI rendering.

Rules:

- never inject unsanitized HTML from web pages
- prefer textContent over innerHTML
- only allow limited generated markup from our own renderer
- escape source labels and URLs before rendering

---

## Data contracts

## Startpage context payload

```js
{
  type: "STARTPAGE_CONTEXT_FOUND",
  tabId: 123,
  pageUrl: "https://www.startpage.com/...",
  query: "best linux distro for gaming nvidia 2026",
  capturedAt: 1710000000000,
  results: [
    {
      rank: 1,
      title: "Example result",
      url: "https://example.com/article",
      snippet: "Visible snippet text",
      displayUrl: "example.com"
    }
  ]
}
```

## Bridge run payload

```js
{
  type: "BRIDGE_RUN_PROMPT",
  runId: "uuid-like-string",
  sourceTabId: 123,
  query: "...",
  prompt: "...",
  results: [...]
}
```

## Bridge response payload

```js
{
  type: "BRIDGE_RESPONSE_READY",
  runId: "uuid-like-string",
  sourceTabId: 123,
  completedAt: 1710000009999,
  response: {
    text: "Summary text",
    sources: [
      { title: "Source 1", url: "https://..." }
    ]
  }
}
```

## Error payload

```js
{
  type: "RUN_FAILED",
  runId: "uuid-like-string",
  sourceTabId: 123,
  code: "CHATGPT_COMPOSER_NOT_FOUND",
  message: "Composer not found on chatgpt.com",
  recoverable: true
}
```

---

## End-to-end flow

## Flow A: automatic overview on Startpage results page

1. User searches on Startpage.
2. `startpage.js` detects search results.
3. Results are extracted and normalized.
4. Payload is sent to background.
5. Background stores context for that Startpage tab.
6. If auto-run is enabled, background builds prompt.
7. Background opens or reuses the ChatGPT sidebar.
8. Background sends `BRIDGE_RUN_PROMPT`.
9. `chatgpt-bridge.js` waits for page readiness.
10. Bridge injects prompt and submits it.
11. Bridge waits for assistant response completion.
12. Bridge parses text + sources.
13. Bridge reports parsed response to background.
14. Background stores response by source tab.
15. Sidebar updates.
16. Startpage page card updates.

## Flow B: manual run from popup or sidebar

1. User clicks toolbar button or sidebar action.
2. Background checks active tab.
3. If active tab is Startpage results, reuse stored or freshly extracted context.
4. Prompt is built and submitted through bridge.
5. Response is rendered.

## Flow C: follow-up question

1. Sidebar shows previous result.
2. User types follow-up.
3. Background creates a new prompt referencing:
   - original query
   - original result set
   - prior answer
   - user follow-up
4. Bridge submits follow-up in same ChatGPT conversation if reuse is enabled.
5. Sidebar updates with response.

---

## Status model

Allowed statuses:

- `idle`
- `captured`
- `queued`
- `opening_bridge`
- `waiting_for_chatgpt`
- `submitting_prompt`
- `waiting_for_response`
- `parsing_response`
- `completed`
- `failed`

These statuses should drive both sidebar UI and the on-page card.

---

## Error model

Use stable error codes.

Suggested codes:

- `STARTPAGE_NOT_RESULTS_PAGE`
- `STARTPAGE_QUERY_NOT_FOUND`
- `STARTPAGE_RESULTS_NOT_FOUND`
- `CHATGPT_NOT_LOGGED_IN`
- `CHATGPT_COMPOSER_NOT_FOUND`
- `CHATGPT_SEND_FAILED`
- `CHATGPT_RESPONSE_TIMEOUT`
- `CHATGPT_RESPONSE_PARSE_FAILED`
- `BRIDGE_TAB_CLOSED`
- `MESSAGE_ROUTING_FAILED`
- `UNSUPPORTED_PAGE_STATE`

Each error should have:

- `code`
- `message`
- `recoverable`
- `debug`

---

## UX requirements

## Sidebar UX

Must show:

- current query
- whether context was captured
- whether ChatGPT bridge is ready
- current run status
- overview answer
- source list
- follow-up box
- regenerate button
- "Open ChatGPT tab" button
- error details when present

## On-page overview card UX

Must show:

- concise header
- loading indicator
- compact summary
- sources
- regenerate/open sidebar controls
- clear error state

Do not impersonate Startpage branding.

---

## Security and privacy rules

1. No API key storage.
2. No backend.
3. No remote data exfiltration beyond what the user already sends to Startpage and ChatGPT.
4. No hidden scraping outside visible pages.
5. No telemetry in v1.
6. No automatic login handling.
7. No storage of raw ChatGPT conversation history beyond what is needed for session UX.
8. No persistent storage of full Startpage result pages.

Store only:

- user settings
- recent query/result metadata
- latest parsed response per tab
- minimal debug info

---

## Reliability strategy

This project will break if selectors drift. Plan for that.

### Reliability rules

1. Put all selectors in dedicated selector files.
2. Use multiple candidate selectors.
3. Prefer semantic queries over brittle class names when possible.
4. Use fixture-based tests for extraction helpers.
5. Keep site automation logic narrow and observable.
6. Add generous status logging in development mode.
7. Fail loud, not silent.

### Debug mode

Include a debug toggle that shows:

- current page match status
- selector hits/misses
- last sent prompt
- last error code
- bridge runtime instance ID
- response timing milestones

---

## Suggested implementation phases

## Phase 1: scaffold

Deliver:

- manifest
- background skeleton
- popup
- sidebar shell
- Startpage content script loaded
- ChatGPT bridge content script loaded
- message constants
- no real automation yet

Definition of done:

- extension loads in Firefox
- popup opens
- sidebar opens
- content scripts confirm page detection in logs

## Phase 2: Startpage extraction

Deliver:

- robust query extraction
- top result extraction
- normalized payload
- fixtures and unit tests
- send payload to background

Definition of done:

- visible results are extracted correctly on real Startpage pages
- tests pass against fixtures

## Phase 3: sidebar state + page card

Deliver:

- sidebar state rendering
- overview card injection
- loading/error states
- manual run button

Definition of done:

- page card renders on Startpage
- sidebar mirrors captured query/results

## Phase 4: ChatGPT bridge automation

Deliver:

- sidebar bridge open/reuse
- composer detection
- prompt injection
- submit action
- response completion detection
- parsed response return

Definition of done:

- with a logged-in ChatGPT session, a grounded prompt can be sent and the returned text appears in sidebar

## Phase 5: full run orchestration

Deliver:

- end-to-end auto-run
- retry policy
- timeout handling
- stable status model
- follow-up flow

Definition of done:

- user can search on Startpage and get a sidebar answer with one interaction or fully automatically, depending on settings

## Phase 6: hardening

Deliver:

- options page
- better selectors
- better sanitize logic
- improved tests
- packaging scripts
- release checklist

---

## Testing strategy

## Unit tests

Test pure helpers only:

- prompt builder
- Startpage extraction
- ChatGPT response extraction
- state reducer/helpers
- schema validation

## Fixture tests

Use saved HTML fixtures for:

- normal Startpage results page
- Startpage page with missing snippets
- ChatGPT completed response
- ChatGPT loading response
- ChatGPT changed DOM fallback scenario

## Manual smoke tests

Cover:

1. Startpage results extraction
2. Auto sidebar update
3. Manual regenerate
4. Follow-up question
5. ChatGPT sidebar reuse
6. Logged-out ChatGPT state
7. Timeout behavior
8. Startpage layout variation
9. Extension reload recovery

---

## Packaging and local development

Use a minimal JS toolchain.

Recommended:

- plain ESM JavaScript
- ESLint
- Prettier
- `web-ext` for Firefox development
- Vitest or Jest for unit tests

### Example `package.json` scripts

```json
{
  "scripts": {
    "dev": "web-ext run -s src",
    "lint": "eslint .",
    "test": "vitest run",
    "build": "node scripts/pack.mjs"
  }
}
```

---

## Project conventions

1. Plain JavaScript first.
2. No framework unless clearly justified.
3. Small modules.
4. Pure helpers for extraction and prompt building.
5. One responsibility per file.
6. Stable message types.
7. No hidden side effects.
8. All DOM assumptions documented.

---

## Risks and realities

Be honest about these:

1. **ChatGPT DOM drift** is the biggest risk.
2. **Startpage DOM drift** is the second biggest risk.
3. Search mode or UI controls inside ChatGPT may change.
4. Logged-in state may expire.
5. Response parsing may need adjustment after ChatGPT UI changes.
6. Some browser-side automation patterns may feel flaky until hardened.

This is fine for a personal-use experiment. It is not a low-maintenance product unless you are prepared to keep updating selectors.

---

## Minimum viable deliverable

The true MVP is:

- Startpage results extraction works
- sidebar opens and shows status
- extension can send one grounded prompt to ChatGPT
- returned response text shows in sidebar
- compact overview card appears on Startpage
- user can regenerate manually

Anything beyond that is v2.

---

## Nice-to-have v2 ideas

1. Compare multiple search pages.
2. “What should I click first?” mode.
3. “Summarize disagreements only” mode.
4. Save last 20 searches locally.
5. Keyboard shortcut to run overview.
6. Per-site disable switch.
7. Export summary as markdown.
8. Optional manual approve-before-send workflow.

---

## Delivery checklist

Before calling v1 complete, verify:

- [ ] Loads as a temporary add-on in Firefox
- [ ] Sidebar opens reliably
- [ ] Popup works
- [ ] Startpage extraction works on real pages
- [ ] ChatGPT bridge prompt submission works
- [ ] Sidebar updates with answer
- [ ] On-page card renders and updates
- [ ] Failures produce visible error codes
- [ ] No API key or backend exists anywhere
- [ ] Tests pass
- [ ] README stays accurate to code

---

## Final guidance

Build this in layers.

Do not start with the hardest part first.

Start with:
1. manifest
2. page detection
3. Startpage extraction
4. sidebar state
5. bridge automation
6. response extraction
7. only then polish the UX

That order will save a lot of wasted time.
