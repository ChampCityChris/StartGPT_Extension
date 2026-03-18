import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, STATUS } from "../../src/background/constants.js";
import {
  completeSessionRun,
  failSessionRun,
  getSettings,
  getSession,
  initializeRuntimeState,
  markSessionQueued,
  markSessionRunning,
  markStartpageScriptStatus,
  resetRuntimeState,
  setSession,
  setSettings,
  upsertStartpageSession
} from "../../src/background/state.js";

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
    setSession("1", { status: STATUS.CAPTURED });
    expect(getSession("1")?.status).toBe(STATUS.CAPTURED);
  });

  it("upserts startpage context into a normalized session", () => {
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
    expect(session?.debug?.progressMessage).toBe("Context captured. Automatic quick overview will start shortly.");
  });

  it("preserves running status while context updates on the same page", () => {
    resetRuntimeState();
    setSession(12, {
      query: "best camera",
      startpageUrl: "https://www.startpage.com/sp/search?query=best+camera",
      status: STATUS.RUNNING,
      runId: "run_12_1",
      response: null,
      debug: {
        progressMessage: "Running"
      }
    });

    upsertStartpageSession(12, {
      query: "best camera",
      pageUrl: "https://www.startpage.com/sp/search?query=best+camera",
      capturedAt: 12346,
      results: [{ rank: 1, title: "A", url: "https://example.com", snippet: "", displayUrl: "" }]
    });

    const session = getSession(12);
    expect(session?.status).toBe(STATUS.RUNNING);
    expect(session?.runId).toBe("run_12_1");
  });

  it("tracks startpage script status", () => {
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

  it("marks queued and running states", () => {
    resetRuntimeState();
    setSession(2, {
      status: STATUS.CAPTURED,
      debug: {}
    });
    markSessionQueued(2);
    expect(getSession(2)?.status).toBe(STATUS.QUEUED);
    markSessionRunning(2, "run_2_1", "prompt preview");
    expect(getSession(2)?.status).toBe(STATUS.RUNNING);
    expect(getSession(2)?.runId).toBe("run_2_1");
    expect(getSession(2)?.debug?.lastPrompt).toContain("prompt");
  });

  it("completes and fails runs with stale-run protection", () => {
    resetRuntimeState();
    setSession(3, {
      status: STATUS.RUNNING,
      runId: "run_3_1",
      debug: {}
    });

    const staleComplete = completeSessionRun(3, {
      runId: "run_3_old",
      response: { text: "ignored", sources: [] }
    });
    expect(staleComplete.applied).toBe(false);

    const completed = completeSessionRun(3, {
      runId: "run_3_1",
      response: { text: "ok", sources: [] }
    });
    expect(completed.applied).toBe(true);
    expect(getSession(3)?.status).toBe(STATUS.COMPLETED);

    const failed = failSessionRun(3, {
      runId: "run_3_1",
      code: "OPENAI_TIMEOUT",
      message: "timed out",
      diagnostics: {
        responseStatus: "incomplete",
        incompleteReason: "max_output_tokens"
      }
    });
    expect(failed.applied).toBe(true);
    expect(getSession(3)?.status).toBe(STATUS.FAILED);
    expect(getSession(3)?.lastError?.code).toBe("OPENAI_TIMEOUT");
    expect(getSession(3)?.lastError?.diagnostics?.incompleteReason).toBe("max_output_tokens");
    expect(getSession(3)?.debug?.lastErrorDiagnostics?.responseStatus).toBe("incomplete");
  });

  it("loads settings from storage and merges defaults", async () => {
    resetRuntimeState();
    await initializeRuntimeState(
      createStorageMock({
        maxResults: 3,
        model: "gpt-4.1"
      })
    );

    const settings = getSettings();
    expect(settings.maxResults).toBe(3);
    expect(settings.model).toBe("gpt-4.1");
    expect(settings.defaultSummaryMode).toBe(DEFAULT_SETTINGS.defaultSummaryMode);
  });

  it("updates settings in memory", () => {
    resetRuntimeState();
    setSettings({ model: "gpt-4.1", maxResults: 4 });
    expect(getSettings().model).toBe("gpt-4.1");
    expect(getSettings().maxResults).toBe(4);
  });
});
