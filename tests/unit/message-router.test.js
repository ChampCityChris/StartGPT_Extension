import { afterEach, describe, expect, it, vi } from "vitest";
import { routeMessage } from "../../src/background/message-router.js";
import { MSG } from "../../src/content/shared/message-types.js";

const originalBrowser = globalThis.browser;

afterEach(() => {
  globalThis.browser = originalBrowser;
});

describe("message router", () => {
  it("accepts valid startpage payload from startpage sender", async () => {
    const payload = {
      type: MSG.STARTPAGE_CONTEXT_FOUND,
      pageUrl: "https://www.startpage.com/sp/search?query=test",
      capturedAt: Date.now(),
      query: "test",
      results: [
        {
          rank: 1,
          title: "Example",
          url: "https://example.com",
          snippet: "Snippet",
          displayUrl: "example.com"
        }
      ]
    };

    const result = await routeMessage(payload, {
      tab: {
        id: 10,
        url: "https://www.startpage.com/sp/search?query=test"
      }
    });

    expect(result.ok).toBe(true);
    expect(result.command).toBe("startpage_context_found");
  });

  it("rejects startpage payload from non-startpage sender", async () => {
    const result = await routeMessage({
      type: MSG.STARTPAGE_CONTEXT_FOUND,
      pageUrl: "https://www.startpage.com/sp/search?query=test",
      capturedAt: Date.now(),
      query: "test",
      results: []
    }, {
      tab: {
        id: 10,
        url: "https://example.com/"
      }
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBe("unauthorized_sender");
  });

  it("rejects unknown message types", async () => {
    const result = await routeMessage({ type: "UNKNOWN" }, {});
    expect(result.ok).toBe(false);
    expect(result.error).toBe("unknown_type");
  });

  it("routes API-key validation without an entered key", async () => {
    const result = await routeMessage({
      type: MSG.OPTIONS_VALIDATE_API_KEY
    }, {
      url: "moz-extension://test/options/options.html"
    });

    expect(result.ok).toBe(true);
    expect(result.command).toBe("options_validate_api_key");
  });

  it("accepts run requests from Startpage sender", async () => {
    const result = await routeMessage({
      type: MSG.REQUEST_RUN_FOR_TAB,
      sourceTabId: 10,
      summaryMode: "expanded_perplexity"
    }, {
      tab: {
        id: 10,
        url: "https://www.startpage.com/sp/search?query=test"
      }
    });

    expect(result.ok).toBe(true);
    expect(result.command).toBe("request_run");
    expect(result.sourceTabId).toBe(10);
    expect(result.summaryMode).toBe("expanded_perplexity");
  });

  it("falls back to browser.tabs.query when sender.tab.id is missing", async () => {
    globalThis.browser = {
      tabs: {
        query: vi.fn(async () => ([
          {
            id: 263,
            active: true,
            url: "https://www.startpage.com/sp/search"
          }
        ]))
      }
    };

    const result = await routeMessage({
      type: MSG.STARTPAGE_SCRIPT_STATUS,
      phase: "module_loaded",
      pageUrl: "https://www.startpage.com/sp/search",
      lastSeenAt: Date.now()
    }, {
      tab: {
        url: "https://www.startpage.com/sp/search"
      }
    });

    expect(result.ok).toBe(true);
    expect(result.command).toBe("startpage_script_status");
    expect(result.sourceTabId).toBe(263);
  });

  it("accepts options maxOutputTokens up to expanded cap", async () => {
    const result = await routeMessage({
      type: MSG.OPTIONS_SAVE_SETTINGS,
      settings: {
        maxOutputTokens: 750
      }
    }, {
      url: "moz-extension://test/options/options.html"
    });

    expect(result.ok).toBe(true);
    expect(result.command).toBe("options_save_settings");
  });

  it("rejects run requests from non-extension non-startpage sender", async () => {
    const result = await routeMessage({
      type: MSG.REQUEST_RUN_FOR_TAB,
      sourceTabId: 10
    }, {
      tab: {
        id: 10,
        url: "https://example.com/"
      }
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBe("unauthorized_sender");
  });
});
