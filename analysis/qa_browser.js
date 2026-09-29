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
  // software WebGL so the 3D scenes render in headless Chrome too
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", protocolTimeout: 120000,
    args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--ignore-gpu-blocklist"] });
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
  // 3D football model
  await page.waitForFunction(() => document.querySelector("#hero-ball canvas"), { timeout: 30000 });
  check("hero 3D football canvas mounted", await page.$eval("#hero-ball", (b) => b.classList.contains("is-3d")), true);
  // metric toggles
  await page.evaluate(() => document.querySelector("#tg-f1 button:nth-child(2)").click()); await sleep(900);
  check("f1 toggle: attempts end label", await page.$$eval("#c-f1 text.dlabel", (t) => t.map((x) => x.textContent).pop()), nf(R.f1.att_last, 1));
  check("f1 toggle: title updates", await page.$eval("#f1 figure h4", (h) => h.textContent), "Pass attempts per team-game, regular season");
  await page.evaluate(() => document.querySelector("#tg-f5 button:nth-child(2)").click()); await sleep(900);
  check("f5 toggle: yards per carry end label", await page.$$eval("#c-f5 text.dlabel", (t) => t.map((x) => x.textContent).pop()), nf(R.f5.ypc_last, 2));
  // head-to-head
  const h2hVals = () => page.$$eval("#h2h-body .h2h-row .v", (v) => v.map((x) => x.textContent));
  const kcT = R.f9.teams.find((t) => t.team === R.f9.top), nyj = R.f9.teams.find((t) => t.team === R.f9.bottom);
  check("h2h default (top vs bottom)", (await h2hVals()).join("|"), [nf(kcT.ypg, 1), nf(nyj.ypg, 1), nf(kcT.tdpg, 2), nf(nyj.tdpg, 2), "#1", "#32"].join("|"));
  await page.select("#h2h-a", "BUF"); await page.select("#h2h-b", "MIA"); await sleep(100);
  const buf = R.f9.teams.find((t) => t.team === "BUF"), mia = R.f9.teams.find((t) => t.team === "MIA");
  check("h2h BUF vs MIA", (await h2hVals()).slice(0, 2).join("|"), nf(buf.ypg, 1) + "|" + nf(mia.ypg, 1));
  // draw-it: guess a flat line at 259.1, reveal, check the score math
  await page.evaluate(() => { const d = window.__drawIt; for (let s = 2016; s <= 2025; s++) d.guess.set(s, 259.1); d.reveal(); });
  await sleep(300);
  const mae = R.f1.pass_ypg.slice(1).reduce((t, d) => t + Math.abs(259.1 - d.value), 0) / (R.f1.pass_ypg.length - 1);
  check("draw-it: average miss", await page.$eval("#drawit-result .score b", (b) => b.textContent), nf(mae, 1));
  check("draw-it: actual 2025 shown", await page.$$eval("#drawit-result .score b", (b) => b.pop().textContent), nf(R.f1.last, 1));
  check("draw-it: reveal button hidden", await page.$eval("#drawit-reveal", (b) => getComputedStyle(b).display), "none");

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
  check("6 charts present (incl. 3D stadium)", await page.$$eval("#charts .panel", (n) => n.length), 6);
  check("default URL has no state", await page.evaluate(() => location.hash), "");

  // 3D stadium: loads lazily, shows the same numbers as the 2D team map and the report
  await page.evaluate(() => document.getElementById("stadium").scrollIntoView({ block: "center" }));
  await page.waitForFunction(() => window.__stadium, { timeout: 60000 });
  const snap = await page.evaluate(() => window.__stadium.snapshot());
  check("3D stadium: 32 columns", snap.length, 32);
  R.f9.teams.forEach((t) => check(`3D stadium value ${t.team} (f9)`, nf(snap.find((c) => c.code === t.team).value, 1), nf(t.ypg, 1)));
  const tileVals = await page.$$eval("#c4 .tile", (ts) => ts.map((t) => [t.querySelector("b").textContent, t.querySelector(".tv").textContent]));
  check("3D stadium == 2D team map", tileVals.every(([c, v]) => nf(snap.find((x) => x.code === c).value, 1) === v), true);
  const tallest = snap.reduce((a, b) => (b.target > a.target ? b : a));
  check("3D tallest column = top team", tallest.code, R.f9.top);
  await click('#st-scale button[data-v="zoom"]');
  const z = await page.evaluate(() => window.__stadium.snapshot());
  check("3D zoomed: lowest team is shortest", z.reduce((a, b) => (b.target < a.target ? b : a)).code, R.f9.bottom);
  await click('#st-scale button[data-v="zero"]');
  await page.evaluate(() => window.scrollTo(0, 0));

  // click-to-filter from the breakdown chart + shareable URL
  await setSel("#dim-select", "pos");
  await page.evaluate(() => { const bars = [...document.querySelectorAll("#c1-cols path.mark")]; bars[0].dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  await settle();
  check("click bar QB → position filter", await page.$$eval('#pos-chips [aria-pressed="true"]', (b) => b.map((x) => x.textContent.trim()).join(",")), "QB");
  check("URL carries state", await page.evaluate(() => location.hash), "#pos=QB&by=pos");
  const shared = await page.evaluate(() => location.href);
  const qbRows = await txt("#k-rows");
  await page.goto("about:blank"); await page.goto(shared, { waitUntil: "networkidle0" });
  await page.waitForFunction(() => document.documentElement.dataset.ready === "1"); await settle();
  check("shared link restores view", (await txt("#k-rows")) + "|" + (await page.$eval("#dim-select", (s) => s.value)), qbRows + "|pos");
  await click("#reset");
  check("reset clears URL", await page.evaluate(() => location.hash), "");
  // clicking a 3D column / tile sets the team filter and rings it in 3D
  await page.evaluate(() => [...document.querySelectorAll("#c4 .tile")].find((t) => t.querySelector("b").textContent === "KC").click());
  await settle();
  await page.evaluate(() => document.getElementById("stadium").scrollIntoView({ block: "center" }));
  await page.waitForFunction(() => window.__stadium, { timeout: 60000 }); await settle();
  check("3D ring on filtered team", (await page.evaluate(() => window.__stadium.snapshot())).filter((c) => c.ring).map((c) => c.code).join(","), "KC");
  await click("#reset"); await page.evaluate(() => window.scrollTo(0, 0));

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
  check("reset: pressed buttons", await page.$$eval('[aria-pressed="true"]', (b) => b.map((x) => x.textContent.trim()).join(",")), "Regular,QB,RB,WR,TE,All,All,Heights from zero,Values");

  check("no console/page errors", errors.join(" | "), "");
  await browser.close();
  console.log(log.join("\n"));
  console.log(`\nqa_browser.js — ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
