import { describe, expect, it } from "vitest";
import { buildDiagnosticText } from "../../src/popup/diagnostics.js";

describe("popup diagnostics", () => {
  it("shows error usage.output_tokens vs cap diagnostics", () => {
    const diagnostics = buildDiagnosticText(
      {
        id: 99,
        url: "https://www.startpage.com/sp/search?query=test"
      },
      {
        tabId: 99,
        status: "failed",
        lastError: {
          diagnostics: {
            responseStatus: "incomplete",
            incompleteReason: "max_output_tokens",
            usageOutputTokens: 4000,
            maxOutputTokensCap: 4000,
            requestedMaxOutputTokens: 4000,
            retryBlockedByCap: true
          }
        },
        response: {
          usageByMode: {
            expanded_perplexity: {
              outputTokens: 3900,
              maxOutputTokensCap: 4000
            }
          }
        }
      },
      {
        hasApiKey: true,
        state: {
          settings: {
            model: "gpt-5-nano",
            defaultSummaryMode: "quick_overview"
          },
          global: {
            activeSidebarTabId: 99
          }
        }
      },
      "overview text",
      {
        ok: true,
        sourceTabId: 99,
        status: "completed",
        query: "test",
        summaryMode: "expanded_perplexity",
        overviewText: "overview text"
      }
    );

    expect(diagnostics).toContain("Tab Overview Snapshot: yes");
    expect(diagnostics).toContain("Tab Overview Mode: expanded_perplexity");
    expect(diagnostics).toContain("Tab Overview Chars: 13");
    expect(diagnostics).toContain("OpenAI usage.output_tokens: 4000");
    expect(diagnostics).toContain("OpenAI max_output_tokens cap: 4000");
    expect(diagnostics).toContain("OpenAI usage.output_tokens vs cap: 4000/4000 (at cap)");
    expect(diagnostics).toContain("OpenAI requested max_output_tokens: 4000");
    expect(diagnostics).toContain("OpenAI Retry blocked by cap: yes");
    expect(diagnostics).toContain("Deep usage.output_tokens: 3900");
    expect(diagnostics).toContain("Deep max_output_tokens cap: 4000");
    expect(diagnostics).toContain("Deep usage.output_tokens vs cap: 3900/4000 (under by 100)");
  });

  it("falls back when usage/cap values are unavailable", () => {
    const diagnostics = buildDiagnosticText(
      {
        id: 11,
        url: "https://www.startpage.com/sp/search?query=test"
      },
      {
        tabId: 11,
        status: "idle",
        lastError: {
          diagnostics: {}
        },
        response: {
          usageByMode: {}
        }
      },
      {
        hasApiKey: false,
        state: {
          settings: {},
          global: {
            activeSidebarTabId: null
          }
        }
      },
      "",
      null
    );

    expect(diagnostics).toContain("Tab Overview Snapshot: no");
    expect(diagnostics).toContain("Tab Overview Mode: (none)");
    expect(diagnostics).toContain("OpenAI usage.output_tokens: (none)");
    expect(diagnostics).toContain("OpenAI max_output_tokens cap: (none)");
    expect(diagnostics).toContain("OpenAI usage.output_tokens vs cap: (unknown)");
    expect(diagnostics).toContain("Deep usage.output_tokens: (none)");
    expect(diagnostics).toContain("Deep max_output_tokens cap: (none)");
    expect(diagnostics).toContain("Deep usage.output_tokens vs cap: (unknown)");
  });
});
