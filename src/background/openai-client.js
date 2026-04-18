import { LIMITS, OPENAI_DEFAULTS } from "./constants.js";

const TRANSIENT_STATUS_CODES = new Set([500, 502, 503, 504]);
const ALLOWED_TEXT_VERBOSITY = new Set(["low", "medium", "high"]);
const ALLOWED_REASONING_EFFORT = new Set(["none", "minimal", "low", "medium", "high", "xhigh"]);
const OPENAI_RESPONSES_ENDPOINT = "https://api.openai.com/v1/responses";

export class OpenAiClientError extends Error {
  constructor(
    code,
    message,
    {
      recoverable = true,
      retryable = false,
      status = null,
      diagnostics = null
    } = {}
  ) {
    super(message);
    this.name = "OpenAiClientError";
    this.code = code;
    this.recoverable = recoverable;
    this.retryable = retryable;
    this.status = status;
    this.diagnostics = diagnostics && typeof diagnostics === "object" ? diagnostics : null;
  }
}

function delay(ms) {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, ms);
  });
}

function safeParseJson(text) {
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function createAbortController(timeoutMs, externalSignal) {
  const controller = new AbortController();
  const timeoutId = globalThis.setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  const onAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      externalSignal.addEventListener("abort", onAbort, { once: true });
    }
  }

  return {
    signal: controller.signal,
    dispose() {
      globalThis.clearTimeout(timeoutId);
      if (externalSignal) {
        externalSignal.removeEventListener("abort", onAbort);
      }
    }
  };
}

function extractErrorCodeFromBody(errorBody) {
  const code = errorBody?.error?.code;
  return typeof code === "string" ? code.toLowerCase() : "";
}

function mapHttpFailure(status, errorBody) {
  if (status === 401) {
    return new OpenAiClientError(
      "INVALID_API_KEY",
      "OpenAI rejected the API key. Update your key in Settings.",
      { recoverable: true, retryable: false, status }
    );
  }

  if (status === 403) {
    return new OpenAiClientError(
      "OPENAI_FORBIDDEN",
      "OpenAI accepted the key but denied access. Check project/key permissions and model access.",
      { recoverable: true, retryable: false, status }
    );
  }

  if (status === 429) {
    const errorCode = extractErrorCodeFromBody(errorBody);
    if (errorCode.includes("quota") || errorCode.includes("insufficient_quota")) {
      return new OpenAiClientError(
        "QUOTA_EXCEEDED",
        "Your OpenAI account quota appears exhausted.",
        { recoverable: true, retryable: false, status }
      );
    }
    return new OpenAiClientError(
      "RATE_LIMITED",
      "OpenAI rate limited this request. Please retry shortly.",
      { recoverable: true, retryable: true, status }
    );
  }

  if (status === 400 || status === 404) {
    return new OpenAiClientError(
      "OPENAI_REQUEST_REJECTED",
      "OpenAI rejected the request settings. Check model and token limits.",
      { recoverable: true, retryable: false, status }
    );
  }

  if (status === 408) {
    return new OpenAiClientError(
      "OPENAI_TIMEOUT",
      "OpenAI timed out while generating a response.",
      { recoverable: true, retryable: true, status }
    );
  }

  if (TRANSIENT_STATUS_CODES.has(status)) {
    return new OpenAiClientError(
      "OPENAI_SERVER_ERROR",
      "OpenAI is temporarily unavailable.",
      { recoverable: true, retryable: true, status }
    );
  }

  return new OpenAiClientError(
    "OPENAI_REQUEST_FAILED",
    `OpenAI request failed with status ${status}.`,
    { recoverable: true, retryable: false, status }
  );
}

function readTextValue(value) {
  if (typeof value === "string") {
    return value;
  }
  if (value && typeof value === "object" && typeof value.value === "string") {
    return value.value;
  }
  return "";
}

function readUsageOutputTokens(payload) {
  return Number.isInteger(payload?.usage?.output_tokens) ? payload.usage.output_tokens : null;
}

