// A photo from during the player's career. Wikidata's photo (P18) is often a recent one: Tom
// Brady on a red carpet, a retired star at a ceremony. The Wikipedia article usually has photos
// from the playing years too, in games or team portraits. We read the date of every photo the
// article uses, plus P18, and keep the best one taken during the career that names the player.
//
// eraPhotos(players, opts) -> Map id -> Commons file name (no "File:" prefix)
//   players: [{ id, name, title, start, end, active, commons, teams }]

const API = "https://en.wikipedia.org/w/api.php";
const PHOTO = /\.(jpe?g|webp|tiff?)$/i;
// Things that name the player without showing them playing.
const NOT_HIM = /statue|sculpture|bust\b|mural|grave|tomb|plaque|memorial|signature|autograph|logo|wordmark|jersey|banner|retired[ _]number|trophy|ring\b|stadium|arena|field\b|park\b|house|street|mansion|card\b|stamp|coin|poster|cover|map\b|cartoon|caricature|wax|museum/i;
const SUFFIX = /^(jr|sr|ii|iii|iv|v)\.?$/i;
// Off-the-field occasions: kept as a last resort, behind anything from a game.
const OFF_FIELD = /premiere|red carpet|award|ceremony|gala|white house|govt|government|senate|congress|visit|meeting|speech|rally|campaign|wedding|interview|conference|television|\btv\b|episode|\bshow\b|film|movie|press|book signing|fundrais|charity|concert|medical center|hospital|military|troops|parade/i;
const IN_GAME = /\b(vs\.?|versus|against|game|match|playing|plays|pitch(ing|es)?|batting|at bat|dunk|shoot(ing|s)?|rush(ing|es)?|pass(ing|es)?|throw(ing|s)?|tackl|skat|goal|warm[- ]?up|practice|training camp|huddle|layup|free throw|on court|on ice|scrimmage|season|playoffs?|final|bowl|series|all-star)\b/i;

