// Draftdle's nightly maths: Bradley–Terry fit, tiers, serving tables and the Daily freeze.
// Pure functions over plain data, so the tests can run them on fixture votes.

import { hash, rng } from "../src/core.mjs";

export const RULES = {
  coverVotes: 30,        // votes a player needs before the model may score them
  tierOpenShare: 0.95,   // share of a tier's players that must be covered for the tier to open
  minVotes: 40,          // direct votes a pair needs for a crowd verdict
  minVotesEarly: 25,     // the same, for a sport's first 14 days of Daily
  dailyFloor: 0.55,      // winner share below which a pair never goes in a Daily
  predictMin: 0.60,      // predicted share a pair needs to be scored in Endless
  predictMax: 0.92,      // above this a pair is a blowout; not served
  candLo: 0.60, candHi: 0.78,
  candTarget: 420, settledTarget: 1500, collectCap: 3000,
  dailyOpenAt: 100,      // eligible pairs needed before a sport's first Daily
  playerCooldown: 7, pairCooldown: 60,
  rate: 0.2,             // no-winner questions while players still need votes
  flagMove: 0.15, flagVotes: 100
};

// Bands by winner share, easy to hard (rounds 1-3, 4-7, 8-10).
export const SHARE_BANDS = [[0.70, 1.01], [0.70, 1.01], [0.70, 1.01], [0.60, 0.70], [0.60, 0.70], [0.60, 0.70], [0.60, 0.70], [0.55, 0.60], [0.55, 0.60], [0.55, 0.60]];

export const pairKey = (a, b) => (a < b ? a + "|" + b : b + "|" + a);

// totals: [{lo, hi, a (votes for lo), n}] for one sport. Returns Map id -> strength, Map id -> comparisons.
export function fitBT(ids, totals, { iters = 300, tol = 1e-7 } = {}) {
  const idx = new Map(ids.map((id, i) => [id, i]));
  const N = ids.length;
  const wins = new Float64Array(N), comps = new Float64Array(N);
  const edges = [];
  for (const t of totals) {
    const i = idx.get(t.lo), j = idx.get(t.hi);
    if (i === undefined || j === undefined || !t.n) continue;
    wins[i] += t.a; wins[j] += t.n - t.a; comps[i] += t.n; comps[j] += t.n;
    edges.push([i, j, t.n]);
  }
  let s = new Float64Array(N).fill(1);
  for (let it = 0; it < iters; it++) {
    const denom = new Float64Array(N);
    for (let k = 0; k < N; k++) denom[k] = 2 / (s[k] + 1); // prior: one win and one loss against an average player
    for (const [i, j, n] of edges) { const d = n / (s[i] + s[j]); denom[i] += d; denom[j] += d; }
    const next = new Float64Array(N);
    let logSum = 0;
    for (let k = 0; k < N; k++) { next[k] = (wins[k] + 1) / denom[k]; logSum += Math.log(next[k]); }
    const g = Math.exp(logSum / N);
    let delta = 0;
    for (let k = 0; k < N; k++) { next[k] /= g; delta = Math.max(delta, Math.abs(next[k] - s[k]) / s[k]); }
    s = next;
    if (delta < tol) break;
  }
  return { strength: new Map(ids.map((id, i) => [id, s[i]])), comps: new Map(ids.map((id, i) => [id, comps[i]])) };
}

export function predict(strength, a, b) {
  const sa = strength.get(a) || 1, sb = strength.get(b) || 1;
  return sa / (sa + sb);
}

// How many tiers are open, counting up from the Headliners.
export function tiersOpen(pool, comps, rules = RULES) {
  let open = 0;
  for (const t of [1, 2, 3]) {
    const members = pool.filter(p => p.tier === t);
    if (!members.length) break;
    const covered = members.filter(p => (comps.get(p.id) || 0) >= rules.coverVotes).length;
    if (covered / members.length >= rules.tierOpenShare) open = t; else break;
  }
  return open;
}

export function collectSet(pool, comps, open, rules = RULES) {
  const reach = Math.min(3, Math.max(1, open + 1));
  return pool.filter(p => p.tier <= reach && (comps.get(p.id) || 0) < rules.coverVotes)
    .sort((a, b) => (comps.get(a.id) || 0) - (comps.get(b.id) || 0) || a.tier - b.tier)
    .slice(0, rules.collectCap);
}

// Direct verdicts: pairs with enough head-to-head votes.
export function verdicts(totals, minVotes) {
  const out = new Map();
  for (const t of totals) {
    if (t.n < minVotes) continue;
    const loShare = t.a / t.n;
    out.set(t.lo + "|" + t.hi, { lo: t.lo, hi: t.hi, n: t.n, winner: loShare >= 0.5 ? t.lo : t.hi, share: Math.max(loShare, 1 - loShare) });
  }
  return out;
}

