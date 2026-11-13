// Shared helpers for Draftdle's Pages Functions. Also imported by the nightly job and the tests,
// so nothing here may depend on Workers-only globals beyond `crypto`.

export const BOARDS = [25, 50, 100, 250, 500, 1000];
export const BOARD_IDS = [...BOARDS.map(n => "pct" + n), "streak"];
export const IDLE_MS = 30 * 60 * 1000;
export const MIN_STREAK_FOR_BOARD = 5;
export const PACE_MIN_PICKS = 25;
export const PACE_MS_PER_PICK = 1000;
export const TOP_N = 100;

export const utcDay = (ms = Date.now()) => new Date(ms).toISOString().slice(0, 10);
export const addDays = (iso, n) => new Date(Date.parse(iso + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);

export function pairOf(a, b) { return a < b ? [a, b] : [b, a]; }
export function pairKey(a, b) { const [lo, hi] = pairOf(a, b); return lo + "|" + hi; }

export function validBid(bid) { return typeof bid === "string" && /^[A-Za-z0-9_-]{16,64}$/.test(bid); }
export function validSport(s) { return typeof s === "string" && /^[a-z0-9]{2,16}$/.test(s); }

export async function hashVoter(bid, key = "") {
  const data = new TextEncoder().encode((key || "draftdle") + ":" + bid);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(buf)].slice(0, 16).map(b => b.toString(16).padStart(2, "0")).join("");
}

export function newId() {
  const b = crypto.getRandomValues(new Uint8Array(12));
  return [...b].map(x => x.toString(16).padStart(2, "0")).join("");
}

// Display names: 3-16 letters, numbers, spaces or underscores. The blocklist catches the common
// slurs and their spaced or digit-swapped spellings; hidden-names.json in the repo handles the rest.
// Fragments are chosen so ordinary words (raccoon, grapes, spicy) still pass.
const BLOCK = ["nigg", "nigga", "fagg", "faggot", "kike", "retard", "tranny", "wetback", "chink", "hitler", "kkk", "nazi", "rapist"];
export function cleanName(raw) {
  if (typeof raw !== "string") return null;
  const name = raw.replace(/\s+/g, " ").trim();
  if (!/^[A-Za-z0-9_ ]{3,16}$/.test(name)) return null;
  const flat = name.toLowerCase().replace(/[\s_]/g, "").replace(/0/g, "o").replace(/1/g, "i").replace(/3/g, "e").replace(/4/g, "a").replace(/5/g, "s").replace(/7/g, "t");
  if (BLOCK.some(w => flat.includes(w))) return null;
  return name;
}

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers } });
}
export function bad(msg, status = 400) { return json({ error: msg }, status); }

export async function readBody(request, max = 4096) {
  const text = await request.text();
  if (text.length > max) throw Object.assign(new Error("too large"), { status: 413 });
  try { return JSON.parse(text); } catch { throw Object.assign(new Error("bad json"), { status: 400 }); }
}

// Best-effort per-IP cap inside one isolate. Cloudflare can run many isolates, so this is a
// speed bump; a rate-limiting rule on /api/* is the real cap (see the README).
const hits = new Map();
export function overLimit(ip, limit, windowMs = 3600e3, now = Date.now()) {
  if (!ip) return false;
  let h = hits.get(ip);
  if (!h || now - h.t > windowMs) { h = { t: now, n: 0 }; hits.set(ip, h); }
  h.n++;
  if (hits.size > 5000) hits.clear();
  return h.n > limit;
}
