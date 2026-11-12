{
  title: "Speedrundle",
  storeKey: "speedrundle.v1",
  better: "lower",
  // Cover art from speedrun.com's game pages (the same image the API lists as the game's cover).
  image: r => `https://www.speedrun.com/static/game/${r.group}/cover`,
  art: { mobile: "4/3", desktop: "16/9" },
  modes: [{
    id: "daily",
    label: "Daily",
    question: "Which world record is faster?",
    hint: "Each card is one speedrun category. The category name matters most: Any% can skip most of a game, 100% can't.",
    card: r => ({ name: r.game, meta: r.year ? String(r.year) : "", pill: r.label }),
    format: r => {
      const t = r.v;
      if (t < 60) return (Math.round(t * 10) / 10).toFixed(1) + "s";
      const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = Math.floor(t % 60);
      const z = n => String(n).padStart(2, "0");
      return h ? `${h}:${z(m)}:${z(s)}` : `${m}:${z(s)}`;
    },
    detail: r => {
      const e = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
      if (!r.runner) return `world record · <a href="${e(r.url)}" target="_blank" rel="noopener">leaderboard ↗</a>`;
      return `WR by ${e(r.runner)}${r.platform ? " on " + e(r.platform) : ""}${r.date ? " · " + e(r.date) : ""} · <a href="${e(r.url)}" target="_blank" rel="noopener">run ↗</a>`;
    },
    ratioText: q => `${q.toFixed(1)}× faster`
  }],
  example: Object.assign([{ name: "Super Mario 64", pill: "16 Star", value: "14:32", group: "o1y9wo6q" }, { name: "Celeste", pill: "Any%", value: "24:44", group: "o1y9j9v6" }],
    { note: "Super Mario 64's 16 Star world record is faster, so that card wins. Times are world records as of the last weekly refresh." }),
  footer: `<p>Leaderboard data from <a href="https://www.speedrun.com" target="_blank" rel="noopener">speedrun.com</a>, refreshed weekly. Each reveal links to the run or leaderboard. Not affiliated with speedrun.com.</p>`
}
