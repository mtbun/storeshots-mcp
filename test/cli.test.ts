import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "../src/cli/run.js";
import { baseConfig, makeProject, solidScreenshot, tempDir, writeConfig } from "./helpers.js";

const CLI_BIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "dist", "cli.js");

/** Runs the CLI in-process against `cwd`, capturing output. */
async function cli(cwd: string, ...argv: string[]) {
  let stdout = "";
  let stderr = "";
  const code = await runCli(argv, { cwd, stdout: (t) => (stdout += t), stderr: (t) => (stderr += t) });
  return { code, stdout, stderr };
}

describe("storeshots CLI", () => {
  it("prints help, per-command help and the version", async () => {
    const dir = tempDir();
    const main = await cli(dir);
    expect(main.code).toBe(0);
    expect(main.stdout).toMatch(/init\s+Create storeshots\.json/);
    expect((await cli(dir, "build", "--help")).stdout).toMatch(/Config \(storeshots\.json\)/);
    expect((await cli(dir, "help", "validate")).stdout).toMatch(/Usage: storeshots validate/);
    expect((await cli(dir, "--version")).stdout).toMatch(/^\d+\.\d+\.\d+\n$/);
  });

  it("exits 2 with a pointer to help on bad usage", async () => {
    const dir = tempDir();
    const unknown = await cli(dir, "render");
    expect(unknown.code).toBe(2);
    expect(unknown.stderr).toMatch(/Unknown command "render"[\s\S]*storeshots --help/);

    const badFlag = await cli(dir, "build", "--langs", "en");
    expect(badFlag.code).toBe(2);
    expect(badFlag.stderr).toMatch(/Unknown option '--langs'[\s\S]*storeshots build --help/);

    const missing = await cli(dir, "compose", "--preset", "ios-phone");
    expect(missing.code).toBe(2);
    expect(missing.stderr).toMatch(/Missing required option --bg/);

    expect((await cli(dir, "build", "--jobs", "0")).stderr).toMatch(/--jobs must be a positive integer/);
  });

  it("init → build: from a folder of screenshots to a rendered set", async () => {
    const dir = tempDir();
    await solidScreenshot(path.join(dir, "screenshots", "1.png"), "#2b6cb0");
    await solidScreenshot(path.join(dir, "screenshots", "2.png"), "#e5484d");

    const init = await cli(dir, "init", "--presets", "android-phone", "--langs", "en,de", "--bg", "#0F766E");
    expect(init.code).toBe(0);
    expect(init.stdout).toMatch(/Created storeshots\.json with 2 screens/);

    const todo = await cli(dir, "build");
    expect(todo.code).toBe(2);
    expect(todo.stderr).toMatch(/storeshots\.json: 4 problems[\s\S]*screens\[0\]\.copy\.en: still has a TODO placeholder/);

    writeConfig(dir, {
      background: "#0F766E",
      presets: ["android-phone"],
      screens: [
        { screenshot: "screenshots/1.png", copy: { en: ["Track", "every habit"], de: ["Verfolge", "jede Gewohnheit"] } },
        { screenshot: "screenshots/2.png", copy: { en: ["See", "your progress"], de: ["Sieh", "deinen Überblick"] } },
      ],
    });
    const built = await cli(dir, "build");
    expect(built.code).toBe(0);
    expect(built.stdout).toContain(`✓ ${path.join("output", "de", "android-phone", "de_02.png")}  SIEH DEINEN ÜBERBLICK`);
    expect(built.stdout).toMatch(/Done: 4 rendered, 0 unchanged → output\//);

    const again = await cli(dir, "build");
    expect(again.stdout).not.toContain("✓");
    expect(again.stdout).toMatch(/Done: 0 rendered, 4 unchanged/);
    expect((await cli(dir, "build", "--verbose")).stdout).toContain("· output");
  });

  it("build --json, --dry-run, --lang and --preset filters", async () => {
    const dir = await makeProject({ presets: ["ios-phone", "android-phone"] });
    const dry = await cli(dir, "build", "--dry-run", "--json");
    expect(JSON.parse(dry.stdout)).toMatchObject({ dryRun: true, rendered: 12 });
    expect(existsSync(path.join(dir, "output"))).toBe(false);

    const some = await cli(dir, "build", "--lang", "tr", "--preset", "ios-phone", "--json");
    const result = JSON.parse(some.stdout);
    expect(result.rendered).toBe(3);
    expect(result.items.map((i: { file: string }) => i.file)).toEqual([
      "tr/ios-phone/tr_01.png",
      "tr/ios-phone/tr_02.png",
      "tr/ios-phone/tr_03.png",
    ]);
  }, 60000);

  it("reports config errors as JSON with --json", async () => {
    const dir = await makeProject({ background: "nope" });
    const r = await cli(dir, "build", "--json");
    expect(r.code).toBe(2);
    expect(JSON.parse(r.stdout)).toMatchObject({ error: "config", issues: [expect.stringMatching(/^background:/)] });
  });

  it("finds the config with -c relative to the working directory", async () => {
    const dir = await makeProject({ languages: ["en"] });
    writeConfig(dir, { ...baseConfig(), languages: ["en"], outputDir: "store" }, "listing.json");
    const r = await cli(dir, "build", "-c", "listing.json");
    expect(r.code).toBe(0);
    expect(existsSync(path.join(dir, "store/en/android-phone/en_03.png"))).toBe(true);
  });

  it("compose renders one screenshot from flags", async () => {
    const dir = tempDir();
    await solidScreenshot(path.join(dir, "raw.png"), "#2b6cb0");
    const r = await cli(
      dir,
      "compose",
      "--preset", "ios-phone",
      "--bg", "#E31837",
      "--verb", "izle",
      "--desc", "günlük ilerlemeni",
      "--lang", "tr",
      "--variant", "tilted",
      "--screenshot", "raw.png",
      "-o", "out/one.png",
      "--json",
    );
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout)).toMatchObject({ headline: "İZLE GÜNLÜK İLERLEMENİ", variant: "tilted", width: 1320 });
    expect(existsSync(path.join(dir, "out/one.png"))).toBe(true);

    const bad = await cli(dir, "compose", "--preset", "ios-phone", "--bg", "#E31837", "--verb", "a", "--desc", "b", "--screenshot", "raw.png", "-o", "x.png", "--variant", "wobbly");
    expect(bad.code).toBe(2);
    expect(bad.stderr).toMatch(/Unknown variant "wobbly"/);

    const missingShot = await cli(dir, "compose", "--preset", "ios-phone", "--bg", "#E31837", "--verb", "a", "--desc", "b", "--screenshot", "nope.png", "-o", "x.png");
    expect(missingShot.code).toBe(1);
    expect(missingShot.stderr).toMatch(/Could not read screenshot/);
  });

  it("validate checks folders recursively and fails on bad images", async () => {
    const dir = await makeProject({ languages: ["en"], showcase: true });
    await cli(dir, "build");
    const ok = await cli(dir, "validate", "output");
    expect(ok.code).toBe(0);
    expect(ok.stdout).toMatch(/All 3 images are store-ready\./); // showcase strip skipped

    await sharp({ create: { width: 1080, height: 1920, channels: 4, background: "#ff000080" } })
      .png()
      .toFile(path.join(dir, "output/en/android-phone/alpha.png"));
    const bad = await cli(dir, "validate", "output", "--json");
    expect(bad.code).toBe(1);
    const report = JSON.parse(bad.stdout);
    expect(report).toMatchObject({ valid: false, count: 4, invalid: 1 });
    expect(report.results.find((r: { valid: boolean }) => !r.valid).problems[0]).toMatch(/alpha channel/);

    const wrongPreset = await cli(dir, "validate", "--preset", "ios-phone", "output/en/android-phone/en_01.png");
    expect(wrongPreset.code).toBe(1);
    expect(wrongPreset.stdout).toMatch(/Expected 1320x2868/);
  }, 60000);

  it("showcase stitches a folder of screenshots", async () => {
    const dir = await makeProject({ languages: ["en"] });
    await cli(dir, "build");
    const r = await cli(dir, "showcase", "output/en/android-phone", "-o", "strip.png", "--height", "400", "--json");
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout)).toMatchObject({ count: 3, height: 400 + 72 * 2 });
  });

  it("presets lists every preset", async () => {
    const r = await cli(tempDir(), "presets", "--json");
    expect(JSON.parse(r.stdout).presets.map((p: { id: string }) => p.id)).toContain("play-feature-graphic");
    expect((await cli(tempDir(), "presets")).stdout).toMatch(/ios-phone\s+1320×2868/);
  });
});

