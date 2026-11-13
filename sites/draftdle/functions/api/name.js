import { json, bad, readBody, cleanName, overLimit } from "../../lib/core.js";
import { clock, ipOf, voterOf } from "../../lib/ctx.js";

// Set or change the display name shown on the boards for this browser.
export async function onRequestPost({ request, env }) {
  try {
    const body = await readBody(request, 1024);
    const voter = await voterOf(env, body.bid);
    if (!voter) return bad("bad id");
    if (overLimit("name:" + ipOf(request), 30)) return bad("slow down", 429);
    const name = cleanName(body.name);
    if (!name) return bad("Use 3–16 letters, numbers, spaces or underscores, and keep it clean.", 422);
    await env.DB.prepare("INSERT INTO names (voter, name, hidden, at) VALUES (?, ?, 0, ?) ON CONFLICT (voter) DO UPDATE SET name = excluded.name, at = excluded.at")
      .bind(voter, name, clock(env)).run();
    return json({ ok: true, name });
  } catch (e) { return bad(e.message || "error", e.status || 500); }
}
