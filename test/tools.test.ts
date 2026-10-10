import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { ALL_TOOLS } from "../src/tools/definitions.js";
import { makeProject, solidScreenshot, tempDir } from "./helpers.js";

const tool = (name: string) => {
  const t = ALL_TOOLS.find((t) => t.name === name);
  if (!t) throw new Error(`no tool ${name}`);
  return t;
};

describe("MCP tools", () => {
  it("exposes the same surface as the CLI", () => {
    expect(ALL_TOOLS.map((t) => t.name)).toEqual([
      "list_presets",
      "compose_screenshot",
      "generate_set",
      "create_showcase",
      "validate_screenshot",
      "build_project",
    ]);
  });

  it("generate_set renders a numbered set through the shared core", async () => {
    const dir = tempDir();
    const shot = await solidScreenshot(path.join(dir, "raw.png"), "#2b6cb0");
    const result = (await tool("generate_set").handler({
      preset: "android-phone",
      background: "#000000",
      lang: "de",
      outputDir: path.join(dir, "set"),
      panorama: { to: "#FFFFFF" },
      items: [
        { verb: "plane", descriptor: "deine woche", screenshot: shot },
        { verb: "sieh", descriptor: "deinen überblick", screenshot: shot, variant: "text-bottom" },
      ],
    })) as { count: number; panorama: boolean; results: { output: string; headline: string; variant: string }[] };
    expect(result.count).toBe(2);
    expect(result.panorama).toBe(true);
    expect(result.results.map((r) => path.basename(r.output))).toEqual(["de_01.png", "de_02.png"]);
    expect(result.results[1]).toMatchObject({ headline: "SIEH DEINEN ÜBERBLICK", variant: "text-bottom" });
    const meta = await sharp(result.results[0].output).metadata();
    expect([meta.width, meta.height]).toEqual([1080, 1920]);
  }, 30000);

  it("rejects bad input with actionable messages", async () => {
    await expect(tool("generate_set").handler({ preset: "ios-mega", background: "#000000", outputDir: "x", items: [] })).rejects.toThrow(
      /ios-phone/,
    );
    await expect(
      tool("compose_screenshot").handler({
        preset: "ios-phone",
        background: "crimson",
        verb: "a",
        descriptor: "b",
        screenshot: "x.png",
        output: "y.png",
      }),
    ).rejects.toThrow(/6-digit hex/);
  });

  it("build_project builds a config and reports per-file status", async () => {
    const dir = await makeProject({ languages: ["en"] });
    const run = (args: Record<string, unknown>) =>
      tool("build_project").handler({ config: path.join(dir, "storeshots.json"), ...args }) as Promise<{
        rendered: number;
        unchanged: number;
        items: { file: string; status: string }[];
      }>;
    expect((await run({ dryRun: true })).rendered).toBe(3);
    expect((await run({})).rendered).toBe(3);
    const again = await run({});
    expect(again.unchanged).toBe(3);
    expect(again.items.every((i) => i.status === "unchanged")).toBe(true);
    await expect(run({ langs: ["fr"] })).rejects.toThrow(/--lang fr: not in this config/);
  }, 30000);
});
