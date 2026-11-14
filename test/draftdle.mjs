// Draftdle offline checks: Wikidata parsing, the Pages Functions on a SQLite stand-in for D1,
// the nightly job across simulated days of voting, and the built page in jsdom.
// Runs in a temporary copy of the repo. Called by test/check.mjs; also runs alone:
//   node test/draftdle.mjs

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

process.removeAllListeners("warning");
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let failures = 0, passes = 0;
const ok = (cond, msg) => { if (cond) passes++; else { failures++; console.log("FAIL draftdle: " + msg); } };
const readJ = f => JSON.parse(fs.readFileSync(f, "utf8"));

const T = fs.mkdtempSync(path.join(os.tmpdir(), "draftdle-check-"));
for (const d of ["src", "scripts", "sites", "static", "data", "test"]) if (fs.existsSync(path.join(ROOT, d))) fs.cpSync(path.join(ROOT, d), path.join(T, d), { recursive: true });
fs.rmSync(path.join(T, "data/puzzles"), { recursive: true, force: true });
fs.rmSync(path.join(T, "data/draftdle/status.json"), { force: true });
// Start from no pools: CI runs this after the real Wikidata pull has written them.
for (const d of fs.readdirSync(path.join(T, "data/draftdle"), { withFileTypes: true })) if (d.isDirectory()) fs.rmSync(path.join(T, "data/draftdle", d.name), { recursive: true, force: true });
if (fs.existsSync(path.join(ROOT, "node_modules"))) fs.symlinkSync(path.join(ROOT, "node_modules"), path.join(T, "node_modules"));
const imp = rel => import(pathToFileURL(path.join(T, rel)));

// ---------- D1 stand-in (scripts/draftdle-devdb.mjs) ----------
const { d1 } = await imp("scripts/draftdle-devdb.mjs");
const nightlyDb = db => db.nightly;

