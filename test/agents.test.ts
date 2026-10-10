import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runCli } from "../src/cli/run.js";
import { AGENTS_END, AGENTS_START, writeAgentInstructions } from "../src/project/agents.js";
import { initProject } from "../src/project/init.js";
import { tempDir } from "./helpers.js";

const read = (dir: string, file: string) => readFileSync(path.join(dir, file), "utf8");
const count = (text: string, needle: string) => text.split(needle).length - 1;

describe("agent instruction files", () => {
  it("creates AGENTS.md and a CLAUDE.md that imports it when neither exists", () => {
    const dir = tempDir();
    const results = writeAgentInstructions(dir, "storeshots.json");
    expect(results.map((r) => [path.basename(r.file), r.action])).toEqual([
      ["AGENTS.md", "created"],
      ["CLAUDE.md", "created"],
    ]);
    expect(read(dir, "CLAUDE.md")).toBe("@AGENTS.md\n");
    const agents = read(dir, "AGENTS.md");
    expect(agents).toContain("storeshots build");
    expect(agents).toContain("`storeshots.json`");
  });

  it("appends to existing files without touching their content", () => {
    const dir = tempDir();
    writeFileSync(path.join(dir, "CLAUDE.md"), "# My app\n\nUse pnpm.");
    const results = writeAgentInstructions(dir, "storeshots.json");
    expect(results.map((r) => [path.basename(r.file), r.action])).toEqual([["CLAUDE.md", "updated"]]);
    const claude = read(dir, "CLAUDE.md");
    expect(claude.startsWith("# My app\n\nUse pnpm.\n\n<!-- storeshots:start -->")).toBe(true);
  });

  it("writes only AGENTS.md when CLAUDE.md already imports it", () => {
    const dir = tempDir();
    writeFileSync(path.join(dir, "CLAUDE.md"), "@AGENTS.md\n");
    const results = writeAgentInstructions(dir, "storeshots.json");
    expect(results.map((r) => path.basename(r.file))).toEqual(["AGENTS.md"]);
    expect(read(dir, "CLAUDE.md")).toBe("@AGENTS.md\n");
  });

  it("updates both files when they are independent", () => {
    const dir = tempDir();
    writeFileSync(path.join(dir, "AGENTS.md"), "# Agents\n");
    writeFileSync(path.join(dir, "CLAUDE.md"), "# Claude\n");
    expect(writeAgentInstructions(dir, "storeshots.json").map((r) => r.action)).toEqual(["updated", "updated"]);
  });

  it("replaces its own section on rerun instead of duplicating it", () => {
    const dir = tempDir();
    writeFileSync(path.join(dir, "AGENTS.md"), "# Agents\n\nBefore.\n");
    writeAgentInstructions(dir, "storeshots.json");
    writeFileSync(path.join(dir, "AGENTS.md"), `${read(dir, "AGENTS.md")}\nAfter.\n`);

    expect(writeAgentInstructions(dir, "storeshots.json")[0].action).toBe("unchanged");
    writeAgentInstructions(dir, "store/listing.json");
    const agents = read(dir, "AGENTS.md");
    expect(count(agents, AGENTS_START)).toBe(1);
    expect(count(agents, AGENTS_END)).toBe(1);
    expect(agents).toContain("storeshots build -c store/listing.json");
    expect(agents).toMatch(/^# Agents\n\nBefore\.\n/);
    expect(agents).toMatch(/After\.\n$/);
  });

  it("init writes them by default, relative to the project root", () => {
    const dir = tempDir();
    const result = initProject({ configPath: path.join(dir, "store", "storeshots.json"), projectDir: dir });
    expect(result.agentFiles.map((f) => path.relative(dir, f.file))).toEqual(["AGENTS.md", "CLAUDE.md"]);
    expect(read(dir, "AGENTS.md")).toContain("`store/storeshots.json`");

    const quiet = tempDir();
    expect(initProject({ configPath: path.join(quiet, "storeshots.json"), agents: false }).agentFiles).toEqual([]);
  });

  it("CLI: init reports the files, --no-agents skips them, --agents-only refreshes them", async () => {
    const run = async (cwd: string, ...argv: string[]) => {
      let out = "";
      const code = await runCli(argv, { cwd, stdout: (t) => (out += t), stderr: (t) => (out += t) });
      return { code, out };
    };
    const dir = tempDir();
    const init = await run(dir, "init");
    expect(init.out).toMatch(/✓ Created AGENTS\.md\n✓ Created CLAUDE\.md \(imports AGENTS\.md\)/);

    const skip = tempDir();
    await run(skip, "init", "--no-agents");
    expect(() => read(skip, "AGENTS.md")).toThrow();

    const only = await run(skip, "init", "--agents-only");
    expect(only.code).toBe(0);
    expect(only.out).toMatch(/Created AGENTS\.md/);
    expect((await run(skip, "init", "--agents-only")).out).toMatch(/· Up to date: AGENTS\.md/);
    expect((await run(skip, "init", "--agents-only", "--no-agents")).code).toBe(2);
  });
});
