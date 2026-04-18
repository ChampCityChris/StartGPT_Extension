const KNOWN_DEEP_DIVE_HEADINGS = [
  "What the results suggest",
  "Where the evidence is weak",
  "Answer"
];

function normalizeRawText(input) {
  return String(input ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .trim();
}

function normalizeInlineText(input) {
  return String(input ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function applyFormattingHints(text) {
  return text
    .replace(/[ \t]+(###\s+)/g, "\n\n$1")
    .replace(/([.!?])\s+-\s+(?=[A-Z0-9"'(])/g, "$1\n- ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function splitHeadingAndBody(chunk) {
  const trimmed = String(chunk || "").trim();
  if (!trimmed) {
    return {
      heading: "",
      body: ""
    };
  }

  const lower = trimmed.toLowerCase();
  for (const heading of KNOWN_DEEP_DIVE_HEADINGS) {
    const marker = heading.toLowerCase();
    if (!lower.startsWith(marker)) {
      continue;
    }

    let body = trimmed.slice(heading.length).trimStart();
    if (body.startsWith(":")) {
      body = body.slice(1).trimStart();
    }
    return {
      heading,
      body
    };
  }

  const lineBreak = trimmed.indexOf("\n");
  if (lineBreak === -1) {
    return {
      heading: normalizeInlineText(trimmed),
      body: ""
    };
  }

  return {
    heading: normalizeInlineText(trimmed.slice(0, lineBreak)),
    body: trimmed.slice(lineBreak + 1).trim()
  };
}

function parseBodyBlocks(input) {
  const raw = String(input ?? "").trim();
  if (!raw) {
    return [];
  }

  const hinted = raw
    .replace(/[ \t]+-\s+(?=[A-Z0-9"'(])/g, "\n- ")
    .replace(/\n{3,}/g, "\n\n");
  const lines = hinted.split("\n");

  const blocks = [];
  let paragraphLines = [];
  let listItems = [];

  function flushParagraph() {
    if (paragraphLines.length === 0) {
      return;
    }
    const text = normalizeInlineText(paragraphLines.join(" "));
    if (text) {
      blocks.push({
        type: "paragraph",
        text
      });
    }
    paragraphLines = [];
  }

  function flushList() {
    if (listItems.length === 0) {
      return;
    }
    blocks.push({
      type: "list",
      items: listItems
    });
    listItems = [];
  }

  for (const line of lines) {
    const trimmed = normalizeInlineText(line);
    if (!trimmed) {
      flushParagraph();
      flushList();
      continue;
    }

    const bullet = trimmed.match(/^[-*]\s+(.+)/);
    if (bullet) {
      flushParagraph();
      const itemText = normalizeInlineText(bullet[1]);
      if (itemText) {
        listItems.push(itemText);
      }
      continue;
    }

    flushList();
    paragraphLines.push(trimmed);
  }

  flushParagraph();
  flushList();
  return blocks;
}

export function parseSummaryBlocks(input) {
  const normalized = normalizeRawText(input);
  if (!normalized) {
    return [];
  }

  const hinted = applyFormattingHints(normalized);
  if (!hinted.includes("###")) {
    return parseBodyBlocks(hinted);
  }

  const blocks = [];
  let cursor = 0;

  while (cursor < hinted.length) {
    const markerIndex = hinted.indexOf("###", cursor);
    if (markerIndex === -1) {
      const tail = hinted.slice(cursor);
      blocks.push(...parseBodyBlocks(tail));
      break;
    }

    if (markerIndex > cursor) {
      const preface = hinted.slice(cursor, markerIndex);
      blocks.push(...parseBodyBlocks(preface));
    }

    const nextMarker = hinted.indexOf("###", markerIndex + 3);
    const chunk = hinted.slice(markerIndex + 3, nextMarker === -1 ? hinted.length : nextMarker).trim();
    if (chunk) {
      const section = splitHeadingAndBody(chunk);
      if (section.heading) {
        blocks.push({
          type: "heading",
          text: normalizeInlineText(section.heading)
        });
      }
      blocks.push(...parseBodyBlocks(section.body));
    }

    if (nextMarker === -1) {
      break;
    }
    cursor = nextMarker;
  }

  return blocks;
}

function appendParagraph(container, text) {
  const node = document.createElement("p");
  node.textContent = text;
  container.append(node);
}

export function renderSummaryText(container, text, placeholder = "") {
  if (!container) {
    return;
  }

  container.textContent = "";
  const blocks = parseSummaryBlocks(text);

  if (blocks.length === 0) {
    const fallback = normalizeInlineText(placeholder);
    if (fallback) {
      appendParagraph(container, fallback);
    }
    return;
  }

  for (const block of blocks) {
    if (block.type === "heading") {
      const heading = document.createElement("h3");
      heading.textContent = block.text;
      container.append(heading);
      continue;
    }

    if (block.type === "paragraph") {
      appendParagraph(container, block.text);
      continue;
    }

    if (block.type === "list") {
      const list = document.createElement("ul");
      for (const itemText of block.items) {
        const item = document.createElement("li");
        item.textContent = itemText;
        list.append(item);
      }
      container.append(list);
    }
  }
}
