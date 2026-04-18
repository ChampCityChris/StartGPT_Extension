import { MSG } from "../content/shared/message-types.js";
import { selectPopupSession } from "./session-resolution.js";
import { buildDiagnosticText } from "./diagnostics.js";

const openSettingsButton = document.getElementById("open-settings");
const activeTabLabel = document.getElementById("active-tab");
const runStatusLabel = document.getElementById("run-status");
const queryStatusLabel = document.getElementById("query-status");
const keyStatusLabel = document.getElementById("key-status");
const errorStatusLabel = document.getElementById("error-status");
const diagnosticsOutput = document.getElementById("diagnostics-output");

function isStartpageUrl(url) {
  if (typeof url !== "string" || !url) {
    return false;
  }
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.hostname.endsWith("startpage.com");
  } catch {
    return false;
  }
}

function isStartpageResultsUrl(url) {
  if (!isStartpageUrl(url)) {
    return false;
  }

  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname.toLowerCase();
    const hasKnownPath = ["/sp/search", "/do/search", "/do/dsearch", "/search"].includes(pathname);
    const hasQueryParam = Boolean(parsed.searchParams.get("query") || parsed.searchParams.get("q"));
    return hasKnownPath || hasQueryParam;
  } catch {
    return false;
  }
}

async function getActiveTab() {
  const currentWindowTabs = await browser.tabs.query({ active: true, currentWindow: true });
  if (currentWindowTabs[0]) {
    return currentWindowTabs[0];
  }

  const lastFocusedTabs = await browser.tabs.query({ active: true, lastFocusedWindow: true });
  return lastFocusedTabs[0] || null;
}

function setErrorStatus(text) {
  if (errorStatusLabel) {
    errorStatusLabel.textContent = text || "";
  }
}

function getLatestCompletedOverviewText(session) {
  const text = String(session?.response?.text || "");
  if (!text.trim()) {
    return "";
  }
  return Number.isInteger(session?.completedAt) ? text : "";
}

async function getOverviewTextFromTab(tabId) {
  if (!Number.isInteger(tabId)) {
    return null;
  }
  try {
    const response = await browser.tabs.sendMessage(tabId, {
      type: MSG.POPUP_GET_OVERVIEW_TEXT
    });
    if (!response?.ok) {
      return null;
    }
    return {
      ok: true,
      overviewText: String(response.overviewText || "").trim(),
      query: String(response.query || ""),
      summaryMode: String(response.summaryMode || ""),
      status: String(response.status || ""),
      sourceTabId: Number.isInteger(response.sourceTabId) ? response.sourceTabId : null
    };
  } catch {
    return null;
  }
}

async function refreshPopupState() {
  const tab = await getActiveTab();
  const tabId = Number.isInteger(tab?.id) ? tab.id : null;
  const onStartpage = isStartpageUrl(tab?.url);
  const onStartpageResults = isStartpageResultsUrl(tab?.url);

  activeTabLabel.textContent = onStartpage
    ? `Tab: Startpage (${tabId ?? "unknown"})`
    : `Tab: ${tab?.url || "unknown page"}`;

  const stateRequest = {
    type: MSG.SIDEBAR_GET_STATE
  };
  if (Number.isInteger(tabId)) {
    stateRequest.sourceTabId = tabId;
  }

  const stateResponse = await browser.runtime.sendMessage(stateRequest);

  if (!stateResponse?.ok) {
    runStatusLabel.textContent = "Status: failed";
    queryStatusLabel.textContent = "Query: (none)";
    keyStatusLabel.textContent = "API Key: unknown";
    setErrorStatus(stateResponse?.error || "Failed to read runtime state.");
    diagnosticsOutput.textContent = buildDiagnosticText(tab, null, stateResponse, "");
    return;
  }

  const session = onStartpageResults ? selectPopupSession(stateResponse, tabId) : null;
  const tabOverview = onStartpageResults
    ? await getOverviewTextFromTab(tabId)
    : null;
  if (!Number.isInteger(tabId) && Number.isInteger(session?.tabId)) {
    activeTabLabel.textContent = `Tab: fallback Startpage session (${session.tabId})`;
  }

  let latestOverviewText = "";
  if (onStartpageResults && tabOverview?.overviewText) {
    latestOverviewText = String(tabOverview.overviewText || "").trim();
  }
  if (onStartpageResults && !latestOverviewText) {
    latestOverviewText = getLatestCompletedOverviewText(session);
  }

  const effectiveStatus = String(tabOverview?.status || session?.status || "idle");
  const effectiveQuery = String(tabOverview?.query || session?.query || "");
  runStatusLabel.textContent = `Status: ${effectiveStatus}`;
  queryStatusLabel.textContent = `Query: ${effectiveQuery || "(none captured yet)"}`;
  keyStatusLabel.textContent = `API Key: ${stateResponse.hasApiKey ? "configured" : "missing"}`;
  const defaultHint = onStartpageResults
    ? (stateResponse.hasApiKey ? "" : "Add an OpenAI API key in Settings to enable automatic overview.")
    : (onStartpage
      ? "Open a Startpage results page to see live overview status."
      : "Switch to a Startpage results tab.")
  setErrorStatus(
    session?.lastError?.message
      || ((session || tabOverview?.overviewText) ? "" : defaultHint)
  );
  diagnosticsOutput.textContent = buildDiagnosticText(
    tab,
    session,
    stateResponse,
    latestOverviewText,
    tabOverview
  );
}

if (openSettingsButton) {
  openSettingsButton.addEventListener("click", () => {
    browser.runtime.openOptionsPage().catch(() => undefined);
  });
}

browser.runtime.onMessage.addListener((message) => {
  if (message?.type === MSG.SESSION_UPDATED) {
    refreshPopupState().catch(() => undefined);
  }
  return undefined;
});

refreshPopupState().catch((error) => {
  setErrorStatus(error instanceof Error ? error.message : "Failed to initialize popup.");
});
