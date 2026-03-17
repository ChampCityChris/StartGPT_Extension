import { mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";

execFileSync("node", ["scripts/check-secrets.mjs"], { stdio: "inherit" });
execFileSync("node", ["scripts/check-security-boundaries.mjs"], { stdio: "inherit" });

await mkdir("dist", { recursive: true });
console.log("Build checks passed. Packaging scaffold remains minimal.");
