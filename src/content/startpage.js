import { extractStartpageResults } from "./dom/extract-startpage-results.js";
import { getOverviewCardMountTarget, isStartpageResultsPage } from "./dom/startpage-selectors.js";
import { createOverviewCard } from "./inject/overview-card.js";
import { validateStartpageContextPayload } from "./shared/schema.js";
import { MSG } from "./shared/message-types.js";
import { sanitizeText } from "./shared/sanitize.js";

const DEFAULT_MAX_RESULTS = 5;
const RESULTS_DEBOUNCE_MS = 350;
const INVALID_REPORT_DELAY_MS = 1500;
const LONG_WAIT_WARNING_MS = 30000;
const RUN_STATUSES = new Set([
  "queued",
  "opening_bridge",
  "waiting_for_chatgpt",
  "submitting_prompt",
  "waiting_for_response",
  "parsing_response"
]);
const LOADING_STATUSES = new Set([
  "queued",
  "opening_bridge",
  "waiting_for_chatgpt",
  "submitting_prompt",
  "waiting_for_response",
  "parsing_response",
  "loading"
]);

const cardState = {
  query: "",
  status: "idle",
  summary: "",
  sources: [],
  error: "",
  progressDetail: ""
};

const startpageState = {
  activeResultsPageUrl: "",
  resultsPageSeenAt: 0,
  invalidCount: 0,
  lastSuccessSignature: "",
  lastInvalidSignature: "",
  observer: null,
  evaluationTimer: null,
  backgroundListenerRegistered: false
};

let overviewCard = null;

browser.runtime.sendMessage({
  type: MSG.STARTPAGE_SCRIPT_STATUS,
  phase: "module_loaded",
  pageUrl: window.location.href,
  lastSeenAt: Date.now()
}).catch(() => undefined);

function getMaxResults() {
  const rawValue = document.documentElement?.dataset?.startgptMaxResults;
  const parsed = Number.parseInt(rawValue || "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_RESULTS;
}

function updateCard(nextState) {
  Object.assign(cardState, nextState);
  if (overviewCard) {
    overviewCard.render(cardState);
  }
}

function resetCardForNewResultsPage() {
  updateCard({
    query: "",
    status: "loading",
    summary: "",
    sources: [],
    error: "",
    progressDetail: "Loading Startpage results."
  });
}

function ensureOverviewCard() {
  if (!overviewCard) {
    overviewCard = createOverviewCard();
  }

  overviewCard.mount(getOverviewCardMountTarget(document));
  overviewCard.render(cardState);
}

function resetPageTracking() {
  startpageState.activeResultsPageUrl = "";
  startpageState.resultsPageSeenAt = 0;
  startpageState.invalidCount = 0;
  startpageState.lastSuccessSignature = "";
  startpageState.lastInvalidSignature = "";
}

function getSessionFromStateResponse(response) {
  if (!response?.ok) {
    return null;
  }

  if (response.session) {
    return response.session;
  }

  const tabId = response.state?.global?.activeSidebarTabId;
  if (!Number.isInteger(tabId)) {
    return null;
  }

  return response.state?.sessions?.[String(tabId)] || null;
}

function toCardStatus(sessionStatus) {
  if (!sessionStatus) {
    return "idle";
  }
  if (LOADING_STATUSES.has(sessionStatus)) {
    return sessionStatus;
  }
  return sessionStatus;
}

function describeSessionProgress(session) {
  const explicit = session?.debug?.progressMessage;
  if (typeof explicit === "string" && explicit.trim()) {
    return explicit.trim();
  }

  switch (session?.status) {
    case "captured":
      return "Captured Startpage query and visible results.";
    case "queued":
      return "Run queued. Waiting to start.";
    case "opening_bridge":
      return "Opening ChatGPT context.";
    case "waiting_for_chatgpt":
      return "ChatGPT context readying.";
    case "submitting_prompt":
      return "Sending grounded prompt to ChatGPT.";
    case "waiting_for_response":
      return "Waiting for ChatGPT to begin/respond.";
    case "parsing_response":
      return "Parsing response text and sources.";
    case "completed":
      return "Overview complete.";
    case "failed":
      return "Run failed. See error.";
    default:
      return "";
  }
}

function applySessionState(session) {
  if (!session) {
    return;
  }

  let longWaitWarning = "";
  if (session.status === "waiting_for_response") {
    const runIdMatch = typeof session.runId === "string" ? session.runId.match(/_(\d+)$/) : null;
    const runStartedAt = runIdMatch ? Number.parseInt(runIdMatch[1], 10) : null;
    if (Number.isInteger(runStartedAt)) {
      const waitedMs = Date.now() - runStartedAt;
      if (waitedMs > LONG_WAIT_WARNING_MS) {
        longWaitWarning = `Still waiting on ChatGPT (${Math.round(waitedMs / 1000)}s).`;
      }
    }
  }

  updateCard({
    query: session.query || cardState.query,
    status: toCardStatus(session.status),
    summary: session.response?.text || "",
    sources: Array.isArray(session.response?.sources) ? session.response.sources : [],
    error: session.lastError?.message || longWaitWarning,
    progressDetail: describeSessionProgress(session)
  });
}

function isRunStatus(status) {
  return RUN_STATUSES.has(String(status || ""));
}

async function refreshStateFromBackground() {
  const response = await browser.runtime.sendMessage({
    type: MSG.SIDEBAR_GET_STATE
  });

  if (!response?.ok) {
    throw new Error(response?.error || "State request failed");
  }

  applySessionState(getSessionFromStateResponse(response));
}

function buildContextPayload() {
  const extracted = extractStartpageResults(document, getMaxResults());
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
    pageUrl: payload?.pageUrl || "",
    query: payload?.query || "",
    results: Array.isArray(payload?.results)
      ? payload.results.map((result) => [
        result.rank,
        result.title,
        result.url,
        result.snippet,
        result.displayUrl
      ])
      : []
  });
}

