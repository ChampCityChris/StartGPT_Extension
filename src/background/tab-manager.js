import {
  getChatGptRuntimeBridgeStatus,
  getState,
  markChatGptRuntimeBridgePingReady,
  setSession
} from "./state.js";
import { MSG } from "../content/shared/message-types.js";
import { RUN_TIMELINE_EVENT } from "../content/shared/run-timeline.js";

const BRIDGE_PING_TIMEOUT_MS = 12000;
const BRIDGE_PING_INTERVAL_MS = 250;
const BRIDGE_PORT_REQUEST_TIMEOUT_MS = 45000;

const runtimeBridgePortsByInstanceId = new Map();

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeRequestId() {
  return `bridge_req_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function rememberRuntimeBridge(instanceId, sourceTabId = null) {
  if (!instanceId) {
    return;
  }

  const state = getState();
  state.global.lastRuntimeBridgeInstanceId = instanceId;

  if (Number.isInteger(sourceTabId) && state.sessions[String(sourceTabId)]) {
    setSession(sourceTabId, {
      bridgeRuntimeInstanceId: instanceId
    });
  }
}

function getMostRecentLiveRuntimeBridgeInstanceId() {
  const entries = [...runtimeBridgePortsByInstanceId.entries()];
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const [instanceId, entry] = entries[index];
    if (instanceId && entry?.port) {
      return instanceId;
    }
  }
  return "";
}

export function registerRuntimeBridgePort(instanceId, port, context = {}) {
  const key = String(instanceId || "").trim();
  if (!key || !port) {
    return false;
  }

  const existing = runtimeBridgePortsByInstanceId.get(key);
  if (existing?.port === port) {
    existing.bridgeTabId = Number.isInteger(context?.bridgeTabId) ? context.bridgeTabId : (existing.bridgeTabId ?? null);
    existing.frameId = Number.isInteger(context?.frameId) ? context.frameId : (existing.frameId ?? null);
    return true;
  }

  if (existing?.pendingRequests) {
    for (const pending of existing.pendingRequests.values()) {
      globalThis.clearTimeout(pending.timeoutId);
      pending.reject(new Error("bridge_runtime_disconnected"));
    }
  }

  runtimeBridgePortsByInstanceId.set(key, {
    port,
    pendingRequests: new Map(),
    bridgeTabId: Number.isInteger(context?.bridgeTabId) ? context.bridgeTabId : null,
    frameId: Number.isInteger(context?.frameId) ? context.frameId : null
  });

  return true;
}

export function unregisterRuntimeBridgePort(instanceId, expectedPort = null) {
  const key = String(instanceId || "").trim();
  if (!key) {
    return;
  }

  const entry = runtimeBridgePortsByInstanceId.get(key);
  if (!entry) {
    return;
  }
  if (expectedPort && entry.port !== expectedPort) {
    return;
  }

  for (const pending of entry.pendingRequests.values()) {
    globalThis.clearTimeout(pending.timeoutId);
    pending.reject(new Error("bridge_runtime_disconnected"));
  }
  entry.pendingRequests.clear();
  runtimeBridgePortsByInstanceId.delete(key);
}

export function resolveRuntimeBridgeReply(instanceId, message) {
  const key = String(instanceId || "").trim();
  if (!key) {
    return false;
  }

  const entry = runtimeBridgePortsByInstanceId.get(key);
  if (!entry) {
    return false;
  }

  const replyTo = typeof message?.replyTo === "string" ? message.replyTo : "";
  if (!replyTo) {
    return false;
  }

  const pending = entry.pendingRequests.get(replyTo);
  if (!pending) {
    return false;
  }

  globalThis.clearTimeout(pending.timeoutId);
  entry.pendingRequests.delete(replyTo);
  pending.resolve(message.payload);
  return true;
}

export async function sendRuntimeBridgeRequest(instanceId, payload, timeoutMs = BRIDGE_PORT_REQUEST_TIMEOUT_MS) {
  const key = String(instanceId || "").trim();
  if (!key) {
    throw new Error("bridge_runtime_not_reachable");
  }

  const entry = runtimeBridgePortsByInstanceId.get(key);
  if (!entry?.port) {
    throw new Error("bridge_runtime_not_reachable");
  }

  const requestId = makeRequestId();
  const deferred = createDeferred();
  const timeoutId = globalThis.setTimeout(() => {
    entry.pendingRequests.delete(requestId);
    deferred.reject(new Error("bridge_runtime_request_timeout"));
  }, timeoutMs);

  entry.pendingRequests.set(requestId, {
    ...deferred,
    timeoutId
  });

  try {
    entry.port.postMessage({
      ...payload,
      bridgeInstanceId: key,
      requestId
    });
  } catch {
    globalThis.clearTimeout(timeoutId);
    entry.pendingRequests.delete(requestId);
    throw new Error("bridge_runtime_disconnected");
  }

  return deferred.promise;
}

export async function pingRuntimeBridge(instanceId) {
  if (!runtimeBridgePortsByInstanceId.has(instanceId)) {
    return {
      ok: false,
      code: "bridge_runtime_not_reachable",
      message: "Sidebar bridge instance is registered without an active bridge port."
    };
  }

  try {
    const response = await sendRuntimeBridgeRequest(instanceId, {
      type: MSG.BRIDGE_PING,
      bridgeInstanceId: instanceId
    }, BRIDGE_PING_TIMEOUT_MS);

    if (response?.ok) {
      return {
        ok: true,
        response
      };
    }

    if (response?.code === "BRIDGE_MODULE_LOAD_FAILED") {
      return {
        ok: false,
        code: "chatgpt_bridge_module_load_failed",
        message: response?.message || "ChatGPT bridge module failed to load."
      };
    }

    return {
      ok: false,
      code: response?.code || "bridge_script_not_ready",
      message: response?.message || "ChatGPT bridge is not ready yet."
    };
  } catch (error) {
    return {
      ok: false,
      code: "bridge_script_not_ready",
      message: error instanceof Error ? error.message : String(error || "Unknown bridge ping error")
    };
  }
}

async function waitForRuntimeBridgeReady(instanceId, timeoutMs = BRIDGE_PING_TIMEOUT_MS, onProgress = null) {
  const startAt = Date.now();
  let lastProgressMessage = "";
  let lastObserved = {
    instanceId,
    phase: "",
    pingCode: "",
    pingMessage: ""
  };

  const emitProgress = (message) => {
    if (typeof onProgress !== "function") {
      return;
    }
    if (message === lastProgressMessage) {
      return;
    }
    lastProgressMessage = message;
    onProgress(message);
  };

  while (Date.now() - startAt < timeoutMs) {
    const elapsedMs = Date.now() - startAt;
    const elapsedSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
    const runtimeStatus = getChatGptRuntimeBridgeStatus(instanceId);
    lastObserved = {
      ...lastObserved,
      phase: runtimeStatus?.phase || ""
    };

    if (runtimeStatus?.phase === "module_load_failed") {
      throw new Error("chatgpt_bridge_module_load_failed");
    }

    const ping = await pingRuntimeBridge(instanceId);
    if (ping.ok) {
      emitProgress(`Sidebar bridge ping confirmed for instance ${instanceId}.`);
      markChatGptRuntimeBridgePingReady(instanceId, {
        lastPingAt: Date.now(),
        bridgeTabId: runtimeStatus?.bridgeTabId ?? null,
        frameId: runtimeStatus?.frameId ?? null,
        loggedIn: ping.response?.loggedIn ?? null,
        hasComposer: ping.response?.hasComposer ?? null
      });
      return ping.response;
    }

    lastObserved = {
      ...lastObserved,
      pingCode: ping.code || "",
      pingMessage: ping.message || ""
    };

    if (ping.code === "chatgpt_bridge_module_load_failed") {
      throw new Error("chatgpt_bridge_module_load_failed");
    }

    emitProgress(
      `Waiting for sidebar bridge ping (${elapsedSeconds}s): code=${ping.code || "(none)"} message=${ping.message || "(none)"}`
    );

    await new Promise((resolve) => globalThis.setTimeout(resolve, BRIDGE_PING_INTERVAL_MS));
  }

  const observedParts = [
    `runtimeInstance=${lastObserved.instanceId || "(none)"}`,
    `phase=${lastObserved.phase || "(none)"}`,
    `pingCode=${lastObserved.pingCode || "(none)"}`,
    `pingMessage=${lastObserved.pingMessage || "(none)"}`
  ];
  throw new Error(`bridge_script_not_ready:${observedParts.join("|")}`);
}

function emitTimingEvent(onTimingEvent, name, detail = "") {
  if (typeof onTimingEvent !== "function") {
    return;
  }

  onTimingEvent({
    name,
    detail
  });
}

function buildReadyRuntimeBridgeState(instanceId, bridgeStatus) {
  return {
    channel: "runtime",
    ready: true,
    bridgeTabId: bridgeStatus?.bridgeTabId ?? null,
    bridgeInstanceId: instanceId,
    loggedIn: bridgeStatus?.loggedIn ?? null,
    hasComposer: bridgeStatus?.hasComposer ?? null,
    needsAttention: bridgeStatus?.loggedIn === false || bridgeStatus?.hasComposer === false
  };
}

async function waitForRuntimeBridgeRegistration(timeoutMs = BRIDGE_PING_TIMEOUT_MS, onProgress = null, onTimingEvent = null) {
  const startAt = Date.now();
  let lastSecond = -1;
  emitTimingEvent(onTimingEvent, RUN_TIMELINE_EVENT.BRIDGE_REGISTRATION_WAIT_STARTED);
  while (Date.now() - startAt < timeoutMs) {
    const liveInstanceId = getMostRecentLiveRuntimeBridgeInstanceId();
    if (liveInstanceId) {
      const runtimeBridge = getChatGptRuntimeBridgeStatus(liveInstanceId) || {
        instanceId: liveInstanceId,
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
      emitTimingEvent(onTimingEvent, RUN_TIMELINE_EVENT.BRIDGE_REGISTERED, liveInstanceId);
      return runtimeBridge;
    }

    if (typeof onProgress === "function") {
      const elapsedSeconds = Math.max(0, Math.floor((Date.now() - startAt) / 1000));
      if (elapsedSeconds !== lastSecond) {
        lastSecond = elapsedSeconds;
        onProgress(`Waiting for ChatGPT sidebar bridge registration (${elapsedSeconds}s).`);
      }
    }

    await new Promise((resolve) => globalThis.setTimeout(resolve, BRIDGE_PING_INTERVAL_MS));
  }

  return null;
}

export async function ensureSidebarBridgeReady({ sourceTabId = null, onProgress = null, onTimingEvent = null } = {}) {
  const runtimeBridge = await waitForRuntimeBridgeRegistration(BRIDGE_PING_TIMEOUT_MS, onProgress, onTimingEvent);
  if (!runtimeBridge?.instanceId) {
    if (typeof onProgress === "function") {
      onProgress("No ChatGPT sidebar bridge instance is available yet.");
    }
    throw new Error("bridge_runtime_not_ready");
  }

  if (typeof onProgress === "function") {
    onProgress(`Using ChatGPT sidebar bridge instance ${runtimeBridge.instanceId}.`);
  }

  rememberRuntimeBridge(runtimeBridge.instanceId, sourceTabId);
  emitTimingEvent(onTimingEvent, RUN_TIMELINE_EVENT.BRIDGE_PING_WAIT_STARTED, runtimeBridge.instanceId);
  const bridgeStatus = await waitForRuntimeBridgeReady(runtimeBridge.instanceId, BRIDGE_PING_TIMEOUT_MS, onProgress);
  emitTimingEvent(onTimingEvent, RUN_TIMELINE_EVENT.BRIDGE_PING_READY, runtimeBridge.instanceId);
  return buildReadyRuntimeBridgeState(runtimeBridge.instanceId, {
    ...runtimeBridge,
    ...bridgeStatus
  });
}

export function forgetClosedBridgeContext(closedTabId) {
  if (!Number.isInteger(closedTabId)) {
    return;
  }

  const state = getState();
  const currentRuntime = state.global.chatgptRuntimeBridgeStatus;
  if (currentRuntime?.bridgeTabId === closedTabId) {
    state.global.chatgptRuntimeBridgeStatus = {
      ...currentRuntime,
      bridgeTabId: null
    };
  }

  if (state.global.chatgptRuntimeBridgeStatusByInstanceId) {
    for (const [instanceId, runtimeStatus] of Object.entries(state.global.chatgptRuntimeBridgeStatusByInstanceId)) {
      if (runtimeStatus?.bridgeTabId === closedTabId) {
        state.global.chatgptRuntimeBridgeStatusByInstanceId[instanceId] = {
          ...runtimeStatus,
          bridgeTabId: null
        };
      }
    }
  }

  for (const [tabKey, session] of Object.entries(state.sessions)) {
    if (session?.bridgeTabId !== closedTabId) {
      continue;
    }

    state.sessions[tabKey] = {
      ...session,
      bridgeTabId: null,
      debug: {
        ...(session.debug || {}),
        bridgeTabId: null,
        chatgptBridge: {
          ...(session.debug?.chatgptBridge || {}),
          bridgeTabId: null
        }
      }
    };
  }
}

export function getSidebarBridgeStatus(sourceTabId = null) {
  const state = getState();
  const sessionRuntimeInstanceId = Number.isInteger(sourceTabId)
    ? state.sessions[String(sourceTabId)]?.bridgeRuntimeInstanceId || ""
    : "";
  const preferredInstanceId = sessionRuntimeInstanceId || getMostRecentLiveRuntimeBridgeInstanceId();
  const runtimeSignal = preferredInstanceId
    ? (getChatGptRuntimeBridgeStatus(preferredInstanceId) || { instanceId: preferredInstanceId })
    : getChatGptRuntimeBridgeStatus();

  if (!runtimeSignal?.instanceId) {
    return {
      linked: false,
      ready: false,
      reachable: false,
      bridgeTabId: null,
      bridgeInstanceId: "",
      channel: "runtime",
      signal: null
    };
  }

  const portEntry = runtimeBridgePortsByInstanceId.get(runtimeSignal.instanceId);
  const enrichedSignal = {
    ...runtimeSignal,
    portConnected: Boolean(portEntry?.port),
    pendingRequests: portEntry?.pendingRequests?.size ?? 0
  };

  if (Number.isInteger(sourceTabId) && !sessionRuntimeInstanceId) {
    setSession(sourceTabId, {
      bridgeRuntimeInstanceId: runtimeSignal.instanceId
    });
  }

  return {
    linked: true,
    ready: Boolean(runtimeSignal.pingReady),
    reachable: Boolean(portEntry?.port),
    bridgeTabId: runtimeSignal.bridgeTabId ?? null,
    bridgeInstanceId: runtimeSignal.instanceId,
    channel: "runtime",
    signal: enrichedSignal
  };
}
