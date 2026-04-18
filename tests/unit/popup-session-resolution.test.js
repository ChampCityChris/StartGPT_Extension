import { describe, expect, it } from "vitest";
import { selectPopupSession } from "../../src/popup/session-resolution.js";

describe("popup session resolution", () => {
  it("prefers the explicit response session when present", () => {
    const response = {
      ok: true,
      session: {
        tabId: 18,
        status: "completed",
        response: {
          text: "Overview"
        },
        completedAt: 1234
      },
      state: {
        sessions: {}
      }
    };

    const selected = selectPopupSession(response, 18);
    expect(selected?.tabId).toBe(18);
    expect(selected?.response?.text).toBe("Overview");
  });

  it("uses the preferred tab session when response.session is missing", () => {
    const response = {
      ok: true,
      state: {
        sessions: {
          "22": {
            status: "completed",
            response: {
              text: "Preferred tab overview"
            },
            completedAt: 2000
          }
        },
        global: {
          activeSidebarTabId: 7
        }
      }
    };

    const selected = selectPopupSession(response, 22);
    expect(selected?.tabId).toBe(22);
    expect(selected?.response?.text).toBe("Preferred tab overview");
  });

  it("returns null when preferred tab is unavailable", () => {
    const response = {
      ok: true,
      state: {
        sessions: {
          "4": {
            status: "running",
            response: {
              text: ""
            },
            completedAt: null
          }
        },
        global: {
          activeSidebarTabId: null
        }
      }
    };

    expect(selectPopupSession(response, 4)?.status).toBe("running");
    expect(selectPopupSession(response, 400)).toBeNull();
  });
});
