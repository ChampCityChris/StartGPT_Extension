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

function decodeEscapedCharacter(char) {
  switch (char) {
    case "n":
      return "\n";
    case "r":
      return "\r";
    case "t":
      return "\t";
    case "\\":
      return "\\";
    case "\"":
      return "\"";
    case "'":
      return "'";
    default:
      return char;
  }
}

function parseQuotedText(text, startIndex) {
  const quote = text[startIndex];
  if (quote !== "\"" && quote !== "'") {
    return null;
  }

  let cursor = startIndex + 1;
  let value = "";

  while (cursor < text.length) {
    const char = text[cursor];

    if (char === "\\") {
      const next = text[cursor + 1];
      if (typeof next === "string") {
        value += decodeEscapedCharacter(next);
        cursor += 2;
        continue;
      }
      cursor += 1;
      break;
    }

    if (char === quote) {
      return {
        value,
        endIndex: cursor + 1,
        terminated: true
      };
    }

    value += char;
    cursor += 1;
  }

  return {
    value,
    endIndex: cursor,
    terminated: false
  };
}

function skipWhitespace(text, startIndex) {
  let cursor = startIndex;
  while (cursor < text.length && /\s/.test(text[cursor])) {
    cursor += 1;
  }
  return cursor;
}

function parseLooseStringValue(text, startIndex) {
  const start = skipWhitespace(text, startIndex);
  const quoted = parseQuotedText(text, start);
  if (quoted) {
    return quoted;
  }

  let cursor = start;
  let value = "";
  while (cursor < text.length) {
    const char = text[cursor];
    if (char === "," || char === "\n" || char === "\r" || char === "}") {
      break;
    }
    value += char;
    cursor += 1;
  }

  return {
    value,
    endIndex: cursor,
    terminated: true
  };
}

function locateFieldStart(text, fieldName) {
  const pattern = new RegExp(`"${fieldName}"\\s*:\\s*`, "i");
  const match = pattern.exec(text);
  if (!match) {
    return -1;
  }
  return match.index + match[0].length;
}

function parseLooseArrayOfStrings(text, startIndex) {
  let cursor = skipWhitespace(text, startIndex);
  if (text[cursor] !== "[") {
    return [];
  }

  cursor += 1;
  const values = [];

  while (cursor < text.length && values.length < 6) {
    cursor = skipWhitespace(text, cursor);
    const char = text[cursor];

    if (char === "]") {
      break;
    }
    if (!char) {
      break;
    }
    if (char === ",") {
      cursor += 1;
      continue;
    }

    const parsed = parseLooseStringValue(text, cursor);
    if (!parsed) {
      break;
    }
    const item = compactText(parsed.value, 260);
    if (item) {
      values.push(item);
    }

    if (parsed.endIndex <= cursor) {
      break;
    }
    cursor = parsed.endIndex;

    while (cursor < text.length && text[cursor] !== "," && text[cursor] !== "]") {
      if (text[cursor] === "\n" || text[cursor] === "\r") {
        break;
      }
      cursor += 1;
    }
  }

  return values;
}

function parseLooseObject(rawText) {
  const text = String(rawText || "");
  const headlineStart = locateFieldStart(text, "headline");
  const summaryStart = locateFieldStart(text, "summary");
  const keyPointsStart = locateFieldStart(text, "key_points");
  const confidenceStart = locateFieldStart(text, "confidence");
  const evidenceGapStart = locateFieldStart(text, "evidence_gap");

  if (
    headlineStart === -1
    || summaryStart === -1
    || keyPointsStart === -1
    || confidenceStart === -1
    || evidenceGapStart === -1
  ) {
    return null;
  }

  const headline = parseLooseStringValue(text, headlineStart)?.value || "";
  const summary = parseLooseStringValue(text, summaryStart)?.value || "";
  const keyPoints = parseLooseArrayOfStrings(text, keyPointsStart);
  const confidence = parseLooseStringValue(text, confidenceStart)?.value || "";
  const evidenceGap = parseLooseStringValue(text, evidenceGapStart)?.value || "";

  return {
    headline,
    summary,
    key_points: keyPoints,
    confidence,
    evidence_gap: evidenceGap
  };
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
    parsed = parseLooseObject(jsonText);
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
