import { existsSync, readdirSync, statSync, watch, type FSWatcher } from "node:fs";
import path from "node:path";
import { parseArgs, type ParseArgsConfig } from "node:util";
import { PRESETS } from "../presets.js";
import { type ComposeOptions, LAYOUT_VARIANTS, type LayoutVariant, composeScreenshot } from "../render/compose.js";
import { createShowcase } from "../render/showcase.js";
import { type ValidationResult, validateScreenshot } from "../render/validate.js";
import { type BuildItem, type BuildResult, buildPlan } from "../project/build.js";
import { ConfigError, DEFAULT_CONFIG_FILE, loadPlan } from "../project/config.js";
import type { AgentsFileResult } from "../project/agents.js";
import { initAgents, initProject, listImages } from "../project/init.js";
import { STAR_OFFER, acceptsStar, markStarOffered, shouldOfferStar, starRepo } from "../star.js";
import { PKG_VERSION } from "../util.js";

export interface CliIO {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  cwd: string;
  /** ANSI colors in human output. */
  color: boolean;
  /** Asks the user a question on an interactive terminal; absent when not a TTY. */
  prompt?: (question: string) => Promise<string>;
  /** Stars the repo after the user said yes. */
  starRepo: () => ReturnType<typeof starRepo>;
}

/** Bad invocation: exit code 2, with a pointer to the right help page. */
class UsageError extends Error {
  constructor(
    message: string,
    readonly command?: string,
  ) {
    super(message);
  }
}

export const EXIT_OK = 0;
export const EXIT_FAILED = 1;
export const EXIT_USAGE = 2;

const HELP: Record<string, string> = {
  main: `storeshots ${PKG_VERSION} — store-ready App Store & Google Play screenshots

Usage: storeshots <command> [options]

Project workflow (recommended):
  init        Create storeshots.json from a folder of raw screenshots
  build       Render every platform and language in storeshots.json
              (only what changed; --watch to re-render on save)

One-off commands:
  compose     Render a single screenshot from flags
  showcase    Stitch screenshots into one preview strip
  validate    Check images against store dimension/format rules
  presets     List presets and their exact store dimensions

Global options:
  --json      Machine-readable output on stdout
  -h, --help  Help for a command, e.g. "storeshots build --help"
  -v, --version

Exit codes: 0 ok, 1 render/validation failure, 2 bad usage or config.
Runs fully offline. The MCP server variant is \`storeshots-mcp\`.`,

  init: `Usage: storeshots init [options]

Writes a storeshots.json listing your raw screenshots, with TODO headlines to fill in,
and adds a short storeshots section to the project's AGENTS.md / CLAUDE.md so your
coding agent knows how screenshots are made here (created if neither exists).

Options:
  --screens <dir>     Folder of raw screenshots (default: first of screenshots/,
                      raw-shots/, raw/, shots/, fastlane/screenshots/ with images)
  --presets <ids>     Comma-separated presets (default ios-phone,android-phone)
  --langs <codes>     Comma-separated languages (default en)
  --bg <hex>          Brand color (default #5B5BD6)
  -c, --config <file> Config path (default storeshots.json)
  --force             Overwrite an existing config
  --no-agents         Do not touch AGENTS.md / CLAUDE.md
  --agents-only       Only add or refresh the AGENTS.md / CLAUDE.md section
  --json`,

  build: `Usage: storeshots build [options]

Renders every screen × preset × language in the config to
<outputDir>/<lang>/<preset>/<lang>_NN.png. Outputs whose inputs did not change
are skipped; files from removed screens are cleaned up.

Options:
  -c, --config <file> Config path (default storeshots.json)
  --lang <codes>      Only these languages, comma-separated
  --preset <ids>      Only these presets, comma-separated
  --force             Re-render everything, ignoring the cache
  --dry-run           Show what would be rendered, write nothing
  --jobs <n>          Parallel renders (default 2)
  -w, --watch         Rebuild when the config or a screenshot changes
  --verbose           Also list unchanged outputs
  --json

Config (storeshots.json):
  {
    "background": "#E31837",              brand color
    "presets": ["ios-phone", "android-phone"],
    "languages": ["en", "tr"],            default: keys of the first screen's copy
    "outputDir": "output",
    "variant": "text-top",                text-top | text-bottom | tilted
    "panorama": { "to": "#1E3A8A" },      optional gradient across the set
    "showcase": true,                     optional preview strip per set
    "screens": [
      { "screenshot": "shots/{platform}/home.png",   {lang} {preset} {platform}
        "variant": "tilted",                         optional, per screen
        "copy": { "en": ["Track", "your daily mood"],
                  "tr": { "verb": "Takip et", "descriptor": "günlük ruh halini" } } }
    ],
    "featureGraphic": { "screen": 1 }     optional Play feature graphic
  }
  Paths are relative to the config file. "screenshot" may also be an object
  keyed by preset id with a "default" fallback. "frame" takes a custom frame
  (see README) or one per preset id.`,

  compose: `Usage: storeshots compose --preset <id> --bg <hex> --verb <text> --desc <text> \\
                          --screenshot <path> --output <path> [options]

Options:
  --preset <id>               ${Object.keys(PRESETS).join(" | ")}
  --bg <hex>                  Background color, e.g. "#E31837"
  --verb <text>               Headline action word
  --desc <text>               Headline descriptor
  --screenshot <path>         Raw app screenshot
  -o, --output <path>         Output PNG path
  --lang <code>               Language for uppercasing (default en)
  --variant <name>            ${LAYOUT_VARIANTS.join(" | ")} (default text-top)
  --frame <path>              Custom device frame PNG (overrides built-in)
  --frame-screen <x,y,w,h>    Screen rectangle in the frame, px (with --frame)
  --no-gradient               Disable background gradient
  --json`,

  showcase: `Usage: storeshots showcase -o <output> <images or folders...>

Options:
  -o, --output <path>  Output PNG path
  --height <px>        Item height (default 1200)
  --bg <hex>           Strip background (default #f2f2f5)
  --json
Folders expand to their images in natural order.`,

  validate: `Usage: storeshots validate [--preset <id>] <files or folders...>

Checks size, format, and alpha channel. Folders are searched recursively
(showcase/ preview strips are skipped). Exits 1 if any image fails.

Options:
  --preset <id>  Validate against one preset instead of matching any
  --json`,

  presets: `Usage: storeshots presets [--json]`,
};

