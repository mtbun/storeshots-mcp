import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { normalizeHex } from "../util.js";
import { type AgentsFileResult, writeAgentInstructions } from "./agents.js";
import { ConfigError, FEATURE_PRESET, configSchema } from "./config.js";
import { PRESETS } from "../presets.js";

/** Directories `init` looks in for raw screenshots when none is given. */
export const SCREENSHOT_DIR_GUESSES = ["screenshots", "raw-shots", "raw", "shots", "fastlane/screenshots"];
const IMAGE_RE = /\.(png|jpe?g|webp)$/i;
const MAX_SCREENS = 10;

export interface InitOptions {
  configPath: string;
  /** Directory of raw screenshots; guessed from SCREENSHOT_DIR_GUESSES when omitted. */
  screensDir?: string;
  presets?: string[];
  languages?: string[];
  background?: string;
  force?: boolean;
  /** Add a storeshots section to the project's AGENTS.md / CLAUDE.md. Default true. */
  agents?: boolean;
  /** Project root for the agent instruction files. Default: the config's directory. */
  projectDir?: string;
}

export interface InitResult {
  configPath: string;
  screensDir: string | null;
  screens: number;
  skipped: number;
  agentFiles: AgentsFileResult[];
}

/** Lists images in a directory, in natural order ("2.png" before "10.png"). */
export function listImages(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => IMAGE_RE.test(f) && !f.startsWith("."))
    .filter((f) => statSync(path.join(dir, f)).isFile())
    .sort((a, b) => a.localeCompare(b, "en", { numeric: true }))
    .map((f) => path.join(dir, f));
}

export function initProject(opts: InitOptions): InitResult {
  const configPath = path.resolve(opts.configPath);
  const baseDir = path.dirname(configPath);
  if (existsSync(configPath) && !opts.force) {
    throw new ConfigError(configPath, ["Already exists. Edit it, or pass --force to overwrite it."]);
  }

  const issues: string[] = [];
  const presets = opts.presets?.length ? opts.presets : ["ios-phone", "android-phone"];
  for (const p of presets) {
    if (p === FEATURE_PRESET) issues.push(`--presets: "${FEATURE_PRESET}" is configured via "featureGraphic", not "presets".`);
    else if (!PRESETS[p]) issues.push(`--presets: unknown preset "${p}". Run "storeshots presets" for the list.`);
  }
  const languages = opts.languages?.length ? opts.languages : ["en"];
  let background = "#5B5BD6";
  if (opts.background) {
    try {
      background = normalizeHex(opts.background).toUpperCase();
    } catch (err) {
      issues.push(`--bg: ${(err as Error).message}`);
    }
  }

  let screensDir: string | null = null;
  if (opts.screensDir) {
    screensDir = path.resolve(baseDir, opts.screensDir);
    if (!existsSync(screensDir) || !statSync(screensDir).isDirectory()) {
      issues.push(`--screens: directory not found: ${opts.screensDir}`);
      screensDir = null;
    }
  } else {
    screensDir =
      SCREENSHOT_DIR_GUESSES.map((d) => path.join(baseDir, d)).find(
        (d) => existsSync(d) && statSync(d).isDirectory() && listImages(d).length > 0,
      ) ?? null;
  }
  if (issues.length > 0) throw new ConfigError(configPath, issues);

  const found = screensDir ? listImages(screensDir) : [];
  const files =
    found.length > 0
      ? found.slice(0, MAX_SCREENS).map((f) => toPosix(path.relative(baseDir, f)))
      : ["screenshots/01.png", "screenshots/02.png", "screenshots/03.png"];

  const placeholder = { verb: "TODO", descriptor: "TODO what the user gains" };
  const config = {
    background,
    presets,
    languages,
    outputDir: "output",
    screens: files.map((screenshot) => ({
      screenshot,
      copy: Object.fromEntries(languages.map((l) => [l, placeholder])),
    })),
  };
  // Never write a config the build would reject for structural reasons.
  configSchema.parse(config);
  mkdirSync(baseDir, { recursive: true });
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);

  return {
    configPath,
    screensDir,
    screens: files.length,
    skipped: Math.max(0, found.length - MAX_SCREENS),
    agentFiles: opts.agents === false ? [] : initAgents(configPath, opts.projectDir),
  };
}

/** Writes the agent instructions for a config; usable on its own for existing projects. */
export function initAgents(configPath: string, projectDir?: string): AgentsFileResult[] {
  const root = path.resolve(projectDir ?? path.dirname(configPath));
  return writeAgentInstructions(root, toPosix(path.relative(root, path.resolve(configPath))));
}

function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}
