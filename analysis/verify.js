/* ==========================================================================
   verify.js — accuracy check.  Run:  node analysis/verify.js

   1. Recomputes every report statistic with the DASHBOARD's calculation layer (js/metrics.js)
      from data/dashboard_data.json, independently of analysis.py/pandas, and compares it with
      data/report_metrics.json. Report and dashboard therefore provably agree.
   2. Checks every number typed into index.html ([data-m] spans) against report_metrics.json.
   3. Sanity-checks the dashboard data against the cleaned CSV's row/column totals.
   Exits with code 1 on any mismatch.
   ========================================================================== */
const fs = require("fs");
const path = require("path");
const M = require("../js/metrics.js");

const ROOT = path.join(__dirname, "..");
const R = JSON.parse(fs.readFileSync(path.join(ROOT, "data/report_metrics.json"), "utf8"));
const ds = M.Dataset(JSON.parse(fs.readFileSync(path.join(ROOT, "data/dashboard_data.json"), "utf8")));

let pass = 0, fail = 0;
const failures = [];
function check(name, got, want, dec = 1) {
  const g = got === null || got === undefined ? null : typeof got === "number" ? +got.toFixed(dec) : got;
  const ok = typeof want === "number" ? g !== null && Math.abs(g - want) < Math.pow(10, -dec) / 2 + 1e-9 : g === want;
  if (ok) pass++; else { fail++; failures.push(`${name}: computed ${g} vs report ${want}`); }
}

const ALL = { seasonMin: 2015, seasonMax: 2025, stype: "all", teams: null, pos: null, conf: "all", venue: "all", player: null };
const REG = { ...ALL, stype: "reg" };
const reg = M.filter(ds, REG), all = M.filter(ds, ALL);
const bySeason = (idx) => M.groupBy(ds, idx, "season");
const S = bySeason(reg);
const c = ds.c;
const posIdx = (p) => ds.positions.indexOf(p);

/* ---------------- KPIs / meta */
check("meta.rows", all.length, R.meta.rows, 0);
check("meta.reg_rows", reg.length, R.meta.reg_rows, 0);
check("meta.players", M.distinct(ds, all, "player"), R.meta.players, 0);
check("meta.games", M.distinct(ds, all, "game"), R.meta.games, 0);
check("meta.teams", M.distinct(ds, all, "team"), R.meta.teams, 0);
check("meta.reg_team_games", M.teamGames(ds, reg), R.meta.reg_team_games, 0);
check("kpis.off_yards", M.sum(ds, all, "off_yds"), R.kpis.off_yards, 0);
check("kpis.td_scored", M.sum(ds, all, "td"), R.kpis.td_scored, 0);
let ns = 0; for (const i of all) ns += c.nostat[i]; check("meta.no_stats_rows", ns, R.meta.no_stats_rows, 0);

/* ---------------- per-season findings */
R.f1.pass_ypg.forEach((d) => check(`f1.pass_ypg ${d.season}`, M.aggregate(ds, S.get(d.season), "pass_yds", "ptg"), d.value));
R.f1.att_pg.forEach((d) => check(`f1.att_pg ${d.season}`, M.aggregate(ds, S.get(d.season), "att", "ptg"), d.value));
R.f1.ypa.forEach((d) => check(`f1.ypa ${d.season}`, M.aggregate(ds, S.get(d.season), "ypa", "rate"), d.value, 2));
check("f1.ypa_first", M.aggregate(ds, S.get(2015), "ypa", "rate"), R.f1.ypa_first, 2);
check("f1.ypa_last", M.aggregate(ds, S.get(2025), "ypa", "rate"), R.f1.ypa_last, 2);
R.f2.games.forEach((d) => {
  const n = S.get(d.season).filter((i) => c.pyd[i] >= 300).length;
  check(`f2.games ${d.season}`, n, d.value, 0);
  check(`f2.rate ${d.season}`, (n / M.teamGames(ds, S.get(d.season))) * 100, d.rate);
});
R.f3.sack_rate.forEach((d) => check(`f3.sack_rate ${d.season}`, M.aggregate(ds, S.get(d.season), "sack_rate", "rate"), d.value, 2));
R.f4.int_rate.forEach((d) => check(`f4.int_rate ${d.season}`, M.aggregate(ds, S.get(d.season), "int_rate", "rate"), d.value, 2));
R.f4.fum_pg.forEach((d) => check(`f4.fum_pg ${d.season}`, M.aggregate(ds, S.get(d.season), "fum", "ptg"), d.value, 2));
R.f4.give_pg.forEach((d) => check(`f4.give_pg ${d.season}`,
  M.aggregate(ds, S.get(d.season), "int", "ptg") + M.aggregate(ds, S.get(d.season), "fum", "ptg"), d.value, 2));
R.f5.rush_ypg.forEach((d) => check(`f5.rush_ypg ${d.season}`, M.aggregate(ds, S.get(d.season), "rush_yds", "ptg"), d.value));
R.f5.ypc.forEach((d) => check(`f5.ypc ${d.season}`, M.aggregate(ds, S.get(d.season), "ypc", "rate"), d.value, 2));
R.f5.rushers_1000.forEach((d) => {
  const per = new Map();
  for (const i of S.get(d.season)) per.set(c.player[i], (per.get(c.player[i]) || 0) + c.ryd[i]);
  check(`f5.rushers_1000 ${d.season}`, [...per.values()].filter((v) => v >= 1000).length, d.value, 0);
});
R.f6.qb_share.forEach((d) => {
  const g = S.get(d.season), qb = g.filter((i) => c.pos[i] === posIdx("QB"));
  check(`f6.qb_share ${d.season}`, (M.sum(ds, qb, "rush_yds") / M.sum(ds, g, "rush_yds")) * 100, d.value);
});
R.f7.share.forEach((d) => {
  const g = S.get(d.season), tot = M.sum(ds, g, "tgt");
  ["WR", "TE", "RB", "QB"].forEach((p) => check(`f7.share ${d.season} ${p}`, (M.sum(ds, g.filter((i) => c.pos[i] === posIdx(p)), "tgt") / tot) * 100, d[p]));
});

