import { routeMessage } from "./message-router.js";
import { DEBUG, STATUS } from "./constants.js";
import {
  CHATGPT_SIDEBAR_PANEL_URL,
  SIDEBAR_UNAVAILABLE_URL,
  getSidebarPanelForUrl,
  isStartpageResultsUrl
} from "./sidebar-panel.js";
import {
  appendSessionRunTimelineEvent,
  completeSessionRun,
  failSessionRun,
  getState,
  getSession,
  getSettings,
  initializeRuntimeState,
  markSessionOpeningBridge,
  markSessionParsingResponse,
  markSessionQueued,
  markSessionSubmittingPrompt,
  markSessionWaitingForChatGpt,
  markSessionWaitingForResponse,
  mergeSessionRunTimeline,
  resetSessionRunTimeline,
  setSessionDebug,
  setSettings
} from "./state.js";
import { shouldApplyBridgeProgress } from "./bridge-progress-policy.js";
import { getSidebarRunAvailability } from "./bridge-start-policy.js";
import {
  ensureSidebarBridgeReady,
  forgetClosedBridgeContext,
  getSidebarBridgeStatus,
  registerRuntimeBridgePort,
  resolveRuntimeBridgeReply,
  sendRuntimeBridgeRequest,
  unregisterRuntimeBridgePort
} from "./tab-manager.js";
import { MSG } from "../content/shared/message-types.js";
import { buildPrompt } from "./prompt-builder.js";
import { validateBridgeResponsePayload } from "../content/shared/schema.js";
import { sanitizeDebugText, sanitizeErrorCode } from "../content/shared/sanitize.js";
import { RUN_TIMELINE_EVENT } from "../content/shared/run-timeline.js";

const BRIDGE_RESPONSE_START_TIMEOUT_MS = 30000;
const BRIDGE_RESPONSE_START_RETRY_ATTEMPTS = 1;
const BRIDGE_RESPONSE_RETRY_DELAY_MS = 800;
const BRIDGE_RESPONSE_COMPLETE_TIMEOUT_MS = 120000;
// Keep the background request timeout above the in-page bridge wait budget.
const BRIDGE_RUN_TIMEOUT_MS =
  BRIDGE_RESPONSE_COMPLETE_TIMEOUT_MS +
  (BRIDGE_RESPONSE_START_TIMEOUT_MS * (BRIDGE_RESPONSE_START_RETRY_ATTEMPTS + 1)) +
  (BRIDGE_RESPONSE_RETRY_DELAY_MS * BRIDGE_RESPONSE_START_RETRY_ATTEMPTS) +
  10000;
const BRIDGE_SETUP_TIMEOUT_MS = 20000;
let hasCompletedInitialSidebarSync = false;
let hasShownInitialSidebarAnnouncement = false;
const RUN_IN_FLIGHT_STATUSES = new Set([
  STATUS.QUEUED,
  STATUS.OPENING_BRIDGE,
  STATUS.WAITING_FOR_CHATGPT,
  STATUS.SUBMITTING_PROMPT,
  STATUS.WAITING_FOR_RESPONSE,
  STATUS.PARSING_RESPONSE
]);
const AUTO_RESUME_BRIDGE_ERROR_CODES = new Set([
  "CHATGPT_SIDEBAR_BRIDGE_NOT_READY",
  "CHATGPT_SIDEBAR_NOT_OPEN"
]);

function resolveSourceTabId(message, sender) {
  if (Number.isInteger(message?.sourceTabId)) {
    return message.sourceTabId;
  }
  if (Number.isInteger(message?.tabId)) {
    return message.tabId;
  }
  if (Number.isInteger(sender?.tab?.id)) {
    return sender.tab.id;
  }
  return null;
}

function createRunId(sourceTabId) {
  return `run_${sourceTabId}_${Date.now()}`;
}

function isRunInFlightStatus(status) {
  return RUN_IN_FLIGHT_STATUSES.has(status);
}

function setSessionProgress(sourceTabId, progressMessage) {
  setSessionDebug(sourceTabId, {
    progressMessage: sanitizeDebugText(progressMessage || "", 500)
  });
}

function recordSessionRunTimelineEvent(sourceTabId, name, detail = "", source = "background") {
  appendSessionRunTimelineEvent(sourceTabId, {
    name,
    detail,
    source,
    at: Date.now()
  });
}

function resetQueuedRunTimeline(sourceTabId, detail = "") {
  resetSessionRunTimeline(sourceTabId, {
    startedAt: Date.now(),
    events: [
      {
        name: RUN_TIMELINE_EVENT.RUN_QUEUED,
        at: Date.now(),
        source: "background",
        detail
      }
    ]
  });
}

function mergeBridgeTimeline(sourceTabId, bridgeDebug) {
  if (bridgeDebug?.timeline) {
    mergeSessionRunTimeline(sourceTabId, bridgeDebug.timeline);
  }
}

function getBridgeSubmitDiagnostics(bridgeDebug) {
  return bridgeDebug?.submitDiagnostics || null;
}

async function withTimeout(taskPromise, timeoutMs, timeoutErrorCode) {
  return new Promise((resolve, reject) => {
    const timeoutId = globalThis.setTimeout(() => {
      reject(new Error(timeoutErrorCode));
    }, timeoutMs);

    taskPromise
      .then((value) => {
        globalThis.clearTimeout(timeoutId);
        resolve(value);
      })
      .catch((error) => {
        globalThis.clearTimeout(timeoutId);
        reject(error);
      });
  });
}