function getStartpageCaptureError(payload) {
  if (!payload?.query) {
    return {
      code: "STARTPAGE_QUERY_NOT_FOUND",
      message: "Startpage results loaded, but the search query could not be read yet."
    };
  }

  if (!Array.isArray(payload?.results) || payload.results.length === 0) {
    return {
      code: "STARTPAGE_RESULTS_NOT_FOUND",
      message: "Startpage results loaded, but no result blocks matched the selectors in this DOM snapshot."
    };
  }

  return {
    code: "STARTPAGE_CAPTURE_INVALID",
    message: "Startpage results were detected, but the extracted context was invalid."
  };
}

async function reportInvalidContext(payload, validationErrors) {
  const errorInfo = getStartpageCaptureError(payload);
  const response = await browser.runtime.sendMessage({
    type: MSG.STARTPAGE_CONTEXT_INVALID,
    pageUrl: payload.pageUrl,
    capturedAt: payload.capturedAt,
    query: payload.query,
    results: payload.results,
    code: errorInfo.code,
    message: errorInfo.message,
    recoverable: true,
    debug: {
      validationErrors,
      selectors: {
        queryPresent: Boolean(payload.query),
        resultCount: Array.isArray(payload.results) ? payload.results.length : 0
      }
    }
  });

  if (!response?.ok) {
    throw new Error(response?.error || "Background rejected Startpage failure state");
  }

  await refreshStateFromBackground();
}

async function sendValidContext(payload) {
  if (!isRunStatus(cardState.status)) {
    updateCard({
      query: payload.query || "",
      status: "captured",
      error: "",
      progressDetail: "Captured results. Syncing context with extension runtime."
    });
  }

  const response = await browser.runtime.sendMessage(payload);
  if (!response?.ok) {
    throw new Error(response?.error || "Background rejected Startpage context");
  }

  if (response.session) {
    applySessionState(response.session);
  }
  await refreshStateFromBackground();
}

