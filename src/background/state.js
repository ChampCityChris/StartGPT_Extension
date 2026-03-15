import { DEFAULT_SETTINGS, STATUS, STORAGE_KEYS } from "./constants.js";
import {
  RUN_TIMELINE_EVENT,
  appendRunTimelineEvent,
  createRunTimeline,
  mergeRunTimelineEvents
} from "../content/shared/run-timeline.js";

const RUN_IN_FLIGHT_STATUSES = new Set([
  STATUS.QUEUED,
  STATUS.OPENING_BRIDGE,
  STATUS.WAITING_FOR_CHATGPT,
  STATUS.SUBMITTING_PROMPT,
  STATUS.WAITING_FOR_RESPONSE,
  STATUS.PARSING_RESPONSE
]);

function toTabKey(tabId) {
  return String(tabId);
}

function cloneState(value) {
  return JSON.parse(JSON.stringify(value));
}

function hasStartpageContextChanged(previous, nextContext) {
  if (!previous || typeof previous !== "object" || !nextContext || typeof nextContext !== "object") {
    return false;
  }

  const previousUrl = typeof previous.startpageUrl === "string" ? previous.startpageUrl : "";
  const nextUrl = typeof nextContext.pageUrl === "string" ? nextContext.pageUrl : "";
  const previousQuery = typeof previous.query === "string" ? previous.query : "";
  const nextQuery = typeof nextContext.query === "string" ? nextContext.query : "";

  return Boolean(previousUrl || previousQuery) && (previousUrl !== nextUrl || previousQuery !== nextQuery);
}

function createEmptyChatGptBridgeStatus() {
  return {
    phase: "",
    bridgeTabId: null,
    frameId: null,
    pageUrl: "",
    lastSeenAt: null,
    errorMessage: "",
    pingReady: false,
    lastPingAt: null,
    pingErrorMessage: "",
    loggedIn: null,
    hasComposer: null
  };
}

function createEmptyChatGptRuntimeBridgeStatus() {
  return {
    instanceId: "",
    bridgeTabId: null,
    frameId: null,
    phase: "",
    pageUrl: "",
    lastSeenAt: null,
    errorMessage: "",
    pingReady: false,
    lastPingAt: null,
    pingErrorMessage: "",
    loggedIn: null,
    hasComposer: null
  };
}

function createCapturedRunTimeline(context) {
  const capturedAt = Number.isInteger(context?.capturedAt) ? context.capturedAt : Date.now();
  const resultCount = Array.isArray(context?.results) ? context.results.length : 0;
  return appendRunTimelineEvent(
    createRunTimeline({
      startedAt: capturedAt
    }),
    {
      name: RUN_TIMELINE_EVENT.STARTPAGE_CONTEXT_CAPTURED,
      at: capturedAt,
      source: "startpage",
      detail: `results=${resultCount}`
    }
  );
}

function createInvalidRunTimeline(failure, previousTimeline = null) {
  const capturedAt = Number.isInteger(failure?.capturedAt) ? failure.capturedAt : Date.now();
  const resultCount = Array.isArray(failure?.results) ? failure.results.length : 0;
  return appendRunTimelineEvent(
    previousTimeline || createRunTimeline({
      startedAt: capturedAt
    }),
    {
      name: RUN_TIMELINE_EVENT.STARTPAGE_CONTEXT_INVALID,
      at: capturedAt,
      source: "startpage",
      detail: `${failure?.code || "STARTPAGE_CAPTURE_INVALID"} results=${resultCount}`
    }
  );
}

function syncBridgeStatusToLinkedSessions(bridgeTabId, bridgeStatus) {
  if (!Number.isInteger(bridgeTabId)) {
    return;
  }

  for (const [tabKey, session] of Object.entries(runtimeState.sessions)) {
    if (session?.bridgeTabId !== bridgeTabId) {
      continue;
    }

    runtimeState.sessions[tabKey] = {
      ...session,
      debug: {
        ...(session.debug || {}),
        bridgeTabId,
        chatgptBridge: {
          ...bridgeStatus
        }
      }
    };
  }
}

function getStoredChatGptBridgeStatus(tabId) {
  if (!Number.isInteger(tabId)) {
    return null;
  }

  return runtimeState.global.chatgptBridgeStatusByTabId[toTabKey(tabId)] || null;
}

