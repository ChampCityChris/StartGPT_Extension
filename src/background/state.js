import { DEFAULT_SETTINGS, STATUS, STORAGE_KEYS } from "./constants.js";
import { buildContextFingerprint as buildCanonicalContextFingerprint } from "../content/shared/context-fingerprint.js";

function toTabKey(tabId) {
  return String(tabId);
}

function cloneSerializable(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function buildContextFingerprint(query, results) {
  return buildCanonicalContextFingerprint(query, results);
}

function buildResultsFingerprint(results) {
  if (!Array.isArray(results) || results.length === 0) {
    return "";
  }

  return results
    .slice(0, 6)
    .map((result) => {
      const url = normalizeText(result?.url);
      const title = normalizeText(result?.title);
      return `${url}::${title}`;
    })
    .join("||");
}

function hasContextChanged(previous, nextContext, nextContextFingerprint = "") {
  if (!previous || !nextContext) {
    return false;
  }

  const previousQuery = normalizeText(previous.query);
  const nextQuery = normalizeText(nextContext.query);
  const previousFingerprint = buildContextFingerprint(previous.query, previous.results)
    || normalizeText(previous.contextFingerprint)
    || buildResultsFingerprint(previous.results);
  const nextFingerprint = normalizeText(nextContextFingerprint)
    || buildContextFingerprint(nextContext.query, nextContext.results)
    || buildResultsFingerprint(nextContext.results);
  const previousUrl = normalizeText(previous.startpageUrl);
  const nextUrl = normalizeText(nextContext.pageUrl);

  if (previousFingerprint && nextFingerprint) {
    return previousFingerprint !== nextFingerprint;
  }
  if (previousFingerprint || nextFingerprint) {
    return Boolean(previousQuery || previousUrl) && previousUrl !== nextUrl;
  }

  if (previousQuery !== nextQuery) {
    return true;
  }

  return Boolean(previousQuery || previousUrl) && previousUrl !== nextUrl;
}

export function shouldAutoQueueQuickOverview(session) {
  if (!session || session.status !== STATUS.CAPTURED) {
    return false;
  }

  const contextFingerprint = normalizeText(session.contextFingerprint);
  const lastAutoQuickFingerprint = normalizeText(session.lastAutoQuickFingerprint);
  if (!contextFingerprint) {
    return true;
  }

  return contextFingerprint !== lastAutoQuickFingerprint;
}

export function markAutoQuickQueued(tabId, contextFingerprint = "") {
  const session = getSession(tabId);
  if (!session) {
    return null;
  }

  const fingerprint = normalizeText(contextFingerprint || session.contextFingerprint);
  if (!fingerprint) {
    return session;
  }

  return setSession(tabId, {
    lastAutoQuickFingerprint: fingerprint
  });
}

export function createInitialState(settings = DEFAULT_SETTINGS) {
  return {
    settings: { ...DEFAULT_SETTINGS, ...settings },
    sessions: {},
    global: {
      activeSidebarTabId: null,
      initializedAt: Date.now()
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
  return cloneSerializable(runtimeState);
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

export function getSession(tabId) {
  return runtimeState.sessions[toTabKey(tabId)] || null;
}

export function setSession(tabId, nextSessionPatch) {
  const key = toTabKey(tabId);
  runtimeState.sessions[key] = {
    ...runtimeState.sessions[key],
    ...nextSessionPatch
  };
  return runtimeState.sessions[key];
}

export function setActiveSidebarTabId(tabId) {
  runtimeState.global.activeSidebarTabId = Number.isInteger(tabId) ? tabId : null;
}

export function upsertStartpageSession(tabId, context) {
  const key = toTabKey(tabId);
  const previous = runtimeState.sessions[key] || {};
  const contextFingerprint = buildContextFingerprint(context.query, context.results);
  const changed = hasContextChanged(previous, context, contextFingerprint);
  const keepRunningState = previous.status === STATUS.RUNNING;
  const hasCompletedOverview = Number.isInteger(previous.completedAt)
    && String(previous.response?.text || "").trim().length > 0;
  const previousQuery = normalizeText(previous.query).toLowerCase();
  const nextQuery = normalizeText(context.query).toLowerCase();
  const sameQuery = Boolean(previousQuery) && previousQuery === nextQuery;
  const keepCompletedLocked = hasCompletedOverview && sameQuery;
  const nextStatus = keepRunningState
    ? STATUS.RUNNING
    : ((keepCompletedLocked || (!changed && hasCompletedOverview)) ? STATUS.COMPLETED : STATUS.CAPTURED);
  const preservePreviousResponse = keepCompletedLocked || !changed;

  runtimeState.sessions[key] = {
    query: context.query,
    startpageUrl: context.pageUrl,
    capturedAt: context.capturedAt,
    results: Array.isArray(context.results) ? context.results : [],
    contextFingerprint,
    lastAutoQuickFingerprint: previous.lastAutoQuickFingerprint || "",
    status: nextStatus,
    runId: keepRunningState ? (previous.runId || "") : "",
    response: preservePreviousResponse ? (previous.response || null) : null,
    completedAt: preservePreviousResponse ? (previous.completedAt || null) : null,
    lastError: keepRunningState ? (previous.lastError || null) : null,
    debug: {
      ...(previous.debug || {}),
      progressMessage: keepRunningState
        ? (previous.debug?.progressMessage || "Run in progress.")
        : (nextStatus === STATUS.COMPLETED
          ? "Overview complete."
          : "Context captured. Automatic quick overview will start shortly."),
      lastErrorCode: keepRunningState ? (previous.debug?.lastErrorCode || "") : "",
      startpageScript: previous.debug?.startpageScript || {
        phase: "module_loaded",
        pageUrl: context.pageUrl,
        lastSeenAt: context.capturedAt,
        errorMessage: ""
      }
    }
  };

  return runtimeState.sessions[key];
}

export function markStartpageScriptStatus(tabId, scriptStatus) {
  const session = getSession(tabId) || {
    query: "",
    startpageUrl: scriptStatus.pageUrl || "",
    capturedAt: null,
    results: [],
    status: STATUS.IDLE,
    runId: "",
    response: null,
    completedAt: null,
    lastError: null,
    debug: {}
  };

  return setSession(tabId, {
    ...session,
    debug: {
      ...(session.debug || {}),
      startpageScript: {
        phase: String(scriptStatus.phase || "unknown"),
        pageUrl: String(scriptStatus.pageUrl || session.startpageUrl || ""),
        lastSeenAt: Number.isInteger(scriptStatus.lastSeenAt) ? scriptStatus.lastSeenAt : Date.now(),
        errorMessage: String(scriptStatus.errorMessage || "")
      }
    }
  });
}

export function markSessionQueued(tabId) {
  const session = getSession(tabId);
  if (!session) {
    return null;
  }
  return setSession(tabId, {
    status: STATUS.QUEUED,
    lastError: null,
    debug: {
      ...(session.debug || {}),
      progressMessage: "Queued. Preparing request.",
      lastErrorCode: ""
    }
  });
}

export function markSessionRunning(tabId, runId, promptPreview = "") {
  const session = getSession(tabId);
  if (!session) {
    return null;
  }

  return setSession(tabId, {
    status: STATUS.RUNNING,
    runId,
    lastError: null,
    debug: {
      ...(session.debug || {}),
      progressMessage: "Sending request to OpenAI.",
      lastPrompt: promptPreview,
      lastErrorCode: ""
    }
  });
}

export function setSessionProgress(tabId, progressMessage) {
  const session = getSession(tabId);
  if (!session) {
    return null;
  }

  return setSession(tabId, {
    debug: {
      ...(session.debug || {}),
      progressMessage: String(progressMessage || "")
    }
  });
}

export function completeSessionRun(tabId, { runId, response, completedAt = Date.now() }) {
  const session = getSession(tabId);
  if (!session) {
    return { applied: false, reason: "session_missing" };
  }
  if (runId && session.runId !== runId) {
    return { applied: false, reason: "stale_run_id" };
  }

  const updated = setSession(tabId, {
    status: STATUS.COMPLETED,
    response,
    completedAt,
    lastError: null,
    debug: {
      ...(session.debug || {}),
      progressMessage: "Overview complete.",
      lastErrorCode: ""
    }
  });
  return { applied: true, session: updated };
}

export function failSessionRun(tabId, {
  runId = null,
  code,
  message,
  recoverable = true,
  diagnostics = null
}) {
  const session = getSession(tabId);
  if (!session) {
    return { applied: false, reason: "session_missing" };
  }
  if (runId && session.runId !== runId) {
    return { applied: false, reason: "stale_run_id" };
  }

  const updated = setSession(tabId, {
    status: STATUS.FAILED,
    lastError: {
      code: String(code || "RUN_FAILED"),
      message: String(message || "Run failed."),
      recoverable: Boolean(recoverable),
      diagnostics: diagnostics && typeof diagnostics === "object" ? diagnostics : null
    },
    debug: {
      ...(session.debug || {}),
      progressMessage: String(message || "Run failed."),
      lastErrorCode: String(code || "RUN_FAILED"),
      lastErrorDiagnostics: diagnostics && typeof diagnostics === "object" ? diagnostics : null
    }
  });

  return { applied: true, session: updated };
}

export async function loadSettingsFromStorage(storageArea = browser.storage.local) {
  const stored = await storageArea.get(STORAGE_KEYS.SETTINGS);
  const settings = stored?.[STORAGE_KEYS.SETTINGS];
  if (!settings || typeof settings !== "object") {
    return { ...DEFAULT_SETTINGS };
  }
  return {
    ...DEFAULT_SETTINGS,
    ...settings
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
