import { MSG } from "../content/shared/message-types.js";
import {
  describeRunTimelineEvent,
  formatDurationMs,
  summarizeRunTimeline
} from "../content/shared/run-timeline.js";
import { openSidebarFromUserGesture } from "./sidebar-open.js";

const openSidebarButton = document.getElementById("open-sidebar");
const runNowButton = document.getElementById("run-now");
const refreshStateButton = document.getElementById("refresh-state");
const activeTabLabel = document.getElementById("active-tab");
const runStatusLabel = document.getElementById("run-status");
const queryStatusLabel = document.getElementById("query-status");
const errorStatusLabel = document.getElementById("error-status");
const bridgeStatusLabel = document.getElementById("bridge-status");
const diagnosticsOutput = document.getElementById("diagnostics-output");

const STATUS_WAITING_FOR_RESPONSE = "waiting_for_response";
const LONG_WAIT_WARNING_MS = 45000;

let refreshTimerId = null;
let currentActiveTab = null;

function isStartpageUrl(url) {
  if (typeof url !== "string" || !url) {
    return false;
  }

  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.hostname.endsWith("startpage.com");
  } catch {
    return false;
  }
}

async function getActiveTab() {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
}

function setBridgeStatus(text) {
  if (bridgeStatusLabel) {
    bridgeStatusLabel.textContent = text;
  }
}

function setErrorStatus(text) {
  if (errorStatusLabel) {
    errorStatusLabel.textContent = text || "";
  }
}

function formatTime(timestamp) {
  if (!Number.isInteger(timestamp)) {
    return "(none)";
  }
  return new Date(timestamp).toLocaleTimeString();
}

function parseRunStartedAt(runId) {
  const match = typeof runId === "string" ? runId.match(/_(\d+)$/) : null;
  if (!match) {
    return null;
  }
  const parsed = Number.parseInt(match[1], 10);
  return Number.isInteger(parsed) ? parsed : null;
}

function formatBridgeSignal(signal) {
  if (!signal) {
    return "Bridge signal: (none)";
  }

  const parts = [
    `instance=${signal.instanceId || "(none)"}`,
    `phase=${signal.phase || "(none)"}`,
    `tab=${signal.bridgeTabId ?? "(none)"}`,
    `frame=${Number.isInteger(signal.frameId) ? signal.frameId : "(none)"}`,
    `port=${signal.portConnected === true ? "connected" : (signal.portConnected === false ? "disconnected" : "(unknown)")}`,
    `pending=${Number.isInteger(signal.pendingRequests) ? signal.pendingRequests : "(n/a)"}`,
    `pingReady=${signal.pingReady === true ? "yes" : "no"}`,
    `lastSeen=${formatTime(signal.lastSeenAt)}`,
    `lastPing=${formatTime(signal.lastPingAt)}`,
    `error=${signal.errorMessage || signal.pingErrorMessage || "(none)"}`
  ];
  return `Bridge signal: ${parts.join(" | ")}`;
}

function formatSelectors(selectorDiagnostics) {
  if (!selectorDiagnostics || typeof selectorDiagnostics !== "object") {
    return "(none)";
  }

  const lines = Object.entries(selectorDiagnostics).map(([key, value]) => {
    if (value && typeof value === "object") {
      const matched = value.matched === true ? "hit" : "miss";
      const selector = typeof value.selector === "string" ? ` selector=${value.selector}` : "";
      return `${key}: ${matched}${selector}`;
    }
    return `${key}: ${String(value)}`;
  });

  return lines.length > 0 ? lines.join("\n") : "(none)";
}

function formatRunTimeline(timeline) {
  if (!timeline) {
    return "(none)";
  }

  const summary = summarizeRunTimeline(timeline);
  if (summary.events.length === 0) {
    return "(none)";
  }

  const lines = [
    `Started: ${formatTime(summary.startedAt)}`,
    `Total: ${formatDurationMs(summary.totalMs)}`
  ];

  for (const event of summary.events) {
    const detail = event.detail ? ` | ${event.detail}` : "";
    lines.push(
      `T+${formatDurationMs(event.sinceStartMs)} (+${formatDurationMs(event.sincePreviousMs)}) [${event.source}] ${describeRunTimelineEvent(event.name)}${detail}`
    );
  }

  return lines.join("\n");
}

