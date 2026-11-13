// Career years from an English Wikipedia infobox. Wikidata often has a player's team stints
// without an end date, which made retired players read "–present". The sport infoboxes carry
// the career span in a few well-known fields, so we read those instead.
//
// infoboxYears(wikitext, kind) -> { start, end, active } or null when no sport infobox was found.
// Each field may be null when the infobox doesn't say.

const YEAR = /\b(18[5-9]\d|19\d\d|20[0-4]\d)\b/g;

// Which infobox each kind of sport uses. A two-sport athlete (Jim Thorpe, Deion Sanders) has
// one per sport, or only one, so each sport reads only its own.
export const BOXES = {
  gridiron: /\{\{\s*Infobox\s+(gridiron football|NFL|American football|CFL)[ _](biography|player)/i,
  basketball: /\{\{\s*Infobox\s+basketball[ _](biography|player)/i,
  baseball: /\{\{\s*Infobox\s+(baseball|MLB)[ _](biography|player)/i,
  hockey: /\{\{\s*Infobox\s+ice[ _]hockey[ _](player|biography)/i,
  soccer: /\{\{\s*Infobox\s+(football|soccer)[ _](biography|player)/i,
};

// Pull "| name = value" pairs from that sport's infobox, values running to the next field.
export function infoboxFields(text, kind) {
  const re = BOXES[kind];
  const start = re ? text.search(re) : -1;
  if (start < 0) return null;
  // Walk braces to find the end of the template.
  let depth = 0, i = start, end = text.length;
  for (; i < text.length - 1; i++) {
    if (text[i] === "{" && text[i + 1] === "{") { depth++; i++; }
    else if (text[i] === "}" && text[i + 1] === "}") { depth--; i++; if (depth === 0) { end = i + 1; break; } }
  }
  const body = text.slice(start, end)
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<ref[^>]*\/>/gi, "")
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, "");
  // Split on top-level pipes only, so pipes inside {{...}} and [[...]] stay with their value.
  const fields = {};
  let d = 0, cur = "";
  const parts = [];
  for (let k = body.indexOf("|"); k > 0 && k < body.length - 2; k++) {
    const two = body.slice(k, k + 2);
    if (two === "{{" || two === "[[") { d++; cur += two; k++; continue; }
    if (two === "}}" || two === "]]") { d--; cur += two; k++; continue; }
    if (body[k] === "|" && d === 0) { if (cur) parts.push(cur); cur = ""; continue; }
    cur += body[k];
  }
  if (cur) parts.push(cur);
  for (const p of parts) {
    const eq = p.indexOf("=");
    if (eq < 0) continue;
    const key = p.slice(0, eq).trim().toLowerCase().replace(/\s+/g, "_");
    const val = p.slice(eq + 1).trim();
    if (key && val) fields[key] = val;
  }
  return { kind, fields };
}

const years = s => [...String(s).matchAll(YEAR)].map(m => Number(m[1]));
const first = s => { const y = years(s); return y.length ? y[0] : null; };
// "present", or a range left open: "2023–", "{{NFL Year|2017}}–present"
const isOpen = s => /present|current/i.test(s) || /\d{4}\s*(?:\}\})?\s*[–—-]\s*(?:\n|$|\(|\|)/.test(s.trim() + "\n");

// Year range lists: soccer "years1 = 2004–2021", gridiron "* [[Team]] ({{NFL Year|2000|2019}})".
function spans(list) {
  let lo = null, hi = null, open = false;
  for (const line of list) {
    // {{NFL Year|2000|2019}} -> 2000–2019 ; {{WNBA Year|2002}} -> 2002
    const flat = line.replace(/\{\{\s*[^|{}]*year[^|{}]*\|\s*(\d{4})\s*(?:\|\s*(\d{4}))?[^{}]*\}\}/gi, (_, a, b) => b ? `${a}–${b}` : a);
    // Gridiron lists put each team's years in parentheses after the team; read only those.
    const bits = /\*/.test(flat) ? [...flat.matchAll(/\(([^()]*)\)/g)].map(m => m[1]) : [flat];
    for (const b of bits) {
      const y = years(b);
      if (!y.length) continue;
      lo = lo == null ? Math.min(...y) : Math.min(lo, ...y);
      hi = hi == null ? Math.max(...y) : Math.max(hi, ...y);
      if (isOpen(b)) open = true;
    }
  }
  return { lo, hi, open };
}

// years1, years2, ... in order (not youthyears, nationalyears, manageryears or cyears).
const seasonList = (f, prefix) => Object.keys(f).filter(k => new RegExp(`^${prefix}\\d+$`).test(k))
  .sort((a, b) => Number(a.slice(prefix.length)) - Number(b.slice(prefix.length))).map(k => f[k]);

export function infoboxYears(text, kind, nowYear = new Date().getUTCFullYear()) {
  const box = infoboxFields(text || "", kind);
  if (!box) return null;
  const f = box.fields;
  let start = null, end = null, active = null;
  if (box.kind === "basketball" || box.kind === "hockey") {
    start = first(f.career_start || "");
    end = /present/i.test(f.career_end || "") ? null : first(f.career_end || "");
    if (start && !f.career_end) active = true;
    if (/present/i.test(f.career_end || "")) active = true;
    // Some basketball boxes leave career_start blank and only list seasons (years1, team1, ...).
    if (!start && !end) {
      const s = spans(seasonList(f, "years"));
      start = s.lo; end = s.open ? null : s.hi; if (s.lo) active = s.open;
    }
  } else if (box.kind === "baseball") {
    start = first(f.debutyear || f.debutdate || "");
    end = first(f.finalyear || f.finaldate || "");
    if (start && !end) active = true;
  } else if (box.kind === "gridiron") {
    const s = spans(String(f.past_teams || f.pastteams || "").split("\n"));
    start = s.lo; end = s.open ? null : s.hi; if (s.lo) active = s.open;
    // A one-season current stint is often written without "present"; the status field says it.
    if (/^\s*(active|free agent|reserve|injured|practice squad|physically)/i.test(f.status || "")) { active = true; end = null; }
  } else {
    const s = spans(seasonList(f, "years"));
    start = s.lo; end = s.open ? null : s.hi; if (s.lo) active = s.open;
  }
  if (end && end > nowYear) end = null;
  if (end != null) active = false;
  // An "active" career that started 30+ years ago is a stale article, not a player.
  if (active && start && start < nowYear - 30) active = null;
  return start || end || active != null ? { start, end, active } : null;
}

// Section 0 (the lead, where the infobox lives) for up to 50 titles a request.
export async function infoboxes(titles, kind, { fetchImpl = globalThis.fetch, ua, log = () => {}, nowYear } = {}) {
  const out = new Map(), list = [...new Set(titles)];
  let failed = 0;
  for (let i = 0; i < list.length; i += 50) {
    const batch = list.slice(i, i + 50);
    const url = "https://en.wikipedia.org/w/api.php?action=query&prop=revisions&rvprop=content&rvslots=main&rvsection=0&format=json&formatversion=2&redirects=1&maxlag=5&titles=" + encodeURIComponent(batch.join("|"));
    let j = null;
    for (let t = 0; t < 4 && !j; t++) {
      try {
        const res = await fetchImpl(url, { headers: { "User-Agent": ua || "Draftdle", Accept: "application/json" }, signal: AbortSignal.timeout(30000) });
        if (res.ok) { j = await res.json(); if (j.error) { j = null; throw new Error(j?.error?.code); } }
        else if (res.status !== 429 && res.status < 500) break;
      } catch { /* retry */ }
      if (!j) await new Promise(r => setTimeout(r, process.env.DLE_FAST ? 1 : 2000 * (t + 1)));
    }
    if (!j) { failed += batch.length; continue; }
    // Redirects and normalisation change titles; map answers back to what we asked for.
    const back = new Map(batch.map(b => [b, b]));
    for (const n of j.query?.normalized || []) back.set(n.to, back.get(n.from) || n.from);
    for (const r of j.query?.redirects || []) back.set(r.to, back.get(r.from) || r.from);
    for (const p of j.query?.pages || []) {
      const text = p.revisions?.[0]?.slots?.main?.content;
      if (!text) continue;
      const y = infoboxYears(text, kind, nowYear);
      if (y) out.set(back.get(p.title) || p.title, y);
    }
    if ((i / 50 + 1) % 10 === 0) log(`  infoboxes ${Math.min(i + 50, list.length)}/${list.length}`);
  }
  log(`  career years from ${out.size} of ${list.length} infoboxes${failed ? ` (${failed} not fetched)` : ""}`);
  return out;
}
