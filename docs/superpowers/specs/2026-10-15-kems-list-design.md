# Kem's List — design

Date: 2026-10-15 · Status: awaiting review

## Goal

A public, calm reading list of the best writing by Africans on the internet — Substack, Medium,
personal blogs and anywhere else. Inspired by rsrch.space; looks and feels like the Tempo email app.
**Quality, not volume:** every piece is something a reader will enjoy.

### Constraints (from the owner)

1. **Cost:** effectively free. Only optional spend is a custom domain (~$10/yr).
2. **Maintenance:** nothing to patch, upgrade or keep alive later. No servers, no databases,
   no third-party accounts beyond GitHub, minimal dependencies.
3. **Curation → live** must be cheap in time and effort: keyboard triage, live in ~1 minute.

### Decisions

| Question | Decision |
|---|---|
| Automation vs judgement | Automation **finds** candidates; nothing is public until the curator approves it |
| Unit of curation | **Writers first** — a curated roster; their feeds are watched. "Is this writer African" is decided once per writer, by the curator |
| Reading experience | **Preview + note**: title, writer, excerpt, read time, optional curator note, then "Read on <platform> →". Never republish full text |
| Curation UI | Private **/desk** page in the same Tempo style |
| v1 extras | **RSS feed** only. Writer pages, filters, email digest are out of scope |
| Architecture | **Static site; the GitHub repo is the database**; GitHub Actions for discovery and builds |
| Hosting | **Public repo, GitHub Pages** → `kemdirimakujuobi.github.io/kems-list` |

## Architecture

```
writer feeds ──(discover job: cron 3h + on push)──▶ data/queue.json
                                                       │
                                /desk (static page, GitHub API)
                                   a = approve (+note)  │  s = skip
                                                       ▼
                                  data/pieces.json · data/skipped.json
                                                       │ commit
                                                       ▼
                         build job ──▶ HTML + feed.xml ──▶ GitHub Pages
```

No server code. Three moving parts, each replaceable: a discovery script, a site builder,
and a static desk page. Runtime: Node (LTS) in GitHub Actions only. Dependencies: one XML parser
(`fast-xml-parser`, zero transitive deps). Site and desk are plain HTML/CSS/JS — no framework.

## Data (`data/`)

Each file has **exactly one writer**, so the desk and the job never conflict.

| File | Shape (per item) | Written by |
|---|---|---|
| `writers.json` | `{id, name, country, links: {substack?, medium?, site?}, active, addedAt}` | desk |
| `inbox.json` | `{url, addedAt}` — single links pasted by the curator | desk |
| `pieces.json` | `{id, url, title, writerId, publishedAt, approvedAt, excerpt, readMinutes?, note?, platform}` | desk |
| `skipped.json` | `[id, …]` | desk |
| `queue.json` | `{id, url, title, writerId?, publishedAt, excerpt, readMinutes?, platform, paywalled, foundAt}` | job |
| `status.json` | `{feeds: {writerId: {feedUrl, lastOk, lastError?, failCount}}, deadLinks: [id]}` | job |

- `id` = first 12 hex chars of `sha1(canonical URL)` (lower-cased host, no tracking params,
  no trailing slash). Same piece can never be queued or published twice.
- **The curator's queue** = `queue.json` minus ids in `pieces.json` and `skipped.json`.
  The job prunes `queue.json` of those ids on each run.
- An `inbox.json` link is *processed* once its id is in `queue.json`, `pieces.json` or `skipped.json`;
  the job never edits `inbox.json` — the desk drops processed entries whenever it next writes that file.
- `writerId` = slug of the writer's name; unique. `country` is free text chosen by the curator.

## Discovery job (`scripts/discover.js`, `.github/workflows/discover.yml`)

Triggers: every 3 hours; on push touching `data/writers.json` or `data/inbox.json`; manual dispatch.

1. **Feed detection** per active writer link:
   `*.substack.com` or `substack.com/@x` → `https://x.substack.com/feed`;
   `medium.com/@x` → `https://medium.com/feed/@x`; anything else → fetch the page and read
   `<link rel="alternate" type="application/(rss|atom)+xml">`. Result cached in `status.json`.
2. **Fetch + parse** RSS 2.0 and Atom (15 s timeout, 2 MB cap, honest User-Agent naming the site).
3. **New writer seeding:** a writer with no `lastOk` gets only their 3 most recent items queued.
   Afterwards: any item not already known.
4. **Per item:** title; `publishedAt`; canonical URL; `platform` from host (Substack/Medium/Blog);
   excerpt = feed description/subtitle, else start of content — HTML stripped, ≤ 280 chars, cut at a
   sentence or word boundary with "…"; `readMinutes` = words/230 when full content is in the feed.
5. **Noise filters:** drop items with an audio/video enclosure (podcasts); drop items whose known
   length is < 300 words; keep paid-only Substack posts but set `paywalled: true`.
