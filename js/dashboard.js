/* ==========================================================================
   dashboard.js — state, filters, controls and rendering for dashboard.html.
   All calculations go through js/metrics.js (the same code analysis/verify.js tests).
   ========================================================================== */
(function () {
  "use strict";
  const { el, fmt, compact, teamBadge, avatar, posPill, countUp, tipBody, POS_COLORS, NAVY, RED } = window.RIB;
  const Mx = window.Metrics, C = window.Charts;
  const POS = ["QB", "RB", "WR", "TE"];

  /* ---------------------------------------------------------------- state */
  const DEFAULTS = () => ({
    seasonMin: 2015, seasonMax: 2025, stype: "reg", teams: new Set(), pos: new Set([0, 1, 2, 3]),
    conf: "all", venue: "all", player: null,
    stat: "off_yds", measure: "ptg", dim: "season",
  });
  let S = DEFAULTS();
  let ds = null, playerGames = null;
  const charts = {};
  const $ = (id) => document.getElementById(id);

  const filtersOf = (s) => ({
    seasonMin: s.seasonMin, seasonMax: s.seasonMax, stype: s.stype,
    teams: s.teams.size && s.teams.size < 32 ? s.teams : null,
    pos: s.pos.size && s.pos.size < 4 ? s.pos : null,
    conf: s.conf, venue: s.venue, player: s.player,
  });

  /* ---------------------------------------------------------------- formatting */
  function valueFormat(statId, measureId) {
    const st = Mx.STAT[statId];
    if (st.kind === "rate") return st.pct ? (v) => fmt(v, 1) + "%" : (v) => fmt(v, 2);
    if (measureId === "total") return st.dec ? (v) => fmt(v, st.dec) : (v) => fmt(v, 0);
    if (measureId === "median") return (v) => fmt(v, 1);
    if (measureId === "avg") return (v) => fmt(v, 2);            // same precision as the report (e.g. 14.04 PPR)
    return (v) => fmt(v, Math.abs(v) < 10 ? 2 : 1);              // per team-game
  }
  function axisFormat(statId, measureId) {
    const st = Mx.STAT[statId];
    if (st.kind === "rate") return st.pct ? (v) => fmt(v, 0) + "%" : (v) => fmt(v, 1);
    if (measureId === "total") return (v) => (Math.abs(v) >= 1e4 ? compact(v) : fmt(v, 0));
    return (v) => fmt(v, Math.abs(v) < 10 && v % 1 ? 1 : 0);
  }
  function measureName(statId, measureId) {
    const st = Mx.STAT[statId];
    if (st.kind === "rate") return st.label;
    const m = { total: "Total " + st.label.toLowerCase(), ptg: st.label + " per team-game", avg: st.label + " per player-game (avg)", median: st.label + " per player-game (median)" };
    return m[measureId];
  }
  const dimLabel = (id) => Mx.DIMENSIONS.find((d) => d.id === id).label;

  /* ---------------------------------------------------------------- controls setup */
  function setupControls() {
    const statSel = $("stat-select");
    const groups = [["Counting stats", Mx.STATS.filter((s) => s.kind === "count")], ["Rates & efficiency", Mx.STATS.filter((s) => s.kind === "rate")]];
    groups.forEach(([name, list]) => statSel.appendChild(el("optgroup", { label: name }, list.map((s) => el("option", { value: s.id, text: s.label })))));
    statSel.addEventListener("change", () => {
      S.stat = statSel.value;
      const valid = Mx.validMeasures(S.stat);
      if (!valid.includes(S.measure)) S.measure = valid.includes("ptg") ? "ptg" : valid[0];
      syncMeasureOptions(); update();
    });
    $("measure-select").addEventListener("change", (e) => { S.measure = e.target.value; update(); });
    const dimSel = $("dim-select");
    Mx.DIMENSIONS.forEach((d) => dimSel.appendChild(el("option", { value: d.id, text: d.label })));
    dimSel.addEventListener("change", () => { S.dim = dimSel.value; tableState.sort = null; tableState.page = 0; update(); });
  }
  function syncMeasureOptions() {
    const sel = $("measure-select"), valid = Mx.validMeasures(S.stat);
    sel.replaceChildren(...Mx.MEASURES.map((m) => el("option", { value: m.id, text: m.label, disabled: !valid.includes(m.id) })));
    sel.value = S.measure;
    sel.title = valid.length === 1 ? "Rates are always Σ numerator ÷ Σ denominator" : "";
  }

  /* ---------------------------------------------------------------- filters setup */
  function setupFilters() {
    // seasons (dual range)
    const lo = $("season-min"), hi = $("season-max");
    [lo, hi].forEach((inp) => { inp.min = ds.seasons[0]; inp.max = ds.seasons[ds.seasons.length - 1]; });
    const onRange = (which) => {
      let a = +lo.value, b = +hi.value;
      if (a > b) { if (which === "lo") b = a; else a = b; lo.value = a; hi.value = b; }
      S.seasonMin = a; S.seasonMax = b; update();
    };
    lo.addEventListener("input", () => onRange("lo"));
    hi.addEventListener("input", () => onRange("hi"));

    // segmented controls
    document.querySelectorAll(".seg[data-filter]").forEach((g) => {
      g.addEventListener("click", (e) => {
        const b = e.target.closest("button"); if (!b) return;
        S[g.dataset.filter] = b.dataset.v; update();
      });
    });

    // positions (at least one stays on)
    $("pos-chips").addEventListener("click", (e) => {
      const b = e.target.closest("button"); if (!b) return;
      const v = +b.dataset.v;
      if (S.pos.has(v)) { if (S.pos.size > 1) S.pos.delete(v); } else S.pos.add(v);
      update();
    });

    // team multi-select
    const list = $("team-list"), pop = $("team-pop"), btn = $("team-btn");
    ds.divisions.forEach((div) => {
      const box = el("div", { class: "ms-div" }, el("h5", { text: div }));
      ds.teams.forEach((t, i) => {
        if (t.division !== div) return;
        const cb = el("input", { type: "checkbox", value: String(i) });
        cb.addEventListener("change", () => { cb.checked ? S.teams.add(i) : S.teams.delete(i); update(); });
        box.appendChild(el("label", { class: "ms-opt", "data-name": (t.name + " " + t.code).toLowerCase() }, cb, teamBadge(t.code, 20), el("span", { text: t.name.replace(/^(Los Angeles|New York|New England|New Orleans|Kansas City|Las Vegas|San Francisco|Tampa Bay|Green Bay) /, "") + " (" + t.code + ")" })));
      });
      list.appendChild(box);
    });
    const open = (o) => { pop.hidden = !o; btn.setAttribute("aria-expanded", String(o)); if (o) $("team-search").focus(); };
    btn.addEventListener("click", () => open(pop.hidden));
    document.addEventListener("click", (e) => { if (!pop.hidden && !e.target.closest("#team-ms")) open(false); });
    pop.addEventListener("keydown", (e) => { if (e.key === "Escape") { open(false); btn.focus(); } });
    $("team-search").addEventListener("input", (e) => {
      const q = e.target.value.trim().toLowerCase();
      list.querySelectorAll(".ms-opt").forEach((o) => (o.hidden = q && !o.dataset.name.includes(q)));
    });
    $("team-all").addEventListener("click", () => { S.teams = new Set(ds.teams.map((_, i) => i)); update(); });
    $("team-none").addEventListener("click", () => { S.teams = new Set(); update(); });

    // player autocomplete
    const inp = $("player-input"), ul = $("player-list"), clr = $("player-clear");
    let hits = [], active = -1;
    const close = () => { ul.hidden = true; inp.setAttribute("aria-expanded", "false"); active = -1; };
    const choose = (pi) => { S.player = pi; close(); update(); };
    const renderList = () => {
      ul.replaceChildren(...hits.map((pi, k) => {
        const p = ds.players[pi];
        const li = el("li", { role: "option", id: "pl-" + pi, "aria-selected": String(k === active) },
          avatar(p.name, p.img, null), el("div", null, el("span", { text: p.name }), el("small", { text: `${p.pos} · ${fmt(playerGames[pi])} games` })));
        li.addEventListener("mousedown", (e) => { e.preventDefault(); choose(pi); });
        return li;
      }));
      ul.hidden = !hits.length; inp.setAttribute("aria-expanded", String(!!hits.length));
      if (active >= 0) inp.setAttribute("aria-activedescendant", "pl-" + hits[active]); else inp.removeAttribute("aria-activedescendant");
    };
    inp.addEventListener("input", () => {
      const q = inp.value.trim().toLowerCase();
      if (S.player !== null && inp.value !== ds.players[S.player].label) { S.player = null; update(); }
      if (q.length < 2) { hits = []; renderList(); return; }
      hits = ds.players.map((p, i) => i).filter((i) => ds.players[i].name.toLowerCase().includes(q))
        .sort((a, b) => playerGames[b] - playerGames[a]).slice(0, 12);
      active = -1; renderList();
    });
    inp.addEventListener("keydown", (e) => {
      if (ul.hidden) return;
      if (e.key === "ArrowDown") { active = Math.min(hits.length - 1, active + 1); renderList(); e.preventDefault(); }
      else if (e.key === "ArrowUp") { active = Math.max(0, active - 1); renderList(); e.preventDefault(); }
      else if (e.key === "Enter" && active >= 0) { choose(hits[active]); e.preventDefault(); }
      else if (e.key === "Escape") close();
    });
    inp.addEventListener("blur", () => setTimeout(close, 120));
    clr.addEventListener("click", () => { S.player = null; inp.value = ""; update(); inp.focus(); });

    // reset
    $("reset").addEventListener("click", reset);

    // mobile collapse
    const tg = $("filters-toggle"), body = $("filters-body");
    tg.addEventListener("click", () => {
      const collapsed = body.dataset.collapsed === "true";
      body.dataset.collapsed = String(!collapsed);
      tg.setAttribute("aria-expanded", String(collapsed));
      tg.textContent = collapsed ? "Hide filters" : "Show filters";
    });
  }

  function reset() {
    S = DEFAULTS();
    $("player-input").value = "";
    $("team-search").value = "";
    $("team-list").querySelectorAll(".ms-opt").forEach((o) => (o.hidden = false));
    $("t-search").value = "";
    tableState.sort = null; tableState.page = 0; tableState.q = "";
    syncMeasureOptions();
    update();
  }
  window.__dashReset = reset;

  /** Reflect state in every control. */
  function syncFilterUI() {
    const lo = $("season-min"), hi = $("season-max");
    lo.value = S.seasonMin; hi.value = S.seasonMax;
    const span = +lo.max - +lo.min || 1;
    $("season-fill").style.left = ((S.seasonMin - lo.min) / span) * 100 + "%";
    $("season-fill").style.right = (1 - (S.seasonMax - lo.min) / span) * 100 + "%";
    $("season-out").textContent = S.seasonMin === S.seasonMax ? String(S.seasonMin) : `${S.seasonMin} – ${S.seasonMax}`;
    document.querySelectorAll(".seg[data-filter]").forEach((g) => g.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === S[g.dataset.filter]))));
    $("pos-chips").querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(S.pos.has(+b.dataset.v))));
    $("team-list").querySelectorAll("input").forEach((cb) => (cb.checked = S.teams.has(+cb.value)));
    const n = S.teams.size, logos = $("team-logos");
    $("team-btn-text").textContent = n === 0 || n === 32 ? "All 32 teams" : n <= 2 ? [...S.teams].map((i) => ds.teams[i].code).join(", ") : `${n} teams`;
    logos.replaceChildren(...(n && n < 32 ? [...S.teams].slice(0, 3).map((i) => teamBadge(ds.teams[i].code, 20)) : []));
    const inp = $("player-input");
    if (S.player !== null) inp.value = ds.players[S.player].label;
    $("player-clear").hidden = S.player === null && !inp.value;
    $("stat-select").value = S.stat; $("measure-select").value = S.measure; $("dim-select").value = S.dim;
  }

  /** Active-filter chips; each can be removed individually. */
  function activeChips() {
    const D = DEFAULTS(), chips = [];
    if (S.seasonMin !== D.seasonMin || S.seasonMax !== D.seasonMax) chips.push([`Seasons ${S.seasonMin === S.seasonMax ? S.seasonMin : S.seasonMin + "–" + S.seasonMax}`, () => { S.seasonMin = D.seasonMin; S.seasonMax = D.seasonMax; }]);
    if (S.stype !== D.stype) chips.push([S.stype === "post" ? "Playoffs only" : "Regular + playoffs", () => (S.stype = D.stype)]);
    if (S.teams.size && S.teams.size < 32) chips.push([S.teams.size <= 3 ? [...S.teams].map((i) => ds.teams[i].code).join(", ") : `${S.teams.size} teams`, () => (S.teams = new Set())]);
    if (S.pos.size < 4) chips.push([[...S.pos].sort().map((i) => POS[i]).join(" + "), () => (S.pos = new Set([0, 1, 2, 3]))]);
    if (S.conf !== "all") chips.push([S.conf, () => (S.conf = "all")]);
    if (S.venue !== "all") chips.push([S.venue === "home" ? "Home games" : "Away games", () => (S.venue = "all")]);
    if (S.player !== null) chips.push([ds.players[S.player].name, () => { S.player = null; $("player-input").value = ""; }]);
    const box = $("active-chips");
    if (!chips.length) box.replaceChildren(el("span", { class: "none", text: `Showing all regular-season games, ${ds.seasons[0]}–${ds.seasons[ds.seasons.length - 1]}.` }));
    else box.replaceChildren(...chips.map(([t, fn]) => el("span", { class: "achip" }, t, (() => { const b = el("button", { type: "button", "aria-label": "Remove filter: " + t, text: "×" }); b.addEventListener("click", () => { fn(); update(); }); return b; })())));
    $("filter-count").hidden = !chips.length; $("filter-count").textContent = String(chips.length);
    return chips.length;
  }

  /* ---------------------------------------------------------------- rendering */
  let prev = {};
  function kpi(id, v, format) {
    const n = $(id);
    countUp(n, v === null ? NaN : v, 0, { format: (x) => (v === null ? "—" : format(x)), from: prev[id] ?? 0, duration: 650 });
    if (prev[id] !== v) { const card = n.closest(".dkpi"); card.classList.remove("flash"); void card.offsetWidth; card.classList.add("flash"); }
    prev[id] = v;
  }

  function render() {
    const f = filtersOf(S);
    const idx = Mx.filter(ds, f);
    const sm = Mx.summary(ds, idx);
    const st = Mx.STAT[S.stat], vf = valueFormat(S.stat, S.measure), af = axisFormat(S.stat, S.measure);
    const mName = measureName(S.stat, S.measure);
    const mVal = Mx.aggregate(ds, idx, S.stat, S.measure);

    // control readout
    $("cb-read").replaceChildren(el("b", { text: mName }), `by ${dimLabel(S.dim).toLowerCase()}`);

    // KPIs
    $("k-measure-label").textContent = mName;
    kpi("k-measure", mVal, vf);
    $("k-measure-sub").textContent = st.kind === "rate" ? "Σ ÷ Σ over the selection" : { total: "Σ over the selection", ptg: `Σ ÷ ${fmt(sm.teamGames)} team-games`, avg: `mean of ${fmt(sm.active)} player-games with a stat`, median: `median of ${fmt(sm.active)} player-games with a stat` }[S.measure];
    kpi("k-rows", sm.rows, (x) => fmt(x));
    $("k-rows-sub").textContent = `${fmt((sm.rows / ds.n) * 100, 1)}% of all ${fmt(ds.n)}`;
    kpi("k-players", sm.players, (x) => fmt(x));
    $("k-players-sub").textContent = sm.players === 1 ? ds.players[ds.c.player[idx[0]]].label : "distinct players";
    kpi("k-tg", sm.teamGames, (x) => fmt(x));
    kpi("k-scrim", sm.scrimmage, (x) => (Math.abs(x) >= 1e6 ? compact(x) : fmt(x)));
    kpi("k-td", sm.td, (x) => fmt(x));
    $("k-td-sub").textContent = sm.teamGames ? `${fmt(sm.td / sm.teamGames, 2)} per team-game` : "rush + rec + return";

    renderBreakdown(idx, vf, af, mName);
    renderTrend(idx, vf, af, mName);
    renderDistribution(idx);
    renderTeamMap(idx, vf, mName);
    renderLeaders(idx, vf, mName);
    renderTable(idx, sm, vf, mName);
  }

  // ---- chart 1: breakdown
  function renderBreakdown(idx, vf, af, mName) {
    const rows = Mx.breakdown(ds, idx, S.dim, S.stat, S.measure);
    const ranked = ["team", "opp", "player"].includes(S.dim);
    $("c1-h").textContent = `${mName} by ${dimLabel(S.dim).replace(" (top 20)", "").toLowerCase()}`;
    const st = Mx.STAT[S.stat];
    $("c1-sub").textContent = ranked ? (S.dim === "player" ? "Top 20 players in the selection" : "Ranked, highest first") : Mx.DIMENSIONS.find((d) => d.id === S.dim).ordered ? "In order" : "Ranked, highest first";
    $("c1-note").textContent = S.dim === "player"
      ? (st.kind === "rate" ? `Players with at least ${st.minTotal} ${st.denName} in the selection.` : S.measure === "total" ? "" : "Players with at least 8 games with a stat in the selection.")
      : S.dim === "week" ? "Regular-season weeks, then playoff weeks (numbering differs before/after 2021)." : "";
    $("c1-cols").hidden = ranked; $("c1-rank").hidden = !ranked;
    if (ranked) {
      const top = S.dim === "player" ? rows.slice(0, 20) : rows;
      const opts = {
        rows: top.map((r, i) => {
          if (S.dim === "player") {
            const p = ds.players[r.key], team = mainTeam(r.idx);
            return { key: "p" + r.key, label: p.name, sub: `${p.pos} · ${team}`, value: r.value, highlight: i === 0, badge: () => avatar(p.name, p.img, team), _r: r };
          }
          const t = ds.teams[r.key];
          return { key: "t" + r.key, label: t.name, value: r.value, highlight: false, badge: () => teamBadge(t.code, 22), _r: r };
        }),
        format: vf, tipTitle: (r) => r.label,
        tipRows: (r) => [{ value: vf(r.value), label: mName }, { value: fmt(r._r.idx.length), label: "Player-games" }],
      };
      charts.c1r ? charts.c1r.update(opts) : (charts.c1r = C.ranked("#c1-rank", opts));
    } else {
      const posColor = S.dim === "pos";
      const opts = {
        data: rows.map((r) => ({ key: r.key, label: r.label, value: r.value, color: posColor ? POS_COLORS[POS[r.key]] : null, n: r.idx.length })),
        yFormat: af, tipFormat: vf, labelFormat: vf, labels: rows.length <= 12 ? "all" : "none", seasonAxis: S.dim === "season",
        highlight: new Set(), valueName: mName, height: 330,
        tipRows: (d) => [{ value: vf(d.value), label: mName, color: d.color || NAVY, key: "swatch" }, { value: fmt(d.n), label: "Player-games" }],
        ariaLabel: `Column chart of ${mName} by ${dimLabel(S.dim)}`,
      };
      charts.c1 ? charts.c1.update(opts) : (charts.c1 = C.columns("#c1-cols", opts));
    }
  }
  function mainTeam(rowIdx) {
    const cnt = new Map();
    for (const i of rowIdx) cnt.set(ds.c.team[i], (cnt.get(ds.c.team[i]) || 0) + 1);
    const teams = [...cnt.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => ds.teams[t].code);
    return teams.length > 2 ? teams.slice(0, 2).join(", ") + " +" + (teams.length - 2) : teams.join(", ");
  }

  // ---- chart 2: trend by position
  function renderTrend(idx, vf, af, mName) {
    $("c2-h").textContent = `${mName}, by position`;
    const byPos = Mx.groupBy(ds, idx, "pos");
    const series = [...byPos.keys()].sort().map((p) => {
      const bySeason = Mx.groupBy(ds, byPos.get(p), "season");
      const values = [...bySeason.keys()].sort((a, b) => a - b).map((s) => ({ x: s, y: Mx.aggregate(ds, bySeason.get(s), S.stat, S.measure) })).filter((d) => d.y !== null);
      return { key: POS[p], label: POS[p], color: POS_COLORS[POS[p]], values };
    }).filter((s) => s.values.length);
    $("c2-legend").replaceChildren(...series.map((s) => el("li", null, el("i", { class: "linekey", style: { background: s.color } }), s.label)));
    const opts = { series, yFormat: af, tipFormat: vf, endLabels: false, height: 300, ariaLabel: `Line chart of ${mName} by season and position` };
    charts.c2 ? charts.c2.update(opts) : (charts.c2 = C.line("#c2", opts));
  }

  // ---- chart 3: distribution
  function renderDistribution(idx) {
    const st = Mx.STAT[S.stat];
    const vals = Mx.distributionValues(ds, idx, S.stat).sort((a, b) => a - b);
    const unit = st.kind === "rate" ? st.label.toLowerCase() : st.label.toLowerCase();
    $("c3-h").textContent = `${st.label} in a single game`;
    $("c3-sub").textContent = st.kind === "rate" ? `One value per player-game with ${st.minDen}+ ${st.denName}` : "One value per player-game with a recorded stat";
    let bins = [], markers = [];
    if (vals.length) {
      const lo = Mx.quantile(vals, 0.005), hi = Mx.quantile(vals, 0.995);
      const x = d3.scaleLinear().domain([Math.min(lo, 0), hi === lo ? lo + 1 : hi]).nice(24);
      const [d0, d1] = x.domain();
      const gen = d3.bin().domain([d0, d1]).thresholds(x.ticks(24));
      bins = gen(vals.map((v) => Math.max(d0, Math.min(d1 - 1e-9, v)))).map((b) => ({ x0: b.x0, x1: b.x1, count: b.length, share: b.length / vals.length }));
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length, med = Mx.quantile(vals, 0.5);
      const f = st.kind === "rate" && st.pct ? (v) => fmt(v, 1) + "%" : (v) => fmt(v, 1);
      markers = [{ x: med, label: `Median ${f(med)}` }];
      if (Math.abs(mean - med) > (d1 - d0) * 0.06) markers.push({ x: mean, label: `Avg ${f(mean)}` });
    }
    $("c3-note").textContent = vals.length ? `${fmt(vals.length)} player-games. The top and bottom 0.5% are grouped into the end bins.` : "";
    const opts = { bins, color: NAVY, xLabel: unit, yLabel: "Player-games", markers, unit: "", xFormat: st.kind === "rate" && st.pct ? (v) => fmt(v, 0) + "%" : (v) => fmt(v, Math.abs(v) < 5 && v % 1 ? 1 : 0), height: 300,
      ariaLabel: `Histogram of ${st.label} per player-game` };
    charts.c3 ? charts.c3.update(opts) : (charts.c3 = C.histogram("#c3", opts));
  }

  // ---- chart 4: team map
  let tiles = null;
  function renderTeamMap(idx, vf, mName) {
    $("c4-h").textContent = `${mName} by team`;
    const g = Mx.groupBy(ds, idx, "team");
    const vals = new Map();
    for (const [t, rows] of g) { const v = Mx.aggregate(ds, rows, S.stat, S.measure); if (v !== null) vals.set(t, v); }
    const ext = d3.extent([...vals.values()]);
    const ramp = d3.scaleLinear().domain([0, 0.25, 0.5, 0.75, 1]).range(["#cde2fb", "#86b6ef", "#2a78d6", "#1c5cab", "#0d366b"]).interpolate(d3.interpolateLab);
    const norm = (v) => (ext[1] > ext[0] ? (v - ext[0]) / (ext[1] - ext[0]) : 0.5);
    const box = $("c4");
    if (!tiles) {
      tiles = new Map();
      ["AFC", "NFC"].forEach((conf) => {
        const col = el("div", { class: "tmap-conf" }, el("h4", { text: conf }));
        const divs = el("div", { class: "tmap-divs" });
        ds.divisions.filter((d) => d.startsWith(conf)).forEach((div) => {
          const teamsBox = el("div", { class: "tmap-teams" });
          ds.teams.forEach((t, i) => {
            if (t.division !== div) return;
            const tile = el("button", { type: "button", class: "tile" }, teamBadge(t.code, 24), el("b", { text: t.code }), el("span", { class: "tv" }));
            tile.addEventListener("click", () => { S.teams.has(i) ? S.teams.delete(i) : S.teams.add(i); update(); });
            tile.addEventListener("pointerenter", (e) => tile._tip && window.RIB.showTip(e, tile._tip()));
            tile.addEventListener("pointermove", window.RIB.moveTip);
            tile.addEventListener("pointerleave", window.RIB.hideTip);
            tile.addEventListener("focus", (e) => tile._tip && window.RIB.showTip(e, tile._tip()));
            tile.addEventListener("blur", window.RIB.hideTip);
            tiles.set(i, tile); teamsBox.appendChild(tile);
          });
          divs.appendChild(el("div", { class: "tmap-div" }, el("h5", { text: div.replace(conf + " ", "") }), teamsBox));
        });
        col.appendChild(divs); box.appendChild(col);
      });
    }
    tiles.forEach((tile, i) => {
      const v = vals.get(i), t = ds.teams[i];
      const on = v !== undefined;
      tile.classList.toggle("off", !on);
      tile.classList.toggle("selected", S.teams.has(i) && S.teams.size < 32);
      const k = on ? norm(v) : 0;
      tile.style.setProperty("--bg", on ? ramp(k) : "");
      tile.style.setProperty("--fg", on && k > 0.45 ? "#fff" : "");
      tile.querySelector(".tv").textContent = on ? vf(v) : "—";
      tile.setAttribute("aria-label", `${t.name}: ${on ? vf(v) : "not in selection"}. Click to ${S.teams.has(i) ? "remove from" : "add to"} team filter.`);
      tile._tip = () => tipBody(t.name, [{ value: on ? vf(v) : "—", label: mName }, { value: t.division, label: "Division" }]);
    });
    $("c4-min").textContent = ext[0] !== undefined ? vf(ext[0]) : "";
    $("c4-max").textContent = ext[1] !== undefined ? vf(ext[1]) : "";
  }

  // ---- chart 5: leaders
  function renderLeaders(idx, vf, mName) {
    const st = Mx.STAT[S.stat];
    const rows = Mx.breakdown(ds, idx, "player", S.stat, S.measure).slice(0, 10);
    $("c5-h").textContent = `Top players: ${Mx.STAT[S.stat].short}${st.kind === "rate" || S.measure === "total" ? "" : " " + Mx.MEASURE[S.measure].short}`;
    $("c5-sub").textContent = st.kind === "rate" ? `Min. ${st.minTotal} ${st.denName} in the selection` : S.measure === "total" ? "Most in the selection" : "Min. 8 games with a stat in the selection";
    const opts = {
      rows: rows.map((r, i) => {
        const p = ds.players[r.key], team = mainTeam(r.idx);
        return { key: "p" + r.key, label: p.name, sub: `${p.pos} · ${team}`, value: r.value, highlight: i === 0, badge: () => avatar(p.name, p.img, team.split(",")[0]), _r: r, _p: p, _t: team };
      }),
      format: vf,
      tipHead: (r) => el("div", { class: "tt-head" }, avatar(r._p.name, r._p.img, r._t.split(",")[0]), el("div", null, el("div", { class: "tt-name", text: r._p.name }), el("div", { class: "tt-sub", text: `${r._p.pos} · ${r._t}` }))),
      tipRows: (r) => [{ value: vf(r.value), label: mName }, { value: fmt(r._r.idx.filter((i) => !ds.c.nostat[i]).length), label: "Games with a stat" },
        { value: fmt(Mx.sum(ds, r._r.idx, "scrim_yds")), label: "Scrimmage yds" }, { value: fmt(Mx.sum(ds, r._r.idx, "pass_yds")), label: "Passing yds" }],
    };
    charts.c5 ? charts.c5.update(opts) : (charts.c5 = C.ranked("#c5", opts));
  }

  // ---- table
  const tableState = { sort: null, dir: -1, page: 0, q: "", per: 15, rows: [] };
  function renderTable(idx, sm, vf, mName) {
    const rows = Mx.breakdown(ds, idx, S.dim, S.stat, S.measure);
    const dimName = dimLabel(S.dim).replace(" (top 20)", "");
    $("t-h").textContent = `${mName} by ${dimName.toLowerCase()}: the numbers`;
    const f1 = (v) => fmt(v, 1), f0 = (v) => fmt(v);
    const cols = [
      { id: "label", name: dimName, fmt: (v) => v, text: true },
      { id: "value", name: Mx.STAT[S.stat].short + (Mx.STAT[S.stat].kind === "rate" ? "" : S.measure === "total" ? " (total)" : S.measure === "ptg" ? " / team-game" : S.measure === "avg" ? " avg / game" : " median / game"), fmt: vf, measure: true },
      { id: "rows", name: "Player-games", fmt: f0 },
      { id: "players", name: "Players", fmt: f0 },
      { id: "tg", name: "Team-games", fmt: f0 },
      { id: "pyd", name: "Pass yds", fmt: f0 },
      { id: "ryd", name: "Rush yds", fmt: f0 },
      { id: "recyd", name: "Rec yds", fmt: f0 },
      { id: "td", name: "TDs scored", fmt: f0 },
      { id: "ppr", name: "PPR / player-game", fmt: (v) => (v === null ? "—" : fmt(v, 2)) },
    ];
    tableState.rows = rows.map((r, order) => ({
      order, key: r.key, label: r.label, value: r.value, rows: r.idx.length, players: Mx.distinct(ds, r.idx, "player"),
      tg: Mx.teamGames(ds, r.idx), pyd: Mx.sum(ds, r.idx, "pass_yds"), ryd: Mx.sum(ds, r.idx, "rush_yds"),
      recyd: Mx.sum(ds, r.idx, "rec_yds"), td: Mx.sum(ds, r.idx, "td"), ppr: Mx.aggregate(ds, r.idx, "ppr", "avg"),
    }));
    tableState.cols = cols;
    tableState.total = { label: "All selected", value: Mx.aggregate(ds, idx, S.stat, S.measure), rows: sm.rows, players: sm.players, tg: sm.teamGames,
      pyd: Mx.sum(ds, idx, "pass_yds"), ryd: Mx.sum(ds, idx, "rush_yds"), recyd: Mx.sum(ds, idx, "rec_yds"), td: sm.td, ppr: sm.pprAvg };
    drawTable();
  }
  function tableView() {
    const q = tableState.q.trim().toLowerCase();
    let rows = tableState.rows.filter((r) => !q || String(r.label).toLowerCase().includes(q));
    if (tableState.sort) {
      const k = tableState.sort, d = tableState.dir;
      rows = rows.slice().sort((a, b) => {
        const x = a[k], y = b[k];
        if (x === null) return 1; if (y === null) return -1;
        return typeof x === "string" ? d * x.localeCompare(y) : d * (x - y);
      });
    }
    return rows;
  }
  function drawTable() {
    const cols = tableState.cols, t = $("t");
    t.tHead.replaceChildren(el("tr", null, cols.map((c) => {
      const sorted = tableState.sort === c.id;
      const b = el("button", { type: "button" }, c.name, el("span", { class: "arrow", "aria-hidden": "true", text: sorted ? (tableState.dir > 0 ? "▲" : "▼") : "↕" }));
      b.addEventListener("click", () => {
        if (tableState.sort === c.id) tableState.dir *= -1; else { tableState.sort = c.id; tableState.dir = c.text ? 1 : -1; }
        tableState.page = 0; drawTable();
      });
      return el("th", { scope: "col", class: c.measure ? "measure" : null, "aria-sort": sorted ? (tableState.dir > 0 ? "ascending" : "descending") : null }, b);
    })));
    const rows = tableView(), per = tableState.per;
    const pages = Math.max(1, Math.ceil(rows.length / per));
    tableState.page = Math.min(tableState.page, pages - 1);
    const slice = rows.slice(tableState.page * per, tableState.page * per + per);
    t.tBodies[0].replaceChildren(...slice.map((r) => el("tr", null, cols.map((c, j) => {
      const v = r[c.id];
      if (j === 0) {
        const id = el("span", { class: "cell-id" });
        if (S.dim === "team" || S.dim === "opp") id.appendChild(teamBadge(ds.teams[r.key].code, 20));
        if (S.dim === "pos") id.appendChild(posPill(String(v)));
        else id.appendChild(document.createTextNode(String(v)));
        return el("td", null, id);
      }
      return el("td", { class: c.measure ? "measure" : null, text: v === null ? "—" : c.fmt(v) });
    }))));
    if (!slice.length) t.tBodies[0].replaceChildren(el("tr", null, el("td", { colspan: String(cols.length), style: { textAlign: "center", color: "#6b778c", padding: "24px" }, text: "No rows match." })));
    const tot = tableState.total;
    t.tFoot.replaceChildren(el("tr", null, cols.map((c, j) => el("td", { class: c.measure ? "measure" : null, text: j === 0 ? "All selected" : tot[c.id] === null ? "—" : c.fmt(tot[c.id]) }))));
    $("t-meta").textContent = `${fmt(rows.length)} row${rows.length === 1 ? "" : "s"}${tableState.q ? " match" : ""} · page ${tableState.page + 1} of ${pages}`;
    const pager = $("t-pager");
    const btn = (label, page, dis, aria) => { const b = el("button", { type: "button", text: label, "aria-label": aria || label }); b.disabled = dis; b.addEventListener("click", () => { tableState.page = page; drawTable(); }); return b; };
    pager.replaceChildren(btn("« First", 0, tableState.page === 0), btn("‹ Prev", tableState.page - 1, tableState.page === 0, "Previous page"),
      el("span", { text: `${tableState.page + 1} / ${pages}` }), btn("Next ›", tableState.page + 1, tableState.page >= pages - 1, "Next page"), btn("Last »", pages - 1, tableState.page >= pages - 1));
  }
  function setupTable() {
    $("t-search").addEventListener("input", (e) => { tableState.q = e.target.value; tableState.page = 0; drawTable(); });
    $("t-csv").addEventListener("click", () => {
      const cols = tableState.cols, esc = (s) => (/[",\n]/.test(s) ? `"${String(s).replace(/"/g, '""')}"` : String(s));
      const raw = (c, v) => (v === null ? "" : c.text ? v : +(+v).toFixed(4));
      const lines = [cols.map((c) => esc(c.name)).join(","), ...tableView().map((r) => cols.map((c) => esc(raw(c, r[c.id]))).join(",")),
        cols.map((c, j) => esc(j === 0 ? "All selected" : raw(c, tableState.total[c.id]))).join(",")];
      const blob = new Blob([lines.join("\n")], { type: "text/csv" });
      const a = el("a", { href: URL.createObjectURL(blob), download: `run-it-back_${S.stat}_${S.measure}_by_${S.dim}.csv` });
      document.body.appendChild(a); a.click(); a.remove();
    });
  }

  /* ---------------------------------------------------------------- update loop */
  let raf = 0;
  function update() {
    syncFilterUI();
    activeChips();
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => { render(); document.documentElement.dataset.renders = String(+(document.documentElement.dataset.renders || 0) + 1); });
  }

  async function init() {
    let json;
    try { json = await window.RIB.loadJSON("data/dashboard_data.json"); }
    catch (err) { window.RIB.showLoadError($("charts"), err); return; }
    ds = Mx.Dataset(json);
    playerGames = new Int32Array(ds.players.length);
    for (let i = 0; i < ds.n; i++) if (!ds.c.nostat[i]) playerGames[ds.c.player[i]]++;
    document.querySelector(".dash-badges").replaceChildren(
      el("span", { text: `${fmt(ds.n)} player-games` }), el("span", { text: `${ds.seasons[0]}–${ds.seasons[ds.seasons.length - 1]}` }),
      el("span", { text: `${ds.teams.length} teams` }), el("span", { text: `${fmt(ds.players.length)} players` }));
    setupControls(); syncMeasureOptions(); setupFilters(); setupTable();
    update();
    // expose for QA (analysis/verify-dashboard) — read-only helpers
    window.__dash = { get state() { return S; }, Metrics: Mx, get ds() { return ds; }, filtersOf };
    document.documentElement.dataset.ready = "1";
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
