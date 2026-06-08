import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import type { CommandContext } from "./commands.js";
import { handleCommand } from "./commands.js";

export async function runConsoleBot(context: CommandContext): Promise<void> {
  const rl = readline.createInterface({ input, output });

  console.log("Mode console Randomizer Arcade");
  console.log("");
  console.log("Format : Pseudo: $commande");
  console.log("Exemples :");
  console.log("JoueurA: $team");
  console.log("BalooDanceur: $status");
  console.log("BalooDanceur: $next");
  console.log("");
  console.log("Tape exit pour quitter.");
  console.log("");

  while (true) {
    const line = await rl.question("> ");
    const trimmed = line.trim();

    if (trimmed.toLowerCase() === "exit") {
      rl.close();
      return;
    }

    const separatorIndex = trimmed.indexOf(":");

    if (separatorIndex === -1) {
      console.log("Format invalide. Utilise : Pseudo: $commande");
      console.log("");
      continue;
    }

    const player = trimmed.slice(0, separatorIndex).trim();
    const message = trimmed.slice(separatorIndex + 1).trim();

    if (!player || !message) {
      console.log("Format invalide. Utilise : Pseudo: $commande");
      console.log("");
      continue;
    }

    const response = handleCommand(message, player, context);

    if (!response) {
      console.log("Aucune réponse.");
    } else {
      console.log(response);
    }

    console.log("");
  }
}