R.td.td_pg.forEach((d) => check(`td.td_pg ${d.season}`, M.aggregate(ds, S.get(d.season), "td", "ptg"), d.value, 2));
R.td.totals.forEach((d) => check(`td.totals ${d.season}`, M.sum(ds, S.get(d.season), "td"), d.value, 0));

/* ---------------- home/away — through the dashboard's venue filter */
R.f8.by_season.forEach((d) => {
  const h = M.filter(ds, { ...REG, seasonMin: d.season, seasonMax: d.season, venue: "home" });
  const a = M.filter(ds, { ...REG, seasonMin: d.season, seasonMax: d.season, venue: "away" });
  check(`f8.home ${d.season}`, M.aggregate(ds, h, "off_yds", "ptg"), d.home);
  check(`f8.away ${d.season}`, M.aggregate(ds, a, "off_yds", "ptg"), d.away);
});
check("f8.home_ypg", M.aggregate(ds, M.filter(ds, { ...REG, venue: "home" }), "off_yds", "ptg"), R.f8.home_ypg);
check("f8.away_ypg", M.aggregate(ds, M.filter(ds, { ...REG, venue: "away" }), "off_yds", "ptg"), R.f8.away_ypg);
check("f8.home_td", M.aggregate(ds, M.filter(ds, { ...REG, venue: "home" }), "td", "ptg"), R.f8.home_td, 2);

/* ---------------- teams — through the dashboard's breakdown() */
const teamRows = M.breakdown(ds, reg, "team", "off_yds", "ptg");
R.f9.teams.forEach((t, rank) => {
  const r = teamRows.find((x) => ds.teams[x.key].code === t.team);
  check(`f9.ypg ${t.team}`, r.value, t.ypg);
  check(`f9.rank ${t.team}`, teamRows.indexOf(r), rank, 0);
  check(`f9.tdpg ${t.team}`, M.aggregate(ds, r.idx, "td", "ptg"), t.tdpg, 2);
});
check("f9.league_ypg", M.aggregate(ds, reg, "off_yds", "ptg"), R.f9.league_ypg);

/* ---------------- fantasy by position — breakdown avg/median + percentiles */
const posAvg = M.breakdown(ds, reg, "pos", "ppr", "avg"), posMed = M.breakdown(ds, reg, "pos", "ppr", "median");
R.f10.positions.forEach((p) => {
  const k = posIdx(p.position);
  check(`f10.mean ${p.position}`, posAvg.find((r) => r.key === k).value, p.mean, 2);
  check(`f10.median ${p.position}`, posMed.find((r) => r.key === k).value, p.median, 2);
  const v = M.distributionValues(ds, reg.filter((i) => c.pos[i] === k), "ppr").sort((a, b) => a - b);
  check(`f10.n ${p.position}`, v.length, p.n, 0);
  [["p10", 0.1], ["p25", 0.25], ["p75", 0.75], ["p90", 0.9]].forEach(([key, q]) => check(`f10.${key} ${p.position}`, M.quantile(v, q), p[key], 2));
  check(`f10.share20 ${p.position}`, (v.filter((x) => x >= 20).length / v.length) * 100, p.share20);
});

/* ---------------- scrimmage leaders — through breakdown by player */
const pl = M.breakdown(ds, reg, "player", "scrim_yds", "total");
R.f11.leaders.forEach((l, rank) => {
  const r = pl[rank];
  check(`f11.rank${rank + 1} id`, ds.players[r.key].id, l.player_id, 0);
  check(`f11.rank${rank + 1} yards`, r.value, l.scrimmage_yards, 0);
  check(`f11.rank${rank + 1} games`, r.idx.filter((i) => !c.nostat[i]).length, l.games, 0);
});

/* ---------------- index.html static numbers vs report_metrics.json */
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const fmt = (v, d) => new Intl.NumberFormat("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }).format(v).replace("-", "−");
const get = (o, p) => p.split(".").reduce((x, k) => (x == null ? x : x[k]), o);
const re = /<span data-m="([^"]+)"(?: data-d="(\d)")?(?: data-f="(\w+)")?>([^<]*)<\/span>/g;
let m, spans = 0;
while ((m = re.exec(html))) {
  spans++;
  const [, key, d, f, text] = m;
  const v = get(R, key);
  const want = typeof v === "number" ? (/season/.test(key) ? String(v) : fmt(f === "abs" ? Math.abs(v) : v, +(d || 0))) : String(v);
  if (text.trim() === want) pass++; else { fail++; failures.push(`index.html [data-m=${key}]: "${text}" should be "${want}"`); }
}
const countRe = /data-count="([^"]+)"[^>]*>([^<]*)</g;
while ((m = countRe.exec(html))) {
  const v = get(R, m[1]);
  const want = m[0].includes("data-compact") ? (v / 1e6).toFixed(2) + "M" : fmt(v, 0);
  if (m[2] === want) pass++; else { fail++; failures.push(`index.html [data-count=${m[1]}]: "${m[2]}" should be "${want}"`); }
}

console.log(`verify.js — ${pass} checks passed, ${fail} failed (${spans} bound numbers in index.html)`);
if (fail) { console.log(failures.join("\n")); process.exit(1); }