// ---------- 1. Wikidata parsing ----------
{
  const R = await imp("scripts/draftdle-refresh.mjs");
  const cfg = readJ(path.join(T, "data/draftdle/sports.json"));
  const S = Object.fromEntries(cfg.sports.map(s => [s.id, s]));
  ok(R.positionOf(S.nfl, ["quarterback"]).grp === "qb" && R.positionOf(S.nfl, ["wide receiver", "kick returner"]).abbr === "WR", "NFL positions map");
  ok(R.positionOf(S.nfl, ["head coach"]) === null, "NFL player with no playing position is dropped");
  ok(R.positionOf(S.nba, ["power forward"]).abbr === "PF" && R.positionOf(S.nba, []).grp === "all", "NBA positions map; unknown still pairs");
  ok(R.positionOf(S.mlb, ["starting pitcher"]).grp === "p" && R.positionOf(S.mlb, ["shortstop"]).grp === "h", "MLB pitchers and hitters split");
  ok(R.positionOf(S.nhl, ["goaltender"]).grp === "g" && R.positionOf(S.nhl, ["centre"]).abbr === "C", "NHL goalies and skaters split");
  ok(R.positionOf(S.soccer, ["goalkeeper"]).grp === "gk" && R.positionOf(S.soccer, ["centre-back"]).abbr === "DF", "soccer keepers and outfield split");
  ok(R.shortTeam("Argentina national football team", "") === "Argentina" && R.shortTeam("Los Angeles Lakers", "Lakers") === "Lakers", "team short names");
  const league = new Set(["Q1", "Q2", "Q3"]);
  const t = R.teamsLine(S.nba, [
    { team: "Q9", label: "Duke Blue Devils men's basketball", start: 2016, end: 2017 },
    { team: "Q2", label: "Miami Heat", short: "Heat", start: 2010, end: 2014 },
    { team: "Q1", label: "Cleveland Cavaliers", short: "Cavaliers", start: 2003, end: 2010 },
    { team: "Q1", label: "Cleveland Cavaliers", short: "Cavaliers", start: 2014, end: 2018 },
    { team: "Q3", label: "Los Angeles Lakers", short: "Lakers", start: 2018 }], league, 2026);
  ok(JSON.stringify(t.teams) === JSON.stringify(["Cavaliers", "Heat", "Lakers"]) && t.first === 2003 && t.open, `NBA teams line in order, college dropped, repeat stint once (${t.teams})`);
  const s = R.teamsLine(S.soccer, [
    { team: "Q5", label: "Argentina national football team", start: 2005 },
    { team: "Q6", label: "Argentina national under-20 football team", start: 2004, end: 2005 },
    { team: "Q7", label: "FC Barcelona B", start: 2003, end: 2004 },
    { team: "Q8", label: "FC Barcelona", short: "Barça", start: 2004, end: 2021 },
    { team: "Q10", label: "Paris Saint-Germain F.C.", short: "PSG", start: 2021, end: 2023 },
    { team: "Q11", label: "Inter Miami CF", start: 2023 }], league, 2026);
  ok(JSON.stringify(s.teams) === JSON.stringify(["Barça", "PSG", "Inter Miami CF", "Argentina"]), `soccer clubs then national team; youth and B teams dropped (${s.teams})`);
  const pl = R.buildPlayer(S.nba, { id: "Q36159", name: "LeBron James", sitelinks: 120, hof: false, ws: 2003, positions: ["small forward"], ext: { P3647: "2544" }, image: "LeBron James (51959977144) (cropped2).jpg",
    teams: [{ team: "Q1", label: "Cleveland Cavaliers", short: "Cavaliers", start: 2003, end: 2010 }, { team: "Q3", label: "Los Angeles Lakers", short: "Lakers", start: 2018 }] }, league, S.nba.headshots, 2026);
  ok(pl.years === "2003–present" && pl.active === 1 && pl.img.length === 2 && pl.img[0].includes("/2544.png") && pl.img[1].includes("Special:FilePath"), "player card: years, active, headshot then Commons");
  const ret = R.buildPlayer(S.nba, { id: "Q41421", name: "Michael Jordan", sitelinks: 150, hof: true, ws: 1984, we: 2003, positions: ["shooting guard"], ext: {}, teams: [{ team: "Q1", label: "Chicago Bulls", start: 1984, end: 1998 }] }, league, [], 2026);
  const wr = R.buildPlayer(S.nfl, { id: "Q220556", name: "Brock Lesnar", sitelinks: 60, hof: false, ws: 2000, we: 2026, positions: ["defensive tackle"], ext: {}, teams: [{ team: "Q1", label: "Chicago Bulls", start: 2004, end: 2004 }] }, league, [], 2026);
  const back = R.buildPlayer(S.nfl, { id: "Qx", name: "X", sitelinks: 60, hof: false, ws: 2010, we: 2007, positions: ["defensive tackle"], ext: {}, teams: [{ team: "Q1", label: "Chicago Bulls", start: 2007, end: 2008 }] }, league, [], 2026);
  ok(wr.years === "2004" && back.years === "2007–2008", `career dates from another career don't override team years (${wr.years}, ${back.years})`);
  const tc = R.buildPlayer(S.nfl, { id: "Q271464", name: "Terry Crews", sitelinks: 60, hof: false, ws: 1991, positions: ["linebacker"], ext: {}, teams: [{ team: "Q1", label: "Chicago Bulls", start: 1991 }, { team: "Q1", label: "Chicago Bulls", start: 1995 }] }, league, [], 2026);
  const gone = R.buildPlayer(S.nfl, { id: "Qm", name: "Frank McRae", sitelinks: 30, hof: false, ws: 1972, death: "2021", positions: ["defensive tackle"], ext: {}, teams: [{ team: "Q1", label: "Chicago Bulls" }] }, league, [], 2026);
  const coach = R.buildPlayer(S.nba, { id: "Qc", name: "Brad Stevens", sitelinks: 30, hof: false, positions: ["point guard"], ext: {}, box: { coachOnly: true }, teams: [{ team: "Q1", label: "Chicago Bulls", start: 2013 }] }, league, [], 2026);
  ok(gone.drop === "years" && coach.drop === "coach", `no playing years anywhere, or a coach-only infobox: not a card (${gone.drop}, ${coach.drop})`);
  ok(tc.years === "1991–1995" && tc.active === 0, `old career with no end dates isn't shown as present (${tc.years})`);
  ok(ret.years === "1984–2003" && ret.active === 0 && ret.fame === R.fameOf(0, 150, true) && R.fameOf(0, 150, true) > R.fameOf(0, 150, false), "retired player: closed years, Hall of Fame bonus");
  const { cardOf } = await imp("scripts/draftdle-lib.mjs");
  const both = ["https://cdn.nba.com/headshots/nba/latest/1040x760/1.png", "https://commons.wikimedia.org/wiki/Special:FilePath/X.jpg?width=360"];
  ok(cardOf({ ...ret, img: both, commons: "X.jpg" }).i[0].includes("commons") && cardOf({ ...pl, img: both, commons: "X.jpg" }).i[0].includes("cdn.nba.com"), "retired players try Commons first, active players the league headshot");

  // a full refresh against a fake query service, including a wrong league id
  const E = "http://www.wikidata.org/entity/";
  const fake = async q => {
    if (/VALUES \?x/.test(q) && /rdfs:label/.test(q)) {
      const ids = [...q.matchAll(/wd:(\w+)/g)].map(m => m[1]);
      // NBA's name comes back only as a "mul" label, as some do on Wikidata now
      return ids.map(id => ({ x: "http://www.wikidata.org/entity/" + id, lang: id === "Q155223" ? "mul" : "en", l: id === "Q155223" ? "National Basketball Association" : id === "P3647" ? "NBA.com player ID" : id === "Q2593221" ? "WNBA (wrong label)" : id }));
    }
    if (/wdt:P118/.test(q)) return [1, 2, 3].map(i => ({ team: "http://www.wikidata.org/entity/QT" + i }));
    if (/wikibase:sitelinks/.test(q)) return Array.from({ length: 160 }, (_, i) => ({ p: "http://www.wikidata.org/entity/QP" + i, sl: String(200 - i) }));
    const ids = [...q.matchAll(/wd:(QP\d+)/g)].map(m => m[1]);
    if (/P2031/.test(q)) return ids.flatMap(id => [{ p: E + id, l: "Spieler " + id, lang: "mul", ws: "2010-01-01T00:00:00Z", x0: id.slice(2), title: "Article " + id }, { p: E + id, l: "Player " + id, lang: "en" }]);
    if (/P413/.test(q)) return ids.map((id, i) => ({ p: E + id, pl: ["point guard", "center", "small forward"][i % 3] }));
    if (/P54 \?st/.test(q)) return ids.map((id, i) => ({ p: E + id, team: E + "QT" + (1 + i % 3), tl: "Team " + (1 + i % 3), start: "2010-01-01T00:00:00Z" }));
    return [];
  };
  const before = fs.existsSync(path.join(T, "data/draftdle/wnba/pool.json"));
  const errs = []; const origErr = console.error; console.error = m => errs.push(m); const origLog = console.log; console.log = () => {};
  // page views: the 20 least-linked candidates are the most viewed, so they must make the cut
  const fakeViews = async titles => new Map(titles.map(tt => { const n = Number(tt.replace(/\D/g, "")); return [tt, n >= 140 ? 5e6 : 1000]; }));
  // infobox: one retired player whose Wikidata stints are open
  const fakeBox = async (titles, kind) => kind !== "basketball" ? new Map() : new Map(titles.filter(tt => tt === "Article QP3").map(tt => [tt, { start: 2006, end: 2022, active: false }]));
  const fakePhotos = async players => new Map(players.filter(pp => pp.id === "QP3" && pp.start === 2006 && pp.end === 2022 && pp.title === "Article QP3").map(pp => [pp.id, "QP3 2010.jpg"]));
  await R.refresh(["nba", "wnba"], { q: fake, views: fakeViews, infobox: fakeBox, photos: fakePhotos, nowYear: 2026 });
  console.error = origErr; console.log = origLog; process.exitCode = 0;
  if (process.env.DEBUG) console.log(errs);
  const nba = readJ(path.join(T, "data/draftdle/nba/pool.json"));
  ok(nba.every(x => x.name.startsWith("Player ")), "an English name wins over the default-language one");
  ok(nba.length === 160 && nba.every(x => x.teams.length && x.img[0].includes("cdn.nba.com")), `fake refresh builds an NBA pool (${nba.length})`);
  ok(nba.slice(0, 20).every(x => x.views === 5e6) && nba[0].tier === 1, "page views decide fame: the most viewed lead the pool even with few language links");
  const p3 = nba.find(x => x.id === "QP3"), p4 = nba.find(x => x.id === "QP4");
  ok(p3.era === "QP3 2010.jpg" && !p4.era, "refresh passes each pool player's span and article to the photo picker");
  ok(p3.years === "2006–2022" && p3.active === 0 && p4.years === "2010–present" && p4.active === 1, `infobox years override open Wikidata stints (${p3.years}; others ${p4.years})`);
  ok(R.fameOf(1e6, 10, false) > R.fameOf(5000, 120, true), "a player a million people looked up outranks one with many languages but few readers");
  process.env.DLE_FAST = "1";
  const down = await R.enViews(Array.from({ length: 300 }, (_, i) => "T" + i), { fetchImpl: async () => { throw new Error("timeout"); } });
  const up = await R.enViews(["A b", "C"], { fetchImpl: async u => ({ ok: true, status: 200, json: async () => ({ items: [{ views: u.includes("A_b") ? 7 : 3 }, { views: 5 }] }) }) });
  let bTries = 0;
  const flaky = await R.enViews(Array.from({ length: 120 }, (_, i) => "P" + i), { fetchImpl: async u => {
    if (u.includes("/P7/") && bTries++ < 3) return { ok: false, status: 429 };
    return { ok: true, status: 200, json: async () => ({ items: [{ views: 2 }] }) };
  } });
  const g = [{ sitelinks: 10, views: 100 }, { sitelinks: 12, views: 120 }, { sitelinks: 80, views: 9000 }, { sitelinks: 82, views: 11000 }, { sitelinks: 81 }, { sitelinks: 11 }];
  const nG = R.guessViews(g, 2);
  delete process.env.DLE_FAST;
  ok(flaky.get("P7") === 2 && flaky.size === 120, "page views: a rate-limited title is picked up by the second pass");
  ok(nG === 2 && g[4].views >= 9000 && g[4].viewsGuess && g[5].views <= 120, "a failed lookup is estimated from players with similar language counts, not zeroed");
  ok(down.size === 0 && up.get("A b") === 12 && up.get("C") === 8, "page views: summed per title; a dead service falls back instead of stalling");
  ok(errs.some(e => /Q2593221 is "WNBA \(wrong label\)"/.test(e)) && fs.existsSync(path.join(T, "data/draftdle/wnba/pool.json")) === before, "a league id with the wrong label stops that sport and keeps its old pool");
}

