import { afterEach, describe, expect, it, vi } from "vitest";
import { validateApiKeyCandidate } from "../../src/background/openai-client.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("openai key validation", () => {
  it("surfaces 403 as permission/access issue", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 403,
      async text() {
        return JSON.stringify({
          error: {
            message: "You do not have access to this resource."
          }
        });
      }
    }));

    const result = await validateApiKeyCandidate("sk-test-123", "gpt-4.1-mini", 1000);
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("OPENAI_FORBIDDEN");
    expect(result.error.message).toContain("denied access");
  });

  it("validates using responses endpoint with model-aware request", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({ id: "resp_123" });
      }
    }));
    globalThis.fetch = fetchMock;

    const result = await validateApiKeyCandidate("sk-test-123", "gpt-4.1-mini", 1000);
    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/responses");
    expect(options.method).toBe("POST");
    expect(options.headers.Authorization).toBe("Bearer sk-test-123");
    expect(options.headers["Content-Type"]).toBe("application/json");
    const payload = JSON.parse(options.body);
    expect(payload.model).toBe("gpt-4.1-mini");
    expect(payload.max_output_tokens).toBe(32);
  });
});
