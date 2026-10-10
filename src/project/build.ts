import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, rmdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getPreset } from "../presets.js";
import { composeScreenshot } from "../render/compose.js";
import { panoramaSlices } from "../render/panorama.js";
import { createShowcase } from "../render/showcase.js";
import { validateScreenshot } from "../render/validate.js";
import { PKG_VERSION } from "../util.js";
import type { Plan, PlannedImage, PlannedShowcase } from "./config.js";

/**
 * Executes a plan. Rendering is deterministic, so every output is keyed by a
 * hash of everything that affects its pixels (options, input file contents,
 * engine version); outputs whose key is unchanged are skipped. The keys live
 * in a manifest inside the output dir, which also lets a full build remove
 * files it produced earlier but no longer does (e.g. a deleted screen).
 */

export const MANIFEST_FILE = ".storeshots-cache.json";

export type BuildStatus = "rendered" | "unchanged" | "removed";

export interface BuildItem {
  kind: "screen" | "feature" | "showcase";
  file: string;
  output: string;
  lang?: string;
  preset?: string;
  status: BuildStatus;
  headline?: string;
  warnings: string[];
}

export interface BuildResult {
  outputDir: string;
  dryRun: boolean;
  items: BuildItem[];
  rendered: number;
  unchanged: number;
  removed: number;
  durationMs: number;
}

export interface BuildOptions {
  /** Re-render everything, ignoring the cache. */
  force?: boolean;
  /** Report what would happen without writing anything. */
  dryRun?: boolean;
  /** Parallel renders. Default 2. */
  jobs?: number;
  /** Called as each item finishes, in completion order. */
  onItem?: (item: BuildItem) => void;
}

interface Manifest {
  version: 1;
  files: Record<string, string>;
}

export async function buildPlan(plan: Plan, opts: BuildOptions = {}): Promise<BuildResult> {
  const started = Date.now();
  const manifestPath = path.join(plan.outputDir, MANIFEST_FILE);
  const previous = readManifest(manifestPath);
  const next: Manifest = { version: 1, files: { ...previous.files } };
  const hashes = new Map<string, string>();
  const fileHash = (file: string) => {
    let h = hashes.get(file);
    if (!h) {
      h = sha256(readFileSync(file));
      hashes.set(file, h);
    }
    return h;
  };

  const imageItems: BuildItem[] = new Array(plan.images.length);
  const emit = (item: BuildItem) => opts.onItem?.(item);
  const isFresh = (file: string, output: string, key: string) =>
    !opts.force && previous.files[file] === key && existsSync(output);

  // Panorama slices are shared by every panel of a set; render each set's once.
  const slicesBySet = new Map<string, Promise<Buffer[]>>();
  const sliceFor = (img: PlannedImage): Promise<Buffer> | undefined => {
    const p = img.panorama;
    if (!p) return undefined;
    const setKey = `${img.lang}/${img.preset}`;
    let slices = slicesBySet.get(setKey);
    if (!slices) {
      const preset = getPreset(img.preset);
      slices = panoramaSlices(p.from, p.to, p.count, preset.width, preset.height);
      slicesBySet.set(setKey, slices);
    }
    return slices.then((s) => s[p.index]);
  };

  try {
    const keys = plan.images.map((img) => imageKey(img, fileHash));
    const plannedKeys = Object.fromEntries(plan.images.map((img, i) => [img.file, keys[i]]));
    await runPool(plan.images.length, opts.jobs ?? 2, async (i) => {
      const img = plan.images[i];
      const key = keys[i];
      const base = { kind: img.kind, file: img.file, output: img.output, lang: img.lang, preset: img.preset };
      if (isFresh(img.file, img.output, key)) {
        imageItems[i] = { ...base, status: "unchanged", warnings: [] };
      } else if (opts.dryRun) {
        imageItems[i] = { ...base, status: "rendered", warnings: [] };
      } else {
        const result = await composeScreenshot({ ...img.compose, backgroundImage: await sliceFor(img) });
        const check = await validateScreenshot(img.output, img.preset);
        if (!check.valid) {
          throw new Error(`Rendered ${img.file} failed store validation: ${check.problems.join(" ")}`);
        }
        next.files[img.file] = key;
        imageItems[i] = {
          ...base,
          status: "rendered",
          headline: result.headline,
          // The build reports rewrites through its status; drop the overwrite notice.
          warnings: result.warnings.filter((w) => !w.startsWith("Overwrote existing file")),
        };
      }
      emit(imageItems[i]);
    });

    const showcaseItems: BuildItem[] = [];
    for (const sc of plan.showcases) {
      const key = showcaseKey(sc, plannedKeys);
      const base = { kind: "showcase" as const, file: sc.file, output: sc.output, lang: sc.lang, preset: sc.preset };
      let item: BuildItem;
      if (isFresh(sc.file, sc.output, key)) {
        item = { ...base, status: "unchanged", warnings: [] };
      } else {
        if (!opts.dryRun) {
          await createShowcase({
            inputs: sc.inputs.map((f) => path.join(plan.outputDir, f)),
            output: sc.output,
            itemHeight: sc.itemHeight,
          });
          next.files[sc.file] = key;
        }
        item = { ...base, status: "rendered", warnings: [] };
      }
      showcaseItems.push(item);
      emit(item);
    }

    // Only a full build knows the complete set of outputs, so only it prunes.
    const removedItems: BuildItem[] = [];
    if (plan.complete) {
      const wanted = new Set([...plan.images.map((i) => i.file), ...plan.showcases.map((s) => s.file)]);
      for (const file of Object.keys(previous.files).sort()) {
        if (wanted.has(file)) continue;
        const output = path.join(plan.outputDir, file);
        if (!isInside(plan.outputDir, output)) continue;
        if (!opts.dryRun) {
          rmSync(output, { force: true });
          removeEmptyParents(path.dirname(output), plan.outputDir);
          delete next.files[file];
        }
        const item: BuildItem = { kind: "screen", file, output, status: "removed", warnings: [] };
        removedItems.push(item);
        emit(item);
      }
    }

    const items = [...imageItems, ...showcaseItems, ...removedItems];
    return {
      outputDir: plan.outputDir,
      dryRun: Boolean(opts.dryRun),
      items,
      rendered: items.filter((i) => i.status === "rendered").length,
      unchanged: items.filter((i) => i.status === "unchanged").length,
      removed: removedItems.length,
      durationMs: Date.now() - started,
    };
  } finally {
    // Persist progress even when a render fails midway, so a rerun resumes.
    if (!opts.dryRun) writeManifest(manifestPath, next);
  }
}

