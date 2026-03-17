export const STARTGPT_SIDEBAR_PANEL_URL = "/sidebar/sidebar.html";
export const SIDEBAR_UNAVAILABLE_URL = "/sidebar/unavailable.html";

export function isStartpageUrl(url) {
  if (typeof url !== "string" || !url) {
    return false;
  }

  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.hostname.endsWith("startpage.com");
  } catch {
    return false;
  }
}

export function isStartpageResultsUrl(url) {
  if (!isStartpageUrl(url)) {
    return false;
  }

  try {
    const parsed = new URL(url);
    const path = parsed.pathname.toLowerCase();
    return parsed.searchParams.has("query")
      || parsed.searchParams.has("q")
      || path.includes("/sp/search")
      || path.includes("/search");
  } catch {
    return false;
  }
}

export function getSidebarPanelForUrl(url) {
  return isStartpageResultsUrl(url) ? STARTGPT_SIDEBAR_PANEL_URL : SIDEBAR_UNAVAILABLE_URL;
}
