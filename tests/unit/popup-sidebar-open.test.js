import { describe, expect, it, vi } from "vitest";
import { openSidebarFromUserGesture } from "../../src/popup/sidebar-open.js";

describe("openSidebarFromUserGesture", () => {
  it("waits for the active tab panel before opening the sidebar", async () => {
    const calls = [];
    let resolveSetPanel;
    const setPanelPromise = new Promise((resolve) => {
      resolveSetPanel = resolve;
    });
    const sidebarAction = {
      setPanel: vi.fn((payload) => {
        calls.push({ type: "setPanel", payload });
        return setPanelPromise;
      }),
      open: vi.fn(() => {
        calls.push({ type: "open" });
        return Promise.resolve();
      })
    };

    const openPromise = openSidebarFromUserGesture(sidebarAction, {
      id: 55,
      url: "https://www.startpage.com/sp/search?query=test"
    });

    expect(sidebarAction.setPanel).toHaveBeenCalledOnce();
    expect(sidebarAction.open).not.toHaveBeenCalled();

    resolveSetPanel();
    await openPromise;

    expect(sidebarAction.open).toHaveBeenCalledOnce();
    expect(calls).toEqual([
      {
        type: "setPanel",
        payload: {
          tabId: 55,
          panel: "/sidebar/sidebar.html"
        }
      },
      { type: "open" }
    ]);
  });

  it("stops before open when panel selection fails", async () => {
    const sidebarAction = {
      setPanel: vi.fn(() => Promise.reject(new Error("panel_set_failed"))),
      open: vi.fn(() => Promise.resolve())
    };

    await expect(openSidebarFromUserGesture(sidebarAction, {
      id: 55,
      url: "https://www.startpage.com/sp/search?query=test"
    })).rejects.toThrow("panel_set_failed");
    expect(sidebarAction.open).not.toHaveBeenCalled();
  });

  it("rejects when the sidebar API cannot open the browser sidebar", async () => {
    await expect(openSidebarFromUserGesture({}, null))
      .rejects.toThrow("Sidebar API is unavailable in this popup context.");
  });
});
