function createSourceItem(source) {
  const listItem = document.createElement("li");
  const title = String(source?.title || source?.url || "Untitled source");
  const url = String(source?.url || "").trim();

  if (!url) {
    listItem.textContent = title;
    return listItem;
  }

  const link = document.createElement("a");
  link.href = url;
  link.textContent = title;
  link.target = "_blank";
  link.rel = "noreferrer noopener";

  listItem.append(link);
  return listItem;
}

export function renderSourceList(element, sources) {
  element.textContent = "";

  if (!Array.isArray(sources) || sources.length === 0) {
    const emptyItem = document.createElement("li");
    emptyItem.textContent = "No sources available yet.";
    element.append(emptyItem);
    return;
  }

  for (const source of sources) {
    element.append(createSourceItem(source));
  }
}
