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
// Season templates to plain years: {{NFL Year|2000|2019}} -> 2000–2019, {{WNBA Year|2002}} -> 2002,
// and the short form {{nbay|2013|start}} -> 2013, {{nbay|2025|end}} -> 2026 (the 2025–26 season's end).
const SHORT = "(?:nba|wnba|nfl|nhl|mlb|aba|baa|afl|cfl|ufl|xfl|aaf|mls)y";
export const flatYears = line => line.replace(
  new RegExp(`\\{\\{\\s*(?:${SHORT}|[^|{}]*year[^|{}]*)\\s*\\|\\s*(\\d{4})\\s*(?:\\|\\s*(\\d{4}|start|end))?[^{}]*\\}\\}`, "gi"),
  (_, a, b) => b === "end" ? String(Number(a) + 1) : /^\d{4}$/.test(b || "") ? `${a}–${b}` : a);

// League seasons are written with a template ({{NBA Year|2013}}, {{NFL Year|2000|2019}}); other
// leagues use plain years or their own template. When any row uses the league's, keep only those.
function leagueRows(list, leagues) {
  if (!leagues?.length) return list;
  const re = new RegExp(`\\{\\{\\s*(${leagues.join("|")})(?:[ _]year\\b|y\\s*\\|)`, "i");
  const mine = list.filter(l => re.test(l));
  return mine.length ? mine : list;
}

function spans(list) {
  let lo = null, hi = null, open = false;
  for (const line of list) {
    const flat = flatYears(line);
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

// "[[Power forward (basketball)|Power forward]] / [[Center (basketball)|center]]" -> ["power forward", "center"]
export const boxPositions = v => String(v)
  .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, "$1").replace(/\{\{[^{}]*\}\}/g, " ").replace(/<[^>]+>/g, " ")
  .split(/\s*(?:\/|,|;|\band\b|\bor\b|\n|\*)\s*/i).map(x => x.replace(/\([^)]*\)/g, "").trim().toLowerCase()).filter(x => x && x.length < 40);

export function infoboxYears(text, kind, nowYear = new Date().getUTCFullYear(), leagues = []) {
  const box = infoboxFields(text || "", kind);
  if (!box) return null;
  const f = box.fields;
  let start = null, end = null, active = null;
  if (box.kind === "basketball" || box.kind === "hockey") {
    start = first(f.career_start || "");
    end = /present/i.test(f.career_end || "") ? null : first(f.career_end || "");
    if (start && !f.career_end) active = true;
    if (/present/i.test(f.career_end || "")) active = true;
    // career_start/end cover a whole pro career (Giannis from Greece in 2011); the season rows,
    // when there are any, say which were in the league and when the last one ended.
    const rows = seasonList(f, "years"), league = leagueRows(rows, leagues), s = spans(league);
    if (league !== rows && s.lo) { start = s.lo; end = s.open ? null : s.hi; active = s.open; }
    else if (s.lo) {
      // Unmarked rows can include youth clubs (Marta Xargay from 1996), so they only fill gaps:
      // a missing start, or a career_end nobody filled in (Chasity Melvin, 1999–2010).
      if (!start) start = s.lo;
      if (end == null && !/present/i.test(f.career_end || "")) { if (s.open) active = true; else { end = s.hi; active = false; } }
    }
  } else if (box.kind === "baseball") {
    start = first(f.debutyear || f.debutdate || "");
    end = first(f.finalyear || f.finaldate || "");
    if (start && !end) active = true;
  } else if (box.kind === "gridiron") {
    const s = spans(leagueRows(String(f.past_teams || f.pastteams || "").split("\n").filter(l => /\S/.test(l)), leagues));
    start = s.lo; end = s.open ? null : s.hi; if (s.lo) active = s.open;
    // A one-season current stint is often written without "present"; the status field says it.
    if (/^\s*(active|free agent|reserve|injured|practice squad|physically)/i.test(f.status || "")) { active = true; end = null; }
  } else {
    const s = spans(seasonList(f, "years"));
    start = s.lo; end = s.open ? null : s.hi; if (s.lo) active = s.open;
  }
  // A box with a coaching career and no playing seasons: a coach or executive, not a player.
  if (!start && !end && Object.keys(f).some(k => /^(coach|cyears|cteam|coaching|exec|gm_|regular_record|playoff_record|overall_record|pfr_coach|record$)/.test(k))) return { coachOnly: true };
  if (end && end > nowYear) end = null;
  if (end != null) active = false;
  // An "active" career that started 30+ years ago is a stale article, not a player.
  if (active && start && start < nowYear - 30) active = null;
  // Positions, for players Wikidata doesn't have one for yet (this year's rookies).
  const positions = boxPositions(f.position || f.career_position || f.positions || "");
  if (!(start || end || active != null)) return positions.length ? { positions } : null;
  return { start, end, active, ...(positions.length ? { positions } : {}) };
}

