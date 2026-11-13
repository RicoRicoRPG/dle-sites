// Request context shared by the routes. Tests inject a clock and a seeded random through env.
import { hashVoter, validBid } from "./core.js";

export function clock(env) { return env.__now ? env.__now() : Date.now(); }
export function random(env) { return env.__rnd || Math.random; }
export function ipOf(request) { return request.headers.get("cf-connecting-ip") || ""; }

export async function voterOf(env, bid) {
  if (!validBid(bid)) return null;
  return hashVoter(bid, env.VOTER_KEY || "");
}

// Cloudflare Turnstile, only when a secret is configured on the Pages project.
export async function turnstileOk(env, token, ip) {
  if (!env.TURNSTILE_SECRET) return true;
  if (typeof token !== "string" || !token) return false;
  const form = new FormData();
  form.append("secret", env.TURNSTILE_SECRET);
  form.append("response", token);
  if (ip) form.append("remoteip", ip);
  try {
    const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form });
    const j = await r.json();
    return !!j.success;
  } catch { return false; }
}
