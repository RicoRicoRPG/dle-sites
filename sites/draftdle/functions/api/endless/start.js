import { json, bad, readBody, validSport, overLimit } from "../../../lib/core.js";
import { clock, random, ipOf, voterOf, turnstileOk } from "../../../lib/ctx.js";
import { startRun } from "../../../lib/endless.js";

export async function onRequestPost({ request, env }) {
  try {
    const body = await readBody(request);
    if (!validSport(body.sport)) return bad("bad sport");
    const voter = await voterOf(env, body.bid);
    if (!voter) return bad("bad id");
    const ip = ipOf(request);
    if (overLimit("start:" + ip, 120)) return bad("slow down", 429);
    if (!(await turnstileOk(env, body.turnstile, ip))) return bad("check failed", 403);
    const out = await startRun(env.DB, { sport: body.sport, voter, rnd: random(env), now: clock(env) });
    return out.error ? json(out, out.status || 400) : json(out);
  } catch (e) { return bad(e.message || "error", e.status || 500); }
}
