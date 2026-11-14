// A photo from during the player's career. Wikidata's photo (P18) is often a recent one: Tom
// Brady on a red carpet, a retired star at a ceremony. The Wikipedia article usually has photos
// from the playing years too, in games or team portraits. We read the date of every photo the
// article uses, plus P18, and keep the best one taken during the career that names the player.
//
// When the article has nothing from the career, the player's own Commons category is searched
// (usually full of game photos), and failing that a Commons search by name. Every player who has
// any photo at all gets one: if none is from the career, the closest-dated one (alt).
//
// eraPhotos(players, opts) -> Map id -> Commons file name (no "File:" prefix), with
//   .alt    Map id -> the closest photo when none is from the career
//   .offEra Set of ids whose Wikidata photo (P18) is dated outside their playing years
//   players: [{ id, name, title, start, end, active, commons, teams, category? }]

const API = "https://en.wikipedia.org/w/api.php";
const COMMONS = "https://commons.wikimedia.org/w/api.php";
const WIKIDATA = "https://www.wikidata.org/w/api.php";
const PHOTO = /\.(jpe?g|png|webp|tiff?)$/i;
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
    const inName = fold(c.file).includes(sn) || !!c.own;
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

// No photo from the career: the one closest to it, so the card still shows the player. Dated
// photos by distance from the playing years; undated ones after; his own category and P18 win ties.
// Whole name, letters only: "Terry Crews" in "Terry Crews as Julius", not "Madden NFL 07".
const plain = s => fold(s).replace(/\([^)]*\)/g, " ").replace(/[^a-z]+/g, " ").trim();
export function closestPhoto(p, cands, nowYear = new Date().getUTCFullYear()) {
  const sn = surname(p.name), whole = plain(p.name);
  const last = p.active || !p.end ? nowYear : p.end;
  let best = null, bestScore = -Infinity;
  for (const c of cands) {
    if (!PHOTO.test(c.file) || (c.width && c.width < 200)) continue;
    const about = fold(c.file + " " + c.text);
    // Another photo of the player, not one that only shares his surname; nothing from a TV show,
    // a film or a game (Wikidata's own photo is the fallback for those).
    const said = plain(c.file + " " + c.text);
    if (!(c.own || c.p18 || (whole && (said.includes(whole) || said.replace(/ /g, "").includes(whole.replace(/ /g, "")))))) continue;
    if (!c.p18 && (OFF_FIELD.test(about) || /video ?game|\bnfl \d\d|\bnba 2k|\bnhl \d\d|\bfifa \d\d|screenshot|cast\b|as [a-z]+ in\b/.test(about))) continue;
    if (sn && (NOT_HIM.test(fold(c.file).split(sn).join(" ")))) continue;
    const dist = c.year == null || !p.start ? 40 : c.year < p.start ? p.start - c.year : c.year > last ? c.year - last : 0;
    const score = -dist + (c.p18 ? 0.5 : 0) + (c.own ? 0.3 : 0) - (OFF_FIELD.test(about) ? 3 : 0) + (IN_GAME.test(about) ? 1 : 0);
    if (score > bestScore) { best = c; bestScore = score; }
  }
  return best ? best.file : null;
}