export function createInitialState(settings = DEFAULT_SETTINGS) {
  return {
    settings: { ...DEFAULT_SETTINGS, ...settings },
    sessions: {},
    global: {
      activeSidebarTabId: null,
      lastRuntimeBridgeInstanceId: "",
      chatgptBridgeStatus: createEmptyChatGptBridgeStatus(),
      chatgptBridgeStatusByTabId: {},
      chatgptRuntimeBridgeStatus: createEmptyChatGptRuntimeBridgeStatus(),
      chatgptRuntimeBridgeStatusByInstanceId: {}
    }
  };
}

let runtimeState = createInitialState();

export function resetRuntimeState() {
  runtimeState = createInitialState();
}

export function getState() {
  return runtimeState;
}

export function getStateSnapshot() {
  return cloneState(runtimeState);
}

export function getSession(tabId) {
  const key = toTabKey(tabId);
  return runtimeState.sessions[key] || null;
}

export function setSession(tabId, session) {
  const key = toTabKey(tabId);
  runtimeState.sessions[key] = {
    ...runtimeState.sessions[key],
    ...session
  };
  return runtimeState.sessions[key];
}

export function upsertStartpageSession(tabId, context) {
  const key = toTabKey(tabId);
  const previous = runtimeState.sessions[key] || {};
  const previousDebug = previous.debug || {};
  const contextChanged = hasStartpageContextChanged(previous, context);
  const preserveRunInFlight = RUN_IN_FLIGHT_STATUSES.has(previous.status) && !contextChanged;
  const nextStatus = preserveRunInFlight
    ? previous.status
    : STATUS.CAPTURED;
  const nextRunTimeline = preserveRunInFlight
    ? (previousDebug.runTimeline || createCapturedRunTimeline(context))
    : createCapturedRunTimeline(context);

  runtimeState.sessions[key] = {
    query: context.query,
    startpageUrl: context.pageUrl,
    capturedAt: context.capturedAt,
    results: Array.isArray(context.results) ? context.results : [],
    status: nextStatus,
    runId: preserveRunInFlight ? previous.runId || "" : "",
    lastError: preserveRunInFlight ? previous.lastError || null : null,
    response: contextChanged ? null : (previous.response || null),
    bridgeTabId: previous.bridgeTabId || null,
    debug: previous.debug
      ? {
        ...previousDebug,
        lastPrompt: contextChanged ? "" : (previousDebug.lastPrompt || ""),
        lastErrorCode: preserveRunInFlight ? (previousDebug.lastErrorCode || "") : "",
        bridgeTabId: previousDebug.bridgeTabId || previous.bridgeTabId || null,
        selectorDiagnostics: contextChanged ? {} : (previousDebug.selectorDiagnostics || {}),
        submitDiagnostics: contextChanged ? null : (previousDebug.submitDiagnostics || null),
        runTimeline: nextRunTimeline,
        progressMessage: preserveRunInFlight
          ? (previousDebug.progressMessage || "Startpage context captured.")
          : "Startpage context captured."
      }
      : {
        lastPrompt: "",
        lastErrorCode: "",
        bridgeTabId: previous.bridgeTabId || null,
        selectorDiagnostics: {},
        submitDiagnostics: null,
        runTimeline: nextRunTimeline,
        progressMessage: "Startpage context captured."
      }
  };

  return runtimeState.sessions[key];
}

export function markStartpageScriptStatus(tabId, scriptStatus) {
  const key = toTabKey(tabId);
  const previous = runtimeState.sessions[key] || {};
  const previousDebug = previous.debug || {};
  const previousScriptStatus = previousDebug.startpageScript || {};
  const phase = typeof scriptStatus?.phase === "string" ? scriptStatus.phase : previousScriptStatus.phase || "unknown";
  const lastSeenAt = Number.isInteger(scriptStatus?.lastSeenAt)
    ? scriptStatus.lastSeenAt
    : (previousScriptStatus.lastSeenAt || Date.now());
  const pageUrl = typeof scriptStatus?.pageUrl === "string"
    ? scriptStatus.pageUrl
    : (previous.startpageUrl || previousScriptStatus.pageUrl || "");
  const errorMessage = typeof scriptStatus?.errorMessage === "string"
    ? scriptStatus.errorMessage
    : (previousScriptStatus.errorMessage || "");

  runtimeState.sessions[key] = {
    query: previous.query || "",
    startpageUrl: pageUrl,
    capturedAt: previous.capturedAt || null,
    results: Array.isArray(previous.results) ? previous.results : [],
    status: previous.status || STATUS.IDLE,
    runId: previous.runId || "",
    lastError: phase === "module_load_failed"
      ? {
        code: "STARTPAGE_SCRIPT_LOAD_FAILED",
        message: errorMessage || "Startpage content script failed to initialize.",
        recoverable: true
      }
      : (previous.lastError || null),
    response: previous.response || null,
    bridgeTabId: previous.bridgeTabId || null,
    debug: {
      ...previousDebug,
      startpageScript: {
        phase,
        pageUrl,
        lastSeenAt,
        errorMessage
      }
    }
  };

  return runtimeState.sessions[key];
}

