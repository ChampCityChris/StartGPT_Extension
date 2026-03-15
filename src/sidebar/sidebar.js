import { MSG } from "../content/shared/message-types.js";
import { bindActionBar } from "./components/action-bar.js";
import { renderStatusBanner } from "./components/status-banner.js";
import { renderResultCard } from "./components/result-card.js";
import { renderSourceList } from "./components/source-list.js";
import { sanitizeDebugText } from "../content/shared/sanitize.js";
import {
  describeRunTimelineEvent,
  formatDurationMs,
  summarizeRunTimeline
} from "../content/shared/run-timeline.js";

const LOADING_STATES = new Set([
  "queued",
  "opening_bridge",
  "waiting_for_chatgpt",
  "submitting_prompt",
  "waiting_for_response",
  "parsing_response"
]);

const dom = {
  currentQuery: document.getElementById("current-query"),
  statusBanner: document.getElementById("status-banner"),
  startpageSignal: document.getElementById("startpage-signal"),
  chatgptBridgeSignal: document.getElementById("chatgpt-bridge-signal"),
  responseBody: document.getElementById("response-body"),
  sourcesList: document.getElementById("sources-list"),
  followUpForm: document.getElementById("follow-up-form"),
  followUpInput: document.getElementById("follow-up-input"),
  followUpSubmit: document.getElementById("follow-up-submit"),
  regenerateButton: document.getElementById("regenerate-button"),
  openBridgeButton: document.getElementById("open-bridge-button"),
  errorArea: document.getElementById("error-area"),
  metaInfo: document.getElementById("meta-info"),
  debugPanel: document.getElementById("debug-panel"),
  debugDetails: document.getElementById("debug-details")
};

const viewState = {
  sourceTabId: null,
  status: "idle",
  query: "",
  responseText: "",
  sources: [],
  errorText: "",
  capturedAt: null,
  bridgeLinked: false,
  bridgeReachable: false,
  bridgeReady: false,
  bridgeTabId: null,
  bridgeInstanceId: "",
  startpageScript: {
    phase: "",
    lastSeenAt: null,
    errorMessage: ""
  },
  chatgptBridge: {
    phase: "",
    bridgeTabId: null,
    frameId: null,
    lastSeenAt: null,
    errorMessage: "",
    pingReady: false,
    lastPingAt: null,
    pingErrorMessage: "",
    loggedIn: null,
    hasComposer: null
  },
  debugMode: false,
  debug: {
    lastPrompt: "",
    lastErrorCode: "",
    selectorDiagnostics: {},
    submitDiagnostics: null,
    runTimeline: null
  }
};
let actionControl = null;

function allNodesPresent() {
  return Object.values(dom).every(Boolean);
}

function formatCapturedAt(timestamp) {
  if (!timestamp) {
    return "No capture yet.";
  }
  return `Captured: ${new Date(timestamp).toLocaleTimeString()}`;
}

function renderMetaInfo() {
  let bridgeText = "Bridge: sidebar not ready";
  if (viewState.bridgeReady && viewState.bridgeInstanceId) {
    bridgeText = `Bridge: sidebar reachable (${viewState.bridgeInstanceId})`;
  } else if (viewState.bridgeLinked && viewState.bridgeInstanceId) {
    bridgeText = `Bridge: sidebar linked (${viewState.bridgeInstanceId}), ping not confirmed`;
  } else if (viewState.bridgeReachable && viewState.bridgeInstanceId) {
    bridgeText = `Bridge: sidebar reachable (${viewState.bridgeInstanceId})`;
  } else if (viewState.bridgeTabId) {
    bridgeText = `Bridge: sidebar attached to tab ${viewState.bridgeTabId}`;
  }
  dom.metaInfo.textContent = `${formatCapturedAt(viewState.capturedAt)} | ${bridgeText}`;
}

function formatStartpageSignal() {
  const phase = viewState.startpageScript.phase;
  const seenAt = viewState.startpageScript.lastSeenAt
    ? new Date(viewState.startpageScript.lastSeenAt).toLocaleTimeString()
    : "";

  if (phase === "module_loaded") {
    return seenAt
      ? `Startpage content script loaded at ${seenAt}.`
      : "Startpage content script loaded.";
  }

  if (phase === "loader_loaded") {
    return seenAt
      ? `Startpage loader injected at ${seenAt}. Waiting for module startup.`
      : "Startpage loader injected. Waiting for module startup.";
  }

  if (phase === "module_load_failed") {
    const errorMessage = viewState.startpageScript.errorMessage || "Unknown import failure.";
    return `Startpage content script failed to load: ${errorMessage}`;
  }

  return "Waiting for Startpage content script.";
}

