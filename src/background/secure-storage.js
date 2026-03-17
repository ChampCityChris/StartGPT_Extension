import { STORAGE_KEYS } from "./constants.js";

function normalizeApiKey(value) {
  return String(value || "").trim();
}

export async function getStoredApiKey(storageArea = browser.storage.local) {
  const stored = await storageArea.get(STORAGE_KEYS.OPENAI_API_KEY);
  const raw = stored?.[STORAGE_KEYS.OPENAI_API_KEY];
  const normalized = normalizeApiKey(raw);
  return normalized || "";
}

export async function hasStoredApiKey(storageArea = browser.storage.local) {
  const key = await getStoredApiKey(storageArea);
  return key.length > 0;
}

export async function storeApiKey(apiKey, storageArea = browser.storage.local) {
  const normalized = normalizeApiKey(apiKey);
  if (!normalized) {
    throw new Error("api_key_empty");
  }
  await storageArea.set({
    [STORAGE_KEYS.OPENAI_API_KEY]: normalized
  });
}

export async function deleteStoredApiKey(storageArea = browser.storage.local) {
  await storageArea.remove(STORAGE_KEYS.OPENAI_API_KEY);
}
