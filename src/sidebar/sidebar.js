import { MSG } from "../content/shared/message-types.js";
import { bindActionBar } from "./components/action-bar.js";
import { renderStatusBanner } from "./components/status-banner.js";
import { renderResultCard } from "./components/result-card.js";
import { renderSourceList } from "./components/source-list.js";

const LOADING_STATES = new Set(["queued", "running"]);

const dom = {
  currentQuery: document.getElementById("current-query"),
  statusBanner: document.getElementById("status-banner"),
  startpageSignal: document.getElementById("startpage-signal"),
  apiKeySignal: document.getElementById("api-key-signal"),
  responseBody: document.getElementById("response-body"),
  sourcesList: document.getElementById("sources-list"),
  summaryMode: document.getElementById("summary-mode"),
  followUpForm: document.getElementById("follow-up-form"),
  followUpInput: document.getElementById("follow-up-input"),
  followUpSubmit: document.getElementById("follow-up-submit"),
  regenerateButton: document.getElementById("regenerate-button"),
  openSettingsButton: document.getElementById("open-settings-button"),
  errorArea: document.getElementById("error-area"),
  metaInfo: document.getElementById("meta-info")
};

const viewState = {
  sourceTabId: null,
  status: "idle",
  query: "",
  responseText: "",
  sources: [],
  errorText: "",
  progressText: "",
  startpageSignalText: "Waiting for Startpage context.",
  hasApiKey: false,
  settingsModel: "",
  settingsDefaultMode: ""
};

let actionControl = null;

function allNodesPresent() {
  return Object.values(dom).every(Boolean);
}

function isBusyStatus(status) {
  return LOADING_STATES.has(status);
}

function formatCapturedAt(timestamp) {
  if (!timestamp) {
    return "No capture yet";
  }
  return `Captured: ${new Date(timestamp).toLocaleTimeString()}`;
}

function applySession(session, sourceTabId) {
  viewState.sourceTabId = sourceTabId;
  viewState.status = session?.status || "idle";
  viewState.query = session?.query || "";
  viewState.responseText = session?.response?.text || "";
  viewState.sources = Array.isArray(session?.response?.sources) ? session.response.sources : [];
  viewState.errorText = session?.lastError?.message || "";
  viewState.progressText = session?.debug?.progressMessage || "";
  const script = session?.debug?.startpageScript || {};
  viewState.startpageSignalText = script.phase === "module_loaded"
    ? `Startpage content script loaded (${new Date(script.lastSeenAt || Date.now()).toLocaleTimeString()}).`
    : "Waiting for Startpage context.";
  viewState.metaInfo = `${formatCapturedAt(session?.capturedAt)} | Status: ${session?.status || "idle"}`;
}

async function getSourceTabId() {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  const firstTab = tabs[0];
  return Number.isInteger(firstTab?.id) ? firstTab.id : null;
}

async function fetchSidebarState() {
  const sourceTabId = await getSourceTabId();
  const response = await browser.runtime.sendMessage({
    type: MSG.SIDEBAR_GET_STATE,
    sourceTabId
  });

  if (!response?.ok) {
    throw new Error(response?.error || "Unable to fetch sidebar state");
  }

  const session = response.session || response.state?.sessions?.[String(sourceTabId)] || null;
  const resolvedSourceTabId = Number.isInteger(session?.tabId) ? session.tabId : sourceTabId;
  applySession(session, resolvedSourceTabId);
  viewState.hasApiKey = Boolean(response.hasApiKey);
  viewState.settingsModel = String(response.state?.settings?.model || "");
  viewState.settingsDefaultMode = String(response.state?.settings?.defaultSummaryMode || "");
}

function render() {
  dom.currentQuery.textContent = viewState.query || "No Startpage query captured yet.";
  renderStatusBanner(dom.statusBanner, viewState.status);
  dom.startpageSignal.textContent = viewState.startpageSignalText;
  dom.apiKeySignal.textContent = viewState.hasApiKey
    ? `OpenAI API key is configured. Model: ${viewState.settingsModel || "(default)"}.`
    : "No OpenAI API key configured. Open Settings to add your key.";
  renderResultCard(dom.responseBody, viewState.responseText, viewState.status);
  renderSourceList(dom.sourcesList, viewState.sources);
  dom.errorArea.textContent = viewState.errorText;
  dom.metaInfo.textContent = viewState.progressText || viewState.metaInfo || "";

  if (actionControl) {
    actionControl.setDisabled(isBusyStatus(viewState.status));
  }
}

async function refreshState() {
  try {
    await fetchSidebarState();
  } catch (error) {
    viewState.errorText = error instanceof Error ? error.message : "Sidebar state error";
  }
  render();
}

function getSelectedSummaryMode() {
  const mode = String(dom.summaryMode.value || "");
  return mode || null;
}

async function requestManualRun() {
  if (!Number.isInteger(viewState.sourceTabId)) {
    viewState.errorText = "No active Startpage tab to run.";
    render();
    return;
  }

  const response = await browser.runtime.sendMessage({
    type: MSG.REQUEST_RUN_FOR_TAB,
    sourceTabId: viewState.sourceTabId,
    summaryMode: getSelectedSummaryMode()
  });

  if (!response?.ok) {
    viewState.errorText = response?.error || "Could not queue run.";
    render();
    return;
  }

  viewState.errorText = "";
  await refreshState();
}

async function sendFollowUp(question) {
  if (!Number.isInteger(viewState.sourceTabId)) {
    viewState.errorText = "No active Startpage tab for follow-up.";
    render();
    return;
  }

  const response = await browser.runtime.sendMessage({
    type: MSG.SIDEBAR_FOLLOW_UP,
    sourceTabId: viewState.sourceTabId,
    followUp: question
  });

  if (!response?.ok) {
    viewState.errorText = response?.error || "Follow-up request failed.";
    render();
    return;
  }

  viewState.errorText = "";
  await refreshState();
}

function openSettings() {
  browser.runtime.openOptionsPage().catch(() => undefined);
}

function registerRuntimeListener() {
  browser.runtime.onMessage.addListener((message) => {
    if (!message?.type || message.type !== MSG.SESSION_UPDATED) {
      return undefined;
    }
    refreshState().catch(() => undefined);
    return undefined;
  });
}

if (allNodesPresent()) {
  actionControl = bindActionBar(
    {
      regenerateButton: dom.regenerateButton,
      openSettingsButton: dom.openSettingsButton,
      followUpForm: dom.followUpForm,
      followUpInput: dom.followUpInput,
      followUpSubmit: dom.followUpSubmit
    },
    {
      onRegenerate: () => {
        requestManualRun().catch((error) => {
          viewState.errorText = error instanceof Error ? error.message : "Run request failed";
          render();
        });
      },
      onOpenSettings: openSettings,
      onFollowUp: (question) => {
        sendFollowUp(question).catch((error) => {
          viewState.errorText = error instanceof Error ? error.message : "Follow-up request failed";
          render();
        });
      }
    }
  );

  refreshState().catch((error) => {
    viewState.errorText = error instanceof Error ? error.message : "Sidebar initialization failed";
    render();
  });

  registerRuntimeListener();
}
