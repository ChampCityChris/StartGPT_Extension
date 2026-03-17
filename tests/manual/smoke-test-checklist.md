# StartGPT Manual Smoke Checklist

## Setup

- Load extension as temporary add-on.
- Open StartGPT settings page.
- Save a valid OpenAI API key.
- Confirm key status shows configured.

## Startpage Capture

- Open a Startpage results URL.
- Confirm page overview card appears.
- Confirm status transitions automatically into `queued` -> `running` -> `completed`.
- Confirm summary and sources render in sidebar/card without clicking Run first.

## Manual Deep Dive

- Trigger `Run Deep Dive` from the popup or an expanded/manual run from the sidebar.
- Confirm status transitions `queued` -> `running` -> `completed`.
- Confirm summary and sources render in sidebar/card.

## Error States

- Replace key with invalid key and run:
  - Expect `INVALID_API_KEY` style error.
- Use exhausted quota key:
  - Expect quota/rate-limit error messaging.
- Simulate offline/network failure:
  - Expect network/timeout error messaging.

## Key Deletion Flow

- Use Delete Key in settings.
- Confirm key status becomes not configured.
- Trigger run and confirm missing-key error.

## Privacy/Security Checks

- Confirm the first quick overview runs automatically only on Startpage results pages with a configured key.
- Confirm no automatic deep-dive run occurs without explicit user action.
- Confirm no `chatgpt.com` navigation/dependency.
