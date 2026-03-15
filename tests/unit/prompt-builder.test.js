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

    expect(prompt).toContain("User query:");
    expect(prompt).toContain("best camera");

    const firstIndex = prompt.indexOf("1. First Result");
    const secondIndex = prompt.indexOf("2. Second Result");
    expect(firstIndex).toBeGreaterThan(-1);
    expect(secondIndex).toBeGreaterThan(-1);
    expect(firstIndex).toBeLessThan(secondIndex);
  });

  it("changes task section based on mode", () => {
    const comparePrompt = buildPrompt({
      query: "electric cars",
      results: RESULTS,
      mode: "compare_results"
    });

    expect(comparePrompt).toContain("Compare the strongest disagreements");

    const clickPrompt = buildPrompt({
      query: "electric cars",
      results: RESULTS,
      mode: "click_recommendations"
    });

    expect(clickPrompt).toContain("Recommend which 1-3 results to click first and why.");
  });

  it("is deterministic for same input", () => {
    const one = buildPrompt({ query: "x", results: RESULTS, mode: "grounded_overview" });
    const two = buildPrompt({ query: "x", results: RESULTS, mode: "grounded_overview" });
    expect(one).toBe(two);
  });
});
