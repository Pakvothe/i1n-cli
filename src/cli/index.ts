import { Command } from "commander";
import { initCommand } from "./commands/init.js";
import { pushCommand } from "./commands/push.js";
import { pullCommand } from "./commands/pull.js";
import { setupAiCommand } from "./commands/setup-ai.js";
import { addLanguageCommand } from "./commands/add-language.js";
import { projectLimitsCommand } from "./commands/project-limits.js";

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgPath = fs.existsSync(path.join(__dirname, "../../package.json"))
  ? path.join(__dirname, "../../package.json")
  : path.join(__dirname, "../package.json");

const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));

const program = new Command();

program.name(pkg.name).description(pkg.description).version(pkg.version);

program.addCommand(initCommand);
program.addCommand(pushCommand);
program.addCommand(pullCommand);
program.addCommand(setupAiCommand);
program.addCommand(addLanguageCommand);
program.addCommand(projectLimitsCommand);

program.parse();
