import { normalizePlayerId } from "./storage.js";

export type IncomingCommand = {
  player: string;
  text: string;
  room?: string;
  isPrivateMessage: boolean;
};

export function parseIncomingCommands(
  packet: string, botName: string, allowedRoom: string | null
): IncomingCommand[] {
  // Initial room packets include old chat: never replay those commands.
  if (packet.split("\n").includes("|init|chat")) return [];
  const result: IncomingCommand[] = [];
  let room: string | undefined;
  for (const line of packet.split("\n")) {
    if (line.startsWith(">")) { room = line.slice(1).trim(); continue; }
    const fields = line.split("|");
    let player = "";
    let text = "";
    const isPrivateMessage = fields[1] === "pm";
    if (isPrivateMessage) {
      if (normalizePlayerId(fields[3] ?? "") !== normalizePlayerId(botName)) continue;
      player = fields[2] ?? "";
      text = fields.slice(4).join("|");
    } else if (room && room === allowedRoom && fields[1] === "c:") {
      player = fields[3] ?? "";
      text = fields.slice(4).join("|");
    } else if (room && room === allowedRoom && fields[1] === "c") {
      player = fields[2] ?? "";
      text = fields.slice(3).join("|");
    } else continue;
    // Strip the protocol's single rank prefix, not characters inside a name.
    player = player.replace(/^[^A-Za-z0-9]/, "");
    if (!normalizePlayerId(player) || normalizePlayerId(player) === normalizePlayerId(botName)) continue;
    if (!text.trim().startsWith("$")) continue;
    result.push({ player, text, room, isPrivateMessage });
  }
  return result;
}

export function responseDestination(command: IncomingCommand): { room?: string; user?: string } {
  const name = command.text.trim().split(/\s+/)[0]?.toLowerCase();
  // Only brief public information and tournament controls go to the room.
  const publicCommands = new Set(["$round", "$start", "$next", "$end", "$new"]);
  return !command.isPrivateMessage && publicCommands.has(name ?? "")
    ? { room: command.room }
    : { user: normalizePlayerId(command.player) };
}


export function buildOutgoingMessages(
  destination: { room?: string; user?: string }, response: string, allowCode = false
): string[] {
  const messages: string[] = [];
  const send = (text: string) => messages.push(destination.user
    ? `|/pm ${destination.user}, ${text}` : `${destination.room}|${text}`);
  const marker = response.indexOf("\n!code ");
  // Only the private team response can introduce a trusted multiline command.
  const hasCode = allowCode && Boolean(destination.user) && marker >= 0;
  const plain = hasCode ? response.slice(0, marker) : response;
  for (const line of plain.split(/\r?\n/).filter(line => line.trim())) {
    for (let offset = 0; offset < line.length; offset += 250) {
      const part = line.slice(offset, offset + 250);
      send(/^[\s]*[!/]/.test(part) ? `› ${part}` : part);
    }
  }
  if (hasCode) {
    const team = response.slice(marker + "\n!code ".length).replace(/\r/g, "");
    // Showdown limits /code content to fewer than 8192 characters.
    let chunk = "";
    for (const set of team.split(/\n\s*\n/)) {
      if (set.length >= 8192) throw new Error("Set trop long pour !code.");
      if (chunk && chunk.length + 2 + set.length >= 8192) {
        send(`!code ${chunk}`);
        chunk = "";
      }
      chunk += (chunk ? "\n\n" : "") + set;
    }
    if (chunk) send(`!code ${chunk}`);
  }
  return messages;
}
