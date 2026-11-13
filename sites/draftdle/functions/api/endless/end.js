import { json, bad, readBody } from "../../../lib/core.js";
import { voterOf } from "../../../lib/ctx.js";
import { endRun } from "../../../lib/endless.js";

export async function onRequestPost({ request, env }) {
  try {
    const body = await readBody(request);
    const voter = await voterOf(env, body.bid);
    if (!voter || typeof body.run !== "string") return bad("bad request");
    return json(await endRun(env.DB, { runId: body.run, voter }));
  } catch (e) { return bad(e.message || "error", e.status || 500); }
}
