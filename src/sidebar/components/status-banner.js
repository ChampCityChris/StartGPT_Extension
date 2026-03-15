const LOADING_STATES = new Set([
  "queued",
  "opening_bridge",
  "waiting_for_chatgpt",
  "submitting_prompt",
  "waiting_for_response",
  "parsing_response"
]);

function getTone(status) {
  if (status === "failed") {
    return "failed";
  }
  if (status === "completed") {
    return "completed";
  }
  if (LOADING_STATES.has(status)) {
    return "loading";
  }
  return "idle";
}

function getStatusLabel(status) {
  if (!status) {
    return "Idle";
  }
  return status.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

export function renderStatusBanner(element, status) {
  const tone = getTone(status);
  element.dataset.tone = tone;
  element.textContent = `Status: ${getStatusLabel(status)}`;
}