// ---------- 1a. career years from Wikipedia infoboxes ----------
{
  const I = await imp("scripts/draftdle-infobox.mjs");
  const kindOf = t => /gridiron|NFL biography/i.test(t) ? "gridiron" : /basketball/i.test(t) ? "basketball" : /baseball/i.test(t) ? "baseball" : /ice hockey/i.test(t) ? "hockey" : "soccer";
  const y = (t, kind = kindOf(t), now = 2026, leagues = []) => { const r = I.infoboxYears(t, kind, now, leagues); return !r ? "none" : r.coachOnly ? "coach" : `${r.start}-${r.end} ${r.active}`; };
  const cases = [
    ["Sue Bird (basketball)", "{{Short description|x}}\n{{Infobox basketball biography\n| name = Sue Bird\n| team = Seattle Storm\n| career_start = 2002\n| career_end = 2022<ref>{{cite web|title=Retires 2023}}</ref>\n| years1 = {{WNBA Year|2002}}–{{WNBA Year|2022}}\n| years2 = 2004–2006\n}}\n'''Suzanne Bird'''", "2002-2022 false"],
    ["active basketball, no end", "{{Infobox basketball biography\n| name = Darius Garland\n| career_start = 2019\n| career_end = \n| years1 = {{NBA Year|2019}}–present\n}}", "2019-null true"],
    ["blank career fields, seasons only", "{{Infobox basketball biography\n| career_start = \n| career_end = \n| coach_start = 2000\n| years1 = {{WNBA Year|1997}}\n| team1 = [[Sacramento Monarchs]]\n| years2 = {{WNBA Year|1998}}\n| team2 = [[Detroit Shock]]\n| cyears1 = 2000–2002\n}}", "1997-1998 false"],
    ["Jeter (baseball)", "{{Infobox baseball biography\n| name = Derek Jeter\n| debutleague = MLB\n| debutdate = May 29\n| debutyear = 1995\n| finaldate = September 28\n| finalyear = 2014\n}}", "1995-2014 false"],
    ["active baseball", "{{Infobox baseball biography\n| name = Luis Arráez\n| debutdate = May 18\n| debutyear = 2019\n| debutteam = Minnesota Twins\n}}", "2019-null true"],
    ["Brady (gridiron)", "{{Infobox gridiron football biography\n| name = Tom Brady\n| draft_year = 2000\n| past_teams =\n* [[New England Patriots]] ({{NFL Year|2000|2019}})\n* [[Tampa Bay Buccaneers]] ({{NFL Year|2020|2022}})\n| highlights =\n* 3× [[NFL Most Valuable Player]] (2007, 2010, 2017)\n}}", "2000-2022 false"],
    ["Crews: draft year and highlights ignored", "{{Infobox gridiron football biography\n| name = Terry Crews\n| draft_year = 1991\n| past_teams =\n* [[Los Angeles Rams]] ({{NFL Year|1991}})*\n* [[Green Bay Packers]] ({{NFL Year|1992}})*\n* [[Philadelphia Eagles]] ({{NFL Year|1996}})\n}}", "1991-1996 false"],
    ["active gridiron", "{{Infobox gridiron football biography\n| name = Travis Kelce\n| current_team = Kansas City Chiefs\n| status = Active\n| past_teams =\n* [[Kansas City Chiefs]] ({{NFL Year|2013}}–present)\n}}", "2013-null true"],
    ["one-season current stint, status says active", "{{Infobox gridiron football biography\n| status = Active\n| past_teams =\n* [[Denver Broncos]] ({{NFL Year|2025}})\n}}", "2025-null true"],
    ["coach: current_team alone isn't playing", "{{Infobox gridiron football biography\n| name = Deion Sanders\n| current_team = Colorado Buffaloes\n| past_teams =\n* [[Atlanta Falcons]] ({{NFL Year|1989|1993}})\n* [[Baltimore Ravens]] ({{NFL Year|2004|2005}})\n| coach_teams =\n* [[Colorado Buffaloes|Colorado]] (2023–present)\n}}", "1989-2005 false"],
    ["Messi (soccer), open last club; youth and national team ignored", "{{Infobox football biography\n| name = Lionel Messi\n| youthyears1 = 1994–2000\n| years1 = 2003–2004\n| clubs1 = [[FC Barcelona C|Barcelona C]]\n| years3 = 2004–2021\n| years4 = 2021–2023\n| years5 = 2023–\n| clubs5 = [[Inter Miami CF]]\n| nationalyears1 = 2005–\n}}", "2003-null true"],
    ["retired soccer, manager years ignored", "{{Infobox football biography\n| years1 = 1975–1987\n| years2 = 1987–1991\n| years3 = 1991–1993\n| years4 = 1993–1995\n| manageryears1 = 1991–1993\n| manageryears2 = 2006–2008\n}}", "1975-1995 false"],
    ["hockey career_end present", "{{Infobox ice hockey player\n| name = X\n| career_start = 2005\n| career_end = present\n}}", "2005-null true"],
    ["stale article: 'active' since 1980 isn't trusted", "{{Infobox ice hockey player\n| career_start = 1980\n}}", "1980-null null"],
    ["Giannis: only NBA seasons count", "{{Infobox basketball biography\n| career_start = 2011\n| years1 = 2011–2013\n| team1 = [[Filathlitikos]]\n| years2 = {{NBA Year|2013}}–present\n| team2 = [[Milwaukee Bucks]]\n}}", "2013-null true", ["NBA"]],
    ["short season templates: {{nbay|2025|end}} is 2026", "{{Infobox basketball biography\n| career_start = 2011\n| years1 = 2011–2013\n| team1 = [[EFAO Zografou B.C.|Filathlitikos]]\n| years2 = {{nbay|2013|start}}–{{nbay|2025|end}}\n| team2 = [[Milwaukee Bucks]]\n| years3 = {{nbay|2026|start}}–present\n| team3 = [[Miami Heat]]\n}}", "2013-null true", ["NBA", "BAA"]],
    ["short templates, retired", "{{Infobox basketball biography\n| career_start = 2004\n| years1 = 2004–2006\n| team1 = [[Some Club]]\n| years2 = {{nbay|2006|start}}–{{nbay|2011|end}}\n| team2 = [[Boston Celtics]]\n| years3 = {{wnbay|2013|start}}\n}}", "2006-2012 false", ["NBA", "BAA"]],
    ["WNBA rows, overseas winters ignored", "{{Infobox basketball biography\n| career_start = 2002\n| career_end = 2022\n| years1 = {{WNBA Year|2002}}–{{WNBA Year|2022}}\n| team1 = [[Seattle Storm]]\n| years2 = 2004–2006\n| team2 = [[Dynamo Moscow]]\n| years3 = 2023–2024\n| team3 = [[Some Club]]\n}}", "2002-2022 false", ["WNBA"]],
    ["NFL seasons only, UFL and XFL ignored", "{{Infobox gridiron football biography\n| past_teams =\n* [[Tampa Bay Buccaneers]] ({{NFL Year|2008|2011}})\n* [[Sacramento Mountain Lions]] ([[2012 UFL season|2012]])\n* [[Los Angeles Wildcats]] ({{XFL Year|2020}})\n* [[Baltimore Ravens]] ({{NFL Year|2021}})\n* [[DC Defenders]] ({{UFL Year|2024|2025}})\n}}", "2008-2021 false", ["NFL", "AFL"]],
    ["no league template anywhere: all rows count", "{{Infobox gridiron football biography\n| past_teams =\n* [[Miami Dolphins]] ([[1968 American Football League season|1968]]–[[1974 NFL season|1974]])\n* [[New York Giants]] ([[1976 NFL season|1976]]–[[1978 NFL season|1978]])\n}}", "1968-1978 false", ["NFL", "AFL"]],
    ["coach only: coaching career, no playing seasons", "{{Infobox basketball biography\n| career_position = Point guard\n| coach_start = 2001\n| cyears1 = 2007–2013\n| cteam1 = [[Butler Bulldogs]]\n}}", "coach", []],
    ["no career_end but the rows end", "{{Infobox basketball biography\n| career_start = 1999\n| years1 = 1999–2001\n| team1 = [[Cleveland Rockers]]\n| years2 = 2002–2010\n| team2 = [[Washington Mystics]]\n| cyears1 = 2014–present\n| cteam1 = [[Some College]]\n}}", "1999-2010 false", ["WNBA"]],
    ["unmarked rows don't override career_start", "{{Infobox basketball biography\n| career_start = 2009\n| career_end = 2020\n| years1 = 1996–2004\n| team1 = [[Youth Club]]\n| years2 = 2009–2020\n| team2 = [[Perfumerías Avenida]]\n}}", "2009-2020 false", ["WNBA"]],
    ["NFL coach: records but no playing teams", "{{Infobox NFL biography\n| name = Brian Flores\n| current_team = Miami Dolphins\n| career_position = Head coach\n| regular_record = 24–25\n| pfr_coach = FlorBr0\n}}", "coach", ["NFL"]],
    ["not a sport infobox", "{{Infobox person\n| name = Bob\n| years_active = 1990–2000\n}}", "none"],
  ];
  const yc = (t, lg) => y(t, kindOf(t), 2026, lg || []);
  const bad = cases.filter(([, t, want, lg]) => yc(t, lg) !== want).map(([n, t, want, lg]) => `${n}: got ${yc(t, lg)}, want ${want}`);
  const thorpe = "{{Infobox gridiron football biography\n| past_teams =\n* [[Canton Bulldogs]] (1915–1928)\n}}\n{{Infobox baseball biography\n| debutyear = 1913\n| finalyear = 1919\n}}";
  const deion = "{{Infobox gridiron football biography\n| past_teams =\n* [[Atlanta Falcons]] ({{NFL Year|1989|1993}})\n}}";
  if (y(thorpe, "baseball") !== "1913-1919 false" || y(thorpe, "gridiron") !== "1915-1928 false" || y(deion, "baseball") !== "none") bad.push(`two-sport athletes: ${y(thorpe, "baseball")} / ${y(thorpe, "gridiron")} / ${y(deion, "baseball")}`);
  ok(!bad.length, `infobox career years across sports (${bad.join("; ") || cases.length + " cases"})`);

  process.env.DLE_FAST = "1";
  const asked = [];
  const got = await I.infoboxes(["Jeter", "rondo", "Gone"], "baseball", { nowYear: 2026, fetchImpl: async (u, o) => {
    asked.push(String(o.body));
    return { ok: true, status: 200, json: async () => ({ query: {
      normalized: [{ from: "rondo", to: "Rondo" }], redirects: [{ from: "Rondo", to: "Rajon Rondo" }],
      pages: [
        { title: "Jeter", revisions: [{ slots: { main: { content: cases[3][1] } } }] },
        { title: "Rajon Rondo", revisions: [{ slots: { main: { content: "{{Infobox baseball biography\n| debutyear = 2006\n| finalyear = 2022\n}}" } } }] },
        { title: "Gone", missing: true }] } }) };
  } });
  let tries = 0;
  const dead = await I.infoboxes(["A"], "baseball", { fetchImpl: async () => { tries++; throw new Error("down"); } });
  delete process.env.DLE_FAST;
  const box = y0 => ({ slots: { main: { content: `{{Infobox baseball biography\n| debutyear = ${y0}\n| finalyear = ${y0 + 5}\n}}` } } });
  let calls = 0;
  const split = await I.infoboxes(["A1", "A2", "Bad", "A3", "A4"], "baseball", { fetchImpl: async (u, o) => {
    calls++;
    const ts = new URLSearchParams(String(o.body)).get("titles").split("|");
    if (ts.includes("Bad")) return { ok: false, status: 414 };
    const cont = new URLSearchParams(String(o.body)).get("rvcontinue");
    // the first answer carries only the first title; the rest come through the continuation
    const pages = (cont ? ts.slice(1) : ts.slice(0, 1)).map((t, k) => ({ title: t, revisions: [box(1990 + k)] }));
    return { ok: true, status: 200, json: async () => ({ query: { pages }, ...(cont || ts.length === 1 ? {} : { continue: { rvcontinue: "x", continue: "||" } }) }) };
  } });
  ok(split.size === 4 && !split.has("Bad") && calls < 15, `infoboxes: a failing batch is split until only the bad title is lost, continuations followed (${split.size} of 5, ${calls} calls)`);
  ok(asked.length === 1 && /rvsection=0/.test(asked[0]) && got.get("Jeter")?.end === 2014 && got.get("rondo")?.end === 2022 && !got.has("Gone"), "infoboxes: 50 titles a request, answers mapped back through redirects");
  ok(dead.size === 0 && tries === 4, "infoboxes: an unreachable Wikipedia leaves Wikidata's years in place");
}