function gatherResponseShapeDiagnostics(payload, responseText = "") {
  const outputItemTypes = [];
  const contentTypes = [];
  const output = Array.isArray(payload?.output) ? payload.output : [];

  for (const item of output) {
    if (typeof item?.type === "string" && !outputItemTypes.includes(item.type)) {
      outputItemTypes.push(item.type);
    }
    if (!Array.isArray(item?.content)) {
      continue;
    }
    for (const content of item.content) {
      if (typeof content?.type === "string" && !contentTypes.includes(content.type)) {
        contentTypes.push(content.type);
      }
    }
  }

  return {
    responseId: typeof payload?.id === "string" ? payload.id : "",
    responseStatus: typeof payload?.status === "string" ? payload.status : "",
    incompleteReason: typeof payload?.incomplete_details?.reason === "string"
      ? payload.incomplete_details.reason
      : "",
    usageOutputTokens: readUsageOutputTokens(payload),
    outputItemCount: output.length,
    outputItemTypes,
    contentTypes,
    hasTopLevelOutputText: payload?.output_text != null,
    parsedJson: Boolean(payload && typeof payload === "object"),
    rawBodyChars: typeof responseText === "string" ? responseText.length : 0
  };
}

function buildNoTextError({ payload, responseText, maxOutputTokens, maxOutputTokensCap }) {
  const responseDiagnostics = gatherResponseShapeDiagnostics(payload, responseText);
  const requestedMaxOutputTokens = Number.isInteger(maxOutputTokens) ? maxOutputTokens : null;
  const normalizedMaxOutputTokensCap = Number.isInteger(maxOutputTokensCap)
    ? maxOutputTokensCap
    : null;
  const diagnostics = {
    ...responseDiagnostics,
    requestedMaxOutputTokens,
    maxOutputTokensCap: normalizedMaxOutputTokensCap
  };
  const observedOutputTokens = Number.isInteger(responseDiagnostics.usageOutputTokens)
    ? responseDiagnostics.usageOutputTokens
    : null;
  const requestLabel = Number.isInteger(requestedMaxOutputTokens) ? requestedMaxOutputTokens : "n/a";
  const capLabel = Number.isInteger(normalizedMaxOutputTokensCap) ? normalizedMaxOutputTokensCap : "n/a";

  if (!payload) {
    return new OpenAiClientError(
      "OPENAI_RESPONSE_NOT_JSON",
      "OpenAI returned a non-JSON response body.",
      { recoverable: true, retryable: false, diagnostics }
    );
  }

  if (diagnostics.responseStatus === "failed") {
    const openAiCode = typeof payload?.error?.code === "string" ? payload.error.code : "unknown";
    return new OpenAiClientError(
      "OPENAI_RESPONSE_FAILED",
      `OpenAI marked the response as failed (code: ${openAiCode}).`,
      { recoverable: true, retryable: false, diagnostics }
    );
  }

  if (diagnostics.responseStatus === "incomplete") {
    const reason = diagnostics.incompleteReason || "unknown";
    if (reason === "max_output_tokens") {
      if (Number.isInteger(observedOutputTokens)) {
        return new OpenAiClientError(
          "OPENAI_INCOMPLETE_MAX_OUTPUT_TOKENS",
          `OpenAI stopped before visible output (reason: max_output_tokens with usage.output_tokens ${observedOutputTokens}, run cap ${capLabel}, request max_output_tokens ${requestLabel}).`,
          { recoverable: true, retryable: true, diagnostics }
        );
      }
      return new OpenAiClientError(
        "OPENAI_INCOMPLETE_MAX_OUTPUT_TOKENS",
        `OpenAI stopped before visible output (reason: max_output_tokens at ${requestLabel} tokens for this attempt, run cap ${capLabel}).`,
        { recoverable: true, retryable: true, diagnostics }
      );
    }
    return new OpenAiClientError(
      "OPENAI_INCOMPLETE_RESPONSE",
      `OpenAI returned an incomplete response before visible output (reason: ${reason}).`,
      { recoverable: true, retryable: false, diagnostics }
    );
  }

  if (diagnostics.outputItemCount > 0) {
    return new OpenAiClientError(
      "OPENAI_NO_VISIBLE_TEXT",
      "OpenAI returned output items but no visible text content.",
      { recoverable: true, retryable: false, diagnostics }
    );
  }

  return new OpenAiClientError(
    "EMPTY_RESPONSE",
    "OpenAI returned an empty response.",
    { recoverable: true, retryable: false, diagnostics }
  );
}

