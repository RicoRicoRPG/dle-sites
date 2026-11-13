// Endless runs, served and scored by the server. The client never holds an answer: it gets two
// cards, sends a tap, and gets back the reveal plus the next pair. Verdicts, candidates and the
// players still needing votes are rebuilt nightly into D1 (scripts/draftdle-nightly.mjs).
import {
  BOARDS, IDLE_MS, MIN_STREAK_FOR_BOARD, PACE_MIN_PICKS, PACE_MS_PER_PICK, TOP_N,
  pairOf, pairKey, utcDay, newId
} from "./core.js";

const CACHE_MS = 5 * 60 * 1000;
const cache = new Map();
async function cached(key, fn, now) {
  const hit = cache.get(key);
  if (hit && now - hit.t < CACHE_MS) return hit.v;
  const v = await fn();
  cache.set(key, { t: now, v });
  return v;
}
export function clearCache() { cache.clear(); }

export async function sportState(db, sport, now) {
  return cached("s:" + sport, () => db.prepare("SELECT * FROM sports WHERE sport = ?").bind(sport).first(), now);
}
async function groupSize(db, sport, tier, grp, now) {
  return cached(`g:${sport}:${tier}:${grp}`, async () => {
    const r = await db.prepare("SELECT n FROM groups WHERE sport = ? AND tier = ? AND grp = ?").bind(sport, tier, grp).first();
    return r ? r.n : 0;
  }, now);
}

const pick = (rnd, n) => Math.floor(rnd() * n);

// Choose the next pair for a run. Returns the private `pending` record (stored on the run) and
// the public cards. Scouting serves only no-winner questions; an open sport serves one about
// every 1/rate rounds while players still need votes, never two in a row.
export async function choosePair(db, S, run, { rnd = Math.random, now = Date.now() } = {}) {
  const recent = new Set(JSON.parse(run.recent || "[]"));
  let nowin = S.phase !== "open";
  if (!nowin && S.n_collect > 0 && !run.nowin_last && rnd() < S.rate) nowin = true;
  if (!nowin && S.n_cand + S.n_settled === 0) nowin = S.n_collect > 0;
  let found = null;
  for (let tries = 0; tries < 8 && !found; tries++) {
    if (nowin) {
      if (!S.n_collect) break;
      const c = await db.prepare("SELECT player, tier, grp FROM collect WHERE sport = ? AND idx = ?").bind(S.sport, pick(rnd, S.n_collect)).first();
      if (!c) continue;
      const n = await groupSize(db, S.sport, c.tier, c.grp, now);
      if (n < 2) continue;
      const p = await db.prepare("SELECT id FROM players WHERE sport = ? AND tier = ? AND grp = ? AND gidx = ?").bind(S.sport, c.tier, c.grp, pick(rnd, n)).first();
      if (!p || p.id === c.player || recent.has(pairKey(p.id, c.player))) continue;
      const [lo, hi] = pairOf(p.id, c.player);
      found = { lo, hi, nowin: true };
    } else {
      const kind = S.n_cand > 0 && (S.n_settled === 0 || rnd() < 0.6) ? "cand" : "settled";
      const n = kind === "cand" ? S.n_cand : S.n_settled;
      const r = await db.prepare("SELECT lo, hi, winner, share, votes, source FROM serve WHERE sport = ? AND kind = ? AND idx = ?").bind(S.sport, kind, pick(rnd, n)).first();
      if (!r || recent.has(r.lo + "|" + r.hi)) continue;
      found = { lo: r.lo, hi: r.hi, nowin: false, winner: r.winner, share: r.share, votes: r.votes, source: r.source };
    }
  }
  if (!found) return null;
  const rows = (await db.prepare("SELECT id, card FROM players WHERE sport = ? AND id IN (?, ?)").bind(S.sport, found.lo, found.hi).all()).results;
  const cards = Object.fromEntries(rows.map(r => [r.id, JSON.parse(r.card)]));
  if (!cards[found.lo] || !cards[found.hi]) return null;
  found.left = rnd() < 0.5 ? found.lo : found.hi;
  const right = found.left === found.lo ? found.hi : found.lo;
  return { pending: found, pair: { nowin: found.nowin, cards: [cards[found.left], cards[right]] } };
}