// ---------- 1c. a photo from the playing years ----------
{
  const P = await imp("scripts/draftdle-photos.mjs");
  ok(P.surname("Ken Griffey Jr.") === "griffey" && P.surname("Luka Dončić") === "doncic" && P.surname("Jack Hughes (ice hockey)") === "hughes", "surnames: suffixes, accents and disambiguators dropped");
  ok(P.photoYear({ DateTimeOriginal: { value: "2011-09-12 13:05:00" } }, "x.jpg") === 2011 && P.photoYear({}, "Tom Brady 2007.jpg") === 2007 && P.photoYear({ ImageDescription: { value: "<p>Brady in <b>2004</b></p>" } }, "x.jpg") === 2004 && P.photoYear({}, "x.jpg") === null, "photo year: Commons date, then the title, then the description");
  const brady = { name: "Tom Brady", start: 2000, end: 2022, active: false };
  const c = (file, year, extra = {}) => ({ file, year, width: 800, height: 1000, text: "", ...extra });
  ok(P.choosePhoto(brady, [c("Tom Brady red carpet 2024.jpg", 2024, { p18: true }), c("Tom Brady 2011.jpg", 2011), c("Gillette Stadium.jpg", 2010)]) === "Tom Brady 2011.jpg", "a retired player's photo comes from his playing years, not a recent red carpet");
  const oj = { name: "O. J. Simpson", start: 1969, end: 1979, teams: ["Bills", "49ers"] };
  ok(P.choosePhoto(oj, [c("O.J. Simpson Medical Center 1969.jpg", 1969, { text: "Simpson in a television episode" }), c("O. J. Simpson 1973.jpg", 1973, { text: "Simpson with the Bills" })]) === "O. J. Simpson 1973.jpg", "a game photo with his team beats a TV appearance from the same years");
  const deion = { name: "Deion Sanders", start: 1989, end: 2005, teams: ["Falcons", "49ers", "Cowboys"] };
  ok(P.choosePhoto(deion, [c("Deion Sanders Braves 1993.jpg", 1993), c("Deion Sanders Cowboys 1996.jpg", 1996)]) === "Deion Sanders Cowboys 1996.jpg", "a two-sport player's NFL card prefers an NFL team photo");
  ok(P.choosePhoto(brady, [c("Brady statue 2015.jpg", 2015), c("Tom Brady signature.jpg", 2010), c("Patriots huddle.jpg", 2005, { text: "Tom Brady calls a play" })]) === "Patriots huddle.jpg", "statues and signatures are skipped; a caption naming him counts");
  ok(P.choosePhoto({ name: "Chan Ho Park", start: 1994, end: 2010 }, [c("Chan Ho Park pitching 2002.jpg", 2002)]) === "Chan Ho Park pitching 2002.jpg", "a surname like Park isn't mistaken for a ballpark");
  ok(P.choosePhoto(brady, [c("Tom Brady 1995.jpg", 1995), c("Tom Brady.svg", 2010), c("Someone else 2010.jpg", 2010)]) === null, "nothing from his career that names him: no pick");
  ok(P.choosePhoto({ name: "Caitlin Clark", start: 2024, end: null, active: true }, [c("Caitlin Clark Fever 2025.jpg", 2025), c("Caitlin Clark Iowa 2022.jpg", 2022)], 2026) === "Caitlin Clark Fever 2025.jpg", "an active player's college photo isn't a career photo");

  process.env.DLE_FAST = "1";
  const era = await P.eraPhotos([{ id: "Q1", name: "Tom Brady", title: "Tom Brady", start: 2000, end: 2022, active: false, commons: "Tom Brady red carpet 2024.jpg" }], { nowYear: 2026, fetchImpl: async (u, o) => {
    const q = new URLSearchParams(String(o.body));
    if (q.get("prop") === "images") return { ok: true, status: 200, json: async () => ({ query: { pages: [{ title: "Tom Brady", images: [{ title: "File:Tom Brady 2011.jpg" }, { title: "File:Tom Brady 2009 local.jpg" }, { title: "File:Patriots logo.svg" }] }] } }) };
    const files = q.get("titles").split("|");
    return { ok: true, status: 200, json: async () => ({ query: { pages: files.map(t => ({ title: t, imagerepository: /local/.test(t) ? "local" : "shared", imageinfo: [{ width: 900, height: 1200, extmetadata: { DateTimeOriginal: { value: (t.match(/\d{4}/) || ["2024"])[0] } } }] })) } }) };
  } });
  delete process.env.DLE_FAST;
  ok(era.get("Q1") === "Tom Brady 2011.jpg", `eraPhotos: article photos dated and chosen; English Wikipedia's own (non-free) files skipped (${era.get("Q1")})`);

  const { cardOf, commonsUrl } = await imp("scripts/draftdle-lib.mjs");
  const head = "https://a.espncdn.com/i/headshots/nfl/players/full/2330.png", p18 = commonsUrl("Tom Brady red carpet 2024.jpg");
  const ret = cardOf({ id: "Q1", name: "Tom Brady", active: 0, img: [head, p18], commons: "Tom Brady red carpet 2024.jpg", era: "Tom Brady 2011.jpg" });
  const act = cardOf({ id: "Q2", name: "X", active: 1, img: [head, p18], commons: "x.jpg", era: "Tom Brady 2011.jpg" });
  ok(ret.i[0] === commonsUrl("Tom Brady 2011.jpg") && ret.i.length === 3 && act.i[0] === head && act.i[1] === commonsUrl("Tom Brady 2011.jpg") && act.i[2] === p18, "cards: retired lead with the career photo; active keep the league headshot first, then the career photo");
}

