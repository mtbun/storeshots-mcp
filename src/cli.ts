#!/usr/bin/env node
import { createInterface } from "node:readline/promises";
import { runCli } from "./cli/run.js";

const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY);
const color = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;

async function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await rl.question(question);
  } finally {
    rl.close();
  }
}

process.exitCode = await runCli(process.argv.slice(2), { color, prompt: interactive ? prompt : undefined });
