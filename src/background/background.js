import { routeMessage } from "./message-router.js";
import {
  DEBUG,
  ALLOWED_MODELS,
  DEFAULT_SETTINGS,
  FORCED_MODELS_BY_SUMMARY_MODE,
  LIMITS,
  STATUS,
  SUMMARY_MODE
} from "./constants.js";
import {
  markAutoQuickQueued,
  completeSessionRun,
  failSessionRun,
  getSession,
  getSettings,
  getStateSnapshot,
  initializeRuntimeState,
  markSessionQueued,
  markSessionRunning,
  markStartpageScriptStatus,
  shouldAutoQueueQuickOverview,
  setActiveSidebarTabId,
  setSettings,
  setSessionProgress,
  upsertStartpageSession,
  updateSettings
} from "./state.js";
import { buildPromptPayload } from "./prompt-builder.js";
import { normalizeClientError, requestOpenAiSummary, validateApiKeyCandidate } from "./openai-client.js";
import { formatQuickOverviewOutput } from "./quick-overview-format.js";
import {
  deleteStoredApiKey,
  hasStoredApiKey,
  getStoredApiKey,
  storeApiKey
} from "./secure-storage.js";
import { MSG } from "../content/shared/message-types.js";
import { sanitizeDebugText } from "../content/shared/sanitize.js";

const inFlightControllersByTabId = new Map();

function resolveSummaryMode(requestedMode, settings) {
  if (requestedMode && Object.values(SUMMARY_MODE).includes(requestedMode)) {
    return requestedMode;
  }
  if (Object.values(SUMMARY_MODE).includes(settings.defaultSummaryMode)) {
    return settings.defaultSummaryMode;
  }
  return DEFAULT_SETTINGS.defaultSummaryMode;
}

function resolveRunSummaryMode({ requestedSummaryMode, settings, session, followUp }) {
  if (requestedSummaryMode && Object.values(SUMMARY_MODE).includes(requestedSummaryMode)) {
    return requestedSummaryMode;
  }

  if (String(followUp || "").trim()) {
    const previousMode = session?.response?.mode;
    if (previousMode && Object.values(SUMMARY_MODE).includes(previousMode)) {
      return previousMode;
    }
  }

  return resolveSummaryMode(null, settings);
}

function resolveModel(settings) {
  return ALLOWED_MODELS.includes(settings.model)
    ? settings.model
    : DEFAULT_SETTINGS.model;
}

function resolveRunModel(summaryMode, settings) {
  const forcedModel = FORCED_MODELS_BY_SUMMARY_MODE[summaryMode];
  if (ALLOWED_MODELS.includes(forcedModel)) {
    return forcedModel;
  }
  return resolveModel(settings);
}

function supportsReasoningEffort(model) {
  return typeof model === "string" && model.toLowerCase().startsWith("gpt-5");
}

function resolveOutputTokenCap(summaryMode) {
  if (summaryMode === SUMMARY_MODE.EXPANDED) {
    return LIMITS.MAX_EXPANDED_OUTPUT_TOKENS_CAP;
  }
  return LIMITS.MAX_OUTPUT_TOKENS_CAP;
}

function resolveGenerationControls({ summaryMode, expectsStructuredJson, model }) {
  if (expectsStructuredJson) {
    return {
      textVerbosity: "low",
      reasoningEffort: supportsReasoningEffort(model) ? "low" : ""
    };
  }

  if (summaryMode === SUMMARY_MODE.EXPANDED) {
    return {
      textVerbosity: "medium",
      reasoningEffort: supportsReasoningEffort(model) ? "low" : ""
    };
  }

  return {
    textVerbosity: "",
    reasoningEffort: ""
  };
}

function resolveOutputTokens(summaryMode = SUMMARY_MODE.QUICK_OVERVIEW) {
  return resolveOutputTokenCap(summaryMode);
}

function resolveTimeoutMs(settings) {
  const candidate = Number.isInteger(settings.requestTimeoutMs) ? settings.requestTimeoutMs : DEFAULT_SETTINGS.requestTimeoutMs;
  return Math.max(LIMITS.REQUEST_TIMEOUT_MS_MIN, Math.min(LIMITS.REQUEST_TIMEOUT_MS_CAP, candidate));
}

