import { json, bad, validSport } from "../../lib/core.js";
import { leaderboard } from "../../lib/endless.js";

// Top 100 per board, cached at the edge for five minutes.
export async function onRequestGet({ request, env, waitUntil }) {
  const url = new URL(request.url);
  const sport = url.searchParams.get("sport");
  if (!validSport(sport)) return bad("bad sport");
  const cache = typeof caches !== "undefined" ? caches.default : null;
  const key = new Request(url.origin + "/api/leaderboard?sport=" + sport);
  if (cache) { const hit = await cache.match(key); if (hit) return hit; }
  const res = json({ sport, boards: await leaderboard(env.DB, sport) }, 200, { "cache-control": "public, max-age=300" });
  if (cache) { const put = cache.put(key, res.clone()); if (waitUntil) waitUntil(put); else await put; }
  return res;
}
