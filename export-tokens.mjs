#!/usr/bin/env node
/**
 * export-tokens.mjs
 *
 * Exports design tokens from three Notion databases (Primitive, Semantic,
 * Component) into a single DTCG-compliant JSON file suitable for import
 * into Figma (via Tokens Studio or similar).
 *
 * Usage:
 *   NOTION_TOKEN=secret_xxx node export-tokens.mjs [--approved-only] [--out tokens.json]
 *
 * Environment variables:
 *   NOTION_TOKEN  – Notion internal integration token (required)
 *
 * Flags:
 *   --approved-only   Only export tokens whose Status is "Approved"
 *   --out <path>      Output file path (default: tokens.json)
 *   --dry-run         Print summary without writing a file
 */

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

// ─── Configuration ──────────────────────────────────────────────────────────
// Notion database IDs (from your Notion URLs)
const DB_IDS = {
  primitive: "2726f5855b4681ed92b3f29a5d9f89a3",
  semantic: "2726f5855b4681c7b24ccbdd303360b2",
  component: "2726f5855b468146b7c2e5e4ca56a669",
};

// Map token-name prefixes → DTCG $type values
const TYPE_MAP = {
  color: "color",
  dimension: "dimension",
  font: "fontFamily",
  radius: "dimension",
  stroke: "dimension",
  spacing: "dimension",
  opacity: "number",
};

// ─── CLI parsing ────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const approvedOnly = args.includes("--approved-only");
const dryRun = args.includes("--dry-run");
const outIdx = args.indexOf("--out");
const outPath = resolve(outIdx !== -1 ? args[outIdx + 1] : "tokens.json");

const NOTION_TOKEN = process.env.NOTION_TOKEN;
if (!NOTION_TOKEN) {
  console.error("Error: NOTION_TOKEN environment variable is required.");
  console.error(
    "Create an internal integration at https://www.notion.so/my-integrations"
  );
  process.exit(1);
}

// ─── Notion API helpers ─────────────────────────────────────────────────────
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

/**
 * Paginate through an entire Notion database, returning all pages.
 * Only returns rows where the Generate checkbox is checked.
 * Optionally filters to Status = "Approved".
 */