async function setSidebarPanelForTab(tabId, url) {
  if (!Number.isInteger(tabId) || !browser.sidebarAction?.setPanel) {
    return;
  }

  const panel = getSidebarPanelForUrl(url);
  await browser.sidebarAction.setPanel({ tabId, panel });
}

function buildSidebarPanelUrl(panelUrl, forceReload) {
  if (!forceReload) {
    return panelUrl;
  }

  const separator = panelUrl.includes("?") ? "&" : "?";
  return `${panelUrl}${separator}reload=${Date.now()}`;
}

async function ensureSidebarOpenForTab(tabId, panelUrl, { forceReload = false } = {}) {
  if (!Number.isInteger(tabId) || !browser.sidebarAction) {
    return { panelSet: false, opened: false, errorMessage: "sidebar_api_unavailable" };
  }

  let panelSet = false;
  let panelErrorMessage = "";
  if (browser.sidebarAction.setPanel) {
    const panel = buildSidebarPanelUrl(panelUrl, forceReload);
    try {
      await browser.sidebarAction.setPanel({
        tabId,
        panel
      });
      panelSet = true;
    } catch (error) {
      panelErrorMessage = error instanceof Error ? error.message : String(error || "sidebar_set_panel_failed");
    }
  }

  let opened = false;
  let openErrorMessage = "";
  if (browser.sidebarAction.open) {
    try {
      await browser.sidebarAction.open();
      opened = true;
    } catch (error) {
      opened = false;
      openErrorMessage = error instanceof Error ? error.message : String(error || "sidebar_open_failed");
    }
  }

  if (browser.sidebarAction.isOpen) {
    try {
      const openState = await browser.sidebarAction.isOpen({});
      opened = Boolean(openState);
    } catch {
      // Keep best-effort opened state from open().
    }
  }

  return {
    panelSet,
    opened,
    errorMessage: openErrorMessage || panelErrorMessage || ""
  };
}

async function ensureChatGptSidebarOpenForTab(tabId, { forceReload = false } = {}) {
  return ensureSidebarOpenForTab(tabId, CHATGPT_SIDEBAR_PANEL_URL, { forceReload });
}

async function maybeOpenSidebarForStartpageContext(tabId) {
  if (!Number.isInteger(tabId)) {
    return { attempted: false, opened: false };
  }

  try {
    const tab = await browser.tabs.get(tabId);
    if (!isStartpageResultsUrl(tab?.url)) {
      return { attempted: false, opened: false };
    }

    const active = await isTabActiveInCurrentWindow(tabId);
    if (!active) {
      return { attempted: false, opened: false };
    }

    const sidebar = await ensureChatGptSidebarOpenForTab(tabId, { forceReload: false });
    return { attempted: true, opened: Boolean(sidebar?.opened) };
  } catch {
    return { attempted: true, opened: false };
  }
}

async function openChatGptSidebarForTab(tabId, { forceReload = false } = {}) {
  const sidebar = await ensureChatGptSidebarOpenForTab(tabId, { forceReload });
  if (!sidebar.opened) {
    const openDetail = sidebar.errorMessage ? ` (${sidebar.errorMessage})` : "";
    throw new Error(`bridge_sidebar_not_open${openDetail}`);
  }
  return sidebar;
}

async function isTabActiveInCurrentWindow(tabId) {
  if (!Number.isInteger(tabId)) {
    return false;
  }
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  return tabs.some((tab) => tab?.id === tabId);
}

async function syncSidebarVisibilityForTab(tabId, url) {
  if (!Number.isInteger(tabId) || !browser.sidebarAction?.setPanel) {
    return;
  }

  await setSidebarPanelForTab(tabId, url);
}

async function showInitialSidebarAnnouncement() {
  if (hasShownInitialSidebarAnnouncement) {
    return;
  }

  hasShownInitialSidebarAnnouncement = true;

  try {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    const activeTab = tabs[0] || null;
    if (!Number.isInteger(activeTab?.id)) {
      return;
    }

    await ensureSidebarOpenForTab(activeTab.id, SIDEBAR_UNAVAILABLE_URL);
  } catch (error) {
    if (DEBUG.enabled || getSettings().debugMode) {
      console.debug("[StartGPT][background] initial sidebar announcement failed", error);
    }
  }
}

async function syncSidebarPanels() {
  const tabs = await browser.tabs.query({});
  await Promise.all(
    tabs
      .filter((tab) => Number.isInteger(tab?.id))
      .map((tab) => setSidebarPanelForTab(tab.id, tab.url))
  );

  await showInitialSidebarAnnouncement();
  hasCompletedInitialSidebarSync = true;
}

function toSerializableSession(tabId, session) {
  if (!session) {
    return null;
  }

  return {
    tabId,
    ...session
  };
}

function createFailurePayload(sourceTabId, runId, code, message, recoverable = true) {
  return {
    type: MSG.RUN_FAILED,
    sourceTabId,
    runId,
    code,
    message,
    recoverable,
    debug: {
      lastErrorCode: sanitizeErrorCode(code)
    }
  };
}

