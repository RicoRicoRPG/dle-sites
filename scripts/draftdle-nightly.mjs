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

  // 1. players and groups
  const current = new Map((await db.all("SELECT sport, id, tier, grp, gidx, card FROM players")).map(r => [r.sport + ":" + r.id, r]));
  const wanted = new Set();
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
        writes.push(inline("INSERT OR REPLACE INTO players (sport, id, tier, grp, gidx, card) VALUES (?, ?, ?, ?, ?, ?)", [sport.id, pl.id, pl.tier, pl.grp, gidx, card]));
    }
    writes.push(inline("DELETE FROM groups WHERE sport = ?", [sport.id]));
    for (const [g, n] of counters) { const [tier, grp] = g.split(/:(.*)/s); writes.push(inline("INSERT INTO groups (sport, tier, grp, n) VALUES (?, ?, ?, ?)", [sport.id, Number(tier), grp, n])); }
  }
  for (const key of current.keys()) if (!wanted.has(key)) { const [s, id] = key.split(/:(.*)/s); writes.push(inline("DELETE FROM players WHERE sport = ? AND id = ?", [s, id])); }

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

    writes.push(inline("DELETE FROM serve WHERE sport = ?", [sport.id]));
    for (const kind of ["cand", "settled"]) serve[kind].forEach((s, i) =>
      writes.push(inline("INSERT INTO serve (sport, kind, idx, lo, hi, winner, share, votes, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", [sport.id, kind, i, s.lo, s.hi, s.winner, s.share, s.votes, s.source])));
    writes.push(inline("DELETE FROM collect WHERE sport = ?", [sport.id]));
    collect.forEach((c, i) => writes.push(inline("INSERT INTO collect (sport, idx, player, tier, grp) VALUES (?, ?, ?, ?, ?)", [sport.id, i, c.id, c.tier, c.grp])));
    writes.push(inline("INSERT OR REPLACE INTO sports (sport, phase, tiers_open, rate, n_cand, n_settled, n_collect, updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [sport.id, phase, open, RULES.rate, serve.cand.length, serve.settled.length, collect.length, today]));

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
