const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");

process.chdir(projectRoot);
process.env.PLAYWRIGHT_BROWSERS_PATH = path.resolve(projectRoot, ".playwright-browsers");

const forwardedArgs = process.argv.slice(2);

process.argv = ["node", "playwright", ...forwardedArgs];

require(path.resolve(projectRoot, "node_modules", "playwright", "cli.js"));