function getBridgeSetupFailure(error) {
  const code = error instanceof Error ? error.message : String(error || "");
  const detailSuffix = code.startsWith("bridge_script_not_ready:")
    ? code.slice("bridge_script_not_ready:".length)
    : "";
  const sidebarOpenDetail = code.startsWith("bridge_sidebar_not_open")
    ? code.slice("bridge_sidebar_not_open".length).trim()
    : "";
  const detailMap = Object.fromEntries(
    detailSuffix
      .split("|")
      .map((entry) => entry.split("="))
      .filter(([key, value]) => Boolean(key) && typeof value === "string")
  );

  switch (code) {
    case "bridge_setup_timeout":
      return {
        code: "BRIDGE_SETUP_TIMEOUT",
        message: "Connecting to the ChatGPT sidebar bridge took too long."
      };
    case "bridge_sidebar_not_open":
      return {
        code: "CHATGPT_SIDEBAR_NOT_OPEN",
        message: "Firefox blocked automatic sidebar opening. Use the StartGPT popup's Open ChatGPT Sidebar button, then Regenerate."
      };
    case "bridge_runtime_not_ready":
      return {
        code: "CHATGPT_SIDEBAR_BRIDGE_NOT_READY",
        message: "ChatGPT sidebar bridge did not register in time for this run."
      };
    case "bridge_runtime_not_reachable":
      return {
        code: "CHATGPT_SIDEBAR_BRIDGE_NOT_READY",
        message: "ChatGPT sidebar bridge is registered but not reachable yet."
      };
    case "bridge_script_not_ready":
      return {
        code: "CHATGPT_BRIDGE_NOT_READY",
        message: "ChatGPT sidebar loaded, but the bridge script never became ready."
      };
    case "chatgpt_bridge_module_load_failed":
      return {
        code: "CHATGPT_BRIDGE_LOAD_FAILED",
        message: "ChatGPT sidebar loaded, but the bridge module failed to load."
      };
    default:
      if (code.startsWith("bridge_sidebar_not_open")) {
        return {
          code: "CHATGPT_SIDEBAR_NOT_OPEN",
          message: `Firefox blocked automatic sidebar opening. Use the StartGPT popup's Open ChatGPT Sidebar button, then Regenerate${sidebarOpenDetail || ""}.`
        };
      }
      if (code.startsWith("bridge_script_not_ready:")) {
        const summary = [
          `url=${detailMap.url || "(none)"}`,
          `status=${detailMap.status || "(none)"}`,
          `phase=${detailMap.phase || "(none)"}`,
          `frame=${detailMap.frameId || "(none)"}`,
          `ping=${detailMap.pingCode || "(none)"}`,
          `pingMessage=${detailMap.pingMessage || "(none)"}`
        ].join(", ");
        return {
          code: "CHATGPT_BRIDGE_NOT_READY",
          message: `ChatGPT sidebar bridge did not become ready. ${summary}`
        };
      }
      return {
        code: "CHATGPT_SIDEBAR_NOT_OPEN",
        message: "Could not open the ChatGPT sidebar."
      };
  }
}

async function broadcastMessage(message) {
  try {
    await browser.runtime.sendMessage(message);
  } catch {
    // Ignore when no extension page is listening.
  }
}

async function sendMessageToSourceTab(sourceTabId, message) {
  if (!Number.isInteger(sourceTabId)) {
    return;
  }

  try {
    await browser.tabs.sendMessage(sourceTabId, message);
  } catch {
    // Ignore when source tab content script is unavailable.
  }
}

async function broadcastSessionUpdated(sourceTabId) {
  const session = getSession(sourceTabId);
  const payload = {
    type: MSG.SESSION_UPDATED,
    sourceTabId,
    session: toSerializableSession(sourceTabId, session),
    bridge: getSidebarBridgeStatus(sourceTabId)
  };
  await broadcastMessage(payload);
  await sendMessageToSourceTab(sourceTabId, payload);
}

function isRuntimeBridgeTransportError(error) {
  if (!(error instanceof Error)) {
    return false;
  }

  return (
    error.message === "bridge_runtime_not_reachable" ||
    error.message === "bridge_runtime_disconnected" ||
    error.message === "bridge_runtime_request_timeout"
  );
}

async function sendBridgePromptWithReconnect(sourceTabId, bridge, payload, onTimingEvent = null) {
  let activeBridge = bridge;
  let attemptedReconnect = false;

  while (true) {
    try {
      const response = await sendRuntimeBridgeRequest(activeBridge?.bridgeInstanceId, {
        ...payload,
        bridgeInstanceId: activeBridge?.bridgeInstanceId || ""
      }, BRIDGE_RUN_TIMEOUT_MS);
      return { ok: true, response, bridge: activeBridge };
    } catch (error) {
      if (!activeBridge || activeBridge.channel !== "runtime" || attemptedReconnect || !isRuntimeBridgeTransportError(error)) {
        return { ok: false, error };
      }

      attemptedReconnect = true;
      if (typeof onTimingEvent === "function") {
        onTimingEvent(RUN_TIMELINE_EVENT.BRIDGE_RECONNECT_ATTEMPTED, error.message);
      }
      setSessionProgress(sourceTabId, "Sidebar bridge disconnected during send. Reconnecting and retrying once.");
      await broadcastSessionUpdated(sourceTabId);

      try {
        activeBridge = await resolveBridgeForRun(sourceTabId);
      } catch {
        return { ok: false, error };
      }
    }
  }
}

