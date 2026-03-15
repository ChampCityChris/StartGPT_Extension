// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { extractStartpageResults } from "../../src/content/dom/extract-startpage-results.js";

function loadFixtureDocument(fileName) {
  const fixturePath = resolve(process.cwd(), "tests", "fixtures", fileName);
  const html = readFileSync(fixturePath, "utf8");
  return new DOMParser().parseFromString(html, "text/html");
}

describe("extractStartpageResults", () => {
  it("extracts normalized visible results from fixture", () => {
    const doc = loadFixtureDocument("startpage-results.html");
    const parsed = extractStartpageResults(doc, 10);

    expect(parsed.query).toBe("best laptops 2026");
    expect(parsed.results).toEqual([
      {
        rank: 1,
        title: "Top Result One",
        url: "https://example.com/one",
        snippet: "First visible snippet.",
        displayUrl: "example.com/one"
      },
      {
        rank: 2,
        title: "Top Result Two",
        url: "https://example.com/two",
        snippet: "Second visible snippet.",
        displayUrl: "example.com/two"
      }
    ]);
  });

  it("respects maxResults cap", () => {
    const doc = loadFixtureDocument("startpage-results.html");
    const parsed = extractStartpageResults(doc, 1);

    expect(parsed.results).toHaveLength(1);
    expect(parsed.results[0].rank).toBe(1);
    expect(parsed.results[0].title).toBe("Top Result One");
  });

  it("does not get trapped by broad data-testid selectors before real result blocks", () => {
    const doc = loadFixtureDocument("startpage-broad-selector-trap.html");
    const parsed = extractStartpageResults(doc, 10);

    expect(parsed.query).toBe("why selectors fail");
    expect(parsed.results).toHaveLength(2);
    expect(parsed.results[0].title).toBe("Alpha Result");
    expect(parsed.results[1].title).toBe("Beta Result");
  });

  it("extracts the real result title instead of favicon or site-title links from the live Startpage shape", () => {
    const doc = loadFixtureDocument("startpage-live-result-shape.html");
    const parsed = extractStartpageResults(doc, 10);

    expect(parsed.query).toBe("codex 5.4 unable to code java well");
    expect(parsed.results).toEqual([
      {
        rank: 1,
        title: "5.4 prematurely claims success and feels more likely to break my code",
        url: "https://www.reddit.com/r/codex/comments/1rooc9h/54_prematurely_claims_success_and_feels_more/",
        snippet: "7 days ago ... Do you have good test coverage? I find codex excels with good unit tests.",
        displayUrl: ""
      }
    ]);
  });
});
