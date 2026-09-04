#!/usr/bin/env node
/**
 * Render the app icon and the favicon from one drawing.
 *
 * The dial is the same rose the sidebar shows, with the detail a 512px icon can
 * afford — an outer hairline, cardinal marks, a lit needle. Everything outside
 * the rounded plate is transparent: the plate *is* the icon, and a black square
 * behind it would show up as a box on every dock and taskbar.
 *
 *   node scripts/make-icon.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

const PLATE = "#12161a";
const PLATE_EDGE = "#39424b";
const LIGHT = "#eef2f5";
const MID = "#98a4ae";
const DIM = "#5b6771";
const OK = "#00ba7c";
const WARN = "#ffad1f";
const CRIT = "#f4212e";

/** @param {{plate: boolean, detail: boolean}} opts */
function rose({ plate, detail }) {
  const ink = plate ? LIGHT : "#0f1419";
  const soft = plate ? MID : "#5b6771";
  return `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64" fill="none">
  ${
    plate
      ? `<rect x="1.5" y="1.5" width="61" height="61" rx="14" fill="${PLATE}" stroke="${PLATE_EDGE}" stroke-width="1.2"/>`
      : ""
  }
  ${
    detail
      ? `<circle cx="32" cy="32" r="25" stroke="${DIM}" stroke-opacity="0.85" stroke-width="0.9"/>
         <path d="M32 4.6V9M32 55V59.4M4.6 32H9M55 32H59.4" stroke="${DIM}" stroke-opacity="0.85" stroke-width="0.9" stroke-linecap="round"/>`
      : ""
  }

  <path d="M38.67 13.67 A19.5 19.5 0 0 1 38.67 50.33" stroke="${ink}" stroke-opacity="0.92" stroke-width="5" stroke-linecap="round"/>
  <path d="M25.33 50.33 A19.5 19.5 0 0 1 25.33 13.67" stroke="${ink}" stroke-opacity="0.92" stroke-width="5" stroke-linecap="round"/>

  <path d="M11 32 32 28.7 53 32 32 35.3Z" fill="${soft}" fill-opacity="0.55"/>
  <path d="M32 4.5 32 59.5 27.5 32Z" fill="${ink}"/>
  <path d="M32 4.5 36.5 32 32 59.5Z" fill="${ink}" fill-opacity="0.55"/>
  <circle cx="32" cy="32" r="3.8" fill="${plate ? "#0a0d10" : "#0f1419"}"/>
  ${plate ? `<circle cx="32" cy="32" r="3.8" stroke="${MID}" stroke-opacity="0.5" stroke-width="0.8"/>` : ""}

  <circle cx="45.79" cy="18.21" r="2.2" fill="${WARN}"/>
  <circle cx="18.21" cy="18.21" r="2.2" fill="${CRIT}"/>
  <circle cx="45.79" cy="45.79" r="2.2" fill="${OK}"/>
</svg>`.trim();
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 512, height: 512 } });

const icon = rose({ plate: true, detail: true });
await page.setContent(
  `<body style="margin:0"><div style="width:512px;height:512px">${icon.replace(
    'width="64" height="64"',
    'width="512" height="512"',
  )}</div></body>`,
);
mkdirSync(join(root, "build"), { recursive: true });
await page.screenshot({ path: join(root, "build/icon.png"), omitBackground: true });
await browser.close();

// The favicon is flat and plate-less; a 16px rounded square is just mud.
writeFileSync(
  join(root, "public/favicon.svg"),
  rose({ plate: false, detail: false }).replace(
    '<svg xmlns="http://www.w3.org/2000/svg"',
    '<svg xmlns="http://www.w3.org/2000/svg"',
  ) + "\n",
  "utf8",
);

console.log("build/icon.png and public/favicon.svg written");