async function maybeResumeRunAfterRuntimeBridgeReady() {
  const state = getState();
  const preferredTabId = Number.isInteger(state.global.activeSidebarTabId)
    ? state.global.activeSidebarTabId
    : null;

  if (Number.isInteger(preferredTabId)) {
    const preferred = getSession(preferredTabId);
    const preferredError = preferred?.lastError?.code || preferred?.debug?.lastErrorCode || "";
    if (preferred?.status === STATUS.FAILED && AUTO_RESUME_BRIDGE_ERROR_CODES.has(preferredError)) {
      markSessionQueued(preferredTabId);
      resetQueuedRunTimeline(preferredTabId, "resume_after_bridge_ready");
      setSessionProgress(preferredTabId, "Sidebar bridge is ready. Resuming run automatically.");
      await broadcastSessionUpdated(preferredTabId);
      maybeStartRun(preferredTabId);
      return true;
    }
  }

  for (const [tabKey, session] of Object.entries(state.sessions)) {
    const sourceTabId = Number.parseInt(tabKey, 10);
    if (!Number.isInteger(sourceTabId) || !session) {
      continue;
    }

    const lastErrorCode = session.lastError?.code || session.debug?.lastErrorCode || "";
    if (session.status === STATUS.FAILED && AUTO_RESUME_BRIDGE_ERROR_CODES.has(lastErrorCode)) {
      markSessionQueued(sourceTabId);
      resetQueuedRunTimeline(sourceTabId, "resume_after_bridge_ready");
      setSessionProgress(sourceTabId, "Sidebar bridge is ready. Resuming run automatically.");
      await broadcastSessionUpdated(sourceTabId);
      maybeStartRun(sourceTabId);
      return true;
    }
  }

  return false;
}

function buildFollowUpPrompt(session, followUp, promptMode) {
  const followUpText = String(followUp || "").trim();
  if (!followUpText) {
    return buildPrompt({
      query: session.query,
      results: session.results,
      mode: promptMode
    });
  }

  const basePrompt = buildPrompt({
    query: session.query,
    results: session.results,
    mode: promptMode
  });
  const previousAnswer = session.response?.text || "";

  return [
    basePrompt,
    "",
    "Previous assistant answer:",
    previousAnswer || "(none)",
    "",
    "Follow-up question:",
    followUpText
  ].join("\n");
}

async function resolveBridgeForRun(sourceTabId) {
  let lastProgressAt = 0;
  let lastProgressMessage = "";
  const onTimingEvent = (nameOrEvent, detail = "") => {
    if (!nameOrEvent) {
      return;
    }

    if (typeof nameOrEvent === "string") {
      recordSessionRunTimelineEvent(sourceTabId, nameOrEvent, detail);
      return;
    }

    if (typeof nameOrEvent === "object" && typeof nameOrEvent.name === "string") {
      recordSessionRunTimelineEvent(
        sourceTabId,
        nameOrEvent.name,
        nameOrEvent.detail || "",
        nameOrEvent.source || "background"
      );
    }
  };
  const onProgress = (progressMessage) => {
    const now = Date.now();
    if (progressMessage === lastProgressMessage && now - lastProgressAt < 1000) {
      return;
    }
    lastProgressMessage = progressMessage;
    setSessionProgress(sourceTabId, progressMessage);
    if (now - lastProgressAt >= 250) {
      lastProgressAt = now;
      broadcastSessionUpdated(sourceTabId).catch(() => undefined);
    }
  };

  setSessionProgress(sourceTabId, "Ensuring ChatGPT sidebar bridge is available for this tab.");
  await broadcastSessionUpdated(sourceTabId);
  onTimingEvent(RUN_TIMELINE_EVENT.SIDEBAR_OPEN_STARTED);
  const sidebar = await ensureChatGptSidebarOpenForTab(sourceTabId, { forceReload: false });
  onTimingEvent(
    sidebar.opened
      ? RUN_TIMELINE_EVENT.SIDEBAR_OPEN_COMPLETED
      : RUN_TIMELINE_EVENT.SIDEBAR_OPEN_BLOCKED,
    sidebar.errorMessage || ""
  );
  const existingBridge = getSidebarBridgeStatus(sourceTabId);
  const availability = getSidebarRunAvailability(sidebar, existingBridge);

  if (!availability.canProceed) {
    const openDetail = sidebar.errorMessage ? ` (${sidebar.errorMessage})` : "";
    throw new Error(`bridge_sidebar_not_open${openDetail}`);
  }

  if (availability.reusedExistingBridge) {
    const instanceDetail = existingBridge?.bridgeInstanceId ? ` (${existingBridge.bridgeInstanceId})` : "";
    onProgress(`Browser blocked sidebar auto-open. Reusing existing ChatGPT bridge${instanceDetail}.`);
  }

  return withTimeout(
    ensureSidebarBridgeReady({ sourceTabId, onProgress, onTimingEvent }),
    BRIDGE_SETUP_TIMEOUT_MS,
    "bridge_setup_timeout"
  );
}

