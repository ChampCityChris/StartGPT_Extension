import { MSG } from "../content/shared/message-types.js";
import {
  isPayloadWithinBytes,
  validateApiKeyValidationPayload,
  validateFollowUpPayload,
  validateOptionsSavePayload,
  validateRunRequestPayload,
  validateSetApiKeyPayload,
  validateStartpageContextPayload,
  validateStartpageScriptStatusPayload
} from "../content/shared/schema.js";
import { ALLOWED_MODELS, LIMITS, SUMMARY_MODE } from "./constants.js";

function resolveSourceTabId(message, sender) {
  if (Number.isInteger(message?.sourceTabId)) {
    return message.sourceTabId;
  }
  if (Number.isInteger(sender?.tab?.id)) {
    return sender.tab.id;
  }
  return null;
}

function isStartpageSender(sender) {
  const url = String(sender?.tab?.url || sender?.url || "");
  return url.startsWith("https://startpage.com/") || url.includes("://www.startpage.com/");
}

function isExtensionSender(sender) {
  const url = String(sender?.url || "");
  return url.startsWith("moz-extension://");
}

function validationError(details) {
  return {
    ok: false,
    error: "invalid_payload",
    details
  };
}

function unknownType() {
  return {
    ok: false,
    error: "unknown_type"
  };
}

export async function routeMessage(message, sender) {
  if (!message || typeof message !== "object") {
    return { ok: false, error: "missing_payload" };
  }
  if (!isPayloadWithinBytes(message, LIMITS.MAX_MESSAGE_BYTES)) {
    return { ok: false, error: "payload_too_large" };
  }
  if (typeof message.type !== "string") {
    return { ok: false, error: "missing_type" };
  }

  switch (message.type) {
    case MSG.STARTPAGE_SCRIPT_STATUS: {
      if (!isStartpageSender(sender)) {
        return { ok: false, error: "unauthorized_sender" };
      }
      const validation = validateStartpageScriptStatusPayload(message, LIMITS.MAX_MESSAGE_BYTES);
      if (!validation.ok) {
        return validationError(validation.errors);
      }
      const sourceTabId = resolveSourceTabId(message, sender);
      if (!Number.isInteger(sourceTabId)) {
        return { ok: false, error: "missing_source_tab_id" };
      }
      return {
        ok: true,
        command: "startpage_script_status",
        sourceTabId
      };
    }

    case MSG.STARTPAGE_CONTEXT_FOUND: {
      if (!isStartpageSender(sender)) {
        return { ok: false, error: "unauthorized_sender" };
      }
      const validation = validateStartpageContextPayload(message, {
        maxMessageBytes: LIMITS.MAX_MESSAGE_BYTES,
        maxQueryChars: LIMITS.MAX_QUERY_CHARS,
        maxResultCount: LIMITS.MAX_RESULT_COUNT
      });
      if (!validation.ok) {
        return validationError(validation.errors);
      }
      const sourceTabId = resolveSourceTabId(message, sender);
      if (!Number.isInteger(sourceTabId)) {
        return { ok: false, error: "missing_source_tab_id" };
      }
      return {
        ok: true,
        command: "startpage_context_found",
        sourceTabId
      };
    }

    case MSG.REQUEST_RUN_FOR_TAB: {
      if (!isExtensionSender(sender)) {
        return { ok: false, error: "unauthorized_sender" };
      }
      const validation = validateRunRequestPayload(message);
      if (!validation.ok) {
        return validationError(validation.errors);
      }
      return {
        ok: true,
        command: "request_run",
        sourceTabId: message.sourceTabId,
        summaryMode: typeof message.summaryMode === "string" ? message.summaryMode : null
      };
    }

    case MSG.SIDEBAR_FOLLOW_UP: {
      if (!isExtensionSender(sender)) {
        return { ok: false, error: "unauthorized_sender" };
      }
      const validation = validateFollowUpPayload(message, LIMITS.MAX_FOLLOW_UP_CHARS);
      if (!validation.ok) {
        return validationError(validation.errors);
      }
      return {
        ok: true,
        command: "follow_up",
        sourceTabId: message.sourceTabId,
        followUp: String(message.followUp || "")
      };
    }

    case MSG.SIDEBAR_GET_STATE: {
      return {
        ok: true,
        command: "get_state",
        sourceTabId: Number.isInteger(message?.sourceTabId) ? message.sourceTabId : resolveSourceTabId(message, sender)
      };
    }

    case MSG.OPTIONS_GET_SETTINGS:
      if (!isExtensionSender(sender)) {
        return { ok: false, error: "unauthorized_sender" };
      }
      return {
        ok: true,
        command: "options_get_settings"
      };

    case MSG.OPTIONS_SAVE_SETTINGS: {
      if (!isExtensionSender(sender)) {
        return { ok: false, error: "unauthorized_sender" };
      }
      const validation = validateOptionsSavePayload(message, {
        allowedModels: ALLOWED_MODELS,
        allowedSummaryModes: Object.values(SUMMARY_MODE),
        maxResultsCap: LIMITS.MAX_RESULTS_CAP,
        maxOutputTokensCap: LIMITS.MAX_OUTPUT_TOKENS_CAP,
        timeoutMsCap: LIMITS.REQUEST_TIMEOUT_MS_CAP
      });
      if (!validation.ok) {
        return validationError(validation.errors);
      }
      return {
        ok: true,
        command: "options_save_settings",
        settings: message.settings
      };
    }

    case MSG.OPTIONS_SET_API_KEY: {
      if (!isExtensionSender(sender)) {
        return { ok: false, error: "unauthorized_sender" };
      }
      const validation = validateSetApiKeyPayload(message, LIMITS.MAX_API_KEY_CHARS);
      if (!validation.ok) {
        return validationError(validation.errors);
      }
      return {
        ok: true,
        command: "options_set_api_key",
        apiKey: String(message.apiKey || "")
      };
    }

    case MSG.OPTIONS_DELETE_API_KEY:
      if (!isExtensionSender(sender)) {
        return { ok: false, error: "unauthorized_sender" };
      }
      return {
        ok: true,
        command: "options_delete_api_key"
      };

    case MSG.OPTIONS_VALIDATE_API_KEY: {
      if (!isExtensionSender(sender)) {
        return { ok: false, error: "unauthorized_sender" };
      }
      const validation = validateApiKeyValidationPayload(message, LIMITS.MAX_API_KEY_CHARS);
      if (!validation.ok) {
        return validationError(validation.errors);
      }
      return {
        ok: true,
        command: "options_validate_api_key",
        apiKey: typeof message.apiKey === "string" ? message.apiKey : ""
      };
    }

    default:
      return unknownType();
  }
}
