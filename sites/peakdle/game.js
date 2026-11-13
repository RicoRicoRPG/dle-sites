{
  title: "CCUdle",
  storeKey: "ccudle.v1",
  better: "higher",
  pairRule: (a, b) => !(a.top10 && b.top10),
  // Header art from Steam's store CDN; the path comes from IStoreBrowseService (scripts/peakdle-assets.mjs).
  image: g => g.img ? `https://shared.steamstatic.com/store_item_assets/steam/apps/${g.group}/${g.img}` : "",
  art: { mobile: "460/215", desktop: "460/215" },
  modes: [{
    id: "live",
    label: "Live",
    question: m => {
      if (!m || !m.day) return "Which game had more players at its peak?";
      const d = new Date(m.day + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
      return `Which game had more players at its peak on ${d}?`;
    },
    hint: "Counts are the most people playing at the same moment on Steam during that UTC day, sampled every hour.",
    unavailable: "The first Live puzzle appears once CCUdle has a full day of player counts. Check back tomorrow.",
    card: g => ({ name: g.name, meta: [g.genre, g.free ? "Free" : "Paid"].filter(Boolean).join(" · ") }),
    format: g => g.v.toLocaleString("en-US"),
    detail: g => "daily peak",
    ratioText: q => `${q.toFixed(1)}× more`
  }, {
    id: "alltime",
    label: "All-Time",
    question: m => m && m.since
      ? `Which game has the higher player peak since ${new Date(m.since + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}?`
      : "Which game has the higher all-time player peak?",
    hint: "The most people ever recorded playing a game at the same moment on Steam.",
    unavailable: "All-Time opens once CCUdle has enough history. Play Live in the meantime.",
    card: g => ({ name: g.name, meta: [g.genre, g.free ? "Free" : "Paid"].filter(Boolean).join(" · ") }),
    format: g => g.v.toLocaleString("en-US"),
    detail: g => g.when ? `peak set ${g.when}` : "record peak",
    ratioText: q => `${q.toFixed(1)}× more`
  }],
  example: Object.assign([{ name: "Counter-Strike 2", value: "1,071,403", group: 730, img: "162664aa5da85f418105350c5d67ca565f6c3713/header.jpg" }, { name: "Stardew Valley", value: "71,940", group: 413150, img: "header.jpg" }],
    { note: "Counter-Strike 2 had more people playing at its peak, so that card wins. These numbers are an example; each puzzle uses the day it names." }),
  footer: `<p>Player counts from the Steam Web API and <a href="https://steamcharts.com" target="_blank" rel="noopener">SteamCharts</a>, sampled hourly. Genre and price model from <a href="https://steamspy.com" target="_blank" rel="noopener">SteamSpy</a>.</p>
           <p>Not affiliated with or endorsed by Valve or Steam. Steam is a trademark of Valve Corporation. Data is provided as is, without warranty of any kind.</p>`
}