async function queryAllPages(databaseId) {
  const pages = [];
  let cursor = undefined;

  const filter = {
    and: [{ property: "Generate", checkbox: { equals: true } }],
  };

  if (approvedOnly) {
    filter.and.push({
      property: "Status",
      select: { equals: "Approved" },
    });
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

// ─── Property extraction helpers ────────────────────────────────────────────

function getTitle(page) {
  const prop = page.properties["Generated Token Name"];
  if (!prop || prop.type !== "title") return "";
  return prop.title.map((t) => t.plain_text).join("");
}

function getText(page, name) {
  const prop = page.properties[name];
  if (!prop) return "";
  if (prop.type === "rich_text")
    return prop.rich_text.map((t) => t.plain_text).join("");
  if (prop.type === "title")
    return prop.title.map((t) => t.plain_text).join("");
  return "";
}

function getRelationIds(page, name) {
  const prop = page.properties[name];
  if (!prop || prop.type !== "relation") return [];
  return prop.relation.map((r) => r.id);
}

function getRollup(page, name) {
  const prop = page.properties[name];
  if (!prop || prop.type !== "rollup") return "";
  const r = prop.rollup;
  if (r.type === "array" && r.array.length > 0) {
    const first = r.array[0];
    if (first.type === "rich_text")
      return first.rich_text.map((t) => t.plain_text).join("");
    if (first.type === "title")
      return first.title.map((t) => t.plain_text).join("");
    if (first.type === "formula") {
      return first.formula.string ?? String(first.formula.number ?? "");
    }
  }
  return "";
}

// ─── DTCG type inference ────────────────────────────────────────────────────

function inferType(tokenName, rawValue) {
  const segments = tokenName.split(".");
  // Walk segments looking for a type-map match
  for (let i = segments.length; i > 0; i--) {
    const key = segments.slice(0, i).join(".");
    if (TYPE_MAP[key]) return TYPE_MAP[key];
  }
  if (TYPE_MAP[segments[0]]) return TYPE_MAP[segments[0]];

  // Fallback heuristics on the raw value
  if (typeof rawValue === "string") {
    if (/^#[0-9a-fA-F]{3,8}$/.test(rawValue)) return "color";
    if (/^rgba?\(/.test(rawValue)) return "color";
    if (/^hsla?\(/.test(rawValue)) return "color";
    if (/^\d+(\.\d+)?(px|rem|em|pt|%)$/.test(rawValue)) return "dimension";
    if (/^\d+(\.\d+)?$/.test(rawValue)) return "number";
  }
  return undefined;
}

// ─── Nest a flat dot-path into a deep object ────────────────────────────────

function setNested(obj, dottedKey, leaf) {
  const parts = dottedKey.split(".");
  let current = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    if (
      !(key in current) ||
      typeof current[key] !== "object" ||
      current[key].$value !== undefined
    ) {
      current[key] = {};
    }
    current = current[key];
  }
  current[parts.at(-1)] = leaf;
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log("Fetching Primitive tokens…");
  const primitivePages = await queryAllPages(DB_IDS.primitive);
  console.log(`  → ${primitivePages.length} primitives`);

  console.log("Fetching Semantic tokens…");
  const semanticPages = await queryAllPages(DB_IDS.semantic);
  console.log(`  → ${semanticPages.length} semantics`);

  console.log("Fetching Component tokens…");
  const componentPages = await queryAllPages(DB_IDS.component);
  console.log(`  → ${componentPages.length} components`);

  // ── 1. Primitive lookup (pageId → { name, value }) ─────────────────────
  const primitiveLookup = new Map();

  for (const page of primitivePages) {
    const name = getTitle(page);
    const value = getText(page, "Value");
    if (!name) continue;
    primitiveLookup.set(page.id, { name, value });
  }

  // ── 2. Semantic lookup (pageId → { name, primitiveRef }) ───────────────
  const semanticLookup = new Map();

  for (const page of semanticPages) {
    const name = getTitle(page);
    if (!name) continue;
    const relIds = getRelationIds(page, "Value");
    let primitiveRef = null;
    if (relIds.length > 0) {
      const prim = primitiveLookup.get(relIds[0]);
      if (prim) primitiveRef = prim.name;
    }
    semanticLookup.set(page.id, { name, primitiveRef });
  }

  // ── 3. Build the DTCG token tree ───────────────────────────────────────
  const dtcg = {};

  // Primitives → raw values
  for (const page of primitivePages) {
    const name = getTitle(page);
    const value = getText(page, "Value");
    const description = getText(page, "Description");
    if (!name || !value) continue;

    const leaf = { $value: value };
    const type = inferType(name, value);
    if (type) leaf.$type = type;
    if (description) leaf.$description = description;

    setNested(dtcg, name, leaf);
  }

  // Semantics → DTCG alias references to primitives
  for (const page of semanticPages) {
    const name = getTitle(page);
    if (!name) continue;

    const relIds = getRelationIds(page, "Value");
    const description = getText(page, "Description");
    let leaf;

    if (relIds.length > 0 && primitiveLookup.has(relIds[0])) {
      const prim = primitiveLookup.get(relIds[0]);
      leaf = { $value: `{${prim.name}}` };
    } else {
      // Fallback: try the Primitive Value rollup
      const inherited = getRollup(page, "Primitive Value");
      if (inherited) {
        leaf = { $value: inherited };
      } else {
        continue;
      }
    }

    const type = inferType(name, leaf.$value);
    if (type) leaf.$type = type;
    if (description) leaf.$description = description;

    setNested(dtcg, name, leaf);
  }

  // Components → DTCG alias references to semantics
  for (const page of componentPages) {
    const name = getTitle(page);
    if (!name) continue;

    const relIds = getRelationIds(page, "Value");
    const description = getText(page, "Description");
    let leaf;

    if (relIds.length > 0 && semanticLookup.has(relIds[0])) {
      const sem = semanticLookup.get(relIds[0]);
      leaf = { $value: `{${sem.name}}` };
    } else {
      continue;
    }

    const type = inferType(name, leaf.$value);
    if (type) leaf.$type = type;
    if (description) leaf.$description = description;

    setNested(dtcg, name, leaf);
  }

  // ── 4. Output ──────────────────────────────────────────────────────────
  const output = JSON.stringify(dtcg, null, 2);

  function countLeaves(obj) {
    let n = 0;
    for (const v of Object.values(obj)) {
      if (v && typeof v === "object" && "$value" in v) n++;
      else if (v && typeof v === "object") n += countLeaves(v);
    }
    return n;
  }

  const total = countLeaves(dtcg);

  if (dryRun) {
    console.log(`\nDry run — ${total} tokens would be exported.`);
    console.log(`Output size: ${(output.length / 1024).toFixed(1)} KB`);
    return;
  }

  writeFileSync(outPath, output, "utf-8");
  console.log(`\nWrote ${total} tokens → ${outPath} (${(output.length / 1024).toFixed(1)} KB)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
