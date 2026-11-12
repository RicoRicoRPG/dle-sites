// Shared game rules. Used by the Node jobs (puzzle freezer, tests) and inlined into each page
// for practice mode. Keep it dependency-free: build.mjs strips the `export` keywords when inlining.

export const BANDS = [[3, Infinity], [3, Infinity], [3, Infinity], [1.5, 3], [1.5, 3], [1.5, 3], [1.5, 3], [1.02, 1.5], [1.02, 1.5], [1.02, 1.5]];

export function hash(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function ratioOf(a, b) { return Math.max(a.v, b.v) / Math.min(a.v, b.v); }

export function winnerIndex(pair, better) {
  const [a, b] = pair;
  return better === "lower" ? (a.v < b.v ? 0 : 1) : (a.v > b.v ? 0 : 1);
}

// Ten pairs, easy to hard. No game appears twice in a day; `exclude` holds item keys
// (or groups) that were used recently and must not come back yet.
export function generate(items, seedStr, opts = {}) {
  const r = rng(hash(seedStr));
  const exclude = opts.exclude || new Set();
  const pool = items.filter(it => !exclude.has(it.key) && !exclude.has("g:" + it.group));
  const used = new Set();
  const pairs = [];
  const pick = () => pool[Math.floor(r() * pool.length)];
  if (pool.length < 20) return pairs;
  for (let i = 0; i < 10; i++) {
    const [lo, hi] = BANDS[i];
    let found = null;
    for (let relax = 0; relax < 3 && !found; relax++) {
      const loR = relax ? lo / (1 + relax * 0.25) : lo, hiR = relax ? hi * (1 + relax * 0.5) : hi;
      for (let tries = 0; tries < 4000 && !found; tries++) {
        const a = pick(), b = pick();
        if (a === b || a.group === b.group || used.has(a.group) || used.has(b.group)) continue;
        if (a.v === b.v) continue;
        if (opts.pairRule && !opts.pairRule(a, b)) continue;
        const q = ratioOf(a, b);
        if (q >= loR && q < hiR) found = r() < 0.5 ? [a, b] : [b, a];
      }
    }
    if (!found) break;
    used.add(found[0].group); used.add(found[1].group);
    pairs.push(found);
  }
  return pairs;
}
