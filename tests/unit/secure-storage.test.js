import { describe, expect, it } from "vitest";
import {
  deleteStoredApiKey,
  getStoredApiKey,
  hasStoredApiKey,
  storeApiKey
} from "../../src/background/secure-storage.js";

function createStorageMock() {
  const data = {};
  return {
    async get(key) {
      if (typeof key === "string") {
        return { [key]: data[key] };
      }
      return {};
    },
    async set(patch) {
      Object.assign(data, patch);
    },
    async remove(key) {
      delete data[key];
    }
  };
}

describe("secure storage key lifecycle", () => {
  it("stores, reads, and deletes the api key in local storage area", async () => {
    const storage = createStorageMock();
    await storeApiKey("test-key-example", storage);
    await expect(hasStoredApiKey(storage)).resolves.toBe(true);
    await expect(getStoredApiKey(storage)).resolves.toBe("test-key-example");

    await deleteStoredApiKey(storage);
    await expect(hasStoredApiKey(storage)).resolves.toBe(false);
    await expect(getStoredApiKey(storage)).resolves.toBe("");
  });

  it("rejects empty keys", async () => {
    const storage = createStorageMock();
    await expect(storeApiKey("   ", storage)).rejects.toThrow("api_key_empty");
  });
});
