# SECURITY.md

## Trust Boundaries

- `content/*`:
  - Reads minimal Startpage page content needed for user-requested summarization.
  - Cannot access API keys.
  - Cannot call OpenAI.
- `background/*`:
  - Sole holder of key access.
  - Sole caller of OpenAI endpoints.
  - Validates all inbound messages and enforces request limits.
- `options/*`:
  - Sends key and settings updates to background.
  - Never reads stored key value back.

## Key Handling

- No hardcoded key in source, manifest, tests, docs, or fixtures.
- Key persists only under `browser.storage.local` key `openai_api_key`.
- No key use in:
  - content scripts
  - page context
  - DOM attributes
  - URL params
  - `localStorage`
  - `sessionStorage`
  - `browser.storage.sync`
- Errors are normalized and never include raw Authorization header data.

## OpenAI Request Controls

- Fixed endpoint: `https://api.openai.com/v1/responses`
- Fixed validation endpoint: `https://api.openai.com/v1/models`
- Allowlisted models only
- Max input and output caps
- Timeout caps and abort/cancel support
- Retry only on transient transport/server failures
- No arbitrary base URL override in production flow

## Residual Risk

This is a browser-only BYOK extension. Client-side storage is inherently weaker than server-side secrets. A compromised client environment can still expose keys. Users should scope API keys and rotate them when needed.
