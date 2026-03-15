// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  ACK_REASON,
  RESPONSE_START_REASON,
  SUBMIT_PATH,
  getResponseStartState,
  getSubmitAcknowledgementState,
  runBridgePrompt
} from "../../src/content/chatgpt-bridge.js";

describe("chatgpt bridge submit acknowledgement", () => {
  it("does not treat injected composer text alone as an acknowledgement when the send button is missing", () => {
    const doc = new DOMParser().parseFromString(
      `
        <form>
          <div id="prompt-textarea" contenteditable="true" role="textbox">Injected prompt</div>
        </form>
      `,
      "text/html"
    );

    const composer = doc.getElementById("prompt-textarea");
    const acknowledgement = getSubmitAcknowledgementState(composer, "", 0, doc);

    expect(acknowledgement.acknowledged).toBe(false);
    expect(acknowledgement.ackReason).toBe(ACK_REASON.SEND_BUTTON_MISSING);
  });

  it("treats a disabled send button as an acknowledgement signal", () => {
    const doc = new DOMParser().parseFromString(
      `
        <form>
          <div id="prompt-textarea" contenteditable="true" role="textbox">Injected prompt</div>
          <button data-testid="send-button" aria-label="Send prompt" disabled></button>
        </form>
      `,
      "text/html"
    );

    const composer = doc.getElementById("prompt-textarea");
    const acknowledgement = getSubmitAcknowledgementState(composer, "", 0, doc);

    expect(acknowledgement.acknowledged).toBe(true);
    expect(acknowledgement.ackReason).toBe(ACK_REASON.SEND_BUTTON_DISABLED);
  });

  it("reports response start when assistant message count increases", () => {
    const doc = new DOMParser().parseFromString(
      `
        <main>
          <article data-message-author-role="assistant">
            <p>First response chunk</p>
          </article>
        </main>
      `,
      "text/html"
    );

    const responseStart = getResponseStartState(0, null, doc);

    expect(responseStart.started).toBe(true);
    expect(responseStart.reason).toBe(RESPONSE_START_REASON.ASSISTANT_MESSAGE_COUNT_INCREASED);
  });

  it("does not treat preexisting streaming as a new acknowledgement or response start", () => {
    const doc = new DOMParser().parseFromString(
      `
        <main>
          <form>
            <div id="prompt-textarea" contenteditable="true" role="textbox">Injected prompt</div>
            <button type="button" data-testid="send-button" aria-label="Send prompt"></button>
          </form>
          <article data-message-author-role="assistant">
            <p>Previous answer still visible</p>
          </article>
          <button data-testid="stop-button" aria-label="Stop generating"></button>
        </main>
      `,
      "text/html"
    );

    const composer = doc.getElementById("prompt-textarea");
    const baseline = {
      streamingVisibleBeforeSubmit: true,
      sendButtonReadyBeforeSubmit: true,
      sendButtonPresentBeforeSubmit: true,
      latestAssistantTextBeforeSubmit: "Previous answer still visible"
    };

    const acknowledgement = getSubmitAcknowledgementState(composer, "", 1, doc, baseline);
    const responseStart = getResponseStartState(
      1,
      doc.querySelector('[data-message-author-role="assistant"]'),
      doc,
      baseline
    );

    expect(acknowledgement.acknowledged).toBe(false);
    expect(acknowledgement.ackReason).toBe(ACK_REASON.SEND_BUTTON_STILL_READY);
    expect(responseStart.started).toBe(false);
    expect(responseStart.reason).toBe(RESPONSE_START_REASON.TIMEOUT);
  });

  it("waits for a send button to become ready and clicks it instead of falling back to requestSubmit", async () => {
    document.body.innerHTML = `
      <main>
        <form id="composer-form">
          <div id="prompt-textarea" contenteditable="true" role="textbox"></div>
          <button type="button" data-testid="send-button" aria-label="Send prompt" disabled></button>
        </form>
      </main>
    `;

    const form = document.getElementById("composer-form");
    const composer = document.getElementById("prompt-textarea");
    const sendButton = document.querySelector('button[data-testid="send-button"]');

    form.requestSubmit = () => {
      throw new Error("requestSubmit should not be used when the send button becomes ready");
    };

    composer.addEventListener("input", () => {
      queueMicrotask(() => {
        sendButton.disabled = false;
      });
    });

    sendButton.addEventListener("click", () => {
      const existing = document.querySelector('[data-message-author-role="assistant"]');
      if (existing) {
        return;
      }
      const article = document.createElement("article");
      article.setAttribute("data-message-author-role", "assistant");
      article.innerHTML = "<p>Generated answer text.</p>";
      document.body.appendChild(article);
    });

    const response = await runBridgePrompt({
      type: "BRIDGE_RUN_PROMPT",
      runId: "run_1",
      sourceTabId: 1,
      query: "test query",
      prompt: "test prompt",
      results: [
        {
          rank: 1,
          title: "Example",
          url: "https://example.com",
          snippet: "Example snippet",
          displayUrl: "example.com"
        }
      ]
    });

    expect(response.ok).toBe(true);
    expect(response.debug?.submitDiagnostics?.finalSubmitPath).toBe(SUBMIT_PATH.SEND_BUTTON_CLICK_AFTER_WAIT);
    expect(response.debug?.submitDiagnostics?.finalAckReason).toBe(ACK_REASON.ASSISTANT_MESSAGE_COUNT_INCREASED);
  });

  it("waits for the send button to appear after typing before falling back", async () => {
    document.body.innerHTML = `
      <main>
        <form id="composer-form">
          <div id="prompt-textarea" contenteditable="true" role="textbox"></div>
        </form>
      </main>
    `;

    const form = document.getElementById("composer-form");
    const composer = document.getElementById("prompt-textarea");

    form.requestSubmit = () => {
      throw new Error("requestSubmit should not be used when the send button appears in time");
    };

    composer.addEventListener("input", () => {
      queueMicrotask(() => {
        const sendButton = document.createElement("button");
        sendButton.type = "button";
        sendButton.setAttribute("data-testid", "send-button");
        sendButton.setAttribute("aria-label", "Send prompt");
        sendButton.addEventListener("click", () => {
          const article = document.createElement("article");
          article.setAttribute("data-message-author-role", "assistant");
          article.innerHTML = "<p>Generated after late button mount.</p>";
          document.body.appendChild(article);
        });
        form.appendChild(sendButton);
      });
    });

    const response = await runBridgePrompt({
      type: "BRIDGE_RUN_PROMPT",
      runId: "run_2",
      sourceTabId: 2,
      query: "test query",
      prompt: "test prompt",
      results: [
        {
          rank: 1,
          title: "Example",
          url: "https://example.com",
          snippet: "Example snippet",
          displayUrl: "example.com"
        }
      ]
    });

    expect(response.ok).toBe(true);
    expect(response.debug?.submitDiagnostics?.finalSubmitPath).toBe(SUBMIT_PATH.SEND_BUTTON_CLICK_AFTER_WAIT);
    expect(response.debug?.submitDiagnostics?.finalSendButtonPresent).toBe(true);
  });

  it("waits for a previous streaming response to finish before submitting a new prompt", async () => {
    document.body.innerHTML = `
      <main>
        <form id="composer-form">
          <div id="prompt-textarea" contenteditable="true" role="textbox"></div>
          <button type="button" data-testid="send-button" aria-label="Send prompt"></button>
        </form>
        <article data-message-author-role="assistant">
          <p>Old answer</p>
        </article>
        <button data-testid="stop-button" aria-label="Stop generating"></button>
      </main>
    `;

    const sendButton = document.querySelector('button[data-testid="send-button"]');
    const stopButton = document.querySelector('button[data-testid="stop-button"]');

    setTimeout(() => {
      stopButton.remove();
    }, 20);

    sendButton.addEventListener("click", () => {
      const article = document.createElement("article");
      article.setAttribute("data-message-author-role", "assistant");
      article.innerHTML = "<p>Fresh answer</p>";
      document.body.appendChild(article);
    });

    const response = await runBridgePrompt({
      type: "BRIDGE_RUN_PROMPT",
      runId: "run_3",
      sourceTabId: 3,
      query: "test query",
      prompt: "test prompt",
      results: [
        {
          rank: 1,
          title: "Example",
          url: "https://example.com",
          snippet: "Example snippet",
          displayUrl: "example.com"
        }
      ]
    });

    expect(response.ok).toBe(true);
    expect(response.debug?.submitDiagnostics?.finalPreexistingStreamingDetected).toBe(true);
    expect(response.debug?.submitDiagnostics?.finalWaitedForIdleMs).toBeGreaterThan(0);
    expect(response.response?.text).toContain("Fresh answer");
  });
});
