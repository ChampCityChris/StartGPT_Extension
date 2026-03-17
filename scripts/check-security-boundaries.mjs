import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";

const PROJECT_ROOT = resolve(process.cwd());
const SRC_ROOT = resolve(PROJECT_ROOT, "src");
const SKIP_DIRS = new Set(["node_modules", ".git"]);
const TEXT_EXTENSIONS = new Set([".js", ".json", ".html"]);

function walkFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) {
      continue;
    }
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      files.push(...walkFiles(fullPath));
    } else if (TEXT_EXTENSIONS.has(extname(fullPath))) {
      files.push(fullPath);
    }
  }
  return files;
}

const files = walkFiles(SRC_ROOT);
const findings = [];

for (const filePath of files) {
  const rel = relative(SRC_ROOT, filePath).replace(/\\/g, "/");
  const text = readFileSync(filePath, "utf8");

  if (/chatgpt\.com/i.test(text)) {
    findings.push(`${rel}: contains chatgpt.com`);
  }

  if (/api\.openai\.com/i.test(text) && rel !== "background/openai-client.js" && rel !== "manifest.json") {
    findings.push(`${rel}: api.openai.com allowed only in background/openai-client.js and manifest.json`);
  }

  if (rel.startsWith("content/")) {
    if (/browser\.storage/i.test(text)) {
      findings.push(`${rel}: content scripts must not access browser.storage`);
    }
    if (/localStorage|sessionStorage/i.test(text)) {
      findings.push(`${rel}: content scripts must not access local/session storage`);
    }
  }
}

if (findings.length > 0) {
  console.error("[check-security-boundaries] failed:");
  for (const finding of findings) {
    console.error(`- ${finding}`);
  }
  process.exit(1);
}

console.log("[check-security-boundaries] passed");
