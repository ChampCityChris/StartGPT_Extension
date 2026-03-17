import { SUMMARY_MODE } from "./constants.js";

function normalizeLine(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function clip(text, maxChars) {
  const value = normalizeLine(text);
  if (!value) {
    return "";
  }
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, maxChars - 1)}...`;
}

function buildResultBlock(results) {
  if (!Array.isArray(results) || results.length === 0) {
    return "No results were captured.";
  }

  const ordered = [...results].sort((a, b) => (a.rank || Number.MAX_SAFE_INTEGER) - (b.rank || Number.MAX_SAFE_INTEGER));
  return ordered
    .map((result, index) => {
      const rank = Number.isInteger(result.rank) ? result.rank : (index + 1);
      const title = clip(result.title, 240) || "(untitled result)";
      const url = clip(result.url, 800) || "(missing-url)";
      const snippet = clip(result.snippet, 600);
      const displayUrl = clip(result.displayUrl, 200);
      const parts = [`[${rank}] ${title}`, `URL: ${url}`];
      if (displayUrl) {
        parts.push(`Display URL: ${displayUrl}`);
      }
      if (snippet) {
        parts.push(`Snippet: ${snippet}`);
      }
      return parts.join("\n");
    })
    .join("\n\n");
}

function getModeInstructions(mode) {
  if (mode === SUMMARY_MODE.EXPANDED) {
    return [
      "Return an expanded, structured answer in this order:",
      "1) Key Takeaways (3-6 bullets)",
      "2) What Seems Reliable",
      "3) Conflicts Or Gaps",
      "4) What To Verify Next",
      "5) Suggested Next Clicks (up to 3 results)",
      "Include inline bracket citations like [1], [2] that map only to the provided result list.",
      "Do not claim to have visited pages."
    ].join("\n");
  }

  return [
    "Return a quick overview for a sidebar card:",
    "- 4-7 concise bullets",
    "- mention uncertainty if evidence is weak",
    "- include 1-2 suggested next clicks using [rank] references"
  ].join("\n");
}

export function buildPrompt({ query, results, mode = SUMMARY_MODE.QUICK_OVERVIEW, followUp = "", previousAnswer = "" }) {
  const safeQuery = clip(query, 500) || "(missing query)";
  const resultBlock = buildResultBlock(results);
  const followUpText = clip(followUp, 1200);
  const priorAnswer = clip(previousAnswer, 3000);

  const sections = [
    "You are StartGPT, a search-results summarization assistant.",
    "You must rely ONLY on the provided Startpage result excerpts.",
    "If evidence is missing, say that clearly.",
    "",
    "User Query:",
    safeQuery,
    "",
    "Captured Startpage Results:",
    resultBlock,
    "",
    "Task Instructions:",
    getModeInstructions(mode)
  ];

  if (followUpText) {
    sections.push(
      "",
      "Previous Assistant Answer:",
      priorAnswer || "(none)",
      "",
      "Follow-Up Question:",
      followUpText,
      "",
      "Answer the follow-up while staying grounded in the captured results."
    );
  }

  return sections.join("\n");
}
