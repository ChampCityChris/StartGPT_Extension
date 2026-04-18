# StartGPT (Firefox Extension, Browser-Only BYOK)

StartGPT captures visible Startpage results and generates OpenAI summaries directly in the extension.

There is no StartGPT backend. All OpenAI calls are made from the background script using the user-provided API key.

## Current Feature Set

- Automatic `quick_overview` run when Startpage context is captured and an API key is configured
- Manual `expanded_perplexity` run (deep dive) from the sidebar or on-page overview card
- Manual follow-up questions in the sidebar
- On-page overview card injected on Startpage results pages (shows summary, sources, status, token usage)
- Firefox sidebar panel for run controls, follow-ups, errors, and runtime status
- Popup status view with quick snapshot + diagnostics for the active tab
- Options page for API key lifecycle, defaults, and model selection

## Security Model

- Public client extension: code is inspectable
- BYOK only: each user provides their own OpenAI key
- No backend, no shared developer key
- API key stored in `browser.storage.local` only
- Only background code can read stored key and call `https://api.openai.com/v1/responses`
- Content scripts never read API key storage and never call OpenAI directly
- Message routing enforces sender checks, schema validation, and payload limits

## Summary Modes

- `quick_overview`: fast concise overview (automatic first run)
- `expanded_perplexity`: deeper structured run (manual)

## Approved Models (Allowlist)

- `gpt-5.4-nano` (default)
- `gpt-5-nano`
- `gpt-4.1-mini`
- `gpt-4.1`
- `gpt-4o-mini`

## Settings (Options Page)

- Save / replace API key
- Validate entered or stored API key
- Delete API key
- Set default model
- Set default summary mode
- Set max captured results (`1-10`)
- Set auto-injected Startpage overview card preference

## Development

Install dependencies:

```bash
npm install
```

Run in Firefox via `web-ext`:

```bash
npm run dev
```

Build packaged extension zip:

```bash
npm run build
```

Run all checks and tests:

```bash
npm test
```

Run checks individually:

```bash
npm run lint
npm run check:secrets
npm run check:security
```

## Privacy and Risk Notes

- Captured Startpage query/result text is sent to OpenAI to generate summaries
- Automatic behavior is limited to the first quick overview; expanded runs and follow-ups are user-triggered
- No telemetry is enabled by default
- Browser-only BYOK cannot match server-side secret protection; local compromise can still expose keys
