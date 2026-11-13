# Speedrundle, CCUdle and Draftdle

Three daily pick-one-of-two games (CCUdle was called Peakdle; its files, folders and workflow names still say `peakdle`), each its own site on Cloudflare Pages. GitHub Actions does the scheduled work. Speedrundle and CCUdle are fully static; Draftdle adds Pages Functions and a D1 database because its answers come from its own players' votes (see [Draftdle](#draftdle) below).

| | Speedrundle | CCUdle |
|---|---|---|
| Question | Which world record is faster? | Which Steam game had more players at its peak? |
| Data | speedrun.com API, refreshed weekly | Steam Web API, sampled hourly |
| Pool | 3,604 categories across 1,426 games | 1,712 Steam apps |
| Card art | Box art from speedrun.com | Header art from Steam's store CDN |
| Modes | Daily | Live (from day one); All-Time (after 30 days of history) |
| Repeats | No category repeats within 30 days | No game repeats within 7 days per mode |

## What runs when

| Workflow | When | What it does |
|---|---|---|
| `peakdle-poll.yml` | Every hour at :07 | Samples current players for every pool app. Keeps each app's daily maximum in the Actions cache. |
| `daily.yml` | 00:20 UTC, and on every push to `main` | Closes finished Steam days into `data/peakdle/peaks/`. Freezes puzzles for yesterday, today and tomorrow (UTC). Runs the tests, builds both sites, commits the new data and deploys to Cloudflare. |
| `weekly-refresh.yml` | Mondays 03:40 UTC | Re-pulls every world record (about 20 minutes at speedrun.com's rate limit). Refreshes Steam image paths and drops apps Steam marks adult-only. Commits both. |

Once a puzzle file is written it never changes. A data refresh only affects future days.

CCUdle Live uses the UTC day that ended two days before the puzzle date, because players' local midnights span 26 hours. The question names that day. If a day's polling failed, Live uses the newest earlier day instead.

## One-time setup

### 1. Domains

Done. speedrundle.com and ccudle.com are registered with Cloudflare Registrar and attached to their Pages projects. `www.` redirects to the bare domain with a Redirect Rule on each zone. The `url` in each `site.json` sets the canonical link, share text and sitemap.

### 2. GitHub

Push this folder to a new repository. A **public** repo gets unlimited Actions minutes. A private repo uses about 900 of the free 2,000 minutes a month; most of that is the hourly poll. The repo holds no secrets, so public is fine.

GitHub turns off scheduled workflows after 60 days with no repository activity. The daily data commits normally count as activity. If the workflows stop running, re-enable them in the **Actions** tab.

### 3. Cloudflare Pages

1. Create the two projects once. Run `npx wrangler pages project create speedrundle --production-branch main`, then the same command with `peakdle`. You can also use the dashboard: **Workers & Pages → Create → Pages → Upload assets**. If either name is taken, change `cloudflareProject` in that site's `site.json`.
2. Create an API token under **My Profile → API Tokens** using the "Cloudflare Pages: Edit" permission. Note your Account ID from the dashboard sidebar.
3. Add each domain under **Pages project → Custom domains**.
4. In GitHub, go to **Settings → Secrets and variables → Actions** and add:
   - `CLOUDFLARE_API_TOKEN`
   - `CLOUDFLARE_ACCOUNT_ID`
   - `STEAM_API_KEY` (optional; free at steamcommunity.com/dev/apikey)

   The player-count endpoint answers without a key. Steam's Web API terms are written around keyed use, so adding one is the safer choice.

### 4. Launch timing

- Set `epoch` in both `site.json` files to launch day. Puzzle #1 is that date.
- Start the CCUdle poll at least two days before you announce. Use **Actions → Peakdle poll → Run workflow** for the first run; after that it runs hourly by itself. Live needs one closed UTC day before it has a puzzle. Until then the page says so.

### 5. AdSense

1. Fill in `contact` in both `site.json` files. The address shows on the About and Privacy pages, and reviewers look for one.
2. In AdSense, add each domain under **Sites**. Copy your publisher ID into `adsense.client` (format `ca-pub-` plus 16 digits) in both `site.json` files and push. The deploy adds the AdSense script, the `google-adsense-account` meta tag and `/ads.txt`. Then request review in AdSense.
3. Under **Privacy & messaging**, create a **European regulations** message and a **US state regulations** message for both sites. Google requires a certified consent tool for visitors in the EEA, UK and Switzerland. Google's own counts, and no code is needed. The "Privacy choices" link in each game's footer reopens it.
4. After approval, create two display ad units per site, named "results" and "footer". Put their numeric `data-ad-slot` ids in `adsense.slots` and push.
5. Keep **Auto ads** off. The two manual slots sit below the results and at the bottom of the page, away from the cards. AdSense's policy on accidental clicks makes ads next to game controls a risk.

To check the layout before ads are approved, run `node scripts/build.mjs --ad-preview`. It draws striped boxes where the ads go.

## Data and licences: read before launch

- **speedrun.com.** The October 2026 terms now give leaderboard data its own licence. Per speedrun.com's announcement, it allows any use, including commercial, but automated access has to go through the API and AI training is excluded. This code uses only the documented v1 API and sends a User-Agent naming the site. Read the Leaderboard Data License (linked from speedrun.com's Terms of Use) before launch.
- **Steam.** Counts come from Valve's `GetNumberOfCurrentPlayers`. The footer and About page carry the non-affiliation line. The terms allow 100,000 calls a day; the hourly poll uses about 41,600.
- **All-Time.** All-Time uses only peaks CCUdle recorded itself, so the question says "since <first day>". `data/peakdle/seed-steamcharts.json` holds the true all-time peaks from Steam Charts. It is **off**. Turn it on with `"alltime": { "seed": "steamcharts" }` only if Steam Charts gives you permission.
- **Images.** Cards load game art straight from Steam's and speedrun.com's servers. Nothing is copied into the repo. The art belongs to each game's publisher, as on any store or stats site that shows it. To serve the art from your own domain instead, ask for a mirror step.
- **SteamSpy.** Genre and Free/Paid labels come from a SteamSpy snapshot, credited on the page.