function formatSubmitDiagnostics(submitDiagnostics) {
  if (!submitDiagnostics || !Array.isArray(submitDiagnostics.attempts) || submitDiagnostics.attempts.length === 0) {
    return "(none)";
  }

  const lines = [
    `Final submitPath: ${submitDiagnostics.finalSubmitPath || "(none)"}`,
    `Final waitedForButtonMs: ${submitDiagnostics.finalWaitedForButtonMs ?? 0}`,
    `Final sendButtonPresent: ${submitDiagnostics.finalSendButtonPresent ? "yes" : "no"}`,
    `Final preexistingStreamingDetected: ${submitDiagnostics.finalPreexistingStreamingDetected ? "yes" : "no"}`,
    `Final waitedForIdleMs: ${submitDiagnostics.finalWaitedForIdleMs ?? 0}`,
    `Final ackReason: ${submitDiagnostics.finalAckReason || "(none)"}`,
    `Final responseStartReason: ${submitDiagnostics.finalResponseStartReason || "(none)"}`
  ];

  for (const attempt of submitDiagnostics.attempts) {
    lines.push(
      `Attempt ${attempt.attempt}: ok=${attempt.ok ? "yes" : "no"} | submitPath=${attempt.submitPath || "(none)"} | waitMs=${attempt.waitedForButtonMs ?? 0} | sendButtonPresent=${attempt.sendButtonPresent ? "yes" : "no"} | preexistingStreaming=${attempt.preexistingStreamingDetected ? "yes" : "no"} | idleWaitMs=${attempt.waitedForIdleMs ?? 0} | ackReason=${attempt.ackReason || "(none)"} | responseStartReason=${attempt.responseStartReason || "(none)"} | code=${attempt.code || "(none)"}`
    );
  }

  return lines.join("\n");
}

function buildDiagnosticText({
  tab,
  session,
  bridge,
  nowTimestamp
}) {
  const runStartedAt = parseRunStartedAt(session?.runId);
  const waitMs = Number.isInteger(runStartedAt) ? nowTimestamp - runStartedAt : null;
  const waitingTooLong = session?.status === STATUS_WAITING_FOR_RESPONSE && Number.isInteger(waitMs) && waitMs > LONG_WAIT_WARNING_MS;
  const startpageSignal = session?.debug?.startpageScript || {};
  const bridgeSignal = bridge?.signal || session?.debug?.chatgptBridge || {};

  const lines = [
    `Now: ${new Date(nowTimestamp).toLocaleTimeString()}`,
    `Tab: ${tab?.id ?? "(none)"} | URL: ${tab?.url || "(none)"}`,
    `Session status: ${session?.status || "idle"}`,
    `Run ID: ${session?.runId || "(none)"}`,
    `Run started: ${formatTime(runStartedAt)}`,
    `Captured at: ${formatTime(session?.capturedAt)}`,
    `Result count: ${Array.isArray(session?.results) ? session.results.length : 0}`,
    `Progress: ${session?.debug?.progressMessage || "(none)"}`,
    `Last error code: ${session?.debug?.lastErrorCode || session?.lastError?.code || "(none)"}`,
    `Last error message: ${session?.lastError?.message || "(none)"}`,
    "",
    `Startpage signal: phase=${startpageSignal.phase || "(none)"} | lastSeen=${formatTime(startpageSignal.lastSeenAt)} | error=${startpageSignal.errorMessage || "(none)"}`,
    formatBridgeSignal(bridgeSignal),
    `Bridge summary: linked=${bridge?.linked ? "yes" : "no"} | reachable=${bridge?.reachable ? "yes" : "no"} | instance=${bridge?.bridgeInstanceId || "(none)"} | tab=${bridge?.bridgeTabId ?? "(none)"}`,
    ""
  ];

  if (waitingTooLong) {
    lines.push(`Warning: status is waiting_for_response for ${Math.round(waitMs / 1000)}s (possible hang).`);
    lines.push("");
  }

  lines.push("Last prompt preview:");
  lines.push(session?.debug?.lastPrompt ? session.debug.lastPrompt.slice(0, 1500) : "(none)");
  lines.push("");
  lines.push("Selector diagnostics:");
  lines.push(formatSelectors(session?.debug?.selectorDiagnostics));
  lines.push("");
  lines.push("Submit diagnostics:");
  lines.push(formatSubmitDiagnostics(session?.debug?.submitDiagnostics));
  lines.push("");
  lines.push("Run timeline:");
  lines.push(formatRunTimeline(session?.debug?.runTimeline));

  return lines.join("\n");
}

function describeBridge(bridge) {
  if (bridge?.channel === "runtime" && bridge?.bridgeInstanceId) {
    if (bridge.ready) {
      return `Bridge: sidebar runtime reachable (${bridge.bridgeInstanceId})`;
    }
    return `Bridge: sidebar runtime linked (${bridge.bridgeInstanceId}), ping not confirmed`;
  }

  if (!bridge?.bridgeTabId) {
    return "Bridge: no reachable ChatGPT sidebar bridge";
  }

  if (bridge.ready) {
    return `Bridge: sidebar reachable (tab ${bridge.bridgeTabId})`;
  }

  if (bridge.linked) {
    return `Bridge: sidebar linked (tab ${bridge.bridgeTabId}), ping not confirmed`;
  }

  return `Bridge: sidebar context in tab ${bridge.bridgeTabId}`;
}

