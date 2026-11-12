// Offline checks. Everything runs in a temporary copy of the repo with a fake clock (DLE_NOW) and
// fake APIs built from recorded responses, so it is safe to run anywhere, including in CI before deploy.
//
//   node test/check.mjs          # full suite (~30 s)
//   node test/check.mjs --dist   # only check the already-built dist/ (used by the daily deploy)

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { JSDOM } from "jsdom";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { BANDS, ratioOf } = await import(pathToFileURL(path.join(ROOT, "src/core.mjs")));
let failures = 0, passes = 0;
const ok = (cond, msg) => { if (cond) passes++; else { failures++; console.log("FAIL " + msg); } };
const readJ = f => JSON.parse(fs.readFileSync(f, "utf8"));

// ---------- page helpers ----------
async function openPage(file, date) {
  const html = fs.readFileSync(file, "utf8");
  const dom = new JSDOM(html, { runScripts: "dangerously", url: "https://example.test/" + (date ? `?date=${date}` : ""), pretendToBeVisual: true });
  const errs = [];
  dom.window.addEventListener("error", e => errs.push(e.message));
  await new Promise(r => setTimeout(r, 30));
  return { dom, w: dom.window, d: dom.window.document, errs };
}
function playDay(pg) {
  for (let i = 0; i < 10; i++) {
    const c = pg.d.querySelector('.card[data-idx="0"]:not([disabled])');
    if (!c) return `no card at round ${i + 1}`;
    if (pg.d.querySelector(".pair .ad, .card + .ad")) return "ad slot next to the cards";
    c.click();
    const nx = pg.d.querySelector("#next");
    if (!nx) return `no next button at round ${i + 1}`;
    nx.click();
  }
  return null;
}
function checkDist(distRoot, label) {
  for (const site of ["speedrundle", "peakdle"]) {
    const dir = path.join(distRoot, site);
    for (const f of ["index.html", "about.html", "privacy.html", "404.html", "robots.txt", "sitemap.xml", "_headers", "favicon.svg", "og.png", "apple-touch-icon.png"])
      ok(fs.existsSync(path.join(dir, f)), `${label} ${site}: missing ${f}`);
    const html = fs.readFileSync(path.join(dir, "index.html"), "utf8");
    ok(!/\/\*(CORE|SITE|CONFIG|PUZZLES|POOLS)\*\/|<!--HEAD-->/.test(html), `${label} ${site}: unfilled template marker`);
    ok(/<link rel="canonical"/.test(html) && /og:image/.test(html), `${label} ${site}: missing canonical/og tags`);
  }
}

if (process.argv.includes("--dist")) {
  checkDist(path.join(ROOT, "dist"), "dist");
  for (const site of ["speedrundle", "peakdle"]) {
    const pg = await openPage(path.join(ROOT, "dist", site, "index.html"));
    ok(!pg.errs.length, `dist ${site}: script errors ${pg.errs.join("; ")}`);
    ok(pg.d.querySelectorAll("#game .card").length === 2 || pg.d.querySelector("#game .notice"), `dist ${site}: no cards and no notice`);
    pg.w.close();
  }
  console.log(failures ? `${failures} failure(s), ${passes} passed` : `dist ok (${passes} checks)`);
  process.exit(failures ? 1 : 0);
}

// ---------- temp copy ----------
const T = fs.mkdtempSync(path.join(os.tmpdir(), "dle-check-"));
for (const d of ["src", "scripts", "sites", "static", "data", "test"]) fs.cpSync(path.join(ROOT, d), path.join(T, d), { recursive: true });
fs.rmSync(path.join(T, "data/puzzles"), { recursive: true, force: true });
fs.rmSync(path.join(T, "data/peakdle/peaks"), { recursive: true, force: true });
fs.writeFileSync(path.join(T, "data/peakdle/alltime.json"), "{}");
fs.symlinkSync(path.join(ROOT, "node_modules"), path.join(T, "node_modules"));
const run = (script, env = {}, args = []) => execFileSync("node", [path.join(T, script), ...args], {
  env: { ...process.env, DLE_FAST: "1", PEAKDLE_STATE: path.join(T, "state"), ...env }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]
});
const setSite = (name, patch) => {
  const f = path.join(T, "sites", name, "site.json");
  const s = readJ(f); for (const [k, v] of Object.entries(patch)) s[k] = typeof v === "object" && !Array.isArray(v) ? { ...s[k], ...v } : v;
  fs.writeFileSync(f, JSON.stringify(s, null, 1));
};
// the lifecycle checks below assume the standard two-day Live lag, whatever the live config says
setSite("peakdle", { live: { lagDays: 2 } });

