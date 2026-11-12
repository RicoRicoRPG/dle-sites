#!/usr/bin/env node
// Weekly: refresh each Steam app's header image path in data/peakdle/pool.json from Steam's
// IStoreBrowseService/GetItems (100 apps per call), and drop apps Steam marks as adult-only or
// frequent sexual content (content descriptors 3 and 4); those can't sit next to AdSense ads.

import { p, read, write, sleep, getJSON } from "./lib.mjs";

const ADULT = new Set([3, 4]);

export async function refreshAssets({ fetchImpl = globalThis.fetch, log = console.log, delayMs = 400 } = {}) {
  const pool = read(p("data/peakdle/pool.json"), []);
  const info = new Map();
  for (let i = 0; i < pool.length; i += 100) {
    const input = { ids: pool.slice(i, i + 100).map(a => ({ appid: a.appid })), context: { language: "english", country_code: "US" }, data_request: { include_assets: true } };
    try {
      const j = await getJSON("https://api.steampowered.com/IStoreBrowseService/GetItems/v1/?input_json=" + encodeURIComponent(JSON.stringify(input)), { fetchImpl });
      for (const it of j?.response?.store_items || []) info.set(String(it.appid ?? it.id), it);
    } catch (e) { log(`batch ${i}: ${e.message}`); }
    if (delayMs) await sleep(delayMs);
  }
  const out = [], dropped = [];
  let changed = 0;
  for (const a of pool) {
    const it = info.get(String(a.appid));
    if (it && (it.content_descriptorids || []).some(d => ADULT.has(d))) { dropped.push(a.name); continue; }
    const img = it?.assets?.header || a.img || "";
    if (img !== a.img) changed++;
    out.push({ ...a, img });
  }
  if (info.size < pool.length * 0.5) throw new Error(`only ${info.size} of ${pool.length} apps answered; not writing`);
  write(p("data/peakdle/pool.json"), out);
  log(`${out.length} apps, ${changed} image paths updated, ${dropped.length} adult apps dropped${dropped.length ? ": " + dropped.join(", ") : ""}`);
  return { out, changed, dropped };
}

if (import.meta.url === `file://${process.argv[1]}`) refreshAssets().catch(e => { console.error(e.message); process.exit(1); });
