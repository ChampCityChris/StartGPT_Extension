import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

function listFilesRecursive(rootDir) {
  const out = [];
  for (const entry of readdirSync(rootDir)) {
    const absolute = join(rootDir, entry);
    const stat = statSync(absolute);
    if (stat.isDirectory()) {
      out.push(...listFilesRecursive(absolute));
    } else if (absolute.endsWith(".js") || absolute.endsWith(".json")) {
      out.push(absolute);
    }
  }
  return out;
}

describe("OpenAI call boundary", () => {
  it("keeps api.openai.com usage limited to manifest host permissions and background client", () => {
    const srcRoot = resolve(process.cwd(), "src");
    const files = listFilesRecursive(srcRoot);
    const offenders = [];

    for (const file of files) {
      const text = readFileSync(file, "utf8");
      if (!text.includes("api.openai.com")) {
        continue;
      }

      const rel = relative(srcRoot, file).replace(/\\/g, "/");
      const allowed = rel === "manifest.json" || rel === "background/openai-client.js";
      if (!allowed) {
        offenders.push(rel);
      }
    }

    expect(offenders).toEqual([]);
  });
});
