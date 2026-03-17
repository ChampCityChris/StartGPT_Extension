# AMO Privacy Summary

StartGPT summarizes visible Startpage search results when the user manually requests it.

- No backend service.
- No telemetry by default.
- Uses user-provided OpenAI API key (BYOK).
- Sends captured query/result text to OpenAI only on user action.
- Stores settings and API key in `browser.storage.local`.
- Does not use `browser.storage.sync` for API keys.
- Does not depend on `chatgpt.com` automation, cookies, or sessions.