6. **Inbox links:** fetch the page, read `og:title`, `og:description`, `article:published_time`,
   author meta; queue with `writerId` matched by host when possible, else none.
7. **Weekly** (Mondays): HEAD/GET each published URL; 404/410 twice in a row → add to `deadLinks`.
   Never unpublishes automatically.
8. Commit `queue.json` + `status.json` only if changed, as `github-actions[bot]`; on push race,
   `git pull --rebase` and retry up to 3 times.

Per-feed errors increment `failCount` and record `lastError`; they never fail the job.
Both workflows use a `concurrency` group (discover: queue new runs; build: `pages`, cancel in progress)
so runs never overlap.
A crash of the whole job fails the workflow → GitHub emails the owner (default behaviour).

## Desk (`site/desk/`, served at `/desk/`)

Static page; same look as the site. Not linked from the public site; `noindex`.

- **Unlock:** first visit asks for a fine-grained GitHub token (this repo only, *Contents: read & write*);
  stored in `localStorage`; "Lock" button clears it. Token never leaves the browser except to `api.github.com`.
- **Reads** `data/*.json` via the GitHub Contents API (always fresh, not the deployed copy).
- **Tabs:** Queue · Writers · Published.
  - **Queue:** newest first; row = writer initial, writer, **title** — excerpt, platform, date, paywalled badge.
    Preview pane shows full candidate data.
  - **Writers:** add (paste profile URL + name + country), pause/resume, failing feeds highlighted
    with their last error.
  - **Published:** edit note, unpublish (moves id to `skipped.json`), dead-link flags.
- **Keys:** `j`/`k` move · `Enter` open preview · `o` open original in new tab · `a` approve → note
  field (`Enter` saves, empty allowed, `Esc` cancels) · `s` skip · `u` undo last action ·
  `n` paste link · `w` add writer · `?` shortcut help. All actions also have buttons (works on phone).
- **Writes:** each action is one commit via the Contents API using the file's `sha`. On `409`
  conflict: re-fetch, re-apply the action to fresh data, retry (max 3), else show an error and keep
  the action in the undo stack. Commit messages: `approve: <title>`, `skip: <title>`, etc.
- **Validation:** the same schema checks as the build run before every commit.

## Public site (`scripts/build.js`, `.github/workflows/build.yml`)

Triggers: push touching `data/pieces.json`, `data/writers.json`, `site/**`, `scripts/build.js`.
Validates all `data/*.json` against the schemas; **any violation fails the build**, so Pages keeps
serving the last good version. Output to `_site/`, deployed with the official Pages actions.

- **`/` (home):** one list, grouped *Today / This week / Earlier* by `approvedAt`, newest first.
  Row: writer-initial circle · writer name · **title** — excerpt (muted, one line) · date.
  Whole row links to the piece page. All pieces on one page (paginate by year later if > 1,000).
- **`/p/<id>/`:** title; writer · country; publish date · read time; curator note as a quote
  (if any); excerpt; primary button **"Read on <platform> →"** (`rel="noopener"`).
  Open Graph + Twitter meta (title, excerpt, site name) for sharing. Keys: `j`/`k` next/prev, `Esc` home.
- **`/feed.xml`:** RSS 2.0, latest 50 pieces; item description = note (if any) + excerpt; link = original URL.
- **Look:** Tempo — light grey background, generous whitespace, system UI font stack, muted greys,
  one blue accent; light/dark via `prefers-color-scheme`; responsive to phone width; no tracking,
  no external requests, no web fonts. JS only adds keyboard navigation.
- Base path aware (`/kems-list/`) so a custom domain can be added later by changing one setting.

## Testing

`node --test`, fixtures checked in:

- Feed detection for each URL shape; RSS and Atom parsing on saved real Substack, Medium and
  WordPress feeds; excerpt cutting; canonical URL + id; noise filters; seeding rule; dedupe against
  pieces/skipped/queue; inbox enrichment from saved HTML.
- Desk logic as pure functions (no DOM): approve/skip/undo/unpublish state transitions; conflict
  re-apply; schema validation.
- Build: given fixture data → expected pages exist, grouping is right, HTML is escaped,
  `feed.xml` is valid RSS; invalid data → build throws.
- Launch check: run discovery against 3 real writers, approve via the deployed desk, confirm the piece
  is live and in `feed.xml`.

## Out of scope (v1)

Writer pages · country/topic filters · email digest · full-text republishing · multiple curators ·
search · analytics · custom domain (supported, not set up).

## Risks

- **Medium/Substack feed changes** — isolated per writer, visible in the desk's failing-feeds list.
- **Public repo** — the roster and queue are public. Acceptable: the site is public anyway; skipped ids
  are hashes, not titles.
- **Token in browser storage** — scoped to one repo's contents; revocable on GitHub at any time.
- **Actions/Pages free terms** change — the site is plain files and moves to any static host as is.