// ---------- 1b. placeDense keeps slots dense and writes only what moved ----------
{
  const { placeDense } = await imp("scripts/draftdle-nightly.mjs");
  let seed2 = 7; const r2 = () => { seed2 = (seed2 * 16807) % 2147483647; return seed2 / 2147483647; };
  let okAll = true, small = true;
  for (let t = 0; t < 300; t++) {
    const pool = Array.from({ length: 40 }, (_, i) => "k" + i);
    const prevKeys = pool.filter(() => r2() < 0.5);
    const prev = prevKeys.map((key, idx) => ({ key, idx, v: 1 }));
    const wantKeys = pool.filter(k => prevKeys.includes(k) ? r2() < 0.8 : r2() < 0.3);
    const want = new Map(wantKeys.map(k => [k, { v: 1 }]));
    const { put, drop, size } = placeDense(prev, want, (a, b) => a.v === b.v);
    const slots = []; prev.forEach(p => slots[p.idx] = p.key);
    for (const [i] of put) slots[i] = null;
    const keyOf = new Map(); for (const [i, w] of put) keyOf.set(i, w.key);
    for (const [i, k] of keyOf) slots[i] = k;
    if (drop !== null) slots.length = drop;
    const live = slots.slice(0, size);
    if (size !== wantKeys.length || live.some(x => !x) || new Set(live).size !== size || !wantKeys.every(k => live.includes(k))) okAll = false;
    const changed = wantKeys.filter(k => !prevKeys.includes(k)).length + prevKeys.filter(k => !wantKeys.includes(k)).length;
    if (put.length > changed) small = false;
  }
  ok(okAll, "placeDense: slots stay 0..n-1 and hold exactly the wanted rows");
  ok(small, "placeDense: writes no more slots than rows that came or went");
}

