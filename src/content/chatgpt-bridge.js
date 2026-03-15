import {
  findAssistantMessageNodes,
  findComposer,
  findComposerForm,
  findComposerWithDiagnostics,
  getLatestAssistantMessageNode,
  hasStreamingIndicator,
  findLoginHint,
  findLoginHintWithDiagnostics,
  findSendButton,
  findSendButtonWithDiagnostics,
  findStreamingIndicatorWithDiagnostics
} from "./dom/chatgpt-selectors.js";
import { extractChatgptResponse } from "./dom/extract-chatgpt-response.js";
import { MSG } from "./shared/message-types.js";
import {
  RUN_TIMELINE_EVENT,
  appendRunTimelineEvent,
  createRunTimeline
} from "./shared/run-timeline.js";
import { validateBridgeRunPromptPayload } from "./shared/schema.js";

const BRIDGE_ERROR = {
  NOT_LOGGED_IN: "CHATGPT_NOT_LOGGED_IN",
  COMPOSER_NOT_FOUND: "CHATGPT_COMPOSER_NOT_FOUND",
  SUBMIT_FAILED: "CHATGPT_SEND_FAILED",
  RESPONSE_START_TIMEOUT: "CHATGPT_RESPONSE_TIMEOUT",
  RESPONSE_COMPLETE_TIMEOUT: "CHATGPT_RESPONSE_TIMEOUT",
  RESPONSE_PARSE_FAILED: "CHATGPT_RESPONSE_PARSE_FAILED"
};

const WAIT = {
  PRE_SUBMIT_IDLE_TIMEOUT_MS: 30000,
  START_TIMEOUT_MS: 30000,
  COMPLETE_TIMEOUT_MS: 120000,
  POLL_INTERVAL_MS: 500,
  START_RETRY_ATTEMPTS: 1,
  RETRY_DELAY_MS: 800,
  SEND_BUTTON_READY_TIMEOUT_MS: 1200,
  SEND_BUTTON_READY_POLL_INTERVAL_MS: 50,
  SUBMIT_ACK_TIMEOUT_MS: 5000,
  COMPLETE_STABLE_MS: 3500
};

export const SUBMIT_PATH = {
  SEND_BUTTON_CLICK: "send_button_click",
  SEND_BUTTON_CLICK_AFTER_WAIT: "send_button_click_after_wait",
  FORM_REQUEST_SUBMIT: "form_request_submit",
  FORM_SUBMIT_EVENT: "form_submit_event",
  TEXTAREA_ENTER_KEY: "textarea_enter_key",
  NONE: "none"
};

export const ACK_REASON = {
  STREAMING_INDICATOR_VISIBLE: "streaming_indicator_visible",
  ASSISTANT_MESSAGE_COUNT_INCREASED: "assistant_message_count_increased",
  SEND_BUTTON_DISABLED: "send_button_disabled",
  COMPOSER_CLEARED: "composer_cleared",
  SEND_BUTTON_MISSING: "send_button_missing",
  SEND_BUTTON_STILL_READY: "send_button_still_ready",
  NO_ACK_SIGNAL: "no_ack_signal"
};