async function runPromptLifecycle(sourceTabId, { followUp = "" } = {}) {
  const session = getSession(sourceTabId);
  if (!session) {
    return;
  }

  const groundingResults = Array.isArray(session.results) ? session.results : [];
  if (groundingResults.length === 0) {
    failSessionRun(sourceTabId, {
      code: "STARTPAGE_RESULTS_NOT_FOUND",
      message: "No Startpage results were captured for grounding. Refresh the results page and try again.",
      recoverable: true
    });
    setSessionDebug(sourceTabId, {
      lastErrorCode: "STARTPAGE_RESULTS_NOT_FOUND",
      progressMessage: "Run blocked: no captured Startpage results are available."
    });
    await broadcastSessionUpdated(sourceTabId);
    return;
  }

  let current = markSessionOpeningBridge(sourceTabId);
  setSessionDebug(sourceTabId, {
    submitDiagnostics: null,
    selectorDiagnostics: {},
    progressMessage: "Starting run: preparing ChatGPT bridge."
  });
  recordSessionRunTimelineEvent(sourceTabId, RUN_TIMELINE_EVENT.RUN_STARTED);
  await broadcastSessionUpdated(sourceTabId);

  let bridge;
  try {
    bridge = await resolveBridgeForRun(sourceTabId);
  } catch (error) {
    const failure = getBridgeSetupFailure(error);
    failSessionRun(sourceTabId, {
      code: failure.code,
      message: failure.message,
      recoverable: true
    });
    recordSessionRunTimelineEvent(sourceTabId, RUN_TIMELINE_EVENT.RUN_FAILED, failure.code);
    setSessionDebug(sourceTabId, {
      lastErrorCode: failure.code,
      progressMessage: `Bridge setup failed: ${failure.message}`
    });
    await broadcastSessionUpdated(sourceTabId);
    return;
  }

  recordSessionRunTimelineEvent(
    sourceTabId,
    RUN_TIMELINE_EVENT.BRIDGE_READY,
    bridge.bridgeInstanceId || String(bridge.bridgeTabId || "")
  );

  if (bridge.loggedIn === false) {
    failSessionRun(sourceTabId, {
      code: "CHATGPT_NOT_LOGGED_IN",
      message: "ChatGPT needs sign-in in the sidebar. Open the ChatGPT sidebar, sign in, then click Regenerate.",
      recoverable: true
    });
    recordSessionRunTimelineEvent(sourceTabId, RUN_TIMELINE_EVENT.RUN_FAILED, "CHATGPT_NOT_LOGGED_IN");
    setSessionDebug(sourceTabId, {
      bridgeTabId: bridge.bridgeTabId,
      lastErrorCode: "CHATGPT_NOT_LOGGED_IN",
      progressMessage: "ChatGPT sign-in required in sidebar."
    });
    await broadcastSessionUpdated(sourceTabId);
    return;
  }

  if (bridge.hasComposer === false) {
    failSessionRun(sourceTabId, {
      code: "CHATGPT_COMPOSER_NOT_FOUND",
      message: "ChatGPT opened in the sidebar, but the prompt box is not ready. Open the ChatGPT sidebar, finish any onboarding, then click Regenerate.",
      recoverable: true
    });
    recordSessionRunTimelineEvent(sourceTabId, RUN_TIMELINE_EVENT.RUN_FAILED, "CHATGPT_COMPOSER_NOT_FOUND");
    setSessionDebug(sourceTabId, {
      bridgeTabId: bridge.bridgeTabId,
      lastErrorCode: "CHATGPT_COMPOSER_NOT_FOUND",
      progressMessage: "ChatGPT composer was not found."
    });
    await broadcastSessionUpdated(sourceTabId);
    return;
  }

  current = markSessionWaitingForChatGpt(sourceTabId, bridge.bridgeTabId);
  setSessionDebug(sourceTabId, {
    bridgeTabId: bridge.bridgeTabId,
    progressMessage: "ChatGPT bridge ready. Preparing grounded prompt."
  });
  await broadcastSessionUpdated(sourceTabId);

  const runId = createRunId(sourceTabId);
  const currentSession = getSession(sourceTabId) || session;
  const prompt = buildFollowUpPrompt(currentSession, followUp, getSettings().promptMode);
  recordSessionRunTimelineEvent(sourceTabId, RUN_TIMELINE_EVENT.PROMPT_PREPARED, `chars=${prompt.length}`);

  markSessionSubmittingPrompt(sourceTabId, runId, bridge.bridgeTabId);
  setSessionDebug(sourceTabId, {
    lastPrompt: sanitizeDebugText(prompt, 2000),
    bridgeTabId: bridge.bridgeTabId,
    lastErrorCode: "",
    submitDiagnostics: null,
    progressMessage: "Prompt prepared. Submitting to ChatGPT."
  });
  await broadcastSessionUpdated(sourceTabId);

  markSessionWaitingForResponse(sourceTabId, runId);
  setSessionProgress(sourceTabId, "Prompt submitted. Waiting for ChatGPT response stream.");
  await broadcastSessionUpdated(sourceTabId);

  let bridgeResponse;
  try {
    recordSessionRunTimelineEvent(sourceTabId, RUN_TIMELINE_EVENT.PROMPT_SEND_STARTED);
    recordSessionRunTimelineEvent(sourceTabId, RUN_TIMELINE_EVENT.BRIDGE_REQUEST_DISPATCHED, bridge.bridgeInstanceId || "");
    const sendResult = await sendBridgePromptWithReconnect(sourceTabId, bridge, {
      type: MSG.BRIDGE_RUN_PROMPT,
      runId,
      sourceTabId,
      mode: getSettings().promptMode,
      query: current?.query || currentSession.query,
      prompt,
      results: current?.results || currentSession.results
    }, (name, detail) => {
      recordSessionRunTimelineEvent(sourceTabId, name, detail);
    });

    if (!sendResult.ok) {
      throw sendResult.error;
    }

    bridgeResponse = sendResult.response;
    bridge = sendResult.bridge;
    mergeBridgeTimeline(sourceTabId, bridgeResponse?.debug);
    recordSessionRunTimelineEvent(sourceTabId, RUN_TIMELINE_EVENT.BRIDGE_RESPONSE_RECEIVED, bridge.bridgeInstanceId || "");
  } catch (error) {
    if (error instanceof Error && error.message === "bridge_runtime_not_reachable") {
      const failed = failSessionRun(sourceTabId, {
        runId,
        code: "CHATGPT_SIDEBAR_BRIDGE_NOT_READY",
        message: "ChatGPT sidebar bridge is not reachable yet. Keep ChatGPT loaded in sidebar, then Regenerate.",
        recoverable: true
      });
      if (failed.applied) {
        recordSessionRunTimelineEvent(sourceTabId, RUN_TIMELINE_EVENT.RUN_FAILED, "CHATGPT_SIDEBAR_BRIDGE_NOT_READY");
        setSessionDebug(sourceTabId, {
          lastErrorCode: "CHATGPT_SIDEBAR_BRIDGE_NOT_READY",
          progressMessage: "Sidebar bridge target is not reachable yet."
        });
        await broadcastSessionUpdated(sourceTabId);
      }
      return;
    }

    if (error instanceof Error && error.message === "bridge_runtime_disconnected") {
      const failed = failSessionRun(sourceTabId, {
        runId,
        code: "CHATGPT_SIDEBAR_BRIDGE_DISCONNECTED",
        message: "ChatGPT sidebar bridge disconnected during prompt send. Keep sidebar open and try Regenerate.",
        recoverable: true
      });
      if (failed.applied) {
        recordSessionRunTimelineEvent(sourceTabId, RUN_TIMELINE_EVENT.RUN_FAILED, "CHATGPT_SIDEBAR_BRIDGE_DISCONNECTED");
        setSessionDebug(sourceTabId, {
          lastErrorCode: "CHATGPT_SIDEBAR_BRIDGE_DISCONNECTED",
          progressMessage: "Sidebar bridge transport disconnected before receiving a prompt reply."
        });
        await broadcastSessionUpdated(sourceTabId);
      }
      return;
    }

    if (error instanceof Error && error.message === "bridge_runtime_request_timeout") {
      const failed = failSessionRun(sourceTabId, {
        runId,
        code: "CHATGPT_SIDEBAR_BRIDGE_TIMEOUT",
        message: "ChatGPT sidebar bridge did not reply in time. Try Regenerate.",
        recoverable: true
      });
      if (failed.applied) {
        recordSessionRunTimelineEvent(sourceTabId, RUN_TIMELINE_EVENT.RUN_FAILED, "CHATGPT_SIDEBAR_BRIDGE_TIMEOUT");
        setSessionDebug(sourceTabId, {
          lastErrorCode: "CHATGPT_SIDEBAR_BRIDGE_TIMEOUT",
          progressMessage: "Sidebar bridge request timed out before receiving a reply."
        });
        await broadcastSessionUpdated(sourceTabId);
      }
      return;
    }

    const failed = failSessionRun(sourceTabId, {
      runId,
      code: "CHATGPT_SEND_FAILED",
      message: "Failed to deliver the prompt to the ChatGPT sidebar bridge. Keep the sidebar open and try again.",
      recoverable: true
    });
    if (failed.applied) {
      recordSessionRunTimelineEvent(sourceTabId, RUN_TIMELINE_EVENT.RUN_FAILED, "CHATGPT_SEND_FAILED");
      setSessionDebug(sourceTabId, {
        lastErrorCode: "CHATGPT_SEND_FAILED",
        progressMessage: "Prompt delivery to ChatGPT bridge failed."
      });
      await broadcastSessionUpdated(sourceTabId);
      await broadcastMessage(
        createFailurePayload(
          sourceTabId,
          runId,
          "CHATGPT_SEND_FAILED",
          "Failed to deliver the prompt to the ChatGPT sidebar bridge. Keep the sidebar open and try again."
        )
      );
    }
    return;
  }

  if (!bridgeResponse?.ok) {
    mergeBridgeTimeline(sourceTabId, bridgeResponse?.debug);
    const code = bridgeResponse?.code || "CHATGPT_SEND_FAILED";
    const message = bridgeResponse?.message || "Bridge rejected prompt submission.";
    const failed = failSessionRun(sourceTabId, {
      runId,
      code,
      message,
      recoverable: bridgeResponse?.recoverable ?? true
    });

    if (failed.applied) {
      recordSessionRunTimelineEvent(sourceTabId, RUN_TIMELINE_EVENT.RUN_FAILED, sanitizeErrorCode(code));
      setSessionDebug(sourceTabId, {
        lastErrorCode: sanitizeErrorCode(code),
        selectorDiagnostics: bridgeResponse?.debug?.selectors || {},
        submitDiagnostics: getBridgeSubmitDiagnostics(bridgeResponse?.debug),
        progressMessage: `Bridge rejected prompt: ${message}`
      });
      await broadcastSessionUpdated(sourceTabId);
      await broadcastMessage(createFailurePayload(sourceTabId, runId, code, message, bridgeResponse?.recoverable ?? true));
    }
    return;
  }

  mergeBridgeTimeline(sourceTabId, bridgeResponse?.debug);
  const parsedValidation = validateBridgeResponsePayload(bridgeResponse);
  if (!parsedValidation.ok) {
    const failed = failSessionRun(sourceTabId, {
      runId,
      code: "CHATGPT_RESPONSE_PARSE_FAILED",
      message: parsedValidation.errors.join("; "),
      recoverable: true
    });

    if (failed.applied) {
      recordSessionRunTimelineEvent(sourceTabId, RUN_TIMELINE_EVENT.RUN_FAILED, "CHATGPT_RESPONSE_PARSE_FAILED");
      setSessionDebug(sourceTabId, {
        lastErrorCode: "CHATGPT_RESPONSE_PARSE_FAILED",
        submitDiagnostics: getBridgeSubmitDiagnostics(bridgeResponse?.debug),
        progressMessage: "Could not parse ChatGPT response payload."
      });
      await broadcastSessionUpdated(sourceTabId);
      await broadcastMessage(
        createFailurePayload(sourceTabId, runId, "CHATGPT_RESPONSE_PARSE_FAILED", parsedValidation.errors.join("; "))
      );
    }
    return;
  }

  markSessionParsingResponse(sourceTabId, runId);
  recordSessionRunTimelineEvent(sourceTabId, RUN_TIMELINE_EVENT.RESPONSE_PARSING_STARTED);
  setSessionDebug(sourceTabId, {
    selectorDiagnostics: bridgeResponse?.debug?.selectors || {},
    submitDiagnostics: getBridgeSubmitDiagnostics(bridgeResponse?.debug),
    bridgeTabId: bridge.bridgeTabId,
    progressMessage: "Response received. Parsing text and sources."
  });
  await broadcastSessionUpdated(sourceTabId);

  const completed = completeSessionRun(sourceTabId, {
    runId: bridgeResponse.runId,
    response: bridgeResponse.response,
    completedAt: bridgeResponse.completedAt
  });

  if (!completed.applied) {
    if (DEBUG.enabled || getSettings().debugMode) {
      console.debug("[StartGPT][background] ignored stale bridge response", {
        sourceTabId,
        runId: bridgeResponse.runId,
        reason: completed.reason
      });
    }
    return;
  }

  recordSessionRunTimelineEvent(sourceTabId, RUN_TIMELINE_EVENT.RUN_COMPLETED);
  setSessionDebug(sourceTabId, {
    lastErrorCode: "",
    selectorDiagnostics: bridgeResponse?.debug?.selectors || {},
    submitDiagnostics: getBridgeSubmitDiagnostics(bridgeResponse?.debug),
    bridgeTabId: bridge.bridgeTabId,
    progressMessage: "Overview complete."
  });
  await broadcastSessionUpdated(sourceTabId);
  await broadcastMessage(bridgeResponse);
}

