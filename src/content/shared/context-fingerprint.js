const TRACKING_QUERY_PARAM_PREFIXES = ["utm_"];

const TRACKING_QUERY_PARAMS = new Set([
  "fbclid",
  "gclid",
  "msclkid",
  "dclid",
  "mc_cid",
  "mc_eid",
  "_hsenc",
  "_hsmi",
  "yclid",
  "_gl",
  "igshid"
]);

const STARTPAGE_DESTINATION_PARAMS = ["url", "u", "target", "to", "dest", "destination"];

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function parseUrl(value) {
  try {
    return new URL(String(value || "").trim());
  } catch {
    return null;
  }
}

function isHttpUrl(parsedUrl) {
  return parsedUrl?.protocol === "http:" || parsedUrl?.protocol === "https:";
}

function isTrackingParam(name) {
  const normalized = normalizeText(name).toLowerCase();
  if (!normalized) {
    return false;
  }
  if (TRACKING_QUERY_PARAMS.has(normalized)) {
    return true;
  }
  return TRACKING_QUERY_PARAM_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

function decodePotentialUrl(value) {
  let candidate = normalizeText(value);
  if (!candidate) {
    return "";
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (/^https?:\/\//i.test(candidate)) {
      return candidate;
    }
    try {
      const decoded = decodeURIComponent(candidate);
      if (decoded === candidate) {
        break;
      }
      candidate = decoded;
    } catch {
      break;
    }
  }

  return candidate;
}

function extractStartpageDestination(parsedUrl) {
  const hostname = String(parsedUrl?.hostname || "").toLowerCase();
  if (!hostname.endsWith("startpage.com")) {
    return "";
  }

  for (const paramName of STARTPAGE_DESTINATION_PARAMS) {
    const raw = normalizeText(parsedUrl.searchParams.get(paramName) || "");
    if (!raw) {
      continue;
    }

    const decoded = decodePotentialUrl(raw);
    const parsed = parseUrl(decoded);
    if (!parsed || !isHttpUrl(parsed)) {
      continue;
    }
    return decoded;
  }

  return "";
}

function normalizeParsedUrl(parsedUrl) {
  parsedUrl.hash = "";

  const entries = [];
  parsedUrl.searchParams.forEach((value, name) => {
    if (isTrackingParam(name)) {
      return;
    }
    entries.push([name, value]);
  });

  entries.sort((left, right) => {
    if (left[0] === right[0]) {
      return left[1].localeCompare(right[1]);
    }
    return left[0].localeCompare(right[0]);
  });

  parsedUrl.search = "";
  for (const [name, value] of entries) {
    parsedUrl.searchParams.append(name, value);
  }

  return parsedUrl.toString();
}

function normalizeContextUrlInternal(value, depth = 0) {
  const parsed = parseUrl(value);
  if (!parsed || !isHttpUrl(parsed)) {
    return "";
  }

  if (depth < 2) {
    const destination = extractStartpageDestination(parsed);
    if (destination) {
      const nested = normalizeContextUrlInternal(destination, depth + 1);
      if (nested) {
        return nested;
      }
    }
  }

  return normalizeParsedUrl(parsed);
}

export function normalizeContextUrl(value) {
  return normalizeContextUrlInternal(value, 0);
}

export function buildContextFingerprint(query, results) {
  const normalizedQuery = normalizeText(query).toLowerCase();
  const normalizedUrls = Array.isArray(results)
    ? [...new Set(
      results
        .map((result) => normalizeContextUrl(result?.url))
        .filter(Boolean)
    )].sort()
    : [];

  const urlsFingerprint = normalizedUrls.join("||");
  if (!urlsFingerprint) {
    return "";
  }

  return `${normalizedQuery}::${urlsFingerprint}`;
}

export function buildContextSignature(payload) {
  const normalizedQuery = normalizeText(payload?.query).toLowerCase();
  const contextFingerprint = buildContextFingerprint(payload?.query, payload?.results);
  const resultCount = Array.isArray(payload?.results) ? payload.results.length : 0;

  return JSON.stringify({
    query: normalizedQuery,
    contextFingerprint,
    resultCount
  });
}
