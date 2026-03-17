const LOADING_STATES = new Set(["captured", "queued", "running"]);

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
  if (status === "captured") {
    return "Preparing Overview";
  }
  return status.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

export function renderStatusBanner(element, status) {
  const tone = getTone(status);
  element.dataset.tone = tone;
  element.textContent = `Status: ${getStatusLabel(status)}`;
}
