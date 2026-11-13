#!/usr/bin/env node
// Daily: freeze the puzzles for yesterday, today and tomorrow (UTC) into data/puzzles/SITE/MODE/DATE.json.
// A puzzle file is never rewritten once it exists, so a data refresh can't change a day people are
// already playing. Players' local dates span UTC-12 to UTC+14, which is why three days are kept ready.

import fs from "node:fs";
import { p, read, write, utcDay, now, addDays, sites } from "./lib.mjs";
import { generate } from "../src/core.mjs";

const fmtDay = iso => new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

export function peakDays() {
  const dir = p("data/peakdle/peaks");
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).map(f => f.slice(0, 10)).sort() : [];
}

function withTop10(items) {
  const top = new Set([...items].sort((a, b) => b.v - a.v).slice(0, 10).map(x => x.group));
  return items.map(x => ({ ...x, top10: top.has(x.group) }));
}

// The pool a mode would play on `date`, plus the meta the page shows with it. null = no puzzle possible.
export function poolFor(site, mode, date) {
  if (site.name === "speedrundle") {
    return { items: read(p("data/speedrundle/records.json"), []), meta: {} };
  }
  const apps = new Map(read(p("data/peakdle/pool.json"), []).map(a => [String(a.appid), a]));
  const card = (appid, v, extra = {}) => {
    const a = apps.get(String(appid));
    return a && { key: String(appid), group: Number(appid), name: a.name, genre: a.genre, free: a.free, img: a.img || "", v, ...extra };
  };
  if (mode === "live") {
    // Normally the day that ended lagDays before; if that day never closed (a polling outage),
    // the newest closed day within three days before it.
    let day = null, f = null;
    for (let back = 0; back <= 3 && !f; back++) {
      day = addDays(date, -site.live.lagDays - back);
      f = read(p("data/peakdle/peaks", day + ".json"), null);
    }
    if (!f) return null;
    const items = Object.entries(f.peaks).filter(([, v]) => v >= site.live.minPeak).map(([id, v]) => card(id, v)).filter(Boolean);
    return { items: withTop10(items), meta: { day } };
  }
  if (mode === "alltime") {
    const days = peakDays();
    const seedName = site.alltime.seed;
    if (!seedName && days.length < site.alltime.minTrackedDays) return null;
    const merged = new Map();
    if (seedName) for (const [id, s] of Object.entries(read(p("data/peakdle", `seed-${seedName}.json`), {}))) merged.set(id, { v: s.v, when: s.when });
    for (const [id, r] of Object.entries(read(p("data/peakdle/alltime.json"), {}))) {
      if (!merged.has(id) || r.v > merged.get(id).v) merged.set(id, { v: r.v, when: fmtDay(r.day) });
    }
    const items = [...merged].filter(([, r]) => r.v >= site.alltime.minPeak).map(([id, r]) => card(id, r.v, { when: r.when })).filter(Boolean);
    return { items: withTop10(items), meta: seedName ? {} : { since: days[0] } };
  }
  return null;
}

// Draftdle freezes its own puzzles in scripts/draftdle-nightly.mjs, from crowd votes.
export function modesFor(site) {
  if (site.name === "draftdle") return [];
  return site.name === "speedrundle" ? ["daily"] : ["live", "alltime"];
}

const pairRuleFor = site => site.name === "peakdle" ? (a, b) => !(a.top10 && b.top10) : null;

export function freeze({ log = console.log } = {}) {
  const today = utcDay(now());
  const made = [];
  for (const site of sites()) {
    for (const mode of modesFor(site)) {
      for (const date of [addDays(today, -1), today, addDays(today, 1)]) {
        const file = p("data/puzzles", site.name, mode, date + ".json");
        if (fs.existsSync(file)) continue;
        const pool = poolFor(site, mode, date);
        if (!pool) continue;
        // keep recently used categories or games out
        const exclude = new Set();
        for (let d = 1; d <= site.puzzles.noRepeatDays; d++) {
          const prev = read(p("data/puzzles", site.name, mode, addDays(date, -d) + ".json"), null);
          if (!prev) continue;
          for (const pair of prev.pairs) for (const it of pair) exclude.add(site.puzzles.noRepeatBy === "group" ? "g:" + it.group : it.key);
        }
        const pairs = generate(pool.items, `${site.name}:${mode}:${date}`, { exclude, pairRule: pairRuleFor(site) });
        if (pairs.length < 10) { log(`${site.name}/${mode} ${date}: only ${pairs.length} pairs from ${pool.items.length} items; skipped`); continue; }
        write(file, { date, mode, meta: pool.meta, pairs });
        made.push(`${site.name}/${mode}/${date}`);
      }
    }
  }
  log(made.length ? `froze ${made.join(", ")}` : "no new puzzles needed");
  return made;
}

if (import.meta.url === `file://${process.argv[1]}`) freeze();