// ---------- 1. speedrun.com response parsing ----------
{
  const { recordsFromResponse } = await import(pathToFileURL(path.join(T, "scripts/speedrundle-refresh.mjs")));
  const fx = readJ(path.join(T, "test/fixtures/src-records.json"));
  const cur = readJ(path.join(T, "data/speedrundle/curation.json"));
  const sm64 = recordsFromResponse({ gid: "o1y9wo6q", name: "Super Mario 64", year: 1996, abbr: "sm64" }, fx.o1y9wo6q, cur);
  ok(sm64.length === 5 && sm64.every(r => r.runner === "Suigi" && r.platform === "Nintendo 64" && r.url.includes("/runs/")), "SM64 records parse with runner, platform and run link");
  ok(sm64.some(r => r.label === "120 Star" && r.v === 5714), "SM64 120 Star time");
  const hit = recordsFromResponse({ gid: "j1ne5891", name: "Hitman: World of Assassination", year: 2021, abbr: "hitman_woa" }, fx.j1ne5891, cur);
  ok(hit.length === 4 && !hit.some(r => /N\/A/.test(r.runner)), `Hitman: placeholder N/A runs dropped (got ${hit.length})`);
  const mc = recordsFromResponse({ gid: "yd4ovvg1", name: "Minecraft: Bedrock Edition", year: 2011, abbr: "mcbe" }, fx.yd4ovvg1, cur);
  ok(mc.length === 1 && mc[0].label === "Any% · Set Seed" && mc[0].runner === "Khalooody", `Minecraft BE: only solo Any% survives (got ${mc.map(r => r.label)})`);

  // full refresh with a fake API: three games answer, Subway Surfers keeps failing like the real one does
  const games = [
    { gid: "o1y9wo6q", name: "Super Mario 64", year: 1996, abbr: "sm64" },
    { gid: "j1ne5891", name: "Hitman: World of Assassination", year: 2021, abbr: "hitman_woa" },
    { gid: "yd4ovvg1", name: "Minecraft: Bedrock Edition", year: 2011, abbr: "mcbe" },
    { gid: "y65797de", name: "Subway Surfers", year: 2012, abbr: "subsurf" }];
  const prevAll = readJ(path.join(T, "data/speedrundle/records.json"));
  const prev = prevAll.filter(r => games.some(g => g.gid === r.group));
  fs.writeFileSync(path.join(T, "data/speedrundle/games.json"), JSON.stringify(games));
  fs.writeFileSync(path.join(T, "data/speedrundle/records.json"), JSON.stringify(prev));
  const { refresh } = await import(pathToFileURL(path.join(T, "scripts/speedrundle-refresh.mjs")));
  const calls = [];
  const fakeFetch = async (url, opts) => {
    calls.push({ url, ua: opts.headers["User-Agent"] });
    const gid = url.match(/games\/(\w+)\//)[1];
    if (gid === "y65797de") return { ok: false, status: 500, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => fx[gid] };
  };
  process.env.DLE_FAST = "1";
  const res = await refresh({ fetchImpl: fakeFetch, delayMs: 0, log: () => {} });
  const after = readJ(path.join(T, "data/speedrundle/records.json"));
  ok(res.fresh === 3 && res.kept === 1, `refresh: 3 refreshed, 1 kept (got ${res.fresh}/${res.kept})`);
  ok(after.filter(r => r.group === "y65797de").length === prev.filter(r => r.group === "y65797de").length, "refresh: failing game keeps last run's records");
  ok(calls.every(c => /^Speedrundle\/1\.0 \(\+https?:\/\//.test(c.ua)), "refresh: sends a User-Agent naming the site");
  ok(calls.every(c => c.url.startsWith("https://www.speedrun.com/api/v1/")), "refresh: uses only the documented v1 API");
  // shrink guard
  const failAll = async () => ({ ok: true, status: 200, json: async () => ({ data: [] }) });
  let threw = false;
  try { await refresh({ fetchImpl: failAll, delayMs: 0, log: () => {} }); } catch { threw = true; }
  ok(threw && readJ(path.join(T, "data/speedrundle/records.json")).length === after.length, "refresh: refuses to write a pool that shrank by more than 20%");
  fs.writeFileSync(path.join(T, "data/speedrundle/records.json"), JSON.stringify(prevAll));
  fs.cpSync(path.join(ROOT, "data/speedrundle/games.json"), path.join(T, "data/speedrundle/games.json"));
}

// ---------- 1b. Steam image paths and adult filter ----------
{
  const { refreshAssets } = await import(pathToFileURL(path.join(T, "scripts/peakdle-assets.mjs")));
  const before = readJ(path.join(T, "data/peakdle/pool.json"));
  const fake = async url => {
    const ids = JSON.parse(decodeURIComponent(url.split("input_json=")[1])).ids.map(x => x.appid);
    return { ok: true, status: 200, json: async () => ({ response: { store_items: ids.map(appid => ({ appid, success: 1,
      content_descriptorids: appid === 730 ? [2, 5] : appid === 570 ? [3] : [],
      assets: { header: appid === 730 ? "abc123/header.jpg" : "header.jpg" } })) } }) };
  };
  const r = await refreshAssets({ fetchImpl: fake, delayMs: 0, log: () => {} });
  const after = readJ(path.join(T, "data/peakdle/pool.json"));
  ok(after.find(a => a.appid === 730)?.img === "abc123/header.jpg", "assets: header path updated");
  ok(!after.some(a => a.appid === 570) && r.dropped.length === 1, "assets: adult-only app dropped");
  fs.writeFileSync(path.join(T, "data/peakdle/pool.json"), JSON.stringify(before));
}

// ---------- 2. CCUdle (internally "peakdle"): four simulated days of hourly polling ----------
const sample = readJ(path.join(T, "test/fixtures/peaks-sample.json"));
fs.writeFileSync(path.join(T, "fake-steam.mjs"), `
const sample = ${JSON.stringify(sample)};
const real = globalThis.fetch;
globalThis.fetch = async (url) => {
  const appid = new URL(url).searchParams.get("appid");
  const hour = new Date(process.env.DLE_NOW).getUTCHours();
  if (process.env.FAKE_DOWN === "1") return { ok: false, status: 503, json: async () => ({}) };
  if (!(appid in sample)) return { ok: true, status: 200, json: async () => ({ response: { result: 42 } }) };
  const f = 0.55 + 0.45 * Math.sin(Math.PI * hour / 23); // daily curve peaking mid-day
  return { ok: true, status: 200, json: async () => ({ response: { result: 1, player_count: Math.round(sample[appid] * f) } }) };
};`);
const pollScript = path.join(T, "run-poll.mjs");
fs.writeFileSync(pollScript, `import "./fake-steam.mjs"; import { poll } from "./scripts/peakdle-poll.mjs"; await poll({ log: () => {} });`);
const polls = (day, hours) => { for (const h of hours) run("run-poll.mjs", { DLE_NOW: `${day}T${String(h).padStart(2, "0")}:07:00Z` }); };
const daily = day => {
  const env = { DLE_NOW: `${day}T00:20:00Z` };
  return run("scripts/peakdle-close.mjs", env) + run("scripts/puzzles.mjs", env) + run("scripts/build.mjs", env, ["--allow-date"]);
};
const HOURS = [0, 2, 4, 6, 8, 10, 12, 13, 14, 16, 18, 20, 22]; // 13 polls a day keeps the test quick
const D = ["2026-12-01", "2026-12-02", "2026-12-03", "2026-12-04"];
polls(D[0], HOURS);
daily(D[1]);
ok(fs.existsSync(path.join(T, `data/peakdle/peaks/${D[0]}.json`)), "close: day 1 peaks committed");
const peaks1 = readJ(path.join(T, `data/peakdle/peaks/${D[0]}.json`));
const cs2 = sample["730"];
ok(peaks1.peaks["730"] <= cs2 && peaks1.peaks["730"] > cs2 * 0.95, "close: peak is the max hourly sample");
ok(!fs.existsSync(path.join(T, `data/puzzles/peakdle/live/${D[1]}.json`)), "live: no puzzle before two days of lag");
{
  const pg = await openPage(path.join(T, "dist/peakdle/index.html"), D[1]);
  ok(!pg.errs.length, "peakdle day 2: no script errors " + pg.errs.join(";"));
  // no frozen puzzle yet for Dec 2, but Dec 1 is closed: the page falls back to the newest pool
  ok(/on Tue, Dec 1/.test(pg.d.querySelector(".question")?.textContent || ""), "peakdle before a frozen puzzle: falls back to the newest closed day");
  ok(![...pg.d.querySelectorAll("#modes button")].some(b => b.textContent === "All-Time"), "All-Time hidden before enough history");
  pg.w.close();
}
// a polling outage: day 2 only gets 5 polls, so it must not close
polls(D[1], [0, 2, 4, 6, 8]);
run("run-poll.mjs", { DLE_NOW: `${D[1]}T10:07:00Z`, FAKE_DOWN: "1" });
daily(D[2]);
ok(!fs.existsSync(path.join(T, `data/peakdle/peaks/${D[1]}.json`)), "close: a day with too few polls is not closed");
polls(D[2], HOURS);
daily(D[3]);
ok(fs.existsSync(path.join(T, `data/peakdle/peaks/${D[2]}.json`)), "close: day 3 closed");
// live for D[3]+? : puzzle for date X uses peaks of X-2. D[0] peaks -> puzzle D[2]; D[2] peaks -> puzzle D[4] (made as "tomorrow" on D[3])
const p2 = path.join(T, `data/puzzles/peakdle/live/${D[2]}.json`);
ok(fs.existsSync(p2) && readJ(p2).meta.day === D[0], "live: Dec 3 puzzle uses Dec 1 peaks");
ok(readJ(path.join(T, `data/puzzles/peakdle/live/2026-12-05.json`)).meta.day === "2026-12-03", "live: normal two-day lag");
// keep going two more days so the window has live puzzles
polls(D[3], HOURS); daily("2026-12-05");
polls("2026-12-05", HOURS); daily("2026-12-06");
const live = d => path.join(T, `data/puzzles/peakdle/live/${d}.json`);
ok(fs.existsSync(live("2026-12-04")) && readJ(live("2026-12-04")).meta.day === "2026-12-01", "live: Dec 4's source day never closed, so it uses the newest earlier day");
ok(fs.existsSync(live("2026-12-06")) && readJ(live("2026-12-06")).meta.day === "2026-12-04", "live: Dec 6 puzzle uses Dec 4 peaks");
{
  const pg = await openPage(path.join(T, "dist/peakdle/index.html"), "2026-12-06");
  ok(!pg.errs.length, "peakdle Dec 6: no script errors " + pg.errs.join(";"));
  const q = pg.d.querySelector(".question")?.textContent || "";
  ok(/on Fri, Dec 4/.test(q), `peakdle: question names the source day (${q})`);
  const frozen = readJ(live("2026-12-06"));
  ok(pg.d.querySelector(".card .name").textContent === frozen.pairs[0][0].name, "peakdle: page shows the frozen puzzle");
  const first = frozen.pairs[0][0];
  const img = pg.d.querySelector('.card[data-idx="0"] .art img');
  ok(first.img ? img && img.getAttribute("src") === `https://shared.steamstatic.com/store_item_assets/steam/apps/${first.group}/${first.img}` : pg.d.querySelector('.card[data-idx="0"] .art.noimg'), "peakdle: card shows the Steam header image");
  const err = playDay(pg);
  ok(!err, "peakdle: full day plays " + (err || ""));
  const share = pg.d.querySelector("#sharetext")?.textContent || "";
  ok(/^CCUdle( Live)? #\d+ · \d+\/10\n[🟩⬛]{10}\nccudle\.com$/u.test(share), `peakdle share text: ${JSON.stringify(share)}`);
  pg.w.close();
}
// All-Time opens once history passes the threshold
setSite("peakdle", { alltime: { minTrackedDays: 3 } });
polls("2026-12-06", HOURS); daily("2026-12-07");
{
  const at = path.join(T, "data/puzzles/peakdle/alltime/2026-12-07.json");
  ok(fs.existsSync(at), "alltime: puzzle frozen once 3+ days are tracked");
  const pg = await openPage(path.join(T, "dist/peakdle/index.html"), "2026-12-07");
  const btn = [...pg.d.querySelectorAll("#modes button")].find(b => b.textContent === "All-Time");
  ok(btn, "alltime: mode button shows");
  if (btn) { btn.click(); ok(/since Dec 1, 2026/.test(pg.d.querySelector(".question")?.textContent || ""), "alltime: question says since when"); }
  pg.w.close();
}

// ---------- 3. puzzle rules over 40 simulated days of Speedrundle ----------
{
  for (let i = 0; i < 40; i++) run("scripts/puzzles.mjs", { DLE_NOW: new Date(Date.UTC(2026, 11, 1 + i, 0, 20)).toISOString() });
  const dir = path.join(T, "data/puzzles/speedrundle/daily");
  const files = fs.readdirSync(dir).sort();
  ok(files.length >= 40, `speedrundle: ${files.length} days frozen`);
  let bad = 0, relaxed = 0, repeats = 0;
  const seen = new Map();
  files.forEach((f, idx) => {
    const pz = readJ(path.join(dir, f));
    if (pz.pairs.length !== 10) bad++;
    const groups = pz.pairs.flat().map(x => x.group);
    if (new Set(groups).size !== 20) bad++;
    pz.pairs.forEach((pr, i) => { const q = ratioOf(pr[0], pr[1]); if (q <= 1) bad++; if (!(q >= BANDS[i][0] && q < BANDS[i][1])) relaxed++; });
    for (const it of pz.pairs.flat()) { const last = seen.get(it.key); if (last !== undefined && idx - last <= 30) repeats++; seen.set(it.key, idx); }
  });
  ok(!bad, `speedrundle: ${bad} rule violations across ${files.length} days`);
  ok(!repeats, `speedrundle: ${repeats} categories came back within 30 days`);
  console.log(`  speedrundle: ${files.length} days, ${relaxed}/${files.length * 10} rounds needed a relaxed band`);
  // frozen means frozen: change the data, rerun, the existing day must not change
  const f0 = path.join(dir, files[files.length - 1]);
  const before = fs.readFileSync(f0, "utf8");
  const recs = readJ(path.join(T, "data/speedrundle/records.json")).map(r => ({ ...r, v: r.v * 1.01 }));
  fs.writeFileSync(path.join(T, "data/speedrundle/records.json"), JSON.stringify(recs));
  run("scripts/puzzles.mjs", { DLE_NOW: files[files.length - 1].slice(0, 10) + "T00:20:00Z" });
  ok(fs.readFileSync(f0, "utf8") === before, "puzzles: an existing day is never rewritten");
}

// ---------- 4. build: ads off, ads on, bad config, fallback ----------
{
  const day = "2026-12-20";
  for (const n of ["speedrundle", "peakdle"]) setSite(n, { adsense: { client: "", slots: { results: "", footer: "" } } });
  run("scripts/build.mjs", { DLE_NOW: `${day}T00:20:00Z` }, ["--allow-date"]);
  checkDist(path.join(T, "dist"), "ads-off");
  ok(!fs.existsSync(path.join(T, "dist/speedrundle/ads.txt")), "ads off: no ads.txt");
  ok(!/googlesyndication|google-adsense-account/.test(fs.readFileSync(path.join(T, "dist/speedrundle/index.html"), "utf8")), "ads off: no AdSense script");

  setSite("speedrundle", { adsense: { client: "ca-pub-1234567890123456", slots: { results: "1111111111", footer: "2222222222" } }, contact: "hello@example.com" });
  run("scripts/build.mjs", { DLE_NOW: `${day}T00:20:00Z` }, ["--allow-date"]);
  const html = fs.readFileSync(path.join(T, "dist/speedrundle/index.html"), "utf8");
  ok(fs.readFileSync(path.join(T, "dist/speedrundle/ads.txt"), "utf8") === "google.com, pub-1234567890123456, DIRECT, f08c47fec0942fa0\n", "ads on: ads.txt line");
  ok(html.includes('pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-1234567890123456') && html.includes('name="google-adsense-account"'), "ads on: AdSense script and site verification meta");
  const pg = await openPage(path.join(T, "dist/speedrundle/index.html"), day);
  ok(!pg.errs.length, "speedrundle ads on: no script errors " + pg.errs.join(";"));
  ok(pg.d.querySelectorAll('ins.adsbygoogle[data-ad-slot="2222222222"]').length === 1, "ads on: footer slot rendered once");
  ok(!pg.d.querySelector('ins[data-ad-slot="1111111111"]'), "ads on: no results slot during play");
  const frozen = readJ(path.join(T, `data/puzzles/speedrundle/daily/${day}.json`));
  ok(pg.d.querySelector(".card .name").textContent === frozen.pairs[0][0].game, "speedrundle: page shows the frozen puzzle");
  ok(pg.d.querySelector('.card[data-idx="0"] .art img')?.getAttribute("src") === `https://www.speedrun.com/static/game/${frozen.pairs[0][0].group}/cover`, "speedrundle: card shows the game cover");
  const err = playDay(pg);
  ok(!err, "speedrundle: full day plays " + (err || ""));
  ok(pg.d.querySelectorAll('ins[data-ad-slot="1111111111"]').length === 1, "ads on: results slot appears after the last pair");
  ok((pg.w.adsbygoogle || []).length === 2, `ads on: each slot pushed once (${(pg.w.adsbygoogle || []).length})`);
  ok(pg.d.querySelector("[data-privacy-choices]"), "ads on: Privacy choices link");
  ok(pg.d.querySelector("[data-privacy-choices]")?.hidden, "ads on: Privacy choices link hidden until consent applies");
  const share = pg.d.querySelector("#sharetext")?.textContent || "";
  ok(/^Speedrundle #\d+ · \d+\/10\n[🟩⬛]{10}\nspeedrundle\.com$/u.test(share), `speedrundle share text: ${JSON.stringify(share)}`);
  ok(pg.d.querySelector(".hist"), "speedrundle: stats histogram");
  pg.w.close();
  const priv = fs.readFileSync(path.join(T, "dist/speedrundle/privacy.html"), "utf8");
  ok(/Third-party vendors, including Google, use cookies/.test(priv) && /adssettings\.google\.com/.test(priv) && /hello@example\.com/.test(priv), "privacy page has the AdSense disclosures and contact");

  setSite("speedrundle", { adsense: { client: "pub-123", slots: {} } });
  let threw = false;
  try { run("scripts/build.mjs", { DLE_NOW: `${day}T00:20:00Z` }); } catch { threw = true; }
  ok(threw, "build: rejects a malformed AdSense client id");
  setSite("speedrundle", { adsense: { client: "", slots: { results: "", footer: "" } } });

  // fallback: puzzles missing for the day (daily job failed) -> page still plays from the bundled pool
  run("scripts/build.mjs", { DLE_NOW: `2027-03-01T00:20:00Z` }, ["--allow-date"]);
  const fb = await openPage(path.join(T, "dist/speedrundle/index.html"), "2027-03-01");
  ok(!playDay(fb), "fallback: plays when no frozen puzzle exists");
  fb.w.close();
}

fs.rmSync(T, { recursive: true, force: true });
console.log(failures ? `${failures} failure(s), ${passes} passed` : `all ${passes} checks passed`);
process.exit(failures ? 1 : 0);
