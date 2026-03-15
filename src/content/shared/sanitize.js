export function sanitizeText(input) {
  return String(input ?? "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function sanitizeUrl(input) {
  const candidate = String(input ?? "").trim();
  if (!candidate) {
    return "";
  }

  try {
    const parsed = new URL(candidate);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed.toString();
    }
  } catch {
    return "";
  }

  return "";
}

export function truncateText(input, maxLength = 240) {
  const text = sanitizeText(input);
  if (!Number.isInteger(maxLength) || maxLength < 1) {
    return text;
  }

  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength - 1)}...`;
}

export function sanitizeErrorCode(input) {
  return String(input ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function sanitizeDebugText(input, maxLength = 1500) {
  return truncateText(sanitizeText(input), maxLength);
}