export function markChatGptBridgeStatus(tabId, bridgeStatus) {
  const previousBridgeStatus = getStoredChatGptBridgeStatus(tabId) || createEmptyChatGptBridgeStatus();
  const phase = typeof bridgeStatus?.phase === "string" ? bridgeStatus.phase : previousBridgeStatus.phase || "unknown";
  const lastSeenAt = Number.isInteger(bridgeStatus?.lastSeenAt)
    ? bridgeStatus.lastSeenAt
    : (previousBridgeStatus.lastSeenAt || Date.now());
  const pageUrl = typeof bridgeStatus?.pageUrl === "string"
    ? bridgeStatus.pageUrl
    : (previousBridgeStatus.pageUrl || "");
  const errorMessage = typeof bridgeStatus?.errorMessage === "string"
    ? bridgeStatus.errorMessage
    : (previousBridgeStatus.errorMessage || "");
  const bridgeTabId = Number.isInteger(bridgeStatus?.bridgeTabId)
    ? bridgeStatus.bridgeTabId
    : (previousBridgeStatus.bridgeTabId || tabId);
  const frameId = Number.isInteger(bridgeStatus?.frameId)
    ? bridgeStatus.frameId
    : (previousBridgeStatus.frameId ?? null);

  const nextBridgeStatus = {
    ...previousBridgeStatus,
    phase,
    bridgeTabId,
    frameId,
    pageUrl,
    lastSeenAt,
    errorMessage,
    pingReady: phase === "module_load_failed" ? false : previousBridgeStatus.pingReady || false,
    pingErrorMessage: phase === "module_load_failed"
      ? (errorMessage || previousBridgeStatus.pingErrorMessage || "")
      : (previousBridgeStatus.pingErrorMessage || ""),
    loggedIn: previousBridgeStatus.loggedIn ?? null,
    hasComposer: previousBridgeStatus.hasComposer ?? null
  };

  runtimeState.global.chatgptBridgeStatus = nextBridgeStatus;
  runtimeState.global.chatgptBridgeStatusByTabId[toTabKey(bridgeTabId)] = nextBridgeStatus;
  syncBridgeStatusToLinkedSessions(bridgeTabId, nextBridgeStatus);

  return nextBridgeStatus;
}

export function markChatGptBridgePingReady(tabId, pingStatus = {}) {
  const bridgeTabId = Number.isInteger(pingStatus?.bridgeTabId) ? pingStatus.bridgeTabId : tabId;
  const previousBridgeStatus = getStoredChatGptBridgeStatus(bridgeTabId) || createEmptyChatGptBridgeStatus();
  const nextBridgeStatus = {
    ...previousBridgeStatus,
    bridgeTabId,
    frameId: Number.isInteger(pingStatus?.frameId) ? pingStatus.frameId : (previousBridgeStatus.frameId ?? null),
    pingReady: true,
    lastPingAt: Number.isInteger(pingStatus?.lastPingAt) ? pingStatus.lastPingAt : Date.now(),
    pingErrorMessage: "",
    loggedIn: typeof pingStatus?.loggedIn === "boolean" ? pingStatus.loggedIn : (previousBridgeStatus.loggedIn ?? null),
    hasComposer: typeof pingStatus?.hasComposer === "boolean" ? pingStatus.hasComposer : (previousBridgeStatus.hasComposer ?? null)
  };

  runtimeState.global.chatgptBridgeStatus = nextBridgeStatus;
  runtimeState.global.chatgptBridgeStatusByTabId[toTabKey(bridgeTabId)] = nextBridgeStatus;
  syncBridgeStatusToLinkedSessions(bridgeTabId, nextBridgeStatus);
  return nextBridgeStatus;
}

