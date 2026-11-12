#!/usr/bin/env node
// Daily, after 00:00 UTC: close yesterday's polling into data/peakdle/peaks/DAY.json (committed),
// and raise data/peakdle/alltime.json where a game set a new record. An app needs samples from at
// least two thirds of the polls that ran that day, so a game that dropped out of the API for half
// the day doesn't get a misleading low peak.

import fs from "node:fs";
import { p, read, write, utcDay, now, addDays } from "./lib.mjs";

const STATE = process.env.PEAKDLE_STATE || p("state");

export function close({ log = console.log } = {}) {
  const today = utcDay(now());
  const closed = [];
  // close any finished day still in state that hasn't been committed yet (covers a skipped run)
  const days = fs.existsSync(`${STATE}/days`) ? fs.readdirSync(`${STATE}/days`).map(f => f.replace(".json", "")).sort() : [];
  for (const day of days) {
    if (day >= today) continue;
    const out = p("data/peakdle/peaks", day + ".json");
    if (fs.existsSync(out)) continue;
    const st = read(`${STATE}/days/${day}.json`);
    const need = Math.max(1, Math.ceil(st.polls * 2 / 3));
    const peaks = {};
    for (const [appid, v] of Object.entries(st.max)) if ((st.samples[appid] ?? 0) >= need && v > 0) peaks[appid] = v;
    if (st.polls < 12) { log(`${day}: only ${st.polls} polls ran; not closing it`); continue; }
    write(out, { day, polls: st.polls, peaks });
    closed.push(day);

    const allPath = p("data/peakdle/alltime.json");
    const all = read(allPath, {});
    let raised = 0;
    for (const [appid, v] of Object.entries(peaks)) {
      if (!all[appid] || v > all[appid].v) { all[appid] = { v, day }; raised++; }
    }
    write(allPath, all);
    log(`closed ${day}: ${Object.keys(peaks).length} peaks from ${st.polls} polls, ${raised} all-time records set or raised`);
  }
  if (!closed.length) log(`nothing to close before ${today}`);
  return closed;
}

if (import.meta.url === `file://${process.argv[1]}`) close();