function sanitizeSources(results, maxCount = 5) {
  if (!Array.isArray(results)) {
    return [];
  }
  return results.slice(0, maxCount).map((result) => ({
    title: String(result?.title || result?.url || "Source"),
    url: String(result?.url || "")
  })).filter((source) => source.url.startsWith("http://") || source.url.startsWith("https://"));
}

function summarizeRunUsage(usage, model, {
  requestedMaxOutputTokens = null,
  attemptedMaxOutputTokens = null,
  maxOutputTokensCap = null
} = {}) {
  if (!usage || typeof usage !== "object") {
    return null;
  }

  const inputTokens = Number.isInteger(usage.inputTokens) ? usage.inputTokens : 0;
  const outputTokens = Number.isInteger(usage.outputTokens) ? usage.outputTokens : 0;
  const totalTokens = Number.isInteger(usage.totalTokens) ? usage.totalTokens : (inputTokens + outputTokens);
  const modelKey = String(model || "").trim().toLowerCase();

  return {
    model: modelKey,
    inputTokens,
    outputTokens,
    totalTokens,
    requestedMaxOutputTokens: Number.isInteger(requestedMaxOutputTokens) ? requestedMaxOutputTokens : null,
    attemptedMaxOutputTokens: Number.isInteger(attemptedMaxOutputTokens) ? attemptedMaxOutputTokens : null,
    maxOutputTokensCap: Number.isInteger(maxOutputTokensCap) ? maxOutputTokensCap : null
  };
}

function buildUsageByMode(previousUsageByMode, mode, runUsage) {
  const next = previousUsageByMode && typeof previousUsageByMode === "object"
    ? { ...previousUsageByMode }
    : {};

  if (!mode || !runUsage) {
    return next;
  }

  next[mode] = runUsage;
  return next;
}

function computeJsonVisibleCharCount(payload) {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  try {
    return JSON.stringify(payload).length;
  } catch {
    return null;
  }
}

function summarizeRunTelemetry(result, fallbackModelSnapshot, structuredPayload = null) {
  const usage = result?.usage && typeof result.usage === "object"
    ? result.usage
    : null;

  const modelSnapshot = String(result?.modelSnapshot || fallbackModelSnapshot || "").trim();
  return {
    outputTokens: Number.isInteger(usage?.outputTokens) ? usage.outputTokens : null,
    reasoningTokens: Number.isInteger(usage?.reasoningTokens) ? usage.reasoningTokens : null,
    visibleJsonChars: computeJsonVisibleCharCount(structuredPayload),
    modelSnapshot: modelSnapshot || null,
    retryCount: Number.isInteger(result?.retryCount) && result.retryCount >= 0
      ? result.retryCount
      : 0
  };
}

function buildTelemetryByMode(previousTelemetryByMode, mode, runTelemetry) {
  const next = previousTelemetryByMode && typeof previousTelemetryByMode === "object"
    ? { ...previousTelemetryByMode }
    : {};

  if (!mode || !runTelemetry) {
    return next;
  }

  next[mode] = runTelemetry;
  return next;
}

function buildResponsePayload(
  text,
  results,
  mode,
  usage = null,
  structured = null,
  usageByMode = null,
  telemetry = null,
  telemetryByMode = null
) {
  return {
    text,
    mode,
    sources: sanitizeSources(results, mode === SUMMARY_MODE.EXPANDED ? 5 : 3),
    usage,
    structured,
    usageByMode: usageByMode && typeof usageByMode === "object" ? usageByMode : {},
    telemetry,
    telemetryByMode: telemetryByMode && typeof telemetryByMode === "object" ? telemetryByMode : {}
  };
}

function createRunId(sourceTabId) {
  return `run_${sourceTabId}_${Date.now()}`;
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
    // Source tab content script may not be active.
  }
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

async function broadcastSessionUpdated(sourceTabId) {
  const session = getSession(sourceTabId);
  const payload = {
    type: MSG.SESSION_UPDATED,
    sourceTabId,
    session: toSerializableSession(sourceTabId, session)
  };

  await broadcastMessage(payload);
  await sendMessageToSourceTab(sourceTabId, payload);
}

