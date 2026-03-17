import { extractStartpageResults } from "./dom/extract-startpage-results.js";
import { getOverviewCardMountTarget, isStartpageResultsPage } from "./dom/startpage-selectors.js";
import { createOverviewCard } from "./inject/overview-card.js";
import { MSG } from "./shared/message-types.js";
import { sanitizeText } from "./shared/sanitize.js";

const DEFAULT_MAX_RESULTS = 6;
const RESULTS_DEBOUNCE_MS = 350;

const RUN_STATES = new Set(["queued", "running"]);

const cardState = {
  query: "",
  status: "idle",
  summary: "",
  sources: [],
  error: "",
  progressDetail: ""
};

const runtime = {
  activeUrl: "",
  lastSignature: "",
  observer: null,
  evaluationTimer: null,
  listenerRegistered: false
};

let overviewCard = null;

function updateCard(nextState) {
  Object.assign(cardState, nextState);
  if (overviewCard) {
    overviewCard.render(cardState);
  }
}

function ensureOverviewCard() {
  if (!overviewCard) {
    overviewCard = createOverviewCard();
  }
  overviewCard.mount(getOverviewCardMountTarget(document));
  overviewCard.render(cardState);
}

function resetCardForResultsPage() {
  updateCard({
    query: "",
    status: "loading",
    summary: "",
    sources: [],
    error: "",
    progressDetail: "Capturing visible Startpage results."
  });
}

function getSessionFromStateResponse(response) {
  if (!response?.ok) {
    return null;
  }
  if (response.session) {
    return response.session;
  }

  const tabId = response?.state?.global?.activeSidebarTabId;
  if (!Number.isInteger(tabId)) {
    return null;
  }
  return response?.state?.sessions?.[String(tabId)] || null;
}

function toCardStatus(status) {
  if (!status) {
    return "idle";
  }
  return status;
}

function describeProgress(session) {
  const explicit = String(session?.debug?.progressMessage || "").trim();
  if (explicit) {
    return explicit;
  }

  switch (session?.status) {
    case "captured":
      return "Context captured. Automatic quick overview will start shortly.";
    case "queued":
      return "Queued. Preparing request.";
    case "running":
      return "Running OpenAI request.";
    case "completed":
      return "Overview complete.";
    case "failed":
      return "Run failed.";
    default:
      return "";
  }
}

function applySessionState(session) {
  if (!session) {
    return;
  }

  updateCard({
    query: session.query || cardState.query,
    status: toCardStatus(session.status),
    summary: session.response?.text || "",
    sources: Array.isArray(session.response?.sources) ? session.response.sources : [],
    error: session.lastError?.message || "",
    progressDetail: describeProgress(session)
  });
}

function buildContextPayload() {
  const extracted = extractStartpageResults(document, DEFAULT_MAX_RESULTS);
  return {
    type: MSG.STARTPAGE_CONTEXT_FOUND,
    pageUrl: window.location.href,
    capturedAt: Date.now(),
    query: extracted.query,
    results: extracted.results
  };
}

function buildPayloadSignature(payload) {
  return JSON.stringify({
    pageUrl: payload.pageUrl || "",
    query: payload.query || "",
    results: Array.isArray(payload.results)
      ? payload.results.map((result) => [result.rank, result.title, result.url, result.snippet, result.displayUrl])
      : []
  });
}

function registerRuntimeListener() {
  if (runtime.listenerRegistered) {
    return;
  }

  browser.runtime.onMessage.addListener((message) => {
    if (!message?.type || message.type !== MSG.SESSION_UPDATED) {
      return undefined;
    }
    if (!message?.session) {
      return undefined;
    }
    applySessionState(message.session);
    return undefined;
  });

  runtime.listenerRegistered = true;
}

async function refreshFromBackground() {
  const response = await browser.runtime.sendMessage({
    type: MSG.SIDEBAR_GET_STATE
  });
  if (!response?.ok) {
    throw new Error(response?.error || "state_request_failed");
  }
  applySessionState(getSessionFromStateResponse(response));
}

async function captureAndSendContext() {
  const payload = buildContextPayload();
  const signature = buildPayloadSignature(payload);
  if (signature === runtime.lastSignature) {
    return;
  }

  runtime.lastSignature = signature;
  const response = await browser.runtime.sendMessage(payload);
  if (!response?.ok) {
    throw new Error(response?.error || "context_send_failed");
  }
  if (response.session) {
    applySessionState(response.session);
  } else if (!RUN_STATES.has(cardState.status)) {
    updateCard({
      query: payload.query || "",
      status: "captured",
      progressDetail: "Context captured. Automatic quick overview will start shortly.",
      error: ""
    });
  }
  await refreshFromBackground();
}

async function evaluateStartpagePage() {
  const isResults = isStartpageResultsPage(document, window.location.href);
  if (!isResults) {
    runtime.activeUrl = "";
    runtime.lastSignature = "";
    if (overviewCard) {
      overviewCard.unmount();
    }
    return;
  }

  if (runtime.activeUrl !== window.location.href) {
    runtime.activeUrl = window.location.href;
    runtime.lastSignature = "";
    resetCardForResultsPage();
  }

  ensureOverviewCard();
  try {
    await captureAndSendContext();
  } catch (error) {
    updateCard({
      status: "failed",
      error: sanitizeText(error instanceof Error ? error.message : "context_capture_failed"),
      progressDetail: ""
    });
  }
}

function scheduleEvaluation() {
  if (runtime.evaluationTimer) {
    window.clearTimeout(runtime.evaluationTimer);
  }

  runtime.evaluationTimer = window.setTimeout(() => {
    runtime.evaluationTimer = null;
    evaluateStartpagePage().catch((error) => {
      updateCard({
        status: "failed",
        error: sanitizeText(error instanceof Error ? error.message : "page_evaluation_failed")
      });
    });
  }, RESULTS_DEBOUNCE_MS);
}

function startPageObserver() {
  if (runtime.observer) {
    return;
  }

  runtime.observer = new MutationObserver(() => {
    scheduleEvaluation();
  });

  runtime.observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["hidden", "aria-hidden", "style", "value"]
  });
}

browser.runtime.sendMessage({
  type: MSG.STARTPAGE_SCRIPT_STATUS,
  phase: "module_loaded",
  pageUrl: window.location.href,
  lastSeenAt: Date.now()
}).catch(() => undefined);

registerRuntimeListener();
startPageObserver();
window.addEventListener("pageshow", scheduleEvaluation);
window.addEventListener("popstate", scheduleEvaluation);
window.addEventListener("focus", scheduleEvaluation);
scheduleEvaluation();
