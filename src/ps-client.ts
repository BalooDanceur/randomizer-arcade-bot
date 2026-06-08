import WebSocket from "ws";

export type PsClientOptions = {
  serverUrl: string;
  username: string;
  password: string;
  room: string | null;
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

  socket.on("open", () => {
    console.log("WebSocket ouvert. Attente du challenge de login...");
  });

  socket.on("message", async data => {
    const message = data.toString();
    logIncomingMessage(message);

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

      if (options.room) {
        sendGlobal(socket, `/join ${options.room}`);
        console.log(`Demande de join room envoyée : ${options.room}`);
      }
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
    act: "login",
    name: params.username,
    pass: params.password,
    challstr: params.challstr,
  });

  const response = await fetch("https://play.pokemonshowdown.com/action.php", {
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

  if (!parsed.actionsuccess || !parsed.assertion) {
    throw new Error(`Login refusé ou assertion absente : ${text}`);
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

function logIncomingMessage(message: string): void {
  console.log("----- Message PS entrant -----");
  console.log(message);
  console.log("-----------------------------");
}
