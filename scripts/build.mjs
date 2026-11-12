#!/usr/bin/env node
// Build dist/SITE/ for each site: the game page plus about, privacy, 404, ads.txt, robots, sitemap,
// Cloudflare _headers and icons. Pages read frozen puzzles for yesterday..tomorrow (UTC).
//
//   node scripts/build.mjs              # both sites
//   node scripts/build.mjs --ad-preview # show striped boxes where ads will go (layout check only)

import fs from "node:fs";
import { p, read, utcDay, now, addDays, sites } from "./lib.mjs";
import { poolFor, modesFor } from "./puzzles.mjs";

const args = new Set(process.argv.slice(2));
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const json = v => JSON.stringify(v).replace(/</g, "\\u003c");
const warnings = [];

function checkAds(site) {
  const a = site.adsense || {};
  if (!a.client) { warnings.push(`${site.name}: no AdSense client set; building without ads`); return false; }
  if (!/^ca-pub-\d{16}$/.test(a.client)) throw new Error(`${site.name}: adsense.client must look like ca-pub-1234567890123456`);
  for (const [k, v] of Object.entries(a.slots || {})) {
    if (!v) warnings.push(`${site.name}: ad slot "${k}" is empty; that slot won't render`);
    else if (!/^\d{6,12}$/.test(v)) throw new Error(`${site.name}: ad slot "${k}" should be the numeric data-ad-slot id`);
  }
  return true;
}

function head(site, { title, description, path, ads }) {
  const url = site.url.replace(/\/$/, "") + path;
  return `<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(url)}">
<meta name="theme-color" content="${esc(site.themeColor)}">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/favicon-32.png" sizes="32x32" type="image/png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${esc(site.title)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(url)}">
<meta property="og:image" content="${esc(site.url.replace(/\/$/, ""))}/og.png">
<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
${ads ? `<meta name="google-adsense-account" content="${esc(site.adsense.client)}">
<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${esc(site.adsense.client)}" crossorigin="anonymous"></script>` : ""}`;
}

function footerLinks(ads) {
  return `<nav class="links" aria-label="Site"><a href="/about">How to play &amp; about</a><a href="/privacy">Privacy</a>${ads ? `<a href="#" data-privacy-choices hidden>Privacy choices</a>` : ""}</nav>`;
}

