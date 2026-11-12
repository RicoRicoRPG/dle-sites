#!/usr/bin/env node
// Weekly: rebuild data/speedrundle/records.json from the speedrun.com API (v1, documented endpoints only).
// One /games/{id}/records call per game in data/speedrundle/games.json, top run per full-game category.
// A game whose request keeps failing keeps last week's records, and the job refuses to write a pool
// that shrank by more than 20% (an API outage should not empty the game).
//
//   node scripts/speedrundle-refresh.mjs            # all games, ~20 minutes at the API's rate limit
//   node scripts/speedrundle-refresh.mjs --limit 20 # quick check

import { p, read, write, sleep, getJSON } from "./lib.mjs";

const API = "https://www.speedrun.com/api/v1";
const BASE = "top=1&scope=full-game&miscellaneous=no&skip-empty=yes&max=200";

export function recordsFromResponse(game, json, cur) {
  const rx = s => new RegExp(s, "i");
  const junkCat = rx(cur.junkCategory), junkRunner = rx(cur.junkRunner), subKeep = rx(cur.subKeep);
  const drop = new Set(cur.drop), platformCats = new Set(cur.platformCategories);
  const out = [];
  const seen = new Set();
  let platformCatUsed = false;
  for (const lb of json.data || []) {
    const run = lb.runs?.[0]?.run;
    const cat = lb.category?.data;
    if (!run || !cat || cat.type !== "per-game") continue;
    const t = run.times?.primary_t;
    if (!t || t < cur.minSeconds) continue;
    if (junkCat.test(cat.name) || drop.has(`${game.name}|${cat.name}`)) continue;
    const players = lb.players?.data || [];
    if (players.length !== 1 || (run.players || []).length !== 1) continue; // solo runs only
    const pl = players[0];
    const runner = pl.rel === "guest" ? (pl.name || "") : (pl.names?.international || "");
    if (!runner || junkRunner.test(runner.trim())) continue; // "N/A" placeholder records

    // Subcategory values that change the rules (glitchless, difficulty) go on the card; platform and
    // version subcategories don't.
    const vars = cat.variables?.data || [];
    const subNames = [];
    for (const v of vars) {
      if (!v["is-subcategory"]) continue;
      const val = run.values?.[v.id];
      const label = val && v.values?.values?.[val]?.label;
      if (label) subNames.push(label);
    }
    let label;
    if (platformCats.has(cat.name)) {
      if (platformCatUsed) continue;
      platformCatUsed = true;
      const first = subNames[0] || "";
      label = `${/^(any%|100%)/i.test(first) ? first : "Any%"} (${cat.name})`;
    } else {
      label = cur.labels[`${game.name}|${cat.name}`];
      if (!label) {
        const keep = subNames.filter(s => subKeep.test(s) && !cat.name.toLowerCase().includes(s.toLowerCase()));
        label = keep.length ? `${cat.name} · ${keep.join(", ")}` : cat.name;
      }
    }
    if (seen.has(label)) continue;
    seen.add(label);
    const plat = (lb.platforms?.data || []).find(x => x.id === run.system?.platform);
    out.push({
      key: `${game.gid}|${label}`, group: game.gid, game: game.name, year: game.year, label,
      v: Math.round(t * 1000) / 1000, runner, date: run.date || "",
      url: run.weblink || `https://www.speedrun.com/${game.abbr}`, platform: plat?.name || ""
    });
  }
  return out;
}

export async function refresh({ fetchImpl = globalThis.fetch, limit = Infinity, delayMs = 700, log = console.log } = {}) {
  const games = read(p("data/speedrundle/games.json"), []);
  const cur = read(p("data/speedrundle/curation.json"));
  const prev = read(p("data/speedrundle/records.json"), []);
  const site = read(p("sites/speedrundle/site.json"));
  const headers = { "User-Agent": `${site.title}/1.0 (+${site.url})` };
  const junkGame = new RegExp(cur.junkGame, "i");
  const prevByGame = new Map();
  for (const r of prev) (prevByGame.get(r.group) || prevByGame.set(r.group, []).get(r.group)).push(r);

  const out = [];
  let fresh = 0, kept = 0, emptied = 0, n = 0;
  for (const game of games) {
    if (n++ >= limit) { out.push(...(prevByGame.get(game.gid) || [])); continue; }
    if (junkGame.test(game.name)) continue;
    let json = null;
    for (const embed of ["category.variables,players,platforms", "category,players,platforms"]) {
      try { json = await getJSON(`${API}/games/${game.gid}/records?${BASE}&embed=${embed}`, { fetchImpl, headers }); break; }
      catch (e) { log(`${game.name}: ${e.message} (embed=${embed})`); }
    }
    if (json) {
      const recs = recordsFromResponse(game, json, cur);
      if (recs.length) { out.push(...recs); fresh++; }
      else { emptied++; }
    } else {
      out.push(...(prevByGame.get(game.gid) || []));
      kept++;
    }
    if (delayMs) await sleep(delayMs);
  }
  const summary = `${out.length} records across ${new Set(out.map(r => r.group)).size} games (${fresh} refreshed, ${kept} kept from last run after errors, ${emptied} with nothing usable)`;
  if (out.length < prev.length * 0.8) throw new Error(`refusing to write: ${summary}; last run had ${prev.length}`);
  write(p("data/speedrundle/records.json"), out);
  log(summary);
  return { out, fresh, kept, emptied };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const i = process.argv.indexOf("--limit");
  refresh({ limit: i > 0 ? Number(process.argv[i + 1]) : Infinity }).catch(e => { console.error(e.message); process.exit(1); });
}
