import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, STATUS } from "../../src/background/constants.js";
import {
  buildContextFingerprint,
  completeSessionRun,
  failSessionRun,
  getSettings,
  getSession,
  initializeRuntimeState,
  markAutoQuickQueued,
  markSessionQueued,
  markSessionRunning,
  markStartpageScriptStatus,
  resetRuntimeState,
  setSession,
  setSettings,
  shouldAutoQueueQuickOverview,
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

  it("keeps completed status and response for unchanged context", () => {
    resetRuntimeState();
    setSession(12, {
      query: "best camera",
      startpageUrl: "https://www.startpage.com/sp/search?query=best+camera",
      status: STATUS.COMPLETED,
      response: { text: "Existing overview", sources: [] },
      completedAt: 99999,
      debug: {}
    });

    upsertStartpageSession(12, {
      query: "best camera",
      pageUrl: "https://www.startpage.com/sp/search?query=best+camera",
      capturedAt: 12346,
      results: [{ rank: 1, title: "A", url: "https://example.com", snippet: "", displayUrl: "" }]
    });

    const session = getSession(12);
    expect(session?.status).toBe(STATUS.COMPLETED);
    expect(session?.response?.text).toBe("Existing overview");
    expect(session?.completedAt).toBe(99999);
  });

  it("keeps deep-dive completion when only url form changes for same query/results", () => {
    resetRuntimeState();
    setSession(44, {
      query: "school calendar",
      startpageUrl: "https://www.startpage.com/sp/search?query=school+calendar&cat=web",
      status: STATUS.COMPLETED,
      response: {
        text: "Deep dive overview",
        mode: "expanded_perplexity",
        sources: [{ title: "Source", url: "https://example.org/a" }]
      },
      completedAt: 55555,
      results: [
        { rank: 1, title: "District calendar", url: "https://example.org/a", snippet: "", displayUrl: "example.org" },
        { rank: 2, title: "Events", url: "https://example.org/b", snippet: "", displayUrl: "example.org" }
      ],
      debug: {}
    });

    upsertStartpageSession(44, {
      query: "school calendar",
      pageUrl: "https://www.startpage.com/sp/search?query=school+calendar",
      capturedAt: 77777,
      results: [
        { rank: 1, title: "District calendar", url: "https://example.org/a", snippet: "", displayUrl: "example.org" },
        { rank: 2, title: "Events", url: "https://example.org/b", snippet: "", displayUrl: "example.org" }
      ]
    });

    const session = getSession(44);
    expect(session?.status).toBe(STATUS.COMPLETED);
    expect(session?.response?.mode).toBe("expanded_perplexity");
    expect(session?.response?.text).toBe("Deep dive overview");
    expect(session?.completedAt).toBe(55555);
  });

  it("keeps completed response when results reorder but urls stay the same", () => {
    resetRuntimeState();
    setSession(55, {
      query: "camera reviews",
      startpageUrl: "https://www.startpage.com/sp/search?query=camera+reviews",
      status: STATUS.COMPLETED,
      response: {
        text: "Deep dive kept",
        mode: "expanded_perplexity",
        sources: [{ title: "One", url: "https://example.net/1" }]
      },
      completedAt: 88888,
      results: [
        { rank: 1, title: "One", url: "https://example.net/1", snippet: "", displayUrl: "example.net" },
        { rank: 2, title: "Two", url: "https://example.net/2", snippet: "", displayUrl: "example.net" }
      ],
      contextFingerprint: buildContextFingerprint("camera reviews", [
        { url: "https://example.net/1" },
        { url: "https://example.net/2" }
      ]),
      debug: {}
    });

    upsertStartpageSession(55, {
      query: "camera reviews",
      pageUrl: "https://www.startpage.com/sp/search?query=camera+reviews",
      capturedAt: 99999,
      results: [
        { rank: 1, title: "Two (new title)", url: "https://example.net/2", snippet: "changed", displayUrl: "example.net" },
        { rank: 2, title: "One (new title)", url: "https://example.net/1", snippet: "changed", displayUrl: "example.net" }
      ]
    });

    const session = getSession(55);
    expect(session?.status).toBe(STATUS.COMPLETED);
    expect(session?.response?.text).toBe("Deep dive kept");
    expect(session?.response?.mode).toBe("expanded_perplexity");
  });

  it("normalizes startpage redirect wrappers to a stable context fingerprint", () => {
    const query = "weather tomorrow";
    const firstFingerprint = buildContextFingerprint(query, [
      {
        url: "https://www.startpage.com/sp/click?url=https%3A%2F%2Fexample.com%2Fforecast%3Fid%3D42%26utm_source%3Dsp&lui=english&sc=a1b2"
      }
    ]);
    const secondFingerprint = buildContextFingerprint(query, [
      {
        url: "https://www.startpage.com/sp/click?sc=z9y8&url=https%3A%2F%2Fexample.com%2Fforecast%3Futm_medium%3Dcpc%26id%3D42&lui=en-US"
      }
    ]);

    expect(firstFingerprint).toBe(secondFingerprint);
    expect(firstFingerprint).toContain("https://example.com/forecast?id=42");
  });

  it("does not re-queue automatic quick overview when only tracking params change", () => {
    resetRuntimeState();

    upsertStartpageSession(67, {
      query: "weather tomorrow",
      pageUrl: "https://www.startpage.com/sp/search?query=weather+tomorrow",
      capturedAt: 123,
      results: [
        {
          rank: 1,
          title: "Forecast",
          url: "https://www.startpage.com/sp/click?url=https%3A%2F%2Fexample.com%2Fforecast%3Fid%3D42%26utm_source%3Dsp&sc=abc",
          snippet: "",
          displayUrl: "example.com"
        }
      ]
    });

    const firstCapture = getSession(67);
    expect(shouldAutoQueueQuickOverview(firstCapture)).toBe(true);
    markAutoQuickQueued(67, firstCapture?.contextFingerprint);

    upsertStartpageSession(67, {
      query: "weather tomorrow",
      pageUrl: "https://www.startpage.com/sp/search?query=weather+tomorrow",
      capturedAt: 124,
      results: [
        {
          rank: 1,
          title: "Forecast",
          url: "https://www.startpage.com/sp/click?sc=def&url=https%3A%2F%2Fexample.com%2Fforecast%3Futm_medium%3Dcpc%26id%3D42",
          snippet: "updated snippet",
          displayUrl: "example.com"
        }
      ]
    });

    const secondCapture = getSession(67);
    expect(shouldAutoQueueQuickOverview(secondCapture)).toBe(false);
  });

  it("keeps deep-dive completion when only redirect wrapper params change", () => {
    resetRuntimeState();
    setSession(68, {
      query: "weather tomorrow",
      startpageUrl: "https://www.startpage.com/sp/search?query=weather+tomorrow",
      status: STATUS.COMPLETED,
      response: {
        text: "Deep dive overview",
        mode: "expanded_perplexity",
        sources: [{ title: "Source", url: "https://example.com/forecast?id=42" }]
      },
      completedAt: 9999,
      results: [
        {
          rank: 1,
          title: "Forecast",
          url: "https://www.startpage.com/sp/click?url=https%3A%2F%2Fexample.com%2Fforecast%3Fid%3D42%26utm_source%3Dsp&sc=abc",
          snippet: "",
          displayUrl: "example.com"
        }
      ],
      contextFingerprint: buildContextFingerprint("weather tomorrow", [
        {
          url: "https://www.startpage.com/sp/click?url=https%3A%2F%2Fexample.com%2Fforecast%3Fid%3D42%26utm_source%3Dsp&sc=abc"
        }
      ]),
      debug: {}
    });

    upsertStartpageSession(68, {
      query: "weather tomorrow",
      pageUrl: "https://www.startpage.com/sp/search?query=weather+tomorrow",
      capturedAt: 10000,
      results: [
        {
          rank: 1,
          title: "Forecast updated",
          url: "https://www.startpage.com/sp/click?sc=def&url=https%3A%2F%2Fexample.com%2Fforecast%3Futm_medium%3Dcpc%26id%3D42",
          snippet: "updated snippet",
          displayUrl: "example.com"
        }
      ]
    });

    const session = getSession(68);
    expect(session?.status).toBe(STATUS.COMPLETED);
    expect(session?.response?.mode).toBe("expanded_perplexity");
    expect(session?.response?.text).toBe("Deep dive overview");
    expect(session?.completedAt).toBe(9999);
  });

  it("locks completed deep-dive output for the same query even when results change", () => {
    resetRuntimeState();
    setSession(69, {
      query: "weather tomorrow",
      startpageUrl: "https://www.startpage.com/sp/search?query=weather+tomorrow",
      status: STATUS.COMPLETED,
      response: {
        text: "Deep dive overview",
        mode: "expanded_perplexity",
        sources: [{ title: "Source", url: "https://example.com/a" }]
      },
      completedAt: 4444,
      results: [
        { rank: 1, title: "A", url: "https://example.com/a", snippet: "", displayUrl: "example.com" }
      ],
      contextFingerprint: buildContextFingerprint("weather tomorrow", [
        { url: "https://example.com/a" }
      ]),
      debug: {}
    });

    upsertStartpageSession(69, {
      query: "weather tomorrow",
      pageUrl: "https://www.startpage.com/sp/search?query=weather+tomorrow",
      capturedAt: 5555,
      results: [
        { rank: 1, title: "Completely different", url: "https://different.example.org/z", snippet: "", displayUrl: "different.example.org" }
      ]
    });

    const session = getSession(69);
    expect(session?.status).toBe(STATUS.COMPLETED);
    expect(session?.response?.mode).toBe("expanded_perplexity");
    expect(session?.response?.text).toBe("Deep dive overview");
    expect(session?.completedAt).toBe(4444);
  });

  it("unlocks completed output when query changes", () => {
    resetRuntimeState();
    setSession(70, {
      query: "weather tomorrow",
      startpageUrl: "https://www.startpage.com/sp/search?query=weather+tomorrow",
      status: STATUS.COMPLETED,
      response: {
        text: "Cached quick overview",
        mode: "quick_overview",
        sources: [{ title: "Source", url: "https://example.com/a" }]
      },
      completedAt: 1010,
      results: [
        { rank: 1, title: "A", url: "https://example.com/a", snippet: "", displayUrl: "example.com" }
      ],
      contextFingerprint: buildContextFingerprint("weather tomorrow", [
        { url: "https://example.com/a" }
      ]),
      debug: {}
    });

    upsertStartpageSession(70, {
      query: "weather today",
      pageUrl: "https://www.startpage.com/sp/search?query=weather+today",
      capturedAt: 2020,
      results: [
        { rank: 1, title: "B", url: "https://example.com/b", snippet: "", displayUrl: "example.com" }
      ]
    });

    const session = getSession(70);
    expect(session?.status).toBe(STATUS.CAPTURED);
    expect(session?.response).toBeNull();
    expect(session?.completedAt).toBeNull();
  });

  it("gates automatic quick overview for the same context fingerprint", () => {
    resetRuntimeState();

    upsertStartpageSession(66, {
      query: "weather tomorrow",
      pageUrl: "https://www.startpage.com/sp/search?query=weather+tomorrow",
      capturedAt: 123,
      results: [
        { rank: 1, title: "Forecast", url: "https://example.com/weather", snippet: "", displayUrl: "example.com" }
      ]
    });

    const firstCapture = getSession(66);
    expect(firstCapture?.status).toBe(STATUS.CAPTURED);
    expect(shouldAutoQueueQuickOverview(firstCapture)).toBe(true);

    markAutoQuickQueued(66, firstCapture?.contextFingerprint);
    const afterAutoQueued = getSession(66);
    expect(shouldAutoQueueQuickOverview(afterAutoQueued)).toBe(false);

    upsertStartpageSession(66, {
      query: "weather tomorrow",
      pageUrl: "https://www.startpage.com/sp/search?query=weather+tomorrow",
      capturedAt: 124,
      results: [
        { rank: 1, title: "Forecast (updated text)", url: "https://example.com/weather", snippet: "updated", displayUrl: "example.com" }
      ]
    });
    expect(shouldAutoQueueQuickOverview(getSession(66))).toBe(false);

    upsertStartpageSession(66, {
      query: "weather tomorrow",
      pageUrl: "https://www.startpage.com/sp/search?query=weather+tomorrow",
      capturedAt: 125,
      results: [
        { rank: 1, title: "Different url", url: "https://example.com/weather-hourly", snippet: "", displayUrl: "example.com" }
      ]
    });
    expect(shouldAutoQueueQuickOverview(getSession(66))).toBe(true);
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
