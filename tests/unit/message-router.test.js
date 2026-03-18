import { describe, expect, it } from "vitest";
import { routeMessage } from "../../src/background/message-router.js";
import { MSG } from "../../src/content/shared/message-types.js";

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
});