function extractResponseText(payload) {
  if (typeof payload?.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
  }
  if (Array.isArray(payload?.output_text)) {
    const outputText = payload.output_text
      .filter((value) => typeof value === "string")
      .join("\n")
      .trim();
    if (outputText) {
      return outputText;
    }
  }

  if (!Array.isArray(payload?.output)) {
    return "";
  }

  const chunks = [];
  for (const item of payload.output) {
    if (typeof item?.refusal === "string" && item.refusal.trim()) {
      chunks.push(item.refusal);
    }
    if (item?.type === "reasoning" && Array.isArray(item?.summary)) {
      for (const summary of item.summary) {
        const summaryText = readTextValue(summary?.text);
        if (summaryText.trim()) {
          chunks.push(summaryText);
        }
      }
    }
    if (!Array.isArray(item?.content)) {
      continue;
    }
    for (const content of item.content) {
      if (content?.type === "output_text" || content?.type === "text") {
        const value = readTextValue(content?.text);
        if (value.trim()) {
          chunks.push(value);
        }
      } else if (content?.type === "refusal") {
        const refusalText = readTextValue(content?.refusal) || readTextValue(content?.text);
        if (refusalText.trim()) {
          chunks.push(refusalText);
        }
      }
    }
  }

  return chunks.join("\n").trim();
}

function extractUsage(payload) {
  if (!payload?.usage || typeof payload.usage !== "object") {
    return null;
  }

  const outputTokenDetails = payload.usage.output_tokens_details;
  return {
    inputTokens: Number.isInteger(payload.usage.input_tokens) ? payload.usage.input_tokens : null,
    outputTokens: Number.isInteger(payload.usage.output_tokens) ? payload.usage.output_tokens : null,
    totalTokens: Number.isInteger(payload.usage.total_tokens) ? payload.usage.total_tokens : null,
    reasoningTokens: Number.isInteger(outputTokenDetails?.reasoning_tokens)
      ? outputTokenDetails.reasoning_tokens
      : null
  };
}

function normalizeUnknownFailure(error) {
  if (error instanceof OpenAiClientError) {
    return error;
  }

  if (error instanceof DOMException && error.name === "AbortError") {
    return new OpenAiClientError(
      "OPENAI_TIMEOUT",
      "OpenAI request timed out.",
      { recoverable: true, retryable: true }
    );
  }

  if (error instanceof TypeError) {
    return new OpenAiClientError(
      "NETWORK_ERROR",
      "Network error while contacting OpenAI.",
      { recoverable: true, retryable: true }
    );
  }

  return new OpenAiClientError(
    "OPENAI_REQUEST_FAILED",
    "Unexpected failure while contacting OpenAI.",
    { recoverable: true, retryable: false }
  );
}

export function normalizeClientError(error) {
  const normalized = normalizeUnknownFailure(error);
  const safe = {
    code: normalized.code,
    message: normalized.message,
    recoverable: normalized.recoverable
  };
  if (normalized.diagnostics && typeof normalized.diagnostics === "object") {
    safe.diagnostics = JSON.parse(JSON.stringify(normalized.diagnostics));
  }
  return safe;
}

