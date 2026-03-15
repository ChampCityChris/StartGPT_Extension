import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, STATUS } from "../../src/background/constants.js";
import {
  appendSessionRunTimelineEvent,
  getChatGptBridgeStatus,
  getSettings,
  getState,
  getSession,
  initializeRuntimeState,
  markChatGptBridgePingReady,
  markChatGptBridgeStatus,
  markStartpageScriptStatus,
  resetSessionRunTimeline,
  resetRuntimeState,
  setStartpageCaptureFailure,
  setSession,
  setSessionStatus,
  upsertStartpageSession
} from "../../src/background/state.js";
import { RUN_TIMELINE_EVENT } from "../../src/content/shared/run-timeline.js";

function createStorageMock(settings = null) {
  return {
    async get() {
      if (!settings) {
        return {};
      }
      return { settings };
    },
    async set() {
      return undefined;
    }
  };
}

describe("state helpers", () => {
  it("stores and reads a session by tab id", () => {
    resetRuntimeState();
    setSession("1", { status: "captured" });
    expect(getSession("1")?.status).toBe("captured");
  });

  it("upserts startpage payload into a normalized session", () => {
    resetRuntimeState();
    upsertStartpageSession(12, {
      query: "best camera",
      pageUrl: "https://www.startpage.com/sp/search?query=best+camera",
      capturedAt: 12345,
      results: [{ rank: 1, title: "A", url: "https://example.com", snippet: "", displayUrl: "" }]
    });

    const session = getSession(12);
    expect(session?.query).toBe("best camera");
    expect(session?.status).toBe(STATUS.CAPTURED);
    expect(session?.results).toHaveLength(1);
    expect(session?.debug?.runTimeline?.events?.[0]?.name).toBe(RUN_TIMELINE_EVENT.STARTPAGE_CONTEXT_CAPTURED);
  });

  it("clears stale response state when a new Startpage query arrives in the same tab", () => {
    resetRuntimeState();
    setSession(12, {
      query: "old query",
      startpageUrl: "https://www.startpage.com/sp/search?query=old+query",
      capturedAt: 111,
      results: [{ rank: 1, title: "Old", url: "https://example.com/old", snippet: "", displayUrl: "" }],
      status: STATUS.WAITING_FOR_RESPONSE,
      runId: "run_12_111",
      response: {
        text: "Old overview",
        sources: [{ title: "Old source", url: "https://example.com/old" }]
      },
      lastError: {
        code: "OLD_ERROR",
        message: "Old failure",
        recoverable: true
      },
      debug: {
        lastPrompt: "old prompt",
        lastErrorCode: "OLD_ERROR",
        bridgeTabId: 99,
        selectorDiagnostics: { composer: true },
        progressMessage: "Old run still active."
      }
    });

    upsertStartpageSession(12, {
      query: "new query",
      pageUrl: "https://www.startpage.com/sp/search?query=new+query",
      capturedAt: 222,
      results: [{ rank: 1, title: "New", url: "https://example.com/new", snippet: "", displayUrl: "" }]
    });

    const session = getSession(12);
    expect(session?.query).toBe("new query");
    expect(session?.status).toBe(STATUS.CAPTURED);
    expect(session?.runId).toBe("");
    expect(session?.response).toBeNull();
    expect(session?.lastError).toBeNull();
    expect(session?.debug?.lastPrompt).toBe("");
    expect(session?.debug?.lastErrorCode).toBe("");
    expect(session?.debug?.selectorDiagnostics).toEqual({});
  });

  it("updates session status with named helper", () => {
    resetRuntimeState();
    setSession(7, { status: STATUS.IDLE });
    setSessionStatus(7, STATUS.QUEUED);
    expect(getSession(7)?.status).toBe(STATUS.QUEUED);
  });

  it("resets and appends session run timeline events", () => {
    resetRuntimeState();
    setSession(7, {
      status: STATUS.CAPTURED,
      capturedAt: 1000,
      debug: {}
    });

    resetSessionRunTimeline(7, {
      startedAt: 2000,
      events: [
        {
          name: RUN_TIMELINE_EVENT.RUN_QUEUED,
          at: 2000,
          source: "background"
        }
      ]
    });
    appendSessionRunTimelineEvent(7, {
      name: RUN_TIMELINE_EVENT.RUN_STARTED,
      at: 2500,
      source: "background"
    });

    const timeline = getSession(7)?.debug?.runTimeline;
    expect(timeline?.startedAt).toBe(2000);
    expect(timeline?.events).toHaveLength(2);
    expect(timeline?.events?.[1]?.name).toBe(RUN_TIMELINE_EVENT.RUN_STARTED);
  });

  it("stores a startpage capture failure as a recoverable failed session", () => {
    resetRuntimeState();
    setStartpageCaptureFailure(4, {
      query: "camera",
      pageUrl: "https://startpage.com/search?q=camera",
      capturedAt: 23456,
      code: "STARTPAGE_RESULTS_NOT_FOUND",
      message: "No visible results matched selectors.",
      selectorDiagnostics: {
        resultCount: 0
      }
    });

    const session = getSession(4);
    expect(session?.status).toBe(STATUS.FAILED);
    expect(session?.lastError?.code).toBe("STARTPAGE_RESULTS_NOT_FOUND");
    expect(session?.debug?.selectorDiagnostics?.resultCount).toBe(0);
  });

  it("clears the previous overview when a new query fails capture in the same tab", () => {
    resetRuntimeState();
    setSession(4, {
      query: "old query",
      startpageUrl: "https://startpage.com/search?q=old+query",
      capturedAt: 100,
      status: STATUS.COMPLETED,
      runId: "run_4_100",
      response: {
        text: "Old overview",
        sources: []
      },
      debug: {
        lastPrompt: "old prompt",
        lastErrorCode: "",
        bridgeTabId: null,
        selectorDiagnostics: {},
        progressMessage: "Overview complete."
      }
    });

    setStartpageCaptureFailure(4, {
      query: "new query",
      pageUrl: "https://startpage.com/search?q=new+query",
      capturedAt: 200,
      code: "STARTPAGE_RESULTS_NOT_FOUND",
      message: "No visible results matched selectors."
    });

    const session = getSession(4);
    expect(session?.runId).toBe("");
    expect(session?.response).toBeNull();
    expect(session?.debug?.lastPrompt).toBe("");
    expect(session?.lastError?.code).toBe("STARTPAGE_RESULTS_NOT_FOUND");
  });

  it("stores startpage script status before any capture happens", () => {
    resetRuntimeState();
    markStartpageScriptStatus(9, {
      phase: "module_loaded",
      pageUrl: "https://startpage.com/search?q=camera",
      lastSeenAt: 34567
    });

    const session = getSession(9);
    expect(session?.status).toBe(STATUS.IDLE);
    expect(session?.debug?.startpageScript?.phase).toBe("module_loaded");
    expect(session?.debug?.startpageScript?.lastSeenAt).toBe(34567);
  });

  it("stores chatgpt bridge status by sender context without creating a fake source session", () => {
    resetRuntimeState();
    markChatGptBridgeStatus(22, {
      phase: "module_loaded",
      pageUrl: "https://chatgpt.com/",
      lastSeenAt: 45678,
      bridgeTabId: 22,
      frameId: 0
    });

    expect(getState().global.chatgptBridgeStatus.phase).toBe("module_loaded");
    expect(getState().global.chatgptBridgeStatus.lastSeenAt).toBe(45678);
    expect(getChatGptBridgeStatus(22)?.frameId).toBe(0);
    expect(getChatGptBridgeStatus(22)?.phase).toBe("module_loaded");
    expect(getSession(22)).toBeNull();
  });

  it("marks a linked bridge as reachable only after ping confirmation", () => {
    resetRuntimeState();
    setSession(11, {
      status: STATUS.OPENING_BRIDGE,
      bridgeTabId: 22,
      debug: {}
    });

    markChatGptBridgeStatus(22, {
      phase: "module_loaded",
      pageUrl: "https://chatgpt.com/",
      lastSeenAt: 45678,
      bridgeTabId: 22
    });
    markChatGptBridgePingReady(22, {
      bridgeTabId: 22,
      lastPingAt: 56789,
      loggedIn: true,
      hasComposer: true
    });

    expect(getChatGptBridgeStatus(22)?.pingReady).toBe(true);
    expect(getChatGptBridgeStatus(22)?.lastPingAt).toBe(56789);
    expect(getSession(11)?.debug?.chatgptBridge?.pingReady).toBe(true);
    expect(getSession(11)?.debug?.chatgptBridge?.bridgeTabId).toBe(22);
  });

  it("loads settings from storage and merges defaults", async () => {
    resetRuntimeState();
    await initializeRuntimeState(
      createStorageMock({
        maxResults: 3,
        autoRunOnStartpage: false
      })
    );

    const settings = getSettings();
    expect(settings.maxResults).toBe(3);
    expect(settings.autoRunOnStartpage).toBe(false);
    expect(settings.promptMode).toBe(DEFAULT_SETTINGS.promptMode);
  });
});