// Section 0 (the lead, where the infobox lives) for up to 50 titles a request. A batch that keeps
// failing is split in half until the bad part is found, so one odd title can't cost 49 others.
export async function infoboxes(titles, kind, { fetchImpl = globalThis.fetch, ua, log = () => {}, nowYear, leagues = [] } = {}) {
  const out = new Map(), list = [...new Set(titles)];
  let failed = 0, lastErr = "";
  const wait = t => new Promise(r => setTimeout(r, process.env.DLE_FAST ? 1 : 2000 * (t + 1)));

  async function ask(batch, cont = {}) {
    const body = new URLSearchParams({ action: "query", prop: "revisions", rvprop: "content", rvslots: "main", rvsection: "0",
      format: "json", formatversion: "2", redirects: "1", titles: batch.join("|"), ...cont });
    for (let t = 0; t < 4; t++) {
      try {
        const res = await fetchImpl("https://en.wikipedia.org/w/api.php", { method: "POST", body,
          headers: { "User-Agent": ua || "Draftdle", Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
          signal: AbortSignal.timeout(30000) });
        if (!res.ok) { lastErr = `HTTP ${res.status}`; if (res.status !== 429 && res.status < 500) return null; }
        else { const j = await res.json(); if (!j.error) return j; lastErr = j.error.code || "api error"; }
      } catch (e) { lastErr = e.message || String(e); }
      await wait(t);
    }
    return null;
  }

  function take(batch, j) {
    const back = new Map(batch.map(b => [b, b]));
    for (const n of j.query?.normalized || []) back.set(n.to, back.get(n.from) || n.from);
    for (const r of j.query?.redirects || []) back.set(r.to, back.get(r.from) || r.from);
    for (const pg of j.query?.pages || []) {
      const text = pg.revisions?.[0]?.slots?.main?.content;
      if (!text) continue;
      const y = infoboxYears(text, kind, nowYear, leagues);
      if (y) out.set(back.get(pg.title) || pg.title, y);
    }
  }

  async function run(batch) {
    let j = await ask(batch);
    if (!j) {
      if (batch.length === 1) { failed++; return; }
      const half = Math.ceil(batch.length / 2);
      await run(batch.slice(0, half)); await run(batch.slice(half)); return;
    }
    take(batch, j);
    // Large answers come back in parts; follow the continuation for the rest.
    for (let n = 0; j.continue && n < 50; n++) { j = await ask(batch, j.continue); if (!j) break; take(batch, j); }
  }

  for (let i = 0; i < list.length; i += 50) {
    await run(list.slice(i, i + 50));
    if ((i / 50 + 1) % 10 === 0) log(`  infoboxes ${Math.min(i + 50, list.length)}/${list.length}`);
  }
  log(`  career years from ${out.size} of ${list.length} infoboxes${failed ? ` (${failed} not fetched; last error: ${lastErr})` : ""}`);
  return out;
}