async function refreshPopupState() {
  const tab = await getActiveTab();
  currentActiveTab = tab;
  const tabId = Number.isInteger(tab?.id) ? tab.id : null;
  const onStartpage = isStartpageUrl(tab?.url);
  const nowTimestamp = Date.now();

  activeTabLabel.textContent = onStartpage
    ? `Tab: Startpage (${tabId ?? "unknown"})`
    : `Tab: ${tab?.url || "unknown page"}`;

  if (!tabId) {
    runStatusLabel.textContent = "Status: idle";
    queryStatusLabel.textContent = "Query: (none)";
    setBridgeStatus("Bridge: unknown");
    setErrorStatus("No active tab detected.");
    if (diagnosticsOutput) {
      diagnosticsOutput.textContent = buildDiagnosticText({
        tab,
        session: null,
        bridge: null,
        nowTimestamp
      });
    }
    if (runNowButton) {
      runNowButton.disabled = true;
    }
    return;
  }

  const stateResponse = await browser.runtime.sendMessage({
    type: MSG.SIDEBAR_GET_STATE,
    sourceTabId: tabId
  });

  if (!stateResponse?.ok) {
    runStatusLabel.textContent = "Status: failed";
    queryStatusLabel.textContent = "Query: (none)";
    setBridgeStatus("Bridge: unavailable");
    setErrorStatus(stateResponse?.error || "Failed to read runtime state.");
    if (diagnosticsOutput) {
      diagnosticsOutput.textContent = buildDiagnosticText({
        tab,
        session: null,
        bridge: null,
        nowTimestamp
      });
    }
    if (runNowButton) {
      runNowButton.disabled = !onStartpage;
    }
    return;
  }

  const session = stateResponse.session || stateResponse.state?.sessions?.[String(tabId)] || null;
  runStatusLabel.textContent = `Status: ${session?.status || "idle"}`;
  queryStatusLabel.textContent = `Query: ${session?.query || "(none captured yet)"}`;
  setBridgeStatus(describeBridge(stateResponse.bridge));
  setErrorStatus(session?.lastError?.message || (onStartpage ? "" : "Switch to Startpage to capture query/results."));
  if (diagnosticsOutput) {
    diagnosticsOutput.textContent = buildDiagnosticText({
      tab,
      session,
      bridge: stateResponse.bridge || null,
      nowTimestamp
    });
  }

  if (runNowButton) {
    runNowButton.disabled = !onStartpage;
  }
}

if (openSidebarButton) {
  openSidebarButton.addEventListener("click", () => {
    let openPromise;

    openSidebarButton.disabled = true;
    try {
      openPromise = openSidebarFromUserGesture(browser.sidebarAction, currentActiveTab);
      setErrorStatus("");
    } catch (error) {
      openSidebarButton.disabled = false;
      const message = error instanceof Error ? error.message : "Sidebar open failed.";
      setErrorStatus(`Open Sidebar failed: ${message}`);
      return;
    }

    Promise.resolve(openPromise)
      .then(() => refreshPopupState())
      .catch((error) => {
        const message = error instanceof Error ? error.message : "Sidebar open failed.";
        setErrorStatus(`Open Sidebar failed: ${message}`);
      })
      .finally(() => {
        openSidebarButton.disabled = false;
      });
  });
}

if (runNowButton) {
  runNowButton.addEventListener("click", async () => {
    const activeTab = await getActiveTab();
    if (!Number.isInteger(activeTab?.id) || !isStartpageUrl(activeTab?.url)) {
      setErrorStatus("Switch to a Startpage results tab before running.");
      return;
    }

    const response = await browser.runtime.sendMessage({
      type: MSG.REQUEST_RUN_FOR_TAB,
      sourceTabId: activeTab.id
    });

    if (!response?.ok) {
      setErrorStatus(response?.error || "Could not queue run.");
      return;
    }

    setErrorStatus("");
    await refreshPopupState();
  });
}

if (refreshStateButton) {
  refreshStateButton.addEventListener("click", () => {
    refreshPopupState().catch((error) => {
      setErrorStatus(error instanceof Error ? error.message : "Failed to refresh diagnostics.");
    });
  });
}

refreshPopupState()
  .then(() => {
    refreshTimerId = globalThis.setInterval(() => {
      refreshPopupState().catch(() => undefined);
    }, 3000);
  })
  .catch((error) => {
    setErrorStatus(error instanceof Error ? error.message : "Failed to initialize popup.");
  });

globalThis.addEventListener("unload", () => {
  if (refreshTimerId) {
    globalThis.clearInterval(refreshTimerId);
    refreshTimerId = null;
  }
});