// ---------- the game page ----------
function gamePage(site, ads) {
  const tpl = fs.readFileSync(p("src/game.html"), "utf8");
  const core = fs.readFileSync(p("src/core.mjs"), "utf8").replace(/^export /gm, "");
  const game = fs.readFileSync(p("sites", site.name, "game.js"), "utf8").trim();
  const today = utcDay(now());
  const dates = [addDays(today, -1), today, addDays(today, 1)];
  const puzzles = {}, pools = {};
  const modes = [];
  for (const mode of modesFor(site)) {
    const byDate = {};
    for (const d of dates) {
      const f = read(p("data/puzzles", site.name, mode, d + ".json"), null);
      if (f) byDate[d] = { date: d, pairs: f.pairs, meta: f.meta };
    }
    // Practice and the fallback use the newest pool the mode can play.
    let pool = null;
    for (const d of [addDays(today, 1), today, addDays(today, -1), addDays(today, -2), addDays(today, -3)]) { pool = poolFor(site, mode, d); if (pool) break; }
    // A mode with no puzzles and no pool yet (All-Time before enough history) stays hidden.
    if (!Object.keys(byDate).length && !pool && mode !== modesFor(site)[0]) continue;
    modes.push(mode);
    puzzles[mode] = byDate;
    pools[mode] = pool ? { items: pool.items, meta: pool.meta } : { items: [], meta: {} };
  }
  const SITE = {
    name: site.name, title: site.title, url: site.url, epoch: site.epoch,
    shareUrl: site.url.replace(/^https?:\/\//, "").replace(/\/$/, ""),
    ads: { client: ads ? site.adsense.client : "", slots: ads ? site.adsense.slots : {}, preview: args.has("--ad-preview") },
    footerLinks: footerLinks(ads), allowDateParam: args.has("--allow-date")
  };
  const config = `(() => { const c = ${game}; c.modes = c.modes.filter(m => ${json(modes)}.includes(m.id)); return c; })()`;
  return tpl
    .replace("<!--HEAD-->", head(site, { title: `${site.title}: ${site.tagline.replace(/\.$/, "")}`, description: site.description, path: "/", ads }))
    .replace("/*CORE*/", () => core)
    .replace("/*SITE*/", () => json(SITE))
    .replace("/*CONFIG*/", () => config)
    .replace("/*PUZZLES*/", () => json(puzzles))
    .replace("/*POOLS*/", () => json(pools));
}

// ---------- text pages ----------
const PAGE_CSS = `:root{--bg:#fff;--ink:#1a1a1b;--quiet:#787c7e;--line:#d3d6da;--good:#6aaa64}
@media (prefers-color-scheme: dark){:root{--bg:#121213;--ink:#f8f8f8;--quiet:#818384;--line:#3a3a3c;--good:#538d4e}}
*{box-sizing:border-box}html,body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.55 "Helvetica Neue",Arial,"Segoe UI",Roboto,sans-serif}
.bar{height:56px;border-bottom:1px solid var(--line);display:grid;grid-template-columns:1fr auto 1fr;align-items:center;padding:0 16px}
.bar a.home{grid-column:2;font-weight:800;font-size:30px;letter-spacing:.06em;text-transform:uppercase;color:var(--ink);text-decoration:none;line-height:1}
.bar a.play{grid-column:3;justify-self:end;font-size:13px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#fff;background:var(--good);padding:8px 14px;border-radius:999px;text-decoration:none}
main{max-width:640px;margin:0 auto;padding:8px 16px 48px}a{color:inherit}
h1{font-size:28px;font-weight:800;margin:22px 0 8px}h2{font-size:15px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;margin:28px 0 6px}p,li{max-width:66ch}
.quiet{color:var(--quiet);font-size:14px}footer{margin-top:36px;padding-top:14px;border-top:1px solid var(--line);font-size:13px;color:var(--quiet);text-align:center}footer a{color:var(--quiet);margin:0 7px}
@media (max-width:420px){.bar a.home{font-size:24px}.bar a.play{padding:6px 10px;font-size:11px}}`;

function textPage(site, ads, { path, title, description, body }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${head(site, { title: `${title} · ${site.title}`, description, path, ads: false })}
<style>${PAGE_CSS}</style>
</head>
<body>
<header class="bar"><a class="home" href="/">${esc(site.title)}</a><a class="play" href="/">Play</a></header>
<main>
${body}
<footer><a href="/">Play</a><a href="/about">About</a><a href="/privacy">Privacy</a></footer>
</main>
</body>
</html>
`;
}

function about(site) {
  const contact = site.contact ? `<p>Questions, corrections or a game you'd like added: <a href="mailto:${esc(site.contact)}">${esc(site.contact)}</a>.</p>` : "";
  const how = `<h2>How to play</h2>
<p>Each day has ten pairs. Pick the card you think wins; the answer and the margin show right away. The first three pairs are far apart, the middle four are closer, and the last three are within 1.5× of each other. Everyone gets the same ten pairs, and a new set starts at midnight in your time zone.</p>
<p>Your results, streak and score history stay in this browser. Practice plays random pairs that don't count. Keys: 1 or ← for the left card, 2 or → for the right.</p>`;
  const body = site.name === "speedrundle" ? `<h1>About Speedrundle</h1>
<p>${esc(site.description)}</p>
${how}
<h2>Reading the cards</h2>
<p>Each card is one speedrun category of one game. The category name matters more than the game: <b>Any%</b> means finishing by any means, often skipping most of the game; <b>100%</b> means collecting everything; <b>Glitchless</b> or <b>No Major Glitches</b> rule out the big skips. Times are the current world record for that category, timed the way the leaderboard times it.</p>
<h2>Where the data comes from</h2>
<p>World records come from the <a href="https://www.speedrun.com" target="_blank" rel="noopener">speedrun.com</a> leaderboards through its public API and are refreshed weekly, so a record broken this week can show the old time for a few days. Each reveal links to the run or the leaderboard. Speedrundle isn't affiliated with speedrun.com; credit for every run belongs to its runner.</p>
${contact}
<p class="quiet">Made by ${esc(site.operator)}.</p>` : `<h1>About ${esc(site.title)}</h1>
<p>CCU means concurrent users: how many people are playing a game at the same moment.</p>
<p>${esc(site.description)}</p>
${how}
<h2>Live</h2>
<p>Live compares each game's peak on one UTC day: the most people playing it at the same moment, from hourly samples of Steam's own player counts. Because players around the world start each day at different times, a puzzle uses the day that finished two days before it, and the question names that day.</p>
<h2>All-Time</h2>
<p>All-Time compares the highest peak ${esc(site.title)} has recorded for each game since it started tracking. It opens once there are ${esc(site.alltime.minTrackedDays)} days of history.</p>
<h2>Where the data comes from</h2>
<p>Player counts come from the Steam Web API. Genre and price model come from <a href="https://steamspy.com" target="_blank" rel="noopener">SteamSpy</a>. Only games on Steam are included, so a game's players on other stores and consoles don't count. ${esc(site.title)} isn't affiliated with or endorsed by Valve or Steam. Steam is a trademark of Valve Corporation.</p>
${contact}
<p class="quiet">Made by ${esc(site.operator)}.</p>`;
  return { path: "/about", title: "How to play & about", description: `How ${site.title} works and where its data comes from.`, body };
}

function privacy(site, ads) {
  const updated = "2026-11-11";
  const contact = site.contact ? `<a href="mailto:${esc(site.contact)}">${esc(site.contact)}</a>` : "the contact address on the About page";
  const body = `<h1>Privacy policy</h1>
<p class="quiet">Last updated ${updated}</p>
<p>${esc(site.title)} (${esc(site.url)}) is run by ${esc(site.operator)}. This page says what the site stores, who else is involved, and the choices you have.</p>
<h2>What the game keeps</h2>
<p>Your answers, streak and score history are saved in your browser's local storage so you can come back to them. They never leave your device and are not sent to us. Clearing your browser's site data deletes them. There are no accounts.</p>
<h2>Hosting</h2>
<p>The site is served by Cloudflare. Like any web host, Cloudflare processes your IP address and basic request details to deliver pages and protect the site from abuse. See <a href="https://www.cloudflare.com/privacypolicy/" target="_blank" rel="noopener">Cloudflare's privacy policy</a>.</p>
<h2>Game images</h2>
<p>${site.name === "peakdle" ? "Game art loads straight from Steam's image servers (steamstatic.com)" : "Game box art loads straight from speedrun.com"}, so those servers receive your IP address and browser details when you view a card, as with any image on the web. The page asks your browser not to send them the address of this site.</p>
<h2>Advertising</h2>
<p>The site shows ads from Google AdSense. Third-party vendors, including Google, use cookies to serve ads based on your prior visits to this website or other websites. Google's use of advertising cookies enables it and its partners to serve ads to you based on your visits to this site and/or other sites on the Internet.</p>
<p>You can opt out of personalised advertising in <a href="https://adssettings.google.com" target="_blank" rel="noopener">Google's Ads Settings</a>, or opt out of some third-party vendors' use of cookies for personalised advertising at <a href="https://www.aboutads.info/choices/" target="_blank" rel="noopener">aboutads.info</a>. Google explains how it uses information from sites that use its services at <a href="https://policies.google.com/technologies/partner-sites" target="_blank" rel="noopener">policies.google.com/technologies/partner-sites</a>.</p>
<h2>Your choices</h2>
<p>If you are in the European Economic Area, the UK or Switzerland, the site asks for your consent before ads use cookies for personalisation, through Google's consent tool. If you live in a US state with its own privacy law, the same tool shows a "Do not sell or share my personal information" link that lets you opt out of the sale or sharing of your personal information for advertising. Visitors in the EEA, the UK or Switzerland can change their consent at any time with the "Privacy choices" link at the bottom of the game page; the link only appears where that consent applies.</p>
<h2>Children</h2>
<p>The site is not directed to children under 13, and we don't knowingly collect information from them.</p>
<h2>Changes and contact</h2>
<p>If this policy changes, the date at the top changes with it. Questions: ${contact}.</p>`;
  return { path: "/privacy", title: "Privacy policy", description: `What ${site.title} stores and how ads on the site use cookies.`, body };
}

function notFound(site) {
  return { path: "/404", title: "Page not found", description: site.description,
    body: `<h1>Page not found</h1><p>That page doesn't exist. <a href="/">Play today's ${esc(site.title)}</a>.</p>` };
}

// ---------- build ----------
for (const site of sites()) {
  const ads = checkAds(site);
  if (!site.contact) warnings.push(`${site.name}: no contact address; AdSense reviewers look for one`);
  const out = p("dist", site.name);
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  const put = (f, s) => fs.writeFileSync(`${out}/${f}`, s);
  put("index.html", gamePage(site, ads));
  put("about.html", textPage(site, ads, about(site)));
  put("privacy.html", textPage(site, ads, privacy(site, ads)));
  put("404.html", textPage(site, ads, notFound(site)));
  if (ads) put("ads.txt", `google.com, ${site.adsense.client.replace("ca-", "")}, DIRECT, f08c47fec0942fa0\n`);
  put("robots.txt", `User-agent: *\nAllow: /\nSitemap: ${site.url.replace(/\/$/, "")}/sitemap.xml\n`);
  put("sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${["/", "/about", "/privacy"].map(u => `  <url><loc>${esc(site.url.replace(/\/$/, "") + u)}</loc></url>`).join("\n")}\n</urlset>\n`);
  put("_headers", `/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n  Permissions-Policy: camera=(), microphone=(), geolocation=()\n  X-Frame-Options: SAMEORIGIN\n\n/\n  Cache-Control: public, max-age=300, must-revalidate\n\n/og.png\n  Cache-Control: public, max-age=86400\n`);
  for (const f of fs.readdirSync(p("static", site.name))) fs.copyFileSync(p("static", site.name, f), `${out}/${f}`);
  const size = fs.statSync(`${out}/index.html`).size;
  console.log(`dist/${site.name}: index.html ${Math.round(size / 1024)} KB${ads ? ", ads on" : ""}`);
}
for (const w of warnings) console.log("note: " + w);
