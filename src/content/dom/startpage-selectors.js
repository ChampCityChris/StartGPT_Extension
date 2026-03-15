const QUERY_SELECTORS = [
  'input[name="query"]',
  'input[name="q"]',
  'input[type="search"][name]',
  'input[type="search"]',
  'input[name*="query"]',
  'textarea[name="query"]',
  'textarea[name="q"]'
];

const RESULT_BLOCK_SELECTORS = [
  ".result",
  'article[data-testid="result"]',
  '[data-testid="result"]',
  '[data-testid*="result"]',
  "article.w-gl__result",
  ".w-gl__result",
  "li.w-gl__result",
  '[data-result-index]',
  'li[class*="result"]',
  'article[class*="result"]',
  "main article"
];

const TITLE_SELECTORS = [
  'a[data-testid="gl-title-link"]',
  "a.result-title",
  "a.result-link",
  "h2 a[href]",
  "h3 a[href]",
  'a[data-testid="result-title-a"]',
  "a.w-gl__result-title"
];

const LINK_SELECTORS = [
  'a[data-testid="gl-title-link"]',
  "a.result-title",
  "a.result-link",
  "h2 a[href]",
  "h3 a[href]"
];

const SNIPPET_SELECTORS = [
  '[data-testid="result-description"]',
  "p.description",
  'p[class*="description"]',
  ".w-gl__description",
  ".result-snippet",
  "p"
];

const DISPLAY_URL_SELECTORS = [
  '[data-testid="result-url"]',
  ".w-gl__result-url",
  ".w-gl__url",
  "cite"
];

function queryFirst(docOrNode, selectors) {
  for (const selector of selectors) {
    const node = docOrNode.querySelector(selector);
    if (node) {
      return node;
    }
  }

  return null;
}

function hasKnownResultsPath(parsedUrl) {
  const pathname = parsedUrl.pathname.toLowerCase();
  return [
    "/sp/search",
    "/do/search",
    "/do/dsearch",
    "/search"
  ].includes(pathname);
}

export function getQueryNode(doc) {
  return queryFirst(doc, QUERY_SELECTORS);
}

export function getResultNodes(doc) {
  for (const selector of RESULT_BLOCK_SELECTORS) {
    const nodes = [...doc.querySelectorAll(selector)];
    if (nodes.length === 0) {
      continue;
    }

    const resultLikeNodes = nodes.filter((node) => {
      const titleNode = queryFirst(node, TITLE_SELECTORS);
      const linkNode = queryFirst(node, LINK_SELECTORS);
      return Boolean(titleNode && linkNode);
    });

    if (resultLikeNodes.length > 0) {
      return resultLikeNodes;
    }
  }

  return [];
}

export function getTitleNode(resultNode) {
  return queryFirst(resultNode, TITLE_SELECTORS);
}

export function getLinkNode(resultNode) {
  return queryFirst(resultNode, LINK_SELECTORS);
}

export function getSnippetNode(resultNode) {
  return queryFirst(resultNode, SNIPPET_SELECTORS);
}

export function getDisplayUrlNode(resultNode) {
  return queryFirst(resultNode, DISPLAY_URL_SELECTORS);
}

export function getOverviewCardMountTarget(doc) {
  const fallbackParent =
    doc.querySelector("main") ||
    doc.querySelector("#main") ||
    doc.body ||
    doc.documentElement;

  return {
    parent: fallbackParent,
    before: fallbackParent?.firstElementChild || fallbackParent?.firstChild || null
  };
}

export function isStartpageResultsPage(doc, pageUrl = "") {
  let parsed;
  try {
    parsed = new URL(pageUrl || doc.location?.href || "");
  } catch {
    return false;
  }

  if (!parsed.hostname.includes("startpage.com")) {
    return false;
  }

  const hasSearchParam = Boolean(parsed.searchParams.get("query") || parsed.searchParams.get("q"));
  const hasKnownPath = hasKnownResultsPath(parsed);
  const hasQueryNode = Boolean(getQueryNode(doc));
  const hasResultNodes = getResultNodes(doc).length > 0;

  return hasKnownPath || hasResultNodes || hasSearchParam || (hasQueryNode && hasResultNodes);
}
