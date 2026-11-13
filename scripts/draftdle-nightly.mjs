#!/usr/bin/env node
// Draftdle nightly job (run by daily.yml after the D1 migrations):
//   1. sync each sport's pool into D1 (players, groups), changed rows only
//   2. sum votes per pair, fit Bradley–Terry, work out which tiers are open
//   3. flag pairs whose share swung hard since last night (brigades), hold them out
//   4. rebuild the private Endless tables: serve (scored pairs), collect (players needing votes), sports
//   5. freeze Daily puzzles for yesterday..tomorrow (UTC) once a sport has enough crowd verdicts
//   6. write data/draftdle/status.json for the page
//
//   node scripts/draftdle-nightly.mjs                 # against the remote D1 through wrangler
//   DRAFTDLE_DB=path.sqlite node scripts/...          # against a local SQLite file (tests, dev)

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { p, read, write, utcDay, now, addDays } from "./lib.mjs";
import { RULES, fitBT, tiersOpen, collectSet, servePairs, dailyEligible, freezeDaily, cardOf, pairKey } from "./draftdle-lib.mjs";

// ---------- database adapters ----------
export function lit(v) {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "NULL";
  if (typeof v === "boolean") return v ? "1" : "0";
  return "'" + String(v).replace(/'/g, "''") + "'";
}
export const inline = (sql, params = []) => { let i = 0; return sql.replace(/\?/g, () => lit(params[i++])); };

export function sqliteDb(file) {
  const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite");
  const db = new DatabaseSync(file);
  return {
    raw: db,
    async all(sql, params = []) { return db.prepare(sql).all(...params); },
    async run(sql, params = []) { db.prepare(sql).run(...params); },
    async script(stmts) { db.exec("BEGIN"); try { for (const s of stmts) db.exec(s); db.exec("COMMIT"); } catch (e) { db.exec("ROLLBACK"); throw e; } }
  };
}
export function wranglerDb(name, { cwd = p("sites/draftdle") } = {}) {
  const wr = args => execFileSync("npx", ["--yes", "wrangler@4", "d1", "execute", name, "--remote", "--json", ...args], { cwd, maxBuffer: 1 << 30, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
  return {
    async all(sql, params = []) { const out = JSON.parse(wr(["--command", inline(sql, params)])); return out[0] ? out[0].results : []; },
    async run(sql, params = []) { wr(["--command", inline(sql, params)]); },
    async script(stmts) {
      for (let i = 0; i < stmts.length; i += 4000) {
        const f = path.join(os.tmpdir(), `draftdle-${process.pid}-${i}.sql`);
        fs.writeFileSync(f, stmts.slice(i, i + 4000).join(";\n") + ";\n");
        try { wr(["--file", f, "--yes"]); } finally { fs.rmSync(f, { force: true }); }
      }
    }
  };
}


// Keep each row in its slot. Rows that left free their slot; new rows fill free slots, then the
// end; if more left than came, rows from the end move down so slots stay 0..n-1 (Endless picks a
// random slot). Returns the slots to write, where to cut the tail, and the new size.
export function placeDense(prev, want, same) {
  const slots = [];
  for (const r of prev) slots[r.idx] = r;
  const out = new Map(), free = [];
  for (let i = 0; i < slots.length; i++) {
    const r = slots[i];
    if (r && want.has(r.key)) { const w = { ...want.get(r.key), key: r.key }; if (!same(r, w)) out.set(i, w); slots[i] = w; }
    else { slots[i] = null; free.push(i); }
  }
  const placed = new Set(slots.filter(Boolean).map(r => r.key));
  for (const [key, w] of want) {
    if (placed.has(key)) continue;
    const i = free.length ? free.shift() : slots.length;
    slots[i] = { ...w, key }; out.set(i, slots[i]);
  }
  let size = slots.length;
  while (size && !slots[size - 1]) size--;
  for (const i of free.filter(i => i < size).sort((a, b) => a - b)) {
    while (size && !slots[size - 1]) size--;
    if (i >= size) break;
    slots[i] = slots[size - 1]; slots[size - 1] = null; out.set(i, slots[i]); out.delete(size - 1); size--;
  }
  while (size && !slots[size - 1]) size--;
  return { put: [...out].filter(([i]) => i < size), drop: size < prev.length || slots.length > size ? size : null, size };
}

// ---------- helpers ----------
const puzzleDir = sport => p("data/puzzles/draftdle", sport);
function pastPuzzles(sport, before, days) {
  const out = [];
  for (let d = 1; d <= days; d++) { const f = read(path.join(puzzleDir(sport), addDays(before, -d) + ".json"), null); if (f) out.push({ day: addDays(before, -d), f }); }
  return out;
}
const dayNo = (epoch, date) => Math.round((Date.parse(date) - Date.parse(epoch)) / 864e5) + 1;

export async function nightly({ db, log = console.log, stateFile = process.env.DRAFTDLE_STATE || p("state/draftdle-totals.json"), today = utcDay(now()) } = {}) {
  const cfg = read(p("data/draftdle/sports.json"));
  const statusFile = p("data/draftdle/status.json");
  const status = read(statusFile, { sports: {} });
  const prevTotals = read(stateFile, null);
  const writes = [];
  const flagged = new Set((await db.all("SELECT sport, lo, hi FROM flags")).map(r => r.sport + ":" + r.lo + "|" + r.hi));

  // 1. players and groups: changed rows only. An upsert, not INSERT OR REPLACE, which SQLite runs
  // as a delete plus an insert and so bills twice.
  const current = new Map((await db.all("SELECT sport, id, tier, grp, gidx, card FROM players")).map(r => [r.sport + ":" + r.id, r]));
  const currentGroups = new Map((await db.all("SELECT sport, tier, grp, n FROM groups")).map(r => [`${r.sport}:${r.tier}:${r.grp}`, r.n]));
  const wanted = new Set(), wantedGroups = new Set();
  const pools = {};
  for (const sport of cfg.sports) {
    const pool = read(p("data/draftdle", sport.id, "pool.json"), null);
    if (!pool || !pool.length) continue;
    pools[sport.id] = pool;
    const counters = new Map();
    for (const pl of pool) {
      const g = pl.tier + ":" + pl.grp;
      const gidx = counters.get(g) || 0; counters.set(g, gidx + 1);
      const card = JSON.stringify(cardOf(pl));
      const key = sport.id + ":" + pl.id;
      wanted.add(key);
      const cur = current.get(key);
      if (!cur || cur.tier !== pl.tier || cur.grp !== pl.grp || cur.gidx !== gidx || cur.card !== card)
        writes.push(inline("INSERT INTO players (sport, id, tier, grp, gidx, card) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (sport, id) DO UPDATE SET tier = excluded.tier, grp = excluded.grp, gidx = excluded.gidx, card = excluded.card", [sport.id, pl.id, pl.tier, pl.grp, gidx, card]));
    }
    for (const [g, n] of counters) {
      const [tier, grp] = g.split(/:(.*)/s);
      const k = `${sport.id}:${tier}:${grp}`;
      wantedGroups.add(k);
      if (currentGroups.get(k) !== n) writes.push(inline("INSERT INTO groups (sport, tier, grp, n) VALUES (?, ?, ?, ?) ON CONFLICT (sport, tier, grp) DO UPDATE SET n = excluded.n", [sport.id, Number(tier), grp, n]));
    }
  }
  for (const key of current.keys()) if (!wanted.has(key)) { const [s2, id] = key.split(/:(.*)/s); writes.push(inline("DELETE FROM players WHERE sport = ? AND id = ?", [s2, id])); }
  for (const k of currentGroups.keys()) if (!wantedGroups.has(k)) { const [s2, tier, grp] = k.split(/:([^:]*):(.*)/s); writes.push(inline("DELETE FROM groups WHERE sport = ? AND tier = ? AND grp = ?", [s2, Number(tier), grp])); }

  // 2. totals
  const totalsAll = await db.all("SELECT sport, lo, hi, SUM(pick = 0) AS a, COUNT(*) AS n FROM votes GROUP BY sport, lo, hi");
  const bySport = {};
  for (const t of totalsAll) (bySport[t.sport] = bySport[t.sport] || []).push({ lo: t.lo, hi: t.hi, a: Number(t.a), n: Number(t.n) });

  // 3. brigade flags: a share that moved flagMove+ on flagVotes+ new votes since last night
  const snapshot = {};
  for (const [sport, totals] of Object.entries(bySport)) {
    snapshot[sport] = {};
    for (const t of totals) {
      const k = t.lo + "|" + t.hi;
      snapshot[sport][k] = [t.a, t.n];
      const prev = prevTotals && prevTotals[sport] && prevTotals[sport][k];
      if (!prev || flagged.has(sport + ":" + k)) continue;
      const [pa, pn] = prev;
      if (t.n - pn >= RULES.flagVotes && pn > 0 && Math.abs(t.a / t.n - pa / pn) >= RULES.flagMove) {
        flagged.add(sport + ":" + k);
        writes.push(inline("INSERT OR IGNORE INTO flags (sport, lo, hi, day, reason) VALUES (?, ?, ?, ?, ?)", [sport, t.lo, t.hi, today, `share moved ${Math.round((t.a / t.n - pa / pn) * 100)} points on ${t.n - pn} votes`]));
        log(`${sport}: flagged ${k} (share moved on ${t.n - pn} new votes)`);
      }
    }
  }

  // 4 and 5, per sport
  const made = [];
  const sportsRows = new Map((await db.all("SELECT * FROM sports")).map(r => [r.sport, r]));
  for (const sport of cfg.sports) {
    const pool = pools[sport.id];
    if (!pool) { status.sports[sport.id] = { name: sport.name, group: sport.group, phase: "soon" }; continue; }
    const totals = bySport[sport.id] || [];
    const excluded = new Set([...flagged].filter(k => k.startsWith(sport.id + ":")).map(k => k.slice(sport.id.length + 1)));
    const fit = fitBT(pool.map(x => x.id), totals);
    const open = tiersOpen(pool, fit.comps);
    const phase = open >= 1 ? "open" : "scouting";
    const collect = collectSet(pool, fit.comps, open);
    const recentDaily = new Set(pastPuzzles(sport.id, addDays(today, 2), RULES.pairCooldown).flatMap(x => x.f.pairs.map(q => q.lo + "|" + q.hi)));
    const serve = servePairs(sport, pool, fit, totals, open, excluded, recentDaily, `serve:${sport.id}:${today}`);

    // Serving tables: rows keep their slot from night to night, so only pairs and players that
    // came or went are written (see placeDense).
    for (const kind of ["cand", "settled"]) {
      const prev = (await db.all("SELECT idx, lo, hi, winner, share, votes, source FROM serve WHERE sport = ? AND kind = ?", [sport.id, kind])).map(r => ({ ...r, key: r.lo + "|" + r.hi }));
      const want = new Map(serve[kind].map(x => [x.lo + "|" + x.hi, x]));
      const same = (a, b) => a.winner === b.winner && a.source === b.source && Math.abs(a.share - b.share) < 0.01 && Math.abs(a.votes - b.votes) < Math.max(5, b.votes * 0.1);
      const { put, drop, size } = placeDense(prev, want, same);
      serve[kind].length = size;
      for (const [i, x] of put) writes.push(inline("INSERT INTO serve (sport, kind, idx, lo, hi, winner, share, votes, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (sport, kind, idx) DO UPDATE SET lo = excluded.lo, hi = excluded.hi, winner = excluded.winner, share = excluded.share, votes = excluded.votes, source = excluded.source", [sport.id, kind, i, x.lo, x.hi, x.winner, x.share, x.votes, x.source]));
      if (drop !== null) writes.push(inline("DELETE FROM serve WHERE sport = ? AND kind = ? AND idx >= ?", [sport.id, kind, drop]));
    }
    {
      const prev = (await db.all("SELECT idx, player, tier, grp FROM collect WHERE sport = ?", [sport.id])).map(r => ({ ...r, key: r.player }));
      const want = new Map(collect.map(c => [c.id, { player: c.id, tier: c.tier, grp: c.grp }]));
      const { put, drop } = placeDense(prev, want, (a, b) => a.tier === b.tier && a.grp === b.grp);
      for (const [i, x] of put) writes.push(inline("INSERT INTO collect (sport, idx, player, tier, grp) VALUES (?, ?, ?, ?, ?) ON CONFLICT (sport, idx) DO UPDATE SET player = excluded.player, tier = excluded.tier, grp = excluded.grp", [sport.id, i, x.player, x.tier, x.grp]));
      if (drop !== null) writes.push(inline("DELETE FROM collect WHERE sport = ? AND idx >= ?", [sport.id, drop]));
    }
    const sp = [phase, open, RULES.rate, serve.cand.length, serve.settled.length, collect.length];
    const cur = sportsRows.get(sport.id);
    if (!cur || [cur.phase, cur.tiers_open, cur.rate, cur.n_cand, cur.n_settled, cur.n_collect].join() !== sp.join())
      writes.push(inline("INSERT INTO sports (sport, phase, tiers_open, rate, n_cand, n_settled, n_collect, updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (sport) DO UPDATE SET phase = excluded.phase, tiers_open = excluded.tiers_open, rate = excluded.rate, n_cand = excluded.n_cand, n_settled = excluded.n_settled, n_collect = excluded.n_collect, updated = excluded.updated",
        [sport.id, ...sp, today]));

    // Daily
    const st = status.sports[sport.id] || {};
    const early = !st.dailyEpoch || today < addDays(st.dailyEpoch, 14);
    const minVotes = early ? RULES.minVotesEarly : RULES.minVotes;
    const eligible = dailyEligible(pool, totals, minVotes, excluded);
    if (!st.dailyEpoch && phase === "open" && eligible.length >= RULES.dailyOpenAt) { st.dailyEpoch = today; log(`${sport.id}: Daily opens today with ${eligible.length} eligible pairs`); }
    if (st.dailyEpoch) {
      for (const date of [addDays(today, -1), today, addDays(today, 1)]) {
        if (date < st.dailyEpoch) continue;
        const file = path.join(puzzleDir(sport.id), date + ".json");
        if (fs.existsSync(file)) continue;
        const past = pastPuzzles(sport.id, date, RULES.pairCooldown);
        const recentPairs = new Set(past.flatMap(x => x.f.pairs.map(q => q.lo + "|" + q.hi)));
        // Player cooldown: 7 days, shortened for a small pool rather than skipping the day.
        let pairs = null;
        for (const cool of [RULES.playerCooldown, 3, 1, 0]) {
          const recentPlayers = new Set(past.filter(x => x.day >= addDays(date, -cool)).flatMap(x => x.f.pairs.flatMap(q => [q.lo, q.hi])));
          pairs = freezeDaily(eligible, `draftdle:${sport.id}:${date}`, { rounds: sport.dailyRounds || 10, recentPlayers, recentPairs });
          if (pairs) { if (cool < RULES.playerCooldown) log(`${sport.id} ${date}: player cooldown shortened to ${cool} days`); break; }
        }
        if (!pairs) { log(`${sport.id} ${date}: not enough eligible pairs (${eligible.length}); no Daily`); continue; }
        write(file, { date, sport: sport.id, no: dayNo(st.dailyEpoch, date), pairs });
        made.push(`${sport.id}/${date}`);
      }
    }
    const coveredHeadliners = pool.filter(x => x.tier === 1 && (fit.comps.get(x.id) || 0) >= RULES.coverVotes).length;
    status.sports[sport.id] = {
      name: sport.name, group: sport.group, phase, tiersOpen: open, players: pool.length,
      headliners: pool.filter(x => x.tier === 1).length, coveredHeadliners,
      eligible: eligible.length, dailyNeeds: RULES.dailyOpenAt, dailyEpoch: st.dailyEpoch || null,
      rounds: sport.dailyRounds || 10, votes: totals.reduce((s, t) => s + t.n, 0)
    };
    log(`${sport.id}: ${phase}, tiers open ${open}, ${totals.length} voted pairs, serve ${serve.cand.length}+${serve.settled.length}, collect ${collect.length}, daily-eligible ${eligible.length}`);
  }

  const hidden = read(p("data/draftdle/hidden-names.json"), []);
  if (hidden.length) writes.push(inline(`UPDATE names SET hidden = 1 WHERE lower(name) IN (${hidden.map(() => "?").join(", ")})`, hidden.map(h => String(h).toLowerCase())));

  await db.script(writes);
  status.updated = today;
  write(statusFile, status, true);
  write(stateFile, snapshot);
  log(made.length ? `froze ${made.join(", ")}` : "no new Draftdle puzzles");
  return { made, writes: writes.length };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const db = process.env.DRAFTDLE_DB ? sqliteDb(process.env.DRAFTDLE_DB) : wranglerDb(process.env.DRAFTDLE_D1_NAME || "draftdle");
  await nightly({ db });
}
