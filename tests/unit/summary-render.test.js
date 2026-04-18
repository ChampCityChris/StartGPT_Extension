// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { parseSummaryBlocks, renderSummaryText } from "../../src/content/shared/summary-render.js";

const INLINE_DEEP_DIVE = [
  "### Answer The most likely reading from these results is that a media-driven narrative portrays the AI industry as forming a bubble that could pop, often framed as a token- or hype-based scam; however, this view rests largely on opinion pieces and sensational coverage rather than solid, empirical evidence.",
  "### What the results suggest - The results repeatedly frame AI as a hype-driven bubble and a scam, including claims it could be the biggest tech scam of 2026. - Social platforms amplify the skepticism, with Reddit and Facebook discussions portraying the industry as filled with hype and fraud. - There are explicit counterpoints and ongoing debate in the results, indicating no clear consensus and relying on commentary rather than conclusive data.",
  "### Where the evidence is weak All sources leaned on here are opinionated pieces, sensational takes, or discussions rather than systematic analyses or empirical market data."
].join(" ");

describe("summary render formatting", () => {
  it("parses inline deep-dive markdown into headings, paragraphs, and list blocks", () => {
    const blocks = parseSummaryBlocks(INLINE_DEEP_DIVE);

    expect(blocks[0]).toEqual({ type: "heading", text: "Answer" });
    expect(blocks[1]?.type).toBe("paragraph");
    expect(blocks[1]?.text).toContain("The most likely reading from these results");

    const listBlock = blocks.find((block) => block.type === "list");
    expect(listBlock?.items).toHaveLength(3);
    expect(listBlock?.items[0]).toContain("The results repeatedly frame AI");
    expect(listBlock?.items[2]).toContain("There are explicit counterpoints");

    const headingTexts = blocks
      .filter((block) => block.type === "heading")
      .map((block) => block.text);
    expect(headingTexts).toEqual([
      "Answer",
      "What the results suggest",
      "Where the evidence is weak"
    ]);
  });

  it("renders safe DOM nodes with readable structure", () => {
    document.body.innerHTML = "<article id=\"summary\"></article>";
    const summary = document.getElementById("summary");

    renderSummaryText(summary, INLINE_DEEP_DIVE, "fallback");

    expect(summary?.querySelectorAll("h3")).toHaveLength(3);
    expect(summary?.querySelectorAll("ul")).toHaveLength(1);
    expect(summary?.querySelectorAll("li")).toHaveLength(3);
    expect(summary?.textContent).toContain("Where the evidence is weak");
  });

  it("falls back to placeholder text when no summary exists", () => {
    document.body.innerHTML = "<article id=\"summary\"></article>";
    const summary = document.getElementById("summary");

    renderSummaryText(summary, "", "No overview was returned.");

    expect(summary?.querySelectorAll("p")).toHaveLength(1);
    expect(summary?.textContent).toContain("No overview was returned.");
  });

  it("treats model output as text instead of HTML", () => {
    document.body.innerHTML = "<article id=\"summary\"></article>";
    const summary = document.getElementById("summary");

    renderSummaryText(summary, "### Answer <img src=x onerror=alert(1)>");

    expect(summary?.querySelector("img")).toBeNull();
    expect(summary?.textContent).toContain("<img src=x onerror=alert(1)>");
  });
});