const COMMON = {
  json: { type: "boolean" },
  help: { type: "boolean", short: "h" },
} as const satisfies ParseArgsConfig["options"];

export async function runCli(argv: string[], ioIn: Partial<CliIO> = {}): Promise<number> {
  const io: CliIO = {
    stdout: ioIn.stdout ?? ((t) => process.stdout.write(t)),
    stderr: ioIn.stderr ?? ((t) => process.stderr.write(t)),
    cwd: ioIn.cwd ?? process.cwd(),
    color: ioIn.color ?? false,
    prompt: ioIn.prompt,
    starRepo: ioIn.starRepo ?? starRepo,
  };
  const [command, ...rest] = argv;
  const json = rest.includes("--json");
  try {
    switch (command) {
      case undefined:
      case "help":
      case "-h":
      case "--help":
        io.stdout(`${HELP[rest[0] ?? ""] ?? HELP.main}\n`);
        return EXIT_OK;
      case "-v":
      case "--version":
      case "version":
        io.stdout(`${PKG_VERSION}\n`);
        return EXIT_OK;
      case "init":
        return cmdInit(rest, io);
      case "build":
        return await cmdBuild(rest, io);
      case "compose":
        return await cmdCompose(rest, io);
      case "showcase":
        return await cmdShowcase(rest, io);
      case "validate":
        return await cmdValidate(rest, io);
      case "presets":
        return cmdPresets(rest, io);
      default:
        throw new UsageError(`Unknown command "${command}".`);
    }
  } catch (err) {
    return reportError(err, io, json, command);
  }
}