// ---------- 2. synthetic pools ----------
// Two sports with small tiers so a simulated crowd can open them in a few "days".
const SPORTS = [
  { id: "nba", name: "NBA", group: "US leagues", wave: 1, tiers: [40, 60], poolSize: 160, positions: [], anyPosition: "all" },
  { id: "nfl", name: "NFL", group: "US leagues", wave: 1, tiers: [40, 60], poolSize: 160, positions: [] }
];
fs.writeFileSync(path.join(T, "data/draftdle/sports.json"), JSON.stringify({ sports: SPORTS }));
const truth = new Map();
for (const s of SPORTS) {
  const pool = [];
  for (let i = 0; i < 160; i++) {
    const id = `Q${s.id}${i}`;
    truth.set(id, Math.exp((160 - i) / 40 + (((i * 7919) % 13) - 6) / 20));
    pool.push({ id, name: `${s.id.toUpperCase()} Player ${i}`, years: i % 3 ? "2015–present" : "1990–2004", pos: s.id === "nfl" ? (i % 2 ? "QB" : "WR") : ["PG", "SG", "SF", "PF", "C"][i % 5],
      grp: s.id === "nfl" ? (i % 2 ? "qb" : "skill") : "all", teams: ["Hawks", "Celtics", "Nets", "Hornets", "Bulls", "Cavaliers", "Mavericks", "Nuggets", "Pistons", "Warriors"].slice(0, 1 + (i * 3) % 9), img: [], commons: "", active: i % 3 ? 1 : 0, fame: 500 - i, tier: i < 40 ? 1 : i < 100 ? 2 : 3 });
  }
  fs.mkdirSync(path.join(T, "data/draftdle", s.id), { recursive: true });
  fs.writeFileSync(path.join(T, "data/draftdle", s.id, "pool.json"), JSON.stringify(pool));
}

// ---------- 3. functions + nightly over simulated days ----------
fs.mkdirSync(path.join(T, "state"), { recursive: true });
const db = d1(path.join(T, "state/draftdle-dev.sqlite"));
const N = await imp("scripts/draftdle-nightly.mjs");
const E = await imp("sites/draftdle/lib/endless.js");
const routes = {
  start: (await imp("sites/draftdle/functions/api/endless/start.js")).onRequestPost,
  pick: (await imp("sites/draftdle/functions/api/endless/pick.js")).onRequestPost,
  end: (await imp("sites/draftdle/functions/api/endless/end.js")).onRequestPost,
  votes: (await imp("sites/draftdle/functions/api/votes.js")).onRequestPost,
  name: (await imp("sites/draftdle/functions/api/name.js")).onRequestPost,
  board: (await imp("sites/draftdle/functions/api/leaderboard.js")).onRequestGet
};
let clockMs = Date.parse("2027-01-01T12:00:00Z");
let seed = 12345;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const env = {
  DB: db, VOTER_KEY: "test", __now: () => clockMs, __rnd: rnd,
  ASSETS: { fetch: async req => { const u = new URL(req.url); const m = u.pathname.match(/^\/d\/(\w+)\/(\d{4}-\d{2}-\d{2})\.json$/); const f = m && path.join(T, "data/puzzles/draftdle", m[1], m[2] + ".json");
    return f && fs.existsSync(f) ? new Response(fs.readFileSync(f, "utf8"), { status: 200 }) : new Response("no", { status: 404 }); } }
};
const call = async (fn, body, ip = "1.1.1.1") => {
  const res = await fn({ request: new Request("https://draftdle.test/api", { method: "POST", body: JSON.stringify(body), headers: { "cf-connecting-ip": ip } }), env });
  return { status: res.status, body: await res.json() };
};
const bidOf = i => "browser-" + String(i).padStart(12, "0");
const night = async day => { E.clearCache(); const out = await N.nightly({ db: nightlyDb(db), log: () => {}, stateFile: path.join(T, "state/totals.json"), today: day }); E.clearCache(); return out; };
const status = () => readJ(path.join(T, "data/draftdle/status.json"));

// A voter with noisy knowledge of the true strengths.
const decide = (cards, noise = 0.25) => {
  const [a, b] = cards.map(c => Math.log(truth.get(c.id)) + (rnd() - 0.5) * 2 * noise * 4);
  return a >= b ? 0 : 1;
};
async function session(sport, voter, picks, { noise = 0.25, msPerPick = 4000 } = {}) {
  const ip = `10.${voter >> 16 & 255}.${voter >> 8 & 255}.${voter & 255}`;
  const st = await call(routes.start, { sport, bid: bidOf(voter) }, ip);
  if (st.status !== 200) return { error: st.body };
  let run = st.body.run, next = st.body.next, last = null;
  for (let i = 0; i < picks && next; i++) {
    clockMs += msPerPick;
    const r = await call(routes.pick, { run, bid: bidOf(voter), side: decide(next.cards, noise) }, ip);
    if (r.status !== 200) return { error: r.body };
    last = r.body; next = r.body.next;
  }
  return { start: st.body, last };
}

{
  // before any nightly run the sport is unknown to the API
  const r = await call(routes.start, { sport: "nba", bid: bidOf(1) });
  ok(r.status === 404, "start before the first nightly run: unknown sport");
  ok((await call(routes.start, { sport: "nba", bid: "short" })).status === 400, "a malformed browser id is refused");
}

let day = "2027-01-01";
await night(day);
ok(status().sports.nba.phase === "scouting" && status().sports.nba.tiersOpen === 0, "a sport with no votes starts in scouting");
{
  const s = await session("nba", 1, 30);
  ok(s.start && s.start.phase === "scouting" && s.start.next.nowin && s.start.next.cards.length === 2, "scouting run serves a no-winner question with two cards");
  ok(s.last && s.last.reveal.nowin && s.last.stats.scored === 0 && typeof s.last.reveal.left === "number", "scouting picks are unscored and show the split so far");
  const c = s.start.next.cards[0];
  ok(c.n && "y" in c && "p" in c && Array.isArray(c.t) && Array.isArray(c.i), "cards carry name, years, position, teams, images");
}

// Scouting: crowds vote until the headliners are covered and the sport opens.
const advance = async (n = 1) => { for (let i = 0; i < n; i++) { day = new Date(Date.parse(day) + 864e5).toISOString().slice(0, 10); clockMs = Date.parse(day + "T12:00:00Z"); await night(day); } };
let voterNo = 10;
for (let d = 0; d < 12 && status().sports.nba.phase !== "open"; d++) {
  for (let v = 0; v < 40; v++) await session("nba", voterNo++, 25);
  await advance();
}
const opened = status().sports.nba;
ok(opened.phase === "open" && opened.tiersOpen >= 1, `NBA opens after scouting (phase ${opened.phase}, tiers ${opened.tiersOpen}, votes ${opened.votes})`);
const sp = db.raw.prepare("SELECT * FROM sports WHERE sport = 'nba'").get();
ok(sp.n_cand + sp.n_settled > 0, `open sport has scored pairs to serve (${sp.n_cand} cand, ${sp.n_settled} settled)`);
ok(status().sports.nfl.phase === "scouting", "a sport nobody voted on stays in scouting");

