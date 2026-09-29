/* ==========================================================================
   metrics.js — the dashboard's calculation layer.
   Pure functions, no DOM. Runs in the browser (window.Metrics) and in Node
   (require) so analysis/verify.js can check it against analysis.py's output.

   Definitions (identical to analysis/analysis.py and the methodology section):
   - Total              = Σ stat over the selected rows
   - Per team-game      = Σ stat ÷ number of distinct (game, team) pairs in the selection
   - Avg per player-game    = mean of the stat over selected rows with no_stats_flag = False
   - Median per player-game = median of the same values
   - Rate stats         = Σ numerator ÷ Σ denominator (ratio of sums)
   ========================================================================== */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Metrics = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /* ---------------------------------------------------------------- stats */
  // count stats: v(c, i) returns the row value. rate stats: num/den + scale.
  const STATS = [
    { id: "off_yds", label: "Offensive yards (pass + rush)", short: "Off. yards", kind: "count", v: (c, i) => c.pyd[i] + c.ryd[i], unit: "yds" },
    { id: "pass_yds", label: "Passing yards", short: "Pass yds", kind: "count", v: (c, i) => c.pyd[i], unit: "yds" },
    { id: "rush_yds", label: "Rushing yards", short: "Rush yds", kind: "count", v: (c, i) => c.ryd[i], unit: "yds" },
    { id: "rec_yds", label: "Receiving yards", short: "Rec yds", kind: "count", v: (c, i) => c.recyd[i], unit: "yds" },
    { id: "scrim_yds", label: "Scrimmage yards (rush + rec)", short: "Scrimmage", kind: "count", v: (c, i) => c.ryd[i] + c.recyd[i], unit: "yds" },
    { id: "td", label: "Touchdowns scored", short: "TDs", kind: "count", v: (c, i) => c.rtd[i] + c.rectd[i] + c.sttd[i], unit: "TDs" },
    { id: "pass_td", label: "Passing touchdowns", short: "Pass TDs", kind: "count", v: (c, i) => c.ptd[i], unit: "TDs" },
    { id: "att", label: "Pass attempts", short: "Attempts", kind: "count", v: (c, i) => c.att[i], unit: "att" },
    { id: "car", label: "Carries", short: "Carries", kind: "count", v: (c, i) => c.car[i], unit: "car" },
    { id: "tgt", label: "Targets", short: "Targets", kind: "count", v: (c, i) => c.tgt[i], unit: "tgt" },
    { id: "rec", label: "Receptions", short: "Receptions", kind: "count", v: (c, i) => c.rec[i], unit: "rec" },
    { id: "int", label: "Interceptions thrown", short: "INTs", kind: "count", v: (c, i) => c.int[i], unit: "INT" },
    { id: "sck", label: "Sacks taken", short: "Sacks", kind: "count", v: (c, i) => c.sck[i], unit: "sacks" },
    { id: "fum", label: "Fumbles lost", short: "Fumbles lost", kind: "count", v: (c, i) => c.fum[i], unit: "fum" },
    { id: "ppr", label: "PPR fantasy points", short: "PPR pts", kind: "count", v: (c, i) => c.ppr[i], unit: "pts", dec: 1 },
    { id: "cmp_pct", label: "Completion %", short: "Comp %", kind: "rate", num: (c, i) => c.cmp[i], den: (c, i) => c.att[i], scale: 100, pct: true, minDen: 10, minTotal: 150, denName: "attempts" },
    { id: "ypa", label: "Yards per pass attempt", short: "Yds/att", kind: "rate", num: (c, i) => c.pyd[i], den: (c, i) => c.att[i], scale: 1, minDen: 10, minTotal: 150, denName: "attempts" },
    { id: "ypc", label: "Yards per carry", short: "Yds/carry", kind: "rate", num: (c, i) => c.ryd[i], den: (c, i) => c.car[i], scale: 1, minDen: 5, minTotal: 75, denName: "carries" },
    { id: "catch", label: "Catch rate (rec ÷ targets)", short: "Catch %", kind: "rate", num: (c, i) => c.rec[i], den: (c, i) => c.tgt[i], scale: 100, pct: true, minDen: 3, minTotal: 40, denName: "targets" },
    { id: "ypt", label: "Yards per target", short: "Yds/target", kind: "rate", num: (c, i) => c.recyd[i], den: (c, i) => c.tgt[i], scale: 1, minDen: 3, minTotal: 40, denName: "targets" },
    { id: "int_rate", label: "Interception rate", short: "INT %", kind: "rate", num: (c, i) => c.int[i], den: (c, i) => c.att[i], scale: 100, pct: true, minDen: 10, minTotal: 150, denName: "attempts" },
    { id: "sack_rate", label: "Sack rate (sacks ÷ dropbacks)", short: "Sack %", kind: "rate", num: (c, i) => c.sck[i], den: (c, i) => c.att[i] + c.sck[i], scale: 100, pct: true, minDen: 10, minTotal: 150, denName: "dropbacks" },
  ];
  const STAT = Object.fromEntries(STATS.map((s) => [s.id, s]));

  const MEASURES = [
    { id: "total", label: "Total (Σ)", short: "Total" },
    { id: "ptg", label: "Per team-game", short: "per team-game" },
    { id: "avg", label: "Average per player-game", short: "avg per player-game" },
    { id: "median", label: "Median per player-game", short: "median per player-game" },
    { id: "rate", label: "Rate (Σ ÷ Σ)", short: "" },
  ];
  const MEASURE = Object.fromEntries(MEASURES.map((m) => [m.id, m]));
  const validMeasures = (statId) => (STAT[statId].kind === "rate" ? ["rate"] : ["total", "ptg", "avg", "median"]);

  const DIMENSIONS = [
    { id: "season", label: "Season", ordered: true },
    { id: "week", label: "Week", ordered: true },
    { id: "team", label: "Team" },
    { id: "pos", label: "Position" },
    { id: "conference", label: "Conference" },
    { id: "division", label: "Division" },
    { id: "venue", label: "Home / away" },
    { id: "stype", label: "Season type" },
    { id: "opp", label: "Opponent" },
    { id: "player", label: "Player (top 20)" },
  ];

  /* ---------------------------------------------------------------- dataset */
  function Dataset(json) {
    const n = json.rows, src = json.cols, c = {};
    const INT = new Set(["season", "week", "post", "team", "opp", "home", "player", "pos", "game", "nostat"]);
    for (const k of Object.keys(src)) {
      const T = k === "ppr" ? Float64Array : INT.has(k) ? Int32Array : Int16Array;
      c[k] = T.from(src[k]);
    }
    const teams = json.dims.teams, players = json.dims.players, positions = json.dims.positions;
    const confIdx = Int8Array.from(teams.map((t) => (t.conference === "AFC" ? 0 : 1)));
    const divisions = [...new Set(teams.map((t) => t.division))].sort();
    const divIdx = Int8Array.from(teams.map((t) => divisions.indexOf(t.division)));
    const seasons = [...new Set(src.season)].sort((a, b) => a - b);
    return { n, c, teams, players, positions, confIdx, divisions, divIdx, seasons, nGames: json.dims.games };
  }

  /* ---------------------------------------------------------------- filters
     f = { seasonMin, seasonMax, stype: 'reg'|'post'|'all', teams: Set<idx>|null, pos: Set<idx>|null,
           conf: 'all'|'AFC'|'NFC', venue: 'all'|'home'|'away', player: idx|null } */
  function filter(ds, f) {
    const c = ds.c, out = new Int32Array(ds.n);
    let k = 0;
    const conf = f.conf === "AFC" ? 0 : f.conf === "NFC" ? 1 : -1;
    const venue = f.venue === "home" ? 1 : f.venue === "away" ? 0 : -1;
    const post = f.stype === "reg" ? 0 : f.stype === "post" ? 1 : -1;
    const teams = f.teams && f.teams.size ? f.teams : null, pos = f.pos && f.pos.size ? f.pos : null;
    const player = f.player === null || f.player === undefined ? -1 : f.player;
    for (let i = 0; i < ds.n; i++) {
      const s = c.season[i];
      if (s < f.seasonMin || s > f.seasonMax) continue;
      if (post !== -1 && c.post[i] !== post) continue;
      if (teams && !teams.has(c.team[i])) continue;
      if (pos && !pos.has(c.pos[i])) continue;
      if (conf !== -1 && ds.confIdx[c.team[i]] !== conf) continue;
      if (venue !== -1 && c.home[i] !== venue) continue;
      if (player !== -1 && c.player[i] !== player) continue;
      out[k++] = i;
    }
    return out.subarray(0, k);
  }

  /* ---------------------------------------------------------------- aggregation */
  function median(arr) {
    if (!arr.length) return null;
    const a = Float64Array.from(arr).sort(), m = a.length >> 1;
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  }
  function quantile(sorted, q) { // linear interpolation (same as pandas default)
    if (!sorted.length) return null;
    const pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  }

  /** Aggregate one stat over a list of row indices with one measure. */
  function aggregate(ds, idx, statId, measureId) {
    const c = ds.c, st = STAT[statId];
    if (st.kind === "rate") {
      let num = 0, den = 0;
      for (let j = 0; j < idx.length; j++) { const i = idx[j]; num += st.num(c, i); den += st.den(c, i); }
      return den ? (num / den) * st.scale : null;
    }
    if (measureId === "total" || measureId === "ptg") {
      let s = 0;
      for (let j = 0; j < idx.length; j++) s += st.v(c, idx[j]);
      if (measureId === "total") return idx.length ? s : null;
      const tg = teamGames(ds, idx);
      return tg ? s / tg : null;
    }
    const vals = [];
    for (let j = 0; j < idx.length; j++) { const i = idx[j]; if (!c.nostat[i]) vals.push(st.v(c, i)); }
    if (!vals.length) return null;
    if (measureId === "avg") { let s = 0; for (const v of vals) s += v; return s / vals.length; }
    return median(vals);
  }

  function teamGames(ds, idx) {
    const seen = new Set(), c = ds.c;
    for (let j = 0; j < idx.length; j++) { const i = idx[j]; seen.add(c.game[i] * 32 + c.team[i]); }
    return seen.size;
  }
  function distinct(ds, idx, col) {
    const seen = new Set(), a = ds.c[col];
    for (let j = 0; j < idx.length; j++) seen.add(a[idx[j]]);
    return seen.size;
  }
  function sum(ds, idx, statId) {
    const st = STAT[statId], c = ds.c; let s = 0;
    for (let j = 0; j < idx.length; j++) s += st.v(c, idx[j]);
    return s;
  }

  /* ---------------------------------------------------------------- grouping */
  function keyFn(ds, dimId) {
    const c = ds.c;
    switch (dimId) {
      case "season": return (i) => c.season[i];
      case "week": return (i) => (c.post[i] ? 100 + c.week[i] : c.week[i]);
      case "team": return (i) => c.team[i];
      case "opp": return (i) => c.opp[i];
      case "pos": return (i) => c.pos[i];
      case "conference": return (i) => ds.confIdx[c.team[i]];
      case "division": return (i) => ds.divIdx[c.team[i]];
      case "venue": return (i) => c.home[i];
      case "stype": return (i) => c.post[i];
      case "player": return (i) => c.player[i];
      default: throw new Error("unknown dimension " + dimId);
    }
  }
  function labelFor(ds, dimId, k) {
    switch (dimId) {
      case "season": return String(k);
      case "week": return k >= 100 ? "Post wk " + (k - 100) : "Week " + k;
      case "team": case "opp": return ds.teams[k].name;
      case "pos": return ds.positions[k];
      case "conference": return k === 0 ? "AFC" : "NFC";
      case "division": return ds.divisions[k];
      case "venue": return k === 1 ? "Home" : "Away";
      case "stype": return k === 1 ? "Postseason" : "Regular season";
      case "player": return ds.players[k].name;
      default: return String(k);
    }
  }
  function groupBy(ds, idx, dimId) {
    const kf = keyFn(ds, dimId), m = new Map();
    for (let j = 0; j < idx.length; j++) {
      const i = idx[j], k = kf(i);
      let a = m.get(k);
      if (!a) { a = []; m.set(k, a); }
      a.push(i);
    }
    return m;
  }

  /** Rows for the breakdown chart + table. Ordered dims sort by key, others by value (desc). */
  function breakdown(ds, idx, dimId, statId, measureId, opts = {}) {
    const groups = groupBy(ds, idx, dimId);
    const st = STAT[statId];
    let rows = [];
    for (const [k, g] of groups) {
      const row = { key: k, label: labelFor(ds, dimId, k), value: aggregate(ds, g, statId, measureId), idx: g };
      if (st.kind === "rate") { // volume guard for rates on small groups
        let den = 0; for (const i of g) den += st.den(ds.c, i);
        row.den = den;
      }
      rows.push(row);
    }
    const dim = DIMENSIONS.find((d) => d.id === dimId);
    if (dimId === "player") {
      // only players with enough volume to be meaningful
      rows = rows.filter((r) => (st.kind === "rate" ? r.den >= st.minTotal : measureId === "total" ? true : r.idx.filter((i) => !ds.c.nostat[i]).length >= (opts.minGames || 8)));
    }
    rows = rows.filter((r) => r.value !== null);
    if (dim.ordered) rows.sort((a, b) => a.key - b.key);
    else rows.sort((a, b) => b.value - a.value || String(a.label).localeCompare(b.label));
    return rows;
  }

  /** Per-player-game values for the distribution chart. Rates use rows meeting the stat's minimum denominator. */
  function distributionValues(ds, idx, statId) {
    const st = STAT[statId], c = ds.c, out = [];
    for (let j = 0; j < idx.length; j++) {
      const i = idx[j];
      if (c.nostat[i]) continue;
      if (st.kind === "rate") { const d = st.den(c, i); if (d >= st.minDen) out.push((st.num(c, i) / d) * st.scale); }
      else out.push(st.v(c, i));
    }
    return out;
  }

  function summary(ds, idx) {
    const c = ds.c; let active = 0;
    for (let j = 0; j < idx.length; j++) if (!c.nostat[idx[j]]) active++;
    return {
      rows: idx.length, active, players: distinct(ds, idx, "player"), teamGames: teamGames(ds, idx),
      scrimmage: sum(ds, idx, "scrim_yds"), td: sum(ds, idx, "td"), offYards: sum(ds, idx, "off_yds"),
      pprAvg: aggregate(ds, idx, "ppr", "avg"),
    };
  }

  return { STATS, STAT, MEASURES, MEASURE, DIMENSIONS, validMeasures, Dataset, filter, aggregate, teamGames,
    distinct, sum, groupBy, breakdown, labelFor, distributionValues, summary, median, quantile };
});
