# PRIVACY.md

## What Data Is Collected

StartGPT does not run a backend and does not collect telemetry by default.

## What Data Is Sent To OpenAI

Only when the user manually triggers a run:

- Startpage query text
- Captured visible result fields:
  - title
  - URL
  - snippet
  - display URL
- Optional user-entered follow-up text

## What Is Not Sent

- Cookies
- Browser history
- Full page HTML
- Hidden page content outside extraction scope
- API key to any StartGPT server (none exists)

## Local Storage

- Settings are stored in `browser.storage.local`.
- User API key is stored in `browser.storage.local`.
- API key is not stored in `browser.storage.sync`, `localStorage`, or `sessionStorage`.

## User Controls

- Add/replace API key
- Validate API key
- Delete API key
- Configure default model/mode

## Important Note

Because this is browser-only BYOK, local key storage has unavoidable client-side risk compared with server-managed secrets.
