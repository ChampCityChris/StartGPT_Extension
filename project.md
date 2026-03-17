# project.md

## Project Identity

StartGPT is a Firefox extension that captures visible Startpage results and produces summaries in a sidebar using direct OpenAI API calls.

## Product Model

- Public extension (AMO target)
- Browser-only BYOK architecture
- No backend
- No shared developer key

## Hard Security Rules

1. Only background code may read/write API key storage and call OpenAI.
2. Content scripts must never access API key storage or call OpenAI.
3. API key storage is restricted to `browser.storage.local`.
4. Do not use `browser.storage.sync`, `localStorage`, or `sessionStorage` for API keys.
5. No dependency on `chatgpt.com` automation or scraping.
6. Enforce message schemas, payload caps, and model allowlist.
7. Redact and normalize all user-visible errors.

## Functional Requirements

1. Quick overview mode
2. Expanded perplexity-style mode
3. User-triggered runs only
4. Sidebar + page-card UX with loading/progress/errors
5. Options page for API key lifecycle and model/mode defaults

## Testing Requirements

- Validate message schema enforcement
- Validate key storage add/delete behavior
- Validate OpenAI call boundary (background-only)
- Validate no `chatgpt.com` production dependency
- Validate static secret leakage checks