export const RESPONSE_START_REASON = {
  STREAMING_INDICATOR_VISIBLE: "streaming_indicator_visible",
  ASSISTANT_MESSAGE_COUNT_INCREASED: "assistant_message_count_increased",
  NEW_ASSISTANT_NODE_WITH_TEXT: "new_assistant_node_with_text",
  LATEST_ASSISTANT_TEXT_CHANGED: "latest_assistant_text_changed",
  TIMEOUT: "timeout"
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isLikelyLoggedIn(doc = document) {
  if (findLoginHint(doc)) {
    return false;
  }

  return Boolean(findComposer(doc));
}

function collectSelectorDiagnostics(doc = document) {
  const composer = findComposerWithDiagnostics(doc);
  const sendButton = findSendButtonWithDiagnostics(doc);
  const loginHint = findLoginHintWithDiagnostics(doc);
  const streamingIndicator = findStreamingIndicatorWithDiagnostics(doc);

  return {
    composer: {
      matched: composer.matched,
      selector: composer.selector
    },
    sendButton: {
      matched: Boolean(sendButton.node),
      selector: sendButton.selector
    },
    loginHint: {
      matched: loginHint.matched,
      selector: loginHint.selector
    },
    streamingIndicator: {
      matched: streamingIndicator.matched,
      selector: streamingIndicator.selector
    },
    assistantMessageCount: findAssistantMessageNodes(doc).length
  };
}

function getSendButtonState(doc = document) {
  const sendButton = findSendButton(doc);
  const present = Boolean(sendButton);
  const ready = Boolean(
    sendButton &&
    !sendButton.disabled &&
    sendButton.getAttribute("aria-disabled") !== "true"
  );

  return {
    sendButton,
    present,
    ready
  };
}

function createSubmissionBaseline(doc = document) {
  const sendButtonState = getSendButtonState(doc);
  const extracted = extractChatgptResponse(doc);
  return {
    streamingVisibleBeforeSubmit: hasStreamingIndicator(doc),
    sendButtonReadyBeforeSubmit: sendButtonState.ready,
    sendButtonPresentBeforeSubmit: sendButtonState.present,
    latestAssistantTextBeforeSubmit: extracted.text || ""
  };
}

function injectPromptText(composer, text) {
  const prompt = String(text || "");

  if (composer.isContentEditable || composer.getAttribute("contenteditable") === "true") {
    composer.focus();

    const selection = document.getSelection?.();
    if (selection) {
      const range = document.createRange();
      range.selectNodeContents(composer);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
    }

    const inserted = typeof document.execCommand === "function"
      ? document.execCommand("insertText", false, prompt)
      : false;

    if (!inserted) {
      composer.textContent = prompt;
    }

    composer.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      data: prompt,
      inputType: "insertText"
    }));
    composer.dispatchEvent(new Event("change", { bubbles: true }));
    return;
  }

  if ("value" in composer) {
    composer.focus();
    const valueSetter = Object.getOwnPropertyDescriptor(
      globalThis.HTMLTextAreaElement?.prototype || {},
      "value"
    )?.set;
    if (typeof valueSetter === "function") {
      valueSetter.call(composer, prompt);
    } else {
      composer.value = prompt;
    }
    composer.dispatchEvent(new Event("input", { bubbles: true }));
    composer.dispatchEvent(new Event("change", { bubbles: true }));
    return;
  }

  composer.focus();
  composer.textContent = prompt;
  composer.dispatchEvent(new InputEvent("input", { bubbles: true, data: prompt, inputType: "insertText" }));
}

async function waitForSendButtonReady(doc = document, timeoutMs = WAIT.SEND_BUTTON_READY_TIMEOUT_MS) {
  const startedAt = Date.now();
  let latestState = getSendButtonState(doc);

  if (latestState.ready) {
    return {
      ...latestState,
      waitedMs: 0
    };
  }

  while (Date.now() - startedAt < timeoutMs) {
    await sleep(WAIT.SEND_BUTTON_READY_POLL_INTERVAL_MS);
    latestState = getSendButtonState(doc);
    if (latestState.ready) {
      return {
        ...latestState,
        waitedMs: Date.now() - startedAt
      };
    }
  }

  return {
    ...latestState,
    waitedMs: Date.now() - startedAt
  };
}

async function submitPrompt(doc, composer) {
  const initialSendButtonState = getSendButtonState(doc);
  if (initialSendButtonState.ready) {
    initialSendButtonState.sendButton.click();
    return {
      ok: true,
      submitPath: SUBMIT_PATH.SEND_BUTTON_CLICK,
      waitedForButtonMs: 0,
      sendButtonPresent: true
    };
  }

  const waitedSendButtonState = await waitForSendButtonReady(doc);
  if (waitedSendButtonState.ready) {
    waitedSendButtonState.sendButton.click();
    return {
      ok: true,
      submitPath: waitedSendButtonState.waitedMs > 0
        ? SUBMIT_PATH.SEND_BUTTON_CLICK_AFTER_WAIT
        : SUBMIT_PATH.SEND_BUTTON_CLICK,
      waitedForButtonMs: waitedSendButtonState.waitedMs,
      sendButtonPresent: true
    };
  }

  const form = findComposerForm(composer);
  if (form) {
    if (typeof form.requestSubmit === "function") {
      form.requestSubmit();
      return {
        ok: true,
        submitPath: SUBMIT_PATH.FORM_REQUEST_SUBMIT,
        waitedForButtonMs: waitedSendButtonState.waitedMs || 0,
        sendButtonPresent: waitedSendButtonState.present
      };
    }

    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    return {
        ok: true,
        submitPath: SUBMIT_PATH.FORM_SUBMIT_EVENT,
        waitedForButtonMs: waitedSendButtonState.waitedMs || 0,
        sendButtonPresent: waitedSendButtonState.present
      };
  }

  if (composer.tagName?.toLowerCase() === "textarea") {
    const enterDown = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "Enter",
      code: "Enter"
    });
    const enterUp = new KeyboardEvent("keyup", {
      bubbles: true,
      cancelable: true,
      key: "Enter",
      code: "Enter"
    });
    composer.dispatchEvent(enterDown);
    composer.dispatchEvent(enterUp);
    return {
      ok: true,
      submitPath: SUBMIT_PATH.TEXTAREA_ENTER_KEY,
      waitedForButtonMs: waitedSendButtonState.waitedMs || 0,
      sendButtonPresent: waitedSendButtonState.present
    };
  }

  return {
    ok: false,
    submitPath: SUBMIT_PATH.NONE,
    waitedForButtonMs: waitedSendButtonState.waitedMs || 0,
    sendButtonPresent: waitedSendButtonState.present
  };
}