## Editing

| To change | Edit | Then |
|---|---|---|
| Which speedrun games are polled | `data/speedrundle/games.json` | The next weekly refresh picks it up |
| Labels, drops, junk filters | `data/speedrundle/curation.json` | The next weekly refresh picks it up |
| Steam apps | `data/peakdle/pool.json` (`appid`, `name`, `genre`, `free`) | |
| Copy, titles, AdSense ids, thresholds | `sites/<name>/site.json` | |
| Game text and card layout | `sites/<name>/game.js` | |
| Page engine | `src/game.html` | |
| Pair rules | `src/core.mjs` | |
| Social images and icons | | Run `python3 scripts/make-images.py` |

Commands: `npm ci`, then `npm test` (offline, about 15 seconds; simulates a week of polling and 40 days of puzzles) and `npm run build`.

## Draftdle

Pick a sport, see two players, pick the one you'd draft. The player more people pick wins the pair. Daily is ten frozen pairs a day per sport, scored against the crowd. Endless is served and scored by the server (so the client never holds an answer), with seven all-time boards per sport: best agreement at 25, 50, 100, 250, 500 and 1,000 scored picks, and longest streak. Design: the Draftdle plan doc.

| Piece | Where |
|---|---|
| Sports, leagues, positions, tiers | `data/draftdle/sports.json` |
| Player pools (built from Wikidata) | `data/draftdle/<sport>/pool.json`, by `scripts/draftdle-refresh.mjs` |
| Players to leave out | `data/draftdle/curation.json`: `{"exclude": {"nba": ["Q123"]}}` |
| Board names to hide | `data/draftdle/hidden-names.json`: a list of names |
| Page | `src/draftdle.html` (base CSS comes from `src/game.html` at build time) |
| API (Pages Functions) | `sites/draftdle/functions/api/`, shared code in `sites/draftdle/lib/` |
| D1 schema | `sites/draftdle/migrations/` |
| Nightly maths (ratings, tiers, serving tables, Daily freeze) | `scripts/draftdle-lib.mjs`, run by `scripts/draftdle-nightly.mjs` |
| Daily puzzles (frozen, public) | `data/puzzles/draftdle/<sport>/<date>.json`, also served at `/d/<sport>/<date>.json` |
| Public status (phase, Daily progress) | `data/draftdle/status.json` |

**Workflow.** `.github/workflows/draftdle.yml` runs at 00:35 UTC, on every push and by hand. It is separate from `daily.yml`, so a Draftdle failure never blocks the other two sites. It creates the D1 database if needed, writes `sites/draftdle/wrangler.toml` (not committed; it holds the database id), applies migrations, builds any missing player pool from Wikidata, runs the nightly job, tests, commits the data and deploys. The weekly refresh rebuilds all pools on Mondays.

**Lifecycle of a sport.** Scouting first: every Endless question is a no-winner data question until 95% of the sport's Headliners have 30 votes. Then the sport opens: scored Endless, boards, and about one no-winner question in five while any served tier still has players under 30 votes. Tiers open in order (Headliners, Regulars, Deep cuts). The Daily opens once 100 Headliner pairs have a crowd verdict (25+ votes in its first two weeks, 40+ after).

**Setup, once:**

1. Give the `CLOUDFLARE_API_TOKEN` secret **D1 Edit** permission (My Profile → API Tokens → edit the token → add Account · D1 · Edit). Without it the Draftdle workflow stops at "Database and config"; the other sites are unaffected.
2. Optional: add a `DRAFTDLE_VOTER_KEY` repository secret (any long random string). The workflow puts it on the Pages project as `VOTER_KEY`, which salts the hash of each browser's id.
3. Optional, recommended before a public launch: a Cloudflare rate-limiting rule on `/api/*` (for example 600 requests a minute per IP). The Functions have their own per-isolate caps, which are only a speed bump.
4. Optional: Cloudflare Turnstile. Create a widget for the domain, put its site key in `turnstileSiteKey` in `sites/draftdle/site.json`, and add the secret on the Pages project as `TURNSTILE_SECRET`. Endless runs then need a passing token to start.
5. Before ads: register the domain, set `url`, add the site in AdSense, then fill `adsense` in `site.json` as for the other two.

**Cost.** Each Endless pick is one request and a few D1 rows written. Workers Free allows 100,000 requests and 100,000 D1 rows written a day, and fails hard at the cap; move to Workers Paid before a public launch.

**Play it locally:** `npm run draftdle:dev` serves `dist/draftdle` on http://localhost:8788 and runs the real Functions on a SQLite file (`state/draftdle-dev.sqlite`). Fill that file's serving tables with `DRAFTDLE_DB=state/draftdle-dev.sqlite node scripts/draftdle-nightly.mjs`.

**Data and licences.** Wikidata is CC0. Wikimedia Commons photos carry their own licences (mostly CC BY-SA); each reveal that shows one links to its file page, which names the author and licence. League and ESPN headshots load straight from those servers, as Steam and speedrun.com art does on the other sites; check each league's terms before launch and switch a sport to Commons-only (empty `headshots` in `sports.json`) if needed.