describe("storeshots binary", () => {
  let child: ChildProcess | undefined;
  afterEach(() => child?.kill("SIGINT"));

  it("runs from dist with real exit codes", async () => {
    const dir = await makeProject({ languages: ["en"] });
    const ok = spawnSync(process.execPath, [CLI_BIN, "build"], { cwd: dir, encoding: "utf8", env: { ...process.env, NO_COLOR: "1" } });
    expect(ok.status).toBe(0);
    expect(ok.stdout).toMatch(/Done: 3 rendered/);
    const bad = spawnSync(process.execPath, [CLI_BIN, "nope"], { cwd: dir, encoding: "utf8" });
    expect(bad.status).toBe(2);
  }, 60000);

  it("build --watch re-renders when the config changes", async () => {
    const dir = await makeProject({ languages: ["en"] });
    child = spawn(process.execPath, [CLI_BIN, "build", "--watch"], { cwd: dir, env: { ...process.env, NO_COLOR: "1" } });
    let out = "";
    child.stdout?.on("data", (d) => (out += d));
    child.stderr?.on("data", (d) => (out += d));
    const waitFor = async (re: RegExp, ms = 20000) => {
      const end = Date.now() + ms;
      while (!re.test(out)) {
        if (Date.now() > end) throw new Error(`Timed out waiting for ${re}. Output:\n${out}`);
        await new Promise((r) => setTimeout(r, 50));
      }
    };
    await waitFor(/Watching for changes/);
    expect(out).toMatch(/en_03\.png/);

    out = "";
    const config = { ...baseConfig(), languages: ["en"] };
    (config.screens as { copy: Record<string, unknown> }[])[0].copy.en = ["Log", "your daily mood"];
    writeConfig(dir, config);
    await waitFor(/Watching for changes/);
    expect(out).toMatch(/change detected/);
    expect(out).toMatch(/en_01\.png {2}LOG YOUR DAILY MOOD/);
    expect(out).not.toMatch(/en_02\.png/);

    // A broken config is reported, and the watcher keeps going.
    out = "";
    writeConfig(dir, { ...config, background: "oops" });
    await waitFor(/Watching for changes/);
    expect(out).toMatch(/background: Invalid hex color/);
    expect(child.exitCode).toBeNull();
  }, 60000);
});
