import { existsSync } from "node:fs";

const FIREFOX_BINARY_CANDIDATES = [
  "C:\\Program Files\\Zen Browser\\zen.exe",
  "C:\\Program Files\\Mozilla Firefox\\firefox.exe",
  "C:\\Program Files (x86)\\Mozilla Firefox\\firefox.exe"
];

const detectedFirefoxBinary = FIREFOX_BINARY_CANDIDATES.find((candidate) => existsSync(candidate));

export default {
  sourceDir: "src",
  artifactsDir: "web-ext-artifacts",
  run: {
    ...(detectedFirefoxBinary ? { firefox: detectedFirefoxBinary } : {}),
    startUrl: ["https://www.startpage.com/"],
    browserConsole: true
  }
};
