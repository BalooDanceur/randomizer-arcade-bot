import { exportHistoryToMarkdown } from "./exporter.js";
import type { ActiveListManager } from "./list-manager.js";
import { generateTeam } from "./randomizer.js";
import { JsonStorage, normalizePlayerId } from "./storage.js";
import type { TournamentState } from "./types.js";

export type CommandContext = {
  storage: JsonStorage;
  listManager: ActiveListManager;
  admins: string[];
  teamSize: number;
  sameName: boolean;
};

export type CommandOptions = {
  isPrivateMessage?: boolean;
};

export async function handleCommand(
  rawMessage: string,
  player: string,
  context: CommandContext,
  options: CommandOptions = {}
): Promise<string> {
  const trimmed = rawMessage.trim();

  if (!trimmed.startsWith("$")) {
    return "";
  }

  const [commandName = "", ...args] = trimmed.slice(1).split(/\s+/);
  const command = commandName.toLowerCase();
  const isPrivateMessage = options.isPrivateMessage ?? true;

  try {
    switch (command) {
      case "team":
        return handleTeamCommand(player, context);

      case "round":
        return handleRoundCommand(context);

      case "help":
        return handleHelpCommand(context);

      case "start":
        return requireAdmin(player, context, () => handleStartCommand(context));

      case "end":
        return requireAdmin(player, context, () => handleEndCommand(context));

      case "new":
        return requireAdmin(player, context, () => handleNewCommand(context));

      case "export":
        return requireAdmin(player, context, () => handleExportCommand(context));

      case "status":
        return requireAdmin(player, context, () => handleStatusCommand(context));

      case "next":
        return requireAdmin(player, context, () => handleNextCommand(context));

      case "reset":
        return requireAdmin(player, context, () =>
          handleResetCommand(args, context)
        );

      case "history":
        return requireAdmin(player, context, () =>
          handleHistoryCommand(args, context)
        );

      case "setlist":
        return requireAdmin(player, context, () =>
          handleSetListCommand(args, context, isPrivateMessage)
        );

      case "currentlist":
        return requireAdmin(player, context, () =>
          handleCurrentListCommand(context)
        );

      case "advance":
        return requireAdmin(player, context, () =>
          handleAdvanceCommand(args, context)
        );

      default:
        return `Commande inconnue : $${command}. Utilise $help.`;
    }
  } catch (error) {
    if (error instanceof Error) {
      return `Erreur : ${error.message}`;
    }

    return "Erreur inconnue.";
  }
}

function handleTeamCommand(player: string, context: CommandContext): string {
  const state = context.storage.load();

  if (!state.isStarted) {
    return "Le tournoi n'a pas encore commencé. Attends qu'un admin lance le round 1 avec $start.";
  }

  const team = context.storage.getOrCreateTeam(player, () =>
    generateTeam(context.listManager.getSets(), {
      teamSize: context.teamSize,
      sameName: context.sameName,
      player,
      round: state.activeRound,
    })
  );

  return [
    `Voici ta team pour le round ${team.round} :`,
    "",
    team.rawTeam,
  ].join("\n");
}

function handleRoundCommand(context: CommandContext): string {
  const state = context.storage.load();

  if (!state.isStarted) {
    return "Le tournoi n'a pas encore commencé.";
  }

  return `Round actif : ${state.activeRound}`;
}

