const COMPOSER_SELECTORS = [
  '#prompt-textarea[contenteditable="true"][role="textbox"]',
  '[contenteditable="true"][role="textbox"]#prompt-textarea',
  '[contenteditable="true"][role="textbox"]',
  '[contenteditable="true"]',
  'textarea[data-testid="prompt-textarea"]',
  'textarea[name="prompt-textarea"]',
  'textarea[placeholder*="Ask"]',
  'textarea[placeholder*="Message"]',
  'form textarea',
  '[data-testid="composer"] textarea'
];

const SEND_BUTTON_SELECTORS = [
  'button[data-testid="send-button"]',
  '#composer-submit-button',
  'button[aria-label="Send prompt"]',
  'button[aria-label*="Send prompt"]',
  'form button[aria-label*="Send"]',
  'form button[aria-label*="send"]',
  'button[aria-label="Send message"]',
  "form button[type='submit']"
];

const LOGIN_HINT_SELECTORS = [
  'a[href*="login"]',
  'button[data-testid="login-button"]',
  'button[aria-label*="Log in"]',
  '[data-testid="auth-flow"]'
];

const ASSISTANT_MESSAGE_SELECTORS = [
  '[data-message-author-role="assistant"]',
  '[data-testid="conversation-turn-assistant"]',
  '[data-testid*="conversation-turn-assistant"]',
  'article[data-author="assistant"]'
];

const STREAMING_INDICATOR_SELECTORS = [
  'button[data-testid="stop-button"]',
  'button[aria-label*="Stop generating"]',
  '[data-testid="response-streaming"]',
  '[data-testid="typing-indicator"]'
];

const SOURCE_LINK_SELECTORS = [
  'a[href^="http"]',
  'a[rel~="noopener"][href]'
];

function queryFirstWithMeta(doc, selectors) {
  for (let index = 0; index < selectors.length; index += 1) {
    const selector = selectors[index];
    const node = doc.querySelector(selector);
    if (node) {
      return { node, selector, matched: true, index };
    }
  }

  return { node: null, selector: null, matched: false, index: -1 };
}

function queryFirst(doc, selectors) {
  return queryFirstWithMeta(doc, selectors).node;
}

function isElementVisible(node) {
  if (!node || !(node instanceof Element) || !node.isConnected) {
    return false;
  }

  if (node.hidden || node.getAttribute("aria-hidden") === "true") {
    return false;
  }

  const style = globalThis.getComputedStyle ? globalThis.getComputedStyle(node) : null;
  if (style && (style.display === "none" || style.visibility === "hidden" || style.opacity === "0")) {
    return false;
  }

  return true;
}

function queryFirstVisibleWithMeta(doc, selectors) {
  for (let index = 0; index < selectors.length; index += 1) {
    const selector = selectors[index];
    const nodes = [...doc.querySelectorAll(selector)];
    const visible = nodes.find((node) => isElementVisible(node));
    if (visible) {
      return { node: visible, selector, matched: true, index };
    }
  }

  return { node: null, selector: null, matched: false, index: -1 };
}

function queryAllFirst(docOrNode, selectors) {
  for (const selector of selectors) {
    const nodes = [...docOrNode.querySelectorAll(selector)];
    if (nodes.length > 0) {
      return nodes;
    }
  }

  return [];
}

export function findComposer(doc) {
  return queryFirstVisibleWithMeta(doc, COMPOSER_SELECTORS).node;
}

export function findComposerWithDiagnostics(doc) {
  return queryFirstVisibleWithMeta(doc, COMPOSER_SELECTORS);
}

export function findSendButton(doc) {
  const node = queryFirstVisibleWithMeta(doc, SEND_BUTTON_SELECTORS).node;
  if (!node) {
    return null;
  }

  if (node.tagName?.toLowerCase() === "button") {
    return node;
  }

  return node.closest("button");
}

export function findSendButtonWithDiagnostics(doc) {
  const selected = queryFirstVisibleWithMeta(doc, SEND_BUTTON_SELECTORS);
  if (!selected.node) {
    return selected;
  }

  if (selected.node.tagName?.toLowerCase() === "button") {
    return selected;
  }

  const closestButton = selected.node.closest("button");
  return {
    ...selected,
    node: closestButton
  };
}

export function findLoginHint(doc) {
  return queryFirstVisibleWithMeta(doc, LOGIN_HINT_SELECTORS).node;
}

export function findLoginHintWithDiagnostics(doc) {
  return queryFirstVisibleWithMeta(doc, LOGIN_HINT_SELECTORS);
}

export function findComposerForm(composer) {
  return composer?.closest("form") || null;
}

export function findAssistantMessageNodes(doc) {
  return queryAllFirst(doc, ASSISTANT_MESSAGE_SELECTORS);
}

export function getLatestAssistantMessageNode(doc) {
  const nodes = findAssistantMessageNodes(doc);
  return nodes.length > 0 ? nodes[nodes.length - 1] : null;
}

export function hasStreamingIndicator(doc) {
  return Boolean(queryFirstVisibleWithMeta(doc, STREAMING_INDICATOR_SELECTORS).node);
}

export function findStreamingIndicatorWithDiagnostics(doc) {
  return queryFirstVisibleWithMeta(doc, STREAMING_INDICATOR_SELECTORS);
}

export function findSourceLinkNodes(messageNode) {
  if (!messageNode) {
    return [];
  }

  const seen = new Set();
  const links = [];

  for (const selector of SOURCE_LINK_SELECTORS) {
    const candidates = [...messageNode.querySelectorAll(selector)];
    for (const link of candidates) {
      const href = String(link.getAttribute("href") || "").trim();
      if (!href || seen.has(href)) {
        continue;
      }
      seen.add(href);
      links.push(link);
    }
  }

  return links;
}