function applyDebugProgress(sourceTabId, message) {
  setSessionProgress(sourceTabId, sanitizeDebugText(message, 250));
}

function cancelInFlightRun(sourceTabId) {
  const existing = inFlightControllersByTabId.get(sourceTabId);
  if (!existing) {
    return;
  }
  existing.abortController.abort();
  inFlightControllersByTabId.delete(sourceTabId);
}

async function queueSummaryRun(sourceTabId, progressMessage, runOptions = {}) {
  const session = getSession(sourceTabId);
  if (!session) {
    return null;
  }

  markSessionQueued(sourceTabId);
  applyDebugProgress(sourceTabId, progressMessage);
  await broadcastSessionUpdated(sourceTabId);

  runSummaryForTab(sourceTabId, runOptions).catch(() => undefined);
  return getSession(sourceTabId);
}

async function runSummaryForTab(sourceTabId, { followUp = "", requestedSummaryMode = null } = {}) {
  const session = getSession(sourceTabId);
  if (!session) {
    return;
  }

  if (!Array.isArray(session.results) || session.results.length === 0) {
    failSessionRun(sourceTabId, {
      code: "STARTPAGE_RESULTS_NOT_FOUND",
      message: "No Startpage results were captured for this tab.",
      recoverable: true
    });
    await broadcastSessionUpdated(sourceTabId);
    return;
  }

  cancelInFlightRun(sourceTabId);

  const runId = createRunId(sourceTabId);
  const abortController = new AbortController();
  inFlightControllersByTabId.set(sourceTabId, {
    runId,
    abortController
  });

  const settings = getSettings();
  const summaryMode = resolveRunSummaryMode({
    requestedSummaryMode,
    settings,
    session,
    followUp
  });
  const model = resolveRunModel(summaryMode, settings);
  const maxOutputTokensCap = resolveOutputTokenCap(summaryMode);
  const maxOutputTokens = resolveOutputTokens(summaryMode);
  const timeoutMs = resolveTimeoutMs(settings);
  const resultsForPrompt = session.results.slice(0, Math.max(1, Math.min(settings.maxResults || 5, LIMITS.MAX_RESULTS_CAP)));
  const promptPayload = buildPromptPayload({
    query: session.query,
    results: resultsForPrompt,
    mode: summaryMode,
    followUp,
    previousAnswer: session.response?.text || ""
  });
  const promptPreview = String(promptPayload.preview || "");

  if (promptPreview.length > LIMITS.MAX_PROMPT_CHARS) {
    failSessionRun(sourceTabId, {
      runId,
      code: "PROMPT_TOO_LARGE",
      message: "Captured text is too large to send safely. Reduce result count in settings.",
      recoverable: true
    });
    inFlightControllersByTabId.delete(sourceTabId);
    await broadcastSessionUpdated(sourceTabId);
    return;
  }

  const apiKey = await getStoredApiKey();
  if (!apiKey) {
    failSessionRun(sourceTabId, {
      runId,
      code: "MISSING_API_KEY",
      message: "No OpenAI API key found. Add one in StartGPT Settings.",
      recoverable: true
    });
    inFlightControllersByTabId.delete(sourceTabId);
    await broadcastSessionUpdated(sourceTabId);
    return;
  }

  markSessionRunning(sourceTabId, runId, sanitizeDebugText(promptPreview, 1800));
  applyDebugProgress(sourceTabId, "Sending request to OpenAI.");
  await broadcastSessionUpdated(sourceTabId);

  try {
    const generationControls = resolveGenerationControls({
      summaryMode,
      expectsStructuredJson: promptPayload.expectsStructuredJson,
      model
    });

    const result = await requestOpenAiSummary({
      apiKey,
      model,
      prompt: promptPayload.input,
      instructions: promptPayload.instructions,
      textVerbosity: generationControls.textVerbosity,
      reasoningEffort: generationControls.reasoningEffort,
      maxOutputTokens,
      maxOutputTokensCap,
      timeoutMs,
      signal: abortController.signal
    });

    const formatted = promptPayload.expectsStructuredJson
      ? formatQuickOverviewOutput(result.text)
      : {
        text: result.text,
        structured: null,
        formatUsed: "raw_text"
      };

    const runUsage = summarizeRunUsage(result.usage, model, {
      requestedMaxOutputTokens: maxOutputTokens,
      attemptedMaxOutputTokens: result.attemptedMaxOutputTokens,
      maxOutputTokensCap: result.maxOutputTokensCap
    });
    const runTelemetry = summarizeRunTelemetry(result, model, formatted.structured);
    const usageByMode = buildUsageByMode(session.response?.usageByMode, summaryMode, runUsage);
    const telemetryByMode = buildTelemetryByMode(
      session.response?.telemetryByMode,
      summaryMode,
      runTelemetry
    );

    if (inFlightControllersByTabId.get(sourceTabId)?.runId !== runId) {
      return;
    }

    if (promptPayload.expectsStructuredJson && formatted.formatUsed !== "structured_json") {
      applyDebugProgress(sourceTabId, "OpenAI quick overview JSON parse fallback used.");
    }

    completeSessionRun(sourceTabId, {
      runId,
      response: buildResponsePayload(
        formatted.text,
        resultsForPrompt,
        summaryMode,
        result.usage,
        formatted.structured,
        usageByMode,
        runTelemetry,
        telemetryByMode
      ),
      completedAt: Date.now()
    });
    if (DEBUG.enabled || settings.debugMode) {
      console.debug("[StartGPT][telemetry]", {
        sourceTabId,
        mode: summaryMode,
        telemetry: runTelemetry
      });
    }
    await broadcastSessionUpdated(sourceTabId);
  } catch (error) {
    if (abortController.signal.aborted) {
      failSessionRun(sourceTabId, {
        runId,
        code: "RUN_CANCELLED",
        message: "Previous run was cancelled by a new request.",
        recoverable: true
      });
      await broadcastSessionUpdated(sourceTabId);
      return;
    }

    const normalized = normalizeClientError(error);
    failSessionRun(sourceTabId, {
      runId,
      code: normalized.code,
      message: normalized.message,
      recoverable: normalized.recoverable,
      diagnostics: normalized.diagnostics || null
    });
    await broadcastSessionUpdated(sourceTabId);
  } finally {
    const active = inFlightControllersByTabId.get(sourceTabId);
    if (active?.runId === runId) {
      inFlightControllersByTabId.delete(sourceTabId);
    }
  }
}

