import { extractStartpageResults } from "./dom/extract-startpage-results.js";
import { getOverviewCardMountTarget, isStartpageResultsPage } from "./dom/startpage-selectors.js";
import { createOverviewCard } from "./inject/overview-card.js";
import { MSG } from "./shared/message-types.js";
import { buildContextSignature } from "./shared/context-fingerprint.js";
import { sanitizeText } from "./shared/sanitize.js";

const DEFAULT_MAX_RESULTS = 6;
const RESULTS_DEBOUNCE_MS = 350;

const RUN_STATES = new Set(["queued", "running"]);

const cardState = {
  sourceTabId: null,
  query: "",
  status: "idle",
  summaryMode: "",
  summary: "",
  sources: [],
  quickOverviewTelemetry: "",
  deepDiveTelemetry: "",
  error: "",
  progressDetail: "",
  showDeepDiveAction: false,
  deepDivePending: false
};

const runtime = {
  sourceTabId: null,
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
    overviewCard = createOverviewCard({
      onRequestDeepDive: () => {
        requestExpandedDeepDive().catch(() => undefined);
      }
    });
  }
  overviewCard.mount(getOverviewCardMountTarget(document));
  overviewCard.render(cardState);
}

function resetCardForResultsPage() {
  updateCard({
    query: "",
    status: "loading",
    summaryMode: "",
    summary: "",
    sources: [],
    quickOverviewTelemetry: "",
    deepDiveTelemetry: "",
    error: "",
    progressDetail: "Capturing visible Startpage results."
  });
}

function getSessionFromStateResponse(response) {
  if (!response?.ok) {
    return null;
  }
  return response.session || null;
}

function toCardStatus(status) {
  if (!status) {
    return "idle";
  }
  return status;
}

