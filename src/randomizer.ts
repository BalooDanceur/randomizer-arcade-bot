import { randomInt } from "node:crypto";
import type { GeneratedTeam, PokemonSetBlock } from "./types.js";

export type GenerateTeamOptions = {
  teamSize: number;
  sameName: boolean;
  player: string;
  round: number;
};

export function generateTeam(
  sets: PokemonSetBlock[],
  options: GenerateTeamOptions
): GeneratedTeam {
  const { teamSize, sameName, player, round } = options;

  if (teamSize <= 0) {
    throw new Error("La taille de team doit être supérieure à 0.");
  }

  if (sets.length < teamSize) {
    throw new Error(
      `Pas assez de sets : ${sets.length} disponibles pour une team de ${teamSize}.`
    );
  }

  const pool = shuffleArray([...sets]);
  const selected: PokemonSetBlock[] = [];
  const usedPokemonNames = new Set<string>();

  for (const set of pool) {
    if (!sameName && usedPokemonNames.has(set.pokemonName)) {
      continue;
    }

    selected.push(set);
    usedPokemonNames.add(set.pokemonName);

    if (selected.length === teamSize) {
      break;
    }
  }

  if (selected.length < teamSize) {
    throw new Error(
      `Impossible de générer une team de ${teamSize} sans doublon de nom. ` +
      `Active same name on ou ajoute plus de Pokémon différents.`
    );
  }

  return {
    player,
    round,
    sets: selected,
    rawTeam: selected.map(set => set.raw).join("\n\n"),
    createdAt: new Date().toISOString(),
  };
}

function shuffleArray<T>(array: T[]): T[] {
  for (let i = array.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);

    const current = array[i];
    const replacement = array[j];

    if (current === undefined || replacement === undefined) {
      throw new Error("Erreur interne pendant le mélange des sets.");
    }

    array[i] = replacement;
    array[j] = current;
  }

  return array;
}
