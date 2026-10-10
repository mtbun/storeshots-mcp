import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * Writes a short storeshots section into the project's agent instruction file
 * (AGENTS.md / CLAUDE.md), so whatever coding agent the user runs knows how
 * this project's store screenshots are made. The section sits between markers
 * and is replaced in place on rerun, never duplicated.
 */

export const AGENTS_START = "<!-- storeshots:start -->";
export const AGENTS_END = "<!-- storeshots:end -->";

export type AgentsFileAction = "created" | "updated" | "unchanged";

export interface AgentsFileResult {
  file: string;
  action: AgentsFileAction;
}

export function agentsSection(configFile: string): string {
  const c = configFile;
  return `${AGENTS_START}
## Store screenshots (storeshots)

App Store and Google Play screenshots are generated from \`${c}\` with the storeshots CLI. Do not edit the rendered PNGs or design them by hand.

- Change headlines, order, colors, or languages in \`${c}\`, then run \`npx -y --package=storeshots-mcp storeshots build${c === "storeshots.json" ? "" : ` -c ${c}`}\`. Only changed images are re-rendered.
- Headlines are a short verb plus what the user gains, in natural case, e.g. \`"en": ["Track", "your daily mood"]\`. Add a language by adding its code to \`languages\` and its copy to every screen. Translate idiomatically.
- Run \`storeshots build --help\` for the full config format, and \`storeshots validate <outputDir>\` before uploading.
- Add \`--json\` to any command for machine-readable output. Exit code 2 means the config needs fixing, and the output names each problem's path.
${AGENTS_END}`;
}

/** Inserts or replaces the storeshots section in `file`, creating the file if needed. */
export function upsertAgentsSection(file: string, section: string): AgentsFileAction {
  if (!existsSync(file)) {
    writeFileSync(file, `${section}\n`);
    return "created";
  }
  const current = readFileSync(file, "utf8");
  const start = current.indexOf(AGENTS_START);
  const end = current.indexOf(AGENTS_END);
  let next: string;
  if (start !== -1 && end > start) {
    next = current.slice(0, start) + section + current.slice(end + AGENTS_END.length);
  } else {
    const sep = current.length === 0 ? "" : current.endsWith("\n\n") ? "" : current.endsWith("\n") ? "\n" : "\n\n";
    next = `${current}${sep}${section}\n`;
  }
  if (next === current) return "unchanged";
  writeFileSync(file, next);
  return "updated";
}

/** True when CLAUDE.md pulls in AGENTS.md via an `@AGENTS.md` import line. */
function importsAgents(claudeFile: string): boolean {
  return /^\s*@\.?\/?AGENTS\.md\s*$/m.test(readFileSync(claudeFile, "utf8"));
}

/**
 * Picks the instruction files to write in `projectDir` and writes them:
 * - AGENTS.md (read by Codex, Cursor, and others) when it exists or when
 *   CLAUDE.md imports it;
 * - CLAUDE.md when it exists and does not import AGENTS.md;
 * - neither exists: AGENTS.md with the section, plus a CLAUDE.md that imports
 *   it, so Claude Code and the other agents all see one copy.
 */
export function writeAgentInstructions(projectDir: string, configFile: string): AgentsFileResult[] {
  const agents = path.join(projectDir, "AGENTS.md");
  const claude = path.join(projectDir, "CLAUDE.md");
  const section = agentsSection(configFile);
  const results: AgentsFileResult[] = [];

  const hasAgents = existsSync(agents);
  const hasClaude = existsSync(claude);
  const claudeImportsAgents = hasClaude && importsAgents(claude);
  if (hasAgents || !hasClaude || claudeImportsAgents) {
    results.push({ file: agents, action: upsertAgentsSection(agents, section) });
  }
  if (hasClaude && !claudeImportsAgents) {
    results.push({ file: claude, action: upsertAgentsSection(claude, section) });
  } else if (!hasClaude && !hasAgents) {
    writeFileSync(claude, "@AGENTS.md\n");
    results.push({ file: claude, action: "created" });
  }
  return results;
}