function reportError(err: unknown, io: CliIO, json: boolean, command?: string): number {
  if (err instanceof ConfigError) {
    if (json) io.stdout(`${JSON.stringify({ error: "config", file: err.file, issues: err.issues }, null, 2)}\n`);
    else {
      const file = path.relative(io.cwd, err.file) || err.file;
      const n = err.issues.length;
      io.stderr(
        `${paint(io, "red", "✗")} ${file}: ${n} problem${n === 1 ? "" : "s"}\n${err.issues.map((i) => `  - ${i}`).join("\n")}\n`,
      );
    }
    return EXIT_USAGE;
  }
  const usage = err instanceof UsageError || isParseArgsError(err);
  const message = err instanceof Error ? err.message : String(err);
  if (json) {
    io.stdout(`${JSON.stringify({ error: usage ? "usage" : "failed", message }, null, 2)}\n`);
  } else {
    const helpCmd = err instanceof UsageError ? (err.command ?? command) : command;
    const hint = usage
      ? `\nRun "storeshots ${helpCmd && HELP[helpCmd] ? `${helpCmd} ` : ""}--help" for usage.`
      : "";
    io.stderr(`${paint(io, "red", "✗")} ${message}${hint}\n`);
  }
  return usage ? EXIT_USAGE : EXIT_FAILED;
}

function isParseArgsError(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  return typeof code === "string" && code.startsWith("ERR_PARSE_ARGS");
}

function parse<O extends NonNullable<ParseArgsConfig["options"]>>(
  args: string[],
  options: O,
  allowPositionals = false,
) {
  return parseArgs({ args, options: { ...COMMON, ...options }, allowPositionals, strict: true });
}

function list(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  const items = value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return items.length ? items : undefined;
}

function requireOpt(values: Record<string, unknown>, key: string, command: string): string {
  const v = values[key];
  if (typeof v !== "string" || v.length === 0) throw new UsageError(`Missing required option --${key}.`, command);
  return v;
}

function printJson(io: CliIO, value: unknown): void {
  io.stdout(`${JSON.stringify(value, null, 2)}\n`);
}

// ---------------------------------------------------------------- init

function cmdInit(args: string[], io: CliIO): number {
  const { values } = parse(args, {
    screens: { type: "string" },
    presets: { type: "string" },
    langs: { type: "string" },
    bg: { type: "string" },
    config: { type: "string", short: "c" },
    force: { type: "boolean" },
    "no-agents": { type: "boolean" },
    "agents-only": { type: "boolean" },
  });
  if (values.help) return help(io, "init");
  if (values["no-agents"] && values["agents-only"]) {
    throw new UsageError("--no-agents and --agents-only cannot be combined.", "init");
  }
  const configPath = path.resolve(io.cwd, values.config ?? DEFAULT_CONFIG_FILE);
  const rel = (p: string) => path.relative(io.cwd, p) || ".";

  if (values["agents-only"]) {
    const agentFiles = initAgents(configPath, io.cwd);
    if (values.json) printJson(io, { agentFiles });
    else io.stdout(`${formatAgentFiles(io, agentFiles, rel).join("\n")}\n`);
    return EXIT_OK;
  }

  const result = initProject({
    configPath,
    screensDir: values.screens ? path.resolve(io.cwd, values.screens) : undefined,
    presets: list(values.presets),
    languages: list(values.langs),
    background: values.bg,
    force: values.force,
    agents: !values["no-agents"],
    projectDir: io.cwd,
  });
  if (values.json) {
    printJson(io, result);
    return EXIT_OK;
  }
  const lines = [`${paint(io, "green", "✓")} Created ${rel(result.configPath)} with ${result.screens} screens`];
  if (result.screensDir) lines.push(`  from ${rel(result.screensDir)}/`);
  else lines.push(`  No screenshot folder found; put your raw screenshots at the listed paths.`);
  if (result.skipped > 0) lines.push(`  ${paint(io, "yellow", "!")} Skipped ${result.skipped} images (stores allow at most 10).`);
  lines.push(...formatAgentFiles(io, result.agentFiles, rel));
  lines.push(
    "",
    "Next:",
    `  1. Replace each TODO with a headline: a verb + what the user gains.`,
    `  2. Set "background" to your brand color.`,
    `  3. storeshots build${result.configPath === path.resolve(io.cwd, DEFAULT_CONFIG_FILE) ? "" : ` -c ${rel(result.configPath)}`} --watch`,
  );
  io.stdout(`${lines.join("\n")}\n`);
  return EXIT_OK;
}

