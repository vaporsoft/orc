import { resolve } from "path";
import { existsSync, readFileSync } from "fs";

/**
 * Load a .env file into process.env.
 * Searches upward from cwd to find the nearest .env file.
 * Does NOT override existing env vars.
 */
export async function loadEnv(): Promise<void> {
  const envPath = findEnvFile(process.cwd());
  if (!envPath) return;

  try {
    const text = readFileSync(envPath, "utf-8");
    const vars = parse(text);
    let loaded = 0;

    for (const [key, value] of Object.entries(vars)) {
      if (process.env[key] === undefined) {
        process.env[key] = value;
        loaded++;
      }
    }

    if (loaded > 0) {
      console.log(`orc: loaded ${loaded} env var(s) from ${envPath}`);
    }
  } catch {
    // .env file doesn't exist or can't be read — that's fine
  }
}

/** Walk up from dir to find the nearest .env file */
function findEnvFile(from: string): string | null {
  let dir = resolve(from);
  const root = resolve("/");

  while (dir !== root) {
    const candidate = resolve(dir, ".env");
    if (existsSync(candidate)) {
      return candidate;
    }
    dir = resolve(dir, "..");
  }

  return null;
}

/** Parse KEY=VALUE lines from .env content */
function parse(content: string): Record<string, string> {
  const vars: Record<string, string> = {};

  for (const raw of content.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;

    const eqIdx = line.indexOf("=");
    if (eqIdx === -1) continue;

    const key = line.slice(0, eqIdx).trim();
    let value = line.slice(eqIdx + 1).trim();

    // Strip surrounding quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (key) {
      vars[key] = value;
    }
  }

  return vars;
}
