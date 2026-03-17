# StartGPT (Firefox, Browser-Only BYOK)

StartGPT summarizes visible Startpage results inside a Firefox sidebar.

This refactor removes production dependence on `chatgpt.com` automation and uses direct OpenAI API calls from the extension background script.

## Security Model

- Public distributed client: all extension code is inspectable.
- BYOK only: each user provides their own OpenAI API key.
- No backend, no native app, no shared developer key.
- API key is stored only in `browser.storage.local`.
- Only `background` code can read the key and call `https://api.openai.com`.
- Content scripts never access key storage and never perform OpenAI requests.

## User Flow

1. User opens Startpage results.
2. Content script captures minimal visible context (query + result snippets).
3. Background automatically queues a `quick_overview` when an API key is configured.
4. User can manually trigger an expanded deep dive from the popup or sidebar.
5. Background builds prompts and calls OpenAI Responses API.
6. Sidebar and page card show progress, result, and error states.

## Modes

- `quick_overview`: concise summary for fast scanning.
- `expanded_perplexity`: structured, deeper summary with citation-style references to captured result ranks.

## Settings Page

The options page supports:

- Save/replace API key
- Validate API key
- Delete API key
- Choose approved model allowlist
- Choose default summary mode
- Review explicit security/privacy warnings

## Development

Install dependencies:

```bash
npm install
```

Run extension in Firefox:

```bash
npm run dev
```

Run tests + static security checks:

```bash
npm test
```

Run only static checks:

```bash
npm run check:secrets
npm run check:security
```

## Residual Risk (Important)

Browser-only BYOK cannot provide server-grade secret protection. Malware, compromised local profiles, or malicious extensions with sufficient privilege could still expose locally stored keys. This project minimizes exposure but cannot eliminate client-side key risk.