export function markChatGptRuntimeBridgeStatus(instanceId, bridgeStatus) {
  const key = String(instanceId || "").trim();
  if (!key) {
    return createEmptyChatGptRuntimeBridgeStatus();
  }

  const previousBridgeStatus = runtimeState.global.chatgptRuntimeBridgeStatusByInstanceId[key] || createEmptyChatGptRuntimeBridgeStatus();
  const phase = typeof bridgeStatus?.phase === "string" ? bridgeStatus.phase : previousBridgeStatus.phase || "unknown";
  const lastSeenAt = Number.isInteger(bridgeStatus?.lastSeenAt)
    ? bridgeStatus.lastSeenAt
    : (previousBridgeStatus.lastSeenAt || Date.now());
  const pageUrl = typeof bridgeStatus?.pageUrl === "string"
    ? bridgeStatus.pageUrl
    : (previousBridgeStatus.pageUrl || "");
  const errorMessage = typeof bridgeStatus?.errorMessage === "string"
    ? bridgeStatus.errorMessage
    : (previousBridgeStatus.errorMessage || "");
  const bridgeTabId = Number.isInteger(bridgeStatus?.bridgeTabId)
    ? bridgeStatus.bridgeTabId
    : (previousBridgeStatus.bridgeTabId ?? null);
  const frameId = Number.isInteger(bridgeStatus?.frameId)
    ? bridgeStatus.frameId
    : (previousBridgeStatus.frameId ?? null);

  const nextBridgeStatus = {
    ...previousBridgeStatus,
    instanceId: key,
    bridgeTabId,
    frameId,
    phase,
    pageUrl,
    lastSeenAt,
    errorMessage,
    pingReady: phase === "module_load_failed" ? false : previousBridgeStatus.pingReady || false,
    pingErrorMessage: phase === "module_load_failed"
      ? (errorMessage || previousBridgeStatus.pingErrorMessage || "")
      : (previousBridgeStatus.pingErrorMessage || ""),
    loggedIn: previousBridgeStatus.loggedIn ?? null,
    hasComposer: previousBridgeStatus.hasComposer ?? null
  };

  runtimeState.global.lastRuntimeBridgeInstanceId = key;
  runtimeState.global.chatgptRuntimeBridgeStatus = nextBridgeStatus;
  runtimeState.global.chatgptRuntimeBridgeStatusByInstanceId[key] = nextBridgeStatus;
  return nextBridgeStatus;
}

export function markChatGptRuntimeBridgePingReady(instanceId, pingStatus = {}) {
  const key = String(instanceId || "").trim();
  if (!key) {
    return createEmptyChatGptRuntimeBridgeStatus();
  }

  const previousBridgeStatus = runtimeState.global.chatgptRuntimeBridgeStatusByInstanceId[key] || createEmptyChatGptRuntimeBridgeStatus();
  const nextBridgeStatus = {
    ...previousBridgeStatus,
    instanceId: key,
    bridgeTabId: Number.isInteger(pingStatus?.bridgeTabId)
      ? pingStatus.bridgeTabId
      : (previousBridgeStatus.bridgeTabId ?? null),
    frameId: Number.isInteger(pingStatus?.frameId)
      ? pingStatus.frameId
      : (previousBridgeStatus.frameId ?? null),
    pingReady: true,
    lastPingAt: Number.isInteger(pingStatus?.lastPingAt) ? pingStatus.lastPingAt : Date.now(),
    pingErrorMessage: "",
    loggedIn: typeof pingStatus?.loggedIn === "boolean" ? pingStatus.loggedIn : (previousBridgeStatus.loggedIn ?? null),
    hasComposer: typeof pingStatus?.hasComposer === "boolean" ? pingStatus.hasComposer : (previousBridgeStatus.hasComposer ?? null)
  };

  runtimeState.global.lastRuntimeBridgeInstanceId = key;
  runtimeState.global.chatgptRuntimeBridgeStatus = nextBridgeStatus;
  runtimeState.global.chatgptRuntimeBridgeStatusByInstanceId[key] = nextBridgeStatus;
  return nextBridgeStatus;
}

