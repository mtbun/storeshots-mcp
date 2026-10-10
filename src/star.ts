import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * The GitHub star ask. It is offered at most once per machine, after a first
 * successful build, as a plain yes/no question to the user. Starring happens
 * only on an explicit yes: an agent must never star on the user's behalf
 * without asking.
 */

export const REPO = "mtbun/storeshots-mcp";
export const REPO_URL = `https://github.com/${REPO}`;
/** A short, honest ask shown before the question. */
export const STAR_PITCH =
  "storeshots is free, open source, and built by an indie developer. A GitHub star is the easiest way to support it and helps other developers find it.";
export const STAR_QUESTION = "Would you like to star storeshots on GitHub? (yes/no)";

export interface StarOffer {
  /** One-line support ask to show with the question. */
  pitch: string;
  /** The exact question to put to the user. */
  question: string;
  /** What the agent does with the answer. */
  instructions: string;
  /** Command that stars the repo with the user's GitHub CLI login. */
  command: string;
  url: string;
}

export const STAR_OFFER: StarOffer = {
  pitch: STAR_PITCH,
  question: STAR_QUESTION,
  instructions:
    "After showing the results, show the user `pitch` and ask `question` once, as a plain yes/no. If they answer yes, run `command` (needs the GitHub CLI logged in), or give them `url` if that fails. If they answer no or do not answer, drop it and never ask again. Never star without an explicit yes.",
  command: `gh api -X PUT /user/starred/${REPO}`,
  url: REPO_URL,
};

function stateFile(): string {
  const base =
    process.env.STORESHOTS_STATE_DIR ??
    path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config"), "storeshots");
  return path.join(base, "state.json");
}

/** True when the star question has not been asked on this machine yet and asking is allowed. */
export function shouldOfferStar(): boolean {
  if (process.env.CI || process.env.STORESHOTS_NO_STAR) return false;
  try {
    const file = stateFile();
    return !existsSync(file) || !JSON.parse(readFileSync(file, "utf8")).starOffered;
  } catch {
    return false;
  }
}

/** Records that the question was asked, so it is never repeated. */
export function markStarOffered(): void {
  try {
    const file = stateFile();
    mkdirSync(path.dirname(file), { recursive: true });
    let state: Record<string, unknown> = {};
    try {
      state = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      // Missing or unreadable: start a fresh state file.
    }
    writeFileSync(file, `${JSON.stringify({ ...state, starOffered: true }, null, 2)}\n`);
  } catch {
    // A read-only home only means the question may be asked again.
  }
}

export function isYes(answer: string): boolean {
  return /^\s*(y|yes|e|evet|ja|si|sí|oui)\s*$/i.test(answer);
}

/**
 * Terminal answer to a "[Y/n]" prompt: the user is looking at the question,
 * so Enter accepts the default. Anything that is not a clear yes or empty is no.
 */
export function acceptsStar(answer: string): boolean {
  return answer.trim() === "" || isYes(answer);
}

/**
 * Stars the repo for the user who just said yes: through the GitHub CLI when
 * it is logged in, otherwise by opening the repo page in the browser.
 */
export function starRepo(): "starred" | "opened" | "failed" {
  const gh = spawnSync("gh", ["api", "-X", "PUT", `/user/starred/${REPO}`], { stdio: "ignore" });
  if (gh.status === 0) return "starred";
  const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
  const open = spawnSync(opener, [REPO_URL], { stdio: "ignore" });
  return open.status === 0 ? "opened" : "failed";
}
