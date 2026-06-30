# Panda Design Tokens

Exports design tokens from Notion into a [DTCG-compliant](https://tr.designtokens.org/format/) `tokens.json` file for import into Figma via Tokens Studio.

## How to use

### Option A: Click a button (recommended)

1. Go to the **Actions** tab in this repo
2. Click **"Export Design Tokens"** in the left sidebar
3. Click **"Run workflow"**
4. Choose whether to export only approved tokens or all tokens
5. Click the green **"Run workflow"** button

A PR will open automatically if any tokens changed. Review the diff, approve, and merge.

### Option B: Scheduled (automatic)

The export runs automatically every weekday at 9 AM UTC (3 AM MT). If tokens changed since the last run, a PR is opened. No action needed unless you want to review and merge.

---

## First-time setup (admin only)

This only needs to be done once by a repo admin.

### 1. Create a Notion integration

1. Go to [notion.so/my-integrations](https://www.notion.so/my-integrations)
2. Create an internal integration in the Trinidad Benham workspace
3. Copy the `secret_xxx` token

### 2. Share the databases

Open each of these databases in Notion and add the integration via **··· → Connections**:

- [Primitive Tokens](https://app.notion.com/p/trinidadbenham/2726f5855b4681ed92b3f29a5d9f89a3)
- [Semantic Tokens](https://app.notion.com/p/trinidadbenham/2726f5855b4681c7b24ccbdd303360b2)
- [Component Tokens](https://app.notion.com/p/trinidadbenham/2726f5855b468146b7c2e5e4ca56a669)

### 3. Add the repo secret

1. Go to this repo → **Settings → Secrets and variables → Actions**
2. Click **New repository secret**
3. Name: `NOTION_TOKEN`
4. Value: paste the `secret_xxx` token
5. Click **Add secret**

That's it. Any team member with write access to the repo can now trigger exports.

---

## How it works

The script reads all three Notion databases and resolves the reference chain:

```
Component tokens  →  reference Semantic tokens  →  reference Primitive tokens  →  raw values
```

The output uses DTCG alias syntax (`{path.to.token}`) to preserve this hierarchy:

```jsonc
{
  "color": {
    "blue": {
      "500": { "$value": "#4A6FA5", "$type": "color" }       // primitive
    },
    "bg": {
      "accent": {
        "prominent": {
          "default": { "$value": "{color.blue.500}", "$type": "color" }  // semantic → primitive
        }
      }
    }
  },
  "button": {
    "primary": {
      "bg": { "$value": "{color.bg.accent.prominent.default}", "$type": "color" }  // component → semantic
    }
  }
}
```

### Filtering

- **Generate checkbox** in Notion controls which tokens are exported. Uncheck to exclude WIP tokens.
- **--approved-only flag** further restricts to tokens with Status = "Approved". The scheduled workflow always uses this.

---

## Importing into Figma

1. Install [Tokens Studio](https://tokens.studio/) in Figma
2. Point it at this repo's `tokens.json` on the `main` branch
3. Merging a token PR automatically updates Figma on next sync

---

## Rollback

If a token change causes problems:

```bash
git revert HEAD    # revert the last merge
# or
git checkout <tag> -- tokens.json   # restore a tagged version
```

Tag important releases:

```bash
git tag -a tokens/v2.1.0 -m "Add accent palette"
git push --tags
```

---

## Local development (optional)

For debugging or testing changes to the export script:

```bash
git clone <this-repo> && cd panda-design-tokens
NOTION_TOKEN=secret_xxx npm run export:dry-run   # preview
NOTION_TOKEN=secret_xxx npm run export            # write tokens.json
```

Requires Node.js 18+. No npm install needed — zero dependencies.