function formatAgentFiles(io: CliIO, files: AgentsFileResult[], rel: (p: string) => string): string[] {
  const verb = { created: "Created", updated: "Added storeshots section to", unchanged: "Up to date:" } as const;
  return files.map((f) => {
    const mark = f.action === "unchanged" ? paint(io, "dim", "·") : paint(io, "green", "✓");
    const what = path.basename(f.file) === "CLAUDE.md" && f.action === "created" ? " (imports AGENTS.md)" : "";
    return `${mark} ${verb[f.action]} ${rel(f.file)}${what}`;
  });
}

// ---------------------------------------------------------------- build

async function cmdBuild(args: string[], io: CliIO): Promise<number> {
  const { values } = parse(args, {
    config: { type: "string", short: "c" },
    lang: { type: "string" },
    preset: { type: "string" },
    force: { type: "boolean" },
    "dry-run": { type: "boolean" },
    jobs: { type: "string" },
    watch: { type: "boolean", short: "w" },
    verbose: { type: "boolean" },
  });
  if (values.help) return help(io, "build");
  const jobs = values.jobs === undefined ? undefined : Number(values.jobs);
  if (jobs !== undefined && (!Number.isInteger(jobs) || jobs < 1)) {
    throw new UsageError(`--jobs must be a positive integer, got "${values.jobs}".`, "build");
  }
  if (values.watch && values.json) throw new UsageError("--watch cannot be combined with --json.", "build");
  if (values.watch && values["dry-run"]) throw new UsageError("--watch cannot be combined with --dry-run.", "build");

  const configPath = path.resolve(io.cwd, values.config ?? DEFAULT_CONFIG_FILE);
  const filter = { langs: list(values.lang), presets: list(values.preset) };
  const printItem = (item: BuildItem) => {
    // Unchanged outputs only show up in the summary count unless --verbose.
    if (item.status === "unchanged" && !values.verbose) return;
    io.stdout(`${formatItem(io, item, values["dry-run"])}\n`);
  };
  const run = async (force: boolean) => {
    const plan = loadPlan(configPath, filter);
    const result = await buildPlan(plan, {
      force,
      dryRun: values["dry-run"],
      jobs,
      onItem: values.json ? undefined : printItem,
    });
    return { plan, result };
  };

  if (!values.watch) {
    const { result } = await run(Boolean(values.force));
    const offerStar = !result.dryRun && result.rendered > 0 && shouldOfferStar();
    if (offerStar) markStarOffered();
    if (values.json) {
      printJson(io, offerStar ? { ...result, star: STAR_OFFER } : result);
      return EXIT_OK;
    }
    io.stdout(`${formatSummary(io, result, configPath)}\n`);
    if (offerStar) await askForStar(io);
    return EXIT_OK;
  }
  return watchBuild(io, configPath, run, Boolean(values.force));
}

function formatItem(io: CliIO, item: BuildItem, dryRun?: boolean): string {
  const shown = path.relative(io.cwd, item.output) || item.output;
  const lines: string[] = [];
  if (item.status === "rendered") {
    const mark = dryRun ? paint(io, "cyan", "+") : paint(io, "green", "✓");
    lines.push(`${mark} ${shown}${item.headline ? paint(io, "dim", `  ${item.headline}`) : dryRun ? paint(io, "dim", "  would render") : ""}`);
  } else if (item.status === "unchanged") {
    lines.push(paint(io, "dim", `· ${shown}  unchanged`));
  } else {
    lines.push(`${paint(io, "red", "−")} ${shown}${paint(io, "dim", dryRun ? "  would remove" : "  removed")}`);
  }
  for (const w of item.warnings) lines.push(`  ${paint(io, "yellow", "!")} ${w}`);
  return lines.join("\n");
}

