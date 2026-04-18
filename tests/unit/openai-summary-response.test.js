import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeClientError, requestOpenAiSummary } from "../../src/background/openai-client.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("openai summary response parsing", () => {
  it("passes instructions through to responses api when provided", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({
          id: "resp_instructions",
          output: [
            {
              type: "message",
              content: [
                {
                  type: "output_text",
                  text: "ok"
                }
              ]
            }
          ]
        });
      }
    }));
    globalThis.fetch = fetchMock;

    await requestOpenAiSummary({
      apiKey: "sk-test-123",
      model: "gpt-5-nano",
      prompt: "user prompt",
      instructions: "system prompt",
      textVerbosity: "low",
      reasoningEffort: "minimal",
      maxOutputTokens: 128,
      timeoutMs: 1000
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.instructions).toBe("system prompt");
    expect(body.input).toBe("user prompt");
    expect(body.text?.verbosity).toBe("low");
    expect(body.reasoning?.effort).toBe("minimal");
  });

  it("ignores invalid text verbosity values", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({
          id: "resp_instructions",
          output: [
            {
              type: "message",
              content: [
                {
                  type: "output_text",
                  text: "ok"
                }
              ]
            }
          ]
        });
      }
    }));
    globalThis.fetch = fetchMock;

    await requestOpenAiSummary({
      apiKey: "sk-test-123",
      model: "gpt-5-nano",
      prompt: "user prompt",
      textVerbosity: "LOUD",
      reasoningEffort: "turbo",
      maxOutputTokens: 128,
      timeoutMs: 1000
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.text).toBeUndefined();
    expect(body.reasoning).toBeUndefined();
  });

  it("accepts output_text blocks where text is an object value", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({
          id: "resp_123",
          output: [
            {
              type: "message",
              content: [
                {
                  type: "output_text",
                  text: { value: "Overview from object text." }
                }
              ]
            }
          ],
          usage: {
            input_tokens: 12,
            output_tokens: 34,
            total_tokens: 46,
            output_tokens_details: {
              reasoning_tokens: 5
            }
          },
          model: "gpt-5-nano-2026-01-09"
        });
      }
    }));

    const result = await requestOpenAiSummary({
      apiKey: "sk-test-123",
      model: "gpt-5-nano",
      prompt: "Summarize this.",
      maxOutputTokens: 128,
      timeoutMs: 1000
    });

    expect(result.text).toBe("Overview from object text.");
    expect(result.responseId).toBe("resp_123");
    expect(result.modelSnapshot).toBe("gpt-5-nano-2026-01-09");
    expect(result.retryCount).toBe(0);
    expect(result.usage).toEqual({
      inputTokens: 12,
      outputTokens: 34,
      totalTokens: 46,
      reasoningTokens: 5
    });
  });

  it("returns refusal text instead of empty response when model refuses", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({
          id: "resp_456",
          output: [
            {
              type: "message",
              content: [
                {
                  type: "refusal",
                  refusal: "I can not provide that."
                }
              ]
            }
          ]
        });
      }
    }));

    const result = await requestOpenAiSummary({
      apiKey: "sk-test-123",
      model: "gpt-5-nano",
      prompt: "Summarize this.",
      maxOutputTokens: 128,
      timeoutMs: 1000
    });

    expect(result.text).toBe("I can not provide that.");
  });

  it("retries with larger max_output_tokens when response is incomplete from token ceiling", async () => {
    const fetchMock = vi.fn()
      .mockImplementationOnce(async () => ({
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            id: "resp_incomplete",
            status: "incomplete",
            incomplete_details: {
              reason: "max_output_tokens"
            },
            output: [
              {
                type: "reasoning",
                content: []
              }
            ]
          });
        }
      }))
      .mockImplementationOnce(async () => ({
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            id: "resp_complete",
            status: "completed",
            output: [
              {
                type: "message",
                content: [
                  {
                    type: "output_text",
                    text: "Recovered summary after retry."
                  }
                ]
              }
            ]
          });
        }
      }));
    globalThis.fetch = fetchMock;

    const result = await requestOpenAiSummary({
      apiKey: "sk-test-123",
      model: "gpt-5-nano",
      prompt: "Summarize this.",
      maxOutputTokens: 400,
      timeoutMs: 1000
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstPayload = JSON.parse(fetchMock.mock.calls[0][1].body);
    const secondPayload = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(firstPayload.max_output_tokens).toBe(400);
    expect(secondPayload.max_output_tokens).toBeGreaterThan(400);
    expect(result.text).toBe("Recovered summary after retry.");
    expect(result.retryCount).toBe(1);
  });

  it("honors custom maxOutputTokensCap during retry growth", async () => {
    const fetchMock = vi.fn()
      .mockImplementationOnce(async () => ({
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            id: "resp_incomplete_custom_cap",
            status: "incomplete",
            incomplete_details: {
              reason: "max_output_tokens"
            },
            output: [
              {
                type: "reasoning",
                content: []
              }
            ]
          });
        }
      }))
      .mockImplementationOnce(async () => ({
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            id: "resp_complete_custom_cap",
            status: "completed",
            output: [
              {
                type: "message",
                content: [
                  {
                    type: "output_text",
                    text: "Recovered summary at custom cap."
                  }
                ]
              }
            ]
          });
        }
      }));
    globalThis.fetch = fetchMock;

    const result = await requestOpenAiSummary({
      apiKey: "sk-test-123",
      model: "gpt-5-nano",
      prompt: "Summarize this.",
      maxOutputTokens: 1800,
      maxOutputTokensCap: 3000,
      timeoutMs: 1000
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstPayload = JSON.parse(fetchMock.mock.calls[0][1].body);
    const secondPayload = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(firstPayload.max_output_tokens).toBe(1800);
    expect(secondPayload.max_output_tokens).toBe(3000);
    expect(result.text).toBe("Recovered summary at custom cap.");
  });

  it("uses usage.output_tokens to stop retrying when cap is reached", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({
          id: "resp_incomplete_usage_cap",
          status: "incomplete",
          incomplete_details: {
            reason: "max_output_tokens"
          },
          usage: {
            output_tokens: 3000
          },
          output: [
            {
              type: "reasoning",
              content: []
            }
          ]
        });
      }
    }));
    globalThis.fetch = fetchMock;

    let caught;
    try {
      await requestOpenAiSummary({
        apiKey: "sk-test-123",
        model: "gpt-5-nano",
        prompt: "Summarize this.",
        maxOutputTokens: 1800,
        maxOutputTokensCap: 3000,
        timeoutMs: 1000
      });
    } catch (error) {
      caught = error;
    }

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(caught?.code).toBe("OPENAI_INCOMPLETE_MAX_OUTPUT_TOKENS");
    expect(caught?.diagnostics?.usageOutputTokens).toBe(3000);
    expect(caught?.diagnostics?.retryBlockedByCap).toBe(true);
    expect(caught?.message).toContain("usage.output_tokens 3000");
  });

  it("still retries when usage.output_tokens is below cap", async () => {
    const fetchMock = vi.fn()
      .mockImplementationOnce(async () => ({
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            id: "resp_incomplete_usage_below_cap",
            status: "incomplete",
            incomplete_details: {
              reason: "max_output_tokens"
            },
            usage: {
              output_tokens: 1700
            },
            output: [
              {
                type: "reasoning",
                content: []
              }
            ]
          });
        }
      }))
      .mockImplementationOnce(async () => ({
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            id: "resp_complete_usage_below_cap",
            status: "completed",
            output: [
              {
                type: "message",
                content: [
                  {
                    type: "output_text",
                    text: "Recovered summary below cap."
                  }
                ]
              }
            ]
          });
        }
      }));
    globalThis.fetch = fetchMock;

    const result = await requestOpenAiSummary({
      apiKey: "sk-test-123",
      model: "gpt-5-nano",
      prompt: "Summarize this.",
      maxOutputTokens: 1800,
      maxOutputTokensCap: 3000,
      timeoutMs: 1000
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondPayload = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(secondPayload.max_output_tokens).toBe(3000);
    expect(result.text).toBe("Recovered summary below cap.");
  });

  it("includes attempt and cap details in max_output_tokens errors", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({
          id: "resp_incomplete_cap_details",
          status: "incomplete",
          incomplete_details: {
            reason: "max_output_tokens"
          },
          output: [
            {
              type: "reasoning",
              content: []
            }
          ]
        });
      }
    }));

    let caught;
    try {
      await requestOpenAiSummary({
        apiKey: "sk-test-123",
        model: "gpt-5-nano",
        prompt: "Summarize this.",
        maxOutputTokens: 3000,
        maxOutputTokensCap: 3000,
        timeoutMs: 1000
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeTruthy();
    expect(caught?.code).toBe("OPENAI_INCOMPLETE_MAX_OUTPUT_TOKENS");
    expect(caught?.message).toContain("3000 tokens for this attempt");
    expect(caught?.message).toContain("run cap 3000");
  });

  it("returns typed diagnostics when OpenAI marks the response failed", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({
          id: "resp_failed",
          status: "failed",
          error: {
            code: "safety_block"
          },
          output: []
        });
      }
    }));

    let caught;
    try {
      await requestOpenAiSummary({
        apiKey: "sk-test-123",
        model: "gpt-5-nano",
        prompt: "Summarize this.",
        maxOutputTokens: 128,
        timeoutMs: 1000
      });
    } catch (error) {
      expect(error).toMatchObject({
        code: "OPENAI_RESPONSE_FAILED"
      });
      caught = normalizeClientError(error);
    }

    expect(caught).toBeTruthy();
    expect(caught?.diagnostics?.responseStatus).toBe("failed");
    expect(caught?.diagnostics?.responseId).toBe("resp_failed");
  });
});