function handleHelpCommand(context: CommandContext): string {
  const state = context.storage.load();

  return [
    "Commandes Randomizer Arcade :",
    "",
    "$team : recevoir ou revoir ta team pour le round actif.",
    "$round : afficher le round actif.",
    "$help : afficher cette aide.",
    "",
    "Commandes admin :",
    "$start : lancer le tournoi au round 1.",
    "$end : terminer le tournoi actuel sans supprimer l'historique.",
    "$new : créer un nouveau tournoi vide et supprimer l'état courant.",
    "$export : exporter l'historique complet en Markdown.",
    "$status : afficher l'état du tournoi.",
    "$next : passer au round suivant.",
    "$reset Pseudo : reset la team d'un joueur pour le round actif.",
    "$history Pseudo : afficher l'historique d'un joueur.",
    "$setlist https://pokepast.es/xxxxxxxxxxxxxxxx : changer la liste active hors tournoi.",
    "$currentlist : afficher la liste active.",
    "$advance Pseudo : générer manuellement une nouvelle team pour un joueur sur le round actif.",
    "",
    `Tournoi commencé : ${state.isStarted ? "oui" : "non"}`,
    `Round actif actuel : ${state.isStarted ? state.activeRound : "aucun"}`,
    `Taille des teams : ${context.teamSize}`,
    `Same name : ${context.sameName ? "on" : "off"}`,
  ].join("\n");
}

function handleStartCommand(context: CommandContext): string {
  const before = context.storage.load();

  if (before.isStarted) {
    return `Le tournoi a déjà commencé. Round actif : ${before.activeRound}`;
  }

  const after = context.storage.startTournament();

  return `Tournoi lancé. Round actif : ${after.activeRound}`;
}

function handleEndCommand(context: CommandContext): string {
  const before = context.storage.load();

  if (!before.isStarted) {
    return "Aucun tournoi n'est actuellement en cours.";
  }

  const after = context.storage.endTournament();

  return [
    "Tournoi terminé.",
    `Dernier round joué : ${after.activeRound}`,
    "L'historique est conservé. Les joueurs ne peuvent plus demander de team tant qu'un admin ne relance pas avec $start.",
  ].join("\n");
}

function handleNewCommand(context: CommandContext): string {
  context.storage.newTournament();

  return [
    "Nouveau tournoi préparé.",
    "État actuel : tournoi non commencé, round actif : aucun.",
    "L'ancien historique a été supprimé de data/state.json.",
    "Utilise $start pour lancer le round 1.",
  ].join("\n");
}

function handleExportCommand(context: CommandContext): string {
  const state = context.storage.load();
  const result = exportHistoryToMarkdown(state);

  return [
    "Historique exporté.",
    `Fichier : ${result.filePath}`,
    `Rounds exportés : ${result.roundsCount}`,
    `Teams exportées : ${result.teamsCount}`,
  ].join("\n");
}

function handleStatusCommand(context: CommandContext): string {
  const state = context.storage.load();
  const roundKey = String(state.activeRound);
  const teamsThisRound = state.teamsByRound[roundKey] ?? {};
  const totalTeamsThisRound = state.isStarted
    ? Object.keys(teamsThisRound).length
    : 0;
  const totalTeamsAllRounds = countAllTeams(state);
  const listInfo = context.listManager.getInfo();

  return [
    "État du tournoi :",
    "",
    `Tournoi commencé : ${state.isStarted ? "oui" : "non"}`,
    `Round actif : ${state.isStarted ? state.activeRound : "aucun"}`,
    `Dernier round enregistré : ${state.activeRound > 0 ? state.activeRound : "aucun"}`,
    `Teams générées ce round : ${totalTeamsThisRound}`,
    `Teams générées au total : ${totalTeamsAllRounds}`,
    `Sets disponibles : ${context.listManager.getSets().length}`,
    `Source liste : ${formatListSource(listInfo)}`,
    `Taille des teams : ${context.teamSize}`,
    `Same name : ${context.sameName ? "on" : "off"}`,
  ].join("\n");
}

function handleNextCommand(context: CommandContext): string {
  const before = context.storage.load();

  if (!before.isStarted) {
    return "Impossible de passer au round suivant : le tournoi n'a pas encore commencé. Utilise d'abord $start.";
  }

  const after = context.storage.nextRound();
  return `Round suivant lancé. Round actif : ${after.activeRound}`;
}

