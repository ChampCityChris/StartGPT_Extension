import { describe, expect, it } from "vitest";
import { buildPrompt, buildPromptPayload } from "../../src/background/prompt-builder.js";

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

  it("builds quick overview payload with system and user prompts", () => {
    const payload = buildPromptPayload({
      query: "electric cars",
      results: RESULTS,
      mode: "quick_overview"
    });

    expect(payload.expectsStructuredJson).toBe(true);
    expect(payload.instructions).toContain("You generate search overviews for a browser extension.");
    expect(payload.instructions).toContain("\"headline\": string");
    expect(payload.input).toContain("Query: electric cars");
    expect(payload.input).toContain("Search results:");
    expect(payload.input).toContain("1. [example.com] First Result");
    expect(payload.input).toContain("The summary should be 60-90 words.");
  });

  it("builds expanded deep-dive payload with system and user prompts", () => {
    const payload = buildPromptPayload({
      query: "electric cars",
      results: RESULTS,
      mode: "expanded_perplexity"
    });

    expect(payload.expectsStructuredJson).toBe(false);
    expect(payload.instructions).toContain("You are StartGPT Deep Dive. Your job is to turn search results into a compact, Perplexity-style overview.");
    expect(payload.instructions).toContain("Required output format:");
    expect(payload.instructions).toContain("Compression target:");
    expect(payload.input).toContain("Query: electric cars");
    expect(payload.input).toContain("Search results:");
    expect(payload.input).toContain("1. [example.com] First Result - First snippet");
    expect(payload.input).toContain("6. [unknown] (no result captured) - No snippet available.");
    expect(payload.input).toContain("Target 250-300 words total.");
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
