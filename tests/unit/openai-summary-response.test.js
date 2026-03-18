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
            total_tokens: 46
          }
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
    expect(result.usage).toEqual({
      inputTokens: 12,
      outputTokens: 34,
      totalTokens: 46
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
      maxOutputTokens: 600,
      timeoutMs: 1000
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstPayload = JSON.parse(fetchMock.mock.calls[0][1].body);
    const secondPayload = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(firstPayload.max_output_tokens).toBe(600);
    expect(secondPayload.max_output_tokens).toBeGreaterThan(600);
    expect(result.text).toBe("Recovered summary after retry.");
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
