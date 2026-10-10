import { writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ConfigError, loadPlan } from "../src/project/config.js";
import { baseConfig, makeProject, solidScreenshot, writeConfig } from "./helpers.js";

function issuesOf(fn: () => unknown): string[] {
  try {
    fn();
  } catch (err) {
    if (err instanceof ConfigError) return err.issues;
    throw err;
  }
  throw new Error("expected a ConfigError");
}

describe("loadPlan", () => {
  it("expands screens × presets × languages into numbered outputs", async () => {
    const dir = await makeProject({ presets: ["ios-phone", "android-phone"] });
    const plan = loadPlan(path.join(dir, "storeshots.json"));
    expect(plan.languages).toEqual(["en", "tr"]); // inferred from the first screen's copy
    expect(plan.images.map((i) => i.file)).toEqual([
      "en/ios-phone/en_01.png",
      "en/ios-phone/en_02.png",
      "en/ios-phone/en_03.png",
      "en/android-phone/en_01.png",
      "en/android-phone/en_02.png",
      "en/android-phone/en_03.png",
      "tr/ios-phone/tr_01.png",
      "tr/ios-phone/tr_02.png",
      "tr/ios-phone/tr_03.png",
      "tr/android-phone/tr_01.png",
      "tr/android-phone/tr_02.png",
      "tr/android-phone/tr_03.png",
    ]);
    expect(plan.outputDir).toBe(path.join(dir, "output"));
    expect(plan.complete).toBe(true);
  });

  it("accepts copy as a tuple or an object and resolves paths against the config", async () => {
    const dir = await makeProject();
    const plan = loadPlan(path.join(dir, "storeshots.json"));
    const [first, second] = plan.images;
    expect(first.compose).toMatchObject({ verb: "Track", descriptor: "your daily mood", lang: "en" });
    expect(second.compose).toMatchObject({ verb: "Discover", descriptor: "weekly insights" });
    expect(first.compose.screenshot).toBe(path.join(dir, "shots", "home.png"));
    expect(first.compose.background).toBe("#e31837");
  });

  it("fills {lang}, {preset} and {platform} in screenshot paths", async () => {
    const dir = await makeProject({
      presets: ["ios-phone", "android-phone"],
      languages: ["en"],
      screens: [{ screenshot: "shots/{platform}/{lang}/home-{preset}.png", copy: { en: ["Track", "your mood"] } }],
    });
    await solidScreenshot(path.join(dir, "shots/ios/en/home-ios-phone.png"), "#111111");
    await solidScreenshot(path.join(dir, "shots/android/en/home-android-phone.png"), "#222222");
    const plan = loadPlan(path.join(dir, "storeshots.json"));
    expect(plan.images.map((i) => path.relative(dir, i.compose.screenshot))).toEqual([
      path.join("shots", "ios", "en", "home-ios-phone.png"),
      path.join("shots", "android", "en", "home-android-phone.png"),
    ]);
  });

  it("picks per-preset screenshots with a default fallback", async () => {
    const dir = await makeProject({
      presets: ["ios-phone", "android-phone"],
      languages: ["en"],
      screens: [
        {
          screenshot: { "android-phone": "shots/stats.png", default: "shots/home.png" },
          copy: { en: ["Track", "your mood"] },
        },
      ],
    });
    const plan = loadPlan(path.join(dir, "storeshots.json"));
    expect(plan.images.map((i) => path.basename(i.compose.screenshot))).toEqual(["home.png", "stats.png"]);
  });

  it("collects every problem at once with a path to each", async () => {
    const dir = await makeProject({
      background: "red",
      presets: ["ios-phone", "ios-mega", "play-feature-graphic"],
      screens: [
        { screenshot: "shots/home.png", copy: { en: ["Track", "your mood"], tr: ["TODO", "TODO"] } },
        { screenshot: "shots/missing.png", copy: { en: ["Plan", "your week"] } },
      ],
    });
    const issues = issuesOf(() => loadPlan(path.join(dir, "storeshots.json")));
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^background: Invalid hex color "red"/),
        expect.stringMatching(/^presets\[1\]: unknown preset "ios-mega"/),
        expect.stringMatching(/^presets\[2\]: .*add a "featureGraphic" section/),
        expect.stringMatching(/^screens\[0\]\.copy\.tr: still has a TODO placeholder/),
        expect.stringMatching(/^screens\[1\]\.copy\.tr: missing/),
        expect.stringMatching(/^screens\[1\]\.screenshot: file not found: shots\/missing\.png/),
      ]),
    );
  });

  it("reports schema errors with the offending field path", async () => {
    const dir = await makeProject();
    writeConfig(dir, { ...baseConfig(), variant: "sideways", colour: "#fff" });
    const issues = issuesOf(() => loadPlan(path.join(dir, "storeshots.json")));
    expect(issues.join("\n")).toMatch(/variant: Invalid enum value.*text-top/);
    expect(issues.join("\n")).toMatch(/Unrecognized key\(s\) in object: 'colour'/);

    writeConfig(dir, { ...baseConfig(), screens: [{ screenshot: "shots/home.png", copy: { en: ["only verb"] } }] });
    expect(issuesOf(() => loadPlan(path.join(dir, "storeshots.json")))[0]).toMatch(/^screens\[0\]\.copy\.en/);
  });

  it("explains missing and malformed config files", async () => {
    const dir = await makeProject();
    expect(issuesOf(() => loadPlan(path.join(dir, "nope.json")))[0]).toMatch(/storeshots init/);
    writeFileSync(path.join(dir, "broken.json"), "{ background: ");
    expect(issuesOf(() => loadPlan(path.join(dir, "broken.json")))[0]).toMatch(/Not valid JSON/);
  });

  it("rejects per-screen backgrounds combined with a panorama", async () => {
    const dir = await makeProject({ panorama: { to: "#1E3A8A" } });
    const config = { ...baseConfig(), panorama: { to: "#1E3A8A" } };
    (config.screens as Record<string, unknown>[])[1].background = "#000000";
    writeConfig(dir, config);
    expect(issuesOf(() => loadPlan(path.join(dir, "storeshots.json"))).join(" ")).toMatch(/cannot be combined with "panorama"/);
  });

  it("attaches panorama slice info to every panel", async () => {
    const dir = await makeProject({ panorama: { to: "#1E3A8A" } });
    const plan = loadPlan(path.join(dir, "storeshots.json"), { langs: ["en"] });
    expect(plan.images.map((i) => i.panorama)).toEqual([0, 1, 2].map((index) => ({ from: "#e31837", to: "#1e3a8a", count: 3, index })));
  });

  it("narrows the plan with language and preset filters", async () => {
    const dir = await makeProject({ presets: ["ios-phone", "android-phone"] });
    const plan = loadPlan(path.join(dir, "storeshots.json"), { langs: ["tr"], presets: ["ios-phone"] });
    expect(plan.images.map((i) => i.file)).toEqual(["tr/ios-phone/tr_01.png", "tr/ios-phone/tr_02.png", "tr/ios-phone/tr_03.png"]);
    expect(plan.complete).toBe(false);
    expect(issuesOf(() => loadPlan(path.join(dir, "storeshots.json"), { langs: ["de"] }))[0]).toMatch(/--lang de: not in this config's languages \(en, tr\)/);
  });

  it("builds a feature graphic per language from a referenced screen", async () => {
    const dir = await makeProject({ featureGraphic: { screen: 2, background: "#101010" } });
    const plan = loadPlan(path.join(dir, "storeshots.json"));
    const features = plan.images.filter((i) => i.kind === "feature");
    expect(features.map((f) => f.file)).toEqual([
      "en/play-feature-graphic/en_feature.png",
      "tr/play-feature-graphic/tr_feature.png",
    ]);
    expect(features[1].compose).toMatchObject({ verb: "Keşfet", background: "#101010", preset: "play-feature-graphic" });
    expect(loadPlan(path.join(dir, "storeshots.json"), { presets: ["play-feature-graphic"] }).images).toHaveLength(2);

    writeConfig(dir, { ...baseConfig(), featureGraphic: { screen: 9 } });
    expect(issuesOf(() => loadPlan(path.join(dir, "storeshots.json")))[0]).toMatch(/there is no screen 9 \(have 3\)/);
  });

  it("applies a single custom frame to every preset, or one per preset", async () => {
    const dir = await makeProject();
    await solidScreenshot(path.join(dir, "frames", "phone.png"), "#000000", 600, 1200);
    writeConfig(dir, {
      ...baseConfig(),
      frame: { image: "frames/phone.png", screenX: 40, screenY: 40, screenWidth: 520, screenHeight: 1120 },
    });
    const plan = loadPlan(path.join(dir, "storeshots.json"));
    expect(plan.images[0].compose.frame?.image).toBe(path.join(dir, "frames", "phone.png"));
    expect(plan.inputs).toContain(path.join(dir, "frames", "phone.png"));

    writeConfig(dir, { ...baseConfig(), frame: { "ios-phonee": { image: "frames/phone.png", screenX: 0, screenY: 0, screenWidth: 1, screenHeight: 1 } } });
    expect(issuesOf(() => loadPlan(path.join(dir, "storeshots.json")))[0]).toMatch(/frame\.ios-phonee: unknown preset id/);
  });
});
