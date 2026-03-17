import { describe, expect, it } from "vitest";
import {
  STARTGPT_SIDEBAR_PANEL_URL,
  SIDEBAR_UNAVAILABLE_URL,
  getSidebarPanelForUrl,
  isStartpageResultsUrl,
  isStartpageUrl
} from "../../src/background/sidebar-panel.js";

describe("sidebar panel helpers", () => {
  it("recognizes Startpage hosts", () => {
    expect(isStartpageUrl("https://www.startpage.com/")).toBe(true);
    expect(isStartpageUrl("https://startpage.com/sp/search?query=test")).toBe(true);
    expect(isStartpageUrl("https://example.com/")).toBe(false);
  });

  it("recognizes Startpage results URLs", () => {
    expect(isStartpageResultsUrl("https://www.startpage.com/sp/search?query=test")).toBe(true);
    expect(isStartpageResultsUrl("https://www.startpage.com/search?q=test")).toBe(true);
    expect(isStartpageResultsUrl("https://www.startpage.com/")).toBe(false);
  });

  it("maps results URLs to StartGPT sidebar panel", () => {
    expect(getSidebarPanelForUrl("https://www.startpage.com/sp/search?query=test")).toBe(STARTGPT_SIDEBAR_PANEL_URL);
  });

  it("maps non-results URLs to unavailable panel", () => {
    expect(getSidebarPanelForUrl("https://www.startpage.com/")).toBe(SIDEBAR_UNAVAILABLE_URL);
    expect(getSidebarPanelForUrl("https://example.com/")).toBe(SIDEBAR_UNAVAILABLE_URL);
  });
});
