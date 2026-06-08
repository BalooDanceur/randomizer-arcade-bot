import fs from "node:fs";
import { loadConfig } from "./config.js";
import { runConsoleBot } from "./console-runner.js";
import { parseShowdownSets } from "./parser.js";
import { JsonStorage } from "./storage.js";

const config = loadConfig();

const setsPath = "sets/sample-sets.txt";
const statePath = "data/state.json";

const rawSets = fs.readFileSync(setsPath, "utf8");
const sets = parseShowdownSets(rawSets);

const storage = new JsonStorage(statePath);

const context = {
  storage,
  sets,
  admins: config.adminUsers,
  teamSize: config.teamSize,
  sameName: config.sameName,
};

console.log(`Bot configuré : ${config.psUsername}`);
console.log(`Préfixe : ${config.prefix}`);
console.log(`Admins : ${config.adminUsers.join(", ") || "aucun"}`);
console.log(`Sets chargés : ${sets.length}`);
console.log("");

await runConsoleBot(context);