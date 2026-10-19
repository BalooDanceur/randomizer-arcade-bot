export type PokemonSetBlock = {
  raw: string;
  pokemonName: string;
};

export type GeneratedTeam = {
  player: string;
  round: number;
  sets: PokemonSetBlock[];
  rawTeam: string;
  createdAt: string;
  pasteUrl?: string;
};

export type AutomaticTournamentState = {
  id: string;
  enabled: boolean;
  phase: 'armed' | 'running' | 'paused' | 'ended';
  room: string;
  generator?: string;
  roster?: string;
  playerRounds: Record<string, number>;
  readyPlayers: Record<string, boolean>;
  delivered: Record<string, boolean>;
  matches: Record<string, { players: [string, string]; round: number }>;
  exportPath?: string;
  replacements?: Array<{ from: string; to: string; round?: number; at: string }>;
};

export type TournamentState = {
  isStarted: boolean;
  activeRound: number;
  teamsByRound: Record<string, Record<string, GeneratedTeam>>;
  automation?: AutomaticTournamentState;
  permanentAuto?: { enabled: boolean; room: string };
};