#!/usr/bin/env node
import { parseArgs } from "node:util";
import { PRESETS } from "./presets.js";
import { composeScreenshot } from "./render/compose.js";
import { createShowcase } from "./render/showcase.js";
import { validateScreenshot } from "./render/validate.js";

const USAGE = `storeshots <command>

Commands:
  presets                       List platform presets and dimensions
  compose                       Render one marketing screenshot
    --preset <id>               ios-phone | android-phone | ipad-13 | android-tablet
    --bg <hex>                  Background color, e.g. "#E31837"
    --verb <text>               Headline action word
    --desc <text>               Headline descriptor
    --screenshot <path>         Raw app screenshot
    --output <path>             Output PNG path
    [--lang <code>]             Language for uppercasing (default en)
    [--no-gradient]             Disable background gradient
  showcase                      Compose a preview strip
    --output <path>             Output PNG path
    [--height <px>]             Item height (default 1200)
    <inputs...>                 Generated screenshots in order
  validate                      Check an image against store requirements
    [--preset <id>]             Validate against a specific preset
    <file>

Runs fully offline. The MCP server variant is \`storeshots-mcp\`.`;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function required(values: Record<string, unknown>, key: string): string {
  const v = values[key];
  if (typeof v !== "string" || v.length === 0) fail(`Missing required option --${key}\n\n${USAGE}`);
  return v;
}

const [command, ...rest] = process.argv.slice(2);

try {
  switch (command) {
    case "presets": {
      for (const p of Object.values(PRESETS)) {
        console.log(`${p.id.padEnd(16)} ${String(p.width).padStart(4)}x${p.height}  ${p.label}`);
      }
      break;
    }
    case "compose": {
      const { values } = parseArgs({
        args: rest,
        options: {
          preset: { type: "string" },
          bg: { type: "string" },
          verb: { type: "string" },
          desc: { type: "string" },
          screenshot: { type: "string" },
          output: { type: "string" },
          lang: { type: "string", default: "en" },
          "no-gradient": { type: "boolean", default: false },
        },
      });
      const result = await composeScreenshot({
        preset: required(values, "preset"),
        background: required(values, "bg"),
        verb: required(values, "verb"),
        descriptor: required(values, "desc"),
        screenshot: required(values, "screenshot"),
        output: required(values, "output"),
        lang: values.lang,
        noGradient: values["no-gradient"],
      });
      console.log(JSON.stringify(result, null, 2));
      break;
    }
    case "showcase": {
      const { values, positionals } = parseArgs({
        args: rest,
        options: {
          output: { type: "string" },
          height: { type: "string" },
          bg: { type: "string" },
        },
        allowPositionals: true,
      });
      const result = await createShowcase({
        inputs: positionals,
        output: required(values, "output"),
        itemHeight: values.height ? Number(values.height) : undefined,
        background: values.bg,
      });
      console.log(JSON.stringify(result, null, 2));
      break;
    }
    case "validate": {
      const { values, positionals } = parseArgs({
        args: rest,
        options: { preset: { type: "string" } },
        allowPositionals: true,
      });
      if (positionals.length !== 1) fail(`validate expects exactly one file\n\n${USAGE}`);
      const result = await validateScreenshot(positionals[0], values.preset);
      console.log(JSON.stringify(result, null, 2));
      process.exit(result.valid ? 0 : 1);
      break;
    }
    case undefined:
    case "help":
    case "--help":
      console.log(USAGE);
      break;
    default:
      fail(`Unknown command "${command}"\n\n${USAGE}`);
  }
} catch (err) {
  fail(`Error: ${err instanceof Error ? err.message : String(err)}`);
}