function formatChatGptBridgeSignal() {
  const phase = viewState.chatgptBridge.phase;
  const bridgeTabId = viewState.chatgptBridge.bridgeTabId || viewState.bridgeTabId || null;
  const bridgeInstanceId = viewState.bridgeInstanceId || "";
  const frameSuffix = Number.isInteger(viewState.chatgptBridge.frameId)
    ? ` (frame ${viewState.chatgptBridge.frameId})`
    : "";
  const seenAt = viewState.chatgptBridge.lastSeenAt
    ? new Date(viewState.chatgptBridge.lastSeenAt).toLocaleTimeString()
    : "";
  const pingAt = viewState.chatgptBridge.lastPingAt
    ? new Date(viewState.chatgptBridge.lastPingAt).toLocaleTimeString()
    : "";

  if (viewState.chatgptBridge.pingReady && bridgeInstanceId) {
    return pingAt
      ? `ChatGPT sidebar bridge ping confirmed for ${bridgeInstanceId}${frameSuffix} at ${pingAt}.`
      : `ChatGPT sidebar bridge ping confirmed for ${bridgeInstanceId}${frameSuffix}.`;
  }

  if (viewState.chatgptBridge.pingReady && bridgeTabId) {
    return pingAt
      ? `ChatGPT sidebar bridge ping confirmed in tab ${bridgeTabId}${frameSuffix} at ${pingAt}.`
      : `ChatGPT sidebar bridge ping confirmed in tab ${bridgeTabId}${frameSuffix}.`;
  }

  if (phase === "module_loaded") {
    if (viewState.bridgeLinked && bridgeInstanceId) {
      return seenAt
        ? `ChatGPT sidebar bridge module loaded for ${bridgeInstanceId}${frameSuffix} at ${seenAt}, but ping is not confirmed yet.`
        : `ChatGPT sidebar bridge module loaded for ${bridgeInstanceId}${frameSuffix}, but ping is not confirmed yet.`;
    }

    if (viewState.bridgeLinked && bridgeTabId) {
      return seenAt
        ? `ChatGPT sidebar bridge module loaded in linked tab ${bridgeTabId}${frameSuffix} at ${seenAt}, but ping is not confirmed yet.`
        : `ChatGPT sidebar bridge module loaded in linked tab ${bridgeTabId}${frameSuffix}, but ping is not confirmed yet.`;
    }

    if (bridgeInstanceId) {
      return seenAt
        ? `ChatGPT sidebar bridge module loaded for ${bridgeInstanceId}${frameSuffix} at ${seenAt}.`
        : `ChatGPT sidebar bridge module loaded for ${bridgeInstanceId}${frameSuffix}.`;
    }

    if (bridgeTabId) {
      return seenAt
        ? `ChatGPT sidebar bridge module loaded in tab ${bridgeTabId}${frameSuffix} at ${seenAt}.`
        : `ChatGPT sidebar bridge module loaded in tab ${bridgeTabId}${frameSuffix}.`;
    }

    return seenAt
      ? `ChatGPT sidebar bridge module loaded at ${seenAt}.`
      : "ChatGPT sidebar bridge module loaded.";
  }

  if (phase === "loader_loaded") {
    if (bridgeInstanceId) {
      return seenAt
        ? `ChatGPT sidebar bridge loader injected for ${bridgeInstanceId}${frameSuffix} at ${seenAt}. Waiting for module startup.`
        : `ChatGPT sidebar bridge loader injected for ${bridgeInstanceId}${frameSuffix}. Waiting for module startup.`;
    }

    if (bridgeTabId) {
      return seenAt
        ? `ChatGPT sidebar bridge loader injected in tab ${bridgeTabId}${frameSuffix} at ${seenAt}. Waiting for module startup.`
        : `ChatGPT sidebar bridge loader injected in tab ${bridgeTabId}${frameSuffix}. Waiting for module startup.`;
    }

    return seenAt
      ? `ChatGPT sidebar bridge loader injected at ${seenAt}. Waiting for module startup.`
      : "ChatGPT sidebar bridge loader injected. Waiting for module startup.";
  }

  if (phase === "module_load_failed") {
    const errorMessage = viewState.chatgptBridge.errorMessage || "Unknown import failure.";
    if (bridgeInstanceId) {
      return `ChatGPT sidebar bridge failed to load for ${bridgeInstanceId}${frameSuffix}: ${errorMessage}`;
    }
    if (bridgeTabId) {
      return `ChatGPT sidebar bridge failed to load in tab ${bridgeTabId}${frameSuffix}: ${errorMessage}`;
    }
    return `ChatGPT sidebar bridge failed to load: ${errorMessage}`;
  }

  if (viewState.bridgeLinked && bridgeInstanceId) {
    return `Waiting for ChatGPT sidebar bridge ping from ${bridgeInstanceId}${frameSuffix}.`;
  }

  if (viewState.bridgeLinked && bridgeTabId) {
    return `Waiting for ChatGPT sidebar bridge ping from tab ${bridgeTabId}${frameSuffix}.`;
  }

  return "Waiting for ChatGPT sidebar bridge signal.";
}

