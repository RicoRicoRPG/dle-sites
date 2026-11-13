#!/usr/bin/env node
// Play Draftdle locally: serves dist/draftdle and runs /api/* through the real Pages Functions
// on a SQLite file standing in for D1.
//
//   node scripts/build.mjs && node scripts/draftdle-dev.mjs            # http://localhost:8788
//   DRAFTDLE_DB=state/draftdle-dev.sqlite node scripts/draftdle-nightly.mjs   # rebuild serving tables
//
// Options: --port 8788  --db state/draftdle-dev.sqlite  --root <repo copy>

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { p } from "./lib.mjs";
import { d1 } from "./draftdle-devdb.mjs";

const arg = (k, d) => { const i = process.argv.indexOf("--" + k); return i > 0 ? process.argv[i + 1] : d; };
const root = path.resolve(arg("root", p()));
const port = Number(arg("port", 8788));
const dbFile = path.resolve(root, arg("db", "state/draftdle-dev.sqlite"));
fs.mkdirSync(path.dirname(dbFile), { recursive: true });
const db = d1(dbFile, { migrations: path.join(root, "sites/draftdle/migrations") });
const dist = path.join(root, "dist/draftdle");
const fn = async rel => import(pathToFileURL(path.join(root, "sites/draftdle/functions", rel)));
const routes = {
  "POST /api/endless/start": (await fn("api/endless/start.js")).onRequestPost,
  "POST /api/endless/pick": (await fn("api/endless/pick.js")).onRequestPost,
  "POST /api/endless/end": (await fn("api/endless/end.js")).onRequestPost,
  "POST /api/votes": (await fn("api/votes.js")).onRequestPost,
  "POST /api/name": (await fn("api/name.js")).onRequestPost,
  "GET /api/leaderboard": (await fn("api/leaderboard.js")).onRequestGet
};
const types = { ".html": "text/html; charset=utf-8", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".txt": "text/plain", ".xml": "application/xml" };
const fileFor = u => {
  let f = path.join(dist, decodeURIComponent(u.pathname));
  if (!f.startsWith(dist)) return null;
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, "index.html");
  if (!fs.existsSync(f) && fs.existsSync(f + ".html")) f += ".html";
  return fs.existsSync(f) ? f : null;
};
const env = {
  DB: db, VOTER_KEY: "dev",
  ASSETS: { fetch: async req => { const f = fileFor(new URL(req.url)); return f ? new Response(fs.readFileSync(f)) : new Response("not found", { status: 404 }); } }
};
http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://localhost:${port}`);
  const route = routes[`${req.method} ${u.pathname}`];
  if (route) {
    const chunks = []; for await (const c of req) chunks.push(c);
    const request = new Request(u, { method: req.method, headers: { "cf-connecting-ip": req.socket.remoteAddress || "" }, body: req.method === "POST" ? Buffer.concat(chunks) : undefined });
    const out = await route({ request, env });
    res.writeHead(out.status, Object.fromEntries(out.headers));
    res.end(Buffer.from(await out.arrayBuffer()));
    return;
  }
  const f = fileFor(u);
  if (!f) { res.writeHead(404); res.end("not found"); return; }
  res.writeHead(200, { "content-type": types[path.extname(f)] || "application/octet-stream" });
  res.end(fs.readFileSync(f));
}).listen(port, () => console.log(`Draftdle on http://localhost:${port} (db ${dbFile})`));
