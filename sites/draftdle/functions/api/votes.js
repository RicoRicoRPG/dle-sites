import { json, bad, readBody, validSport, overLimit, pairOf, utcDay, addDays } from "../../lib/core.js";
import { clock, ipOf, voterOf } from "../../lib/ctx.js";

// Daily (and archive) votes, sent as one batch after the last round. Each pair must belong to the
// frozen puzzle for that sport and date, which the build publishes at /d/<sport>/<date>.json.
export async function onRequestPost({ request, env }) {
  try {
    const body = await readBody(request, 8192);
    if (!validSport(body.sport) || !/^\d{4}-\d{2}-\d{2}$/.test(body.date || "")) return bad("bad request");
    const voter = await voterOf(env, body.bid);
    if (!voter) return bad("bad id");
    if (!Array.isArray(body.picks) || !body.picks.length || body.picks.length > 25) return bad("bad picks");
    if (overLimit("votes:" + ipOf(request), 200)) return bad("slow down", 429);
    const now = clock(env), today = utcDay(now);
    if (body.date > addDays(today, 1)) return bad("future date");
    const archive = body.date < addDays(today, -1);
    const res = await env.ASSETS.fetch(new Request(new URL(`/d/${body.sport}/${body.date}.json`, request.url)));
    if (!res.ok) return bad("no puzzle", 404);
    const puzzle = await res.json();
    const allowed = new Set(puzzle.pairs.map(p => p.lo + "|" + p.hi));
    const stmts = [];
    for (const p of body.picks) {
      if (!p || typeof p.a !== "string" || typeof p.b !== "string" || (p.pick !== p.a && p.pick !== p.b)) continue;
      const [lo, hi] = pairOf(p.a, p.b);
      if (!allowed.has(lo + "|" + hi)) continue;
      stmts.push(env.DB.prepare("INSERT OR IGNORE INTO votes (sport, lo, hi, pick, mode, day, voter) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .bind(body.sport, lo, hi, p.pick === lo ? 0 : 1, archive ? "archive" : "daily", today, voter));
    }
    if (stmts.length) await env.DB.batch(stmts);
    return json({ ok: true, stored: stmts.length });
  } catch (e) { return bad(e.message || "error", e.status || 500); }
}
