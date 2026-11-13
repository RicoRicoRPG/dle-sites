import { json, bad, readBody, overLimit } from "../../../lib/core.js";
import { clock, random, ipOf, voterOf } from "../../../lib/ctx.js";
import { pickInRun } from "../../../lib/endless.js";

export async function onRequestPost({ request, env }) {
  try {
    const body = await readBody(request);
    if (typeof body.run !== "string" || !/^[a-f0-9]{24}$/.test(body.run)) return bad("bad run");
    if (body.side !== 0 && body.side !== 1) return bad("bad side");
    const voter = await voterOf(env, body.bid);
    if (!voter) return bad("bad id");
    if (overLimit("pick:" + ipOf(request), 1500)) return bad("slow down", 429);
    const out = await pickInRun(env.DB, { runId: body.run, voter, side: body.side, rnd: random(env), now: clock(env) });
    return out.error ? json(out, out.status || 400) : json(out);
  } catch (e) { return bad(e.message || "error", e.status || 500); }
}
