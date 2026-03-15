function normalizeLine(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function formatResultLine(result, index) {
  const title = normalizeLine(result?.title) || "(untitled)";
  const snippet = normalizeLine(result?.snippet);
  const url = normalizeLine(result?.url) || "(missing-url)";
  const displayUrl = normalizeLine(result?.displayUrl);

  const parts = [title];
  if (snippet) {
    parts.push(snippet);
  }
  parts.push(url);
  if (displayUrl) {
    parts.push(`display: ${displayUrl}`);
  }

  return `${index + 1}. ${parts.join(" - ")}`;
}

function getTaskForMode(mode) {
  switch (mode) {
    case "compare_results":
      return "- Compare the strongest disagreements across these results.\n- Highlight where evidence appears weak or missing.";
    case "click_recommendations":
      return "- Recommend which 1-3 results to click first and why.\n- Include one caution before clicking.";
    default:
      return "- Write a concise overview of what these results suggest.\n- Call out conflicting claims or uncertainty.";
  }
}

export function buildPrompt({ query, results, mode = "grounded_overview" }) {
  const safeQuery = normalizeLine(query);
  const ordered = Array.isArray(results)
    ? [...results].sort((a, b) => (a.rank || Number.MAX_SAFE_INTEGER) - (b.rank || Number.MAX_SAFE_INTEGER))
    : [];
  const visibleResults = ordered.map((result, index) => formatResultLine(result, index));

  return [
    "You are helping summarize a search results page.",
    "Use ONLY the provided Startpage results below as your evidence.",
    "Do not say you cannot access the page; the relevant content is provided in this prompt.",
    "If evidence is insufficient, say so briefly and explain why.",
    "",
    "User query:",
    safeQuery || "(empty query)",
    "",
    "Visible Startpage results:",
    visibleResults.length > 0 ? visibleResults.join("\n") : "No results were captured.",
    "",
    "Task:",
    getTaskForMode(mode),
    "- Keep the answer factual and compact for a sidebar.",
    "- Do not claim to have opened any result unless explicitly told."
  ].join("\n");
}