function normalizeQueryForComparison(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function hasLockedCompletedSummaryForQuery(query) {
  if (cardState.status !== "completed") {
    return false;
  }

  if (!String(cardState.summary || "").trim()) {
    return false;
  }

  const cardQuery = normalizeQueryForComparison(cardState.query);
  const nextQuery = normalizeQueryForComparison(query);
  return Boolean(cardQuery) && cardQuery === nextQuery;
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

function formatIntegerMetric(value) {
  if (!Number.isInteger(value) || value < 0) {
    return "n/a";
  }
  return value.toLocaleString();
}

function formatModeTelemetry(telemetryByMode, mode, fallbackLabel) {
  const entry = telemetryByMode && typeof telemetryByMode === "object"
    ? telemetryByMode[mode]
    : null;
  if (!entry || typeof entry !== "object") {
    return `${fallbackLabel}: out n/a | reasoning n/a | json chars n/a | model n/a | retries n/a`;
  }

  const modelSnapshot = String(entry.modelSnapshot || "").trim() || "n/a";
  return `${fallbackLabel}: out ${formatIntegerMetric(entry.outputTokens)} | reasoning ${formatIntegerMetric(entry.reasoningTokens)} | json chars ${formatIntegerMetric(entry.visibleJsonChars)} | model ${modelSnapshot} | retries ${formatIntegerMetric(entry.retryCount)}`;
}

function applySessionState(session) {
  if (!session) {
    return;
  }
  if (Number.isInteger(session.tabId)) {
    runtime.sourceTabId = session.tabId;
  }
  const responseText = String(session.response?.text || "").trim();
  const telemetryByMode = session.response?.telemetryByMode && typeof session.response.telemetryByMode === "object"
    ? session.response.telemetryByMode
    : {};
  const showDeepDiveAction = session.status === "completed"
    && Boolean(responseText)
    && session.response?.mode !== "expanded_perplexity";

  updateCard({
    sourceTabId: Number.isInteger(session.tabId) ? session.tabId : cardState.sourceTabId,
    query: session.query || cardState.query,
    status: toCardStatus(session.status),
    summaryMode: String(session.response?.mode || ""),
    summary: session.response?.text || "",
    sources: Array.isArray(session.response?.sources) ? session.response.sources : [],
    quickOverviewTelemetry: formatModeTelemetry(telemetryByMode, "quick_overview", "Quick"),
    deepDiveTelemetry: formatModeTelemetry(telemetryByMode, "expanded_perplexity", "Deep"),
    error: session.lastError?.message || "",
    progressDetail: describeProgress(session),
    showDeepDiveAction,
    deepDivePending: false
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
  return buildContextSignature(payload);
}

function registerRuntimeListener() {
  if (runtime.listenerRegistered) {
    return;
  }

  browser.runtime.onMessage.addListener((message) => {
    if (!message?.type) {
      return undefined;
    }

    if (message.type === MSG.SESSION_UPDATED) {
      if (!message?.session) {
        return undefined;
      }
      applySessionState(message.session);
      return undefined;
    }

    if (message.type === MSG.POPUP_GET_OVERVIEW_TEXT) {
      const responseText = String(cardState.summary || "").trim();
      return {
        ok: true,
        overviewText: responseText,
        query: String(cardState.query || ""),
        summaryMode: String(cardState.summaryMode || ""),
        status: String(cardState.status || ""),
        sourceTabId: Number.isInteger(runtime.sourceTabId)
          ? runtime.sourceTabId
          : (Number.isInteger(cardState.sourceTabId) ? cardState.sourceTabId : null)
      };
    }

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

async function requestExpandedDeepDive() {
  try {
    await refreshFromBackground();
  } catch {
    // Fall back to local runtime/card state and context recapture below.
  }

  let sourceTabId = Number.isInteger(runtime.sourceTabId)
    ? runtime.sourceTabId
    : (Number.isInteger(cardState.sourceTabId) ? cardState.sourceTabId : null);

  if (!Number.isInteger(sourceTabId)) {
    await captureAndSendContext({ forceResync: true });
    sourceTabId = Number.isInteger(runtime.sourceTabId)
      ? runtime.sourceTabId
      : (Number.isInteger(cardState.sourceTabId) ? cardState.sourceTabId : null);
  }

  if (!Number.isInteger(sourceTabId)) {
    updateCard({
      error: "Unable to resolve tab for deep dive run."
    });
    return;
  }

  updateCard({
    deepDivePending: true,
    error: "",
    progressDetail: "Deep dive requested."
  });

  const response = await browser.runtime.sendMessage({
    type: MSG.REQUEST_RUN_FOR_TAB,
    sourceTabId,
    summaryMode: "expanded_perplexity"
  });

  if (!response?.ok) {
    if (response?.error === "session_not_found") {
      await captureAndSendContext({ forceResync: true });
      const retrySourceTabId = Number.isInteger(runtime.sourceTabId)
        ? runtime.sourceTabId
        : (Number.isInteger(cardState.sourceTabId) ? cardState.sourceTabId : sourceTabId);
      const retryResponse = await browser.runtime.sendMessage({
        type: MSG.REQUEST_RUN_FOR_TAB,
        sourceTabId: retrySourceTabId,
        summaryMode: "expanded_perplexity"
      });
      if (retryResponse?.ok) {
        await refreshFromBackground();
        return;
      }
    }
    updateCard({
      deepDivePending: false,
      error: sanitizeText(response?.error || "Could not queue deep dive run.")
    });
    return;
  }

  await refreshFromBackground();
}

async function captureAndSendContext({ forceResync = false } = {}) {
  const payload = buildContextPayload();
  const signature = buildPayloadSignature(payload);
  if (!forceResync && hasLockedCompletedSummaryForQuery(payload.query)) {
    runtime.lastSignature = signature;
    return;
  }

  if (!forceResync && signature === runtime.lastSignature) {
    try {
      const stateResponse = await browser.runtime.sendMessage({
        type: MSG.SIDEBAR_GET_STATE
      });
      if (stateResponse?.ok) {
        const session = getSessionFromStateResponse(stateResponse);
        if (session) {
          applySessionState(session);
          return;
        }
      }
    } catch {
      // Continue below and attempt to resync by sending context again.
    }

    if (hasLockedCompletedSummaryForQuery(payload.query)) {
      return;
    }
  }

  const response = await browser.runtime.sendMessage(payload);
  if (!response?.ok) {
    throw new Error(response?.error || "context_send_failed");
  }
  runtime.lastSignature = signature;
  if (response.session) {
    applySessionState(response.session);
  } else if (!RUN_STATES.has(cardState.status)) {
    updateCard({
      query: payload.query || "",
      status: "captured",
      summaryMode: "",
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
