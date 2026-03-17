import { describe, expect, it } from "vitest";
import { getCardStatusLabel, normalizeCardStatus } from "../../src/content/inject/loading-state.js";

describe("overview card loading state", () => {
  it("treats captured state as an active loading phase", () => {
    expect(normalizeCardStatus("captured")).toBe("loading");
    expect(getCardStatusLabel("captured")).toBe("Working: preparing automatic overview");
  });

  it("keeps completed and failed states stable", () => {
    expect(normalizeCardStatus("completed")).toBe("completed");
    expect(normalizeCardStatus("failed")).toBe("failed");
  });
});