function bridgeFailure(code, message, debug = {}, timeline = null) {
  return {
    ok: false,
    code,
    message,
    recoverable: true,
    debug: timeline
      ? {
        ...debug,
        timeline
      }
      : debug
  };
}

function getComposerCurrentText(composer) {
  if (!composer) {
    return "";
  }

  if ("value" in composer && typeof composer.value === "string") {
    return composer.value;
  }

  return String(composer.textContent || "");
}

function isSendButtonReady(doc = document) {
  return getSendButtonState(doc).ready;
}

export function buildBridgePingResponse() {
  return {
    ok: true,
    type: MSG.BRIDGE_PING,
    ready: true,
    loggedIn: isLikelyLoggedIn(document),
    hasComposer: Boolean(findComposer(document))
  };
}

export function getResponseStartState(initialAssistantCount, initialAssistantNode, doc = document, submissionBaseline = {}) {
  const assistantCount = findAssistantMessageNodes(doc).length;
  const extracted = extractChatgptResponse(doc);
  const latestAssistantNode = getLatestAssistantMessageNode(doc);

  if (hasStreamingIndicator(doc) && !submissionBaseline.streamingVisibleBeforeSubmit) {
    return {
      started: true,
      reason: RESPONSE_START_REASON.STREAMING_INDICATOR_VISIBLE
    };
  }

  if (assistantCount > initialAssistantCount) {
    return {
      started: true,
      reason: RESPONSE_START_REASON.ASSISTANT_MESSAGE_COUNT_INCREASED
    };
  }

  if (latestAssistantNode && latestAssistantNode !== initialAssistantNode && extracted.hasStarted) {
    return {
      started: true,
      reason: RESPONSE_START_REASON.NEW_ASSISTANT_NODE_WITH_TEXT
    };
  }

  if (
    extracted.hasStarted &&
    typeof submissionBaseline.latestAssistantTextBeforeSubmit === "string" &&
    extracted.text !== submissionBaseline.latestAssistantTextBeforeSubmit
  ) {
    return {
      started: true,
      reason: RESPONSE_START_REASON.LATEST_ASSISTANT_TEXT_CHANGED
    };
  }

  return {
    started: false,
    reason: RESPONSE_START_REASON.TIMEOUT
  };
}

async function waitForResponseStart(initialAssistantCount, initialAssistantNode, submissionBaseline, onProgress = null) {
  const startAt = Date.now();
  let lastProgressSecond = -1;

  while (Date.now() - startAt < WAIT.START_TIMEOUT_MS) {
    const elapsedSeconds = Math.max(0, Math.floor((Date.now() - startAt) / 1000));
    const responseStartState = getResponseStartState(
      initialAssistantCount,
      initialAssistantNode,
      document,
      submissionBaseline
    );

    if (responseStartState.started) {
      return {
        ok: true,
        responseStartReason: responseStartState.reason
      };
    }

    if (typeof onProgress === "function" && elapsedSeconds !== lastProgressSecond && elapsedSeconds % 2 === 0) {
      lastProgressSecond = elapsedSeconds;
      onProgress(`Waiting for ChatGPT to start responding (${elapsedSeconds}s).`);
    }

    await sleep(WAIT.POLL_INTERVAL_MS);
  }

  return {
    ok: false,
    responseStartReason: RESPONSE_START_REASON.TIMEOUT
  };
}

