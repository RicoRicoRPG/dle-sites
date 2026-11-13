#!/usr/bin/env node
// Draftdle player pools from Wikidata (CC0). For each sport in data/draftdle/sports.json:
//   1. check every league item and headshot property against its expected English label
//   2. list the leagues' teams (P118), then every person who played for one (P54)
//   3. rank by fame (Wikipedia sitelinks, plus a bonus for any Hall of Fame), keep poolSize
//   4. fetch names, positions, career years, every team with dates, photo and league ids
//   5. cut fame tiers and write data/draftdle/<sport>/pool.json
// Runs weekly in GitHub Actions (query.wikidata.org is not reachable from every machine).
//
//   node scripts/draftdle-refresh.mjs            # all sports
//   node scripts/draftdle-refresh.mjs nba wnba   # some sports

import { p, read, write, sleep } from "./lib.mjs";

const ENDPOINT = process.env.DRAFTDLE_SPARQL || "https://query.wikidata.org/sparql";
const UA = "DraftdleBot/1.0 (https://draftdle.pages.dev; info@counterspell.dev) node-fetch";
const HOF_BONUS = 15;
const log = (...a) => console.log(...a);

export async function sparql(query, { fetchImpl = globalThis.fetch, tries = 5 } = {}) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetchImpl(ENDPOINT, {
        method: "POST",
        headers: { "User-Agent": UA, Accept: "application/sparql-results+json", "Content-Type": "application/x-www-form-urlencoded" },
        body: "query=" + encodeURIComponent(query)
      });
      if (res.status === 429 || res.status >= 500) {
        const wait = Number(res.headers.get("retry-after")) || 10 * (i + 1);
        last = new Error(`HTTP ${res.status}`);
        await sleep(process.env.DLE_FAST ? 1 : wait * 1000);
        continue;
      }
      if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`), { fatal: true });
      const j = await res.json();
      return j.results.bindings.map(b => Object.fromEntries(Object.entries(b).map(([k, v]) => [k, v.value])));
    } catch (e) {
      if (e.fatal) throw e;
      last = e;
      await sleep(process.env.DLE_FAST ? 1 : 3000 * (i + 1));
    }
  }
  throw last || new Error("query failed");
}

const qid = uri => String(uri).replace(/^.*\/entity\//, "");
// Wikidata keeps some names only as the "default for all languages" label (mul); prefer English.
const preferEn = rows => { const out = {}; for (const r of rows) { const k = qid(r.x); if (!out[k] || r.lang === "en") out[k] = r.l; } return out; };
const year = v => (v && /^-?\d{4}/.test(v) ? Number(v.slice(0, 4)) : null);
const values = ids => ids.map(id => "wd:" + id).join(" ");
const chunks = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };

// Senior teams only: college, youth, reserve and B teams are left off the card.
const NOT_SENIOR = /\b(university|college|high school|academy|youth|juniors?|reserves?|under[- ]?\d{2}|u-?\d{2}|olympic|amateur)\b|\b(II|III|B)$| (men's|women's) (basketball|ice hockey|soccer|lacrosse)$| (football|baseball|basketball|softball) team$| football$| baseball$/i;
const NATIONAL = /^(.*?) (men's |women's )?national (association |under-\d+ )?(football|soccer|basketball|ice hockey|baseball|rugby union) team$/i;

export function shortTeam(label, short) {
  const nat = NATIONAL.exec(label);
  if (nat) return nat[1];
  if (short && short.length <= 18 && short !== label) return short;
  return label;
}

export function positionOf(sport, labels) {
  const ls = labels.map(l => l.toLowerCase());
  for (const [re, abbr, grp] of sport.positions) {
    const rx = new RegExp(re, "i");
    if (ls.some(l => rx.test(l))) return { abbr, grp };
  }
  return sport.anyPosition ? { abbr: "", grp: sport.anyPosition } : null;
}

export function teamsLine(sport, stmts, leagueTeams, nowYear) {
  const rows = stmts
    .filter(s => {
      if (sport.teamsFrom === "league") return leagueTeams.has(s.team);
      if (NATIONAL.test(s.label)) return !/under|u-?\d|olympic|B team/i.test(s.label);
      return !NOT_SENIOR.test(s.label);
    })
    .map(s => ({ ...s, nat: NATIONAL.test(s.label) }))
    .sort((a, b) => (a.nat - b.nat) || ((a.start ?? 9999) - (b.start ?? 9999)) || ((a.end ?? 9999) - (b.end ?? 9999)));
  const out = [];
  for (const r of rows) { const name = shortTeam(r.label, r.short); if (out[out.length - 1] !== name && !out.includes(name)) out.push(name); }
  const club = rows.filter(r => !r.nat);
  const starts = club.map(r => r.start).filter(v => v != null);
  const ends = club.map(r => r.end).filter(v => v != null);
  const open = club.some(r => r.end == null && r.start != null && r.start >= nowYear - 25);
  return { teams: out, first: starts.length ? Math.min(...starts) : null, last: ends.length ? Math.max(...ends) : null, open };
}

export function buildPlayer(sport, raw, leagueTeams, headshots, nowYear) {
  const pos = positionOf(sport, raw.positions);
  if (!pos) return null;
  const t = teamsLine(sport, raw.teams, leagueTeams, nowYear);
  if (!t.teams.length) return null;
  const ws = raw.ws ?? t.first, we = raw.we;
  const active = !we && !raw.death && t.open;
  const end = active ? null : (we ?? t.last);
  const years = ws ? (end ? (end === ws ? String(ws) : `${ws}–${end}`) : `${ws}–present`) : "";
  const img = [];
  for (const h of headshots) if (raw.ext[h.prop]) img.push(h.url.replace("{id}", encodeURIComponent(raw.ext[h.prop])));
  if (raw.image) img.push("https://commons.wikimedia.org/wiki/Special:FilePath/" + encodeURIComponent(raw.image) + "?width=360");
  return {
    id: raw.id, name: raw.name, years, pos: pos.abbr, grp: pos.grp, teams: t.teams, img,
    commons: raw.image || "", active: active ? 1 : 0, fame: raw.sitelinks + (raw.hof ? HOF_BONUS : 0)
  };
}

export function tierOf(sport, rank) {
  const [a, b] = sport.tiers;
  return rank < a ? 1 : rank < a + b ? 2 : 3;
}

async function refreshSport(sport, nowYear, q) {
  log(`\n${sport.id}: checking ids`);
  const labels = await q(`SELECT ?x ?l (lang(?l) AS ?lang) WHERE { VALUES ?x { ${values(sport.leagues)} } ?x rdfs:label ?l FILTER(lang(?l) IN ("en", "mul")) }`);
  const byId = preferEn(labels);
  sport.leagues.forEach((id, i) => {
    if (byId[id] !== sport.leagueLabels[i]) throw new Error(`${sport.id}: ${id} is "${byId[id]}", expected "${sport.leagueLabels[i]}"`);
  });
  const headshots = [];
  if (sport.headshots.length) {
    const props = await q(`SELECT ?x ?l (lang(?l) AS ?lang) WHERE { VALUES ?x { ${sport.headshots.map(h => "wd:" + h.prop).join(" ")} } ?x rdfs:label ?l FILTER(lang(?l) IN ("en", "mul")) }`);
    const pl = preferEn(props);
    for (const h of sport.headshots) {
      if (pl[h.prop] && pl[h.prop].includes(h.expectLabel)) headshots.push(h);
      else log(`${sport.id}: skipping headshots from ${h.prop} ("${pl[h.prop]}" does not mention ${h.expectLabel})`);
    }
  }

  // Many items carry a league (seasons, games, drafts); a team is one somebody played for (P54).
  const teams = await q(`SELECT DISTINCT ?team WHERE { VALUES ?lg { ${values(sport.leagues)} } ?team wdt:P118 ?lg . FILTER EXISTS { ?x wdt:P54 ?team } }`);
  const leagueTeams = new Set(teams.map(r => qid(r.team)));
  log(`${sport.id}: ${leagueTeams.size} teams`);
  if (leagueTeams.size > 1500) throw new Error(`${sport.id}: ${leagueTeams.size} teams is far too many; check the league query`);

  const fame = new Map();
  for (const batch of chunks([...leagueTeams], 8)) {
    const rows = await q(`SELECT DISTINCT ?p ?sl WHERE { VALUES ?team { ${values(batch)} } ?p p:P54/ps:P54 ?team ; wdt:P31 wd:Q5 ; wikibase:sitelinks ?sl . }`);
    for (const r of rows) fame.set(qid(r.p), Number(r.sl));
  }
  const exclude = new Set((read(p("data/draftdle/curation.json"), {}).exclude || {})[sport.id] || []);
  const ranked = [...fame].filter(([id]) => !exclude.has(id)).sort((a, b) => b[1] - a[1]).slice(0, Math.ceil(sport.poolSize * 1.25));
  log(`${sport.id}: ${fame.size} people played for these teams; fetching details for ${ranked.length}`);

  const raw = new Map(ranked.map(([id, sl]) => [id, { id, sitelinks: sl, name: "", positions: [], teams: [], ext: {}, hof: false }]));
  const extVars = headshots.map((h, i) => `OPTIONAL { ?p wdt:${h.prop} ?x${i} }`).join(" ");
  for (const batch of chunks(ranked.map(r => r[0]), 100)) {
    const v = values(batch);
    for (const r of await q(`SELECT ?p ?l (lang(?l) AS ?lang) ?img ?ws ?we ?death ${headshots.map((_, i) => "?x" + i).join(" ")} WHERE { VALUES ?p { ${v} }
        OPTIONAL { ?p rdfs:label ?l FILTER(lang(?l) IN ("en", "mul")) } OPTIONAL { ?p wdt:P18 ?img } OPTIONAL { ?p wdt:P2031 ?ws }
        OPTIONAL { ?p wdt:P2032 ?we } OPTIONAL { ?p wdt:P570 ?death } ${extVars} }`)) {
      const o = raw.get(qid(r.p)); if (!o) continue;
      if (r.l && (!o.name || (r.lang === "en" && o.nameLang !== "en"))) { o.name = r.l; o.nameLang = r.lang; }
      if (!o.image && r.img) o.image = decodeURIComponent(r.img.replace(/^.*\/Special:FilePath\//, "")).replace(/_/g, " ");
      if (o.ws == null && r.ws) o.ws = year(r.ws);
      if (o.we == null && r.we) o.we = year(r.we);
      if (r.death) o.death = true;
      headshots.forEach((h, i) => { if (r["x" + i] && !o.ext[h.prop]) o.ext[h.prop] = r["x" + i]; });
    }
    for (const r of await q(`SELECT ?p ?pl WHERE { VALUES ?p { ${v} } ?p wdt:P413 ?pos . ?pos rdfs:label ?pl FILTER(lang(?pl) IN ("en", "mul")) }`)) {
      const o = raw.get(qid(r.p)); if (o && !o.positions.includes(r.pl)) o.positions.push(r.pl);
    }
    for (const r of await q(`SELECT ?p ?team ?tl ?short ?start ?end WHERE { VALUES ?p { ${v} } ?p p:P54 ?st . ?st ps:P54 ?team .
        ?team rdfs:label ?tl FILTER(lang(?tl) IN ("en", "mul")) OPTIONAL { ?team wdt:P1813 ?short FILTER(lang(?short) IN ("en", "mul")) }
        OPTIONAL { ?st pq:P580 ?start } OPTIONAL { ?st pq:P582 ?end } }`)) {
      const o = raw.get(qid(r.p)); if (!o) continue;
      const t = { team: qid(r.team), label: r.tl, short: r.short || "", start: year(r.start), end: year(r.end) };
      if (!o.teams.some(x => x.team === t.team && x.start === t.start)) o.teams.push(t);
    }
    for (const r of await q(`SELECT DISTINCT ?p WHERE { VALUES ?p { ${v} } ?p wdt:P166 ?aw . ?aw rdfs:label ?al FILTER(lang(?al) IN ("en", "mul") && CONTAINS(LCASE(?al), "hall of fame")) }`)) {
      const o = raw.get(qid(r.p)); if (o) o.hof = true;
    }
  }

  const players = [];
  let noPos = 0, noTeams = 0, noName = 0;
  for (const o of raw.values()) {
    if (!o.name || /^Q\d+$/.test(o.name)) { noName++; continue; }
    const pl = buildPlayer(sport, o, leagueTeams, headshots, nowYear);
    if (!pl) { if (!positionOf(sport, o.positions)) noPos++; else noTeams++; continue; }
    players.push(pl);
  }
  players.sort((a, b) => b.fame - a.fame || a.id.localeCompare(b.id));
  const pool = players.slice(0, sport.poolSize).map((pl, i) => ({ ...pl, tier: tierOf(sport, i) }));
  log(`${sport.id}: kept ${pool.length} (dropped ${noName} without a name, ${noPos} without a usable position, ${noTeams} without a listed team)`);
  return pool;
}

export async function refresh(ids = [], { q = sparql, nowYear = new Date().getUTCFullYear() } = {}) {
  const cfg = read(p("data/draftdle/sports.json"));
  const sports = cfg.sports.filter(s => !ids.length || ids.includes(s.id));
  const failed = [];
  for (const sport of sports) {
    try {
      const pool = await refreshSport(sport, nowYear, q);
      const file = p("data/draftdle", sport.id, "pool.json");
      const prev = read(file, []);
      if (pool.length < 100 || pool.length < prev.length * 0.6) throw new Error(`only ${pool.length} players (had ${prev.length}); keeping the old pool`);
      write(file, pool);
    } catch (e) {
      failed.push(sport.id);
      console.error(`${sport.id}: ${e.message}`);
    }
  }
  if (failed.length) { console.error(`failed: ${failed.join(", ")}`); process.exitCode = 1; }
}

if (import.meta.url === `file://${process.argv[1]}`) await refresh(process.argv.slice(2));