function imageKey(img: PlannedImage, fileHash: (f: string) => string): string {
  const c = img.compose;
  return sha256(
    JSON.stringify({
      engine: PKG_VERSION,
      preset: c.preset,
      background: c.background,
      verb: c.verb,
      descriptor: c.descriptor,
      lang: c.lang,
      variant: c.variant,
      noGradient: Boolean(c.noGradient),
      screenshot: fileHash(c.screenshot),
      frame: c.frame ? { ...c.frame, image: fileHash(c.frame.image) } : null,
      panorama: img.panorama ?? null,
    }),
  );
}

function showcaseKey(sc: PlannedShowcase, files: Record<string, string>): string {
  return sha256(JSON.stringify({ engine: PKG_VERSION, height: sc.itemHeight, inputs: sc.inputs.map((f) => files[f]) }));
}

function sha256(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

function readManifest(file: string): Manifest {
  try {
    const m = JSON.parse(readFileSync(file, "utf8"));
    if (m && m.version === 1 && typeof m.files === "object") return m as Manifest;
  } catch {
    // Missing or corrupt: start fresh, which only costs a full re-render.
  }
  return { version: 1, files: {} };
}

function writeManifest(file: string, manifest: Manifest): void {
  if (Object.keys(manifest.files).length === 0 && !existsSync(file)) return;
  mkdirSync(path.dirname(file), { recursive: true });
  const sorted = Object.fromEntries(Object.entries(manifest.files).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(file, `${JSON.stringify({ version: 1, files: sorted }, null, 2)}\n`);
}

function isInside(dir: string, file: string): boolean {
  const rel = path.relative(dir, file);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

function removeEmptyParents(dir: string, stopAt: string): void {
  while (isInside(stopAt, dir)) {
    try {
      if (readdirSync(dir).length > 0) return;
      rmdirSync(dir);
    } catch {
      return;
    }
    dir = path.dirname(dir);
  }
}

/** Runs `task(0..count-1)` with at most `limit` in flight; rejects on the first failure. */
async function runPool(count: number, limit: number, task: (i: number) => Promise<void>): Promise<void> {
  let next = 0;
  let failed = false;
  const worker = async () => {
    while (!failed && next < count) {
      const i = next++;
      try {
        await task(i);
      } catch (err) {
        failed = true;
        throw err;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, count)) }, worker));
}
