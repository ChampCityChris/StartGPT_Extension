function toSessionWithTabId(tabId, session) {
  if (!session || typeof session !== "object") {
    return null;
  }
  return {
    tabId,
    ...session
  };
}

export function selectPopupSession(stateResponse, preferredTabId = null) {
  if (stateResponse?.session && typeof stateResponse.session === "object") {
    return stateResponse.session;
  }

  const sessionsByTabId = stateResponse?.state?.sessions;
  if (!sessionsByTabId || typeof sessionsByTabId !== "object") {
    return null;
  }

  if (Number.isInteger(preferredTabId)) {
    const byPreferredTab = toSessionWithTabId(preferredTabId, sessionsByTabId[String(preferredTabId)]);
    if (byPreferredTab) {
      return byPreferredTab;
    }
  }

  return null;
}
