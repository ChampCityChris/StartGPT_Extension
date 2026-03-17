import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

function readFile(pathParts) {
  return readFileSync(resolve(process.cwd(), ...pathParts), "utf8");
}

function walkSrcFiles(rootDir) {
  const files = [];
  for (const entry of readdirSync(rootDir)) {
    const full = join(rootDir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      files.push(...walkSrcFiles(full));
    } else if (full.endsWith(".js") || full.endsWith(".json") || full.endsWith(".html")) {
      files.push(full);
    }
  }
  return files;
}

describe("security boundaries (static assertions)", () => {
  it("content scripts do not access key storage primitives", () => {
    const contentFiles = [
      readFile(["src", "content", "startpage-loader.js"]),
      readFile(["src", "content", "startpage.js"]),
      readFile(["src", "content", "inject", "overview-card.js"])
    ].join("\n");

    expect(contentFiles).not.toMatch(/openai_api_key/i);
    expect(contentFiles).not.toMatch(/browser\.storage/i);
    expect(contentFiles).not.toMatch(/localStorage/i);
    expect(contentFiles).not.toMatch(/sessionStorage/i);
    expect(contentFiles).not.toMatch(/api\.openai\.com/i);
  });

  it("production source contains no chatgpt.com dependency", () => {
    const srcFiles = walkSrcFiles(resolve(process.cwd(), "src"));
    const joined = srcFiles.map((file) => readFileSync(file, "utf8")).join("\n").toLowerCase();
    expect(joined).not.toContain("chatgpt.com");
    expect(joined).not.toContain("chatgpt");
  });
});
