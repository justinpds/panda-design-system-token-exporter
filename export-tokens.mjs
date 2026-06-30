#!/usr/bin/env node
/**
 * export-tokens.mjs
 *
 * Exports design tokens from three Notion databases (Primitive, Semantic,
 * Component) into two JSON files:
 *
 *   1. tokens.dtcg.json  — Full DTCG-compliant output with alias references
 *                          and DTCG type names. For Tokens Studio / Style
 *                          Dictionary / other DTCG-aware tooling.
 *
 *   2. tokens.figma.json — Figma Variables-friendly output with all aliases
 *                          resolved to final raw values, units stripped from
 *                          dimensions, and only Figma-compatible types
 *                          (color, number, string, boolean).
 *
 * Usage:
 *   NOTION_TOKEN=secret_xxx node export-tokens.mjs [flags]
 *
 * Flags:
 *   --approved-only   Only export tokens whose Status is "Approved"
 *   --out-dtcg <p>    DTCG output path     (default: tokens.dtcg.json)
 *   --out-figma <p>   Figma output path     (default: tokens.figma.json)
 *   --dtcg-only       Skip Figma output
 *   --figma-only      Skip DTCG output
 *   --dry-run         Print summary without writing files
 */

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

// ─── Configuration ────────────────────────────────────────────────────────────────

const DB_IDS = {
  primitive: "2726f5855b4681ed92b3f29a5d9f89a3",
  semantic:  "2726f5855b4681c7b24ccbdd303360b2",
  component: "2726f5855b468146b7c2e5e4ca56a669",
};

// Map token-name prefixes/paths → DTCG $type values.
// More specific paths are checked first (longest match wins).
const TYPE_MAP = {
  "font.size": "number",
  "font.weight": "fontWeight",
  "font.family": "fontFamily",
  "font.letter-spacing": "dimension",
  "font.line-height": "number",
  color: "color",
  overlay: "color",
  dimension: "dimension",
  radius: "dimension",
  stroke: "dimension",
  spacing: "dimension",
  opacity: "number",
};

// DTCG type → Figma Variables type
const FIGMA_TYPE_MAP = {
  color:      "color",
  number:     "number",
  dimension:  "number",
  fontFamily: "string",
  fontWeight: "number",
};

// ─── CLI parsing ──────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt  = (name, fallback) => {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
};

const approvedOnly = flag("--approved-only");
const dryRun       = flag("--dry-run");
const dtcgOnly     = flag("--dtcg-only");
const figmaOnly    = flag("--figma-only");
const outDtcg      = resolve(opt("--out-dtcg",  "tokens.dtcg.json"));
const outFigma     = resolve(opt("--out-figma", "tokens.figma.json"));

const NOTION_TOKEN = process.env.NOTION_TOKEN;
if (!NOTION_TOKEN) {
  console.error("Error: NOTION_TOKEN environment variable is required.");
  console.error("Create an internal integration at https://www.notion.so/my-integrations");
  process.exit(1);
}

// ─── Notion API helpers ─────────────────────────────────────────────────────────────

const NOTION_API = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";

async function notionFetch(path, body) {
  const res = await fetch(`${NOTION_API}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${NOTION_TOKEN}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Notion API ${res.status}: ${text}`);
  }
  return res.json();
}

async function queryAllPages(databaseId) {
  const pages = [];
  let cursor = undefined;
  const filter = {
    and: [{ property: "Generate", checkbox: { equals: true } }],
  };
  if (approvedOnly) {
    filter.and.push({ property: "Status", select: { equals: "Approved" } });
  }
  while (true) {
    const body = { page_size: 100, filter };
    if (cursor) body.start_cursor = cursor;
    const data = await notionFetch(`/databases/${databaseId}/query`, body);
    pages.push(...data.results);
    if (!data.has_more) break;
    cursor = data.next_cursor;
  }
  return pages;
}

// ─── Property extraction ────────────────────────────────────────────────────────────

function getTitle(page) {
  const p = page.properties["Generated Token Name"];
  return p?.type === "title" ? p.title.map((t) => t.plain_text).join("") : "";
}

function getText(page, name) {
  const p = page.properties[name];
  if (!p) return "";
  if (p.type === "rich_text") return p.rich_text.map((t) => t.plain_text).join("");
  if (p.type === "title")     return p.title.map((t) => t.plain_text).join("");
  return "";
}

