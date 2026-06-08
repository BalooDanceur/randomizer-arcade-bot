import { loadConfig } from "./config.js";
import { runConsoleBot } from "./console-runner.js";
import { ActiveListManager } from "./list-manager.js";
import { JsonStorage } from "./storage.js";

const config = loadConfig();

const fallbackSetsPath = "sets/sample-sets.txt";
const currentListPath = "data/current-list.json";
const statePath = "data/state.json";

const listManager = new ActiveListManager(currentListPath, fallbackSetsPath);
const storage = new JsonStorage(statePath);

const context = {
  storage,
  listManager,
  admins: config.adminUsers,
  teamSize: config.teamSize,
  sameName: config.sameName,
};

const listInfo = listManager.getInfo();

console.log(`Bot configuré : ${config.psUsername}`);
console.log(`Préfixe : ${config.prefix}`);
console.log(`Admins : ${config.adminUsers.join(", ") || "aucun"}`);
console.log(`Sets chargés : ${listManager.getSets().length}`);
console.log(`Source liste : ${listInfo.sourceUrl ?? listInfo.source}`);
console.log("");

await runConsoleBot(context);
