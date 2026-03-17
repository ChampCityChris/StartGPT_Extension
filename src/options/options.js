import { MSG } from "../content/shared/message-types.js";

const settingsForm = document.getElementById("settings-form");
const apiKeyForm = document.getElementById("api-key-form");
const apiKeyInput = document.getElementById("api-key-input");
const keyState = document.getElementById("key-state");
const statusText = document.getElementById("status-text");
const validateKeyButton = document.getElementById("validate-key-button");
const deleteKeyButton = document.getElementById("delete-key-button");

const fields = {
  model: document.getElementById("model"),
  defaultSummaryMode: document.getElementById("default-summary-mode"),
  maxResults: document.getElementById("max-results"),
  autoInjectOverviewCard: document.getElementById("auto-inject")
};

function setStatus(message, isError = false) {
  statusText.textContent = message;
  statusText.style.color = isError ? "#b42318" : "#1f2937";
}

function updateKeyState(hasApiKey) {
  keyState.textContent = hasApiKey
    ? "API key status: configured"
    : "API key status: not configured";
}

function applySettings(settings) {
  fields.model.value = settings.model || "gpt-4.1-mini";
  fields.defaultSummaryMode.value = settings.defaultSummaryMode || "quick_overview";
  fields.maxResults.value = String(settings.maxResults || 5);
  fields.autoInjectOverviewCard.checked = Boolean(settings.autoInjectOverviewCard);
}

function readSettingsFromForm() {
  const maxResults = Number.parseInt(fields.maxResults.value || "", 10);
  return {
    model: fields.model.value,
    defaultSummaryMode: fields.defaultSummaryMode.value,
    maxResults: Number.isInteger(maxResults) ? maxResults : 5,
    autoInjectOverviewCard: fields.autoInjectOverviewCard.checked
  };
}

async function loadSettings() {
  const response = await browser.runtime.sendMessage({
    type: MSG.OPTIONS_GET_SETTINGS
  });

  if (!response?.ok) {
    throw new Error(response?.error || "settings_load_failed");
  }

  applySettings(response.settings || {});
  updateKeyState(Boolean(response.hasApiKey));
}

async function saveSettings(event) {
  event.preventDefault();
  const response = await browser.runtime.sendMessage({
    type: MSG.OPTIONS_SAVE_SETTINGS,
    settings: readSettingsFromForm()
  });

  if (!response?.ok) {
    setStatus(response?.error || "Failed to save settings.", true);
    return;
  }

  applySettings(response.settings || {});
  setStatus("Settings saved.");
}

async function saveApiKey(event) {
  event.preventDefault();
  const apiKey = String(apiKeyInput.value || "").trim();
  if (!apiKey) {
    setStatus("Enter an API key first.", true);
    return;
  }

  const response = await browser.runtime.sendMessage({
    type: MSG.OPTIONS_SET_API_KEY,
    apiKey
  });

  if (!response?.ok) {
    setStatus(response?.error || "Failed to save API key.", true);
    return;
  }

  apiKeyInput.value = "";
  updateKeyState(Boolean(response.hasApiKey));
  setStatus("API key saved to browser.storage.local.");
}

async function validateApiKey() {
  const apiKey = String(apiKeyInput.value || "").trim();
  if (!apiKey) {
    setStatus("Enter an API key first.", true);
    return;
  }

  validateKeyButton.disabled = true;
  try {
    const response = await browser.runtime.sendMessage({
      type: MSG.OPTIONS_VALIDATE_API_KEY,
      apiKey
    });

    if (response?.ok) {
      setStatus("API key validation succeeded.");
      return;
    }

    setStatus(response?.error?.message || response?.error || "API key validation failed.", true);
  } finally {
    validateKeyButton.disabled = false;
  }
}

async function deleteApiKey() {
  deleteKeyButton.disabled = true;
  try {
    const response = await browser.runtime.sendMessage({
      type: MSG.OPTIONS_DELETE_API_KEY
    });

    if (!response?.ok) {
      setStatus(response?.error || "Failed to delete API key.", true);
      return;
    }

    updateKeyState(Boolean(response.hasApiKey));
    setStatus("API key deleted.");
  } finally {
    deleteKeyButton.disabled = false;
  }
}

if (settingsForm) {
  settingsForm.addEventListener("submit", (event) => {
    saveSettings(event).catch((error) => {
      setStatus(error instanceof Error ? error.message : "Failed to save settings.", true);
    });
  });
}

if (apiKeyForm) {
  apiKeyForm.addEventListener("submit", (event) => {
    saveApiKey(event).catch((error) => {
      setStatus(error instanceof Error ? error.message : "Failed to save API key.", true);
    });
  });
}

if (validateKeyButton) {
  validateKeyButton.addEventListener("click", () => {
    validateApiKey().catch((error) => {
      setStatus(error instanceof Error ? error.message : "Validation failed.", true);
    });
  });
}

if (deleteKeyButton) {
  deleteKeyButton.addEventListener("click", () => {
    deleteApiKey().catch((error) => {
      setStatus(error instanceof Error ? error.message : "Delete failed.", true);
    });
  });
}

loadSettings()
  .then(() => {
    setStatus("Settings loaded.");
  })
  .catch((error) => {
    setStatus(error instanceof Error ? error.message : "Failed to load settings.", true);
  });
