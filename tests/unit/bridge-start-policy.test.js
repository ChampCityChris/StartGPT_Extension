import { describe, expect, it } from "vitest";
import { getSidebarRunAvailability } from "../../src/background/bridge-start-policy.js";

describe("getSidebarRunAvailability", () => {
  it("proceeds when the sidebar opened successfully", () => {
    expect(getSidebarRunAvailability({ opened: true }, { reachable: false })).toEqual({
      sidebarOpened: true,
      bridgeReachable: false,
      canProceed: true,
      reusedExistingBridge: false
    });
  });

  it("reuses an existing reachable bridge when auto-open is blocked", () => {
    expect(getSidebarRunAvailability(
      {
        opened: false,
        errorMessage: "sidebarAction.open may only be called from a user input handler"
      },
      {
        linked: true,
        reachable: true,
        bridgeInstanceId: "bridge_123"
      }
    )).toEqual({
      sidebarOpened: false,
      bridgeReachable: true,
      canProceed: true,
      reusedExistingBridge: true
    });
  });

  it("fails when neither the sidebar nor a live bridge is available", () => {
    expect(getSidebarRunAvailability({ opened: false }, { reachable: false })).toEqual({
      sidebarOpened: false,
      bridgeReachable: false,
      canProceed: false,
      reusedExistingBridge: false
    });
  });
});
