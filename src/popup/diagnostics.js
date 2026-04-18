const MODE = {
  QUICK_OVERVIEW: "quick_overview",
  EXPANDED: "expanded_perplexity"
};

function formatList(value) {
  if (!Array.isArray(value) || value.length === 0) {
    return "(none)";
  }
  return value.join(", ");
}

function formatInteger(value) {
  return Number.isInteger(value) ? String(value) : "(none)";
}

function formatTokenVsCap(outputTokens, cap) {
  if (!Number.isInteger(outputTokens) || !Number.isInteger(cap)) {
    return "(unknown)";
  }

  if (outputTokens === cap) {
    return `${outputTokens}/${cap} (at cap)`;
  }

  if (outputTokens > cap) {
    return `${outputTokens}/${cap} (over by ${outputTokens - cap})`;
  }

  return `${outputTokens}/${cap} (under by ${cap - outputTokens})`;
}

function getUsageByMode(session, mode) {
  const usageByMode = session?.response?.usageByMode;
  if (!usageByMode || typeof usageByMode !== "object") {
    return null;
  }

  const usage = usageByMode[mode];
  if (!usage || typeof usage !== "object") {
    return null;
  }

  return usage;
}

export function buildDiagnosticText(tab, session, stateResponse, overviewText = "", tabOverview = null) {
  const openAiDiagnostics = session?.lastError?.diagnostics || session?.debug?.lastErrorDiagnostics || null;
  const deepUsage = getUsageByMode(session, MODE.EXPANDED);
  const quickUsage = getUsageByMode(session, MODE.QUICK_OVERVIEW);
  const errorOutputTokens = Number.isInteger(openAiDiagnostics?.usageOutputTokens)
    ? openAiDiagnostics.usageOutputTokens
    : null;
  const errorCap = Number.isInteger(openAiDiagnostics?.maxOutputTokensCap)
    ? openAiDiagnostics.maxOutputTokensCap
    : null;

  return [
    `Tab ID: ${tab?.id ?? "(none)"}`,
    `Tab URL: ${tab?.url || "(none)"}`,
    `Resolved Session Tab ID: ${session?.tabId ?? "(none)"}`,
    `Active Sidebar Tab ID: ${stateResponse?.state?.global?.activeSidebarTabId ?? "(none)"}`,
    `Tab Overview Snapshot: ${tabOverview?.ok ? "yes" : "no"}`,
    `Tab Overview Source Tab ID: ${tabOverview?.sourceTabId ?? "(none)"}`,
    `Tab Overview Status: ${tabOverview?.status || "(none)"}`,
    `Tab Overview Query: ${tabOverview?.query || "(none)"}`,
    `Tab Overview Mode: ${tabOverview?.summaryMode || "(none)"}`,
    `Tab Overview Chars: ${String(tabOverview?.overviewText || "").trim().length}`,
    `Has API Key: ${stateResponse?.hasApiKey ? "yes" : "no"}`,
    `Status: ${session?.status || "idle"}`,
    `Progress: ${session?.debug?.progressMessage || "(none)"}`,
    `Error Code: ${session?.debug?.lastErrorCode || session?.lastError?.code || "(none)"}`,
    `Error Message: ${session?.lastError?.message || "(none)"}`,
    `Result Count: ${Array.isArray(session?.results) ? session.results.length : 0}`,
    `Model: ${stateResponse?.state?.settings?.model || "(none)"}`,
    `Default Mode: ${stateResponse?.state?.settings?.defaultSummaryMode || "(none)"}`,
    `OpenAI Response Status: ${openAiDiagnostics?.responseStatus || "(none)"}`,
    `OpenAI Response ID: ${openAiDiagnostics?.responseId || "(none)"}`,
    `OpenAI Incomplete Reason: ${openAiDiagnostics?.incompleteReason || "(none)"}`,
    `OpenAI Output Item Count: ${Number.isInteger(openAiDiagnostics?.outputItemCount) ? openAiDiagnostics.outputItemCount : 0}`,
    `OpenAI Output Types: ${formatList(openAiDiagnostics?.outputItemTypes)}`,
    `OpenAI Content Types: ${formatList(openAiDiagnostics?.contentTypes)}`,
    `OpenAI top-level output_text: ${openAiDiagnostics?.hasTopLevelOutputText ? "yes" : "no"}`,
    `OpenAI raw body chars: ${Number.isInteger(openAiDiagnostics?.rawBodyChars) ? openAiDiagnostics.rawBodyChars : 0}`,
    `OpenAI usage.output_tokens: ${formatInteger(errorOutputTokens)}`,
    `OpenAI max_output_tokens cap: ${formatInteger(errorCap)}`,
    `OpenAI usage.output_tokens vs cap: ${formatTokenVsCap(errorOutputTokens, errorCap)}`,
    `OpenAI requested max_output_tokens: ${formatInteger(openAiDiagnostics?.requestedMaxOutputTokens)}`,
    `OpenAI Retry Planned: ${openAiDiagnostics?.retryPlanned ? "yes" : "no"}`,
    `OpenAI Retry max_output_tokens: ${Number.isInteger(openAiDiagnostics?.retryMaxOutputTokens) ? openAiDiagnostics.retryMaxOutputTokens : "(none)"}`,
    `OpenAI Retry blocked by cap: ${openAiDiagnostics?.retryBlockedByCap ? "yes" : "no"}`,
    `OpenAI Parsed JSON: ${openAiDiagnostics?.parsedJson ? "yes" : "no"}`,
    `Quick usage.output_tokens: ${formatInteger(quickUsage?.outputTokens)}`,
    `Quick max_output_tokens cap: ${formatInteger(quickUsage?.maxOutputTokensCap)}`,
    `Quick usage.output_tokens vs cap: ${formatTokenVsCap(quickUsage?.outputTokens, quickUsage?.maxOutputTokensCap)}`,
    `Deep usage.output_tokens: ${formatInteger(deepUsage?.outputTokens)}`,
    `Deep max_output_tokens cap: ${formatInteger(deepUsage?.maxOutputTokensCap)}`,
    `Deep usage.output_tokens vs cap: ${formatTokenVsCap(deepUsage?.outputTokens, deepUsage?.maxOutputTokensCap)}`,
    `Latest Overview Chars: ${String(overviewText || "").trim().length}`
  ].join("\n");
}