/**
 * Asks once per machine. On a terminal the user answers directly; otherwise
 * (an agent ran the CLI) it prints the question for the agent to relay.
 */
async function askForStar(io: CliIO): Promise<void> {
  if (!io.prompt) {
    io.stdout(
      `\n★ ${STAR_OFFER.pitch}\n  ${STAR_OFFER.question}\n  Agents: ask the user this once. Only on an explicit "yes", run: ${STAR_OFFER.command}\n`,
    );
    return;
  }
  io.stdout(`\n${paint(io, "yellow", "★")} ${STAR_OFFER.pitch}\n`);
  let answer: string;
  try {
    answer = await io.prompt(`  ${STAR_OFFER.question.replace("(yes/no)", "[Y/n]")} `);
  } catch {
    // Ctrl+C / Ctrl+D at the prompt: no answer is not a yes, and the build already succeeded.
    io.stdout("\n");
    return;
  }
  if (!acceptsStar(answer)) {
    io.stdout(paint(io, "dim", "No problem, it won't ask again.\n"));
    return;
  }
  const outcome = io.starRepo();
  if (outcome === "starred") io.stdout(`${paint(io, "green", "✓")} Starred ${STAR_OFFER.url}. Thank you!\n`);
  else if (outcome === "opened") io.stdout(`Opened ${STAR_OFFER.url} in your browser. Thank you!\n`);
  else io.stdout(`Star it here: ${STAR_OFFER.url}. Thank you!\n`);
}

function formatSummary(io: CliIO, r: BuildResult, configPath: string): string {
  const warnings = r.items.reduce((n, i) => n + i.warnings.length, 0);
  const parts = [
    `${r.rendered} ${r.dryRun ? "to render" : "rendered"}`,
    `${r.unchanged} unchanged`,
    ...(r.removed ? [`${r.removed} ${r.dryRun ? "to remove" : "removed"}`] : []),
    ...(warnings ? [paint(io, "yellow", `${warnings} warning${warnings === 1 ? "" : "s"}`)] : []),
  ];
  const where = path.relative(io.cwd, r.outputDir) || ".";
  const config = path.relative(io.cwd, configPath);
  return `${r.dryRun ? "Dry run" : "Done"}: ${parts.join(", ")} → ${where}/ ${paint(io, "dim", `(${config}, ${(r.durationMs / 1000).toFixed(1)}s)`)}`;
}

async function watchBuild(
  io: CliIO,
  configPath: string,
  run: (force: boolean) => Promise<{ plan: { inputs: string[]; outputDir: string } }>,
  force: boolean,
): Promise<number> {
  let watchers: FSWatcher[] = [];
  let timer: NodeJS.Timeout | undefined;
  let running = false;
  let queued = false;
  let watched = new Set<string>([configPath]);

  const rewatch = (files: string[]) => {
    for (const w of watchers) w.close();
    watched = new Set([configPath, ...files.map((f) => path.resolve(f))]);
    // Watch directories, not files: editors save by replacing the file, which
    // silently detaches a per-file watcher on macOS and Linux.
    const dirs = new Set([...watched].map((f) => path.dirname(f)).filter((d) => existsSync(d)));
    watchers = [...dirs].map((dir) =>
      watch(dir, (_event, name) => {
        if (name && watched.has(path.join(dir, name.toString()))) schedule();
      }),
    );
  };
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(cycle, 150);
  };
  const cycle = async (first = false) => {
    if (running) {
      queued = true;
      return;
    }
    running = true;
    if (!first) io.stdout(paint(io, "dim", `\n— change detected, rebuilding —\n`));
    try {
      const started = Date.now();
      const { plan } = await run(first && force);
      rewatch(plan.inputs);
      const where = path.relative(io.cwd, plan.outputDir) || ".";
      io.stdout(paint(io, "dim", `Built in ${((Date.now() - started) / 1000).toFixed(1)}s → ${where}/. Watching for changes (Ctrl+C to stop)…\n`));
    } catch (err) {
      // Keep watching through mistakes; the next save gets another try.
      reportError(err, io, false, "build");
      if (watchers.length === 0) rewatch([]);
      io.stdout(paint(io, "dim", "Watching for changes (Ctrl+C to stop)…\n"));
    } finally {
      running = false;
      if (queued) {
        queued = false;
        schedule();
      }
    }
  };

  await cycle(true);
  return new Promise<number>((resolve) => {
    const stop = () => {
      clearTimeout(timer);
      for (const w of watchers) w.close();
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
      resolve(EXIT_OK);
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
  });
}

