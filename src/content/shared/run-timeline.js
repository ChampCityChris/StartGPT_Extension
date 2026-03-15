export const RUN_TIMELINE_EVENT = {
  STARTPAGE_CONTEXT_CAPTURED: "startpage_context_captured",
  STARTPAGE_CONTEXT_INVALID: "startpage_context_invalid",
  RUN_QUEUED: "run_queued",
  RUN_STARTED: "run_started",
  SIDEBAR_OPEN_STARTED: "sidebar_open_started",
  SIDEBAR_OPEN_COMPLETED: "sidebar_open_completed",
  SIDEBAR_OPEN_BLOCKED: "sidebar_open_blocked",
  BRIDGE_REGISTRATION_WAIT_STARTED: "bridge_registration_wait_started",
  BRIDGE_REGISTERED: "bridge_registered",
  BRIDGE_PING_WAIT_STARTED: "bridge_ping_wait_started",
  BRIDGE_PING_READY: "bridge_ping_ready",
  BRIDGE_READY: "bridge_ready",
  PROMPT_PREPARED: "prompt_prepared",
  PROMPT_SEND_STARTED: "prompt_send_started",
  BRIDGE_REQUEST_DISPATCHED: "bridge_request_dispatched",
  BRIDGE_RECONNECT_ATTEMPTED: "bridge_reconnect_attempted",
  BRIDGE_RESPONSE_RECEIVED: "bridge_response_received",
  RESPONSE_PARSING_STARTED: "response_parsing_started",
  RUN_COMPLETED: "run_completed",
  RUN_FAILED: "run_failed",
  BRIDGE_RUN_STARTED: "bridge_run_started",
  BRIDGE_PAYLOAD_VALIDATED: "bridge_payload_validated",
  BRIDGE_LOGIN_CHECKED: "bridge_login_checked",
  BRIDGE_COMPOSER_FOUND: "bridge_composer_found",
  BRIDGE_SUBMIT_STARTED: "bridge_submit_started",
  BRIDGE_SUBMIT_ACK_WAIT_STARTED: "bridge_submit_ack_wait_started",
  BRIDGE_SUBMIT_ACKNOWLEDGED: "bridge_submit_acknowledged",
  BRIDGE_RESPONSE_START_WAIT_STARTED: "bridge_response_start_wait_started",
  BRIDGE_RESPONSE_STARTED: "bridge_response_started",
  BRIDGE_RESPONSE_COMPLETE_WAIT_STARTED: "bridge_response_complete_wait_started",
  BRIDGE_RESPONSE_COMPLETED: "bridge_response_completed",
  BRIDGE_RESPONSE_PARSED: "bridge_response_parsed"
};

const EVENT_LABELS = {
  [RUN_TIMELINE_EVENT.STARTPAGE_CONTEXT_CAPTURED]: "Startpage context captured",
  [RUN_TIMELINE_EVENT.STARTPAGE_CONTEXT_INVALID]: "Startpage context invalid",
  [RUN_TIMELINE_EVENT.RUN_QUEUED]: "Run queued",
  [RUN_TIMELINE_EVENT.RUN_STARTED]: "Run started",
  [RUN_TIMELINE_EVENT.SIDEBAR_OPEN_STARTED]: "Sidebar open started",
  [RUN_TIMELINE_EVENT.SIDEBAR_OPEN_COMPLETED]: "Sidebar open completed",
  [RUN_TIMELINE_EVENT.SIDEBAR_OPEN_BLOCKED]: "Sidebar open blocked",
  [RUN_TIMELINE_EVENT.BRIDGE_REGISTRATION_WAIT_STARTED]: "Bridge registration wait started",
  [RUN_TIMELINE_EVENT.BRIDGE_REGISTERED]: "Bridge registered",
  [RUN_TIMELINE_EVENT.BRIDGE_PING_WAIT_STARTED]: "Bridge ping wait started",
  [RUN_TIMELINE_EVENT.BRIDGE_PING_READY]: "Bridge ping ready",
  [RUN_TIMELINE_EVENT.BRIDGE_READY]: "Bridge ready",
  [RUN_TIMELINE_EVENT.PROMPT_PREPARED]: "Prompt prepared",
  [RUN_TIMELINE_EVENT.PROMPT_SEND_STARTED]: "Prompt send started",
  [RUN_TIMELINE_EVENT.BRIDGE_REQUEST_DISPATCHED]: "Bridge request dispatched",
  [RUN_TIMELINE_EVENT.BRIDGE_RECONNECT_ATTEMPTED]: "Bridge reconnect attempted",
  [RUN_TIMELINE_EVENT.BRIDGE_RESPONSE_RECEIVED]: "Bridge response received",
  [RUN_TIMELINE_EVENT.RESPONSE_PARSING_STARTED]: "Response parsing started",
  [RUN_TIMELINE_EVENT.RUN_COMPLETED]: "Run completed",
  [RUN_TIMELINE_EVENT.RUN_FAILED]: "Run failed",
  [RUN_TIMELINE_EVENT.BRIDGE_RUN_STARTED]: "Bridge run started",
  [RUN_TIMELINE_EVENT.BRIDGE_PAYLOAD_VALIDATED]: "Bridge payload validated",
  [RUN_TIMELINE_EVENT.BRIDGE_LOGIN_CHECKED]: "Bridge login checked",
  [RUN_TIMELINE_EVENT.BRIDGE_COMPOSER_FOUND]: "Bridge composer found",
  [RUN_TIMELINE_EVENT.BRIDGE_SUBMIT_STARTED]: "Bridge submit started",
  [RUN_TIMELINE_EVENT.BRIDGE_SUBMIT_ACK_WAIT_STARTED]: "Bridge submit acknowledgement wait started",
  [RUN_TIMELINE_EVENT.BRIDGE_SUBMIT_ACKNOWLEDGED]: "Bridge submit acknowledged",
  [RUN_TIMELINE_EVENT.BRIDGE_RESPONSE_START_WAIT_STARTED]: "Bridge response start wait started",
  [RUN_TIMELINE_EVENT.BRIDGE_RESPONSE_STARTED]: "Bridge response started",
  [RUN_TIMELINE_EVENT.BRIDGE_RESPONSE_COMPLETE_WAIT_STARTED]: "Bridge response completion wait started",
  [RUN_TIMELINE_EVENT.BRIDGE_RESPONSE_COMPLETED]: "Bridge response completed",
  [RUN_TIMELINE_EVENT.BRIDGE_RESPONSE_PARSED]: "Bridge response parsed"
};

