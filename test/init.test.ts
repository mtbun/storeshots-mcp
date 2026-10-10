import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ConfigError, loadPlan } from "../src/project/config.js";
import { initProject } from "../src/project/init.js";
import { readJson, solidScreenshot, tempDir } from "./helpers.js";

describe("initProject", () => {
  it("finds a screenshots folder and lists images in natural order", async () => {
    const dir = tempDir();
    for (const name of ["10-settings.png", "2-stats.jpg", "1-home.png"]) {
      await solidScreenshot(path.join(dir, "screenshots", name), "#2b6cb0", 100, 200);
    }
    const result = initProject({ configPath: path.join(dir, "storeshots.json"), languages: ["en", "tr"], background: "e31837" });
    expect(result.screens).toBe(3);
    expect(result.screensDir).toBe(path.join(dir, "screenshots"));
    const config = readJson<{ background: string; languages: string[]; screens: { screenshot: string; copy: object }[] }>(
      result.configPath,
    );
    expect(config.background).toBe("#E31837");
    expect(config.screens.map((s) => s.screenshot)).toEqual([
      "screenshots/1-home.png",
      "screenshots/2-stats.jpg",
      "screenshots/10-settings.png",
    ]);
    expect(Object.keys(config.screens[0].copy)).toEqual(["en", "tr"]);
  });

  it("writes placeholders that the build refuses until they are replaced", async () => {
    const dir = tempDir();
    await solidScreenshot(path.join(dir, "raw", "a.png"), "#2b6cb0", 100, 200);
    const { configPath } = initProject({ configPath: path.join(dir, "storeshots.json"), screensDir: path.join(dir, "raw") });
    expect(() => loadPlan(configPath)).toThrowError(/TODO placeholder/);
  });

  it("falls back to example paths when no screenshots are found", () => {
    const dir = tempDir();
    const result = initProject({ configPath: path.join(dir, "storeshots.json") });
    expect(result.screensDir).toBeNull();
    expect(readJson<{ screens: { screenshot: string }[] }>(result.configPath).screens[0].screenshot).toBe("screenshots/01.png");
  });

  it("caps a set at the store limit of 10 screens", async () => {
    const dir = tempDir();
    for (let i = 1; i <= 12; i++) await solidScreenshot(path.join(dir, "shots", `${i}.png`), "#2b6cb0", 50, 100);
    const result = initProject({ configPath: path.join(dir, "storeshots.json") });
    expect(result.screens).toBe(10);
    expect(result.skipped).toBe(2);
  });

  it("refuses to clobber an existing config unless forced, and validates options", () => {
    const dir = tempDir();
    const configPath = path.join(dir, "storeshots.json");
    initProject({ configPath });
    expect(() => initProject({ configPath })).toThrowError(ConfigError);
    expect(() => initProject({ configPath, force: true })).not.toThrow();

    try {
      initProject({ configPath: path.join(dir, "other.json"), presets: ["ios-mega", "play-feature-graphic"], background: "red" });
      throw new Error("expected failure");
    } catch (err) {
      expect((err as ConfigError).issues).toEqual([
        expect.stringMatching(/unknown preset "ios-mega"/),
        expect.stringMatching(/configured via "featureGraphic"/),
        expect.stringMatching(/--bg: Invalid hex color/),
      ]);
    }
    expect(existsSync(path.join(dir, "other.json"))).toBe(false);
  });
});
