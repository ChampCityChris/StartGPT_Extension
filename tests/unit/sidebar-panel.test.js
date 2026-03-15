import { describe, expect, it } from "vitest";
import {
  CHATGPT_SIDEBAR_PANEL_URL,
  SIDEBAR_UNAVAILABLE_URL,
  getSidebarPanelForUrl,
  isStartpageResultsUrl,
  isStartpageUrl
} from "../../src/background/sidebar-panel.js";

describe("sidebar panel helpers", () => {
  it("recognizes Startpage hosts", () => {
    expect(isStartpageUrl("https://www.startpage.com/")).toBe(true);
    expect(isStartpageUrl("https://startpage.com/sp/search?query=test")).toBe(true);
    expect(isStartpageUrl("https://chatgpt.com/")).toBe(false);
  });

  it("recognizes Startpage results urls", () => {
    expect(isStartpageResultsUrl("https://www.startpage.com/sp/search?query=test")).toBe(true);
    expect(isStartpageResultsUrl("https://www.startpage.com/search?q=test")).toBe(true);
    expect(isStartpageResultsUrl("https://www.startpage.com/")).toBe(false);
  });

  it("maps results urls to the ChatGPT sidebar panel", () => {
    expect(getSidebarPanelForUrl("https://www.startpage.com/sp/search?query=test")).toBe(CHATGPT_SIDEBAR_PANEL_URL);
  });

  it("maps non-results urls to the unavailable panel", () => {
    expect(getSidebarPanelForUrl("https://www.startpage.com/")).toBe(SIDEBAR_UNAVAILABLE_URL);
    expect(getSidebarPanelForUrl("https://chatgpt.com/")).toBe(SIDEBAR_UNAVAILABLE_URL);
  });
});
