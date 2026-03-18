import { SUMMARY_MODE } from "./constants.js";

export const QUICK_OVERVIEW_SYSTEM_PROMPT = [
  "You generate search overviews for a browser extension.",
  "Your job is to summarize a search results page quickly and accurately.",
  "",
  "Rules:",
  "- Use ONLY the provided query and search results.",
  "- Do not invent facts not supported by the results.",
  "- Do not describe the page mechanically unless evidence is weak.",
  "- Answer the likely user intent first.",
  "- Prefer direct language over hedging, but state uncertainty when needed.",
  "- Keep it compact and useful.",
  "- No filler, no throat-clearing.",
  "",
  "Return JSON with this schema:",
  "{",
  "  \"headline\": string,",
  "  \"summary\": string,",
  "  \"key_points\": [string, string, string],",
  "  \"confidence\": \"high\" | \"medium\" | \"low\",",
  "  \"evidence_gap\": string",
  "}"
].join("\n");

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

function toResultDomain(result) {
  const fallback = clip(result?.displayUrl, 120) || "unknown";
  try {
    const parsed = new URL(String(result?.url || ""));
    return parsed.hostname || fallback;
  } catch {
    return fallback;
  }
}

function buildQuickOverviewResultLines(results, maxCount = 5) {
  const ordered = Array.isArray(results)
    ? [...results].sort((a, b) => (a.rank || Number.MAX_SAFE_INTEGER) - (b.rank || Number.MAX_SAFE_INTEGER))
    : [];

  const lines = ordered.slice(0, maxCount).map((result, index) => {
    const domain = toResultDomain(result);
    const title = clip(result?.title, 220) || "(untitled result)";
    const snippet = clip(result?.snippet, 320) || "No snippet available.";
    return `${index + 1}. [${domain}] ${title} - ${snippet}`;
  });

  for (let i = lines.length; i < maxCount; i += 1) {
    lines.push(`${i + 1}. [unknown] (no result captured) - No snippet available.`);
  }

  return lines.join("\n");
}

function buildQuickOverviewUserPrompt({ query, results }) {
  const safeQuery = clip(query, 500) || "(missing query)";
  return [
    `Query: ${safeQuery}`,
    "",
    "Search results:",
    buildQuickOverviewResultLines(results),
    "",
    "Instructions:",
    "Write a compact overview for the query.",
    "The summary should be 60-90 words.",
    "Each key point should be one sentence.",
    "If the evidence is thin or conflicting, say so clearly."
  ].join("\n");
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

export function buildPromptPayload({
  query,
  results,
  mode = SUMMARY_MODE.QUICK_OVERVIEW,
  followUp = "",
  previousAnswer = ""
}) {
  const followUpText = clip(followUp, 1200);
  if (mode === SUMMARY_MODE.QUICK_OVERVIEW && !followUpText) {
    const input = buildQuickOverviewUserPrompt({ query, results });
    return {
      instructions: QUICK_OVERVIEW_SYSTEM_PROMPT,
      input,
      expectsStructuredJson: true,
      preview: `SYSTEM:\n${QUICK_OVERVIEW_SYSTEM_PROMPT}\n\nUSER:\n${input}`
    };
  }

  const input = buildPrompt({
    query,
    results,
    mode,
    followUp,
    previousAnswer
  });
  return {
    instructions: "",
    input,
    expectsStructuredJson: false,
    preview: input
  };
}
