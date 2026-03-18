import { MSG } from "./message-types.js";

const TEXT_ENCODER = new TextEncoder();

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isBooleanOrUndefined(value) {
  return typeof value === "boolean" || value == null;
}

function isHttpUrl(value) {
  if (!isNonEmptyString(value)) {
    return false;
  }

  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

function validateResult(result, index, errors) {
  if (!isObject(result)) {
    errors.push(`results[${index}] must be an object`);
    return;
  }

  if (!Number.isInteger(result.rank) || result.rank < 1 || result.rank > 100) {
    errors.push(`results[${index}].rank must be an integer between 1 and 100`);
  }
  if (!isNonEmptyString(result.title) || result.title.length > 400) {
    errors.push(`results[${index}].title must be 1-400 chars`);
  }
  if (!isHttpUrl(result.url) || result.url.length > 2000) {
    errors.push(`results[${index}].url must be a valid http(s) url <= 2000 chars`);
  }
  if (typeof result.snippet !== "string" || result.snippet.length > 2000) {
    errors.push(`results[${index}].snippet must be a string <= 2000 chars`);
  }
  if (typeof result.displayUrl !== "string" || result.displayUrl.length > 300) {
    errors.push(`results[${index}].displayUrl must be a string <= 300 chars`);
  }
}

export function isPayloadWithinBytes(payload, maxBytes) {
  if (!Number.isInteger(maxBytes) || maxBytes < 1) {
    return false;
  }

  try {
    const encoded = TEXT_ENCODER.encode(JSON.stringify(payload ?? {}));
    return encoded.byteLength <= maxBytes;
  } catch {
    return false;
  }
}

export function validateStartpageContextPayload(payload, limits) {
  const errors = [];

  if (!isObject(payload)) {
    return { ok: false, errors: ["payload must be an object"] };
  }
  if (payload.type !== MSG.STARTPAGE_CONTEXT_FOUND) {
    errors.push("type must be STARTPAGE_CONTEXT_FOUND");
  }
  if (!isHttpUrl(payload.pageUrl) || !payload.pageUrl.includes("startpage.")) {
    errors.push("pageUrl must be a Startpage http(s) URL");
  }
  if (!Number.isInteger(payload.capturedAt) || payload.capturedAt <= 0) {
    errors.push("capturedAt must be a positive integer timestamp");
  }
  if (!isNonEmptyString(payload.query) || payload.query.length > limits.maxQueryChars) {
    errors.push(`query must be 1-${limits.maxQueryChars} chars`);
  }
  if (!Array.isArray(payload.results)) {
    errors.push("results must be an array");
  } else {
    if (payload.results.length < 1 || payload.results.length > limits.maxResultCount) {
      errors.push(`results must contain 1-${limits.maxResultCount} items`);
    }
    payload.results.forEach((result, index) => {
      validateResult(result, index, errors);
    });
  }

  if (!isPayloadWithinBytes(payload, limits.maxMessageBytes)) {
    errors.push(`payload exceeds ${limits.maxMessageBytes} bytes`);
  }

  return {
    ok: errors.length === 0,
    errors
  };
}

export function validateStartpageScriptStatusPayload(payload, maxMessageBytes) {
  const errors = [];

  if (!isObject(payload)) {
    return { ok: false, errors: ["payload must be an object"] };
  }
  if (payload.type !== MSG.STARTPAGE_SCRIPT_STATUS) {
    errors.push("type must be STARTPAGE_SCRIPT_STATUS");
  }
  if (!isNonEmptyString(payload.phase) || payload.phase.length > 80) {
    errors.push("phase must be a non-empty string <= 80 chars");
  }
  if (!isHttpUrl(payload.pageUrl)) {
    errors.push("pageUrl must be a valid http(s) URL");
  }
  if (!Number.isInteger(payload.lastSeenAt) || payload.lastSeenAt <= 0) {
    errors.push("lastSeenAt must be a positive integer timestamp");
  }
  if (payload.errorMessage != null && (typeof payload.errorMessage !== "string" || payload.errorMessage.length > 400)) {
    errors.push("errorMessage must be a string <= 400 chars");
  }
  if (!isPayloadWithinBytes(payload, maxMessageBytes)) {
    errors.push(`payload exceeds ${maxMessageBytes} bytes`);
  }

  return {
    ok: errors.length === 0,
    errors
  };
}

export function validateRunRequestPayload(payload) {
  const errors = [];
  if (!isObject(payload)) {
    return { ok: false, errors: ["payload must be an object"] };
  }
  if (payload.type !== MSG.REQUEST_RUN_FOR_TAB) {
    errors.push("type must be REQUEST_RUN_FOR_TAB");
  }
  if (!Number.isInteger(payload.sourceTabId) || payload.sourceTabId < 0) {
    errors.push("sourceTabId must be a non-negative integer");
  }
  if (payload.summaryMode != null && !isNonEmptyString(payload.summaryMode)) {
    errors.push("summaryMode must be a non-empty string when provided");
  }

  return { ok: errors.length === 0, errors };
}

export function validateFollowUpPayload(payload, maxFollowUpChars) {
  const errors = [];
  if (!isObject(payload)) {
    return { ok: false, errors: ["payload must be an object"] };
  }
  if (payload.type !== MSG.SIDEBAR_FOLLOW_UP) {
    errors.push("type must be SIDEBAR_FOLLOW_UP");
  }
  if (!Number.isInteger(payload.sourceTabId) || payload.sourceTabId < 0) {
    errors.push("sourceTabId must be a non-negative integer");
  }
  if (!isNonEmptyString(payload.followUp) || payload.followUp.length > maxFollowUpChars) {
    errors.push(`followUp must be 1-${maxFollowUpChars} chars`);
  }
  return { ok: errors.length === 0, errors };
}

export function validateOptionsSavePayload(payload, settingsContract) {
  const errors = [];
  if (!isObject(payload)) {
    return { ok: false, errors: ["payload must be an object"] };
  }
  if (payload.type !== MSG.OPTIONS_SAVE_SETTINGS) {
    errors.push("type must be OPTIONS_SAVE_SETTINGS");
  }

  const settings = payload.settings;
  if (!isObject(settings)) {
    errors.push("settings must be an object");
  } else {
    if (settings.model != null && !settingsContract.allowedModels.includes(settings.model)) {
      errors.push("settings.model is not allowlisted");
    }
    if (settings.defaultSummaryMode != null && !settingsContract.allowedSummaryModes.includes(settings.defaultSummaryMode)) {
      errors.push("settings.defaultSummaryMode is invalid");
    }
    if (settings.maxResults != null && (!Number.isInteger(settings.maxResults) || settings.maxResults < 1 || settings.maxResults > settingsContract.maxResultsCap)) {
      errors.push(`settings.maxResults must be 1-${settingsContract.maxResultsCap}`);
    }
    if (settings.maxOutputTokens != null && (!Number.isInteger(settings.maxOutputTokens) || settings.maxOutputTokens < 32 || settings.maxOutputTokens > settingsContract.maxOutputTokensCap)) {
      errors.push(`settings.maxOutputTokens must be 32-${settingsContract.maxOutputTokensCap}`);
    }
    if (settings.requestTimeoutMs != null && (!Number.isInteger(settings.requestTimeoutMs) || settings.requestTimeoutMs < 3000 || settings.requestTimeoutMs > settingsContract.timeoutMsCap)) {
      errors.push(`settings.requestTimeoutMs must be 3000-${settingsContract.timeoutMsCap}`);
    }
    if (!isBooleanOrUndefined(settings.autoInjectOverviewCard)) {
      errors.push("settings.autoInjectOverviewCard must be boolean");
    }
    if (!isBooleanOrUndefined(settings.debugMode)) {
      errors.push("settings.debugMode must be boolean");
    }
  }

  return { ok: errors.length === 0, errors };
}

export function validateSetApiKeyPayload(payload, maxKeyChars) {
  const errors = [];
  if (!isObject(payload)) {
    return { ok: false, errors: ["payload must be an object"] };
  }
  if (payload.type !== MSG.OPTIONS_SET_API_KEY) {
    errors.push("type must be OPTIONS_SET_API_KEY");
  }
  const apiKey = String(payload.apiKey || "").trim();
  if (!apiKey || apiKey.length > maxKeyChars) {
    errors.push(`apiKey must be 1-${maxKeyChars} chars`);
  }
  return { ok: errors.length === 0, errors };
}

export function validateApiKeyValidationPayload(payload, maxKeyChars) {
  const errors = [];
  if (!isObject(payload)) {
    return { ok: false, errors: ["payload must be an object"] };
  }
  if (payload.type !== MSG.OPTIONS_VALIDATE_API_KEY) {
    errors.push("type must be OPTIONS_VALIDATE_API_KEY");
  }
  if (payload.apiKey != null) {
    if (typeof payload.apiKey !== "string") {
      errors.push("apiKey must be a string when provided");
    } else {
      const apiKey = payload.apiKey.trim();
      if (apiKey.length > maxKeyChars) {
        errors.push(`apiKey must be <= ${maxKeyChars} chars when provided`);
      }
    }
  }
  return { ok: errors.length === 0, errors };
}