function pruneSettings(rawSettings) {
  const maxOutputTokensCandidate = Number.isInteger(rawSettings.maxOutputTokens)
    ? rawSettings.maxOutputTokens
    : DEFAULT_SETTINGS.maxOutputTokens;

  return {
    model: resolveModel(rawSettings),
    defaultSummaryMode: resolveSummaryMode(rawSettings.defaultSummaryMode, rawSettings),
    maxResults: Math.max(1, Math.min(LIMITS.MAX_RESULTS_CAP, Number.isInteger(rawSettings.maxResults) ? rawSettings.maxResults : DEFAULT_SETTINGS.maxResults)),
    maxOutputTokens: Math.max(32, Math.min(LIMITS.MAX_EXPANDED_OUTPUT_TOKENS_CAP, maxOutputTokensCandidate)),
    requestTimeoutMs: resolveTimeoutMs(rawSettings),
    autoInjectOverviewCard: Boolean(rawSettings.autoInjectOverviewCard),
    debugMode: Boolean(rawSettings.debugMode)
  };
}

async function handleRoutedMessage(route, message) {
  switch (route.command) {
    case "startpage_script_status": {
      const session = markStartpageScriptStatus(route.sourceTabId, {
        phase: message.phase,
        pageUrl: message.pageUrl,
        lastSeenAt: message.lastSeenAt,
        errorMessage: message.errorMessage
      });
      setActiveSidebarTabId(route.sourceTabId);
      await broadcastSessionUpdated(route.sourceTabId);
      return {
        ok: true,
        session: toSerializableSession(route.sourceTabId, session)
      };
    }

    case "startpage_context_found": {
      const session = upsertStartpageSession(route.sourceTabId, message);
      setActiveSidebarTabId(route.sourceTabId);
      if (shouldAutoQueueQuickOverview(session)) {
        markAutoQuickQueued(route.sourceTabId, session.contextFingerprint);
        const queuedSession = await queueSummaryRun(
          route.sourceTabId,
          "Automatic quick overview requested.",
          {
            requestedSummaryMode: SUMMARY_MODE.QUICK_OVERVIEW
          }
        );
        return {
          ok: true,
          session: toSerializableSession(route.sourceTabId, queuedSession || getSession(route.sourceTabId))
        };
      }

      await broadcastSessionUpdated(route.sourceTabId);
      return {
        ok: true,
        session: toSerializableSession(route.sourceTabId, getSession(route.sourceTabId) || session)
      };
    }

    case "request_run": {
      if (!getSession(route.sourceTabId)) {
        return { ok: false, error: "session_not_found" };
      }
      await queueSummaryRun(route.sourceTabId, "Run requested by user.", {
        requestedSummaryMode: route.summaryMode
      });
      return { ok: true, sourceTabId: route.sourceTabId };
    }

    case "follow_up": {
      if (!getSession(route.sourceTabId)) {
        return { ok: false, error: "session_not_found" };
      }
      await queueSummaryRun(route.sourceTabId, "Follow-up requested by user.", {
        followUp: route.followUp
      });
      return { ok: true, sourceTabId: route.sourceTabId };
    }

    case "get_state": {
      const sourceTabId = Number.isInteger(route.sourceTabId) ? route.sourceTabId : null;
      const session = Number.isInteger(sourceTabId) ? getSession(sourceTabId) : null;
      if (Number.isInteger(sourceTabId) && session) {
        setActiveSidebarTabId(sourceTabId);
      }
      return {
        ok: true,
        state: getStateSnapshot(),
        session: Number.isInteger(sourceTabId) ? toSerializableSession(sourceTabId, session) : null,
        hasApiKey: await hasStoredApiKey()
      };
    }

    case "options_get_settings": {
      return {
        ok: true,
        settings: getSettings(),
        hasApiKey: await hasStoredApiKey()
      };
    }

    case "options_save_settings": {
      const pruned = pruneSettings(route.settings || {});
      const updated = await updateSettings(pruned);
      return {
        ok: true,
        settings: updated,
        hasApiKey: await hasStoredApiKey()
      };
    }

    case "options_set_api_key": {
      await storeApiKey(route.apiKey);
      return {
        ok: true,
        hasApiKey: true
      };
    }

    case "options_delete_api_key": {
      await deleteStoredApiKey();
      return {
        ok: true,
        hasApiKey: false
      };
    }

    case "options_validate_api_key": {
      const enteredApiKey = String(route.apiKey || "").trim();
      const apiKey = enteredApiKey || await getStoredApiKey();
      if (!apiKey) {
        return {
          ok: false,
          error: {
            code: "MISSING_API_KEY",
            message: "No OpenAI API key found. Add one in StartGPT Settings.",
            recoverable: true
          }
        };
      }

      const settings = getSettings();
      const validation = await validateApiKeyCandidate(
        apiKey,
        resolveModel(settings),
        resolveTimeoutMs(settings)
      );
      return {
        ok: validation.ok,
        error: validation.ok ? null : validation.error
      };
    }

    default:
      return { ok: false, error: "unknown_command" };
  }
}

async function handleMessage(message, sender) {
  const route = await routeMessage(message, sender);
  if (!route.ok) {
    return route;
  }
  return handleRoutedMessage(route, message);
}

const startupReady = initializeRuntimeState()
  .catch((error) => {
    if (DEBUG.enabled) {
      console.error("[StartGPT][background] startup failed", error);
    }
  });

browser.runtime.onInstalled.addListener((details) => {
  startupReady.then(async () => {
    if (details?.reason !== "install") {
      return;
    }
    const hasApiKey = await hasStoredApiKey();
    if (hasApiKey) {
      return;
    }
    await browser.runtime.openOptionsPage();
  }).catch(() => undefined);
});

browser.runtime.onMessage.addListener((message, sender) =>
  startupReady.then(() => handleMessage(message, sender))
);

browser.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") {
    return;
  }
  if (!changes?.settings?.newValue) {
    return;
  }
  const nextSettings = pruneSettings(changes.settings.newValue);
  setSettings(nextSettings);
});
