const ALLOWED_CONFIDENCE = new Set(["high", "medium", "low"]);

function compactText(value, maxChars) {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "";
  }
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, maxChars - 1)}...`;
}

function unwrapJsonBlock(rawText) {
  const trimmed = String(rawText || "").trim();
  if (!trimmed) {
    return "";
  }
  const match = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return match ? String(match[1] || "").trim() : trimmed;
}

export function parseQuickOverviewJson(rawText) {
  const jsonText = unwrapJsonBlock(rawText);
  if (!jsonText) {
    return null;
  }

  let parsed = null;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }

  const headline = compactText(parsed.headline, 180);
  const summary = compactText(parsed.summary, 1200);
  const keyPoints = Array.isArray(parsed.key_points)
    ? parsed.key_points
      .map((entry) => compactText(entry, 260))
      .filter(Boolean)
      .slice(0, 3)
    : [];
  const confidence = compactText(parsed.confidence, 20).toLowerCase();
  const evidenceGap = compactText(parsed.evidence_gap, 280);

  if (!headline || !summary || keyPoints.length === 0 || !ALLOWED_CONFIDENCE.has(confidence) || !evidenceGap) {
    return null;
  }

  return {
    headline,
    summary,
    keyPoints,
    confidence,
    evidenceGap
  };
}

export function formatQuickOverviewOutput(rawText) {
  const structured = parseQuickOverviewJson(rawText);
  if (!structured) {
    return {
      text: String(rawText || "").trim(),
      structured: null,
      formatUsed: "raw_text"
    };
  }

  const lines = [
    structured.headline,
    "",
    structured.summary,
    "",
    "Key points:",
    ...structured.keyPoints.map((point) => `- ${point}`),
    "",
    `Confidence: ${structured.confidence}`,
    `Evidence gap: ${structured.evidenceGap}`
  ];

  return {
    text: lines.join("\n").trim(),
    structured: {
      headline: structured.headline,
      summary: structured.summary,
      key_points: structured.keyPoints,
      confidence: structured.confidence,
      evidence_gap: structured.evidenceGap
    },
    formatUsed: "structured_json"
  };
}
