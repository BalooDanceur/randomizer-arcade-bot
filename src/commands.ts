import { exportHistoryToMarkdown } from "./exporter.js";
import type { ActiveListManager } from "./list-manager.js";
import { createTeamPaste } from "./pokepaste.js";
import { generateTeam } from "./randomizer.js";
import { JsonStorage, normalizePlayerId } from "./storage.js";
import type { GeneratedTeam, TournamentState } from "./types.js";

export type CommandContext = {
  storage: JsonStorage;
  listManager: ActiveListManager;
  admins: string[];
  teamSize: number;
  sameName: boolean;
  sendPrivateTeam?: (player: string, response: string) => void;
  autoCommand?: (action: string) => string;
  watchBattle?: (target: string) => string;
  unwatchBattle?: (target: string) => string;
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
    if (context.storage.load().permanentAuto?.enabled && ["start", "next"].includes(command)) {
      return await requireAdmin(player, context, () => "Mode permanent activé : utilise $auto permanent off avant de démarrer un tournoi manuel.");
    }
    if (context.storage.load().automation?.enabled && ["start", "next", "end", "new", "setlist"].includes(command)) {
      return await requireAdmin(player, context, () => "Commande bloquée pendant le mode automatique. Utilise $auto off pour le désactiver ; $next reste réservé au mode manuel.");
    }
    if (command === "next" && context.storage.load().automation && context.storage.load().automation?.phase !== 'ended') {
      return await requireAdmin(player, context, () => "Progression individuelle : $next n’est pas utilisable dans cette session automatique. Termine la session puis utilise $new pour revenir au mode manuel.");
    }
    switch (command) {
      case "auto":
        return await requireAdmin(player, context, () => {
          if (!isPrivateMessage) return "$auto doit être utilisée en MP avec le bot.";
          if (!context.autoCommand) return "Mode automatique disponible uniquement sur Showdown.";
          if (args[0]?.toLowerCase() === "permanent") {
            if (args.length !== 2 || !["on", "off"].includes(args[1]!.toLowerCase())) return "Utilisation : $auto permanent on|off";
            return context.autoCommand(`permanent ${args[1]!.toLowerCase()}`);
          }
          if (args.length > 1) return "Utilisation : $auto on|off|resume|status ou $auto permanent on|off";
          return context.autoCommand(args[0] ?? "status");
        });
      case "watch":
      case "unwatch":
        return await requireAdmin(player, context, () => {
          if (!args[0] || args.length !== 1) return `Utilisation : $${command} LIEN_DU_COMBAT`;
          const action = command === "watch" ? context.watchBattle : context.unwatchBattle;
          if (!action) return "Surveillance disponible uniquement en mode Showdown.";
          return action(args[0]);
        });

      case "resend":
        return await requireAdmin(player, context, async () => {
          if (!isPrivateMessage) return "$resend doit être utilisée en MP avec le bot.";
          const target = args.join(" ").trim(), id = normalizePlayerId(target);
          if (!id || target.length > 100 || /[,|\r\n]/.test(target)) return "Utilisation : $resend Pseudo";
          if (!context.sendPrivateTeam) return "Renvoi privé disponible uniquement sur Showdown.";
          const state = context.storage.load();
          if (!state.isStarted) return "Aucun tournoi en cours.";
          const round = context.storage.getRoundForPlayer(target);
          const team = state.teamsByRound[String(round)]?.[id];
          if (!team) return `Aucune équipe attribuée à ${target} pour le round ${round}. Aucun nouveau tirage effectué.`;
          const response = await formatTeam(team, context);
          // Formatting can involve a network request: don't send a stale draw.
          const latest = context.storage.load();
          if (!latest.isStarted || latest.automation?.id !== state.automation?.id || context.storage.getRoundForPlayer(target) !== round ||
              latest.teamsByRound[String(round)]?.[id]?.createdAt !== team.createdAt ||
              latest.teamsByRound[String(round)]?.[id]?.rawTeam !== team.rawTeam) {
            return "Renvoi annulé : la session ou l’équipe a changé. Réessaie $resend.";
          }
          context.sendPrivateTeam(id, `Voici ta team pour le round ${round} :\n${response}`);
          return `Renvoi de l’équipe du round ${round} à ${target} mis en file d’envoi en MP.`;
        });

      case "team":
        return await handleTeamCommand(player, context);

      case "round":
        return handleRoundCommand(player, context);

      case "help":
        return handleHelpCommand(player, context);

      case "start":
        return await requireAdmin(player, context, () => handleStartCommand(context));

      case "end":
        return await requireAdmin(player, context, () => handleEndCommand(context));

      case "new":
        return await requireAdmin(player, context, () => handleNewCommand(context));

      case "export":
        return await requireAdmin(player, context, () => handleExportCommand(context));

      case "status":
        return await requireAdmin(player, context, () => handleStatusCommand(context));

      case "next":
        return await requireAdmin(player, context, () => handleNextCommand(context));

      case "reset":
        return await requireAdmin(player, context, () =>
          handleResetCommand(args, context)
        );

      case "history":
        return await requireAdmin(player, context, () =>
          handleHistoryCommand(args, context)
        );

      case "setlist":
        return await requireAdmin(player, context, () =>
          handleSetListCommand(args, context, isPrivateMessage)
        );

      case "currentlist":
        return await requireAdmin(player, context, () =>
          handleCurrentListCommand(context)
        );

      case "advance":
        return await requireAdmin(player, context, () =>
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

async function handleTeamCommand(player: string, context: CommandContext): Promise<string> {
  const state = context.storage.load();

  if (!state.isStarted) {
    return "Le tournoi n'a pas encore commencé. Attends qu'un admin lance le round 1 avec $start.";
  }

  const team = context.storage.getOrCreateTeam(player, () =>
    generateTeam(context.listManager.getSets(), {
      teamSize: context.teamSize,
      sameName: context.sameName,
      player,
      round: context.storage.getRoundForPlayer(player),
    })
  );

  return [
    `Voici ta team pour le round ${team.round} :`,
    "",
    await formatTeam(team, context),
  ].join("\n");
}

function handleRoundCommand(player: string, context: CommandContext): string {
  const state = context.storage.load();

  if (!state.isStarted) {
    return "Le tournoi n'a pas encore commencé.";
  }

  return `Round actif : ${context.storage.getRoundForPlayer(player)}`;
}

function handleHelpCommand(player: string, context: CommandContext): string {
  const state = context.storage.load();
  const normalizedPlayer = normalizePlayerId(player);
  const normalizedAdmins = context.admins.map(normalizePlayerId);
  const isAdmin = normalizedAdmins.includes(normalizedPlayer);

  const playerHelp = [
    "Randomizer Arcade commands:",
    "",
    "Player commands:",
    "$team : receive or review your team for the active round.",
    "$round : show the active round.",
    "$help : show this help message.",
  ];

  const adminHelp = [
    "",
    "Admin commands:",
    "$auto permanent on|off : enable or disable automatic arming for subsequent Single Elimination tournaments named exactly RandArcade in this room.",
    "$auto on|off|resume|status : arm, pause or inspect automatic Single Elimination tournament tracking (PM only).",
    "$watch LIEN_DU_COMBAT : monitor visible Pokémon and moves using teams assigned in the active round.",
    "$unwatch LIEN_DU_COMBAT : stop monitoring a battle.",
    "$setlist https://pokepast.es/xxxxxxxxxxxxxxxx : set the active list from a Poképaste, outside an active tournament.",
    "$currentlist : show the active list.",
    "$start : start a fresh tournament at round 1; use $new first if history exists.",
    "$next : move to the next round.",
    "$advance Pseudo : manually generate a new team for a player in the active round.",
    "$resend Pseudo : privately resend the assigned team directly to the player without showing it to the admin (PM only).",
    "$reset Pseudo : reset a player's team for the active round.",
    "$status : show the tournament status.",
    "$history Pseudo : show a player's history.",
    "$export : export the full history as Markdown.",
    "$end : end the current tournament without deleting history.",
    "$new : prepare a new empty tournament and delete the current state.",
  ];

  const statusInfo = [
    "",
    "Current settings:",
    `Tournament started: ${state.isStarted ? "yes" : "no"}`,
    `Active round: ${state.isStarted ? state.activeRound : "none"}`,
    `Team size: ${context.teamSize}`,
    `Same name: ${context.sameName ? "on" : "off"}`,
  ];

  return isAdmin
    ? [...playerHelp, ...adminHelp, ...statusInfo].join("\n")
    : playerHelp.join("\n");
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
    "L'historique est conservé. Utilise $export pour le sauvegarder, puis $new et $start pour lancer un nouveau tournoi.",
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
    ...(state.automation ? [`Mode automatique : ${state.automation.enabled ? "actif" : "inactif"} (${state.automation.phase})`, "Rounds individuels : utilise $round en MP pour connaître ton tirage."] : []),
    "",
    `Tournoi commencé : ${state.isStarted ? "oui" : "non"}`,
    `${state.automation ? "Dernier round préparé" : "Round actif"} : ${state.isStarted ? state.activeRound : "aucun"}`,
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

async function handleAdvanceCommand(args: string[], context: CommandContext): Promise<string> {
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
      round: context.storage.getRoundForPlayer(player),
    })
  );

  return [
    `Avancée manuelle enregistrée pour ${player}.`,
    `Nouvelle team générée pour le round ${team.round} :`,
    "",
    await formatTeam(team, context),
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

export async function formatTeam(team: GeneratedTeam, context: CommandContext): Promise<string> {
  if (team.pasteUrl) return `${team.pasteUrl}\n!code ${team.rawTeam}`;
  try {
    const url = await createTeamPaste(team.rawTeam, team.round);
    context.storage.saveTeamPaste(team.player, team.round, team.rawTeam, url);
    return `${url}\n!code ${team.rawTeam}`;
  } catch {
    return ["Poképaste indisponible : voici l’équipe en texte.", "", `!code ${team.rawTeam}`].join("\n");
  }
}