export async function startRun(db, { sport, voter, rnd, now }) {
  const S = await sportState(db, sport, now);
  if (!S) return { error: "unknown sport", status: 404 };
  const run = { id: newId(), sport, voter, started: now, last_at: now, recent: "[]", nowin_last: 0 };
  const next = await choosePair(db, S, run, { rnd, now });
  if (!next) return { error: "no pairs available yet", status: 503 };
  await db.prepare(`INSERT INTO runs (id, sport, voter, started, last_at, pending, recent, nowin_last) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(run.id, sport, voter, now, now, JSON.stringify(next.pending), JSON.stringify([next.pending.lo + "|" + next.pending.hi]), next.pending.nowin ? 1 : 0).run();
  return { run: run.id, phase: S.phase, next: next.pair, stats: runStats({ scored: 0, matches: 0, streak: 0, best_streak: 0, picks: 0 }) };
}

function runStats(r) {
  return { picks: r.picks, scored: r.scored, matches: r.matches, pct: r.scored ? Math.round(r.matches / r.scored * 1000) / 10 : null, streak: r.streak, best: r.best_streak };
}

async function rankOf(db, sport, board, value) {
  const r = await db.prepare(`SELECT COUNT(*) AS n FROM (SELECT 1 FROM boards WHERE sport = ? AND board = ? AND hidden = 0 AND value > ? LIMIT ${TOP_N})`).bind(sport, board, value).first();
  return (r ? r.n : 0) + 1;
}

const upsertBoard = db => db.prepare(`INSERT INTO boards (sport, board, voter, run, value, at, hidden) VALUES (?, ?, ?, ?, ?, ?, 0)
  ON CONFLICT (sport, board, voter) DO UPDATE SET value = excluded.value, run = excluded.run, at = excluded.at, hidden = 0
  WHERE excluded.value > boards.value`);

export async function pickInRun(db, { runId, voter, side, rnd, now }) {
  const run = await db.prepare("SELECT * FROM runs WHERE id = ?").bind(runId).first();
  if (!run || run.voter !== voter) return { error: "unknown run", status: 404 };
  if (run.ended || now - run.last_at > IDLE_MS) return { expired: true, status: 409, error: "run ended" };
  const pend = run.pending ? JSON.parse(run.pending) : null;
  if (!pend) return { error: "nothing to answer", status: 409 };
  const S = await sportState(db, run.sport, now);
  const pickedId = side === 0 ? pend.left : (pend.left === pend.lo ? pend.hi : pend.lo);
  const stmts = [db.prepare("INSERT OR IGNORE INTO votes (sport, lo, hi, pick, mode, day, voter) VALUES (?, ?, ?, ?, 'endless', ?, ?)")
    .bind(run.sport, pend.lo, pend.hi, pickedId === pend.lo ? 0 : 1, utcDay(now), voter)];

  const r = { ...run, picks: run.picks + 1 };
  let reveal;
  if (pend.nowin) {
    await db.batch(stmts);
    stmts.length = 0;
    const live = await db.prepare("SELECT SUM(pick = 0) AS a, COUNT(*) AS n FROM votes WHERE sport = ? AND lo = ? AND hi = ?").bind(run.sport, pend.lo, pend.hi).first();
    const n = live ? live.n : 0, loShare = n ? live.a / n : 0.5;
    const leftShare = pend.left === pend.lo ? loShare : 1 - loShare;
    reveal = { nowin: true, votes: n, left: leftShare, picked: side };
  } else {
    const match = pickedId === pend.winner;
    r.scored++; if (match) r.matches++;
    r.streak = match ? r.streak + 1 : 0;
    r.best_streak = Math.max(r.best_streak, r.streak);
    const leftShare = pend.left === pend.winner ? pend.share : 1 - pend.share;
    reveal = { nowin: false, match, votes: pend.votes, left: leftShare, source: pend.source, winnerSide: pend.left === pend.winner ? 0 : 1, picked: side };
  }

  // Pace check: a run averaging under a second a pick across 25+ picks is hidden from the boards.
  const newlyFlagged = !r.flagged && r.scored >= PACE_MIN_PICKS && (now - r.started) / r.picks < PACE_MS_PER_PICK;
  if (newlyFlagged) { r.flagged = 1; stmts.push(db.prepare("UPDATE boards SET hidden = 1 WHERE run = ?").bind(r.id)); }

  const posted = [];
  if (!pend.nowin && !r.flagged && S && S.phase === "open") {
    if (BOARDS.includes(r.scored) && r.scored > run.scored) {
      const value = Math.round(r.matches / r.scored * 1000) / 10;
      stmts.push(upsertBoard(db).bind(r.sport, "pct" + r.scored, voter, r.id, value, now));
      posted.push({ board: "pct" + r.scored, value });
    }
    if (r.best_streak > run.best_streak && r.best_streak >= MIN_STREAK_FOR_BOARD) {
      stmts.push(upsertBoard(db).bind(r.sport, "streak", voter, r.id, r.best_streak, now));
      posted.push({ board: "streak", value: r.best_streak });
    }
  }

  const recent = JSON.parse(r.recent || "[]");
  const next = S ? await choosePair(db, S, { ...r, recent: JSON.stringify(recent), nowin_last: pend.nowin ? 1 : 0 }, { rnd, now }) : null;
  if (next) { recent.push(next.pending.lo + "|" + next.pending.hi); while (recent.length > 40) recent.shift(); }
  stmts.push(db.prepare(`UPDATE runs SET last_at = ?, picks = ?, scored = ?, matches = ?, streak = ?, best_streak = ?, pending = ?, recent = ?, nowin_last = ?, flagged = ? WHERE id = ?`)
    .bind(now, r.picks, r.scored, r.matches, r.streak, r.best_streak, next ? JSON.stringify(next.pending) : null, JSON.stringify(recent), next && next.pending.nowin ? 1 : 0, r.flagged, r.id));
  await db.batch(stmts);

  // Which boards this pick put the browser into the top 100 of (for the name prompt).
  const entered = [];
  for (const p of posted) {
    const rank = await rankOf(db, r.sport, p.board, p.value);
    if (rank <= TOP_N) entered.push({ ...p, rank });
  }
  let named = null;
  if (entered.length) named = !!(await db.prepare("SELECT 1 AS x FROM names WHERE voter = ?").bind(voter).first());
  return { reveal, stats: runStats(r), next: next ? next.pair : null, entered, named, flagged: !!r.flagged, phase: S ? S.phase : null };
}

export async function endRun(db, { runId, voter }) {
  await db.prepare("UPDATE runs SET ended = 1, pending = NULL WHERE id = ? AND voter = ?").bind(runId, voter).run();
  return { ok: true };
}

export async function leaderboard(db, sport) {
  const out = {};
  const stmts = ["pct25", "pct50", "pct100", "pct250", "pct500", "pct1000", "streak"].map(board => db.prepare(
    `SELECT b.value, b.at, COALESCE(CASE WHEN n.hidden = 0 THEN n.name END, 'Anonymous scout') AS name
     FROM boards b LEFT JOIN names n ON n.voter = b.voter
     WHERE b.sport = ? AND b.board = ? AND b.hidden = 0
     ORDER BY b.value DESC, b.at ASC LIMIT ${TOP_N}`).bind(sport, board));
  const res = await db.batch(stmts);
  ["pct25", "pct50", "pct100", "pct250", "pct500", "pct1000", "streak"].forEach((b, i) => { out[b] = res[i].results.map(r => ({ name: r.name, value: r.value, day: utcDay(r.at) })); });
  return out;
}
