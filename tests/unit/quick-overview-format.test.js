import { describe, expect, it } from "vitest";
import { formatQuickOverviewOutput, parseQuickOverviewJson } from "../../src/background/quick-overview-format.js";

describe("quick overview format", () => {
  it("parses valid JSON payload", () => {
    const parsed = parseQuickOverviewJson(JSON.stringify({
      headline: "Best hybrid SUVs in 2026",
      summary: "Top picks cluster around fuel economy, safety, and reliability with some pricing variance.",
      key_points: [
        "Most top results prioritize fuel economy and total ownership cost.",
        "Safety ratings are strong across the leading models listed.",
        "Pricing gaps are meaningful between trims and options."
      ],
      confidence: "medium",
      evidence_gap: "Few results include long-term reliability data beyond early owner reports."
    }));

    expect(parsed).toBeTruthy();
    expect(parsed?.confidence).toBe("medium");
    expect(parsed?.keyPoints).toHaveLength(3);
  });

  it("formats valid JSON into readable card text", () => {
    const formatted = formatQuickOverviewOutput(JSON.stringify({
      headline: "Best hybrid SUVs in 2026",
      summary: "This set favors fuel economy and safety.",
      key_points: [
        "Fuel economy leads the comparison.",
        "Safety is consistently emphasized.",
        "Trim-level pricing drives value differences."
      ],
      confidence: "high",
      evidence_gap: "Direct long-term maintenance comparisons are sparse."
    }));

    expect(formatted.formatUsed).toBe("structured_json");
    expect(formatted.text).toContain("Key points:");
    expect(formatted.text).toContain("Confidence: high");
    expect(formatted.structured?.headline).toContain("Best hybrid SUVs");
  });

  it("falls back to raw text when payload is not valid json", () => {
    const formatted = formatQuickOverviewOutput("not valid json");
    expect(formatted.formatUsed).toBe("raw_text");
    expect(formatted.text).toBe("not valid json");
  });

  it("salvages malformed json-like payload into structured output", () => {
    const malformed = [
      "{",
      "  \"headline\": \"Wii U hacking vs Raspberry Pi emulator box: Pi generally favored for emulation, with DIY integrations possible\",",
      "  \"summary\": \"Search results suggest Raspberry Pi often outperforms the Wii U for emulation in raw terms.\",",
      "  \"key_points\": [",
      "    \"Reddit indicates Raspberry Pi 3 is a slightly better emulator box than the Wii U in raw performance terms.\",",
      "    \"YouTube shows Raspberry Pi 5 capable of running Steam and WiiU emulation with Cemu.\",",
      "    \"DIY projects reuse Wii U components or housing to create RetroPie-style portable emulation setups.\"",
      "  ],",
      "  \"confidence\": \"medium\",",
      "  \"evidence_gap\": \"Limited benchmarks and potential bias",
      ""
    ].join("\n");

    const formatted = formatQuickOverviewOutput(malformed);

    expect(formatted.formatUsed).toBe("structured_json");
    expect(formatted.text).toContain("Key points:");
    expect(formatted.text).toContain("Confidence: medium");
    expect(formatted.text).toContain("Evidence gap: Limited benchmarks and potential bias");
    expect(formatted.structured?.key_points).toHaveLength(3);
  });

  it("salvages malformed json wrapped in markdown fences", () => {
    const fencedMalformed = [
      "```json",
      "{",
      "  \"headline\": \"Game streaming vs local emulation\",",
      "  \"summary\": \"Local emulation is usually preferred for latency and ownership.\",",
      "  \"key_points\": [",
      "    \"Cloud options trade convenience for variable performance.\",",
      "    \"Local setups can require upfront configuration effort.\",",
      "    \"Hardware capability still determines emulator headroom.\"",
      "  ],",
      "  \"confidence\": \"high\",",
      "  \"evidence_gap\": \"No shared benchmark methodology across sources\"",
      "",
      "```"
    ].join("\n");

    const formatted = formatQuickOverviewOutput(fencedMalformed);

    expect(formatted.formatUsed).toBe("structured_json");
    expect(formatted.structured?.headline).toContain("Game streaming vs local emulation");
    expect(formatted.structured?.confidence).toBe("high");
  });
});