export async function validateApiKeyCandidate(
  apiKey,
  model,
  timeoutMs = OPENAI_DEFAULTS.defaultTimeoutMs
) {
  const trimmedKey = String(apiKey || "").trim();
  const trimmedModel = String(model || "").trim();
  if (!trimmedKey) {
    return {
      ok: false,
      error: {
        code: "INVALID_API_KEY",
        message: "API key cannot be empty."
      }
    };
  }
  if (!trimmedModel) {
    return {
      ok: false,
      error: {
        code: "OPENAI_REQUEST_REJECTED",
        message: "Model is required for API key validation."
      }
    };
  }

  const scopedAbort = createAbortController(timeoutMs, null);
  try {
    const response = await fetch(OPENAI_RESPONSES_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${trimmedKey}`
      },
      body: JSON.stringify({
        model: trimmedModel,
        input: "StartGPT API key validation ping.",
        max_output_tokens: 32
      }),
      signal: scopedAbort.signal
    });

    if (!response.ok) {
      const text = await response.text();
      const errorBody = safeParseJson(text);
      const mapped = mapHttpFailure(response.status, errorBody);
      return {
        ok: false,
        error: normalizeClientError(mapped)
      };
    }

    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: normalizeClientError(error)
    };
  } finally {
    scopedAbort.dispose();
  }
}

export async function requestOpenAiSummary({
  apiKey,
  model,
  prompt,
  instructions = "",
  textVerbosity = "",
  reasoningEffort = "",
  maxOutputTokens,
  maxOutputTokensCap = LIMITS.MAX_OUTPUT_TOKENS_CAP,
  timeoutMs,
  signal
}) {
  const trimmedKey = String(apiKey || "").trim();
  if (!trimmedKey) {
    throw new OpenAiClientError(
      "MISSING_API_KEY",
      "No OpenAI API key is stored.",
      { recoverable: true, retryable: false }
    );
  }
  const trimmedInstructions = String(instructions || "").trim();
  const normalizedTextVerbosity = String(textVerbosity || "").trim().toLowerCase();
  const normalizedReasoningEffort = String(reasoningEffort || "").trim().toLowerCase();
  const normalizedMaxOutputTokensCap = Math.max(
    32,
    Number.isInteger(maxOutputTokensCap) ? maxOutputTokensCap : LIMITS.MAX_OUTPUT_TOKENS_CAP
  );

  let requestMaxOutputTokens = Math.max(
    32,
    Math.min(
      normalizedMaxOutputTokensCap,
      Number.isInteger(maxOutputTokens) ? maxOutputTokens : 32
    )
  );

  const maxAttempts = 2;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const scopedAbort = createAbortController(timeoutMs, signal);
    try {
      const requestBody = {
        model,
        input: prompt,
        max_output_tokens: requestMaxOutputTokens
      };
      if (trimmedInstructions) {
        requestBody.instructions = trimmedInstructions;
      }
      if (ALLOWED_TEXT_VERBOSITY.has(normalizedTextVerbosity)) {
        requestBody.text = { verbosity: normalizedTextVerbosity };
      }
      if (ALLOWED_REASONING_EFFORT.has(normalizedReasoningEffort)) {
        requestBody.reasoning = { effort: normalizedReasoningEffort };
      }
      const response = await fetch(OPENAI_RESPONSES_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${trimmedKey}`
        },
        body: JSON.stringify(requestBody),
        signal: scopedAbort.signal
      });

      const text = await response.text();
      const parsed = safeParseJson(text);

      if (!response.ok) {
        throw mapHttpFailure(response.status, parsed);
      }

      const outputText = extractResponseText(parsed);
      if (!outputText) {
        throw buildNoTextError({
          payload: parsed,
          responseText: text,
          maxOutputTokens: requestMaxOutputTokens,
          maxOutputTokensCap: normalizedMaxOutputTokensCap
        });
      }

      return {
        text: outputText,
        responseId: typeof parsed?.id === "string" ? parsed.id : "",
        modelSnapshot: typeof parsed?.model === "string" && parsed.model.trim()
          ? parsed.model.trim()
          : String(model || "").trim(),
        retryCount: Math.max(0, attempt - 1),
        attemptedMaxOutputTokens: requestMaxOutputTokens,
        maxOutputTokensCap: normalizedMaxOutputTokensCap,
        usage: extractUsage(parsed)
      };
    } catch (error) {
      const normalized = normalizeUnknownFailure(error);
      if (
        normalized.code === "OPENAI_INCOMPLETE_MAX_OUTPUT_TOKENS"
        && attempt < maxAttempts
      ) {
        const observedOutputTokens = Number.isInteger(normalized?.diagnostics?.usageOutputTokens)
          ? normalized.diagnostics.usageOutputTokens
          : null;
        const capReachedByUsageOutputTokens = Number.isInteger(observedOutputTokens)
          && observedOutputTokens >= normalizedMaxOutputTokensCap;
        if (capReachedByUsageOutputTokens) {
          normalized.retryable = false;
          normalized.diagnostics = {
            ...(normalized.diagnostics || {}),
            retryPlanned: false,
            retryBlockedByCap: true
          };
        } else {
          const boostedTokens = Math.min(
            normalizedMaxOutputTokensCap,
            Math.max(requestMaxOutputTokens + 200, Math.ceil(requestMaxOutputTokens * 2))
          );
          if (boostedTokens > requestMaxOutputTokens) {
            requestMaxOutputTokens = boostedTokens;
            normalized.diagnostics = {
              ...(normalized.diagnostics || {}),
              retryPlanned: true,
              retryMaxOutputTokens: boostedTokens
            };
          } else {
            normalized.retryable = false;
          }
        }
      }
      const canRetry = normalized.retryable && attempt < maxAttempts;
      if (!canRetry) {
        throw normalized;
      }
      await delay(350 * attempt);
    } finally {
      scopedAbort.dispose();
    }
  }

  throw new OpenAiClientError(
    "OPENAI_REQUEST_FAILED",
    "OpenAI request failed after retries.",
    { recoverable: true, retryable: false }
  );
}
