import { describe, expect, it } from "vitest";
import { buildPrompt } from "../../src/background/prompt-builder.js";

const RESULTS = [
  {
    rank: 2,
    title: "Second Result",
    url: "https://example.com/second",
    snippet: "Second snippet",
    displayUrl: "example.com/second"
  },
  {
    rank: 1,
    title: "First Result",
    url: "https://example.com/first",
    snippet: "First snippet",
    displayUrl: "example.com/first"
  }
];

describe("buildPrompt", () => {
  it("includes query and ordered visible results", () => {
    const prompt = buildPrompt({ query: "best camera", results: RESULTS });

    expect(prompt).toContain("User Query:");
    expect(prompt).toContain("best camera");

    const firstIndex = prompt.indexOf("[1] First Result");
    const secondIndex = prompt.indexOf("[2] Second Result");
    expect(firstIndex).toBeGreaterThan(-1);
    expect(secondIndex).toBeGreaterThan(-1);
    expect(firstIndex).toBeLessThan(secondIndex);
  });

  it("changes instructions based on summary mode", () => {
    const quickPrompt = buildPrompt({
      query: "electric cars",
      results: RESULTS,
      mode: "quick_overview"
    });
    expect(quickPrompt).toContain("quick overview");

    const expandedPrompt = buildPrompt({
      query: "electric cars",
      results: RESULTS,
      mode: "expanded_perplexity"
    });
    expect(expandedPrompt).toContain("Key Takeaways");
    expect(expandedPrompt).toContain("inline bracket citations");
  });

  it("includes follow-up context when provided", () => {
    const prompt = buildPrompt({
      query: "electric cars",
      results: RESULTS,
      followUp: "What should I verify first?",
      previousAnswer: "Earlier answer"
    });

    expect(prompt).toContain("Follow-Up Question:");
    expect(prompt).toContain("What should I verify first?");
    expect(prompt).toContain("Previous Assistant Answer:");
  });
});