// ---------------------------------------------------------------- compose

async function cmdCompose(args: string[], io: CliIO): Promise<number> {
  const { values } = parse(args, {
    preset: { type: "string" },
    bg: { type: "string" },
    verb: { type: "string" },
    desc: { type: "string" },
    screenshot: { type: "string" },
    output: { type: "string", short: "o" },
    lang: { type: "string" },
    variant: { type: "string" },
    frame: { type: "string" },
    "frame-screen": { type: "string" },
    "no-gradient": { type: "boolean" },
  });
  if (values.help) return help(io, "compose");
  const variant = (values.variant ?? "text-top") as LayoutVariant;
  if (!LAYOUT_VARIANTS.includes(variant)) {
    throw new UsageError(`Unknown variant "${values.variant}". Valid variants: ${LAYOUT_VARIANTS.join(", ")}`, "compose");
  }
  let frame: ComposeOptions["frame"];
  if (values.frame) {
    const parts = (values["frame-screen"] ?? "").split(",").map((n) => Number(n.trim()));
    if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n))) {
      throw new UsageError('--frame requires --frame-screen "x,y,width,height" with four integers.', "compose");
    }
    frame = {
      image: path.resolve(io.cwd, values.frame),
      screenX: parts[0],
      screenY: parts[1],
      screenWidth: parts[2],
      screenHeight: parts[3],
    };
  }
  const opts: ComposeOptions = {
    preset: requireOpt(values, "preset", "compose"),
    background: requireOpt(values, "bg", "compose"),
    verb: requireOpt(values, "verb", "compose"),
    descriptor: requireOpt(values, "desc", "compose"),
    screenshot: path.resolve(io.cwd, requireOpt(values, "screenshot", "compose")),
    output: path.resolve(io.cwd, requireOpt(values, "output", "compose")),
    lang: values.lang ?? "en",
    variant,
    frame,
    noGradient: values["no-gradient"],
  };
  const result = await composeScreenshot(opts);
  if (values.json) {
    printJson(io, result);
  } else {
    const lines = [
      `${paint(io, "green", "✓")} ${path.relative(io.cwd, result.output)}  ${result.width}×${result.height}${paint(io, "dim", `  ${result.headline}`)}`,
      ...result.warnings.map((w) => `  ${paint(io, "yellow", "!")} ${w}`),
    ];
    io.stdout(`${lines.join("\n")}\n`);
  }
  return EXIT_OK;
}

// ---------------------------------------------------------------- showcase

async function cmdShowcase(args: string[], io: CliIO): Promise<number> {
  const { values, positionals } = parse(
    args,
    { output: { type: "string", short: "o" }, height: { type: "string" }, bg: { type: "string" } },
    true,
  );
  if (values.help) return help(io, "showcase");
  const output = path.resolve(io.cwd, requireOpt(values, "output", "showcase"));
  const height = values.height === undefined ? undefined : Number(values.height);
  if (height !== undefined && (!Number.isInteger(height) || height < 100)) {
    throw new UsageError(`--height must be an integer of at least 100, got "${values.height}".`, "showcase");
  }
  const inputs = expandInputs(positionals, io.cwd, false).filter((f) => f !== output);
  if (inputs.length === 0) throw new UsageError("Give at least one image or folder to stitch.", "showcase");
  const result = await createShowcase({ inputs, output, itemHeight: height, background: values.bg });
  if (values.json) printJson(io, result);
  else
    io.stdout(
      `${paint(io, "green", "✓")} ${path.relative(io.cwd, result.output)}  ${result.width}×${result.height}, ${result.count} images\n${paint(io, "dim", result.note)}\n`,
    );
  return EXIT_OK;
}

