import { Command } from "commander";
import { initCommand } from "./commands/init.js";
import { pushCommand } from "./commands/push.js";
import { pullCommand } from "./commands/pull.js";

const program = new Command();

program
  .name("i1n")
  .description("Localization as code")
  .version("0.1.0");

program.addCommand(initCommand);
program.addCommand(pushCommand);
program.addCommand(pullCommand);

program.parse();
