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
};

export type TournamentState = {
  isStarted: boolean;
  activeRound: number;
  teamsByRound: Record<string, Record<string, GeneratedTeam>>;
};