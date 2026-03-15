const LOADING_STATES = new Set([
  "loading",
  "queued",
  "opening_bridge",
  "waiting_for_chatgpt",
  "submitting_prompt",
  "waiting_for_response",
  "parsing_response"
]);

export function normalizeCardStatus(status) {
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

function formatStatus(status) {
  return String(status || "idle").replace(/_/g, " ");
}

function describeLoadingStatus(status) {
  switch (status) {
    case "loading":
      return "capturing Startpage results";
    case "queued":
      return "queued to start";
    case "opening_bridge":
      return "connecting to ChatGPT context";
    case "waiting_for_chatgpt":
      return "waiting for ChatGPT composer";
    case "submitting_prompt":
      return "submitting grounded prompt";
    case "waiting_for_response":
      return "waiting for ChatGPT response";
    case "parsing_response":
      return "parsing response and sources";
    default:
      return formatStatus(status);
  }
}

export function getCardStatusLabel(status) {
  const normalized = normalizeCardStatus(status);
  switch (normalized) {
    case "loading":
      return `Working: ${describeLoadingStatus(status)}`;
    case "completed":
      return "Overview ready";
    case "failed":
      return "Overview failed";
    default:
      return `Overview ${formatStatus(status)}`;
  }
}

export function renderLoadingState(status) {
  return normalizeCardStatus(status);
}
