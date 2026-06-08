import fs from "node:fs";
import path from "node:path";
import type { TournamentState } from "./types.js";

export type ExportHistoryResult = {
  filePath: string;
  roundsCount: number;
  teamsCount: number;
};

export function exportHistoryToMarkdown(
  state: TournamentState,
  outputDir = "exports"
): ExportHistoryResult {
  fs.mkdirSync(outputDir, { recursive: true });

  const now = new Date();
  const timestamp = toSafeTimestamp(now);
  const filePath = path.join(outputDir, `randomizer-history-${timestamp}.md`);

  const rounds = Object.entries(state.teamsByRound).sort(
    ([roundA], [roundB]) => Number(roundA) - Number(roundB)
  );

  const teamsCount = rounds.reduce(
    (total, [, roundTeams]) => total + Object.keys(roundTeams).length,
    0
  );

  const lines: string[] = [];

  lines.push("# Historique Randomizer Arcade");
  lines.push("");
  lines.push(`Export généré le : ${now.toISOString()}`);
  lines.push(`Tournoi commencé actuellement : ${state.isStarted ? "oui" : "non"}`);
  lines.push(`Round actif / dernier round : ${state.activeRound > 0 ? state.activeRound : "aucun"}`);
  lines.push(`Nombre de rounds exportés : ${rounds.length}`);
  lines.push(`Nombre total de teams : ${teamsCount}`);
  lines.push("");

  if (rounds.length === 0) {
    lines.push("_Aucune team enregistrée._");
    lines.push("");
  }

  for (const [round, roundTeams] of rounds) {
    const players = Object.entries(roundTeams).sort(([playerA], [playerB]) =>
      playerA.localeCompare(playerB)
    );

    lines.push(`## Round ${round}`);
    lines.push("");

    if (players.length === 0) {
      lines.push("_Aucune team pour ce round._");
      lines.push("");
      continue;
    }

    for (const [playerId, team] of players) {
      lines.push(`### ${team.player || playerId}`);
      lines.push("");
      lines.push(`Créée le : ${team.createdAt}`);
      lines.push("");
      lines.push("```txt");
      lines.push(team.rawTeam);
      lines.push("```");
      lines.push("");
    }
  }

  fs.writeFileSync(filePath, lines.join("\n"), "utf8");

  return {
    filePath,
    roundsCount: rounds.length,
    teamsCount,
  };
}

function toSafeTimestamp(date: Date): string {
  return date
    .toISOString()
    .replace(/[:.]/g, "-")
    .replace("T", "_")
    .replace("Z", "");
}