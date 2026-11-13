// A D1 stand-in over node:sqlite for tests and local play: prepare/bind/first/all/run and batch,
// the parts of the D1 API the Pages Functions use.
import fs from "node:fs";
import { createRequire } from "node:module";
import { p } from "./lib.mjs";

export function d1(file = ":memory:", { migrations = p("sites/draftdle/migrations") } = {}) {
  process.removeAllListeners("warning");
  const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite");
  const fresh = file === ":memory:" || !fs.existsSync(file);
  const raw = new DatabaseSync(file);
  if (fresh) for (const f of fs.readdirSync(migrations).filter(f => f.endsWith(".sql")).sort()) raw.exec(fs.readFileSync(`${migrations}/${f}`, "utf8"));
  let reads = 0, writes = 0;
  const stmt = (sql, params = []) => ({
    bind(...ps) { return stmt(sql, ps); },
    async first() { reads++; return raw.prepare(sql).get(...params) ?? null; },
    async all() { reads++; return { results: raw.prepare(sql).all(...params) }; },
    async run() { writes++; const r = raw.prepare(sql).run(...params); return { meta: { changes: r.changes } }; },
    _exec() { const s = raw.prepare(sql); return /^\s*(select|with)/i.test(sql) ? { results: s.all(...params) } : (s.run(...params), { results: [] }); }
  });
  return {
    raw, stats: () => ({ reads, writes }),
    prepare: sql => stmt(sql),
    async batch(list) { raw.exec("BEGIN"); try { const out = list.map(s => { writes++; return s._exec(); }); raw.exec("COMMIT"); return out; } catch (e) { raw.exec("ROLLBACK"); throw e; } },
    // the nightly job's adapter shape
    nightly: {
      async all(sql, params = []) { return raw.prepare(sql).all(...params); },
      async run(sql, params = []) { raw.prepare(sql).run(...params); },
      async script(stmts) { raw.exec("BEGIN"); try { for (const s of stmts) raw.exec(s); raw.exec("COMMIT"); } catch (e) { raw.exec("ROLLBACK"); throw e; } }
    }
  };
}
