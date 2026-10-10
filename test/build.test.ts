import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { type BuildResult, MANIFEST_FILE, buildPlan } from "../src/project/build.js";
import { loadPlan } from "../src/project/config.js";
import { baseConfig, makeProject, readJson, solidScreenshot, writeConfig } from "./helpers.js";

const build = (dir: string, opts: Parameters<typeof buildPlan>[1] = {}, filter = {}) =>
  buildPlan(loadPlan(path.join(dir, "storeshots.json"), filter), opts);

const byStatus = (r: BuildResult, status: string) =>
  r.items.filter((i) => i.status === status).map((i) => i.file);

describe("buildPlan", () => {
  it("renders every output at exact store size and records it in the manifest", async () => {
    const dir = await makeProject({ presets: ["ios-phone", "android-phone"] });
    const result = await build(dir);
    expect(result.rendered).toBe(12);
    expect(result.unchanged).toBe(0);
    const ios = await sharp(path.join(dir, "output/tr/ios-phone/tr_02.png")).metadata();
    expect([ios.width, ios.height, ios.hasAlpha]).toEqual([1320, 2868, false]);
    const tr = result.items.find((i) => i.file === "tr/android-phone/tr_02.png");
    expect(tr?.headline).toBe("KEŞFET HAFTALIK İÇGÖRÜLER");
    const manifest = readJson<{ files: Record<string, string> }>(path.join(dir, "output", MANIFEST_FILE));
    expect(Object.keys(manifest.files)).toHaveLength(12);
  }, 60000);

  it("skips unchanged outputs and re-renders only what an edit touches", async () => {
    const dir = await makeProject();
    await build(dir);
    const before = statSync(path.join(dir, "output/en/android-phone/en_01.png")).mtimeMs;

    const second = await build(dir);
    expect(second.rendered).toBe(0);
    expect(second.unchanged).toBe(6);
    expect(statSync(path.join(dir, "output/en/android-phone/en_01.png")).mtimeMs).toBe(before);

    // Edit one headline in one language.
    const config = baseConfig();
    (config.screens as { copy: Record<string, unknown> }[])[1].copy.tr = ["Bul", "haftalık içgörüler"];
    writeConfig(dir, config);
    expect(byStatus(await build(dir), "rendered")).toEqual(["tr/android-phone/tr_02.png"]);

    // Replace a raw screenshot's pixels (same path): both languages re-render.
    await solidScreenshot(path.join(dir, "shots/plan.png"), "#000000");
    expect(byStatus(await build(dir), "rendered")).toEqual(["en/android-phone/en_03.png", "tr/android-phone/tr_03.png"]);
  }, 60000);

  it("re-renders a deleted output and everything with --force", async () => {
    const dir = await makeProject({ languages: ["en"] });
    await build(dir);
    const { rmSync } = await import("node:fs");
    rmSync(path.join(dir, "output/en/android-phone/en_02.png"));
    expect(byStatus(await build(dir), "rendered")).toEqual(["en/android-phone/en_02.png"]);
    expect((await build(dir, { force: true })).rendered).toBe(3);
  }, 60000);

  it("removes outputs of deleted screens, but only on a full build", async () => {
    const dir = await makeProject();
    await build(dir);
    const config = baseConfig();
    (config.screens as unknown[]).pop();
    writeConfig(dir, config);

    const partial = await build(dir, {}, { langs: ["en"] });
    expect(partial.removed).toBe(0);
    expect(existsSync(path.join(dir, "output/tr/android-phone/tr_03.png"))).toBe(true);

    const full = await build(dir);
    expect(byStatus(full, "removed")).toEqual(["en/android-phone/en_03.png", "tr/android-phone/tr_03.png"]);
    expect(existsSync(path.join(dir, "output/en/android-phone/en_03.png"))).toBe(false);
    expect(existsSync(path.join(dir, "output/tr/android-phone/tr_03.png"))).toBe(false);
    expect(Object.keys(readJson<{ files: object }>(path.join(dir, "output", MANIFEST_FILE)).files)).toHaveLength(4);
  }, 60000);

  it("never deletes files it did not produce", async () => {
    const dir = await makeProject({ languages: ["en"] });
    await build(dir);
    const mine = path.join(dir, "output/en/android-phone/notes.png");
    writeFileSync(mine, "not ours");
    writeConfig(dir, { ...baseConfig(), languages: ["en"], presets: ["ios-phone"] });
    const result = await build(dir);
    expect(result.removed).toBe(3);
    expect(readFileSync(mine, "utf8")).toBe("not ours");
  }, 60000);

  it("dry run reports the plan without writing anything", async () => {
    const dir = await makeProject();
    const dry = await build(dir, { dryRun: true });
    expect(dry.dryRun).toBe(true);
    expect(dry.rendered).toBe(6);
    expect(existsSync(path.join(dir, "output"))).toBe(false);
  });

  it("slices a panorama so neighbouring panels meet seamlessly", async () => {
    const dir = await makeProject({ languages: ["en"], background: "#000000", panorama: { to: "#FFFFFF" }, noGradient: true });
    await build(dir);
    const px = async (file: string, left: number) =>
      (await sharp(path.join(dir, "output/en/android-phone", file)).extract({ left, top: 5, width: 1, height: 1 }).raw().toBuffer())[0];
    const rightOf1 = await px("en_01.png", 1079);
    const leftOf2 = await px("en_02.png", 0);
    expect(Math.abs(rightOf1 - leftOf2)).toBeLessThanOrEqual(2);
    expect(await px("en_01.png", 0)).toBeLessThan(10);
    expect(await px("en_03.png", 1079)).toBeGreaterThan(245);
  }, 60000);

  it("builds showcase strips and the feature graphic, refreshing strips when a panel changes", async () => {
    const dir = await makeProject({ languages: ["en"], showcase: true, featureGraphic: { screen: 1 } });
    const first = await build(dir);
    expect(byStatus(first, "rendered")).toEqual([
      "en/android-phone/en_01.png",
      "en/android-phone/en_02.png",
      "en/android-phone/en_03.png",
      "en/play-feature-graphic/en_feature.png",
      "showcase/en_android-phone.png",
    ]);
    const feature = await sharp(path.join(dir, "output/en/play-feature-graphic/en_feature.png")).metadata();
    expect([feature.width, feature.height]).toEqual([1024, 500]);

    const config = { ...baseConfig(), languages: ["en"], showcase: true, featureGraphic: { screen: 1 } };
    (config.screens as { variant?: string }[])[2].variant = "tilted";
    writeConfig(dir, config);
    expect(byStatus(await build(dir), "rendered")).toEqual(["en/android-phone/en_03.png", "showcase/en_android-phone.png"]);
  }, 60000);

  it("recovers from a corrupt manifest by re-rendering", async () => {
    const dir = await makeProject({ languages: ["en"] });
    await build(dir);
    writeFileSync(path.join(dir, "output", MANIFEST_FILE), "{ not json");
    expect((await build(dir)).rendered).toBe(3);
  }, 60000);

  it("produces byte-identical output regardless of parallelism", async () => {
    const a = await makeProject();
    const b = await makeProject();
    await build(a, { jobs: 1 });
    await build(b, { jobs: 6 });
    for (const file of ["en/android-phone/en_01.png", "tr/android-phone/tr_03.png"]) {
      expect(readFileSync(path.join(a, "output", file)).equals(readFileSync(path.join(b, "output", file)))).toBe(true);
    }
  }, 60000);
});
