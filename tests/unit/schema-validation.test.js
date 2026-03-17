import { describe, expect, it } from "vitest";
import {
  validateFollowUpPayload,
  validateOptionsSavePayload,
  validateRunRequestPayload,
  validateStartpageContextPayload
} from "../../src/content/shared/schema.js";
import { MSG } from "../../src/content/shared/message-types.js";

const VALID_CONTEXT = {
  type: MSG.STARTPAGE_CONTEXT_FOUND,
  pageUrl: "https://www.startpage.com/sp/search?query=test",
  capturedAt: 123456,
  query: "test query",
  results: [
    {
      rank: 1,
      title: "Example",
      url: "https://example.com",
      snippet: "Example snippet",
      displayUrl: "example.com"
    }
  ]
};

describe("message schema validation", () => {
  it("accepts a valid Startpage context payload", () => {
    const validation = validateStartpageContextPayload(VALID_CONTEXT, {
      maxMessageBytes: 50000,
      maxQueryChars: 500,
      maxResultCount: 10
    });

    expect(validation.ok).toBe(true);
  });

  it("rejects oversized and malformed Startpage payloads", () => {
    const validation = validateStartpageContextPayload({
      ...VALID_CONTEXT,
      query: "x".repeat(1200),
      results: []
    }, {
      maxMessageBytes: 50000,
      maxQueryChars: 500,
      maxResultCount: 10
    });

    expect(validation.ok).toBe(false);
    expect(validation.errors.join(" | ")).toContain("query must be");
    expect(validation.errors.join(" | ")).toContain("results must contain");
  });

  it("validates run/follow-up payloads", () => {
    expect(validateRunRequestPayload({
      type: MSG.REQUEST_RUN_FOR_TAB,
      sourceTabId: 5
    }).ok).toBe(true);

    expect(validateFollowUpPayload({
      type: MSG.SIDEBAR_FOLLOW_UP,
      sourceTabId: 5,
      followUp: "What should I verify?"
    }, 1200).ok).toBe(true);
  });

  it("rejects disallowed options models", () => {
    const validation = validateOptionsSavePayload({
      type: MSG.OPTIONS_SAVE_SETTINGS,
      settings: {
        model: "not-allowlisted"
      }
    }, {
      allowedModels: ["gpt-4.1-mini"],
      allowedSummaryModes: ["quick_overview", "expanded_perplexity"],
      maxResultsCap: 10,
      maxOutputTokensCap: 1200,
      timeoutMsCap: 60000
    });

    expect(validation.ok).toBe(false);
    expect(validation.errors.join(" | ")).toContain("allowlisted");
  });
});
