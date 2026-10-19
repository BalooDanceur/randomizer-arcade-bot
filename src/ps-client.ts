import { TournamentAuto } from "./tournament-auto.js";
import { BattleWatcher } from "./battle-watcher.js";
import WebSocket from "ws";
import { handleCommand, formatTeam, type CommandContext } from "./commands.js";
import { normalizePlayerId } from "./storage.js";
import { parseIncomingCommands, responseDestination, buildOutgoingMessages } from "./ps-messages.js";

export type PsClientOptions = {
  serverUrl: string;
  username: string;
  password: string;
  room: string | null;
  context: CommandContext;
};

type LoginResponse = {
  actionsuccess?: boolean;
  assertion?: string;
  curuser?: {
    loggedin?: boolean;
    userid?: string;
    username?: string;
  };
};

export async function runPokemonShowdownClient(options: PsClientOptions): Promise<void> {
  console.log(`Connexion à Pokémon Showdown : ${options.serverUrl}`);

  const socket = new WebSocket(options.serverUrl);

  let loggedIn = false;
  let commands = Promise.resolve();
  const outgoing: string[] = [];
  const sender = setInterval(() => {
    if (socket.readyState === WebSocket.OPEN && outgoing.length) socket.send(outgoing.shift()!);
  }, 1000);

  function reply(destination: { room?: string; user?: string }, response: string, allowCode = false): void {
    outgoing.push(...buildOutgoingMessages(destination, response, allowCode));
  }

  const watcher = new BattleWatcher(
    wire => outgoing.push(wire),
    text => {
      console.log(`[Surveillance → BalooDanceur] ${text}`);
      reply({user: normalizePlayerId("BalooDanceur")}, text);
    },
  );
  const automatic = new TournamentAuto({
    room: options.room,
    context: options.context,
    sendWire: wire => outgoing.push(wire),
    notifyError: text => reply({user: normalizePlayerId("BalooDanceur")}, text),
    watch: (target, state) => { watcher.watch(target, state); },
    unwatch: target => { watcher.unwatch(target); },
    renderTeam: team => formatTeam(team, options.context),
    sendTeam: (player, response) => reply({user: normalizePlayerId(player)}, response, true),
  });
  const context: CommandContext = {
    ...options.context,
    sendPrivateTeam: (player, response) => reply({user: normalizePlayerId(player)}, response, true),
    autoCommand: action => automatic.command(action),
    watchBattle: target => watcher.watch(target, options.context.storage.snapshotForWatch()),
    unwatchBattle: target => watcher.unwatch(target),
  };

  socket.on("open", () => {
    console.log("WebSocket ouvert. Attente du challenge de login...");
  });

  socket.on("message", async data => {
    const message = data.toString();
    for (const line of message.split("\n")) {
      if (line.startsWith("|updateuser|")) {
        const fields = line.split("|");
        if (fields[3] === "1" && normalizePlayerId(fields[2] ?? "") === normalizePlayerId(options.username)) {
          if (!loggedIn) {
            loggedIn = true;
            console.log(`Connecté sous ${options.username}.`);
            if (options.room) sendGlobal(socket, `/join ${options.room}`);
          }
        }
      }
      if (line === "|init|chat") console.log("Salon rejoint.");
      if (line.startsWith("|error|") || line.startsWith("|popup|") || line.startsWith("|noinit|")) console.warn(line);
    }
    for (const line of message.split("\n")) {
      if (line.startsWith("|pm|") && /\|\/error\b/.test(line)) {
        console.warn(`[Erreur MP Showdown] ${line}`);
      }
    }
    if (loggedIn) {
      watcher.processPacket(message);
      commands = commands.then(() => { automatic.processPacket(message); })
        .catch(error => console.error("Erreur tournoi automatique :", error));
      for (const incoming of parseIncomingCommands(message, options.username, options.room)) {
        commands = commands.then(async () => {
          const response = await handleCommand(incoming.text, incoming.player, context, {
            isPrivateMessage: incoming.isPrivateMessage,
          });
          if (response) reply(responseDestination(incoming), response, /^\$(?:team|advance)(?:\s|$)/i.test(incoming.text.trim()));
        }).catch(error => console.error("Erreur commande Showdown :", error));
      }
    }

    const challstr = extractChallstr(message);

    if (!challstr) {
      return;
    }

    try {
      const assertion = await requestLoginAssertion({
        username: options.username,
        password: options.password,
        challstr,
      });

      sendGlobal(socket, `/trn ${options.username},0,${assertion}`);
      console.log(`Tentative de login envoyée pour ${options.username}.`);

    } catch (error) {
      console.error("Erreur pendant le login Showdown :");
      console.error(error);
    }
  });

  socket.on("error", error => {
    console.error("Erreur WebSocket Pokémon Showdown :");
    console.error(error);
  });

  await new Promise<void>(resolve => {
    socket.on("close", (code, reason) => {
      clearInterval(sender);
      outgoing.length = 0;
      console.log(`WebSocket fermé. Code=${code} Raison=${reason.toString() || "aucune"}`);
      resolve();
    });
  });
}

function extractChallstr(message: string): string | null {
  const line = message
    .split("\n")
    .find(entry => entry.startsWith("|challstr|"));

  if (!line) {
    return null;
  }

  return line.slice("|challstr|".length);
}

async function requestLoginAssertion(params: {
  username: string;
  password: string;
  challstr: string;
}): Promise<string> {
  const body = new URLSearchParams({
    name: params.username,
    pass: params.password,
    challstr: params.challstr,
  });

  const response = await fetch("https://play.pokemonshowdown.com/api/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  const text = await response.text();
  const jsonStart = text.indexOf("{");

  if (jsonStart === -1) {
    throw new Error(`Réponse login inattendue : ${text}`);
  }

  const parsed = JSON.parse(text.slice(jsonStart)) as LoginResponse;

  if (!parsed.assertion) {
    throw new Error(`Login refusé ou assertion absente : ${text}`);
  }

  if (parsed.assertion.startsWith(";;")) {
    throw new Error(`Erreur login Pokémon Showdown : ${parsed.assertion}`);
  }

  if (parsed.curuser && parsed.curuser.loggedin === false) {
    throw new Error(`Login refusé : nom d'utilisateur, mot de passe ou challstr incorrect.`);
  }

  return parsed.assertion;
}

function sendGlobal(socket: WebSocket, command: string): void {
  if (socket.readyState !== WebSocket.OPEN) {
    console.warn(`Commande non envoyée, socket non ouvert : ${command}`);
    return;
  }

  socket.send(`|${command}`);
}
