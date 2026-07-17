import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * CLI konfiguracio: ~/.config/keypro/config.json (XDG_CONFIG_HOME tisztelettel).
 * Feloldasi sorrend (erosebb elol):
 *   --api-key / --api-base kapcsolo > KEYPRO_API_KEY / KEYPRO_API_BASE env >
 *   config fajl > DEFAULT_API_BASE.
 * A fajl 0600 joggal irodik (a token titok).
 */

/** Az eles bolt cime - dev teszthez: keypro config set api-base https://dev.keypro.hu */
export const DEFAULT_API_BASE = "https://keypro.hu";

export interface KeyproConfig {
  apiKey?: string;
  apiBase?: string;
}

export function configDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  return join(xdg && xdg.length > 0 ? xdg : join(homedir(), ".config"), "keypro");
}

export function configPath(): string {
  return join(configDir(), "config.json");
}

export function readConfig(): KeyproConfig {
  try {
    if (!existsSync(configPath())) return {};
    const raw = JSON.parse(readFileSync(configPath(), "utf8")) as unknown;
    if (typeof raw !== "object" || raw === null) return {};
    const obj = raw as Record<string, unknown>;
    return {
      apiKey: typeof obj.apiKey === "string" ? obj.apiKey : undefined,
      apiBase: typeof obj.apiBase === "string" ? obj.apiBase : undefined,
    };
  } catch {
    return {};
  }
}

export function writeConfig(patch: Partial<KeyproConfig>): KeyproConfig {
  const next = { ...readConfig(), ...patch };
  // A torlendo (undefined) kulcsok ne keruljenek a fajlba.
  const clean = Object.fromEntries(
    Object.entries(next).filter(([, v]) => v !== undefined),
  );
  mkdirSync(configDir(), { recursive: true });
  writeFileSync(configPath(), JSON.stringify(clean, null, 2) + "\n", {
    mode: 0o600,
  });
  try {
    chmodSync(configPath(), 0o600);
  } catch {
    // Windows: a chmod nem ertelmezett, a fajl igy is letrejon.
  }
  return clean as KeyproConfig;
}

export interface ResolvedConfig {
  apiBase: string;
  apiKey: string | null;
  /** Honnan jott az apiKey (hibauzenetekhez). */
  keySource: "flag" | "env" | "config" | "none";
}

export function resolveConfig(flags: {
  apiKey?: string;
  apiBase?: string;
}): ResolvedConfig {
  const file = readConfig();
  const apiBase = (
    flags.apiBase ??
    process.env.KEYPRO_API_BASE ??
    file.apiBase ??
    DEFAULT_API_BASE
  ).replace(/\/$/, "");

  if (flags.apiKey) return { apiBase, apiKey: flags.apiKey, keySource: "flag" };
  if (process.env.KEYPRO_API_KEY) {
    return { apiBase, apiKey: process.env.KEYPRO_API_KEY, keySource: "env" };
  }
  if (file.apiKey) return { apiBase, apiKey: file.apiKey, keySource: "config" };
  return { apiBase, apiKey: null, keySource: "none" };
}
