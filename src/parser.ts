import type { PokemonSetBlock } from "./types.js";

export function parseShowdownSets(input: string): PokemonSetBlock[] {
  const lines = input.replace(/\r\n?/g, "\n").split("\n");
  const sets: PokemonSetBlock[] = [];
  const isField = (line: string) => /^(?:Ability|Tera Type|EVs|IVs|Level|Shiny|Happiness|Gender|Pokeball|Gigantamax|Dynamax Level)\s*:/i.test(line)
    || /^[A-Za-z]+ Nature$/i.test(line)
    || /^-\s+\S/.test(line);
  const isHeader = (line: string) => Boolean(line)
    && !isField(line)
    && !/^(?:Cr[ée]ateur|Creator|Author|Lore)\s*:/i.test(line)
    && !/^[-=*_]{3,}/.test(line);

  // A set begins immediately before its export fields. Prose, headings,
  // separators and tables never become independent entries in the pool.
  for (let i = 0; i < lines.length; i++) {
    const header = lines[i]?.trim() ?? "";
    const next = lines[i + 1]?.trim() ?? "";
    if (!isHeader(header) || !isField(next) || /^-/.test(next)) continue;

    const setLines = [header];
    let j = i + 1;
    for (; j < lines.length; j++) {
      const line = lines[j]?.trim() ?? "";
      if (!isField(line)) break;
      setLines.push(line);
    }
    // Do not impose standard legality: Arcade sets can have six moves,
    // unusual abilities, and EV spreads that exceed standard limits.
    if (setLines.some(line => /^-\s+\S/.test(line))) {
      sets.push({ raw: setLines.join("\n"), pokemonName: extractPokemonName(header) });
    }
    i = j - 1;
  }
  return sets;
}

export function extractPokemonName(firstLine: string): string {
  const beforeItem = firstLine.split("@")[0] ?? "";
  const cleanBeforeItem = beforeItem.trim().replace(/\s+\([MF]\)$/i, "");

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