export const fold = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
export function surname(name) {
  const parts = fold(name).replace(/\([^)]*\)/g, "").split(/[\s_]+/).filter(w => w && !SUFFIX.test(w));
  return parts.length ? parts[parts.length - 1].replace(/[^a-z'-]/g, "") : "";
}

// Year a photo was taken: EXIF/Commons date first, then a year in the title or description.
export function photoYear(meta, file) {
  const strip = s => String(s || "").replace(/<[^>]+>/g, " ");
  const dt = strip(meta?.DateTimeOriginal?.value);
  const m = dt.match(/\b(18[5-9]\d|19\d\d|20[0-4]\d)\b/);
  if (m) return Number(m[1]);
  for (const s of [file, strip(meta?.ObjectName?.value), strip(meta?.ImageDescription?.value)]) {
    const y = String(s || "").match(/\b(18[5-9]\d|19\d\d|20[0-4]\d)\b/);
    if (y) return Number(y[1]);
  }
  return null;
}

// Pick from candidates [{ file, year, width, height, text, p18 }] for one player.
export function choosePhoto(p, cands, nowYear = new Date().getUTCFullYear()) {
  if (!p.start) return null;
  const last = p.active || !p.end ? nowYear : p.end;
  const sn = surname(p.name);
  if (!sn || sn.length < 2) return null;
  let best = null, bestScore = -1;
  for (const c of cands) {
    if (!PHOTO.test(c.file) || c.year == null) continue;
    if (c.year < p.start - 1 || c.year > last + 1) continue;
    const inName = fold(c.file).includes(sn);
    const inText = fold(c.text).includes(sn);
    if (!inName && !inText && !c.p18) continue;
    // Checked with his name taken out, so a Park, a Field or a House isn't thrown away.
    if (NOT_HIM.test(fold(c.file).split(sn).join(" ")) || NOT_HIM.test(fold(c.text).slice(0, 200).split(sn).join(" "))) continue;
    if (c.width && c.width < 200) continue;
    const core = c.year >= p.start && c.year <= last;
    const tall = c.height && c.width ? c.height >= c.width * 0.75 : true;
    const about = fold(c.file + " " + c.text);
    const team = (p.teams || []).some(t => t && t.length > 2 && about.includes(fold(t)));
    const score = (inName ? 4 : inText ? 2 : 0) + (team ? 3 : 0) + (IN_GAME.test(about) ? 2 : 0) - (OFF_FIELD.test(about) ? 4 : 0)
      + (c.p18 ? 2 : 0) + (core ? 1 : 0) + (tall ? 1 : 0);
    if (score > bestScore) { best = c; bestScore = score; }
  }
  return best ? best.file : null;
}

async function post(params, { fetchImpl, ua }) {
  for (let t = 0; t < 4; t++) {
    try {
      const res = await fetchImpl(API, { method: "POST", body: new URLSearchParams({ format: "json", formatversion: "2", ...params }),
        headers: { "User-Agent": ua || "Draftdle", Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
        signal: AbortSignal.timeout(30000) });
      if (res.ok) { const j = await res.json(); if (!j.error) return j; }
      else if (res.status !== 429 && res.status < 500) return null;
    } catch { /* retry */ }
    await new Promise(r => setTimeout(r, process.env.DLE_FAST ? 1 : 2000 * (t + 1)));
  }
  return null;
}

export async function eraPhotos(players, { fetchImpl = globalThis.fetch, ua, log = () => {}, nowYear = new Date().getUTCFullYear() } = {}) {
  const out = new Map();
  const withTitle = players.filter(p => p.title && p.start);
  // 1. the files each article uses
  const filesOf = new Map();
  for (let i = 0; i < withTitle.length; i += 50) {
    const batch = withTitle.slice(i, i + 50);
    const byTitle = new Map(batch.map(p => [p.title, p]));
    let cont = {};
    for (let n = 0; n < 40; n++) {
      const j = await post({ action: "query", prop: "images", imlimit: "max", redirects: "1", titles: batch.map(p => p.title).join("|"), ...cont }, { fetchImpl, ua });
      if (!j) break;
      const back = new Map();
      for (const r of [...(j.query?.normalized || []), ...(j.query?.redirects || [])]) back.set(r.to, back.get(r.from) || r.from);
      for (const pg of j.query?.pages || []) {
        const p = byTitle.get(back.get(pg.title) || pg.title);
        if (!p) continue;
        const list = filesOf.get(p.id) || [];
        for (const im of pg.images || []) { const f = im.title.replace(/^File:/, ""); if (PHOTO.test(f)) list.push(f); }
        filesOf.set(p.id, list);
      }
      if (!j.continue) break;
      cont = j.continue;
    }
  }
  for (const p of withTitle) if (p.commons) { const l = filesOf.get(p.id) || []; if (!l.includes(p.commons)) l.push(p.commons); filesOf.set(p.id, l); }

  // 2. when and what each file is
  const all = [...new Set([...filesOf.values()].flat())];
  const info = new Map();
  for (let i = 0; i < all.length; i += 50) {
    const batch = all.slice(i, i + 50);
    let cont = {};
    for (let n = 0; n < 20; n++) {
      const j = await post({ action: "query", prop: "imageinfo", iiprop: "extmetadata|size", iiextmetadatafilter: "DateTimeOriginal|ImageDescription|ObjectName",
        titles: batch.map(f => "File:" + f).join("|"), ...cont }, { fetchImpl, ua });
      if (!j) break;
      const back = new Map();
      for (const r of j.query?.normalized || []) back.set(r.to, back.get(r.from) || r.from);
      for (const pg of j.query?.pages || []) {
        const ii = pg.imageinfo?.[0];
        // Commons files only: local English Wikipedia files are often non-free and aren't served
        // from Commons.
        if (!ii || pg.imagerepository !== "shared") continue;
        const f = (back.get(pg.title) || pg.title).replace(/^File:/, "");
        const meta = ii.extmetadata || {};
        info.set(f, { year: photoYear(meta, f), width: ii.width, height: ii.height,
          text: [meta.ObjectName?.value, meta.ImageDescription?.value].filter(Boolean).join(" ").replace(/<[^>]+>/g, " ") });
      }
      if (!j.continue) break;
      cont = j.continue;
    }
    if ((i / 50 + 1) % 40 === 0) log(`  photo dates ${Math.min(i + 50, all.length)}/${all.length}`);
  }

  // 3. choose
  for (const p of withTitle) {
    const cands = (filesOf.get(p.id) || []).map(f => ({ file: f, p18: f === p.commons, ...(info.get(f) || { year: null }) }));
    const pick = choosePhoto(p, cands, nowYear);
    if (pick) out.set(p.id, pick);
  }
  log(`  in-career photos for ${out.size} of ${withTitle.length} players (${all.length} photos checked)`);
  return out;
}
