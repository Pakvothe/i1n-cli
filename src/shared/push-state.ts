import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { Wording } from "./types.js";

const STATE_FILE = ".i1n-push-state.json";

type PushState = Record<string, string>; // "namespace:key" → hash

function hashWording(w: Wording): string {
  const content = JSON.stringify(w.value_json);
  return crypto.createHash("md5").update(content).digest("hex");
}

function stateKey(w: Wording): string {
  return `${w.namespace}:${w.key}`;
}

function statePath(localesDir: string): string {
  return path.join(localesDir, STATE_FILE);
}

export function readPushState(localesDir: string): PushState {
  const filePath = statePath(localesDir);
  if (!fs.existsSync(filePath)) return {};
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return {};
  }
}

export function writePushState(
  wordings: Wording[],
  localesDir: string,
): void {
  const state: PushState = {};
  for (const w of wordings) {
    state[stateKey(w)] = hashWording(w);
  }
  fs.writeFileSync(statePath(localesDir), JSON.stringify(state), "utf-8");
}

/**
 * Returns only wordings whose content changed since last push.
 * On first push (no state file), returns all wordings.
 */
export function getChangedWordings(
  wordings: Wording[],
  localesDir: string,
): { changed: Wording[]; unchanged: number } {
  const state = readPushState(localesDir);
  if (Object.keys(state).length === 0) {
    return { changed: wordings, unchanged: 0 };
  }

  const changed: Wording[] = [];
  let unchanged = 0;

  for (const w of wordings) {
    const key = stateKey(w);
    const hash = hashWording(w);
    if (state[key] === hash) {
      unchanged++;
    } else {
      changed.push(w);
    }
  }

  return { changed, unchanged };
}
