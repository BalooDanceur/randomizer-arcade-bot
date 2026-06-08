import type { PokemonSetBlock } from "./types.js";

export function parseShowdownSets(input: string): PokemonSetBlock[] {
  const normalized = input.replace(/\r\n/g, "\n").trim();

  if (!normalized) {
    return [];
  }

  const blocks = normalized
    .split(/\n\s*\n/g)
    .map(block => block.trim())
    .filter(Boolean);

  return blocks.map(raw => {
    const firstLine = raw.split("\n")[0];

    if (!firstLine) {
      throw new Error(`Set invalide : bloc sans première ligne.\n\n${raw}`);
    }

    return {
      raw,
      pokemonName: extractPokemonName(firstLine),
    };
  });
}

export function extractPokemonName(firstLine: string): string {
  const beforeItem = firstLine.split("@")[0] ?? "";
  const cleanBeforeItem = beforeItem.trim();

  const nicknameSpeciesMatch = cleanBeforeItem.match(/\(([^()]+)\)\s*$/);

  if (nicknameSpeciesMatch?.[1]) {
    return normalizePokemonName(nicknameSpeciesMatch[1]);
  }

  return normalizePokemonName(cleanBeforeItem);
}

export function normalizePokemonName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}
