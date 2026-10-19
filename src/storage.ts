import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { GeneratedTeam, TournamentState } from "./types.js";

const DEFAULT_STATE: TournamentState = {
  isStarted: false,
  activeRound: 0,
  teamsByRound: {},
};

export class JsonStorage {
  constructor(private readonly filePath: string) {}

  load(): TournamentState {
    if (!fs.existsSync(this.filePath)) {
      return structuredClone(DEFAULT_STATE);
    }

    const raw = fs.readFileSync(this.filePath, "utf8").trim();

    if (!raw) {
      return structuredClone(DEFAULT_STATE);
    }

    const parsed = JSON.parse(raw) as Partial<TournamentState>;

    return {
      // Compatibilité avec les anciens state.json créés avant l'ajout de isStarted.
      isStarted: parsed.isStarted ?? true,
      activeRound: parsed.activeRound ?? 1,
      teamsByRound: parsed.teamsByRound ?? {},
      ...(parsed.permanentAuto ? {permanentAuto: parsed.permanentAuto} : {}),
      ...(parsed.automation ? {automation: parsed.automation} : {}),
    };
  }

  save(state: TournamentState): void {
    const dir = path.dirname(this.filePath);
    fs.mkdirSync(dir, { recursive: true });

    fs.writeFileSync(this.filePath, JSON.stringify(state, null, 2), "utf8");
  }

  startTournament(): TournamentState {
    const state = this.load();

    if (state.isStarted) {
      return state;
    }

    if (state.activeRound > 0 || Object.keys(state.teamsByRound).length > 0) {
      throw new Error(
        "Démarrage refusé : un ancien historique existe. " +
        "Utilise $export si tu veux le sauvegarder, puis $new pour l'effacer et $start pour lancer un nouveau tournoi."
      );
    }

    state.isStarted = true;
    state.activeRound = 1;
    state.teamsByRound["1"] ??= {};

    this.save(state);
    return state;
  }

  endTournament(): TournamentState {
    const state = this.load();

    if (!state.isStarted) {
      return state;
    }

    state.isStarted = false;
    this.save(state);
    return state;
  }

  newTournament(): TournamentState {
    const previous = this.load();
    const freshState = structuredClone(DEFAULT_STATE);
    if (previous.permanentAuto) freshState.permanentAuto = previous.permanentAuto;
    this.save(freshState);
    return freshState;
  }

  archiveAndNewTournament(): string {
    const state = this.load();
    if (state.isStarted) throw new Error("Impossible d'archiver automatiquement une session active.");
    const directory = path.join(path.dirname(this.filePath), "archives");
    fs.mkdirSync(directory, {recursive:true});
    const archive = path.join(directory, `randomizer-state-${randomUUID()}.json`);
    // Keep the complete state, including substitutions and saved paste links.
    // A failed write must never clear the current tournament.
    fs.writeFileSync(archive, JSON.stringify(state, null, 2), {encoding:"utf8", flag:"wx"});
    this.newTournament();
    return archive;
  }

  getOrCreateTeam(
    player: string,
    createTeam: () => GeneratedTeam
  ): GeneratedTeam {
    const normalizedPlayer = normalizePlayerId(player);
    const state = this.load();

    if (!state.isStarted) {
      throw new Error("Le tournoi n'a pas encore commencé.");
    }

    const roundKey = String(this.getRoundForPlayer(player));

    state.teamsByRound[roundKey] ??= {};

    const existing = state.teamsByRound[roundKey][normalizedPlayer];

    if (existing) {
      return existing;
    }

    const team = createTeam();
    state.teamsByRound[roundKey][normalizedPlayer] = team;
    this.save(state);

    return team;
  }

  getRoundForPlayer(player: string): number {
    const state = this.load();
    if (state.automation && ['running', 'paused'].includes(state.automation.phase)) {
      const round = state.automation.playerRounds[normalizePlayerId(player)];
      if (!round || !state.automation.readyPlayers?.[normalizePlayerId(player)]) throw new Error("Aucun match prêt ni équipe attribuée à ce joueur dans le tournoi automatique.");
      return round;
    }
    return state.activeRound;
  }

  snapshotForWatch(): TournamentState {
    const state = this.load();
    if (state.automation && ['running', 'paused'].includes(state.automation.phase)) {
      const teams: Record<string, GeneratedTeam> = {};
      for (const [id,round] of Object.entries(state.automation.playerRounds)) {
        const team = state.teamsByRound[String(round)]?.[id];
        if (team) teams[id] = team;
      }
      return {...state, teamsByRound:{[state.activeRound]:teams}};
    }
    return state;
  }

  saveTeamPaste(player: string, round: number, rawTeam: string, pasteUrl: string): void {
    const state = this.load();
    const team = state.teamsByRound[String(round)]?.[normalizePlayerId(player)];
    // Never attach a delayed response to a reset or replacement team.
    if (!team || team.rawTeam !== rawTeam) return;
    team.pasteUrl = pasteUrl;
    this.save(state);
  }

  nextRound(): TournamentState {
    const state = this.load();

    if (!state.isStarted) {
      return state;
    }

    state.activeRound += 1;
    state.teamsByRound[String(state.activeRound)] ??= {};
    this.save(state);
    return state;
  }

  resetPlayerForActiveRound(player: string): boolean {
    const normalizedPlayer = normalizePlayerId(player);
    const state = this.load();

    if (!state.isStarted) {
      return false;
    }

    const roundKey = String(this.getRoundForPlayer(player));

    if (!state.teamsByRound[roundKey]?.[normalizedPlayer]) {
      return false;
    }

    delete state.teamsByRound[roundKey][normalizedPlayer];
    this.save(state);
    return true;
  }

  getPlayerHistory(player: string): GeneratedTeam[] {
    const normalizedPlayer = normalizePlayerId(player);
    const state = this.load();

    return Object.values(state.teamsByRound)
      .map(roundTeams => roundTeams[normalizedPlayer])
      .filter((team): team is GeneratedTeam => Boolean(team));
  }
}

export function normalizePlayerId(player: string): string {
  return player.toLowerCase().replace(/[^a-z0-9]/g, "");
}