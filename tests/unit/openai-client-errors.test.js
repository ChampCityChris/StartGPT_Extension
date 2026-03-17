import { describe, expect, it } from "vitest";
import { OpenAiClientError, normalizeClientError } from "../../src/background/openai-client.js";

describe("openai client error normalization", () => {
  it("returns stable code/message/recoverable for typed errors", () => {
    const error = new OpenAiClientError("INVALID_API_KEY", "Bad key", {
      recoverable: true
    });

    expect(normalizeClientError(error)).toEqual({
      code: "INVALID_API_KEY",
      message: "Bad key",
      recoverable: true
    });
  });

  it("redacts unknown errors into safe generic messages", () => {
    const normalized = normalizeClientError(new Error("Bearer sensitive-token-should-never-appear"));
    expect(normalized.code).toBe("OPENAI_REQUEST_FAILED");
    expect(normalized.message).not.toContain("sk-");
  });
});
