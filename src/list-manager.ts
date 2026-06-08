import fs from "node:fs";
import path from "node:path";
import { parseShowdownSets } from "./parser.js";
import type { PokemonSetBlock } from "./types.js";

export type ActiveListInfo = {
  source: string;
  sourceUrl?: string;
  setCount: number;
  uniquePokemonCount: number;
  updatedAt: string;
};

type SavedActiveList = ActiveListInfo & {
  rawText: string;
};

export class ActiveListManager {
  private sets: PokemonSetBlock[] = [];
  private info: ActiveListInfo = {
    source: "unloaded",
    setCount: 0,
    uniquePokemonCount: 0,
    updatedAt: new Date(0).toISOString(),
  };

  constructor(
    private readonly currentListPath: string,
    private readonly fallbackSetsPath: string
  ) {
    this.loadInitialList();
  }

  getSets(): PokemonSetBlock[] {
    return this.sets;
  }

  getInfo(): ActiveListInfo {
    return this.info;
  }

  async setFromPokepaste(url: string, options: {
    teamSize: number;
    sameName: boolean;
  }): Promise<ActiveListInfo> {
    const normalizedUrl = normalizePokepasteUrl(url);
    const rawText = await downloadPokepasteRaw(normalizedUrl);
    const sets = parseShowdownSets(rawText);

    validateSetList(sets, options);

    const info: ActiveListInfo = {
      source: "pokepaste",
      sourceUrl: normalizedUrl,
      setCount: sets.length,
      uniquePokemonCount: countUniquePokemon(sets),
      updatedAt: new Date().toISOString(),
    };

    this.sets = sets;
    this.info = info;
    this.save(rawText, info);

    return info;
  }

  private loadInitialList(): void {
    if (fs.existsSync(this.currentListPath)) {
      const raw = fs.readFileSync(this.currentListPath, "utf8").trim();

      if (raw) {
        const saved = JSON.parse(raw) as SavedActiveList;
        const sets = parseShowdownSets(saved.rawText);

        this.sets = sets;
        this.info = {
          source: saved.source,
          sourceUrl: saved.sourceUrl,
          setCount: sets.length,
          uniquePokemonCount: countUniquePokemon(sets),
          updatedAt: saved.updatedAt,
        };

        return;
      }
    }

    const rawText = fs.readFileSync(this.fallbackSetsPath, "utf8");
    const sets = parseShowdownSets(rawText);

    this.sets = sets;
    this.info = {
      source: "local",
      sourceUrl: this.fallbackSetsPath,
      setCount: sets.length,
      uniquePokemonCount: countUniquePokemon(sets),
      updatedAt: new Date().toISOString(),
    };
  }

  private save(rawText: string, info: ActiveListInfo): void {
    const dir = path.dirname(this.currentListPath);
    fs.mkdirSync(dir, { recursive: true });

    const saved: SavedActiveList = {
      ...info,
      rawText,
    };

    fs.writeFileSync(
      this.currentListPath,
      JSON.stringify(saved, null, 2),
      "utf8"
    );
  }
}

function normalizePokepasteUrl(input: string): string {
  let parsed: URL;

  try {
    parsed = new URL(input);
  } catch {
    throw new Error("Lien invalide. Utilisation : $setlist https://pokepast.es/xxxxxxxxxxxxxxxx");
  }

  const hostname = parsed.hostname.toLowerCase();

  if (hostname !== "pokepast.es" && hostname !== "www.pokepast.es") {
    throw new Error("Lien invalide : le lien doit venir de pokepast.es.");
  }

  const parts = parsed.pathname.split("/").filter(Boolean);
  const pasteId = parts[0];

  if (!pasteId || !/^[a-zA-Z0-9]+$/.test(pasteId)) {
    throw new Error("Lien Poképaste invalide : identifiant introuvable.");
  }

  return `https://pokepast.es/${pasteId}`;
}

async function downloadPokepasteRaw(normalizedUrl: string): Promise<string> {
  const response = await fetch(`${normalizedUrl}/raw`);

  if (!response.ok) {
    throw new Error(
      `Impossible de lire le Poképaste : erreur HTTP ${response.status}.`
    );
  }

  const rawText = await response.text();

  if (!rawText.trim()) {
    throw new Error("Le Poképaste est vide.");
  }

  return rawText;
}

function validateSetList(
  sets: PokemonSetBlock[],
  options: {
    teamSize: number;
    sameName: boolean;
  }
): void {
  if (sets.length < options.teamSize) {
    throw new Error(
      `Liste refusée : ${sets.length} sets détectés, mais TEAM_SIZE vaut ${options.teamSize}.`
    );
  }

  if (!options.sameName) {
    const uniquePokemonCount = countUniquePokemon(sets);

    if (uniquePokemonCount < options.teamSize) {
      throw new Error(
        `Liste refusée : ${uniquePokemonCount} Pokémon différents détectés, mais TEAM_SIZE vaut ${options.teamSize} et SAME_NAME=false.`
      );
    }
  }
}

function countUniquePokemon(sets: PokemonSetBlock[]): number {
  return new Set(sets.map(set => set.pokemonName)).size;
}