async function waitForResponseComplete(onProgress = null) {
  const startAt = Date.now();
  let lastProgressSecond = -1;
  let lastText = "";
  let lastTextChangeAt = Date.now();

  while (Date.now() - startAt < WAIT.COMPLETE_TIMEOUT_MS) {
    const extracted = extractChatgptResponse(document);
    const elapsedSeconds = Math.max(0, Math.floor((Date.now() - startAt) / 1000));
    const currentText = extracted.text || "";

    if (typeof onProgress === "function" && elapsedSeconds !== lastProgressSecond && elapsedSeconds % 2 === 0) {
      lastProgressSecond = elapsedSeconds;
      onProgress(`ChatGPT response streaming (${elapsedSeconds}s).`);
    }

    if (currentText !== lastText) {
      lastText = currentText;
      lastTextChangeAt = Date.now();
    }

    if (extracted.isComplete) {
      return extracted;
    }

    const streaming = hasStreamingIndicator(document);
    if (currentText && !streaming && isSendButtonReady(document)) {
      return extracted;
    }

    if (currentText && Date.now() - lastTextChangeAt >= WAIT.COMPLETE_STABLE_MS) {
      return extracted;
    }

    await sleep(WAIT.POLL_INTERVAL_MS);
  }

  return null;
}

export function getSubmitAcknowledgementState(
  composer,
  baselineComposerText,
  initialAssistantCount,
  doc = document,
  submissionBaseline = {}
) {
  const composerText = getComposerCurrentText(composer);
  const streaming = hasStreamingIndicator(doc);
  const sendButtonState = getSendButtonState(doc);
  const assistantCount = findAssistantMessageNodes(doc).length;
  const baselineTrimmed = String(baselineComposerText || "").trim();
  const composerTrimmed = composerText.trim();

  if (streaming && !submissionBaseline.streamingVisibleBeforeSubmit) {
    return {
      acknowledged: true,
      ackReason: ACK_REASON.STREAMING_INDICATOR_VISIBLE
    };
  }

  if (assistantCount > initialAssistantCount) {
    return {
      acknowledged: true,
      ackReason: ACK_REASON.ASSISTANT_MESSAGE_COUNT_INCREASED
    };
  }

  if (
    sendButtonState.present &&
    !sendButtonState.ready &&
    (submissionBaseline.sendButtonReadyBeforeSubmit || !submissionBaseline.sendButtonPresentBeforeSubmit)
  ) {
    return {
      acknowledged: true,
      ackReason: ACK_REASON.SEND_BUTTON_DISABLED
    };
  }

  if (baselineTrimmed && composerTrimmed.length === 0) {
    return {
      acknowledged: true,
      ackReason: ACK_REASON.COMPOSER_CLEARED
    };
  }

  return {
    acknowledged: false,
    ackReason: sendButtonState.present
      ? ACK_REASON.SEND_BUTTON_STILL_READY
      : ACK_REASON.SEND_BUTTON_MISSING
  };
}

async function waitForSubmitAcknowledged(
  composer,
  baselineComposerText,
  initialAssistantCount,
  submissionBaseline,
  onProgress = null
) {
  const startAt = Date.now();
  let lastProgressSecond = -1;

  while (Date.now() - startAt < WAIT.SUBMIT_ACK_TIMEOUT_MS) {
    const elapsedSeconds = Math.max(0, Math.floor((Date.now() - startAt) / 1000));
    const acknowledgementState = getSubmitAcknowledgementState(
      composer,
      baselineComposerText,
      initialAssistantCount,
      document,
      submissionBaseline
    );

    if (acknowledgementState.acknowledged) {
      return {
        ok: true,
        ackReason: acknowledgementState.ackReason
      };
    }

    if (typeof onProgress === "function" && elapsedSeconds !== lastProgressSecond) {
      lastProgressSecond = elapsedSeconds;
      onProgress(`Waiting for ChatGPT submit acknowledgement (${elapsedSeconds}s).`);
    }

    await sleep(WAIT.POLL_INTERVAL_MS);
  }

  const finalState = getSubmitAcknowledgementState(
    composer,
    baselineComposerText,
    initialAssistantCount,
    document,
    submissionBaseline
  );
  return {
    ok: false,
    ackReason: finalState.ackReason || ACK_REASON.NO_ACK_SIGNAL
  };
}

