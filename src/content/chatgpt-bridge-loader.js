(function () {
  const CHATGPT_BRIDGE_STATUS = "CHATGPT_BRIDGE_STATUS";
  const CHATGPT_BRIDGE_PROGRESS = "CHATGPT_BRIDGE_PROGRESS";
  const CHATGPT_BRIDGE_PORT_READY = "CHATGPT_BRIDGE_PORT_READY";
  const BRIDGE_PING = "BRIDGE_PING";
  const BRIDGE_RUN_PROMPT = "BRIDGE_RUN_PROMPT";
  const BRIDGE_PORT_NAME = "startgpt-chatgpt-bridge";
  const BRIDGE_HEARTBEAT_MS = 1500;
  const BRIDGE_RECONNECT_DELAY_MS = 300;
  const BRIDGE_INSTANCE_ID = `bridge_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

  let bridgeModule = null;
  let moduleLoadError = "";
  let bridgePort = null;
  let heartbeatTimerId = null;
  let reconnectTimerId = null;

  function safePost(message) {
    if (!bridgePort) {
      return false;
    }

    try {
      bridgePort.postMessage(message);
      return true;
    } catch {
      return false;
    }
  }

  function getBridgePhase() {
    if (moduleLoadError) {
      return "module_load_failed";
    }
    if (bridgeModule) {
      return "module_loaded";
    }
    return "loader_loaded";
  }

  function emitBridgePresence() {
    safePost({
      type: CHATGPT_BRIDGE_PORT_READY,
      bridgeInstanceId: BRIDGE_INSTANCE_ID,
      pageUrl: window.location.href,
      lastSeenAt: Date.now()
    });

    safePost({
      type: CHATGPT_BRIDGE_STATUS,
      phase: getBridgePhase(),
      instanceId: BRIDGE_INSTANCE_ID,
      bridgeInstanceId: BRIDGE_INSTANCE_ID,
      pageUrl: window.location.href,
      lastSeenAt: Date.now(),
      errorMessage: moduleLoadError || ""
    });
  }

  function ensureHeartbeat() {
    if (heartbeatTimerId) {
      return;
    }

    heartbeatTimerId = globalThis.setInterval(() => {
      emitBridgePresence();
    }, BRIDGE_HEARTBEAT_MS);
  }

  function scheduleReconnect() {
    if (reconnectTimerId) {
      return;
    }

    reconnectTimerId = globalThis.setTimeout(() => {
      reconnectTimerId = null;
      connectBridgePort();
    }, BRIDGE_RECONNECT_DELAY_MS);
  }

  function replyToRequest(message, payload) {
    if (!message?.requestId) {
      return;
    }

    safePost({
      bridgeInstanceId: BRIDGE_INSTANCE_ID,
      replyTo: message.requestId,
      payload
    });
  }

  function handleBridgeCommand(message) {
    if (!message || message.bridgeInstanceId !== BRIDGE_INSTANCE_ID) {
      return;
    }

    if (message.type === BRIDGE_PING) {
      if (bridgeModule?.buildBridgePingResponse) {
        replyToRequest(message, {
          ...bridgeModule.buildBridgePingResponse(),
          bridgeInstanceId: BRIDGE_INSTANCE_ID
        });
        return;
      }

      if (moduleLoadError) {
        replyToRequest(message, {
          ok: false,
          code: "BRIDGE_MODULE_LOAD_FAILED",
          message: moduleLoadError,
          bridgeInstanceId: BRIDGE_INSTANCE_ID
        });
        return;
      }

      replyToRequest(message, {
        ok: false,
        code: "BRIDGE_MODULE_LOADING",
        message: "ChatGPT bridge module is still loading.",
        bridgeInstanceId: BRIDGE_INSTANCE_ID
      });
      return;
    }

    if (message.type === BRIDGE_RUN_PROMPT) {
      if (bridgeModule?.runBridgePrompt) {
        Promise.resolve(bridgeModule.runBridgePrompt(message, {
          onProgress: (progressMessage) => {
            safePost({
              type: CHATGPT_BRIDGE_PROGRESS,
              bridgeInstanceId: BRIDGE_INSTANCE_ID,
              runId: message.runId || "",
              sourceTabId: message.sourceTabId ?? null,
              progressMessage: String(progressMessage || ""),
              lastSeenAt: Date.now()
            });
          }
        }))
          .then((response) => {
            replyToRequest(message, {
              ...response,
              bridgeInstanceId: BRIDGE_INSTANCE_ID
            });
          })
          .catch((error) => {
            replyToRequest(message, {
              ok: false,
              code: "CHATGPT_BRIDGE_LOAD_FAILED",
              message: error instanceof Error ? error.message : String(error),
              recoverable: true,
              bridgeInstanceId: BRIDGE_INSTANCE_ID
            });
          });
        return;
      }

      if (moduleLoadError) {
        replyToRequest(message, {
          ok: false,
          code: "CHATGPT_BRIDGE_LOAD_FAILED",
          message: `ChatGPT bridge failed to load: ${moduleLoadError}`,
          recoverable: true,
          bridgeInstanceId: BRIDGE_INSTANCE_ID
        });
        return;
      }

      replyToRequest(message, {
        ok: false,
        code: "CHATGPT_BRIDGE_NOT_READY",
        message: "ChatGPT bridge is still loading. Try again in a moment.",
        recoverable: true,
        bridgeInstanceId: BRIDGE_INSTANCE_ID
      });
    }
  }

  function connectBridgePort() {
    const port = browser.runtime.connect({ name: BRIDGE_PORT_NAME });
    bridgePort = port;

    port.onMessage.addListener((message) => {
      handleBridgeCommand(message);
    });

    port.onDisconnect.addListener(() => {
      if (bridgePort === port) {
        bridgePort = null;
      }
      scheduleReconnect();
    });

    emitBridgePresence();
    ensureHeartbeat();
  }

  connectBridgePort();

  (async () => {
    try {
      bridgeModule = await import(browser.runtime.getURL("content/chatgpt-bridge.js"));
      emitBridgePresence();
    } catch (error) {
      moduleLoadError = error instanceof Error ? error.message : String(error);
      emitBridgePresence();

      console.error("[StartGPT][chatgpt-bridge-loader] failed to load", error);
    }
  })();

  globalThis.addEventListener("unload", () => {
    if (heartbeatTimerId) {
      globalThis.clearInterval(heartbeatTimerId);
      heartbeatTimerId = null;
    }
    if (reconnectTimerId) {
      globalThis.clearTimeout(reconnectTimerId);
      reconnectTimerId = null;
    }
    if (bridgePort) {
      try {
        bridgePort.disconnect();
      } catch {
        // Ignore unload disconnect failures.
      }
      bridgePort = null;
    }
  });
})();
