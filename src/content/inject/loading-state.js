const LOADING_STATES = new Set(["loading", "captured", "queued", "running"]);

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

function describeLoadingStatus(status) {
  switch (status) {
    case "loading":
      return "capturing context";
    case "captured":
      return "preparing automatic overview";
    case "queued":
      return "queued";
    case "running":
      return "calling OpenAI";
    default:
      return "working";
  }
}

export function getCardStatusLabel(status) {
  const normalized = normalizeCardStatus(status);
  if (normalized === "loading") {
    return `Working: ${describeLoadingStatus(status)}`;
  }
  if (normalized === "completed") {
    return "Overview ready";
  }
  if (normalized === "failed") {
    return "Overview failed";
  }
  return "Idle";
}