async function waitForBridgeIdleBeforeSubmit(onProgress = null) {
  if (!hasStreamingIndicator(document)) {
    return {
      ok: true,
      preexistingStreamingDetected: false,
      waitedForIdleMs: 0
    };
  }

  const startedAt = Date.now();
  let lastProgressSecond = -1;

  while (Date.now() - startedAt < WAIT.PRE_SUBMIT_IDLE_TIMEOUT_MS) {
    const elapsedSeconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
    if (!hasStreamingIndicator(document)) {
      return {
        ok: true,
        preexistingStreamingDetected: true,
        waitedForIdleMs: Date.now() - startedAt
      };
    }

    if (typeof onProgress === "function" && elapsedSeconds !== lastProgressSecond && elapsedSeconds % 2 === 0) {
      lastProgressSecond = elapsedSeconds;
      onProgress(`Waiting for previous ChatGPT response to finish (${elapsedSeconds}s).`);
    }

    await sleep(WAIT.POLL_INTERVAL_MS);
  }

  return {
    ok: false,
    preexistingStreamingDetected: true,
    waitedForIdleMs: Date.now() - startedAt
  };
}

async function attemptPromptSubmission(
  composer,
  prompt,
  initialAssistantCount,
  initialAssistantNode,
  attemptIndex = 0,
  onProgress = null,
  onTimelineEvent = null
) {
  const idleWait = await waitForBridgeIdleBeforeSubmit(onProgress);
  if (!idleWait.ok) {
    return {
      ok: false,
      code: BRIDGE_ERROR.SUBMIT_FAILED,
      message: "ChatGPT was still finishing a previous response.",
      submitPath: SUBMIT_PATH.NONE,
      waitedForButtonMs: 0,
      sendButtonPresent: getSendButtonState(document).present,
      preexistingStreamingDetected: idleWait.preexistingStreamingDetected,
      waitedForIdleMs: idleWait.waitedForIdleMs,
      ackReason: ACK_REASON.NO_ACK_SIGNAL,
      responseStartReason: RESPONSE_START_REASON.TIMEOUT
    };
  }

  const baselineComposerText = getComposerCurrentText(composer);
  const submissionBaseline = createSubmissionBaseline(document);
  injectPromptText(composer, prompt);
  const submitResult = await submitPrompt(document, composer);
  if (typeof onTimelineEvent === "function") {
    onTimelineEvent(
      RUN_TIMELINE_EVENT.BRIDGE_SUBMIT_STARTED,
      `attempt=${attemptIndex + 1} path=${submitResult.submitPath} waitMs=${submitResult.waitedForButtonMs || 0} idleWaitMs=${idleWait.waitedForIdleMs || 0} preexistingStreaming=${idleWait.preexistingStreamingDetected ? "yes" : "no"} buttonPresent=${submitResult.sendButtonPresent ? "yes" : "no"}`
    );
  }
  if (!submitResult.ok) {
    return {
      ok: false,
      code: BRIDGE_ERROR.SUBMIT_FAILED,
      message: "Unable to trigger ChatGPT submit action.",
      submitPath: submitResult.submitPath,
      waitedForButtonMs: submitResult.waitedForButtonMs || 0,
      sendButtonPresent: Boolean(submitResult.sendButtonPresent),
      preexistingStreamingDetected: idleWait.preexistingStreamingDetected,
      waitedForIdleMs: idleWait.waitedForIdleMs,
      ackReason: ACK_REASON.NO_ACK_SIGNAL,
      responseStartReason: RESPONSE_START_REASON.TIMEOUT
    };
  }

  if (typeof onTimelineEvent === "function") {
    onTimelineEvent(
      RUN_TIMELINE_EVENT.BRIDGE_SUBMIT_ACK_WAIT_STARTED,
      `attempt=${attemptIndex + 1} path=${submitResult.submitPath} waitMs=${submitResult.waitedForButtonMs || 0}`
    );
  }
  const submitAcknowledged = await waitForSubmitAcknowledged(
    composer,
    baselineComposerText,
    initialAssistantCount,
    submissionBaseline,
    onProgress
  );
  if (!submitAcknowledged.ok) {
    return {
      ok: false,
      code: BRIDGE_ERROR.SUBMIT_FAILED,
      message: "Prompt submit did not change ChatGPT UI state.",
      submitPath: submitResult.submitPath,
      waitedForButtonMs: submitResult.waitedForButtonMs || 0,
      sendButtonPresent: Boolean(submitResult.sendButtonPresent),
      preexistingStreamingDetected: idleWait.preexistingStreamingDetected,
      waitedForIdleMs: idleWait.waitedForIdleMs,
      ackReason: submitAcknowledged.ackReason,
      responseStartReason: RESPONSE_START_REASON.TIMEOUT
    };
  }

  if (typeof onTimelineEvent === "function") {
    onTimelineEvent(
      RUN_TIMELINE_EVENT.BRIDGE_SUBMIT_ACKNOWLEDGED,
      `attempt=${attemptIndex + 1} path=${submitResult.submitPath} waitMs=${submitResult.waitedForButtonMs || 0} ackReason=${submitAcknowledged.ackReason}`
    );
    onTimelineEvent(
      RUN_TIMELINE_EVENT.BRIDGE_RESPONSE_START_WAIT_STARTED,
      `attempt=${attemptIndex + 1} path=${submitResult.submitPath}`
    );
  }
  const started = await waitForResponseStart(
    initialAssistantCount,
    initialAssistantNode,
    submissionBaseline,
    onProgress
  );
  if (!started.ok) {
    return {
      ok: false,
      code: BRIDGE_ERROR.RESPONSE_START_TIMEOUT,
      message: "Assistant response did not start in time.",
      submitPath: submitResult.submitPath,
      waitedForButtonMs: submitResult.waitedForButtonMs || 0,
      sendButtonPresent: Boolean(submitResult.sendButtonPresent),
      preexistingStreamingDetected: idleWait.preexistingStreamingDetected,
      waitedForIdleMs: idleWait.waitedForIdleMs,
      ackReason: submitAcknowledged.ackReason,
      responseStartReason: started.responseStartReason
    };
  }

  if (typeof onTimelineEvent === "function") {
    onTimelineEvent(
      RUN_TIMELINE_EVENT.BRIDGE_RESPONSE_STARTED,
      `attempt=${attemptIndex + 1} path=${submitResult.submitPath} reason=${started.responseStartReason}`
    );
  }
  return {
    ok: true,
    submitPath: submitResult.submitPath,
    waitedForButtonMs: submitResult.waitedForButtonMs || 0,
    sendButtonPresent: Boolean(submitResult.sendButtonPresent),
    preexistingStreamingDetected: idleWait.preexistingStreamingDetected,
    waitedForIdleMs: idleWait.waitedForIdleMs,
    ackReason: submitAcknowledged.ackReason,
    responseStartReason: started.responseStartReason
  };
}

