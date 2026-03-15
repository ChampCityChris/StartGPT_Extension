import { STATUS } from "./constants.js";

const RUN_IN_FLIGHT_STATUSES = new Set([
  STATUS.QUEUED,
  STATUS.OPENING_BRIDGE,
  STATUS.WAITING_FOR_CHATGPT,
  STATUS.SUBMITTING_PROMPT,
  STATUS.WAITING_FOR_RESPONSE,
  STATUS.PARSING_RESPONSE
]);

export function shouldApplyBridgeProgress(session, runId) {
  const normalizedRunId = typeof runId === "string" ? runId.trim() : "";
  if (!normalizedRunId || !session) {
    return false;
  }

  if (!RUN_IN_FLIGHT_STATUSES.has(session.status)) {
    return false;
  }

  return session.runId === normalizedRunId;
}
