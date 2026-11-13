import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const p = (...xs) => path.join(ROOT, ...xs);
export const read = (f, d) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : d);
export const write = (f, v, pretty = false) => {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, pretty ? JSON.stringify(v, null, 1) + "\n" : JSON.stringify(v) + "\n");
};
export const sleep = ms => new Promise(r => setTimeout(r, ms));
export const utcDay = (d = new Date()) => d.toISOString().slice(0, 10);
export const addDays = (iso, n) => new Date(Date.parse(iso + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);

// The jobs read "now" from DLE_NOW when it is set, so tests can replay a week in seconds.
export const now = () => (process.env.DLE_NOW ? new Date(process.env.DLE_NOW) : new Date());

export function sites() {
  return ["speedrundle", "peakdle", "draftdle"].map(name => ({ ...read(p("sites", name, "site.json")), dir: p("sites", name) }));
}

// fetch with a timeout and retries. speedrun.com answers 420 when hit too fast.
export async function getJSON(url, { fetchImpl = globalThis.fetch, headers = {}, tries = 4, timeoutMs = 30000, log = () => {} } = {}) {
  let last;
  for (let i = 0; i < tries; i++) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, { headers, signal: ctl.signal });
      clearTimeout(t);
      if (res.status === 420 || res.status === 429) { log(`rate limited (${res.status}), waiting`); await sleep(process.env.DLE_FAST ? 1 : 45000); continue; }
      if (res.status >= 500) { last = new Error(`HTTP ${res.status}`); await sleep(process.env.DLE_FAST ? 1 : 3000 * (i + 1)); continue; }
      if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { fatal: true });
      return await res.json();
    } catch (e) {
      clearTimeout(t);
      if (e.fatal) throw e;
      last = e;
      await sleep(process.env.DLE_FAST ? 1 : 2000 * (i + 1));
    }
  }
  throw last || new Error("request failed");
}
