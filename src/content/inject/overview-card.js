import { getCardStatusLabel, normalizeCardStatus } from "./loading-state.js";
import { sanitizeText, sanitizeUrl, truncateText } from "../shared/sanitize.js";
import { renderSummaryText } from "../shared/summary-render.js";

const CARD_ID = "startgpt-overview-root";
const SVG_NS = "http://www.w3.org/2000/svg";
const COPY_BUTTON_LABEL = "Copy overview text";
const COPY_BUTTON_COPIED_LABEL = "Overview copied";
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
    margin-bottom: 8px;
  }

  .startgpt-title {
    font-size: 14px;
    font-weight: 700;
  }

  .startgpt-head-actions {
    align-items: center;
    display: inline-flex;
    gap: 6px;
    margin-left: auto;
  }

  .startgpt-copy-button {
    align-items: center;
    background: rgba(15, 23, 42, 0.35);
    block-size: 28px;
    border: 1px solid #475569;
    border-radius: 8px;
    color: #e2e8f0;
    cursor: pointer;
    display: inline-flex;
    inline-size: 28px;
    justify-content: center;
    padding: 0;
    transition: background 120ms ease, border-color 120ms ease;
  }

  .startgpt-copy-button:hover:not(:disabled) {
    background: rgba(148, 163, 184, 0.16);
    border-color: #94a3b8;
  }

  .startgpt-copy-button:focus-visible {
    outline: 2px solid #93c5fd;
    outline-offset: 2px;
  }

  .startgpt-copy-button:disabled {
    cursor: default;
    opacity: 0.55;
  }

  .startgpt-copy-button[data-copied="true"] {
    background: rgba(22, 101, 52, 0.25);
    border-color: #16a34a;
    color: #dcfce7;
  }

  .startgpt-copy-icon,
  .startgpt-copy-check-icon {
    block-size: 14px;
    fill: none;
    inline-size: 14px;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 1.8;
  }

  .startgpt-copy-check-icon {
    display: none;
  }

  .startgpt-copy-button[data-copied="true"] .startgpt-copy-icon {
    display: none;
  }

  .startgpt-copy-button[data-copied="true"] .startgpt-copy-check-icon {
    display: block;
  }

  .startgpt-badge {
    border-radius: 999px;
    font-size: 11px;
    font-weight: 700;
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
  }

  .startgpt-body > :first-child {
    margin-top: 0;
  }

  .startgpt-body > :last-child {
    margin-bottom: 0;
  }

  .startgpt-body h3 {
    font-size: 13px;
    font-weight: 700;
    margin: 0 0 6px;
  }

  .startgpt-body p {
    margin: 0 0 8px;
  }

  .startgpt-body ul {
    margin: 0 0 8px;
    padding-left: 16px;
  }

  .startgpt-body li {
    margin: 0 0 4px;
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

  .startgpt-actions {
    margin: 0 0 10px;
  }

  .startgpt-costs {
    border-top: 1px solid #334155;
    color: #cbd5e1;
    font-size: 11px;
    margin-top: 4px;
    padding-top: 8px;
  }

  .startgpt-cost-line {
    margin: 0 0 4px;
  }

  .startgpt-deep-dive {
    background: #1d4ed8;
    border: 1px solid #1e40af;
    border-radius: 8px;
    color: #eff6ff;
    cursor: pointer;
    font-size: 12px;
    font-weight: 600;
    inline-size: 100%;
    padding: 7px 10px;
  }

  .startgpt-deep-dive[hidden] {
    display: none;
  }

  .startgpt-deep-dive:disabled {
    cursor: default;
    opacity: 0.6;
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

function setCopyButtonLabel(copyButton, label) {
  copyButton.setAttribute("aria-label", label);
  copyButton.title = label;
}

function createIcon(iconClassName, pathData) {
  const icon = document.createElementNS(SVG_NS, "svg");
  icon.classList.add(iconClassName);
  icon.setAttribute("viewBox", "0 0 20 20");
  icon.setAttribute("aria-hidden", "true");

  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", pathData);
  icon.append(path);
  return icon;
}

async function copyTextToClipboard(text) {
  if (navigator?.clipboard && typeof navigator.clipboard.writeText === "function") {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.left = "-9999px";
  textarea.style.position = "fixed";
  document.body.append(textarea);
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) {
    throw new Error("Clipboard API unavailable.");
  }
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

  const headActions = document.createElement("div");
  headActions.className = "startgpt-head-actions";

  const copyButton = document.createElement("button");
  copyButton.className = "startgpt-copy-button";
  copyButton.type = "button";
  copyButton.dataset.copied = "false";
  copyButton.disabled = true;
  setCopyButtonLabel(copyButton, COPY_BUTTON_LABEL);
  copyButton.append(
    createIcon("startgpt-copy-icon", "M7 7H16V16H7z M4 4H13V13H4z"),
    createIcon("startgpt-copy-check-icon", "M4.5 10.5L8 14L15.5 6.5")
  );

  const badge = document.createElement("span");
  badge.className = "startgpt-badge";

  headActions.append(copyButton, badge);
  head.append(title, headActions);

  const query = document.createElement("p");
  query.className = "startgpt-query";

  const body = document.createElement("article");
  body.className = "startgpt-body";

  const error = document.createElement("p");
  error.className = "startgpt-error";

  const progress = document.createElement("p");
  progress.className = "startgpt-progress";

  const sources = document.createElement("ul");
  sources.className = "startgpt-sources";

  const actions = document.createElement("div");
  actions.className = "startgpt-actions";

  const deepDiveButton = document.createElement("button");
  deepDiveButton.className = "startgpt-deep-dive";
  deepDiveButton.type = "button";
  deepDiveButton.hidden = true;
  deepDiveButton.textContent = "Complete Perplexity-Style Deep Dive";
  actions.append(deepDiveButton);

  const costs = document.createElement("div");
  costs.className = "startgpt-costs";

  const quickCost = document.createElement("p");
  quickCost.className = "startgpt-cost-line";

  const deepCost = document.createElement("p");
  deepCost.className = "startgpt-cost-line";

  costs.append(quickCost, deepCost);

  card.append(head, query, body, error, progress, actions, sources, costs);
  shadowRoot.append(styleNode, card);

  return {
    deepDiveButton,
    copyButton,
    badge,
    body,
    error,
    progress,
    query,
    sources,
    quickCost,
    deepCost
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

export function createOverviewCard({ onRequestDeepDive } = {}) {
  const mountPoint = createMountPoint();
  const shadowRoot = mountPoint.shadowRoot || mountPoint.attachShadow({ mode: "open" });
  shadowRoot.textContent = "";
  const nodes = buildCardDom(shadowRoot);
  let copyFeedbackTimer = null;

  if (typeof onRequestDeepDive === "function") {
    nodes.deepDiveButton.addEventListener("click", () => {
      onRequestDeepDive();
    });
  }

  nodes.copyButton.addEventListener("click", async () => {
    const summaryText = String(nodes.copyButton.dataset.copyText || "").trim();
    if (!summaryText) {
      return;
    }

    try {
      await copyTextToClipboard(summaryText);
      nodes.copyButton.dataset.copied = "true";
      setCopyButtonLabel(nodes.copyButton, COPY_BUTTON_COPIED_LABEL);
      if (copyFeedbackTimer) {
        window.clearTimeout(copyFeedbackTimer);
      }
      copyFeedbackTimer = window.setTimeout(() => {
        nodes.copyButton.dataset.copied = "false";
        setCopyButtonLabel(nodes.copyButton, COPY_BUTTON_LABEL);
        copyFeedbackTimer = null;
      }, 1500);
    } catch {
      nodes.copyButton.dataset.copied = "false";
      setCopyButtonLabel(nodes.copyButton, COPY_BUTTON_LABEL);
      nodes.error.textContent = "Failed to copy overview text.";
    }
  });

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
      if (copyFeedbackTimer) {
        window.clearTimeout(copyFeedbackTimer);
        copyFeedbackTimer = null;
      }
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
      renderSummaryText(
        nodes.body,
        state?.summary || "",
        "No overview yet. Automatic quick overview will appear here."
      );
      nodes.error.textContent = state?.error ? sanitizeText(state.error) : "";
      nodes.progress.textContent = state?.progressDetail ? sanitizeText(state.progressDetail) : "";
      const summaryForCopy = String(state?.summary || "").trim();
      nodes.copyButton.dataset.copyText = summaryForCopy;
      nodes.copyButton.disabled = summaryForCopy.length === 0;
      if (!summaryForCopy) {
        nodes.copyButton.dataset.copied = "false";
        setCopyButtonLabel(nodes.copyButton, COPY_BUTTON_LABEL);
        if (copyFeedbackTimer) {
          window.clearTimeout(copyFeedbackTimer);
          copyFeedbackTimer = null;
        }
      }
      const showDeepDiveAction = Boolean(state?.showDeepDiveAction);
      nodes.deepDiveButton.hidden = !showDeepDiveAction;
      nodes.deepDiveButton.disabled = Boolean(state?.deepDivePending) || !showDeepDiveAction;
      renderSources(nodes.sources, state?.sources);
      nodes.quickCost.textContent = sanitizeText(
        state?.quickOverviewTelemetry
        || "Quick: out n/a | reasoning n/a | json chars n/a | model n/a | retries n/a"
      );
      nodes.deepCost.textContent = sanitizeText(
        state?.deepDiveTelemetry
        || "Deep: out n/a | reasoning n/a | json chars n/a | model n/a | retries n/a"
      );
    }
  };
}
