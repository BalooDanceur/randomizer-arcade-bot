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
    const freshState = structuredClone(DEFAULT_STATE);
    this.save(freshState);
    return freshState;
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

    const roundKey = String(state.activeRound);

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

    const roundKey = String(state.activeRound);

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