# Kem's List

The best writing by Africans on the internet, chosen one piece at a time.

**Site:** https://kemdirimakujuobi.github.io/kems-list/ · **RSS:** https://kemdirimakujuobi.github.io/kems-list/feed.xml

A calm, Tempo-style reading list: one row per piece (logo, title, source, publish date). Each row links
straight to the original, so writers keep their readers and subscribers. Curator notes travel in the
RSS feed.

## How it works

There's no server and no database. This public repo *is* the database:

```
writers' feeds ──(Discover, every 3h)──▶ data/queue.json ──▶ /desk ──a/s──▶ data/pieces.json ──(Build)──▶ GitHub Pages
```

| | |
|---|---|
| `data/writers.json` | Writer roster: name, country, Substack/Medium/site links |
| `data/queue.json` | Candidates found by Discover, waiting for review |
| `data/pieces.json` | Published pieces, with the curator's notes |
| `data/skipped.json` | IDs of skipped pieces, which are never re-queued |
| `data/inbox.json` | Single links pasted at the desk |
| `data/status.json` | Feed health and dead-link checks |

- **Substack writers are curated by hand.** Substack's Cloudflare protection blocks requests from cloud servers,
  GitHub Actions included, so Discover skips them and the desk marks them *manual*. Read their latest from
  the Writers tab (`o`), then paste a piece with **Add link** (`n`). If the page can't be fetched, you can
  type the title and excerpt yourself, or the title is made from the link.
- **Discover** (`.github/workflows/discover.yml`) runs every 3 hours, and whenever a writer or link is
  added. It reads each writer's feed and queues new pieces. A new writer gets only their 3 latest pieces.
  It drops podcasts and very short posts, and flags paid-only posts.
- **Build** (`.github/workflows/build.yml`) runs the tests, renders the site, and deploys to GitHub Pages.
  Bad data fails the build, so the live site never breaks.

Cost: **$0**. Dependencies: one XML parser. Nothing to keep alive.

## Curation rules

- **Individuals only.** The roster is for individual African writers: their Substack, Medium or personal
  site. No publications, magazines or group blogs.
- **The diaspora counts.** African writers living abroad belong on the list. Record both places in `country`,
  for example `Nigeria / UK`.
- An individual's piece published *in* a magazine can still be added with **Add link** (`n`). The rule is
  about who wrote it, not where it appeared.
- Quality over volume: skipping is the default; approve what you'd send a friend.
- **Writing in French and Portuguese is welcome.** Each row is tagged with its language (`FR`, `PT`); English
  is untagged. The language is guessed from the title and excerpt (`lib/lang.js`). If a guess is wrong, set
  `"lang": "en"` (or `fr`, `pt`, …) on that piece in `data/pieces.json`.

## Curating at the desk

Open **`/kems-list/desk/`**. It isn't linked from the site.

**Unlock it once per device** with a fine-grained GitHub token:

1. Go to GitHub → Settings → Developer settings → [Fine-grained tokens](https://github.com/settings/personal-access-tokens/new).
2. For **Repository access**, choose *only* `kems-list`.
3. Under **Permissions**, set **Contents** to **Read and write**. No other permissions are needed.
4. Paste the token at the desk. It's stored in that browser only, and **Lock** removes it.

**Add from any page: the Kem's List extension (Chrome, Arc, Brave, Edge)**

The `extension/` folder holds a small browser extension. Click its toolbar button, press `⌥K`, or right-click
**Add this page / link to Kem's List**. It reads the piece's exact title, publish date, author, publication and
logo, then opens the desk with everything filled in. You press **Add to queue** there.

Install it once:

1. Get the repo onto your computer (`git clone https://github.com/Kemdirimakujuobi/kems-list`).
2. Open `chrome://extensions` (in Arc: `arc://extensions`) and turn on **Developer mode**.
3. Click **Load unpacked** and choose the `extension` folder.
4. Pin the blue **K** to your toolbar.

To update it, run `git pull` and click ↻ on the extension card. The extension stores no tokens and has no standing
access to websites. It reads only the tab you click on. Adding a *link* asks once for permission for that one site.

**The `+ Kem's List` bookmark (any browser)**

Press `?` at the desk and drag the **+ Kem's List** button to your bookmarks bar. While reading a piece,
click it. The desk opens with everything read from the page itself: exact title, publish date, author,
publication and logo. This is the best way to add Substack pieces, because GitHub's servers can't read
Substack pages but your browser can. On iPhone, add it as a Safari bookmark.

**Logos:** each row shows the publication's logo or the writer's avatar. The build downloads them into
`/icons/`, so readers' browsers never contact third parties.

**Keys**

| Key | |
|---|---|
| `j` / `k` | Move down / up |
| `Enter` | Open the preview |
| `o` | Open the original in a new tab (Writers tab: open the writer's page) |
| `a` | Approve: write a note, then `Enter` to save (`Shift+Enter` adds a new line) |
| `A` | Approve without a note |
| `s` | Skip |
| `u` | Undo the last action |
| `e` / `x` | Edit the note / unpublish (Published tab) |
| `p` | Pause or resume a writer (Writers tab) |
| `n` | Add a single link from anywhere, with an optional title and excerpt |
| `w` | Add a writer (paste their Substack, Medium or site links) |
| `1` `2` `3` | Switch between Queue, Writers and Published |
| `?` | Show all keys |

Everything also works by tapping, on a phone. An approved piece is live in about a minute.

## Development

```bash
npm ci
npm test                 # node:test, no network needed
npm run serve            # http://localhost:4173/kems-list/ (desk at /kems-list/desk/)
```

`npm run serve` uses a scratch copy of the data (`.dev-data/`) and stands in for GitHub's API, so
the desk can be tried end to end without a token. To point a browser's desk at it, run this once in
the browser console:

```js
localStorage.setItem('kems.api', location.origin + '/__github__'); localStorage.setItem('kems.token', 'dev');
```

To run Discover locally, which writes to `data/`, use `npm run discover`.

**Custom domain later:** set `SITE_BASE=/` and `SITE_URL=https://your.domain` in the Build workflow,
and add the domain in the repo's Pages settings.

## Layout

```
lib/        shared by Node and the browser: schema.js, desk.js (actions), github.js, url.js
scripts/    discover.js, build.js, serve.js, lib/{feeds,canonical}.js
site/       assets/ (style.css, keys.js), desk/ (index.html, desk.js)
test/       node:test suites + real feed fixtures
docs/       design spec and implementation plan
```
