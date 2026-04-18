// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { createOverviewCard } from "../../src/content/inject/overview-card.js";

function getDeepDiveButton() {
  const root = document.getElementById("startgpt-overview-root");
  return root?.shadowRoot?.querySelector(".startgpt-deep-dive") || null;
}

function getCopyButton() {
  const root = document.getElementById("startgpt-overview-root");
  return root?.shadowRoot?.querySelector(".startgpt-copy-button") || null;
}

function getCostLines() {
  const root = document.getElementById("startgpt-overview-root");
  const quick = root?.shadowRoot?.querySelector(".startgpt-cost-line:nth-child(1)") || null;
  const deep = root?.shadowRoot?.querySelector(".startgpt-cost-line:nth-child(2)") || null;
  return { quick, deep };
}

describe("overview card deep dive action", () => {
  it("shows deep dive action when requested by state", () => {
    document.body.innerHTML = "<main></main>";
    const card = createOverviewCard();
    card.mount();
    card.render({
      status: "completed",
      query: "test",
      summary: "quick overview ready",
      showDeepDiveAction: true
    });

    const button = getDeepDiveButton();
    expect(button).not.toBeNull();
    expect(button.hidden).toBe(false);
    expect(button.disabled).toBe(false);
  });

  it("hides deep dive action when state does not allow it", () => {
    document.body.innerHTML = "<main></main>";
    const card = createOverviewCard();
    card.mount();
    card.render({
      status: "running",
      query: "test",
      summary: "",
      showDeepDiveAction: false
    });

    const button = getDeepDiveButton();
    expect(button).not.toBeNull();
    expect(button.hidden).toBe(true);
  });

  it("invokes callback when deep dive action is clicked", () => {
    document.body.innerHTML = "<main></main>";
    const onRequestDeepDive = vi.fn();
    const card = createOverviewCard({ onRequestDeepDive });
    card.mount();
    card.render({
      status: "completed",
      query: "test",
      summary: "quick overview ready",
      showDeepDiveAction: true
    });

    const button = getDeepDiveButton();
    button.click();
    expect(onRequestDeepDive).toHaveBeenCalledTimes(1);
  });

  it("enables the copy icon only when summary text exists", () => {
    document.body.innerHTML = "<main></main>";
    const card = createOverviewCard();
    card.mount();
    card.render({
      status: "running",
      query: "test",
      summary: ""
    });

    const copyButton = getCopyButton();
    expect(copyButton).not.toBeNull();
    expect(copyButton.disabled).toBe(true);

    card.render({
      status: "completed",
      query: "test",
      summary: "deep dive text"
    });

    expect(copyButton.disabled).toBe(false);
  });

  it("copies overview text when the copy icon is clicked", async () => {
    vi.useFakeTimers();
    try {
      document.body.innerHTML = "<main></main>";
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText }
      });
      const card = createOverviewCard();
      card.mount();
      card.render({
        status: "completed",
        query: "test",
        summary: "deep dive text"
      });

      const copyButton = getCopyButton();
      copyButton.click();
      await Promise.resolve();
      await Promise.resolve();

      expect(writeText).toHaveBeenCalledTimes(1);
      expect(writeText).toHaveBeenCalledWith("deep dive text");
      expect(copyButton.dataset.copied).toBe("true");

      vi.advanceTimersByTime(1500);
      expect(copyButton.dataset.copied).toBe("false");
    } finally {
      vi.useRealTimers();
    }
  });

  it("renders quick/deep telemetry lines at the bottom", () => {
    document.body.innerHTML = "<main></main>";
    const card = createOverviewCard();
    card.mount();
    card.render({
      status: "completed",
      query: "test",
      summary: "quick overview ready",
      quickOverviewTelemetry: "Quick: out 889 | reasoning 210 | json chars 542 | model gpt-5-nano-2026-01-09 | retries 1",
      deepDiveTelemetry: "Deep: out n/a | reasoning n/a | json chars n/a | model n/a | retries n/a"
    });

    const { quick, deep } = getCostLines();
    expect(quick).not.toBeNull();
    expect(deep).not.toBeNull();
    expect(quick.textContent).toContain("Quick: out 889");
    expect(deep.textContent).toContain("Deep: out n/a");
  });
});