function renderDebugPanel() {
  if (!viewState.debugMode) {
    dom.debugPanel.hidden = true;
    dom.debugDetails.textContent = "";
    return;
  }

  dom.debugPanel.hidden = false;
  const selectorDiagnostics = viewState.debug.selectorDiagnostics || {};
  const selectorLines = Object.entries(selectorDiagnostics).map(([name, value]) => {
    if (value && typeof value === "object") {
      const matched = value.matched === true ? "hit" : "miss";
      const selector = value.selector ? ` (${value.selector})` : "";
      return `${name}: ${matched}${selector}`;
    }
    return `${name}: ${String(value)}`;
  });
  const submitDiagnostics = viewState.debug.submitDiagnostics;
  const submitLines = !submitDiagnostics || !Array.isArray(submitDiagnostics.attempts) || submitDiagnostics.attempts.length === 0
    ? ["(none)"]
    : [
      `Final submitPath: ${submitDiagnostics.finalSubmitPath || "(none)"}`,
      `Final waitedForButtonMs: ${submitDiagnostics.finalWaitedForButtonMs ?? 0}`,
      `Final sendButtonPresent: ${submitDiagnostics.finalSendButtonPresent ? "yes" : "no"}`,
      `Final preexistingStreamingDetected: ${submitDiagnostics.finalPreexistingStreamingDetected ? "yes" : "no"}`,
      `Final waitedForIdleMs: ${submitDiagnostics.finalWaitedForIdleMs ?? 0}`,
      `Final ackReason: ${submitDiagnostics.finalAckReason || "(none)"}`,
      `Final responseStartReason: ${submitDiagnostics.finalResponseStartReason || "(none)"}`,
      ...submitDiagnostics.attempts.map((attempt) => (
        `Attempt ${attempt.attempt}: ok=${attempt.ok ? "yes" : "no"} | submitPath=${attempt.submitPath || "(none)"} | waitMs=${attempt.waitedForButtonMs ?? 0} | sendButtonPresent=${attempt.sendButtonPresent ? "yes" : "no"} | preexistingStreaming=${attempt.preexistingStreamingDetected ? "yes" : "no"} | idleWaitMs=${attempt.waitedForIdleMs ?? 0} | ackReason=${attempt.ackReason || "(none)"} | responseStartReason=${attempt.responseStartReason || "(none)"} | code=${attempt.code || "(none)"}`
      ))
    ];
  const timelineSummary = summarizeRunTimeline(viewState.debug.runTimeline);
  const timelineLines = timelineSummary.events.length === 0
    ? ["(none)"]
    : [
      `Started: ${timelineSummary.startedAt ? new Date(timelineSummary.startedAt).toLocaleTimeString() : "(none)"}`,
      `Total: ${formatDurationMs(timelineSummary.totalMs)}`,
      ...timelineSummary.events.map((event) => {
        const detail = event.detail ? ` | ${event.detail}` : "";
        return `T+${formatDurationMs(event.sinceStartMs)} (+${formatDurationMs(event.sincePreviousMs)}) [${event.source}] ${describeRunTimelineEvent(event.name)}${detail}`;
      })
    ];

  const debugText = [
    `Last Error Code: ${viewState.debug.lastErrorCode || "(none)"}`,
    `Bridge Instance: ${viewState.bridgeInstanceId || "(none)"}`,
    `Bridge Tab ID: ${viewState.bridgeTabId || "(none)"}`,
    `Bridge Frame ID: ${Number.isInteger(viewState.chatgptBridge.frameId) ? viewState.chatgptBridge.frameId : "(none)"}`,
    `Bridge Linked: ${viewState.bridgeLinked ? "yes" : "no"}`,
    `Bridge Reachable: ${viewState.bridgeReachable ? "yes" : "no"}`,
    "",
    "Last Prompt:",
    viewState.debug.lastPrompt || "(none)",
    "",
    "Selector Diagnostics:",
    selectorLines.length > 0 ? selectorLines.join("\n") : "(none)",
    "",
    "Submit Diagnostics:",
    submitLines.join("\n"),
    "",
    "Run Timeline:",
    timelineLines.join("\n")
  ].join("\n");
  dom.debugDetails.textContent = sanitizeDebugText(debugText, 5000);
}