// ---------------------------------------------------------------- validate

async function cmdValidate(args: string[], io: CliIO): Promise<number> {
  const { values, positionals } = parse(args, { preset: { type: "string" } }, true);
  if (values.help) return help(io, "validate");
  if (positionals.length === 0) throw new UsageError("Give at least one image or folder to validate.", "validate");
  if (values.preset && !PRESETS[values.preset]) {
    throw new UsageError(`Unknown preset "${values.preset}". Valid presets: ${Object.keys(PRESETS).join(", ")}`, "validate");
  }
  const files = expandInputs(positionals, io.cwd, true);
  if (files.length === 0) throw new UsageError("No PNG or JPEG images found in the given folders.", "validate");
  const results: ValidationResult[] = [];
  for (const f of files) results.push(await validateScreenshot(f, values.preset));
  const valid = results.every((r) => r.valid);
  if (values.json) {
    printJson(io, { valid, count: results.length, invalid: results.filter((r) => !r.valid).length, results });
  } else {
    const lines = results.map((r) => {
      const name = path.relative(io.cwd, r.file) || r.file;
      const dims = `${r.width}×${r.height}`;
      return r.valid
        ? `${paint(io, "green", "✓")} ${name}  ${dims}${r.matchesPreset ? paint(io, "dim", `  ${r.matchesPreset}`) : ""}`
        : `${paint(io, "red", "✗")} ${name}  ${dims}\n${r.problems.map((p) => `    ${p}`).join("\n")}`;
    });
    const bad = results.filter((r) => !r.valid).length;
    lines.push(bad ? `${bad} of ${results.length} images failed.` : `All ${results.length} images are store-ready.`);
    io.stdout(`${lines.join("\n")}\n`);
  }
  return valid ? EXIT_OK : EXIT_FAILED;
}

/** Expands folders into images (natural order); files pass through as given. */
function expandInputs(inputs: string[], cwd: string, recursive: boolean): string[] {
  const out: string[] = [];
  const visit = (dir: string) => {
    out.push(...listImages(dir).filter((f) => /\.(png|jpe?g)$/i.test(f)));
    // Showcase strips are previews, not store uploads.
    if (recursive) for (const sub of listDirs(dir)) if (path.basename(sub) !== "showcase") visit(sub);
  };
  for (const input of inputs) {
    const abs = path.resolve(cwd, input);
    if (existsSync(abs) && statSync(abs).isDirectory()) visit(abs);
    else out.push(abs);
  }
  return out;
}

function listDirs(dir: string): string[] {
  // Hidden entries (".storeshots-cache.json", ".git") are never inputs.
  return readdirSync(dir)
    .filter((n) => !n.startsWith(".") && n !== "node_modules")
    .sort((a, b) => a.localeCompare(b, "en", { numeric: true }))
    .map((n) => path.join(dir, n))
    .filter((p) => statSync(p).isDirectory());
}

// ---------------------------------------------------------------- presets

function cmdPresets(args: string[], io: CliIO): number {
  const { values } = parse(args, {});
  if (values.help) return help(io, "presets");
  const presets = Object.values(PRESETS).map((p) => ({
    id: p.id,
    store: p.store,
    label: p.label,
    width: p.width,
    height: p.height,
  }));
  if (values.json) {
    printJson(io, { presets });
  } else {
    io.stdout(
      `${presets.map((p) => `${p.id.padEnd(22)} ${`${p.width}×${p.height}`.padEnd(11)} ${p.label}`).join("\n")}\n`,
    );
  }
  return EXIT_OK;
}

// ---------------------------------------------------------------- helpers

function help(io: CliIO, command: string): number {
  io.stdout(`${HELP[command]}\n`);
  return EXIT_OK;
}

const ANSI = { red: 31, green: 32, yellow: 33, cyan: 36, dim: 2 } as const;

function paint(io: CliIO, color: keyof typeof ANSI, text: string): string {
  return io.color ? `\x1b[${ANSI[color]}m${text}\x1b[0m` : text;
}
