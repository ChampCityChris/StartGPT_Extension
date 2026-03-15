const childProcess = require("node:child_process");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const originalExec = childProcess.exec;
const projectRoot = path.resolve(__dirname, "..");

process.chdir(projectRoot);

childProcess.exec = function patchedExec(command, options, callback) {
  const normalizedCallback = typeof options === "function" ? options : callback;

  if (typeof command === "string" && command.trim().toLowerCase() === "net use") {
    if (typeof normalizedCallback === "function") {
      queueMicrotask(() => normalizedCallback(new Error("sandboxed exec disabled"), "", ""));
    }

    return {
      on() {
        return this;
      },
      once() {
        return this;
      },
      kill() {
        return true;
      }
    };
  }

  return originalExec.apply(this, arguments);
};

const vitestCliPath = path.resolve(projectRoot, "node_modules", "vitest", "vitest.mjs");
const forwardedArgs = process.argv.slice(2);

if (!forwardedArgs.includes("--pool=threads")) {
  forwardedArgs.unshift("--pool=threads");
}

process.argv = ["node", "vitest", ...forwardedArgs];

import(pathToFileURL(vitestCliPath).href);