async function post(params, { fetchImpl, ua, api = API }) {
  for (let t = 0; t < 4; t++) {
    try {
      const res = await fetchImpl(api, { method: "POST", body: new URLSearchParams({ format: "json", formatversion: "2", ...params }),
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
  const out = new Map(), offEra = new Set();
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

  // 3. choose from the article
  const cands = new Map();
  for (const p of withTitle) cands.set(p.id, (filesOf.get(p.id) || []).map(f => ({ file: f, p18: f === p.commons, ...(info.get(f) || { year: null, text: "" }) })));
  const alt = new Map();
  let fromArticle = 0, fromCategory = 0, fromSearch = 0;
  for (const p of withTitle) {
    const pick = choosePhoto(p, cands.get(p.id), nowYear);
    if (pick) { out.set(p.id, pick); fromArticle++; }
    const own = cands.get(p.id).find(c => c.p18);
    const last = p.active || !p.end ? nowYear : p.end;
    if (own && own.year != null && (own.year < p.start - 1 || own.year > last + 1)) offEra.add(p.id);
  }

  // 4. nothing from the career in the article: the player's own Commons category
  const need = withTitle.filter(p => !out.has(p.id));
  const cats = await categoriesOf(need.filter(p => p.category === undefined).map(p => p.id), { fetchImpl, ua });
  const commonsInfo = async titles => {
    const got = [];
    for (let i = 0; i < titles.length; i += 50) {
      const j = await post({ action: "query", prop: "imageinfo", iiprop: "extmetadata|size", iiextmetadatafilter: "DateTimeOriginal|ImageDescription|ObjectName",
        titles: titles.slice(i, i + 50).join("|") }, { fetchImpl, ua, api: COMMONS });
      for (const pg of j?.query?.pages || []) {
        const ii = pg.imageinfo?.[0];
        if (!ii) continue;
        const f = pg.title.replace(/^File:/, ""), meta = ii.extmetadata || {};
        got.push({ file: f, year: photoYear(meta, f), width: ii.width, height: ii.height,
          text: [meta.ObjectName?.value, meta.ImageDescription?.value].filter(Boolean).join(" ").replace(/<[^>]+>/g, " ") });
      }
    }
    return got;
  };
  const filesIn = async cat => {
    const j = await post({ action: "query", list: "categorymembers", cmtitle: "Category:" + cat, cmtype: "file|subcat", cmlimit: "200" }, { fetchImpl, ua, api: COMMONS });
    const m = j?.query?.categorymembers || [];
    return { files: m.filter(x => x.ns === 6).map(x => x.title).filter(t => PHOTO.test(t)), subcats: m.filter(x => x.ns === 14).map(x => x.title.replace(/^Category:/, "")) };
  };
  const queue = [...need];
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (queue.length) {
      const p = queue.shift();
      const cat = p.category !== undefined ? p.category : cats.get(p.id);
      let extra = [];
      if (cat) {
        const top = await filesIn(cat);
        let titles = top.files.slice(0, 150);
        // "Michael Jordan in 1997", "Dawn Staley with the Houston Comets": one level down.
        const sn = surname(p.name);
        for (const sub of top.subcats.filter(c => fold(c).includes(sn)).slice(0, 8)) titles = titles.concat((await filesIn(sub)).files.slice(0, 60));
        extra = (await commonsInfo([...new Set(titles)])).map(c => ({ ...c, own: true }));
        const pick = choosePhoto(p, extra, nowYear);
        if (pick) { out.set(p.id, pick); fromCategory++; continue; }
      }
      let all = cands.get(p.id).concat(extra);
      // 5. no usable photo yet: search Commons by name, keeping files that give the whole name
      if (!p.commons && !closestPhoto(p, all, nowYear)) {
        const j = await post({ action: "query", list: "search", srnamespace: "6", srlimit: "30", srsearch: `"${p.name.replace(/\s*\([^)]*\)/g, "")}"` }, { fetchImpl, ua, api: COMMONS });
        const whole = fold(p.name.replace(/\s*\([^)]*\)/g, "")).replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();
        const found = (await commonsInfo((j?.query?.search || []).map(x => x.title).filter(t => PHOTO.test(t))))
          .filter(c => fold(c.file + " " + c.text).replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").includes(whole));
        const pick = choosePhoto(p, found, nowYear);
        if (pick) { out.set(p.id, pick); fromSearch++; continue; }
        all = all.concat(found);
      }
      const near = closestPhoto(p, all, nowYear);
      if (near && near !== p.commons) alt.set(p.id, near);
    }
  }));
  out.offEra = offEra;
  out.alt = alt;
  log(`  in-career photos for ${out.size} of ${withTitle.length} players (article ${fromArticle}, Commons category ${fromCategory}, Commons search ${fromSearch}); closest photo for ${alt.size} more (${all.length} article photos checked)`);
  return out;
}

// Wikidata statements for ids, 50 a request.
export async function claimsOf(ids, { fetchImpl = globalThis.fetch, ua } = {}) {
  const out = new Map();
  for (let i = 0; i < ids.length; i += 50) {
    for (let t = 0; t < 3; t++) {
      try {
        const res = await fetchImpl(`${WIKIDATA}?action=wbgetentities&format=json&props=claims&ids=${ids.slice(i, i + 50).join("|")}`,
          { headers: { "User-Agent": ua || "Draftdle", Accept: "application/json" }, signal: AbortSignal.timeout(30000) });
        if (!res.ok) throw new Error(String(res.status));
        const j = await res.json();
        for (const [id, e] of Object.entries(j.entities || {})) out.set(id, e.claims || {});
        break;
      } catch { await new Promise(r => setTimeout(r, process.env.DLE_FAST ? 1 : 2000 * (t + 1))); }
    }
  }
  return out;
}

// Each player's Commons category (P373), from Wikidata.
export async function categoriesOf(ids, opts = {}) {
  const out = new Map();
  for (const [id, c] of await claimsOf(ids, opts)) { const v = c.P373?.[0]?.mainsnak?.datavalue?.value; if (v) out.set(id, v); }
  return out;
}

// Titles of the English Wikipedia articles for Wikidata ids (for re-running photos on built pools).
export async function enTitles(ids, { fetchImpl = globalThis.fetch, ua } = {}) {
  const out = new Map();
  for (let i = 0; i < ids.length; i += 50) {
    for (let t = 0; t < 3; t++) {
      try {
        const res = await fetchImpl(`${WIKIDATA}?action=wbgetentities&format=json&props=sitelinks&sitefilter=enwiki&ids=${ids.slice(i, i + 50).join("|")}`,
          { headers: { "User-Agent": ua || "Draftdle", Accept: "application/json" }, signal: AbortSignal.timeout(30000) });
        if (!res.ok) throw new Error(String(res.status));
        const j = await res.json();
        for (const [id, e] of Object.entries(j.entities || {})) if (e.sitelinks?.enwiki?.title) out.set(id, e.sitelinks.enwiki.title);
        break;
      } catch { await new Promise(r => setTimeout(r, process.env.DLE_FAST ? 1 : 2000 * (t + 1))); }
    }
  }
  return out;
}
