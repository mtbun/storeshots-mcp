// Regenerates the demo set and the README showcase (assets/showcase.png).
// Usage: npm run build && node scripts/make-demo.mjs
import { mkdirSync } from "node:fs";
import sharp from "sharp";
import { composeScreenshot } from "../dist/render/compose.js";
import { createShowcase } from "../dist/render/showcase.js";

mkdirSync("demo/raw", { recursive: true });

const W = 1320;
const H = 2868;
const screens = [
  { file: "demo/raw/home.png", accent: "#5b5bd6" },
  { file: "demo/raw/stats.png", accent: "#e5484d" },
  { file: "demo/raw/plan.png", accent: "#30a46c" },
];

for (const [i, s] of screens.entries()) {
  const bars = Array.from({ length: 7 }, (_, k) => {
    const h = 200 + ((k * 137 + i * 61) % 500);
    return `<rect x="${180 + k * 140}" y="${1500 - h}" width="90" height="${h}" rx="24" fill="${s.accent}" opacity="${0.45 + 0.08 * k}"/>`;
  }).join("");
  const cards = Array.from({ length: 3 }, (_, k) =>
    `<rect x="120" y="${1700 + k * 340}" width="${W - 240}" height="280" rx="40" fill="#ffffff"/>
     <rect x="180" y="${1760 + k * 340}" width="160" height="160" rx="32" fill="${s.accent}" opacity="0.25"/>
     <rect x="400" y="${1790 + k * 340}" width="520" height="44" rx="22" fill="#d9d9e3"/>
     <rect x="400" y="${1860 + k * 340}" width="360" height="36" rx="18" fill="#e8e8f0"/>`,
  ).join("");
  const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${W}" height="${H}" fill="#f7f7fa"/>
    <rect width="${W}" height="380" fill="${s.accent}"/>
    <rect x="120" y="180" width="640" height="72" rx="36" fill="#ffffff" opacity="0.9"/>
    <rect x="120" y="520" width="${W - 240}" height="1100" rx="48" fill="#ffffff"/>
    ${bars}
    ${cards}
    <rect x="0" y="${H - 220}" width="${W}" height="220" fill="#ffffff"/>
    ${[0, 1, 2, 3].map((k) => `<circle cx="${260 + k * 270}" cy="${H - 110}" r="44" fill="${k === i ? s.accent : "#d9d9e3"}"/>`).join("")}
  </svg>`;
  await sharp(Buffer.from(svg)).png().toFile(s.file);
}

const shots = [
  { preset: "ios-phone", background: "#5B5BD6", verb: "track", descriptor: "your daily habits", screenshot: "demo/raw/home.png", output: "demo/out/en_01.png" },
  { preset: "ios-phone", background: "#E5484D", verb: "discover", descriptor: "weekly insights", screenshot: "demo/raw/stats.png", output: "demo/out/en_02.png" },
  { preset: "ios-phone", background: "#30A46C", verb: "plan", descriptor: "your best week", screenshot: "demo/raw/plan.png", output: "demo/out/en_03.png" },
  { preset: "android-phone", background: "#131316", verb: "izle", descriptor: "günlük ilerlemeni", screenshot: "demo/raw/stats.png", output: "demo/out/tr_01.png", lang: "tr" },
];
for (const shot of shots) {
  const result = await composeScreenshot(shot);
  console.log(`${result.output}  ${result.width}x${result.height}  "${result.headline}"`);
}

const showcase = await createShowcase({
  inputs: shots.map((s) => s.output),
  output: "assets/showcase.png",
  itemHeight: 1000,
});
console.log(`showcase: ${showcase.output}  ${showcase.width}x${showcase.height}`);