async function captureAndSendContext(payload) {
  const validation = validateStartpageContextPayload(payload);
  if (!validation.ok) {
    if (startpageState.lastSuccessSignature) {
      // Keep the last known-good capture when transient DOM states
      // (e.g. scrolling/pagination widgets) no longer match selectors.
      if (!isRunStatus(cardState.status)) {
        updateCard({
          query: payload.query || cardState.query,
          status: cardState.status || "captured",
          error: "",
          progressDetail: "Using previously captured Startpage results."
        });
      }
      return;
    }

    startpageState.invalidCount += 1;
    const isStillSettling = Date.now() - startpageState.resultsPageSeenAt < INVALID_REPORT_DELAY_MS;

    if (isStillSettling) {
      if (!isRunStatus(cardState.status)) {
        updateCard({
          query: payload.query || "",
          status: "captured",
          error: "",
          progressDetail: "Waiting for Startpage result blocks to finish rendering."
        });
      }
      // Critical: do not wait for user scroll/mutations to retry capture.
      schedulePageEvaluation();
      return;
    }

    const invalidSignature = buildPayloadSignature(payload);
    if (invalidSignature === startpageState.lastInvalidSignature) {
      return;
    }

    startpageState.lastInvalidSignature = invalidSignature;
    startpageState.lastSuccessSignature = "";

    await reportInvalidContext(payload, validation.errors);
    return;
  }

  startpageState.invalidCount = 0;
  startpageState.lastInvalidSignature = "";

  const successSignature = buildPayloadSignature(payload);
  if (successSignature === startpageState.lastSuccessSignature) {
    return;
  }

  startpageState.lastSuccessSignature = successSignature;

  try {
    await sendValidContext(payload);
  } catch (error) {
    startpageState.lastSuccessSignature = "";
    throw error;
  }
}

function registerBackgroundStateListener() {
  if (startpageState.backgroundListenerRegistered) {
    return;
  }

  browser.runtime.onMessage.addListener((message) => {
    if (!message?.type) {
      return;
    }

    if (
      message.type === MSG.SESSION_UPDATED ||
      message.type === MSG.BRIDGE_RESPONSE_READY ||
      message.type === MSG.RUN_FAILED ||
      message.type === MSG.STARTPAGE_CONTEXT_FOUND ||
      message.type === MSG.STARTPAGE_CONTEXT_INVALID
    ) {
      refreshStateFromBackground().catch((error) => {
        updateCard({
          status: "failed",
          error: sanitizeText(error.message || "Card refresh failed")
        });
      });
    }
  });

  startpageState.backgroundListenerRegistered = true;
}

async function evaluateStartpagePage() {
  const resultsPage = isStartpageResultsPage(document, window.location.href);

  if (!resultsPage) {
    resetPageTracking();
    if (overviewCard) {
      overviewCard.unmount();
    }
    return;
  }

  if (startpageState.activeResultsPageUrl !== window.location.href) {
    startpageState.activeResultsPageUrl = window.location.href;
    startpageState.resultsPageSeenAt = Date.now();
    startpageState.invalidCount = 0;
    startpageState.lastSuccessSignature = "";
    startpageState.lastInvalidSignature = "";
    resetCardForNewResultsPage();
  }

  ensureOverviewCard();
  const payload = buildContextPayload();

  try {
    await captureAndSendContext(payload);
  } catch (error) {
    updateCard({
      status: "failed",
      error: sanitizeText(error.message || "Startpage capture failed")
    });
    console.error("[StartGPT][startpage] capture failed", error);
  }
}

function schedulePageEvaluation() {
  if (startpageState.evaluationTimer) {
    window.clearTimeout(startpageState.evaluationTimer);
  }

  startpageState.evaluationTimer = window.setTimeout(() => {
    startpageState.evaluationTimer = null;
    evaluateStartpagePage().catch((error) => {
      updateCard({
        status: "failed",
        error: sanitizeText(error.message || "Startpage page evaluation failed")
      });
    });
  }, RESULTS_DEBOUNCE_MS);
}

function startPageObserver() {
  if (startpageState.observer) {
    return;
  }

  const observer = new MutationObserver(() => {
    schedulePageEvaluation();
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["hidden", "aria-hidden", "style", "value"]
  });

  startpageState.observer = observer;
}

registerBackgroundStateListener();
startPageObserver();
window.addEventListener("pageshow", schedulePageEvaluation);
window.addEventListener("popstate", schedulePageEvaluation);
window.addEventListener("focus", schedulePageEvaluation);
schedulePageEvaluation();
