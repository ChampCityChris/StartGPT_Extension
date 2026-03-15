// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { extractChatgptResponse } from "../../src/content/dom/extract-chatgpt-response.js";

function loadFixtureDocument(fileName) {
  const filePath = resolve(process.cwd(), "tests", "fixtures", fileName);
  const html = readFileSync(filePath, "utf8");
  return new DOMParser().parseFromString(html, "text/html");
}

describe("extractChatgptResponse", () => {
  it("parses latest assistant response text and sources", () => {
    const doc = loadFixtureDocument("chatgpt-response.html");
    const parsed = extractChatgptResponse(doc);

    expect(parsed.hasStarted).toBe(true);
    expect(parsed.isComplete).toBe(true);
    expect(parsed.text).toContain("Latest answer line one. Line two with extra spacing.");
    expect(parsed.sources).toEqual([
      { title: "Source A", url: "https://example.com/source-a" },
      { title: "Source B", url: "https://example.com/source-b" }
    ]);
  });

  it("marks loading state as incomplete", () => {
    const doc = loadFixtureDocument("chatgpt-loading.html");
    const parsed = extractChatgptResponse(doc);

    expect(parsed.hasStarted).toBe(true);
    expect(parsed.isComplete).toBe(false);
    expect(parsed.text).toContain("Draft response is still streaming");
  });

  it("ignores hidden stop indicators when determining completion", () => {
    const doc = loadFixtureDocument("chatgpt-response-hidden-stop.html");
    const parsed = extractChatgptResponse(doc);

    expect(parsed.hasStarted).toBe(true);
    expect(parsed.isComplete).toBe(true);
    expect(parsed.text).toContain("Completed answer text");
  });
});