function handleResetCommand(args: string[], context: CommandContext): string {
  const state = context.storage.load();

  if (!state.isStarted) {
    return "Impossible de reset une team : le tournoi n'a pas encore commencé.";
  }

  const player = args.join(" ").trim();

  if (!player) {
    return "Utilisation : $reset Pseudo";
  }

  const didReset = context.storage.resetPlayerForActiveRound(player);

  if (!didReset) {
    return `Aucune team trouvée pour ${player} sur le round actif.`;
  }

  return `Team reset pour ${player} sur le round actif.`;
}

function handleHistoryCommand(args: string[], context: CommandContext): string {
  const player = args.join(" ").trim();

  if (!player) {
    return "Utilisation : $history Pseudo";
  }

  const history = context.storage.getPlayerHistory(player);

  if (history.length === 0) {
    return `Aucun historique trouvé pour ${player}.`;
  }

  return history
    .map(team =>
      [
        `Historique de ${player} — round ${team.round} :`,
        "",
        team.rawTeam,
      ].join("\n")
    )
    .join("\n\n---\n\n");
}

async function handleSetListCommand(
  args: string[],
  context: CommandContext,
  isPrivateMessage: boolean
): Promise<string> {
  if (!isPrivateMessage) {
    return "Commande refusée : $setlist doit être utilisée en MP avec le bot.";
  }

  const state = context.storage.load();

  if (state.isStarted) {
    return [
      "Commande refusée : un tournoi est en cours.",
      "Termine d'abord le tournoi avec $end, ou prépare un nouveau tournoi avec $new avant de changer la liste.",
    ].join("\n");
  }

  const url = args[0];

  if (!url) {
    return "Utilisation : $setlist https://pokepast.es/xxxxxxxxxxxxxxxx";
  }

  const info = await context.listManager.setFromPokepaste(url, {
    teamSize: context.teamSize,
    sameName: context.sameName,
  });

  return [
    "Liste active mise à jour.",
    `Source : ${formatListSource(info)}`,
    `Sets détectés : ${info.setCount}`,
    `Pokémon différents détectés : ${info.uniquePokemonCount}`,
    `Sauvegarde : data/current-list.json`,
  ].join("\n");
}

function handleCurrentListCommand(context: CommandContext): string {
  const info = context.listManager.getInfo();

  return [
    "Liste active :",
    `Source : ${formatListSource(info)}`,
    `Sets détectés : ${info.setCount}`,
    `Pokémon différents détectés : ${info.uniquePokemonCount}`,
    `Dernière mise à jour : ${info.updatedAt}`,
  ].join("\n");
}

function handleAdvanceCommand(args: string[], context: CommandContext): string {
  const state = context.storage.load();

  if (!state.isStarted) {
    return "Impossible d'avancer un joueur : le tournoi n'a pas encore commencé.";
  }

  const player = args.join(" ").trim();

  if (!player) {
    return "Utilisation : $advance Pseudo";
  }

  context.storage.resetPlayerForActiveRound(player);

  const team = context.storage.getOrCreateTeam(player, () =>
    generateTeam(context.listManager.getSets(), {
      teamSize: context.teamSize,
      sameName: context.sameName,
      player,
      round: state.activeRound,
    })
  );

  return [
    `Avancée manuelle enregistrée pour ${player}.`,
    `Nouvelle team générée pour le round ${team.round} :`,
    "",
    team.rawTeam,
  ].join("\n");
}

function requireAdmin<T>(
  player: string,
  context: CommandContext,
  action: () => T
): T | string {
  const normalizedPlayer = normalizePlayerId(player);
  const normalizedAdmins = context.admins.map(normalizePlayerId);

  if (!normalizedAdmins.includes(normalizedPlayer)) {
    return "Commande réservée aux admins.";
  }

  return action();
}

function countAllTeams(state: TournamentState): number {
  return Object.values(state.teamsByRound).reduce(
    (total, roundTeams) => total + Object.keys(roundTeams).length,
    0
  );
}

function formatListSource(info: {
  source: string;
  sourceUrl?: string;
}): string {
  if (info.sourceUrl) {
    return `${info.source} (${info.sourceUrl})`;
  }

  return info.source;
}