const MAX_TIMELINE_EVENTS = 80;

function isPositiveTimestamp(value) {
  return Number.isInteger(value) && value > 0;
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeTimelineEvent(event, fallbackAt) {
  const name = normalizeText(event?.name);
  if (!name) {
    return null;
  }

  return {
    name,
    at: isPositiveTimestamp(event?.at) ? event.at : fallbackAt,
    source: normalizeText(event?.source) || "background",
    detail: normalizeText(event?.detail)
  };
}

function getStartedAt(...candidates) {
  const valid = candidates.filter(isPositiveTimestamp);
  if (valid.length === 0) {
    return Date.now();
  }
  return Math.min(...valid);
}

function getTimelineEventKey(event) {
  return [
    event.name,
    event.source,
    String(event.at),
    event.detail
  ].join("|");
}

function normalizeTimeline(timeline) {
  return {
    runId: normalizeText(timeline?.runId),
    startedAt: getStartedAt(timeline?.startedAt),
    events: Array.isArray(timeline?.events) ? timeline.events : []
  };
}

export function createRunTimeline({ runId = "", startedAt = Date.now(), events = [] } = {}) {
  return mergeRunTimelineEvents({
    runId,
    startedAt,
    events: []
  }, {
    runId,
    startedAt,
    events
  });
}

export function mergeRunTimelineEvents(baseTimeline, incomingTimelineOrEvents) {
  const base = normalizeTimeline(baseTimeline);
  const incoming = Array.isArray(incomingTimelineOrEvents)
    ? { runId: "", startedAt: null, events: incomingTimelineOrEvents }
    : normalizeTimeline(incomingTimelineOrEvents);
  const startedAt = getStartedAt(base.startedAt, incoming.startedAt);
  const merged = [];
  const seen = new Set();
  const fallbackAt = startedAt;

  for (const candidate of [...base.events, ...incoming.events]) {
    const normalized = normalizeTimelineEvent(candidate, fallbackAt);
    if (!normalized) {
      continue;
    }
    const key = getTimelineEventKey(normalized);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(normalized);
  }

  merged.sort((left, right) => left.at - right.at);

  return {
    runId: incoming.runId || base.runId,
    startedAt,
    events: merged.slice(-MAX_TIMELINE_EVENTS)
  };
}

export function appendRunTimelineEvent(timeline, event) {
  return mergeRunTimelineEvents(timeline, [event]);
}

export function summarizeRunTimeline(timeline) {
  const normalized = normalizeTimeline(timeline);
  const events = normalized.events
    .map((event) => normalizeTimelineEvent(event, normalized.startedAt))
    .filter(Boolean)
    .sort((left, right) => left.at - right.at);

  return {
    runId: normalized.runId,
    startedAt: normalized.startedAt,
    totalMs: events.length > 0
      ? Math.max(0, events[events.length - 1].at - normalized.startedAt)
      : 0,
    events: events.map((event, index) => ({
      ...event,
      sinceStartMs: Math.max(0, event.at - normalized.startedAt),
      sincePreviousMs: Math.max(
        0,
        event.at - (index === 0 ? normalized.startedAt : events[index - 1].at)
      )
    }))
  };
}

export function describeRunTimelineEvent(name) {
  const normalized = normalizeText(name);
  if (!normalized) {
    return "Unknown event";
  }

  if (EVENT_LABELS[normalized]) {
    return EVENT_LABELS[normalized];
  }

  return normalized
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function formatDurationMs(durationMs) {
  if (!Number.isFinite(durationMs) || durationMs < 0) {
    return "(n/a)";
  }

  if (durationMs < 1000) {
    return `${Math.round(durationMs)}ms`;
  }

  if (durationMs < 10000) {
    return `${(durationMs / 1000).toFixed(1)}s`;
  }

  return `${Math.round(durationMs / 100) / 10}s`;
}