export function getChatGptRuntimeBridgeStatus(instanceId = null) {
  if (typeof instanceId === "string" && instanceId.trim()) {
    const stored = runtimeState.global.chatgptRuntimeBridgeStatusByInstanceId[instanceId.trim()];
    return stored ? { ...stored } : null;
  }

  const fallbackId = runtimeState.global.lastRuntimeBridgeInstanceId;
  if (fallbackId) {
    const stored = runtimeState.global.chatgptRuntimeBridgeStatusByInstanceId[fallbackId];
    return stored ? { ...stored } : null;
  }

  return runtimeState.global.chatgptRuntimeBridgeStatus?.instanceId
    ? { ...runtimeState.global.chatgptRuntimeBridgeStatus }
    : null;
}

export function getChatGptBridgeStatus(tabId) {
  const stored = getStoredChatGptBridgeStatus(tabId);
  return stored ? { ...stored } : null;
}

export function setStartpageCaptureFailure(tabId, failure) {
  const key = toTabKey(tabId);
  const previous = runtimeState.sessions[key] || {};
  const previousDebug = previous.debug || {};
  const contextChanged = hasStartpageContextChanged(previous, failure);
  const nextRunTimeline = createInvalidRunTimeline(
    failure,
    contextChanged ? null : (previousDebug.runTimeline || null)
  );

  runtimeState.sessions[key] = {
    query: typeof failure?.query === "string" ? failure.query : (previous.query || ""),
    startpageUrl: typeof failure?.pageUrl === "string" ? failure.pageUrl : (previous.startpageUrl || ""),
    capturedAt: Number.isInteger(failure?.capturedAt) ? failure.capturedAt : (previous.capturedAt || Date.now()),
    results: Array.isArray(failure?.results) ? failure.results : (previous.results || []),
    status: STATUS.FAILED,
    runId: contextChanged ? "" : (previous.runId || ""),
    lastError: {
      code: failure?.code || "STARTPAGE_CAPTURE_INVALID",
      message: failure?.message || "Could not capture Startpage results.",
      recoverable: failure?.recoverable ?? true
    },
    response: contextChanged ? null : (previous.response || null),
    bridgeTabId: previous.bridgeTabId || null,
    debug: {
      ...previousDebug,
      lastPrompt: contextChanged ? "" : (previousDebug.lastPrompt || ""),
      lastErrorCode: failure?.code || "STARTPAGE_CAPTURE_INVALID",
      bridgeTabId: previousDebug.bridgeTabId || previous.bridgeTabId || null,
      selectorDiagnostics: failure?.selectorDiagnostics || previousDebug.selectorDiagnostics || {},
      submitDiagnostics: contextChanged ? null : (previousDebug.submitDiagnostics || null),
      runTimeline: nextRunTimeline,
      progressMessage: failure?.message || previousDebug.progressMessage || "Startpage capture failed."
    }
  };

  return runtimeState.sessions[key];
}

function getSessionForUpdate(tabId) {
  const key = toTabKey(tabId);
  const session = runtimeState.sessions[key];
  if (!session) {
    return null;
  }
  return { key, session };
}

export function setSessionStatus(tabId, status) {
  const key = toTabKey(tabId);
  if (!runtimeState.sessions[key]) {
    return null;
  }

  runtimeState.sessions[key].status = status;
  return runtimeState.sessions[key];
}

export function markSessionQueued(tabId) {
  return setSessionStatus(tabId, STATUS.QUEUED);
}

export function markSessionOpeningBridge(tabId) {
  return setSessionStatus(tabId, STATUS.OPENING_BRIDGE);
}

export function markSessionWaitingForChatGpt(tabId, bridgeTabId) {
  return setSession(tabId, {
    status: STATUS.WAITING_FOR_CHATGPT,
    bridgeTabId
  });
}

export function markSessionSubmittingPrompt(tabId, runId, bridgeTabId) {
  return setSession(tabId, {
    runId,
    bridgeTabId,
    status: STATUS.SUBMITTING_PROMPT,
    lastError: null
  });
}

export function setSessionDebug(tabId, nextDebug) {
  const current = getSession(tabId);
  if (!current) {
    return null;
  }

  return setSession(tabId, {
    debug: {
      ...(current.debug || {}),
      ...nextDebug
    }
  });
}

