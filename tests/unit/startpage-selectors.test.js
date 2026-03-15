// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  getOverviewCardMountTarget,
  isStartpageResultsPage
} from "../../src/content/dom/startpage-selectors.js";

function createDocument(html, url) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return { doc, url };
}

describe("isStartpageResultsPage", () => {
  it("treats known Startpage results paths as results pages", () => {
    const { doc, url } = createDocument("<main></main>", "https://www.startpage.com/sp/search");
    expect(isStartpageResultsPage(doc, url)).toBe(true);
  });

  it("treats visible result blocks as a results page even when query selectors miss", () => {
    const { doc, url } = createDocument(
      `
        <main>
          <div data-testid="result">
            <h3><a href="https://example.com">Example</a></h3>
          </div>
        </main>
      `,
      "https://startpage.com/search"
    );

    expect(isStartpageResultsPage(doc, url)).toBe(true);
  });

  it("does not treat the Startpage home page as a results page", () => {
    const { doc, url } = createDocument(
      '<input type="search" name="query" value="" />',
      "https://www.startpage.com/"
    );

    expect(isStartpageResultsPage(doc, url)).toBe(false);
  });
});

describe("getOverviewCardMountTarget", () => {
  it("mounts the overview card in the main page lane before existing content", () => {
    const { doc } = createDocument(
      `
        <main>
          <section id="filters"></section>
          <div id="results">
            <article data-testid="result">
              <h3><a href="https://example.com">Example</a></h3>
            </article>
          </div>
        </main>
      `,
      "https://startpage.com/search"
    );

    const target = getOverviewCardMountTarget(doc);

    expect(target.parent).toBe(doc.querySelector("main"));
    expect(target.before).toBe(doc.getElementById("filters"));
  });

  it("prefers the top-level main lane instead of nesting beside result list items", () => {
    const { doc } = createDocument(
      `
        <main id="results-root">
          <ul id="result-list">
            <li class="w-gl__result">
              <h3><a href="https://example.com">Example</a></h3>
            </li>
          </ul>
        </main>
      `,
      "https://startpage.com/search"
    );

    const target = getOverviewCardMountTarget(doc);

    expect(target.parent).toBe(doc.getElementById("results-root"));
    expect(target.before).toBe(doc.getElementById("result-list"));
  });

  it("falls back to the main container when no results are available yet", () => {
    const { doc } = createDocument(
      `
        <main id="results-root">
          <section id="filters"></section>
        </main>
      `,
      "https://startpage.com/search"
    );

    const target = getOverviewCardMountTarget(doc);

    expect(target.parent).toBe(doc.getElementById("results-root"));
    expect(target.before).toBe(doc.getElementById("filters"));
  });
});
