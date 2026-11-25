#!/usr/bin/env node
// Daily, after 00:00 UTC: close each finished UTC day into data/peakdle/peaks/DAY.json (committed),
// and raise data/peakdle/alltime.json where a game set a new record.
//
// Two sources, in order:
//   1. Our own hourly polling (state/days/DAY.json), if at least 12 polls ran that day. An app needs
//      samples from two thirds of those polls, so a game that dropped out of the API for half the
//      day doesn't get a misleading low peak.
//   2. SteamCharts' hourly series (steamcharts.com/app/ID/chart-data.json) for every pool app.
//      GitHub runs the hourly poll only a few times a day, so in practice most days close from here.
//      An app needs 16 of the day's 24 hourly samples. A day closes only if most apps answered.
//
// Days up to a week back are retried, so a missed run or a SteamCharts outage heals itself.

import fs from "node:fs";
import { p, read, write, utcDay, now, addDays, sleep, getJSON } from "./lib.mjs";

const STATE = process.env.PEAKDLE_STATE || p("state");
const LOOKBACK = 7;
const SC_MIN_SAMPLES = 16;
const SC_MIN_SHARE = 0.6;

function commit(day, polls, peaks, source, log) {
  write(p("data/peakdle/peaks", day + ".json"), source ? { day, polls, source, peaks } : { day, polls, peaks });
  const allPath = p("data/peakdle/alltime.json");
  const all = read(allPath, {});
  let raised = 0;
  for (const [appid, v] of Object.entries(peaks)) {
    if (!all[appid] || v > all[appid].v) { all[appid] = { v, day }; raised++; }
  }
  write(allPath, all);
  log(`closed ${day}${source ? ` from ${source}` : ""}: ${Object.keys(peaks).length} peaks from ${polls} samples, ${raised} all-time records set or raised`);
}

// Hourly max and sample count per app for each of `days`, from SteamCharts. Returns null if
// SteamCharts is switched off (tests) or unreachable.
export async function steamchartsDays(days, { fetchImpl = globalThis.fetch, log = console.log, concurrency = 6 } = {}) {
  const base = process.env.PEAKDLE_STEAMCHARTS ?? "https://steamcharts.com";
  if (!base || base === "off") return null;
  const want = new Set(days);
  const ids = read(p("data/peakdle/pool.json"), []).map(a => a.appid);
  const out = Object.fromEntries(days.map(d => [d, {}]));
  let answered = 0, failed = 0;
  const q = [...ids];
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (q.length) {
      const id = q.shift();
      try {
        const series = await getJSON(`${base}/app/${id}/chart-data.json`, { fetchImpl, tries: 3, headers: { "User-Agent": "ccudle.com daily close (info@counterspell.dev)" } });
        answered++;
        for (const [t, v] of series) {
          const d = new Date(t).toISOString().slice(0, 10);
          if (!want.has(d)) continue;
          const e = out[d][id] || (out[d][id] = { max: 0, n: 0 });
          e.n++; if (v > e.max) e.max = v;
        }
      } catch (e) {
        failed++;
        if (failed === 1 || failed % 100 === 0) log(`steamcharts: app ${id}: ${e.message} (${failed} failed so far)`);
        // a blocked or down site fails every request; stop early instead of waiting on all of them
        if (failed >= 50 && answered === 0) { q.length = 0; }
      }
      if (process.env.DLE_FAST !== "1") await sleep(50);
    }
  }));
  log(`steamcharts: ${answered} of ${ids.length} apps answered`);
  return { byDay: out, answered, total: ids.length };
}

export async function close({ log = console.log, fetchImpl } = {}) {
  const today = utcDay(now());
  const closed = [];
  const isClosed = day => fs.existsSync(p("data/peakdle/peaks", day + ".json"));
  const stateDays = fs.existsSync(`${STATE}/days`) ? fs.readdirSync(`${STATE}/days`).map(f => f.replace(".json", "")) : [];
  const recent = Array.from({ length: LOOKBACK }, (_, i) => addDays(today, -1 - i));
  const days = [...new Set([...stateDays, ...recent])].filter(d => d < today && !isClosed(d)).sort();

  const fallback = [];
  for (const day of days) {
    const st = read(`${STATE}/days/${day}.json`, null);
    if (st && st.polls >= 12) {
      const need = Math.max(1, Math.ceil(st.polls * 2 / 3));
      const peaks = {};
      for (const [appid, v] of Object.entries(st.max)) if ((st.samples[appid] ?? 0) >= need && v > 0) peaks[appid] = v;
      commit(day, st.polls, peaks, null, log);
      closed.push(day);
    } else {
      if (st) log(`${day}: only ${st.polls} polls ran; trying SteamCharts`);
      if (recent.includes(day)) fallback.push(day);
    }
  }

  if (fallback.length) {
    const sc = await steamchartsDays(fallback, { fetchImpl, log });
    if (sc && sc.answered >= sc.total * SC_MIN_SHARE) {
      for (const day of fallback) {
        const peaks = {};
        for (const [appid, e] of Object.entries(sc.byDay[day])) if (e.n >= SC_MIN_SAMPLES && e.max > 0) peaks[appid] = e.max;
        if (Object.keys(peaks).length < sc.total * SC_MIN_SHARE) { log(`${day}: SteamCharts had full data for only ${Object.keys(peaks).length} apps; not closing it`); continue; }
        commit(day, 24, peaks, "steamcharts", log);
        closed.push(day);
      }
    } else if (sc) {
      log(`steamcharts: too few apps answered; leaving ${fallback.join(", ")} open`);
    }
  }
  if (!closed.length) log(`nothing to close before ${today}`);
  return closed.sort();
}

if (import.meta.url === `file://${process.argv[1]}`) close().catch(e => { console.error(e.message); process.exit(1); });