export function resetSessionRunTimeline(tabId, { runId = "", startedAt = Date.now(), events = [] } = {}) {
  const current = getSession(tabId);
  if (!current) {
    return null;
  }

  return setSessionDebug(tabId, {
    runTimeline: createRunTimeline({
      runId,
      startedAt,
      events
    })
  });
}

export function appendSessionRunTimelineEvent(tabId, event) {
  const current = getSession(tabId);
  if (!current) {
    return null;
  }

  const existingTimeline = current.debug?.runTimeline || createRunTimeline({
    runId: current.runId || "",
    startedAt: current.capturedAt || Date.now()
  });
  const nextTimeline = appendRunTimelineEvent({
    ...existingTimeline,
    runId: existingTimeline.runId || current.runId || ""
  }, event);

  return setSessionDebug(tabId, {
    runTimeline: nextTimeline
  });
}

export function mergeSessionRunTimeline(tabId, timeline) {
  const current = getSession(tabId);
  if (!current || !timeline) {
    return null;
  }

  const existingTimeline = current.debug?.runTimeline || createRunTimeline({
    runId: current.runId || "",
    startedAt: current.capturedAt || Date.now()
  });
  const nextTimeline = mergeRunTimelineEvents({
    ...existingTimeline,
    runId: existingTimeline.runId || current.runId || ""
  }, timeline);

  return setSessionDebug(tabId, {
    runTimeline: nextTimeline
  });
}

export function markSessionWaitingForResponse(tabId, runId) {
  const current = getSession(tabId);
  if (!current || current.runId !== runId) {
    return null;
  }

  return setSession(tabId, {
    status: STATUS.WAITING_FOR_RESPONSE
  });
}

export function markSessionParsingResponse(tabId, runId) {
  const current = getSession(tabId);
  if (!current || current.runId !== runId) {
    return null;
  }

  return setSession(tabId, {
    status: STATUS.PARSING_RESPONSE
  });
}

export function completeSessionRun(tabId, { runId, response, completedAt }) {
  const current = getSession(tabId);
  if (!current) {
    return { applied: false, reason: "session_missing" };
  }

  if (current.runId !== runId) {
    return { applied: false, reason: "stale_run_id" };
  }

  const updated = setSession(tabId, {
    status: STATUS.COMPLETED,
    response,
    completedAt,
    lastError: null
  });
  return { applied: true, session: updated };
}

export function failSessionRun(tabId, { runId = null, code, message, recoverable = true }) {
  const target = getSessionForUpdate(tabId);
  if (!target) {
    return { applied: false, reason: "session_missing" };
  }

  if (runId && target.session.runId !== runId) {
    return { applied: false, reason: "stale_run_id" };
  }

  const updated = setSession(tabId, {
    status: STATUS.FAILED,
    lastError: {
      code,
      message,
      recoverable
    },
    debug: {
      ...(target.session.debug || {}),
      lastErrorCode: code,
      progressMessage: message || "Run failed."
    }
  });
  return { applied: true, session: updated };
}

export function setActiveSidebarTabId(tabId) {
  runtimeState.global.activeSidebarTabId = tabId ?? null;
}

export function getSettings() {
  return runtimeState.settings;
}

export function setSettings(nextSettings) {
  runtimeState.settings = {
    ...runtimeState.settings,
    ...nextSettings
  };
  return runtimeState.settings;
}

export async function loadSettingsFromStorage(storageArea = browser.storage.local) {
  const stored = await storageArea.get(STORAGE_KEYS.SETTINGS);
  const persistedSettings = stored?.[STORAGE_KEYS.SETTINGS];
  if (!persistedSettings || typeof persistedSettings !== "object") {
    return { ...DEFAULT_SETTINGS };
  }

  return {
    ...DEFAULT_SETTINGS,
    ...persistedSettings
  };
}

export async function persistSettings(storageArea = browser.storage.local) {
  await storageArea.set({
    [STORAGE_KEYS.SETTINGS]: runtimeState.settings
  });
}

export async function updateSettings(nextSettings, storageArea = browser.storage.local) {
  setSettings(nextSettings);
  await persistSettings(storageArea);
  return getSettings();
}

export async function initializeRuntimeState(storageArea = browser.storage.local) {
  const settings = await loadSettingsFromStorage(storageArea);
  runtimeState = createInitialState(settings);
  return getStateSnapshot();
}
