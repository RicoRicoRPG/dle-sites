#!/usr/bin/env node
// Hourly: sample current Steam player counts for every app in data/peakdle/pool.json and keep the
// running maximum per UTC day in state/days/DAY.json. The state folder lives in the GitHub Actions
// cache, not in git; only closed days are committed (see peakdle-close.mjs).
//
// Steam's Web API terms allow 100,000 calls a day. 1,732 apps x 24 polls = 41,568.

import fs from "node:fs";
import { p, read, write, utcDay, now, getJSON, addDays } from "./lib.mjs";

const STATE = process.env.PEAKDLE_STATE || p("state");

export async function poll({ fetchImpl = globalThis.fetch, concurrency = 8, log = console.log } = {}) {
  const pool = read(p("data/peakdle/pool.json"), []);
  const key = process.env.STEAM_API_KEY;
  const day = utcDay(now());
  const file = `${STATE}/days/${day}.json`;
  const st = read(file, { day, polls: 0, max: {}, samples: {} });
  let ok = 0, miss = 0, i = 0;
  async function worker() {
    while (i < pool.length) {
      const { appid } = pool[i++];
      const url = `https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/?appid=${appid}` + (key ? `&key=${key}` : "");
      try {
        const j = await getJSON(url, { fetchImpl, tries: 2, timeoutMs: 15000 });
        const n = j?.response?.result === 1 ? j.response.player_count : null;
        if (typeof n === "number") {
          st.max[appid] = Math.max(st.max[appid] ?? 0, n);
          st.samples[appid] = (st.samples[appid] ?? 0) + 1;
          ok++;
        } else miss++;
      } catch { miss++; }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  st.polls++;
  write(file, st);
  // keep three days of state; older days are already closed
  const keep = new Set([0, 1, 2].map(d => addDays(day, -d) + ".json"));
  for (const f of fs.existsSync(`${STATE}/days`) ? fs.readdirSync(`${STATE}/days`) : []) if (!keep.has(f)) fs.rmSync(`${STATE}/days/${f}`);
  log(`${day} poll ${st.polls}: ${ok} sampled, ${miss} missed`);
  return { day, ok, miss };
}

if (import.meta.url === `file://${process.argv[1]}`) poll().catch(e => { console.error(e); process.exit(1); });
