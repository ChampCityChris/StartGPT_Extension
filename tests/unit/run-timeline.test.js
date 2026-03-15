import { describe, expect, it } from "vitest";
import {
  RUN_TIMELINE_EVENT,
  appendRunTimelineEvent,
  createRunTimeline,
  describeRunTimelineEvent,
  formatDurationMs,
  mergeRunTimelineEvents,
  summarizeRunTimeline
} from "../../src/content/shared/run-timeline.js";

describe("run timeline helpers", () => {
  it("records events and summarizes elapsed durations", () => {
    let timeline = createRunTimeline({
      runId: "run_1",
      startedAt: 1000
    });

    timeline = appendRunTimelineEvent(timeline, {
      name: RUN_TIMELINE_EVENT.RUN_QUEUED,
      at: 1200,
      source: "background"
    });
    timeline = appendRunTimelineEvent(timeline, {
      name: RUN_TIMELINE_EVENT.BRIDGE_READY,
      at: 2200,
      source: "background"
    });

    const summary = summarizeRunTimeline(timeline);
    expect(summary.totalMs).toBe(1200);
    expect(summary.events).toHaveLength(2);
    expect(summary.events[0]?.sinceStartMs).toBe(200);
    expect(summary.events[1]?.sincePreviousMs).toBe(1000);
  });

  it("merges bridge and background events without duplicating identical marks", () => {
    const backgroundTimeline = createRunTimeline({
      startedAt: 1000,
      events: [
        {
          name: RUN_TIMELINE_EVENT.RUN_STARTED,
          at: 1100,
          source: "background"
        }
      ]
    });
    const bridgeTimeline = createRunTimeline({
      startedAt: 1500,
      events: [
        {
          name: RUN_TIMELINE_EVENT.BRIDGE_RUN_STARTED,
          at: 1500,
          source: "bridge"
        },
        {
          name: RUN_TIMELINE_EVENT.BRIDGE_RUN_STARTED,
          at: 1500,
          source: "bridge"
        }
      ]
    });

    const merged = mergeRunTimelineEvents(backgroundTimeline, bridgeTimeline);
    expect(merged.startedAt).toBe(1000);
    expect(merged.events).toHaveLength(2);
  });

  it("formats event labels and human-friendly durations", () => {
    expect(describeRunTimelineEvent(RUN_TIMELINE_EVENT.BRIDGE_RESPONSE_STARTED)).toBe("Bridge response started");
    expect(formatDurationMs(450)).toBe("450ms");
    expect(formatDurationMs(1500)).toBe("1.5s");
  });
});