function maybeStartRun(sourceTabId) {
  runPromptLifecycle(sourceTabId).catch((error) => {
    if (DEBUG.enabled || getSettings().debugMode) {
      console.error("[StartGPT][background] run lifecycle failed", error);
    }
  });
}

function maybeStartFollowUpRun(sourceTabId, followUp) {
  runPromptLifecycle(sourceTabId, { followUp }).catch((error) => {
    if (DEBUG.enabled || getSettings().debugMode) {
      console.error("[StartGPT][background] follow-up lifecycle failed", error);
    }
  });
}

async function handleMessage(message, sender) {
  const sourceTabId = resolveSourceTabId(message, sender);
  let result = await routeMessage(message, sender);

  if (
    result?.ok &&
    (
      message?.type === MSG.STARTPAGE_SCRIPT_STATUS ||
      message?.type === MSG.CHATGPT_BRIDGE_STATUS ||
      message?.type === MSG.STARTPAGE_CONTEXT_FOUND ||
      message?.type === MSG.STARTPAGE_CONTEXT_INVALID
    ) &&
    Number.isInteger(sourceTabId)
  ) {
    await broadcastSessionUpdated(sourceTabId);

    if (message?.type === MSG.STARTPAGE_CONTEXT_FOUND && getSettings().autoRunOnStartpage) {
      const sidebarOpen = await maybeOpenSidebarForStartpageContext(sourceTabId);
      if (sidebarOpen.attempted && !sidebarOpen.opened) {
        setSessionProgress(sourceTabId, "Startpage results detected, but browser blocked auto-opening sidebar.");
        await broadcastSessionUpdated(sourceTabId);
      }

      const currentSession = getSession(sourceTabId);
      if (!isRunInFlightStatus(currentSession?.status)) {
        markSessionQueued(sourceTabId);
        recordSessionRunTimelineEvent(sourceTabId, RUN_TIMELINE_EVENT.RUN_QUEUED, "auto_run_on_capture");
        setSessionProgress(sourceTabId, "Startpage context captured. Queueing run.");
        await broadcastSessionUpdated(sourceTabId);
        maybeStartRun(sourceTabId);
      }
    }

  }

  if (result?.ok && message?.type === MSG.CHATGPT_BRIDGE_STATUS && message?.phase === "module_loaded") {
    await maybeResumeRunAfterRuntimeBridgeReady();
  }

  if (result?.ok && message?.type === MSG.REQUEST_RUN_FOR_TAB) {
    const runTabId = Number.isInteger(result.sourceTabId) ? result.sourceTabId : sourceTabId;
    if (Number.isInteger(runTabId)) {
      resetQueuedRunTimeline(runTabId, "manual_regenerate");
      await broadcastSessionUpdated(runTabId);
      maybeStartRun(runTabId);
    }
  }

  if (message?.type === MSG.SIDEBAR_FOLLOW_UP) {
    if (!Number.isInteger(sourceTabId)) {
      result = { ok: false, error: "missing_source_tab_id" };
    } else {
      const followUp = String(message.followUp || "").trim();
      if (!followUp) {
        result = { ok: false, error: "follow_up_empty" };
      } else if (!getSession(sourceTabId)) {
        result = { ok: false, error: "session_not_found" };
      } else {
        markSessionQueued(sourceTabId);
        resetQueuedRunTimeline(sourceTabId, "follow_up");
        await broadcastSessionUpdated(sourceTabId);
        maybeStartFollowUpRun(sourceTabId, followUp);
        result = {
          ok: true,
          sourceTabId
        };
      }
    }
  }

  if (result?.ok && message?.type === MSG.REQUEST_OPEN_CHATGPT_SIDEBAR) {
    const openTabId = Number.isInteger(result.sourceTabId) ? result.sourceTabId : sourceTabId;
    await openChatGptSidebarForTab(openTabId, { forceReload: false });
    result = {
      ...result,
      bridge: getSidebarBridgeStatus(openTabId)
    };
    await broadcastSessionUpdated(openTabId);
  }

  if (result?.ok && message?.type === MSG.SIDEBAR_GET_STATE) {
    result = {
      ...result,
      bridge: getSidebarBridgeStatus(sourceTabId)
    };
  }

  if (DEBUG.enabled || getSettings().debugMode) {
    console.debug("[StartGPT][background] message", message?.type, result);
  }

  return result;
}

