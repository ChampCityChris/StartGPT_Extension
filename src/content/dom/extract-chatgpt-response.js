import {
  findSourceLinkNodes,
  getLatestAssistantMessageNode,
  hasStreamingIndicator
} from "./chatgpt-selectors.js";
import { sanitizeText, sanitizeUrl } from "../shared/sanitize.js";

function normalizeMessageText(node) {
  return sanitizeText(node?.textContent || "");
}

function extractSourcesFromMessage(node) {
  const linkNodes = findSourceLinkNodes(node);
  const sources = [];

  for (const link of linkNodes) {
    const url = sanitizeUrl(link.getAttribute("href") || "");
    if (!url) {
      continue;
    }

    const title = sanitizeText(link.textContent || url);
    sources.push({
      title: title || url,
      url
    });
  }

  return sources;
}

export function extractChatgptResponse(doc) {
  const latestMessageNode = getLatestAssistantMessageNode(doc);

  if (!latestMessageNode) {
    return {
      text: "",
      sources: [],
      hasStarted: false,
      isComplete: false
    };
  }

  const text = normalizeMessageText(latestMessageNode);
  const sources = extractSourcesFromMessage(latestMessageNode);
  const streaming = hasStreamingIndicator(doc);

  return {
    text,
    sources,
    hasStarted: text.length > 0,
    isComplete: text.length > 0 && !streaming
  };
}
