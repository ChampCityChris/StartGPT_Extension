(function () {
  const STARTPAGE_SCRIPT_STATUS = "STARTPAGE_SCRIPT_STATUS";

  (async () => {
    try {
      await browser.runtime.sendMessage({
        type: STARTPAGE_SCRIPT_STATUS,
        phase: "loader_loaded",
        pageUrl: window.location.href,
        lastSeenAt: Date.now()
      });
      await import(browser.runtime.getURL("content/startpage.js"));
    } catch (error) {
      await browser.runtime.sendMessage({
        type: STARTPAGE_SCRIPT_STATUS,
        phase: "module_load_failed",
        pageUrl: window.location.href,
        lastSeenAt: Date.now(),
        errorMessage: error instanceof Error ? error.message : String(error)
      }).catch(() => undefined);
      console.error("[StartGPT][startpage-loader] failed to load", error);
    }
  })();
})();
