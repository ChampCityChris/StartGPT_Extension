import { describe, expect, it } from "vitest";
import { shouldApplyBridgeProgress } from "../../src/background/bridge-progress-policy.js";

describe("shouldApplyBridgeProgress", () => {
  it("accepts progress for the active in-flight run", () => {
    expect(shouldApplyBridgeProgress({
      status: "waiting_for_response",
      runId: "run_12_123"
    }, "run_12_123")).toBe(true);
  });

  it("ignores progress for a stale run id", () => {
    expect(shouldApplyBridgeProgress({
      status: "waiting_for_response",
      runId: "run_12_999"
    }, "run_12_123")).toBe(false);
  });

  it("ignores progress once the run is no longer in flight", () => {
    expect(shouldApplyBridgeProgress({
      status: "failed",
      runId: "run_12_123"
    }, "run_12_123")).toBe(false);
  });
});
