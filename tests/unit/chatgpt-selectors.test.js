// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  findComposer,
  findSendButton,
  hasStreamingIndicator
} from "../../src/content/dom/chatgpt-selectors.js";

function loadFixtureDocument(fileName) {
  const filePath = resolve(process.cwd(), "tests", "fixtures", fileName);
  const html = readFileSync(filePath, "utf8");
  return new DOMParser().parseFromString(html, "text/html");
}

describe("chatgpt-selectors streaming indicator", () => {
  it("prefers the visible contenteditable composer over the hidden fallback textarea", () => {
    const doc = new DOMParser().parseFromString(
      `
        <form>
          <textarea name="prompt-textarea" style="display: none;"></textarea>
          <div id="prompt-textarea" contenteditable="true" role="textbox"></div>
          <button data-testid="send-button" aria-label="Send prompt"></button>
        </form>
      `,
      "text/html"
    );

    const composer = findComposer(doc);
    expect(composer?.tagName).toBe("DIV");
    expect(composer?.getAttribute("role")).toBe("textbox");
  });

  it("finds the current Send prompt button shape", () => {
    const doc = new DOMParser().parseFromString(
      `
        <form>
          <div id="prompt-textarea" contenteditable="true" role="textbox"></div>
          <button id="composer-submit-button" data-testid="send-button" aria-label="Send prompt"></button>
        </form>
      `,
      "text/html"
    );

    const sendButton = findSendButton(doc);
    expect(sendButton?.getAttribute("data-testid")).toBe("send-button");
    expect(sendButton?.getAttribute("aria-label")).toBe("Send prompt");
  });

  it("detects visible streaming indicator", () => {
    const doc = loadFixtureDocument("chatgpt-loading.html");
    expect(hasStreamingIndicator(doc)).toBe(true);
  });

  it("ignores hidden streaming indicator", () => {
    const doc = loadFixtureDocument("chatgpt-response-hidden-stop.html");
    expect(hasStreamingIndicator(doc)).toBe(false);
  });
});
