import { getCardStatusLabel, normalizeCardStatus } from "./loading-state.js";
import { sanitizeText, sanitizeUrl, truncateText } from "../shared/sanitize.js";

const CARD_ID = "startgpt-overview-root";
const STYLE_TEXT = `
  :host {
    all: initial;
    align-self: start;
    box-sizing: border-box;
    display: block;
    inline-size: min(100%, 420px);
    max-inline-size: 420px;
    position: sticky;
    top: 16px;
    z-index: 1;
  }

  .startgpt-card {
    background: linear-gradient(160deg, #162033 0%, #0f172a 100%);
    border: 1px solid #334155;
    box-sizing: border-box;
    border-radius: 12px;
    box-shadow: 0 10px 24px rgba(2, 6, 23, 0.35);
    color: #f8fafc;
    display: flex;
    flex-direction: column;
    font-family: "Segoe UI", Tahoma, sans-serif;
    inline-size: 100%;
    margin: 10px 0 14px;
    max-block-size: calc(100vh - 32px);
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 12px;
  }

  .startgpt-head {
    align-items: center;
    display: flex;
    gap: 8px;
    justify-content: space-between;
    margin-bottom: 8px;
  }

  .startgpt-title {
    font-size: 14px;
    font-weight: 700;
  }

  .startgpt-badge {
    border-radius: 999px;
    font-size: 11px;
    font-weight: 700;
    margin-left: auto;
    padding: 3px 8px;
  }

  .startgpt-badge[data-tone="idle"] {
    background: #334155;
    color: #e2e8f0;
  }

  .startgpt-badge[data-tone="loading"] {
    background: #7c2d12;
    color: #ffedd5;
  }

  .startgpt-badge[data-tone="completed"] {
    background: #166534;
    color: #dcfce7;
  }

  .startgpt-badge[data-tone="failed"] {
    background: #991b1b;
    color: #fee2e2;
  }

  .startgpt-query {
    color: #cbd5e1;
    font-size: 12px;
    margin: 0 0 10px;
    overflow-wrap: anywhere;
  }

  .startgpt-body {
    font-size: 13px;
    line-height: 1.5;
    margin: 0 0 10px;
    overflow-wrap: anywhere;
    white-space: pre-wrap;
  }

  .startgpt-error {
    color: #fca5a5;
    font-size: 12px;
    margin: 0 0 10px;
    min-height: 1.2em;
    overflow-wrap: anywhere;
  }

  .startgpt-progress {
    color: #cbd5e1;
    font-size: 12px;
    margin: 0 0 10px;
    min-height: 1.2em;
    overflow-wrap: anywhere;
  }

  .startgpt-sources {
    margin: 0 0 10px;
    padding-left: 16px;
  }

  .startgpt-sources li {
    margin: 0 0 4px;
  }

  .startgpt-sources a {
    color: #93c5fd;
    font-size: 12px;
    text-decoration: none;
    word-break: break-word;
  }

  .startgpt-sources a:hover {
    text-decoration: underline;
  }

  @media (max-width: 900px) {
    :host {
      inline-size: 100%;
      max-inline-size: none;
      position: static;
      top: auto;
    }

    .startgpt-card {
      max-block-size: none;
      overflow-y: visible;
    }
  }
`;

function createMountPoint() {
  const existing = document.getElementById(CARD_ID);
  if (existing) {
    return existing;
  }

  const root = document.createElement("div");
  root.id = CARD_ID;
  return root;
}

function findInsertionTarget() {
  return (
    document.querySelector("main") ||
    document.querySelector("#main") ||
    document.body
  );
}

function buildCardDom(shadowRoot) {
  const styleNode = document.createElement("style");
  styleNode.textContent = STYLE_TEXT;

  const card = document.createElement("section");
  card.className = "startgpt-card";

  const head = document.createElement("div");
  head.className = "startgpt-head";

  const title = document.createElement("p");
  title.className = "startgpt-title";
  title.textContent = "StartGPT Overview";

  const badge = document.createElement("span");
  badge.className = "startgpt-badge";

  head.append(title, badge);

  const query = document.createElement("p");
  query.className = "startgpt-query";

  const body = document.createElement("p");
  body.className = "startgpt-body";

  const error = document.createElement("p");
  error.className = "startgpt-error";

  const progress = document.createElement("p");
  progress.className = "startgpt-progress";

  const sources = document.createElement("ul");
  sources.className = "startgpt-sources";

  card.append(head, query, body, error, progress, sources);
  shadowRoot.append(styleNode, card);

  return {
    badge,
    body,
    error,
    progress,
    query,
    sources
  };
}

function renderSources(listNode, sources) {
  listNode.textContent = "";
  const items = Array.isArray(sources) ? sources.slice(0, 3) : [];

  if (items.length === 0) {
    return;
  }

  for (const source of items) {
    const title = sanitizeText(source?.title || source?.url || "Source");
    const href = sanitizeUrl(source?.url || "");
    if (!href) {
      continue;
    }

    const item = document.createElement("li");
    const link = document.createElement("a");
    link.href = href;
    link.target = "_blank";
    link.rel = "noreferrer noopener";
    link.textContent = truncateText(title, 90);
    item.append(link);
    listNode.append(item);
  }
}

export function createOverviewCard() {
  const mountPoint = createMountPoint();
  const shadowRoot = mountPoint.shadowRoot || mountPoint.attachShadow({ mode: "open" });
  shadowRoot.textContent = "";
  const nodes = buildCardDom(shadowRoot);

  return {
    mount(targetPosition = null) {
      const target = targetPosition?.parent || findInsertionTarget();
      const before =
        targetPosition?.before && targetPosition.before.parentNode === target
          ? targetPosition.before
          : target.firstElementChild || target.firstChild;

      if (before === mountPoint) {
        return;
      }

      target.insertBefore(mountPoint, before || null);
    },
    unmount() {
      if (mountPoint.isConnected) {
        mountPoint.remove();
      }
    },
    render(state) {
      const rawStatus = state?.status || "idle";
      const tone = normalizeCardStatus(rawStatus);
      nodes.badge.dataset.tone = tone;
      nodes.badge.textContent = getCardStatusLabel(rawStatus);
      nodes.query.textContent = state?.query
        ? `Query: ${truncateText(sanitizeText(state.query), 180)}`
        : "Query: waiting for Startpage context";
      nodes.body.textContent = state?.summary
        ? sanitizeText(state.summary)
        : "No overview yet. Automatic quick overview will appear here.";
      nodes.error.textContent = state?.error ? sanitizeText(state.error) : "";
      nodes.progress.textContent = state?.progressDetail ? sanitizeText(state.progressDetail) : "";
      renderSources(nodes.sources, state?.sources);
    }
  };
}