export async function runBridgePrompt(message, options = {}) {
  const reportProgress = typeof options?.onProgress === "function"
    ? options.onProgress
    : () => undefined;

  let timeline = createRunTimeline({
    runId: typeof message?.runId === "string" ? message.runId : "",
    startedAt: Date.now()
  });
  const recordTimelineEvent = (name, detail = "") => {
    timeline = appendRunTimelineEvent(timeline, {
      name,
      source: "bridge",
      at: Date.now(),
      detail
    });
  };

  recordTimelineEvent(RUN_TIMELINE_EVENT.BRIDGE_RUN_STARTED);
  reportProgress("Bridge run started. Validating prompt payload.");
  const checkpoints = [];
  const markCheckpoint = (name) => {
    checkpoints.push(`${Date.now()}:${name}`);
    reportProgress(`Checkpoint: ${name}`);
  };
  const submitDiagnostics = {
    attempts: [],
    finalSubmitPath: SUBMIT_PATH.NONE,
    finalWaitedForButtonMs: 0,
    finalSendButtonPresent: false,
    finalPreexistingStreamingDetected: false,
    finalWaitedForIdleMs: 0,
    finalAckReason: ACK_REASON.NO_ACK_SIGNAL,
    finalResponseStartReason: RESPONSE_START_REASON.TIMEOUT
  };
  const validation = validateBridgeRunPromptPayload(message);
  if (!validation.ok) {
    return bridgeFailure("MESSAGE_ROUTING_FAILED", validation.errors.join("; "), {}, timeline);
  }

  const selectorDiagnostics = collectSelectorDiagnostics(document);
  markCheckpoint("payload_validated");
  recordTimelineEvent(RUN_TIMELINE_EVENT.BRIDGE_PAYLOAD_VALIDATED);
  reportProgress("Bridge payload validated. Checking login/composer state.");

  recordTimelineEvent(RUN_TIMELINE_EVENT.BRIDGE_LOGIN_CHECKED);
  if (!isLikelyLoggedIn(document)) {
    return bridgeFailure(
      BRIDGE_ERROR.NOT_LOGGED_IN,
      "ChatGPT appears logged out. Sign in in the opened ChatGPT tab, then click Regenerate.",
      {
        selectors: selectorDiagnostics,
        checkpoints
      },
      timeline
    );
  }

  const composer = findComposer(document);
  if (!composer) {
    return bridgeFailure(BRIDGE_ERROR.COMPOSER_NOT_FOUND, "Composer not found on chatgpt.com.", {
      selectors: selectorDiagnostics,
      checkpoints
    }, timeline);
  }
  markCheckpoint("composer_found");
  recordTimelineEvent(RUN_TIMELINE_EVENT.BRIDGE_COMPOSER_FOUND);

  const assistantCountBeforeSubmit = findAssistantMessageNodes(document).length;
  const assistantNodeBeforeSubmit = getLatestAssistantMessageNode(document);
  let submissionError = null;
  reportProgress("Submitting prompt to ChatGPT.");
  markCheckpoint("submit_started");

  for (let attempt = 0; attempt <= WAIT.START_RETRY_ATTEMPTS; attempt += 1) {
    try {
      const attemptResult = await attemptPromptSubmission(
        composer,
        message.prompt,
        assistantCountBeforeSubmit,
        assistantNodeBeforeSubmit,
        attempt,
        reportProgress,
        recordTimelineEvent
      );
      submitDiagnostics.attempts.push({
        attempt: attempt + 1,
        submitPath: attemptResult.submitPath || SUBMIT_PATH.NONE,
        waitedForButtonMs: Number.isFinite(attemptResult.waitedForButtonMs) ? attemptResult.waitedForButtonMs : 0,
        sendButtonPresent: Boolean(attemptResult.sendButtonPresent),
        preexistingStreamingDetected: Boolean(attemptResult.preexistingStreamingDetected),
        waitedForIdleMs: Number.isFinite(attemptResult.waitedForIdleMs) ? attemptResult.waitedForIdleMs : 0,
        ackReason: attemptResult.ackReason || ACK_REASON.NO_ACK_SIGNAL,
        responseStartReason: attemptResult.responseStartReason || RESPONSE_START_REASON.TIMEOUT,
        ok: Boolean(attemptResult.ok),
        code: attemptResult.code || "",
        message: attemptResult.message || ""
      });
      if (attemptResult.ok) {
        markCheckpoint("response_started");
        submitDiagnostics.finalSubmitPath = attemptResult.submitPath || SUBMIT_PATH.NONE;
        submitDiagnostics.finalWaitedForButtonMs = Number.isFinite(attemptResult.waitedForButtonMs) ? attemptResult.waitedForButtonMs : 0;
        submitDiagnostics.finalSendButtonPresent = Boolean(attemptResult.sendButtonPresent);
        submitDiagnostics.finalPreexistingStreamingDetected = Boolean(attemptResult.preexistingStreamingDetected);
        submitDiagnostics.finalWaitedForIdleMs = Number.isFinite(attemptResult.waitedForIdleMs) ? attemptResult.waitedForIdleMs : 0;
        submitDiagnostics.finalAckReason = attemptResult.ackReason || ACK_REASON.NO_ACK_SIGNAL;
        submitDiagnostics.finalResponseStartReason = attemptResult.responseStartReason || RESPONSE_START_REASON.TIMEOUT;
        submissionError = null;
        break;
      }

      submissionError = attemptResult;
      if (attempt < WAIT.START_RETRY_ATTEMPTS && attemptResult.code === BRIDGE_ERROR.RESPONSE_START_TIMEOUT) {
        await sleep(WAIT.RETRY_DELAY_MS);
        continue;
      }

      break;
    } catch {
      submissionError = {
        ok: false,
        code: BRIDGE_ERROR.SUBMIT_FAILED,
        message: "Prompt submission failed.",
        submitPath: SUBMIT_PATH.NONE,
        waitedForButtonMs: 0,
        sendButtonPresent: false,
        preexistingStreamingDetected: false,
        waitedForIdleMs: 0,
        ackReason: ACK_REASON.NO_ACK_SIGNAL,
        responseStartReason: RESPONSE_START_REASON.TIMEOUT
      };
      submitDiagnostics.attempts.push({
        attempt: attempt + 1,
        submitPath: SUBMIT_PATH.NONE,
        waitedForButtonMs: 0,
        sendButtonPresent: false,
        preexistingStreamingDetected: false,
        waitedForIdleMs: 0,
        ackReason: ACK_REASON.NO_ACK_SIGNAL,
        responseStartReason: RESPONSE_START_REASON.TIMEOUT,
        ok: false,
        code: BRIDGE_ERROR.SUBMIT_FAILED,
        message: "Prompt submission failed."
      });
      break;
    }
  }

  if (submissionError) {
    submitDiagnostics.finalSubmitPath = submissionError.submitPath || SUBMIT_PATH.NONE;
    submitDiagnostics.finalWaitedForButtonMs = Number.isFinite(submissionError.waitedForButtonMs) ? submissionError.waitedForButtonMs : 0;
    submitDiagnostics.finalSendButtonPresent = Boolean(submissionError.sendButtonPresent);
    submitDiagnostics.finalPreexistingStreamingDetected = Boolean(submissionError.preexistingStreamingDetected);
    submitDiagnostics.finalWaitedForIdleMs = Number.isFinite(submissionError.waitedForIdleMs) ? submissionError.waitedForIdleMs : 0;
    submitDiagnostics.finalAckReason = submissionError.ackReason || ACK_REASON.NO_ACK_SIGNAL;
    submitDiagnostics.finalResponseStartReason = submissionError.responseStartReason || RESPONSE_START_REASON.TIMEOUT;
    const retryHint = submissionError.code === BRIDGE_ERROR.RESPONSE_START_TIMEOUT
      ? " Retried once before failing."
      : "";
    return bridgeFailure(submissionError.code, `${submissionError.message}${retryHint}`, {
      selectors: collectSelectorDiagnostics(document),
      submitDiagnostics,
      checkpoints,
      retry: {
        startTimeoutRetries: WAIT.START_RETRY_ATTEMPTS
      }
    }, timeline);
  }

  reportProgress("Prompt accepted. Waiting for ChatGPT response completion.");
  markCheckpoint("awaiting_response_complete");
  recordTimelineEvent(RUN_TIMELINE_EVENT.BRIDGE_RESPONSE_COMPLETE_WAIT_STARTED);
  const extracted = await waitForResponseComplete(reportProgress);
  if (!extracted) {
    return bridgeFailure(
      BRIDGE_ERROR.RESPONSE_COMPLETE_TIMEOUT,
      "Assistant response did not complete in time. Try Regenerate in the sidebar.",
      {
        selectors: collectSelectorDiagnostics(document),
        submitDiagnostics,
        checkpoints
      },
      timeline
    );
  }
  recordTimelineEvent(RUN_TIMELINE_EVENT.BRIDGE_RESPONSE_COMPLETED);

  if (!extracted.text) {
    return bridgeFailure(BRIDGE_ERROR.RESPONSE_PARSE_FAILED, "Assistant response could not be parsed.", {
      selectors: collectSelectorDiagnostics(document),
      submitDiagnostics,
      checkpoints
    }, timeline);
  }

  reportProgress("ChatGPT response completed. Parsing final output.");
  markCheckpoint("response_parsed");
  recordTimelineEvent(RUN_TIMELINE_EVENT.BRIDGE_RESPONSE_PARSED);

  return {
    ok: true,
    type: MSG.BRIDGE_RESPONSE_READY,
    runId: message.runId,
    sourceTabId: message.sourceTabId,
    completedAt: Date.now(),
    response: {
      text: extracted.text,
      sources: extracted.sources
    },
    debug: {
      selectors: collectSelectorDiagnostics(document),
      submitDiagnostics,
      checkpoints,
      timeline,
      retry: {
        startTimeoutRetries: WAIT.START_RETRY_ATTEMPTS
      }
    }
  };
}

console.debug("[StartGPT][bridge] loaded", {
  loggedIn: isLikelyLoggedIn(document),
  hasComposer: Boolean(findComposer(document))
});
