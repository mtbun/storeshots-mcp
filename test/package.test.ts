import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const json = (file: string) => JSON.parse(readFileSync(path.join(root, file), "utf8"));

describe("distribution metadata", () => {
  it("keeps every published version in sync", () => {
    const version = json("package.json").version;
    expect(json("server.json").version).toBe(version);
    expect(json("server.json").packages[0].version).toBe(version);
    expect(json(".claude-plugin/plugin.json").version).toBe(version);
  });

  it("ships the skill where the Claude Code plugin loader finds it", () => {
    const marketplace = json(".claude-plugin/marketplace.json");
    expect(marketplace.plugins).toEqual([expect.objectContaining({ name: "storeshots", source: "./" })]);
    const skill = readFileSync(path.join(root, "skills/storeshots/SKILL.md"), "utf8");
    expect(skill).toMatch(/^---\nname: storeshots\ndescription: .+\n---\n/);
  });

  it("publishes llms.txt with the package", () => {
    expect(existsSync(path.join(root, "llms.txt"))).toBe(true);
    expect(json("package.json").files).toContain("llms.txt");
  });
});
