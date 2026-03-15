import { MSG } from "../content/shared/message-types.js";
import { validateStartpageContextPayload } from "../content/shared/schema.js";
import { STATUS } from "./constants.js";
import {
  markChatGptBridgeStatus,
  markChatGptRuntimeBridgeStatus,
  getState,
  getSession,
  getStateSnapshot,
  setActiveSidebarTabId,
  markStartpageScriptStatus,
  setStartpageCaptureFailure,
  setSessionStatus,
  upsertStartpageSession
} from "./state.js";

function resolveSourceTabId(message, sender) {
  if (Number.isInteger(message?.sourceTabId)) {
    return message.sourceTabId;
  }

  if (Number.isInteger(message?.tabId)) {
    return message.tabId;
  }

  const senderTabId = sender?.tab?.id;
  if (Number.isInteger(senderTabId)) {
    return senderTabId;
  }

  return null;
}

function toSerializableSession(tabId, session) {
  return {
    tabId,
    ...session
  };
}

async function handleStartpageContextFound(message, sender) {
  const tabId = resolveSourceTabId(message, sender);
  if (!Number.isInteger(tabId)) {
    return { ok: false, error: "missing_source_tab_id" };
  }

  const validation = validateStartpageContextPayload(message);
  if (!validation.ok) {
    return { ok: false, error: "invalid_startpage_payload", details: validation.errors };
  }

  const session = upsertStartpageSession(tabId, message);
  setActiveSidebarTabId(tabId);
  return {
    ok: true,
    session: toSerializableSession(tabId, session)
  };
}

async function handleSidebarGetState(message, sender) {
  const requestedTabId = resolveSourceTabId(message, sender);
  const requestedSession = Number.isInteger(requestedTabId) ? getSession(requestedTabId) : null;
  const rememberedTabId = getState().global.activeSidebarTabId;
  const rememberedSession = Number.isInteger(rememberedTabId) ? getSession(rememberedTabId) : null;
  const resolvedTabId = Number.isInteger(requestedTabId) && requestedSession
    ? requestedTabId
    : (rememberedSession ? rememberedTabId : requestedTabId);

  if (Number.isInteger(resolvedTabId)) {
    setActiveSidebarTabId(resolvedTabId);
  } else if (Number.isInteger(requestedTabId)) {
    setActiveSidebarTabId(requestedTabId);
  }

  const session = Number.isInteger(resolvedTabId) ? getSession(resolvedTabId) : null;
  return {
    ok: true,
    state: getStateSnapshot(),
    session: session ? toSerializableSession(resolvedTabId, session) : null
  };
}

async function handleStartpageContextInvalid(message, sender) {
  const tabId = resolveSourceTabId(message, sender);
  if (!Number.isInteger(tabId)) {
    return { ok: false, error: "missing_source_tab_id" };
  }

  const session = setStartpageCaptureFailure(tabId, {
    query: message?.query || "",
    pageUrl: message?.pageUrl || "",
    capturedAt: message?.capturedAt,
    results: Array.isArray(message?.results) ? message.results : [],
    code: message?.code || "STARTPAGE_CAPTURE_INVALID",
    message: message?.message || "Could not capture Startpage results.",
    recoverable: message?.recoverable ?? true,
    selectorDiagnostics: message?.debug?.selectors || {}
  });

  setActiveSidebarTabId(tabId);
  return {
    ok: true,
    session: toSerializableSession(tabId, session)
  };
}

async function handleStartpageScriptStatus(message, sender) {
  const tabId = resolveSourceTabId(message, sender);
  if (!Number.isInteger(tabId)) {
    return { ok: false, error: "missing_source_tab_id" };
  }

  const session = markStartpageScriptStatus(tabId, {
    phase: message?.phase,
    pageUrl: message?.pageUrl,
    lastSeenAt: message?.lastSeenAt,
    errorMessage: message?.errorMessage
  });

  setActiveSidebarTabId(tabId);
  return {
    ok: true,
    session: toSerializableSession(tabId, session)
  };
}

async function handleChatGptBridgeStatus(message, sender) {
  const tabId = resolveSourceTabId(message, sender);
  const instanceId = typeof message?.instanceId === "string" ? message.instanceId.trim() : "";
  if (!Number.isInteger(tabId) && !instanceId) {
    return { ok: false, error: "missing_source_tab_id" };
  }

  let bridgeStatus = null;
  if (Number.isInteger(tabId)) {
    bridgeStatus = markChatGptBridgeStatus(tabId, {
      phase: message?.phase,
      pageUrl: message?.pageUrl,
      lastSeenAt: message?.lastSeenAt,
      errorMessage: message?.errorMessage,
      bridgeTabId: tabId,
      frameId: Number.isInteger(sender?.frameId) ? sender.frameId : null
    });
  }

  let runtimeBridgeStatus = null;
  if (instanceId) {
    runtimeBridgeStatus = markChatGptRuntimeBridgeStatus(instanceId, {
      phase: message?.phase,
      pageUrl: message?.pageUrl,
      lastSeenAt: message?.lastSeenAt,
      errorMessage: message?.errorMessage,
      bridgeTabId: Number.isInteger(sender?.tab?.id) ? sender.tab.id : null,
      frameId: Number.isInteger(sender?.frameId) ? sender.frameId : null
    });
  }

  return {
    ok: true,
    bridgeTabId: Number.isInteger(tabId) ? tabId : null,
    bridgeStatus,
    bridgeInstanceId: instanceId || null,
    runtimeBridgeStatus
  };
}

async function handleManualRunRequest(message, sender) {
  const sourceTabId = resolveSourceTabId(message, sender);
  if (!Number.isInteger(sourceTabId)) {
    return { ok: false, error: "missing_source_tab_id" };
  }

  const session = getSession(sourceTabId);
  if (!session) {
    return { ok: false, error: "session_not_found" };
  }

  const updated = setSessionStatus(sourceTabId, STATUS.QUEUED);
  return {
    ok: true,
    sourceTabId,
    session: toSerializableSession(sourceTabId, updated)
  };
}

async function handleOpenSidebarRequest(message, sender) {
  const sourceTabId = resolveSourceTabId(message, sender);
  return {
    ok: true,
    sourceTabId
  };
}

export async function routeMessage(message, sender) {
  if (!message || !message.type) {
    return { ok: false, error: "missing_type" };
  }

  switch (message.type) {
    case MSG.STARTPAGE_SCRIPT_STATUS:
      return handleStartpageScriptStatus(message, sender);
    case MSG.CHATGPT_BRIDGE_STATUS:
      return handleChatGptBridgeStatus(message, sender);
    case MSG.STARTPAGE_CONTEXT_FOUND:
      return handleStartpageContextFound(message, sender);
    case MSG.STARTPAGE_CONTEXT_INVALID:
      return handleStartpageContextInvalid(message, sender);
    case MSG.SIDEBAR_GET_STATE:
      return handleSidebarGetState(message, sender);
    case MSG.REQUEST_RUN_FOR_TAB:
      return handleManualRunRequest(message, sender);
    case MSG.REQUEST_OPEN_CHATGPT_SIDEBAR:
      return handleOpenSidebarRequest(message, sender);
    default:
      return { ok: false, error: "unknown_type" };
  }
}
