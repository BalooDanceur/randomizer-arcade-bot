import "dotenv/config";

export type BotMode = "console" | "ps";

export type BotConfig = {
  psUsername: string;
  psPassword: string;
  psServerUrl: string;
  psRoom: string | null;
  mode: BotMode;
  prefix: string;
  adminUsers: string[];
  teamSize: number;
  sameName: boolean;
};

export function loadConfig(): BotConfig {
  const prefix = process.env.BOT_PREFIX ?? "$";

  if (prefix !== "$") {
    throw new Error("Pour Randomizer Arcade, le préfixe doit rester `$`.");
  }

  return {
    psUsername: readEnv("PS_USERNAME"),
    psPassword: readEnv("PS_PASSWORD"),
    psServerUrl:
      process.env.PS_SERVER_URL ?? "wss://sim3.psim.us/showdown/websocket",
    psRoom: readOptionalEnv("PS_ROOM"),
    mode: readBotModeEnv("BOT_MODE", "console"),
    prefix,
    adminUsers: readCsvEnv("ADMIN_USERS"),
    teamSize: readPositiveIntegerEnv("TEAM_SIZE", 6),
    sameName: readBooleanEnv("SAME_NAME", false),
  };
}

function readEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Variable .env manquante : ${name}`);
  }

  return value;
}

function readOptionalEnv(name: string): string | null {
  const value = process.env[name]?.trim();

  if (!value) {
    return null;
  }

  return value;
}

function readCsvEnv(name: string): string[] {
  const value = process.env[name];

  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map(entry => entry.trim())
    .filter(Boolean);
}

function readPositiveIntegerEnv(name: string, fallback: number): number {
  const raw = process.env[name];

  if (!raw) {
    return fallback;
  }

  const value = Number(raw);

  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Variable .env invalide : ${name} doit être un entier positif.`);
  }

  return value;
}

function readBooleanEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name];

  if (!raw) {
    return fallback;
  }

  const normalized = raw.trim().toLowerCase();

  if (["true", "on", "yes", "1"].includes(normalized)) {
    return true;
  }

  if (["false", "off", "no", "0"].includes(normalized)) {
    return false;
  }

  throw new Error(
    `Variable .env invalide : ${name} doit valoir true/false, on/off, yes/no ou 1/0.`
  );
}

function readBotModeEnv(name: string, fallback: BotMode): BotMode {
  const raw = process.env[name];

  if (!raw) {
    return fallback;
  }

  const normalized = raw.trim().toLowerCase();

  if (normalized === "console" || normalized === "ps") {
    return normalized;
  }

  throw new Error(`Variable .env invalide : ${name} doit valoir console ou ps.`);
}