function getRelationIds(page, name) {
  const p = page.properties[name];
  return p?.type === "relation" ? p.relation.map((r) => r.id) : [];
}

function getRollup(page, name) {
  const p = page.properties[name];
  if (!p || p.type !== "rollup") return "";
  const r = p.rollup;
  if (r.type === "array" && r.array.length > 0) {
    const first = r.array[0];
    if (first.type === "rich_text") return first.rich_text.map((t) => t.plain_text).join("");
    if (first.type === "title")     return first.title.map((t) => t.plain_text).join("");
    if (first.type === "formula")   return first.formula.string ?? String(first.formula.number ?? "");
  }
  return "";
}

// ─── Type inference & value normalization ────────────────────────────────────────────

function inferDtcgType(tokenName, rawValue) {
  const segments = tokenName.split(".");
  // Check longest prefix first so "font.size" beats "font"
  for (let i = segments.length; i > 0; i--) {
    const key = segments.slice(0, i).join(".");
    if (DTCG_TYPE_MAP[key]) return DTCG_TYPE_MAP[key];
  }

  // Fallback heuristics on the raw value
  if (typeof rawValue === "string") {
    if (/^#[0-9a-fA-F]{3,8}$/.test(rawValue)) return "color";
    if (/^rgba?\(/.test(rawValue)) return "color";
    if (/^hsla?\(/.test(rawValue)) return "color";
    if (/^\d+,\s*\d+,\s*\d+,\s*[\d.]+$/.test(rawValue)) return "color";
    if (/^\d+(\.\d+)?(px|rem|em|pt|%)$/.test(rawValue)) return "dimension";
    if (/^\d+(\.\d+)?$/.test(rawValue)) return "number";
  }
  return undefined;
}

/**
 * Normalize raw values from Notion into DTCG-compliant formats.
 * E.g. comma-separated RGBA "48, 22, 22, 0.5" → "rgba(48, 22, 22, 0.5)"
 */
function normalizeValue(value, type) {
  if (type === "color" && /^\d+,\s*\d+,\s*\d+,\s*[\d.]+$/.test(value)) {
    return `rgba(${value})`;
  }
  return value;
}

// ─── Nest a flat dot-path into a deep object ────────────────────────────────

function setNested(obj, dottedKey, leaf) {
  const parts = dottedKey.split(".");
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i];
    if (!(k in cur) || typeof cur[k] !== "object" || cur[k].$value !== undefined) {
      cur[k] = {};
    }
    cur = cur[k];
  }
  cur[parts.at(-1)] = leaf;
}

function countLeaves(obj) {
  let n = 0;
  for (const v of Object.values(obj)) {
    if (v && typeof v === "object" && "$value" in v) n++;
    else if (v && typeof v === "object") n += countLeaves(v);
  }
  return n;
}

// ─── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  console.log("Fetching Primitive tokens\u2026");
  const primitivePages = await queryAllPages(DB_IDS.primitive);
  console.log(`  \u2192 ${primitivePages.length} primitives`);

  console.log("Fetching Semantic tokens\u2026");
  const semanticPages = await queryAllPages(DB_IDS.semantic);
  console.log(`  \u2192 ${semanticPages.length} semantics`);

  console.log("Fetching Component tokens\u2026");
  const componentPages = await queryAllPages(DB_IDS.component);
  console.log(`  \u2192 ${componentPages.length} components`);

  // 1. Build primitive lookup
  const primitiveLookup = new Map();
  for (const page of primitivePages) {
    const name  = getTitle(page);
    const value = getText(page, "Value");
    if (!name) continue;
    primitiveLookup.set(page.id, { name, value });
  }

  // 2. Build semantic lookup
  const semanticLookup = new Map();
  for (const page of semanticPages) {
    const name = getTitle(page);
    if (!name) continue;
    const relIds = getRelationIds(page, "Value");
    let primitiveRef = null;
    let resolvedValue = null;
    if (relIds.length > 0) {
      const prim = primitiveLookup.get(relIds[0]);
      if (prim) {
        primitiveRef  = prim.name;
        resolvedValue = prim.value;
      }
    }
    if (!resolvedValue) {
      resolvedValue = getRollup(page, "Primitive Value") || null;
    }
    semanticLookup.set(page.id, { name, primitiveRef, resolvedValue });
  }

  // 3. Build both token trees
  const dtcg  = {};
  const figma = {};

  // --- Primitives ---
  for (const page of primitivePages) {
    const name  = getTitle(page);
    const value = getText(page, "Value");
    const desc  = getText(page, "Description");
    if (!name || !value) continue;

    const type = inferType(name, value);
    const leaf = { $value: normalizeValue(value, type) };
    if (type) leaf.$type = type;
    if (description) leaf.$description = description;

    const dtcgLeaf = { $value: normalizeDtcg(value, dtcgType) };
    if (dtcgType) dtcgLeaf.$type = dtcgType;
    if (desc) dtcgLeaf.$description = desc;

    const figmaLeaf = { $value: normalizeFigma(value, dtcgType) };
    if (figmaType) figmaLeaf.$type = figmaType;
    if (desc) figmaLeaf.$description = desc;

    setNested(dtcg, name, dtcgLeaf);
    setNested(figma, name, figmaLeaf);
  }

  // --- Semantics ---
  for (const page of semanticPages) {
    const name = getTitle(page);
    if (!name) continue;

    const relIds = getRelationIds(page, "Value");
    const desc   = getText(page, "Description");

    let resolvedValue = null;
    let primitiveRef  = null;

    if (relIds.length > 0 && primitiveLookup.has(relIds[0])) {
      const prim    = primitiveLookup.get(relIds[0]);
      primitiveRef  = prim.name;
      resolvedValue = prim.value;
    } else {
      resolvedValue = getRollup(page, "Primitive Value") || null;
    }

    if (!primitiveRef && !resolvedValue) continue;

    const dtcgType  = inferDtcgType(name, resolvedValue ?? "");
    const figmaType = dtcgType ? toFigmaType(dtcgType) : undefined;

    const dtcgLeaf = {
      $value: primitiveRef ? `{${primitiveRef}}` : normalizeDtcg(resolvedValue, dtcgType),
    };
    if (dtcgType) dtcgLeaf.$type = dtcgType;
    if (desc) dtcgLeaf.$description = desc;

    const figmaLeaf = { $value: normalizeFigma(resolvedValue, dtcgType) };
    if (figmaType) figmaLeaf.$type = figmaType;
    if (desc) figmaLeaf.$description = desc;

    setNested(dtcg, name, dtcgLeaf);
    setNested(figma, name, figmaLeaf);
  }

  // --- Components ---
  for (const page of componentPages) {
    const name = getTitle(page);
    if (!name) continue;

    const relIds = getRelationIds(page, "Value");
    const desc   = getText(page, "Description");

    if (relIds.length === 0 || !semanticLookup.has(relIds[0])) continue;

    const sem = semanticLookup.get(relIds[0]);
    const resolvedValue = sem.resolvedValue;
    if (!resolvedValue) continue;

    const dtcgType  = inferDtcgType(name, resolvedValue);
    const figmaType = dtcgType ? toFigmaType(dtcgType) : undefined;

    const dtcgLeaf = { $value: `{${sem.name}}` };
    if (dtcgType) dtcgLeaf.$type = dtcgType;
    if (desc) dtcgLeaf.$description = desc;

    const figmaLeaf = { $value: normalizeFigma(resolvedValue, dtcgType) };
    if (figmaType) figmaLeaf.$type = figmaType;
    if (desc) figmaLeaf.$description = desc;

    setNested(dtcg, name, dtcgLeaf);
    setNested(figma, name, figmaLeaf);
  }

  // 4. Output
  const dtcgJson  = JSON.stringify(dtcg, null, 2);
  const figmaJson = JSON.stringify(figma, null, 2);
  const dtcgCount  = countLeaves(dtcg);
  const figmaCount = countLeaves(figma);

  if (dryRun) {
    console.log(`\nDry run \u2014 ${dtcgCount} DTCG tokens, ${figmaCount} Figma tokens would be exported.`);
    console.log(`DTCG size:  ${(dtcgJson.length / 1024).toFixed(1)} KB`);
    console.log(`Figma size: ${(figmaJson.length / 1024).toFixed(1)} KB`);
    return;
  }

  if (!figmaOnly) {
    writeFileSync(outDtcg, dtcgJson, "utf-8");
    console.log(`\nWrote ${dtcgCount} tokens \u2192 ${outDtcg} (${(dtcgJson.length / 1024).toFixed(1)} KB)`);
  }

  if (!dtcgOnly) {
    writeFileSync(outFigma, figmaJson, "utf-8");
    console.log(`Wrote ${figmaCount} tokens \u2192 ${outFigma} (${(figmaJson.length / 1024).toFixed(1)} KB)`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