const adjacent = (a, b) => Math.abs(a - b) <= 1;

// The scored Endless pairs. cand = Headliner pairs a future Daily will need; settled = the rest.
export function servePairs(sport, pool, fit, totals, open, excluded, recentDaily, seed, rules = RULES) {
  if (!open) return { cand: [], settled: [] };
  const r = rng(hash(seed));
  const byId = new Map(pool.map(p => [p.id, p]));
  const tot = new Map(totals.map(t => [t.lo + "|" + t.hi, t]));
  const covered = pool.filter(p => p.tier <= open && (fit.comps.get(p.id) || 0) >= rules.coverVotes);
  const byGroupTier = new Map();
  for (const p of covered) { const k = p.grp + ":" + p.tier; if (!byGroupTier.has(k)) byGroupTier.set(k, []); byGroupTier.get(k).push(p); }
  const seen = new Set();
  const cand = [], settled = [];
  const row = (a, b, source, share, winner) => {
    const [lo, hi] = a.id < b.id ? [a.id, b.id] : [b.id, a.id];
    const t = tot.get(lo + "|" + hi);
    return { lo, hi, winner, share: Math.round(share * 1000) / 1000, votes: t ? t.n : 0, source };
  };
  // Direct verdicts first: firm answers.
  for (const v of verdicts(totals, rules.minVotes).values()) {
    const a = byId.get(v.lo), b = byId.get(v.hi);
    if (!a || !b || a.tier > open || b.tier > open || excluded.has(v.lo + "|" + v.hi)) continue;
    if (v.share < rules.dailyFloor || v.share > rules.predictMax) continue;
    seen.add(v.lo + "|" + v.hi);
    settled.push({ lo: v.lo, hi: v.hi, winner: v.winner, share: Math.round(v.share * 1000) / 1000, votes: v.n, source: "crowd" });
  }
  const headliners = byGroupTier;
  let tries = 0;
  // Candidates: two covered Headliners, same group, a predicted share a Daily can use.
  // Pairs already part-way to a verdict stay on the list first, closest to done first, so votes
  // pile up on the same pairs instead of spreading over a new sample every night.
  const h1 = covered.filter(p => p.tier === 1);
  const h1ids = new Set(h1.map(p => p.id));
  const partial = totals.filter(t => t.n > 0 && t.n < rules.minVotes && h1ids.has(t.lo) && h1ids.has(t.hi) && byId.get(t.lo).grp === byId.get(t.hi).grp)
    .sort((x, y) => y.n - x.n);
  for (const t of partial) {
    if (cand.length >= rules.candTarget) break;
    const k = t.lo + "|" + t.hi;
    if (seen.has(k) || excluded.has(k) || recentDaily.has(k)) continue;
    const pa = predict(fit.strength, t.lo, t.hi), share = Math.max(pa, 1 - pa);
    if (share < rules.candLo - 0.05 || share > rules.candHi + 0.1) continue;
    seen.add(k);
    cand.push(row(byId.get(t.lo), byId.get(t.hi), "predicted", share, pa >= 0.5 ? t.lo : t.hi));
  }
  while (cand.length < rules.candTarget && tries++ < rules.candTarget * 60 && h1.length > 1) {
    const a = h1[Math.floor(r() * h1.length)];
    const mates = headliners.get(a.grp + ":1") || [];
    const b = mates[Math.floor(r() * mates.length)];
    if (!b || a.id === b.id) continue;
    const k = pairKey(a.id, b.id);
    if (seen.has(k) || excluded.has(k) || recentDaily.has(k)) continue;
    const t = tot.get(k);
    if (t && t.n >= rules.minVotes) continue;
    const pa = predict(fit.strength, a.id, b.id), share = Math.max(pa, 1 - pa);
    if (share < rules.candLo || share > rules.candHi) continue;
    seen.add(k);
    cand.push(row(a, b, "predicted", share, pa >= 0.5 ? a.id : b.id));
  }
  // Settled predicted pairs across the open tiers, same or adjacent tier, same group.
  tries = 0;
  while (settled.length < rules.settledTarget && tries++ < rules.settledTarget * 60 && covered.length > 1) {
    const a = covered[Math.floor(r() * covered.length)];
    const t2 = a.tier + Math.floor(r() * 3) - 1;
    if (t2 < 1 || t2 > open || !adjacent(a.tier, t2)) continue;
    const mates = headliners.get(a.grp + ":" + t2) || [];
    const b = mates[Math.floor(r() * mates.length)];
    if (!b || a.id === b.id) continue;
    const k = pairKey(a.id, b.id);
    if (seen.has(k) || excluded.has(k)) continue;
    const pa = predict(fit.strength, a.id, b.id), share = Math.max(pa, 1 - pa);
    if (share < rules.predictMin || share > rules.predictMax) continue;
    seen.add(k);
    settled.push(row(a, b, "predicted", share, pa >= 0.5 ? a.id : b.id));
  }
  return { cand, settled };
}

