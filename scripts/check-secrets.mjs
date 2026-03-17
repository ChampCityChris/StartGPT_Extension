import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";

const PROJECT_ROOT = resolve(process.cwd());
const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  ".playwright-browsers",
  ".npm-cache",
  "web-ext-artifacts"
]);
const TEXT_EXTENSIONS = new Set([
  ".js",
  ".mjs",
  ".cjs",
  ".json",
  ".md",
  ".html",
  ".css",
  ".txt"
]);

const KEY_LIKE_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{20,}\b/g,
  /\bsk-proj-[A-Za-z0-9_-]{20,}\b/g
];

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
      continue;
    }
    if (TEXT_EXTENSIONS.has(extname(fullPath))) {
      files.push(fullPath);
    }
  }
  return files;
}

function findLeaks(filePath) {
  const content = readFileSync(filePath, "utf8");
  const leaks = [];
  for (const pattern of KEY_LIKE_PATTERNS) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(content)) !== null) {
      leaks.push(match[0]);
    }
  }
  return leaks;
}

const candidates = walkFiles(PROJECT_ROOT);
const findings = [];
for (const filePath of candidates) {
  const leaks = findLeaks(filePath);
  if (leaks.length > 0) {
    findings.push({
      file: relative(PROJECT_ROOT, filePath),
      matches: leaks
    });
  }
}

if (findings.length > 0) {
  console.error("[check-secrets] API-key-like strings detected:");
  for (const finding of findings) {
    console.error(`- ${finding.file}`);
    for (const match of finding.matches) {
      console.error(`  value=${match}`);
    }
  }
  process.exit(1);
}

console.log("[check-secrets] passed");