function renderErrorArea() {
  dom.errorArea.textContent = viewState.errorText || "";
}

function render() {
  dom.currentQuery.textContent = viewState.query || "No Startpage query captured yet.";
  renderStatusBanner(dom.statusBanner, viewState.status);
  dom.startpageSignal.textContent = formatStartpageSignal();
  dom.chatgptBridgeSignal.textContent = formatChatGptBridgeSignal();
  renderResultCard(dom.responseBody, viewState.responseText, viewState.status);
  renderSourceList(dom.sourcesList, viewState.sources);
  renderErrorArea();
  renderMetaInfo();
  renderDebugPanel();
}

function isBusyStatus(status) {
  return LOADING_STATES.has(status);
}

function applySession(session, sourceTabId) {
  viewState.sourceTabId = sourceTabId;
  viewState.status = session?.status || "idle";
  viewState.query = session?.query || "";
  viewState.responseText = session?.response?.text || "";
  viewState.sources = Array.isArray(session?.response?.sources) ? session.response.sources : [];
  viewState.errorText = session?.lastError?.message || "";
  viewState.capturedAt = session?.capturedAt || null;
  viewState.startpageScript = {
    phase: session?.debug?.startpageScript?.phase || "",
    lastSeenAt: session?.debug?.startpageScript?.lastSeenAt || null,
    errorMessage: session?.debug?.startpageScript?.errorMessage || ""
  };
  viewState.chatgptBridge = {
    phase: session?.debug?.chatgptBridge?.phase || "",
    bridgeTabId: session?.debug?.chatgptBridge?.bridgeTabId || session?.bridgeTabId || null,
    frameId: Number.isInteger(session?.debug?.chatgptBridge?.frameId) ? session.debug.chatgptBridge.frameId : null,
    lastSeenAt: session?.debug?.chatgptBridge?.lastSeenAt || null,
    errorMessage: session?.debug?.chatgptBridge?.errorMessage || "",
    pingReady: Boolean(session?.debug?.chatgptBridge?.pingReady),
    lastPingAt: session?.debug?.chatgptBridge?.lastPingAt || null,
    pingErrorMessage: session?.debug?.chatgptBridge?.pingErrorMessage || "",
    loggedIn: typeof session?.debug?.chatgptBridge?.loggedIn === "boolean" ? session.debug.chatgptBridge.loggedIn : null,
    hasComposer: typeof session?.debug?.chatgptBridge?.hasComposer === "boolean" ? session.debug.chatgptBridge.hasComposer : null
  };
  viewState.bridgeInstanceId = session?.bridgeRuntimeInstanceId || "";
  viewState.debug = {
    lastPrompt: session?.debug?.lastPrompt || "",
    lastErrorCode: session?.debug?.lastErrorCode || "",
    selectorDiagnostics: session?.debug?.selectorDiagnostics || {},
    submitDiagnostics: session?.debug?.submitDiagnostics || null,
    runTimeline: session?.debug?.runTimeline || null
  };
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
  const preferredBridgeTabId = response.bridge?.bridgeTabId || session?.bridgeTabId || null;
  const sessionBridgeSignal = session?.debug?.chatgptBridge || null;
  const hasMatchingSessionSignal = Boolean(
    sessionBridgeSignal &&
    (
      !Number.isInteger(preferredBridgeTabId) ||
      sessionBridgeSignal.bridgeTabId === preferredBridgeTabId
    )
  );
  const bridgeSignal = response.bridge?.signal || (hasMatchingSessionSignal ? sessionBridgeSignal : null);
  viewState.chatgptBridge = {
    phase: bridgeSignal?.phase || "",
    bridgeTabId: bridgeSignal?.bridgeTabId || preferredBridgeTabId,
    frameId: Number.isInteger(bridgeSignal?.frameId) ? bridgeSignal.frameId : null,
    lastSeenAt: bridgeSignal?.lastSeenAt || null,
    errorMessage: bridgeSignal?.errorMessage || "",
    pingReady: Boolean(bridgeSignal?.pingReady),
    lastPingAt: bridgeSignal?.lastPingAt || null,
    pingErrorMessage: bridgeSignal?.pingErrorMessage || "",
    loggedIn: typeof bridgeSignal?.loggedIn === "boolean" ? bridgeSignal.loggedIn : null,
    hasComposer: typeof bridgeSignal?.hasComposer === "boolean" ? bridgeSignal.hasComposer : null
  };
  viewState.bridgeLinked = Boolean(response.bridge?.linked);
  viewState.bridgeReachable = Boolean(response.bridge?.reachable);
  viewState.bridgeReady = Boolean(response.bridge?.ready);
  viewState.bridgeTabId = response.bridge?.bridgeTabId || null;
  viewState.bridgeInstanceId = response.bridge?.bridgeInstanceId || viewState.bridgeInstanceId || "";
  viewState.debugMode = Boolean(response.state?.settings?.debugMode);
}

