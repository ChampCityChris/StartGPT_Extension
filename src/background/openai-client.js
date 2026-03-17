import { OPENAI_DEFAULTS } from "./constants.js";

const TRANSIENT_STATUS_CODES = new Set([500, 502, 503, 504]);
const OPENAI_RESPONSES_ENDPOINT = "https://api.openai.com/v1/responses";
const OPENAI_VALIDATION_ENDPOINT = "https://api.openai.com/v1/models";

export class OpenAiClientError extends Error {
  constructor(code, message, { recoverable = true, retryable = false, status = null } = {}) {
    super(message);
    this.name = "OpenAiClientError";
    this.code = code;
    this.recoverable = recoverable;
    this.retryable = retryable;
    this.status = status;
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

function extractResponseText(payload) {
  if (typeof payload?.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
  }

  if (!Array.isArray(payload?.output)) {
    return "";
  }

  const chunks = [];
  for (const item of payload.output) {
    if (!Array.isArray(item?.content)) {
      continue;
    }
    for (const content of item.content) {
      if (content?.type === "output_text" && typeof content?.text === "string") {
        chunks.push(content.text);
      } else if (content?.type === "text" && typeof content?.text === "string") {
        chunks.push(content.text);
      }
    }
  }

  return chunks.join("\n").trim();
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
  return {
    code: normalized.code,
    message: normalized.message,
    recoverable: normalized.recoverable
  };
}

export async function validateApiKeyCandidate(apiKey, timeoutMs = OPENAI_DEFAULTS.defaultTimeoutMs) {
  const trimmedKey = String(apiKey || "").trim();
  if (!trimmedKey) {
    return {
      ok: false,
      error: {
        code: "INVALID_API_KEY",
        message: "API key cannot be empty."
      }
    };
  }

  const scopedAbort = createAbortController(timeoutMs, null);
  try {
    const response = await fetch(OPENAI_VALIDATION_ENDPOINT, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${trimmedKey}`
      },
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
  maxOutputTokens,
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

  const requestBody = {
    model,
    input: prompt,
    max_output_tokens: maxOutputTokens
  };

  const maxAttempts = 2;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const scopedAbort = createAbortController(timeoutMs, signal);
    try {
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
        throw new OpenAiClientError(
          "EMPTY_RESPONSE",
          "OpenAI returned an empty response.",
          { recoverable: true, retryable: false }
        );
      }

      return {
        text: outputText,
        responseId: typeof parsed?.id === "string" ? parsed.id : "",
        usage: parsed?.usage && typeof parsed.usage === "object"
          ? {
            inputTokens: Number.isInteger(parsed.usage.input_tokens) ? parsed.usage.input_tokens : null,
            outputTokens: Number.isInteger(parsed.usage.output_tokens) ? parsed.usage.output_tokens : null,
            totalTokens: Number.isInteger(parsed.usage.total_tokens) ? parsed.usage.total_tokens : null
          }
          : null
      };
    } catch (error) {
      const normalized = normalizeUnknownFailure(error);
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