// Open play: rounds are mostly scored, about 1 in 5 no-winner while players still need votes, never two in a row.
{
  const st = await call(routes.start, { sport: "nba", bid: bidOf(500) });
  let run = st.body.run, next = st.body.next, prevNowin = next.nowin, twoInRow = false, nowin = 0, total = 0;
  for (let i = 0; i < 200 && next; i++) {
    clockMs += 3000;
    const r = await call(routes.pick, { run, bid: bidOf(500), side: decide(next.cards, 0.1) });
    next = r.body.next; total++;
    if (next && next.nowin) { nowin++; if (prevNowin) twoInRow = true; }
    if (next) prevNowin = next.nowin;
    if (i === 199) {
      ok(r.body.stats.scored > 120 && r.body.stats.pct > 60, `open run is scored and a sharp voter agrees with the crowd (${r.body.stats.scored} scored, ${r.body.stats.pct}%)`);
    }
  }
  const share = nowin / total;
  ok(!twoInRow, "no two no-winner questions in a row");
  ok(sp.n_collect === 0 ? share === 0 : share > 0.05 && share < 0.3, `no-winner share in an open sport (${(share * 100).toFixed(0)}%, collect ${sp.n_collect})`);
}

// Boards: milestones post, streaks post, ranks come back, names get set and filtered.
{
  const b = await call(routes.start, { sport: "nba", bid: bidOf(600) });
  let run = b.body.run, next = b.body.next, entered = [], named = null;
  for (let i = 0; i < 70 && next; i++) {
    clockMs += 3000;
    const r = await call(routes.pick, { run, bid: bidOf(600), side: decide(next.cards, 0.05) });
    if (r.body.entered.length) { entered.push(...r.body.entered); named = r.body.named; }
    next = r.body.next;
  }
  ok(entered.some(e => e.board === "pct25") && entered.some(e => e.board === "pct50"), `a run that reaches 25 and 50 scored picks posts to both boards (${entered.map(e => e.board)})`);
  ok(named === false, "the server says when a board entry has no name yet");
  ok((await call(routes.name, { bid: bidOf(600), name: "Scout_One" })).status === 200, "a clean name is accepted");
  ok((await call(routes.name, { bid: bidOf(601), name: "xx nigga xx" })).status === 422 && (await call(routes.name, { bid: bidOf(601), name: "Raccoon Grapes" })).status === 200, "the blocklist catches slurs, not ordinary words");
  ok((await call(routes.name, { bid: bidOf(601), name: "<script>" })).status === 422, "names with markup are refused");
  const lbRes = await routes.board({ request: new Request("https://draftdle.test/api/leaderboard?sport=nba"), env });
  const lb = (await lbRes.json()).boards;
  ok(lb.pct25.length >= 1 && lb.pct25.some(e => e.name === "Scout_One") && lb.pct25.every((e, i, a) => !i || a[i - 1].value >= e.value), "leaderboard: named entry, sorted best first");
  ok(Object.keys(lb).length === 7, "seven boards per sport");
}

// Pace check: a bot answering faster than a second a pick is hidden from the boards.
{
  const s = await session("nba", 700, 60, { noise: 0.05, msPerPick: 300 });
  ok(s.last && s.last.flagged, "a run averaging 0.3 s a pick is flagged");
  const rows = db.raw.prepare("SELECT hidden FROM boards b JOIN runs r ON r.id = b.run WHERE r.flagged = 1").all();
  ok(rows.every(r => r.hidden === 1), "a flagged run's board entries are hidden");
}

// Runs: a stranger can't answer someone else's run; idle runs expire; end works.
{
  const st = await call(routes.start, { sport: "nba", bid: bidOf(800) });
  ok((await call(routes.pick, { run: st.body.run, bid: bidOf(801), side: 0 })).status === 404, "another browser can't answer this run");
  clockMs += 31 * 60 * 1000;
  ok((await call(routes.pick, { run: st.body.run, bid: bidOf(800), side: 0 })).body.expired === true, "a run idle for 30 minutes has ended");
  const st2 = await call(routes.start, { sport: "nba", bid: bidOf(800) });
  await call(routes.end, { run: st2.body.run, bid: bidOf(800) });
  ok((await call(routes.pick, { run: st2.body.run, bid: bidOf(800), side: 0 })).status === 409, "an ended run takes no more picks");
  const dupBefore = db.raw.prepare("SELECT COUNT(*) n FROM votes").get().n;
  const st3 = await call(routes.start, { sport: "nba", bid: bidOf(800) });
  const p1 = await call(routes.pick, { run: st3.body.run, bid: bidOf(800), side: 0 });
  const p2 = await call(routes.pick, { run: st3.body.run, bid: bidOf(800), side: 0 });
  ok(p1.status === 200 && p2.status === 200 && db.raw.prepare("SELECT COUNT(*) n FROM votes").get().n <= dupBefore + 2, "each tap stores at most one vote per pair per browser");
}

// Keep voting until the Daily opens, then check the frozen puzzles.
for (let d = 0; d < 25 && !status().sports.nba.dailyEpoch; d++) {
  for (let v = 0; v < 40; v++) await session("nba", voterNo++, 40);
  await advance();
}
const ds = status().sports.nba;
ok(!!ds.dailyEpoch, `NBA Daily opens once enough pairs have crowd verdicts (eligible ${ds.eligible})`);
if (ds.dailyEpoch) {
  for (let i = 0; i < 6; i++) { for (let v = 0; v < 30; v++) await session("nba", voterNo++, 40); await advance(); }
  const dir = path.join(T, "data/puzzles/draftdle/nba");
  const files = fs.readdirSync(dir).sort();
  ok(files.length >= 5, `Daily puzzles frozen day after day (${files.length})`);
  const pz = readJ(path.join(dir, files[files.length - 2]));
  ok(pz.pairs.length === 10 && pz.no >= 1, "a Daily has ten pairs and a number");
  ok(pz.pairs.every(q => q.share >= 0.55 && q.votes >= 25 && (q.winner === 0 || q.winner === 1) && q.cards.length === 2), "every Daily pair has a crowd verdict of 55%+ on enough votes");
  const ids = pz.pairs.flatMap(q => [q.lo, q.hi]);
  ok(new Set(ids).size === 20, "each player once per Daily");
  ok(pz.pairs.slice(0, 3).every(q => q.share >= pz.pairs[9].share), "warm-up rounds are at least as lopsided as the last round");
  const all = files.map(f => readJ(path.join(dir, f)));
  const seenPairs = new Set(); let repeat = false;
  for (const f of all) for (const q of f.pairs) { const k = q.lo + "|" + q.hi; if (seenPairs.has(k)) repeat = true; seenPairs.add(k); }
  ok(!repeat, "no pair repeats across Dailies");
  const before = readJ(path.join(dir, files[0]));
  await night(day);
  ok(JSON.stringify(readJ(path.join(dir, files[0]))) === JSON.stringify(before), "a frozen Daily never changes");

  // Daily votes: only the frozen pairs count.
  const today = files.find(f => f.startsWith(day)) ? day : files[files.length - 2].slice(0, 10);
  clockMs = Date.parse(today + "T15:00:00Z");
  const todays = readJ(path.join(dir, today + ".json"));
  const picks = todays.pairs.map(q => ({ a: q.cards[0].id, b: q.cards[1].id, pick: q.cards[q.winner].id }));
  picks.push({ a: "Qnba1", b: "Qnba2", pick: "Qnba1" });
  const v = await call(routes.votes, { sport: "nba", date: today, bid: bidOf(900), picks });
  ok(v.status === 200 && v.body.stored === 10, `Daily votes: the ten frozen pairs stored, the stray pair ignored (${v.body.stored})`);
  const v2 = await call(routes.votes, { sport: "nba", date: today, bid: bidOf(900), picks });
  ok(v2.status === 200 && db.raw.prepare("SELECT COUNT(*) n FROM votes WHERE voter = (SELECT voter FROM votes WHERE mode = 'daily' LIMIT 1) AND mode = 'daily'").get().n === 10, "sending the same Daily twice doesn't double the votes");
  ok((await call(routes.votes, { sport: "nba", date: "2030-01-01", bid: bidOf(900), picks })).status === 400, "votes for a future day are refused");
}

