export const DEBUG = {
  enabled: false
};

export const STATUS = {
  IDLE: "idle",
  CAPTURED: "captured",
  QUEUED: "queued",
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed"
};

export const SUMMARY_MODE = {
  QUICK_OVERVIEW: "quick_overview",
  EXPANDED: "expanded_perplexity"
};

export const ALLOWED_MODELS = [
  "gpt-4.1-mini",
  "gpt-4.1",
  "gpt-4o-mini"
];

export const STORAGE_KEYS = {
  SETTINGS: "settings",
  OPENAI_API_KEY: "openai_api_key"
};

export const LIMITS = {
  MAX_MESSAGE_BYTES: 50000,
  MAX_QUERY_CHARS: 500,
  MAX_RESULT_COUNT: 10,
  MAX_PROMPT_CHARS: 18000,
  MAX_FOLLOW_UP_CHARS: 1200,
  MAX_API_KEY_CHARS: 200,
  MAX_RESULTS_CAP: 10,
  MAX_OUTPUT_TOKENS_CAP: 1200,
  REQUEST_TIMEOUT_MS_CAP: 60000,
  REQUEST_TIMEOUT_MS_MIN: 3000
};

export const OPENAI_DEFAULTS = {
  defaultTimeoutMs: 30000
};

export const DEFAULT_SETTINGS = {
  autoInjectOverviewCard: true,
  maxResults: 5,
  model: ALLOWED_MODELS[0],
  defaultSummaryMode: SUMMARY_MODE.QUICK_OVERVIEW,
  maxOutputTokens: 600,
  requestTimeoutMs: 30000,
  debugMode: false
};
