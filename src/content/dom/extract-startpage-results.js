import {
  getDisplayUrlNode,
  getLinkNode,
  getQueryNode,
  getResultNodes,
  getSnippetNode,
  getTitleNode
} from "./startpage-selectors.js";
import { sanitizeText, sanitizeUrl } from "../shared/sanitize.js";

function extractQueryFromUrl(doc) {
  try {
    const parsed = new URL(doc.location?.href || "");
    return sanitizeText(parsed.searchParams.get("query") || parsed.searchParams.get("q") || "");
  } catch {
    return "";
  }
}

function isNodeVisible(node) {
  if (!node) {
    return false;
  }

  if (node.hidden || node.getAttribute("aria-hidden") === "true") {
    return false;
  }

  if (node.closest("[hidden], [aria-hidden='true']")) {
    return false;
  }

  const inlineStyle = String(node.getAttribute("style") || "").toLowerCase();
  if (inlineStyle.includes("display:none") || inlineStyle.includes("visibility:hidden")) {
    return false;
  }

  return true;
}

function toResult(resultNode) {
  if (!isNodeVisible(resultNode)) {
    return null;
  }

  const titleNode = getTitleNode(resultNode);
  const linkNode = getLinkNode(resultNode) || titleNode;
  const snippetNode = getSnippetNode(resultNode);
  const displayUrlNode = getDisplayUrlNode(resultNode);

  const title = sanitizeText(titleNode?.textContent || "");
  const url = sanitizeUrl(linkNode?.href || "");
  const snippet = sanitizeText(snippetNode?.textContent || "");
  const displayUrl = sanitizeText(displayUrlNode?.textContent || "");

  if (!title || !url) {
    return null;
  }

  return {
    title,
    url,
    snippet,
    displayUrl
  };
}

export function extractStartpageResults(doc, maxResults = 5) {
  const safeMaxResults = Number.isInteger(maxResults) && maxResults > 0 ? maxResults : 5;
  const queryNode = getQueryNode(doc);
  const query = sanitizeText(queryNode?.value || queryNode?.textContent || "") || extractQueryFromUrl(doc);
  const resultBlocks = getResultNodes(doc);
  const results = [];

  for (const block of resultBlocks) {
    const normalized = toResult(block);
    if (!normalized) {
      continue;
    }

    results.push({
      rank: results.length + 1,
      ...normalized
    });

    if (results.length >= safeMaxResults) {
      break;
    }
  }

  return { query, results };
}
