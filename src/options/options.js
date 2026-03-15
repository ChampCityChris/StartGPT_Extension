import { DEFAULT_SETTINGS, STORAGE_KEYS } from "../background/constants.js";

const form = document.getElementById("settings-form");
const statusText = document.getElementById("status-text");

const fields = {
  autoRunOnStartpage: document.getElementById("auto-run"),
  autoInjectOverviewCard: document.getElementById("auto-inject"),
  maxResults: document.getElementById("max-results"),
  promptMode: document.getElementById("prompt-mode"),
  debugMode: document.getElementById("debug-mode")
};

function setStatus(message) {
  statusText.textContent = message;
}

function readFormSettings() {
  const maxResultsRaw = Number.parseInt(fields.maxResults.value || "", 10);
  const maxResults = Number.isInteger(maxResultsRaw)
    ? Math.min(10, Math.max(1, maxResultsRaw))
    : DEFAULT_SETTINGS.maxResults;

  return {
    autoRunOnStartpage: fields.autoRunOnStartpage.checked,
    autoInjectOverviewCard: fields.autoInjectOverviewCard.checked,
    maxResults,
    promptMode: fields.promptMode.value || DEFAULT_SETTINGS.promptMode,
    debugMode: fields.debugMode.checked
  };
}

function applyFormSettings(settings) {
  fields.autoRunOnStartpage.checked = Boolean(settings.autoRunOnStartpage);
  fields.autoInjectOverviewCard.checked = Boolean(settings.autoInjectOverviewCard);
  fields.maxResults.value = String(settings.maxResults);
  fields.promptMode.value = settings.promptMode;
  fields.debugMode.checked = Boolean(settings.debugMode);
}

async function loadSettings() {
  const stored = await browser.storage.local.get(STORAGE_KEYS.SETTINGS);
  const settings = {
    ...DEFAULT_SETTINGS,
    ...(stored?.[STORAGE_KEYS.SETTINGS] || {})
  };
  applyFormSettings(settings);
  setStatus("Settings loaded.");
}

async function saveSettings(event) {
  event.preventDefault();

  const settings = readFormSettings();
  await browser.storage.local.set({
    [STORAGE_KEYS.SETTINGS]: settings
  });

  setStatus("Settings saved.");
}

if (form) {
  form.addEventListener("submit", (event) => {
    saveSettings(event).catch(() => {
      setStatus("Failed to save settings.");
    });
  });

  loadSettings().catch(() => {
    setStatus("Failed to load settings.");
  });
}
