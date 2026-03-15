import { mkdir } from "node:fs/promises";

await mkdir("dist", { recursive: true });
console.log("Build scaffold ready. Packaging will be added later.");