// Brigade: a burst that swings one pair gets it flagged and held out.
{
  const row = db.raw.prepare("SELECT lo, hi, SUM(pick = 0) a, COUNT(*) n FROM votes WHERE sport = 'nba' GROUP BY lo, hi ORDER BY n DESC LIMIT 1").get();
  const minority = row.a / row.n >= 0.5 ? 1 : 0;
  const ins = db.raw.prepare("INSERT OR IGNORE INTO votes (sport, lo, hi, pick, mode, day, voter) VALUES ('nba', ?, ?, ?, 'endless', ?, ?)");
  for (let i = 0; i < 400; i++) ins.run(row.lo, row.hi, minority, day, "brigade" + i);
  await advance();
  const f = db.raw.prepare("SELECT * FROM flags WHERE sport = 'nba' AND lo = ? AND hi = ?").get(row.lo, row.hi);
  ok(!!f, "a pair swung by a burst of votes is flagged");
  ok(!db.raw.prepare("SELECT 1 FROM serve WHERE sport = 'nba' AND lo = ? AND hi = ?").get(row.lo, row.hi), "a flagged pair is no longer served");
}

// A second nightly run on the same day writes nothing.
{
  const before = db.raw.prepare("SELECT total_changes() AS c").get().c;
  await night(day);
  ok(db.raw.prepare("SELECT total_changes() AS c").get().c - before <= 12, "a repeat nightly run writes (almost) nothing");
}

// Cost per Endless pick, by the stand-in's counters (Claude's measure, not Cloudflare's billing).
{
  const s0 = db.stats();
  const s = await session("nba", 950, 50);
  const s1 = db.stats();
  const perPick = (s1.writes - s0.writes) / 50;
  ok(s.last && perPick <= 4, `D1 write statements per Endless pick stay small (${perPick.toFixed(2)})`);
}

// ---------- 4. the built page in jsdom ----------
{
  const { JSDOM } = await import("jsdom");
  const pz = fs.readdirSync(path.join(T, "data/puzzles/draftdle/nba")).sort();
  const date = pz[pz.length - 2].slice(0, 10);
  execFileSync("node", [path.join(T, "scripts/build.mjs"), "--allow-date"], { env: { ...process.env, DLE_NOW: date + "T00:20:00Z" }, stdio: "ignore" });
  const html = fs.readFileSync(path.join(T, "dist/draftdle/index.html"), "utf8");
  ok(!/\/\*(BASECSS|SITE|SPORTS|STATUS|PUZZLES)\*\//.test(html), "page: every template marker filled");
  clockMs = Date.parse(date + "T15:00:00Z");
  const sent = [];
  const fakeFetch = async (url, opts = {}) => {
    const u = new URL(url, "https://draftdle.test");
    const body = opts.body ? JSON.parse(opts.body) : null;
    if (body) sent.push({ path: u.pathname, body });
    const route = { "/api/endless/start": routes.start, "/api/endless/pick": routes.pick, "/api/endless/end": routes.end, "/api/votes": routes.votes, "/api/name": routes.name }[u.pathname];
    const res = route ? await route({ request: new Request(u, { method: "POST", body: opts.body, headers: { "cf-connecting-ip": "9.9.9.9" } }), env })
      : u.pathname === "/api/leaderboard" ? await routes.board({ request: new Request(u), env }) : new Response("{}", { status: 404 });
    return { ok: res.ok, status: res.status, json: () => res.json() };
  };
  const dom = new JSDOM(html, { runScripts: "dangerously", url: `https://draftdle.test/?date=${date}`, pretendToBeVisual: true,
    beforeParse(w) { w.fetch = fakeFetch; w.localStorage.setItem("draftdle.seenHelp", "1"); } });
  const errs = []; dom.window.addEventListener("error", e => errs.push(e.message));
  const w = dom.window, d = w.document, wait = ms => new Promise(r => setTimeout(r, ms));
  await wait(30);
  ok(d.querySelectorAll(".tile").length === 2 && /Daily #\d+ ready/.test(d.querySelector('[data-sport="nba"]').textContent), "page: sport tiles, NBA shows today's Daily");
  ok(/Scouting/.test(d.querySelector('[data-sport="nfl"]').textContent), "page: a scouting sport says so on its tile");
  d.querySelector('[data-sport="nba"]').click();
  for (let i = 0; i < 10; i++) {
    const c = d.querySelector('.card[data-idx="0"]:not([disabled])');
    if (!c) { ok(false, `page: no card at Daily round ${i + 1}`); break; }
    c.click();
    if (i === 0) ok(/%$/.test(d.querySelector('.card[data-idx="0"] .value').textContent) && /of \d+ picked/.test(d.querySelector(".verdict").textContent), "page: reveal shows the crowd split and the vote count");
    d.querySelector("#next").click();
  }
  await wait(20);
  const share = d.querySelector("pre.share");
  ok(share && /^Draftdle NBA #\d+ · \d+\/10\n[🟩⬛]{10}\n/u.test(share.textContent), `page: Daily share string (${share && share.textContent.split("\n")[0]})`);
  ok(sent.some(x => x.path === "/api/votes" && x.body.picks.length === 10), "page: the Daily sends its ten votes in one batch");
  w.document.querySelector("#modal-x").click();
  d.querySelector('[data-mode="endless"]').click();
  await wait(30);
  ok(d.querySelectorAll("#game .card").length === 2 && d.querySelector(".runbar"), "page: Endless shows a pair and the run bar");
  d.querySelector('.card[data-idx="1"]').click();
  await wait(30);
  ok(d.querySelector("#next") && /crowd|No winner/.test(d.querySelector(".verdict").textContent), "page: an Endless pick comes back with a reveal");
  d.querySelector("#next").click();
  ok(d.querySelectorAll('#game .card:not([disabled])').length === 2, "page: the next Endless pair is ready without another request");
  d.querySelector("#end-run").click();
  ok(/Run over/.test(d.querySelector("#game").textContent), "page: End run shows the run summary");
  d.querySelector('[data-mode="boards"]').click();
  await wait(30);
  ok(d.querySelectorAll(".lb tr").length >= 1, "page: boards list entries");
  ok(!errs.length, "page: no script errors " + errs.join("; "));
  w.close();
}

console.log(failures ? `draftdle: ${failures} failure(s), ${passes} passed` : `draftdle: all ${passes} checks passed`);
if (process.env.KEEP) console.log(`kept ${T} at ${day}`); else fs.rmSync(T, { recursive: true, force: true });
export const result = { failures, passes, T };
if (import.meta.url === `file://${process.argv[1]}`) process.exit(failures ? 1 : 0);
