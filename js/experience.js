/* ==========================================================================
   experience.js — connects the football scenes to the story (index.html).

   MODEL 1  Field of Play      big interactive field: play picker, season scrubber
                               (doubles as a mini chart), player cards, yard-line
                               hover, pointer parallax, scroll-driven camera.
   MODEL 2  Play Tracker       broadcast picture-in-picture that runs the play for
                               the finding you are reading; statline hover highlights.
   MODEL 3  Touchdown Moment   cinematic scoring play + broadcast typography + a real stat.
   MODEL 4  Hero atmosphere    stadium light banks, beams, crowd flashes, drifting dust.

   Every number shown comes from data/report_metrics.json (via report.js).
   All scenes pause off-screen / in background tabs and turn into static diagrams
   when Motion is off (nav switch or prefers-reduced-motion).
   ========================================================================== */
(function () {
  "use strict";
  const { el, fmt } = window.RIB;
  const PB = window.Playbook;
  const $ = (id) => document.getElementById(id);
  const small = () => window.matchMedia("(max-width: 760px)").matches;
  const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  const motionOn = () => window.RIB.motion.on;

  /* ---------------------------------------------------------------- data helpers */
  const at = (arr, s, k = "value") => { const r = arr.find((d) => d.season === s); return r ? r[k] : null; };
  const pct = (v, d = 1) => fmt(v, d) + "%";

  // One definition per play: which finding it illustrates and which season metric it shows.
  function playDefs(D) {
    const f7 = (k) => D.f7.share.map((d) => ({ season: d.season, value: d[k] }));
    return {
      pass: { label: "Passing", finding: 1, metric: "Passing yds per team-game", series: D.f1.pass_ypg, f: (v) => fmt(v, 1),
        how: (s, I) => `This completion gains exactly ${fmt(I.ypa, 2)} yards: the league’s yards per pass attempt in ${s}. Faint routes: ${fmt(I.attPg, 1)} pass attempts in an average team-game.` },
      deep: { label: "Deep shot", finding: 2, metric: "300-yard passing games", series: D.f2.games, f: (v) => fmt(v, 0),
        how: (s) => `Big passing days are getting rarer: ${fmt(at(D.f2.games, s), 0)} games of 300+ passing yards in ${s} (${fmt(at(D.f2.games, s, "rate"), 1)}% of team-games).` },
      sack: { label: "Sack", finding: 3, metric: "Sack rate", series: D.f3.sack_rate, f: (v) => pct(v, 2),
        how: (s, I) => `In ${s}, about 1 in ${Math.round(100 / I.sackRate)} dropbacks ended in a sack (${pct(I.sackRate, 2)}).` },
      giveaway: { label: "Giveaway", finding: 4, metric: "Giveaways per team-game", series: D.f4.give_pg, f: (v) => fmt(v, 2),
        how: (s) => `Interceptions + lost fumbles per team-game in ${s}. The interception rate was ${pct(at(D.f4.int_rate, s), 2)} of attempts.` },
      rush: { label: "Rushing", finding: 5, metric: "Rushing yds per team-game", series: D.f5.rush_ypg, f: (v) => fmt(v, 1),
        how: (s, I) => `This run gains exactly ${fmt(I.ypc, 2)} yards: the league’s yards per carry in ${s}. Faint lanes: ${fmt(I.carPg, 1)} carries in an average team-game.` },
      scramble: { label: "QB scramble", finding: 6, metric: "QB share of rushing yds", series: D.f6.qb_share, f: (v) => pct(v, 1),
        how: (s) => `Quarterbacks gained ${pct(at(D.f6.qb_share, s), 1)} of all rushing yards in ${s}, counting designed runs, scrambles and kneel-downs.` },
      te: { label: "TE target", finding: 7, metric: "TE share of targets", series: f7("TE"), f: (v) => pct(v, 1),
        how: (s) => { const r = D.f7.share.find((d) => d.season === s); return `Tight ends drew ${pct(r.TE, 1)} of targets in ${s}; running backs ${pct(r.RB, 1)} (their route is dimmed).`; } },
      touchdown: { label: "Touchdown", finding: null, metric: "TDs per team-game", series: D.td.td_pg, f: (v) => fmt(v, 2),
        how: (s) => `${fmt(at(D.td.totals, s), 0)} touchdowns were scored in the ${s} regular season: ${fmt(at(D.td.td_pg, s), 2)} per team-game.` },
    };
  }

  // Player cards: league numbers for the clicked position, for the selected season.
  function playerCard(D, role, s) {
    const I = PB.seasonInputs(D, s), sh = D.f7.share.find((d) => d.season === s);
    const rows = {
      QB: [["Passing yds / team-game", fmt(at(D.f1.pass_ypg, s), 1)], ["Yards / attempt", fmt(I.ypa, 2)], ["Sack rate", pct(I.sackRate, 2)], ["QB share of rush yds", pct(I.qbShare, 1)]],
      RB: [["Rushing yds / team-game", fmt(at(D.f5.rush_ypg, s), 1)], ["Yards / carry", fmt(I.ypc, 2)], ["RB share of targets", pct(sh.RB, 1)], ["1,000-yd rushers", fmt(at(D.f5.rushers_1000, s), 0)]],
      WR: [["WR share of targets", pct(sh.WR, 1)], ["Yards / attempt", fmt(I.ypa, 2)], ["300-yd passing games", fmt(at(D.f2.games, s), 0)]],
      TE: [["TE share of targets", pct(sh.TE, 1)], ["Yards / attempt", fmt(I.ypa, 2)]],
      OL: [["Sack rate allowed", pct(I.sackRate, 2)], ["Yards / carry", fmt(I.ypc, 2)]],
      DL: [["Sack rate", pct(I.sackRate, 2)], ["Giveaways / team-game", fmt(I.givePg, 2)]],
      LB: [["Sack rate", pct(I.sackRate, 2)], ["Yards / carry allowed", fmt(I.ypc, 2)]],
      CB: [["Interception rate", pct(at(D.f4.int_rate, s), 2)], ["Yards / attempt allowed", fmt(I.ypa, 2)]],
      S: [["Interception rate", pct(at(D.f4.int_rate, s), 2)], ["Giveaways / team-game", fmt(I.givePg, 2)]],
    }[role];
    const names = { QB: "Quarterback", RB: "Running back", WR: "Wide receiver", TE: "Tight end", OL: "Offensive line", DL: "Defensive line", LB: "Linebacker", CB: "Cornerback", S: "Safety" };
    return { title: names[role], rows, note: role === "DL" || role === "LB" || role === "CB" || role === "S" ? `League offense, ${s} (what defenses faced)` : `League-wide, ${s} regular season` };
  }

  /* ================================================================ MODEL 1 — FIELD OF PLAY */
  function fieldOfPlay(D) {
    const canvas = $("fop-canvas"); if (!canvas) return null;
    const DEFS = playDefs(D);
    const seasons = D.f1.pass_ypg.map((d) => d.season);
    let current = "pass", locked = seasons[seasons.length - 1], shown = locked;
    const stage = PB.createStage(canvas, {
      mode: "field", data: D, interactive: true, season: locked, motion: motionOn(),
      onPlayerClick: (p, at) => (p ? openCard(p.role, at, p.id) : closeCard()),
    });
    const stageEl = $("fop-stage");

    // play buttons
    const plays = $("fop-plays");
    Object.entries(DEFS).forEach(([k, d]) => {
      const b = el("button", { type: "button", role: "radio", "aria-checked": String(k === current), "data-play": k, tabindex: k === current ? "0" : "-1" }, el("i", { class: "pi pi-" + k, "aria-hidden": "true" }), d.label);
      b.addEventListener("click", () => setPlay(k));
      plays.appendChild(b);
    });
    radioKeys(plays, (b) => setPlay(b.dataset.play));

    // season scrubber = mini chart of the selected metric
    const box = $("fop-seasons");
    const btns = seasons.map((s) => {
      const b = el("button", { type: "button", role: "radio", "data-season": String(s), "aria-checked": String(s === locked), tabindex: s === locked ? "0" : "-1" }, el("span", { class: "bar" }, el("i")), el("span", { class: "yr", text: "’" + String(s).slice(2) }));
      b.addEventListener("mouseenter", () => preview(s));
      b.addEventListener("focus", () => preview(s));
      b.addEventListener("click", () => lock(s));
      box.appendChild(b);
      return b;
    });
    box.addEventListener("mouseleave", () => preview(locked));
    radioKeys(box, (b) => lock(+b.dataset.season));
    if (!finePointer) document.querySelector(".fop-season-label .hint").textContent = "tap a season";

    function scrubBars() {
      const d = DEFS[current], vals = d.series.map((x) => x.value), lo = Math.min(...vals), hi = Math.max(...vals);
      $("fop-season-metric").textContent = d.metric + " by season";
      btns.forEach((b, i) => {
        const v = d.series[i].value;
        b.querySelector(".bar i").style.height = (18 + ((v - lo) / (hi - lo || 1)) * 82) + "%";
        b.setAttribute("aria-label", `${seasons[i]}: ${d.f(v)} ${d.metric.toLowerCase()}`);
        b.title = `${seasons[i]}: ${d.f(v)}`;
      });
    }
    function renderCard() {
      const d = DEFS[current], v = at(d.series, shown), v0 = d.series[0].value, I = PB.seasonInputs(D, shown);
      const isShare = d.metric.includes("share") || d.metric.includes("rate");
      const delta = shown === seasons[0] ? "" : isShare ? `${v - v0 >= 0 ? "+" : "−"}${fmt(Math.abs(v - v0), 1)} pts vs ${seasons[0]}` : `${v - v0 >= 0 ? "+" : "−"}${fmt(Math.abs((v / v0 - 1) * 100), 1)}% vs ${seasons[0]}`;
      $("fop-card").replaceChildren(
        el("div", { class: "lt-top" }, el("span", { class: "lt-tag", text: d.label }), el("span", { class: "lt-season", text: String(shown) })),
        el("div", { class: "lt-main" }, el("b", { class: "lt-value", text: d.f(v) }), el("span", { class: "lt-metric", text: d.metric }), delta ? el("span", { class: "lt-delta", text: delta }) : null),
        el("p", { class: "lt-how", text: d.how(shown, I) }),
        spark(d.series, shown, d.f),
        d.finding ? el("a", { class: "lt-link", href: "#f" + d.finding, text: `Read finding ${String(d.finding).padStart(2, "0")} →` }) : el("a", { class: "lt-link", href: "#touchdown", text: "Watch the touchdown moment →" }));
      $("fop-bug-season").textContent = String(shown);
      $("fop-bug-play").textContent = d.label.toUpperCase();
      canvas.setAttribute("aria-label", `${d.label} play on a perspective NFL field, ${shown}. ${d.how(shown, I)}`);
    }
    function setPlay(k) {
      current = k;
      plays.querySelectorAll("button").forEach((b) => { const on = b.dataset.play === k; b.setAttribute("aria-checked", String(on)); b.tabIndex = on ? 0 : -1; });
      closeCard();
      stage.setPlay(k, shown, { loop: true });
      scrubBars(); renderCard();
      window.__fop.current = k;
    }
    function preview(s) { if (s === shown) return; shown = s; stage.setSeason(s); renderCard(); btns.forEach((b) => b.classList.toggle("is-preview", +b.dataset.season === s && s !== locked)); }
    function lock(s) {
      locked = s; btns.forEach((b) => { const on = +b.dataset.season === s; b.setAttribute("aria-checked", String(on)); b.tabIndex = on ? 0 : -1; b.classList.remove("is-preview"); });
      shown = -1; preview(s);
    }

    // player cards (click on canvas, or keyboard via the position buttons)
    const pc = $("fop-pcard");
    function openCard(role, pos, id) {
      const c = playerCard(D, role, shown);
      pc.replaceChildren(
        el("div", { class: "pc-head" }, el("span", { class: "pc-pos", text: role }), el("b", { id: "fop-pcard-h", text: c.title }),
          (() => { const x = el("button", { type: "button", class: "pc-x", "aria-label": "Close card", text: "×" }); x.addEventListener("click", closeCard); return x; })()),
        el("dl", null, ...c.rows.flatMap(([k, v]) => [el("dt", { text: k }), el("dd", { text: v })])),
        el("p", { class: "pc-note", text: c.note }));
      pc.hidden = false;
      const W = stageEl.clientWidth, H = stageEl.clientHeight, w = pc.offsetWidth, h = pc.offsetHeight;
      const x = pos ? Math.min(Math.max(8, pos.x + 16), W - w - 8) : 12, y = pos ? Math.min(Math.max(8, pos.y - h / 2), H - h - 8) : 12;
      pc.style.left = x + "px"; pc.style.top = y + "px";
      if (id) stage.select(id);
    }
    function closeCard() { pc.hidden = true; stage.select(null); }
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !pc.hidden) closeCard(); });
    const players = $("fop-players");
    players.appendChild(el("span", { class: "fp-label", text: "Player cards:" }));
    [["QB", "QB"], ["RB", "RB"], ["WR", "Z"], ["TE", "TE"], ["OL", "C"], ["DL", "DT1"], ["LB", "LB2"], ["CB", "CB2"], ["S", "S1"]].forEach(([role, id]) => {
      const b = el("button", { type: "button", class: "chip-sm", text: role, "aria-label": `Open ${role} card` });
      b.addEventListener("click", () => openCard(role, stage.playerScreen(id), id));
      players.appendChild(b);
    });

    // replay / pause
    $("fop-replay").addEventListener("click", () => { $("fop-pause").setAttribute("aria-pressed", "false"); $("fop-pause").textContent = "❚❚ Pause"; stage.replay(); });
    $("fop-pause").addEventListener("click", (e) => {
      const paused = e.currentTarget.getAttribute("aria-pressed") !== "true";
      e.currentTarget.setAttribute("aria-pressed", String(paused)); e.currentTarget.textContent = paused ? "▶ Resume" : "❚❚ Pause";
      paused ? stage.pause() : stage.resume();
    });

    // desktop: pointer parallax; all: scroll-driven camera dolly
    if (finePointer) {
      stageEl.addEventListener("pointermove", (e) => {
        if (!motionOn()) return;
        const r = stageEl.getBoundingClientRect();
        stage.setParallax(((e.clientX - r.left) / r.width) * 2 - 1, ((e.clientY - r.top) / r.height) * 2 - 1);
      });
      stageEl.addEventListener("pointerleave", () => stage.setParallax(0, 0));
    }
    let ticking = false;
    window.addEventListener("scroll", () => {
      if (ticking || !motionOn()) return; ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        const r = stageEl.getBoundingClientRect(), vh = window.innerHeight;
        if (r.bottom < 0 || r.top > vh) return;
        stage.setDolly(Math.min(1, Math.max(0, (vh - r.top) / (vh + r.height))));
      });
    }, { passive: true });

    window.__fop = { stage, setPlay, lock, preview, openCard, current };
    // links elsewhere on the page ("Run the rushing play") load a play here
    document.querySelectorAll("[data-fop-play]").forEach((a) => a.addEventListener("click", () => setPlay(a.dataset.fopPlay)));
    setPlay("pass");
    return stage;
  }

  // small trend line of the play's metric, selected season highlighted (inline SVG)
  function spark(series, season, f) {
    const NS = "http://www.w3.org/2000/svg", W = 280, H = 70, pad = 8;
    const vals = series.map((d) => d.value), lo = Math.min(...vals), hi = Math.max(...vals);
    const x = (i) => pad + (i / (series.length - 1)) * (W - pad * 2), y = (v) => H - 14 - ((v - lo) / (hi - lo || 1)) * (H - 30);
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", `0 0 ${W} ${H + 12}`); svg.setAttribute("class", "lt-spark"); svg.setAttribute("aria-hidden", "true");
    const pts = series.map((d, i) => `${x(i).toFixed(1)},${y(d.value).toFixed(1)}`);
    const mk = (tag, attrs) => { const n = document.createElementNS(NS, tag); Object.entries(attrs).forEach(([k, v]) => n.setAttribute(k, v)); svg.appendChild(n); return n; };
    mk("path", { class: "a", d: `M${pts[0]}L${pts.join("L")}L${x(series.length - 1)},${H - 6}L${x(0)},${H - 6}Z` });
    mk("path", { class: "l", d: `M${pts.join("L")}` });
    const i = series.findIndex((d) => d.season === season);
    mk("circle", { cx: x(i), cy: y(series[i].value), r: 5 });
    const lab = (j, cls) => { const t = mk("text", { x: x(j), y: H + 10, "text-anchor": j === 0 ? "start" : j === series.length - 1 ? "end" : "middle", class: cls || "" }); t.textContent = `${series[j].season}: ${f(series[j].value)}`; };
    lab(0); lab(series.length - 1);
    if (i !== 0 && i !== series.length - 1) { const t = mk("text", { x: x(i), y: y(series[i].value) - 10, "text-anchor": "middle", class: "hi" }); t.textContent = f(series[i].value); }
    return svg;
  }

  // arrow-key navigation for role=radiogroup containers
  function radioKeys(group, activate) {
    group.addEventListener("keydown", (e) => {
      const items = [...group.querySelectorAll('[role="radio"]')], i = items.indexOf(document.activeElement);
      if (i < 0) return;
      let j = null;
      if (e.key === "ArrowRight" || e.key === "ArrowDown") j = (i + 1) % items.length;
      if (e.key === "ArrowLeft" || e.key === "ArrowUp") j = (i - 1 + items.length) % items.length;
      if (e.key === "Home") j = 0; if (e.key === "End") j = items.length - 1;
      if (j === null) return;
      e.preventDefault(); items[j].focus(); activate(items[j]);
    });
  }

  /* ================================================================ MODEL 2 — PLAY TRACKER
     A broadcast inset docked inside every finding (never floating over charts or text).
     Each runs the play that illustrates its finding; only the one on screen animates. */
  function tracker(D) {
    const last = D.meta.last_season;
    const F = {
      f1: ["pass", "Passing volume", `${fmt(D.f1.last, 1)} pass yds / team-game · ${last}`],
      f2: ["deep", "300-yard games", `${fmt(D.f2.last, 0)} games of 300+ passing yds · ${last}`],
      f3: ["sack", "Pass protection", `Sack rate ${pct(D.f3.last, 2)} · ${last}`],
      f4: ["giveaway", "Ball security", `${fmt(D.f4.give_last, 2)} giveaways / team-game · ${last}`],
      f5: ["rush", "Rushing", `${fmt(D.f5.last, 1)} rush yds / team-game · ${last}`],
      f6: ["scramble", "Quarterback runs", `QBs gained ${pct(D.f6.share_last, 1)} of rush yds · ${last}`],
      f7: ["te", "Target share", `TEs drew ${pct(D.f7.te_last, 1)} of targets · ${last}`],
      f8: ["home", "Home vs away", `Home offenses +${fmt(D.f8.diff_ypg, 1)} yds / game`],
      f9: ["team", "Team offense", `${D.f9.top_name}: ${fmt(D.f9.top_ypg, 1)} yds / game`],
      f10: ["fantasy", "Fantasy points", `QBs: ${fmt(D.f10.by_pos.QB.mean, 2)} PPR points / game`],
      f11: ["henry", "Derrick Henry", `${fmt(D.f11.top.scrimmage_yards, 0)} scrimmage yds, ${D.meta.first_season}–${last}`],
    };
    const stages = {};
    Object.entries(F).forEach(([id, [play, title, stat]]) => {
      const sec = $(id); if (!sec) return;
      const col = sec.querySelector(".finding-text"); if (!col) return;
      const num = id.slice(1).padStart(2, "0");
      const replay = el("button", { type: "button", class: "tr-btn", "aria-label": `Replay the ${title.toLowerCase()} play`, text: "↻" });
      const cv = el("canvas", { role: "img", "aria-label": `Animated ${title.toLowerCase()} play illustrating finding ${num}. ${stat}.` });
      const fig = el("figure", { class: "play-inset", "data-finding": id },
        el("div", { class: "tr-head" }, el("span", { class: "tr-live", text: "LIVE" }), el("span", { class: "tr-title", text: `${num} · ${title}` }), replay),
        el("div", { class: "tr-screen" }, cv),
        el("figcaption", { class: "tr-lower", text: stat }));
      // after the key numbers (and after the head-to-head / leader cards where present)
      const anchor = col.querySelector(".h2h") || col.querySelector(".leader-cards") || col.querySelector(".statline");
      anchor ? anchor.after(fig) : col.appendChild(fig);
      const stage = PB.createStage(cv, { mode: "tracker", data: D, season: last, motion: motionOn(), detail: "low" });
      stage.setPlay(play, last, { loop: true });
      replay.addEventListener("click", () => stage.replay());
      col.querySelectorAll(".statline > div").forEach((card) => {
        card.addEventListener("mouseenter", () => stage.setHighlight(true));
        card.addEventListener("mouseleave", () => stage.setHighlight(false));
      });
      stages[id] = stage;
    });
    window.__tracker = { stages };
    return Object.values(stages);
  }

  /* ================================================================ MODEL 3 — TOUCHDOWN MOMENT */
  function touchdown(D) {
    const canvas = $("td-canvas"); if (!canvas) return null;
    const last = D.meta.last_season, first = D.meta.first_season;
    const STATS = [
      [fmt(D.kpis.td_scored, 0), `touchdowns scored, ${first}–${last}, all games`],
      [fmt(D.td.last, 2), `touchdowns per team-game in ${last} (${fmt(D.td.first, 2)} in ${first})`],
      [fmt(D.f8.home_td, 2), `TDs per game at home, vs ${fmt(D.f8.away_td, 2)} on the road`],
      [fmt(D.f11.top.td_scored, 0), `rushing + receiving TDs by ${D.f11.top.name}, ${first}–${last} regular season`],
    ];
    let si = 0;
    const stageEl = $("td-stage"), ov = $("td-overlay");
    const setStat = () => { $("td-stat-value").textContent = STATS[si][0]; $("td-stat-label").textContent = STATS[si][1]; };
    const stage = PB.createStage(canvas, {
      mode: "cinema", data: D, season: last, loop: false, hold: 2.6, motion: motionOn(),
      onEvent: (e) => { if (e.kind === "td") { stageEl.classList.add("scored"); ov.classList.add("show"); } },
    });
    function run() {
      stageEl.classList.remove("scored"); ov.classList.remove("show");
      void ov.offsetWidth;
      if (!motionOn()) { ov.classList.add("show"); stageEl.classList.add("scored"); }
      stage.setPlay("touchdown", last, { loop: false, onDone: () => {} });
      window.__td.runs++;
    }
    $("td-play").addEventListener("click", () => { run(); });
    $("td-next").addEventListener("click", () => { si = (si + 1) % STATS.length; setStat(); if (!ov.classList.contains("show")) ov.classList.add("show"); });
    document.querySelectorAll("[data-play-td]").forEach((a) => a.addEventListener("click", () => setTimeout(run, 500)));
    // play once automatically the first time the scene is well in view
    let auto = false;
    new IntersectionObserver((ents) => { if (ents[0].isIntersecting && !auto) { auto = true; run(); } }, { threshold: 0.55 }).observe(stageEl);
    window.__td = { stage, run, runs: 0, next: () => $("td-next").click() };
    // static first frame until it plays
    stage.setPlay("touchdown", last, { loop: false, autoplay: false });
    return stage;
  }

  /* ================================================================ MODEL 4 — HERO ATMOSPHERE */
  function heroAtmosphere() {
    const hero = document.querySelector(".hero"); if (!hero) return;
    const c = el("canvas", { class: "hero-atmo", "aria-hidden": "true" });
    hero.prepend(c);
    const g = c.getContext("2d");
    let W = 0, H = 0, dpr = 1, raf = 0, visible = true, t0 = performance.now();
    const lite = small();
    const dust = Array.from({ length: lite ? 18 : 46 }, () => ({ x: Math.random(), y: Math.random(), v: 0.004 + Math.random() * 0.01, r: 0.6 + Math.random() * 1.6, p: Math.random() * 6 }));
    const banks = [[0.08, 0.06], [0.93, 0.08]];
    let crowd = null;
    function resize() {
      const r = hero.getBoundingClientRect(); dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      W = r.width; H = r.height; c.width = W * dpr; c.height = H * dpr; c.style.width = W + "px"; c.style.height = H + "px";
      // crowd band: pre-rendered specks along the top edge
      crowd = document.createElement("canvas"); crowd.width = W; crowd.height = 70;
      const cg = crowd.getContext("2d");
      for (let i = 0; i < W * 0.9; i++) { cg.fillStyle = `rgba(${150 + Math.random() * 100},${160 + Math.random() * 80},${200 + Math.random() * 55},${0.05 + Math.random() * 0.1})`; cg.fillRect(Math.random() * W, 10 + Math.random() * 55, 1.4, 1.4); }
      draw(0);
    }
    function draw(tt) {
      g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
      if (crowd) { g.globalAlpha = 0.9; g.drawImage(crowd, 0, 0); g.globalAlpha = 1; }
      // light beams + banks
      banks.forEach(([fx, fy], i) => {
        const x = W * fx, y = H * fy, sway = Math.sin(tt * 0.25 + i * 2) * 0.05;
        g.save(); g.globalCompositeOperation = "lighter";
        const beam = g.createLinearGradient(x, y, W / 2, H);
        beam.addColorStop(0, "rgba(255,244,220,.10)"); beam.addColorStop(1, "rgba(255,244,220,0)");
        g.fillStyle = beam; g.beginPath(); g.moveTo(x, y);
        const dir = i ? -1 : 1;
        g.lineTo(W * (0.5 + dir * (-0.05 + sway)), H * 1.05); g.lineTo(W * (0.5 + dir * (0.25 + sway)), H * 1.05); g.closePath(); g.fill();
        for (let k = 0; k < 12; k++) {
          const lx = x + ((k % 4) - 1.5) * 9 * (i ? -1 : 1), ly = y + Math.floor(k / 4) * 9;
          const glow = g.createRadialGradient(lx, ly, 0, lx, ly, 16);
          glow.addColorStop(0, "rgba(255,250,235,.9)"); glow.addColorStop(0.3, "rgba(255,240,210,.25)"); glow.addColorStop(1, "rgba(255,240,210,0)");
          g.fillStyle = glow; g.fillRect(lx - 16, ly - 16, 32, 32);
        }
        const halo = g.createRadialGradient(x, y + 10, 0, x, y + 10, 180);
        halo.addColorStop(0, "rgba(255,240,215,.18)"); halo.addColorStop(1, "rgba(255,240,215,0)");
        g.fillStyle = halo; g.fillRect(x - 180, y - 170, 360, 360);
        g.restore();
      });
      // drifting dust in the light
      g.save(); g.globalCompositeOperation = "lighter";
      dust.forEach((d) => {
        const x = ((d.x + Math.sin(tt * 0.2 + d.p) * 0.01) % 1) * W, y = ((d.y - tt * d.v) % 1 + 1) % 1 * H;
        g.fillStyle = `rgba(255,245,225,${0.08 + 0.1 * Math.abs(Math.sin(tt + d.p))})`;
        g.beginPath(); g.arc(x, y, d.r, 0, Math.PI * 2); g.fill();
      });
      g.restore();
      // camera flashes in the crowd (desktop only)
      if (!lite && Math.random() < 0.06) { const fx = Math.random() * W, fy = 12 + Math.random() * 50; const fl = g.createRadialGradient(fx, fy, 0, fx, fy, 7); fl.addColorStop(0, "rgba(255,255,255,.9)"); fl.addColorStop(1, "rgba(255,255,255,0)"); g.fillStyle = fl; g.fillRect(fx - 7, fy - 7, 14, 14); }
    }
    function frame(now) { raf = 0; if (!visible || document.hidden || !motionOn()) return; draw((now - t0) / 1000); raf = requestAnimationFrame(frame); }
    const kick = () => { if (!raf && visible && motionOn()) raf = requestAnimationFrame(frame); };
    new IntersectionObserver(([e]) => { visible = e.isIntersecting; kick(); }).observe(hero);
    new ResizeObserver(resize).observe(hero);
    document.addEventListener("visibilitychange", kick);
    window.addEventListener("rib:motion", () => { draw(0); kick(); });
    resize(); kick();
  }

  /* ================================================================ boot */
  function boot(D) {
    if (!PB || window.__experience) return;
    window.__experience = true;
    const stages = [fieldOfPlay(D), ...tracker(D), touchdown(D)].filter(Boolean);
    heroAtmosphere();
    window.addEventListener("rib:motion", (e) => stages.forEach((s) => s.setMotion(e.detail.on)));
  }
  if (window.__reportMetrics) boot(window.__reportMetrics);
  window.addEventListener("rib:metrics", (e) => boot(e.detail));
})();
