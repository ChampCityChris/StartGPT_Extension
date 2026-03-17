import { MSG } from "../content/shared/message-types.js";
import { SUMMARY_MODE } from "../background/constants.js";
import { openSidebarFromUserGesture } from "./sidebar-open.js";

const openSidebarButton = document.getElementById("open-sidebar");
const runNowButton = document.getElementById("run-now");
const openSettingsButton = document.getElementById("open-settings");
const activeTabLabel = document.getElementById("active-tab");
const runStatusLabel = document.getElementById("run-status");
const queryStatusLabel = document.getElementById("query-status");
const keyStatusLabel = document.getElementById("key-status");
const errorStatusLabel = document.getElementById("error-status");
const diagnosticsOutput = document.getElementById("diagnostics-output");

let currentActiveTab = null;

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

async function getActiveTab() {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
}

function setErrorStatus(text) {
  if (errorStatusLabel) {
    errorStatusLabel.textContent = text || "";
  }
}

function buildDiagnosticText(tab, session, stateResponse) {
  return [
    `Tab ID: ${tab?.id ?? "(none)"}`,
    `Tab URL: ${tab?.url || "(none)"}`,
    `Has API Key: ${stateResponse?.hasApiKey ? "yes" : "no"}`,
    `Status: ${session?.status || "idle"}`,
    `Progress: ${session?.debug?.progressMessage || "(none)"}`,
    `Error Code: ${session?.debug?.lastErrorCode || session?.lastError?.code || "(none)"}`,
    `Error Message: ${session?.lastError?.message || "(none)"}`,
    `Result Count: ${Array.isArray(session?.results) ? session.results.length : 0}`,
    `Model: ${stateResponse?.state?.settings?.model || "(none)"}`,
    `Default Mode: ${stateResponse?.state?.settings?.defaultSummaryMode || "(none)"}`
  ].join("\n");
}

async function refreshPopupState() {
  const tab = await getActiveTab();
  currentActiveTab = tab;
  const tabId = Number.isInteger(tab?.id) ? tab.id : null;
  const onStartpage = isStartpageUrl(tab?.url);

  activeTabLabel.textContent = onStartpage
    ? `Tab: Startpage (${tabId ?? "unknown"})`
    : `Tab: ${tab?.url || "unknown page"}`;

  if (!tabId) {
    runStatusLabel.textContent = "Status: idle";
    queryStatusLabel.textContent = "Query: (none)";
    keyStatusLabel.textContent = "API Key: unknown";
    diagnosticsOutput.textContent = buildDiagnosticText(tab, null, null);
    runNowButton.disabled = true;
    return;
  }

  const stateResponse = await browser.runtime.sendMessage({
    type: MSG.SIDEBAR_GET_STATE,
    sourceTabId: tabId
  });

  if (!stateResponse?.ok) {
    runStatusLabel.textContent = "Status: failed";
    queryStatusLabel.textContent = "Query: (none)";
    keyStatusLabel.textContent = "API Key: unknown";
    setErrorStatus(stateResponse?.error || "Failed to read runtime state.");
    diagnosticsOutput.textContent = buildDiagnosticText(tab, null, stateResponse);
    runNowButton.disabled = !onStartpage;
    return;
  }

  const session = stateResponse.session || stateResponse.state?.sessions?.[String(tabId)] || null;
  runStatusLabel.textContent = `Status: ${session?.status || "idle"}`;
  queryStatusLabel.textContent = `Query: ${session?.query || "(none captured yet)"}`;
  keyStatusLabel.textContent = `API Key: ${stateResponse.hasApiKey ? "configured" : "missing"}`;
  setErrorStatus(
    session?.lastError?.message
      || (onStartpage
        ? (stateResponse.hasApiKey ? "" : "Add an OpenAI API key in Settings to enable automatic overview.")
        : "Switch to a Startpage results tab.")
  );
  diagnosticsOutput.textContent = buildDiagnosticText(tab, session, stateResponse);
  runNowButton.disabled = !onStartpage;
}

if (openSidebarButton) {
  openSidebarButton.addEventListener("click", () => {
    let openPromise;

    openSidebarButton.disabled = true;
    try {
      openPromise = openSidebarFromUserGesture(browser.sidebarAction, currentActiveTab);
      setErrorStatus("");
    } catch (error) {
      openSidebarButton.disabled = false;
      setErrorStatus(error instanceof Error ? error.message : "Sidebar open failed.");
      return;
    }

    Promise.resolve(openPromise)
      .then(() => refreshPopupState())
      .catch((error) => {
        setErrorStatus(error instanceof Error ? error.message : "Sidebar open failed.");
      })
      .finally(() => {
        openSidebarButton.disabled = false;
      });
  });
}

if (runNowButton) {
  runNowButton.addEventListener("click", async () => {
    const activeTab = await getActiveTab();
    if (!Number.isInteger(activeTab?.id) || !isStartpageUrl(activeTab?.url)) {
      setErrorStatus("Switch to a Startpage results tab before running.");
      return;
    }

    const response = await browser.runtime.sendMessage({
      type: MSG.REQUEST_RUN_FOR_TAB,
      sourceTabId: activeTab.id,
      summaryMode: SUMMARY_MODE.EXPANDED
    });

    if (!response?.ok) {
      setErrorStatus(response?.error || "Could not queue run.");
      return;
    }

    setErrorStatus("");
    await refreshPopupState();
  });
}

if (openSettingsButton) {
  openSettingsButton.addEventListener("click", () => {
    browser.runtime.openOptionsPage().catch(() => undefined);
  });
}

refreshPopupState().catch((error) => {
  setErrorStatus(error instanceof Error ? error.message : "Failed to initialize popup.");
});
