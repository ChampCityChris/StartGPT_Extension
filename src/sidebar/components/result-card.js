function getPlaceholder(status) {
  if (status === "failed") {
    return "Run failed. See error details below.";
  }
  if (status === "completed") {
    return "No overview was returned.";
  }
  return "Automatic quick overview will appear here.";
}

export function renderResultCard(element, text, status) {
  const value = String(text || "").trim();
  element.textContent = value || getPlaceholder(status);
}
