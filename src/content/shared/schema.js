import { MSG } from "./message-types.js";

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isValidResult(result) {
  if (!result || typeof result !== "object") {
    return false;
  }

  const hasValidRank = Number.isInteger(result.rank) && result.rank > 0;
  const hasTitle = isNonEmptyString(result.title);
  const hasUrl = isNonEmptyString(result.url);
  const hasSnippet = typeof result.snippet === "string";
  const hasDisplayUrl = typeof result.displayUrl === "string";

  return hasValidRank && hasTitle && hasUrl && hasSnippet && hasDisplayUrl;
}

export function validateStartpageContextPayload(payload) {
  const errors = [];

  if (!payload || typeof payload !== "object") {
    errors.push("payload must be an object");
    return { ok: false, errors };
  }

  if (payload.type !== MSG.STARTPAGE_CONTEXT_FOUND) {
    errors.push("type must be STARTPAGE_CONTEXT_FOUND");
  }

  if (!isNonEmptyString(payload.pageUrl)) {
    errors.push("pageUrl must be a non-empty string");
  }

  if (!Number.isInteger(payload.capturedAt) || payload.capturedAt <= 0) {
    errors.push("capturedAt must be a positive integer timestamp");
  }

  if (!isNonEmptyString(payload.query)) {
    errors.push("query must be a non-empty string");
  }

  if (!Array.isArray(payload.results)) {
    errors.push("results must be an array");
  } else if (payload.results.length === 0) {
    errors.push("results must contain at least one entry");
  } else if (!payload.results.every(isValidResult)) {
    errors.push("results entries are invalid");
  }

  return {
    ok: errors.length === 0,
    errors
  };
}

export function validateBridgeRunPromptPayload(payload) {
  const errors = [];

  if (!payload || typeof payload !== "object") {
    errors.push("payload must be an object");
    return { ok: false, errors };
  }

  if (payload.type !== MSG.BRIDGE_RUN_PROMPT) {
    errors.push("type must be BRIDGE_RUN_PROMPT");
  }

  if (!isNonEmptyString(payload.runId)) {
    errors.push("runId must be a non-empty string");
  }

  if (!Number.isInteger(payload.sourceTabId)) {
    errors.push("sourceTabId must be an integer");
  }

  if (!isNonEmptyString(payload.query)) {
    errors.push("query must be a non-empty string");
  }

  if (!isNonEmptyString(payload.prompt)) {
    errors.push("prompt must be a non-empty string");
  }

  if (!Array.isArray(payload.results)) {
    errors.push("results must be an array");
  } else if (payload.results.length === 0) {
    errors.push("results must contain at least one entry");
  } else if (!payload.results.every(isValidResult)) {
    errors.push("results entries are invalid");
  }

  if (payload.mode != null && typeof payload.mode !== "string") {
    errors.push("mode must be a string when provided");
  }

  return {
    ok: errors.length === 0,
    errors
  };
}

export function validateBridgeResponsePayload(payload) {
  const errors = [];

  if (!payload || typeof payload !== "object") {
    errors.push("payload must be an object");
    return { ok: false, errors };
  }

  if (payload.type !== MSG.BRIDGE_RESPONSE_READY) {
    errors.push("type must be BRIDGE_RESPONSE_READY");
  }

  if (!isNonEmptyString(payload.runId)) {
    errors.push("runId must be a non-empty string");
  }

  if (!Number.isInteger(payload.sourceTabId)) {
    errors.push("sourceTabId must be an integer");
  }

  if (!Number.isInteger(payload.completedAt) || payload.completedAt <= 0) {
    errors.push("completedAt must be a positive integer timestamp");
  }

  if (!payload.response || typeof payload.response !== "object") {
    errors.push("response must be an object");
  } else {
    if (typeof payload.response.text !== "string") {
      errors.push("response.text must be a string");
    }
    if (!Array.isArray(payload.response.sources)) {
      errors.push("response.sources must be an array");
    }
  }

  return {
    ok: errors.length === 0,
    errors
  };
}
