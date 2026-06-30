# Panda Design Tokens

Exports design tokens from Notion into two JSON files:

- **`tokens.dtcg.json`** — [DTCG-compliant](https://tr.designtokens.org/format/) with alias references (`{color.blue.500}`). For Tokens Studio, Style Dictionary, and other DTCG-aware tools.
- **`tokens.figma.json`** — Figma Variables-ready with all aliases resolved to final raw values, units stripped from dimensions, and only Figma-compatible types (`color`, `number`, `string`).

## How to use

### Option A: Click a button (recommended)

1. Go to the **Actions** tab in this repo
2. Click **"Export Design Tokens"** in the left sidebar
3. Click **"Run workflow"**
4. Choose whether to export only approved tokens
5. Click the green **"Run workflow"** button

A PR will open automatically if any tokens changed. Review the diff, approve, and merge.

### Option B: Scheduled (automatic)

The export runs automatically every weekday at 9 AM UTC. If tokens changed, a PR is opened.

---

## First-time setup (admin only)

### 1. Create a Notion integration

Go to [notion.so/my-integrations](https://www.notion.so/my-integrations), create an internal integration, and copy the token.

### 2. Share the databases

Add the integration via **··· → Connections** on each database:

- [Primitive Tokens](https://app.notion.com/p/trinidadbenham/2726f5855b4681ed92b3f29a5d9f89a3)
- [Semantic Tokens](https://app.notion.com/p/trinidadbenham/2726f5855b4681c7b24ccbdd303360b2)
- [Component Tokens](https://app.notion.com/p/trinidadbenham/2726f5855b468146b7c2e5e4ca56a669)

### 3. Add the repo secret

Repo → **Settings → Secrets → Actions** → New secret → Name: `NOTION_TOKEN`, Value: your token.

---

## Output formats compared

| Aspect | `tokens.dtcg.json` | `tokens.figma.json` |
|---|---|---|
| Semantic values | `{color.blue.500}` (alias) | `#637DB3` (resolved) |
| Dimension values | `5px` | `5` (number) |
| Font sizes | `"16"` (string, type: number) | `16` (number) |
| Overlay colors | `rgba(44, 44, 44, 0.1)` | `rgba(44, 44, 44, 0.1)` |
| Types | DTCG spec (`dimension`, `fontFamily`) | Figma-native (`number`, `string`) |
| Import tool | Tokens Studio / Style Dictionary | Figma native import |

## Importing into Figma

**Via Tokens Studio (recommended for full alias support):** Point Tokens Studio at `tokens.dtcg.json` on the `main` branch. Aliases resolve automatically.

**Via Figma native import:** Use `tokens.figma.json` — all values are pre-resolved, so Figma's built-in variable import can handle them directly.

---

## CLI flags

```bash
NOTION_TOKEN=secret_xxx node export-tokens.mjs              # both files
NOTION_TOKEN=secret_xxx node export-tokens.mjs --dtcg-only   # only DTCG
NOTION_TOKEN=secret_xxx node export-tokens.mjs --figma-only  # only Figma
NOTION_TOKEN=secret_xxx node export-tokens.mjs --approved-only
NOTION_TOKEN=secret_xxx node export-tokens.mjs --dry-run
NOTION_TOKEN=secret_xxx node export-tokens.mjs --out-dtcg dist/dtcg.json --out-figma dist/figma.json
```

## Rollback

```bash
git revert HEAD
# or restore a tagged version
git checkout tokens/v2.0.0 -- tokens.dtcg.json tokens.figma.json
```

Requires Node.js 18+. Zero dependencies.
