export const DEBUG = {
  enabled: true
};

export const STATUS = {
  IDLE: "idle",
  CAPTURED: "captured",
  QUEUED: "queued",
  OPENING_BRIDGE: "opening_bridge",
  WAITING_FOR_CHATGPT: "waiting_for_chatgpt",
  SUBMITTING_PROMPT: "submitting_prompt",
  WAITING_FOR_RESPONSE: "waiting_for_response",
  PARSING_RESPONSE: "parsing_response",
  COMPLETED: "completed",
  FAILED: "failed"
};

export const STORAGE_KEYS = {
  SETTINGS: "settings"
};

export const DEFAULT_SETTINGS = {
  autoRunOnStartpage: true,
  autoInjectOverviewCard: true,
  maxResults: 5,
  promptMode: "grounded_overview",
  debugMode: false
};