initializeRuntimeState().catch((error) => {
  console.error("[StartGPT][background] failed to initialize runtime state", error);
});

syncSidebarPanels().catch((error) => {
  console.error("[StartGPT][background] failed to sync sidebar panels", error);
});

browser.runtime.onMessage.addListener((message, sender) => handleMessage(message, sender));
browser.runtime.onConnect.addListener((port) => {
  if (!port || port.name !== "startgpt-chatgpt-bridge") {
    return;
  }

  let bridgeInstanceId = "";

  port.onMessage.addListener((message) => {
    if (typeof message?.bridgeInstanceId === "string" && message.bridgeInstanceId.trim()) {
      bridgeInstanceId = message.bridgeInstanceId.trim();
    }

    if (message?.type === "CHATGPT_BRIDGE_PORT_READY" && bridgeInstanceId) {
      registerRuntimeBridgePort(bridgeInstanceId, port, {
        bridgeTabId: Number.isInteger(port.sender?.tab?.id) ? port.sender.tab.id : null,
        frameId: Number.isInteger(port.sender?.frameId) ? port.sender.frameId : null
      });
      return;
    }

    if (message?.type === "CHATGPT_BRIDGE_PROGRESS") {
      const sourceTabId = Number.isInteger(message?.sourceTabId) ? message.sourceTabId : null;
      if (Number.isInteger(sourceTabId)) {
        const session = getSession(sourceTabId);
        if (shouldApplyBridgeProgress(session, message?.runId)) {
          setSessionProgress(sourceTabId, message.progressMessage || "Bridge processing update.");
          broadcastSessionUpdated(sourceTabId).catch(() => undefined);
        }
      }
      return;
    }

    if (typeof message?.replyTo === "string" && bridgeInstanceId) {
      resolveRuntimeBridgeReply(bridgeInstanceId, message);
      return;
    }

    if (message?.type === MSG.CHATGPT_BRIDGE_STATUS) {
      const normalized = {
        ...message,
        instanceId: bridgeInstanceId || message.instanceId || ""
      };
      handleMessage(normalized, port.sender).catch((error) => {
        if (DEBUG.enabled || getSettings().debugMode) {
          console.error("[StartGPT][background] failed to handle bridge port status", error);
        }
      });
    }
  });

  port.onDisconnect.addListener(() => {
    if (bridgeInstanceId) {
      unregisterRuntimeBridgePort(bridgeInstanceId, port);
    }
  });
});
browser.tabs.onRemoved.addListener((tabId) => {
  forgetClosedBridgeContext(tabId);
});
browser.tabs.onActivated.addListener(async ({ tabId }) => {
  if (!hasCompletedInitialSidebarSync) {
    return;
  }
  try {
    const tab = await browser.tabs.get(tabId);
    await syncSidebarVisibilityForTab(tabId, tab?.url);
  } catch {
    // Ignore activation race conditions.
  }
});
browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!hasCompletedInitialSidebarSync) {
    return;
  }
  if (typeof changeInfo.url !== "string" && changeInfo.status !== "complete") {
    return;
  }

  syncSidebarVisibilityForTab(tabId, tab?.url).catch(() => {
    // Ignore transient tab update failures.
  });
});
browser.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || !changes?.settings?.newValue) {
    return;
  }
  setSettings(changes.settings.newValue);
});