async function refreshState() {
  try {
    await fetchSidebarState();
  } catch (error) {
    viewState.errorText = error instanceof Error ? error.message : "Unknown sidebar state error";
  }
  render();
  if (actionControl) {
    actionControl.setDisabled(isBusyStatus(viewState.status));
  }
}

async function requestManualRun() {
  if (!Number.isInteger(viewState.sourceTabId)) {
    viewState.errorText = "No active Startpage tab to run.";
    render();
    return;
  }

  const response = await browser.runtime.sendMessage({
    type: MSG.REQUEST_RUN_FOR_TAB,
    sourceTabId: viewState.sourceTabId
  });

  if (!response?.ok) {
    viewState.errorText = response?.error || "Could not queue a run.";
    render();
    return;
  }

  viewState.errorText = "";
  await refreshState();
}

async function openChatGptSidebar() {
  const response = await browser.runtime.sendMessage({
    type: MSG.REQUEST_OPEN_CHATGPT_SIDEBAR,
    sourceTabId: viewState.sourceTabId
  });

  if (!response?.ok) {
    throw new Error(response?.error || "Could not open ChatGPT sidebar");
  }

  viewState.bridgeReady = Boolean(response.bridge?.ready);
  viewState.bridgeLinked = Boolean(response.bridge?.linked);
  viewState.bridgeReachable = Boolean(response.bridge?.reachable);
  viewState.bridgeTabId = response.bridge?.bridgeTabId || null;
  viewState.bridgeInstanceId = response.bridge?.bridgeInstanceId || "";
  render();
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
    viewState.errorText = response?.error || "Follow-up is not available yet.";
    render();
    return;
  }

  viewState.errorText = "";
  await refreshState();
}

function registerRuntimeListener() {
  browser.runtime.onMessage.addListener((message) => {
    if (!message?.type) {
      return undefined;
    }

    if (message.type === MSG.SESSION_UPDATED || message.type === MSG.BRIDGE_RESPONSE_READY || message.type === MSG.RUN_FAILED) {
      refreshState().catch((error) => {
        viewState.errorText = error instanceof Error ? error.message : "Sidebar refresh failed";
        render();
      });
    }

    return undefined;
  });
}

if (allNodesPresent()) {
  actionControl = bindActionBar(
    {
      regenerateButton: dom.regenerateButton,
      openBridgeButton: dom.openBridgeButton,
      followUpForm: dom.followUpForm,
      followUpInput: dom.followUpInput,
      followUpSubmit: dom.followUpSubmit
    },
    {
      onRegenerate: () => {
        requestManualRun().catch((error) => {
          viewState.errorText = error instanceof Error ? error.message : "Manual run failed";
          render();
        });
      },
      onOpenBridge: () => {
        openChatGptSidebar().catch((error) => {
          viewState.errorText = error instanceof Error ? error.message : "Could not open ChatGPT sidebar";
          render();
        });
      },
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
