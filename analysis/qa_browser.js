/* ==========================================================================
   qa_browser.js — end-to-end QA of the live pages in a real (headless) Chrome.

   Drives the dashboard like a user (filters, stat/measure/breakdown switches, table
   sort + search, player search, team-map click, reset) and checks what is DISPLAYED
   against (a) data/report_metrics.json and (b) js/metrics.js run independently in Node.
   Also checks index.html renders with zero binding mismatches and no console errors.

   Requires Google Chrome and puppeteer-core (not a site dependency):
     npm i --no-save puppeteer-core
     python3 -m http.server 8000        # in the repo root, in another terminal
     node analysis/qa_browser.js http://localhost:8000
   or against the live site:
     node analysis/qa_browser.js https://jalmanza12.github.io/run-it-back-nfl
   ========================================================================== */
const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer-core");
const M = require("../js/metrics.js");

const BASE = (process.argv[2] || "http://localhost:8000").replace(/\/$/, "");
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const ROOT = path.join(__dirname, "..");
const R = JSON.parse(fs.readFileSync(path.join(ROOT, "data/report_metrics.json"), "utf8"));
const ds = M.Dataset(JSON.parse(fs.readFileSync(path.join(ROOT, "data/dashboard_data.json"), "utf8")));
const nf = (v, d) => new Intl.NumberFormat("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }).format(v).replace("-", "−");

let pass = 0, fail = 0;
const log = [];
function check(name, got, want) {
  if (String(got).trim() === String(want).trim()) { pass++; log.push(`  ✓ ${name}`); }
  else { fail++; log.push(`  ✗ ${name}: shown "${got}" expected "${want}"`); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new" });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]); // count-ups finish instantly
  await page.setViewport({ width: 1440, height: 1000 });

  /* ------------------------------------------------ report page */
  log.push("index.html");
  await page.goto(BASE + "/index.html", { waitUntil: "networkidle0" });
  await page.waitForFunction(() => document.documentElement.dataset.ready === "1");
  check("report binding mismatches", (await page.evaluate(() => window.__reportBindingMismatches.length)), 0);
  check("report charts rendered (svg)", await page.$$eval(".chart svg.plot", (n) => n.length), 9);
  check("report ranked charts rendered", await page.$$eval("#c-f9 .rk-row", (n) => n.length), 32);
  check("report number tables", await page.$$eval("details.numbers table", (n) => n.length), 11);
  check("report link to dashboard", await page.$eval(".nav-cta", (a) => a.getAttribute("href")), "dashboard.html");

  /* ------------------------------------------------ dashboard */
  log.push("dashboard.html");
  await page.goto(BASE + "/dashboard.html", { waitUntil: "networkidle0" });
  await page.waitForFunction(() => document.documentElement.dataset.ready === "1");
  const settle = async () => { await sleep(120); await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))); };
  const txt = (sel) => page.$eval(sel, (n) => n.textContent.trim());
  const tableCol = (col) => page.$$eval("#t tbody tr", (trs, c) => trs.map((tr) => tr.children[c].textContent.trim()), col);
  const tableFirst = () => page.$$eval("#t tbody tr", (trs) => trs.map((tr) => { const c = tr.children[0].cloneNode(true); c.querySelectorAll(".team-badge").forEach((b) => b.remove()); return c.textContent.trim(); }));
  const setSel = async (id, v) => { await page.select(id, v); await settle(); };
  const click = async (sel) => { await page.click(sel); await settle(); };
  const range = async (a, b) => {
    await page.evaluate((a, b) => {
      const lo = document.getElementById("season-min"), hi = document.getElementById("season-max");
      hi.value = b; hi.dispatchEvent(new Event("input")); lo.value = a; lo.dispatchEvent(new Event("input"));
    }, a, b);
    await settle();
  };
  const expected = (f, stat, measure) => M.aggregate(ds, M.filter(ds, { seasonMin: 2015, seasonMax: 2025, stype: "reg", teams: null, pos: null, conf: "all", venue: "all", player: null, ...f }), stat, measure);

  // defaults == report
  check("default KPI = league offensive yds/team-game (report f9)", await txt("#k-measure"), nf(R.f9.league_ypg, 1));
  check("default KPI player-games = regular-season rows", await txt("#k-rows"), nf(R.meta.reg_rows, 0));
  check("default KPI team-games", await txt("#k-tg"), nf(R.meta.reg_team_games, 0));
  check("default chips", await txt("#active-chips"), "Showing all regular-season games, 2015–2025.");
  check("5 charts present", await page.$$eval("#charts .panel", (n) => n.length), 5);

  // measure + stat switch: passing yards per team-game by season == finding 1
  await setSel("#stat-select", "pass_yds");
  check("table rows by season", (await tableFirst()).length, 11);
  const f1 = await tableCol(1);
  R.f1.pass_ypg.forEach((d, i) => check(`pass yds/team-game ${d.season} (f1)`, f1[i], nf(d.value, 1)));
  // rate stat: measure control locks to "rate"
  await setSel("#stat-select", "sack_rate");
  check("rate stat forces rate measure", await page.$eval("#measure-select", (s) => s.value), "rate");
  check("non-rate measures disabled", await page.$$eval("#measure-select option:disabled", (o) => o.length), 4);
  const f3 = await tableCol(1);
  R.f3.sack_rate.forEach((d, i) => check(`sack rate ${d.season} (f3)`, f3[i], nf(d.value, 1) + "%"));
  // measure switch: avg PPR per player-game by position == finding 10
  await setSel("#stat-select", "ppr"); await setSel("#measure-select", "avg"); await setSel("#dim-select", "pos");
  const posLabels = await tableFirst(), posVals = await tableCol(1);
  R.f10.positions.forEach((p) => check(`avg PPR ${p.position} (f10)`, posVals[posLabels.indexOf(p.position)], nf(p.mean, 2)));
  await setSel("#measure-select", "median");
  const posMed = await tableCol(1), posLab2 = await tableFirst();
  R.f10.positions.forEach((p) => check(`median PPR ${p.position} (f10)`, posMed[posLab2.indexOf(p.position)], nf(p.median, 1)));
  // dimension switch: team == finding 9 (ranked)
  await setSel("#stat-select", "off_yds"); await setSel("#measure-select", "ptg"); await setSel("#dim-select", "team");
  check("breakdown by team shows ranked bars", await page.$$eval("#c1-rank .rk-row", (n) => n.length), 32);
  check("top team (f9)", (await tableFirst())[0], R.f9.top_name);
  check("top team value (f9)", (await tableCol(1))[0], nf(R.f9.top_ypg, 1));
  // table sort (ascending on measure column) -> worst team first
  await click("#t thead th:nth-child(2) button"); await click("#t thead th:nth-child(2) button");
  check("sort ascending: bottom team (f9)", (await tableFirst())[0], R.f9.bottom_name);
  check("aria-sort set", await page.$eval("#t thead th:nth-child(2)", (th) => th.getAttribute("aria-sort")), "ascending");
  // table search
  await page.type("#t-search", "jets"); await settle();
  check("table search", (await tableFirst()).join("|"), "New York Jets");
  await page.$eval("#t-search", (i) => { i.value = ""; i.dispatchEvent(new Event("input")); }); await settle();
  // player dimension -> top 20
  await setSel("#dim-select", "player");
  check("player breakdown shows top 20", await page.$$eval("#c1-rank .rk-row", (n) => n.length), 20);
  await setSel("#dim-select", "season");

  // filters
  await click('.seg[data-filter="stype"] button[data-v="post"]');
  check("season type = playoffs → rows", await txt("#k-rows"), nf(R.meta.post_rows, 0));
  await click('.seg[data-filter="stype"] button[data-v="all"]');
  check("season type = both → rows", await txt("#k-rows"), nf(R.meta.rows, 0));
  await click('.seg[data-filter="stype"] button[data-v="reg"]');
  await range(2020, 2020); await click('.seg[data-filter="venue"] button[data-v="home"]');
  check("2020 home offense yds/team-game (f8)", await txt("#k-measure"), nf(R.f8.y2020_home, 1));
  await click('.seg[data-filter="venue"] button[data-v="away"]');
  check("2020 away offense yds/team-game (f8)", await txt("#k-measure"), nf(R.f8.y2020_away, 1));
  check("chips show active filters", await page.$$eval("#active-chips .achip", (n) => n.length), 2);
  await click('.seg[data-filter="venue"] button[data-v="all"]'); await range(2015, 2025);
  // positions: QB only
  for (const v of ["1", "2", "3"]) await click(`#pos-chips button[data-v="${v}"]`);
  check("QB-only player-games", await txt("#k-rows"), nf(M.filter(ds, { seasonMin: 2015, seasonMax: 2025, stype: "reg", teams: null, pos: new Set([0]), conf: "all", venue: "all", player: null }).length, 0));
  check("trend chart shows 1 line", await page.$$eval("#c2 path.line", (n) => n.length), 1);
  for (const v of ["1", "2", "3"]) await click(`#pos-chips button[data-v="${v}"]`);
  // conference
  await click('.seg[data-filter="conf"] button[data-v="NFC"]');
  check("NFC: team map greys out 16 AFC teams", await page.$$eval("#c4 .tile.off", (n) => n.length), 16);
  check("NFC offense yds/team-game", await txt("#k-measure"), nf(expected({ conf: "NFC" }, "off_yds", "ptg"), 1));
  await click('.seg[data-filter="conf"] button[data-v="all"]');
  // team via team-map click (KC)
  const kc = ds.teams.findIndex((t) => t.code === "KC");
  await page.evaluate((i) => document.querySelectorAll("#c4 .tile")[[...document.querySelectorAll("#c4 .tile")].findIndex((t) => t.querySelector("b").textContent === "KC")].click(), kc);
  await settle();
  check("team filter via map (KC) = f9", await txt("#k-measure"), nf(R.f9.teams.find((t) => t.team === "KC").ypg, 1));
  check("team button text", await txt("#team-btn-text"), "KC");
  // player search
  await page.type("#player-input", "Derrick Hen"); await sleep(150);
  await page.keyboard.press("ArrowDown"); await page.keyboard.press("Enter"); await settle();
  check("KC + Derrick Henry → no rows", await txt("#k-rows"), "0");
  await page.click('#active-chips .achip button[aria-label^="Remove filter: KC"]'); await settle();
  check("Henry: players KPI", await txt("#k-players"), "1");
  check("Henry: scrimmage yards (f11)", await txt("#k-scrim"), nf(R.f11.top.scrimmage_yards, 0));

  // RESET
  await setSel("#stat-select", "ypc"); await setSel("#dim-select", "division");
  await click('.seg[data-filter="stype"] button[data-v="post"]'); await range(2018, 2021);
  await click("#reset");
  const st = await page.evaluate(() => { const s = window.__dash.state; return { ...s, teams: s.teams.size, pos: s.pos.size }; });
  check("reset: state", JSON.stringify(st), JSON.stringify({ seasonMin: 2015, seasonMax: 2025, stype: "reg", teams: 0, pos: 4, conf: "all", venue: "all", player: null, stat: "off_yds", measure: "ptg", dim: "season" }));
  check("reset: KPI back to default", await txt("#k-measure"), nf(R.f9.league_ypg, 1));
  check("reset: rows", await txt("#k-rows"), nf(R.meta.reg_rows, 0));
  check("reset: chips cleared", await page.$$eval("#active-chips .achip", (n) => n.length), 0);
  check("reset: player input cleared", await page.$eval("#player-input", (i) => i.value), "");
  check("reset: season slider", await page.$eval("#season-out", (o) => o.textContent), "2015 – 2025");
  check("reset: controls", await page.evaluate(() => [...["stat-select", "measure-select", "dim-select"]].map((i) => document.getElementById(i).value).join(",")), "off_yds,ptg,season");
  check("reset: pressed buttons", await page.$$eval('[aria-pressed="true"]', (b) => b.map((x) => x.textContent.trim()).join(",")), "Regular,QB,RB,WR,TE,All,All");

  check("no console/page errors", errors.join(" | "), "");
  await browser.close();
  console.log(log.join("\n"));
  console.log(`\nqa_browser.js — ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