// Pairs a Daily may use: two Headliners with a firm crowd verdict.
export function dailyEligible(pool, totals, minVotes, excluded, rules = RULES) {
  const byId = new Map(pool.map(p => [p.id, p]));
  const out = [];
  for (const v of verdicts(totals, minVotes).values()) {
    const a = byId.get(v.lo), b = byId.get(v.hi);
    if (!a || !b || a.tier !== 1 || b.tier !== 1 || a.grp !== b.grp) continue;
    if (v.share < rules.dailyFloor || excluded.has(v.lo + "|" + v.hi)) continue;
    out.push({ ...v, a, b });
  }
  return out;
}

// Ten pairs, easy to hard by crowd margin. Each player once a day; recent players and pairs held out;
// at least two active-vs-retired and two active-vs-active pairs where the pool allows.
export function freezeDaily(eligible, seedStr, { rounds = 10, recentPlayers = new Set(), recentPairs = new Set() } = {}) {
  const base = eligible.filter(e => !recentPairs.has(e.lo + "|" + e.hi) && !recentPlayers.has(e.lo) && !recentPlayers.has(e.hi));
  const bands = rounds === 10 ? SHARE_BANDS : SHARE_BANDS.filter((_, i) => i % 2 === 0).slice(0, rounds);
  let best = null;
  for (let attempt = 0; attempt < 40; attempt++) {
    const r = rng(hash(seedStr + ":" + attempt));
    const used = new Set(), pairs = [];
    for (let i = 0; i < rounds; i++) {
      let pick = null;
      for (let relax = 0; relax < 4 && !pick; relax++) {
        const [lo, hi] = bands[i];
        const loR = lo - relax * 0.03, hiR = hi + relax * 0.05;
        const opts = base.filter(e => e.share >= Math.max(loR, 0.55) && e.share < hiR && !used.has(e.lo) && !used.has(e.hi));
        if (opts.length) pick = opts[Math.floor(r() * opts.length)];
      }
      if (!pick) break;
      used.add(pick.lo); used.add(pick.hi);
      pairs.push(pick);
    }
    if (pairs.length < rounds) continue;
    const mixed = pairs.filter(e => e.a.active !== e.b.active).length;
    const bothActive = pairs.filter(e => e.a.active && e.b.active).length;
    const score = Math.min(mixed, 2) + Math.min(bothActive, 2);
    if (!best || score > best.score) best = { pairs, score, r };
    if (score === 4) break;
  }
  if (!best) return null;
  const r = best.r;
  // Bands shape the mix; the order is always most lopsided first, closest last.
  best.pairs.sort((x, y) => y.share - x.share);
  return best.pairs.map(e => {
    const leftIsA = r() < 0.5;
    const L = leftIsA ? e.a : e.b, R = leftIsA ? e.b : e.a;
    return { lo: e.lo, hi: e.hi, cards: [cardOf(L), cardOf(R)], winner: e.winner === L.id ? 0 : 1, share: Math.round(e.share * 1000) / 1000, votes: e.n };
  });
}

// The card a client sees. Short keys keep the D1 rows and puzzle files small.
// Retired players try the Commons photo first: league image servers answer for players they have
// no photo of with a silhouette (not an error), so the page's fallback would never reach Commons.
// Pictures in the order the card tries them. A photo from the playing years (era) leads for
// retired players; active players keep the league headshot first, a current-season portrait.
// Without an era photo a retired player leads with a league headshot only when it's known to be
// real (hs), else with the Wikidata photo.
export const commonsUrl = f => "https://commons.wikimedia.org/wiki/Special:FilePath/" + encodeURIComponent(f) + "?width=360";
export function cardOf(p) {
  let img = p.img || [];
  const era = p.era ? commonsUrl(p.era) : null;
  if (era) img = img.filter(u => u !== era);
  if (!p.active) {
    if (era) img = [era, ...img];
    // Wikidata's photo is from before or after the career and there's no career photo: leave it
    // out. The card shows a real league headshot if there is one, else the initials.
    else if (p.offEra) img = img.filter(u => !u.includes("commons.wikimedia.org"));
    else if (p.commons && !p.hs) { const c = img.find(u => u.includes("commons.wikimedia.org")); if (c) img = [c, ...img.filter(u => u !== c)]; }
  } else if (era) {
    const head = img.filter(u => !u.includes("commons.wikimedia.org"));
    img = [...head, era, ...img.filter(u => u.includes("commons.wikimedia.org"))];
  }
  return { id: p.id, n: p.name, y: p.years, p: p.pos, t: p.teams, i: img, c: p.commons || "", a: p.active ? 1 : 0 };
}
