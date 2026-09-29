/* ==========================================================================
   charts.js — reusable D3 chart components shared by the report and dashboard.
   Every component: create(container, opts) -> { update(opts) }.
   Charts redraw on container resize and animate data changes (unless reduced motion).
   Mark specs: 2px lines, >=8px dots w/ surface ring, bars <=28px with 4px rounded data-end,
   hairline solid gridlines, text in ink tokens (never series colour).
   ========================================================================== */
(function () {
  "use strict";
  const { el, fmt, showTip, moveTip, hideTip, tipBody, reduceMotion } = window.RIB;
  const DUR = reduceMotion ? 0 : 550;
  const INK = "#0d1726", INK2 = "#445066", SURFACE = "#ffffff";

  /* ------------------------------------------------------------------ base */
  function base(container, render, opts) {
    const node = typeof container === "string" ? document.querySelector(container) : container;
    node.classList.add("chart");
    const state = { node, opts, first: true, width: 0 };
    const draw = (animate) => {
      const w = Math.floor(node.clientWidth);
      if (!w) return;
      state.width = w;
      render(state, animate && !state.first ? DUR : 0);
      state.first = false;
    };
    if ("ResizeObserver" in window) {
      let t;
      new ResizeObserver(() => {
        if (Math.abs(node.clientWidth - state.width) < 2) return;
        clearTimeout(t); t = setTimeout(() => draw(false), 60);
      }).observe(node);
    } else window.addEventListener("resize", () => draw(false));
    draw(false);
    return { update(o) { state.opts = Object.assign({}, state.opts, o); draw(true); }, node };
  }

  function svgFrame(state, height, margin) {
    const sel = d3.select(state.node);
    let svg = sel.select("svg.plot");
    if (svg.empty()) {
      svg = sel.append("svg").attr("class", "plot").attr("role", "img");
      svg.append("g").attr("class", "grid");
      svg.append("g").attr("class", "axis x");
      svg.append("g").attr("class", "axis y");
      svg.append("g").attr("class", "marks");
      svg.append("g").attr("class", "labels");
      svg.append("g").attr("class", "overlay");
    }
    const W = state.width, H = height;
    svg.attr("width", W).attr("height", H).attr("viewBox", `0 0 ${W} ${H}`);
    if (state.opts.ariaLabel) svg.attr("aria-label", state.opts.ariaLabel);
    svg.selectAll(":scope > g").attr("transform", `translate(${margin.left},${margin.top})`);
    return { svg, iw: W - margin.left - margin.right, ih: H - margin.top - margin.bottom };
  }

  function heightFor(state, def) {
    const h = state.opts.height || def;
    return state.width < 520 ? Math.round(h * 0.86) : h;
  }

  function seasonTicks(xs, iw) {
    const every = iw < 360 ? 3 : iw < 560 ? 2 : 1;
    return xs.filter((_, i) => i % every === 0 || i === xs.length - 1);
  }
  const shortYear = (iw) => (v) => (iw < 480 && typeof v === "number" && v > 1900 ? "’" + String(v).slice(2) : String(v));

  function yAxisLabel(svg, text, margin) {
    let t = svg.select("text.axis-label.yl");
    if (t.empty()) t = svg.append("text").attr("class", "axis-label yl");
    t.attr("x", margin.left - (margin.yLabelInset || margin.left) + 0).attr("y", 13).text(text || "");
  }

  function emptyState(svg, iw, ih, msg) {
    const g = svg.select("g.overlay");
    g.selectAll("text.empty").data(msg ? [msg] : []).join("text").attr("class", "empty")
      .attr("x", iw / 2).attr("y", ih / 2).attr("text-anchor", "middle").text((d) => d);
  }

  // Rounded-top bar path (4px data-end, square at baseline). Works for negative values too.
  function barPath(x, y0, w, y1, r = 4) {
    const h = Math.abs(y1 - y0);
    r = Math.min(r, w / 2, h);
    if (h < 0.5) return `M${x},${y0}h${w}v0h${-w}Z`;
    if (y1 < y0) { // up
      return `M${x},${y0}V${y1 + r}Q${x},${y1} ${x + r},${y1}H${x + w - r}Q${x + w},${y1} ${x + w},${y1 + r}V${y0}Z`;
    }
    return `M${x},${y0}V${y1 - r}Q${x},${y1} ${x + r},${y1}H${x + w - r}Q${x + w},${y1} ${x + w},${y1 - r}V${y0}Z`;
  }

  /* ------------------------------------------------------------------ LINE
     opts: series [{key,label,color,values:[{x,y}]}], yFormat(v), tipFormat(v), yLabel,
           zero (bool, include 0), endLabels (bool), annotations [{x, y, text, dy}], xLabel, height */
  function line(container, opts) {
    return base(container, (state, dur) => {
      const o = state.opts;
      const margin = { top: 26, right: o.endLabels ? 58 : 18, bottom: 30, left: 48 };
      const { svg, iw, ih } = svgFrame(state, heightFor(state, 320), margin);
      const series = o.series.filter((s) => s.values.length);
      const all = series.flatMap((s) => s.values);
      const xs = [...new Set(all.map((d) => d.x))].sort((a, b) => a - b);
      const x = d3.scalePoint().domain(xs).range([0, iw]).padding(0.25);
      let [lo, hi] = d3.extent(all, (d) => d.y);
      if (lo === undefined) { lo = 0; hi = 1; }
      if (o.zero) { lo = Math.min(0, lo); hi = Math.max(0, hi); }
      const pad = (hi - lo) * 0.12 || Math.abs(hi) * 0.1 || 1;
      const y0 = o.zero && lo >= 0 ? 0 : lo >= 0 ? Math.max(0, lo - pad) : lo - pad; // never pad non-negative data below zero
      const y = d3.scaleLinear().domain([y0, hi + pad]).nice(5).range([ih, 0]);
      const yf = o.yFormat || ((v) => fmt(v));
      const t = svg.transition().duration(dur);

      svg.select("g.grid").transition(t).call(d3.axisLeft(y).ticks(5).tickSize(-iw).tickFormat(""));
      svg.select("g.y").transition(t).call(d3.axisLeft(y).ticks(5).tickFormat(yf).tickSizeOuter(0));
      svg.select("g.y").select(".domain").remove();
      svg.select("g.x").attr("transform", `translate(${margin.left},${margin.top + ih})`)
        .call(d3.axisBottom(x).tickValues(seasonTicks(xs, iw)).tickFormat(shortYear(iw)).tickSizeOuter(0));
      yAxisLabel(svg, o.yLabel, { left: margin.left, yLabelInset: margin.left });
      emptyState(svg, iw, ih, series.length ? null : "No data for this selection");

      const gen = d3.line().x((d) => x(d.x)).y((d) => y(d.y)).curve(d3.curveMonotoneX);
      const area = d3.area().x((d) => x(d.x)).y0(ih).y1((d) => y(d.y)).curve(d3.curveMonotoneX);
      const marks = svg.select("g.marks");
      marks.selectAll("path.area").data(o.area && series.length === 1 ? series : [], (s) => s.key)
        .join((e) => e.append("path").attr("class", "area").attr("d", (s) => area(s.values)))
        .attr("fill", (s) => s.color).attr("opacity", 0.09).transition(t).attr("d", (s) => area(s.values));
      marks.selectAll("path.line").data(series, (s) => s.key)
        .join((e) => e.append("path").attr("class", "line").attr("fill", "none").attr("d", (s) => gen(s.values)))
        .attr("stroke", (s) => s.color).attr("stroke-width", (s) => s.width || 2.25)
        .attr("stroke-linejoin", "round").attr("stroke-linecap", "round")
        .transition(t).attr("d", (s) => gen(s.values));
      // small per-season dots on single-series charts, so each data point is visible
      const pts = series.length === 1 && xs.length <= 24 ? series[0].values.slice(1, -1).map((v) => ({ v, c: series[0].color })) : [];
      marks.selectAll("circle.pt").data(pts, (d) => d.v.x)
        .join((e) => e.append("circle").attr("class", "pt").attr("r", 3).attr("cx", (d) => x(d.v.x)).attr("cy", (d) => y(d.v.y)))
        .attr("fill", (d) => d.c).attr("stroke", SURFACE).attr("stroke-width", 1.5)
        .transition(t).attr("cx", (d) => x(d.v.x)).attr("cy", (d) => y(d.v.y));
      // end dots (surface ring)
      const ends = series.flatMap((s) => [s.values[0], s.values[s.values.length - 1]].map((v) => ({ s, v, k: s.key + (v === s.values[0] ? "a" : "b") })));
      marks.selectAll("circle.end").data(ends, (d) => d.k)
        .join((e) => e.append("circle").attr("class", "end").attr("r", 4.5).attr("cx", (d) => x(d.v.x)).attr("cy", (d) => y(d.v.y)))
        .attr("fill", (d) => d.s.color).attr("stroke", SURFACE).attr("stroke-width", 2)
        .transition(t).attr("cx", (d) => x(d.v.x)).attr("cy", (d) => y(d.v.y));

      // labels: first/last values for single series or when asked
      const lab = svg.select("g.labels");
      const lf = o.labelFormat || o.tipFormat || yf;
      const endLab = o.endLabels ? series.flatMap((s) => {
        const a = s.values[0], b = s.values[s.values.length - 1];
        return [{ k: s.key + "a", x: x(a.x) - 8, y: y(a.y), t: lf(a.y), anchor: "end", dy: -10 },
                { k: s.key + "b", x: x(b.x) + 9, y: y(b.y), t: lf(b.y), anchor: "start", dy: 4 }];
      }) : [];
      lab.selectAll("text.dlabel").data(endLab, (d) => d.k)
        .join("text").attr("class", "dlabel").attr("text-anchor", (d) => d.anchor)
        .attr("x", (d) => d.x).attr("y", (d) => d.y + d.dy).text((d) => d.t)
        .attr("text-anchor", (d) => (d.anchor === "end" && d.x < 30 ? "start" : d.anchor))
        .attr("dx", (d) => (d.anchor === "end" && d.x < 30 ? 14 : 0));
      const ann = (o.annotations || []).filter((a) => xs.includes(a.x));
      lab.selectAll("g.ann").data(ann).join((e) => {
        const g = e.append("g").attr("class", "ann");
        g.append("line").attr("class", "annot-line");
        g.append("text").attr("class", "annot");
        return g;
      }).each(function (a) {
        const g = d3.select(this), ax = x(a.x), ay = y(a.y), dy = a.dy || -34;
        const anchor = ax > iw * 0.7 ? "end" : ax < iw * 0.3 ? "start" : "middle";
        g.select("line").attr("x1", ax).attr("x2", ax).attr("y1", ay + (dy < 0 ? -7 : 7)).attr("y2", ay + dy + (dy < 0 ? 4 : -12));
        g.select("text").attr("x", ax).attr("y", ay + dy).attr("text-anchor", anchor).text(a.text);
      });

      // hover: crosshair + one tooltip for every series at that x
      const ov = svg.select("g.overlay");
      let cross = ov.select("line.crosshair");
      if (cross.empty()) cross = ov.append("line").attr("class", "crosshair").style("opacity", 0);
      let hit = ov.select("rect.hit");
      if (hit.empty()) hit = ov.append("rect").attr("class", "hit").attr("fill", "transparent").attr("tabindex", 0);
      hit.attr("width", iw).attr("height", ih);
      const at = (px) => {
        const idx = Math.max(0, Math.min(xs.length - 1, Math.round((px - x(xs[0])) / (x.step() || 1))));
        return xs[idx];
      };
      const tipFor = (xv, evt) => {
        cross.attr("x1", x(xv)).attr("x2", x(xv)).attr("y1", 0).attr("y2", ih).style("opacity", 1);
        const rows = series.map((s) => ({ s, v: s.values.find((d) => d.x === xv) })).filter((r) => r.v)
          .sort((a, b) => b.v.y - a.v.y)
          .map((r) => ({ value: (o.tipFormat || yf)(r.v.y), label: r.s.label, color: r.s.color }));
        showTip(evt, tipBody(o.tipTitle ? o.tipTitle(xv) : String(xv), rows));
      };
      let kIdx = xs.length - 1;
      hit.on("pointermove", (evt) => { const [px] = d3.pointer(evt); tipFor(at(px), evt); })
        .on("pointerleave blur", () => { cross.style("opacity", 0); hideTip(); })
        .on("focus", (evt) => tipFor(xs[kIdx], evt))
        .on("keydown", (evt) => {
          if (evt.key === "ArrowRight") kIdx = Math.min(xs.length - 1, kIdx + 1);
          else if (evt.key === "ArrowLeft") kIdx = Math.max(0, kIdx - 1); else return;
          evt.preventDefault(); tipFor(xs[kIdx], evt);
        });
    }, opts);
  }

  /* ------------------------------------------------------------------ COLUMNS (vertical bars, supports negatives)
     opts: data [{key,label,value,color?,sub?}], yFormat, tipFormat, yLabel, labels: 'all'|'ends'|'none'|'highlight',
           highlight: Set(keys), color, negColor, tipRows(d) */
  function columns(container, opts) {
    return base(container, (state, dur) => {
      const o = state.opts, data = o.data || [];
      const rot = state.width < 560 && data.length > 8 && !o.seasonAxis;
      const margin = { top: 26, right: 12, bottom: rot ? 64 : 30, left: 52 };
      const { svg, iw, ih } = svgFrame(state, heightFor(state, 320), margin);
      const x = d3.scaleBand().domain(data.map((d) => d.key)).range([0, iw]).paddingInner(0.28).paddingOuter(0.15);
      const bw = Math.min(28, x.bandwidth()), off = (x.bandwidth() - bw) / 2;
      const ext = d3.extent(data, (d) => d.value);
      let lo = Math.min(0, ext[0] ?? 0); const hi = Math.max(0, ext[1] ?? 1);
      if (lo < 0 && o.labels && o.labels !== "none") lo -= (hi - lo) * 0.12; // room for labels under negative bars
      const y = d3.scaleLinear().domain([lo, hi === lo ? lo + 1 : hi]).nice(5).range([ih, 0]);
      const yf = o.yFormat || ((v) => fmt(v));
      const t = svg.transition().duration(dur);
      svg.select("g.grid").transition(t).call(d3.axisLeft(y).ticks(5).tickSize(-iw).tickFormat(""));
      svg.select("g.y").transition(t).call(d3.axisLeft(y).ticks(5).tickFormat(yf).tickSizeOuter(0));
      svg.select("g.y").select(".domain").remove();
      const labelOf = new Map(data.map((d) => [d.key, d.label]));
      const every = o.seasonAxis ? Math.max(1, Math.ceil(data.length / Math.max(1, Math.floor(iw / 44)))) : 1;
      const gx = svg.select("g.x").attr("transform", `translate(${margin.left},${margin.top + ih})`)
        .call(d3.axisBottom(x).tickSizeOuter(0).tickValues(data.map((d) => d.key).filter((_, i) => i % every === 0))
          .tickFormat((k) => { const l = String(labelOf.get(k)); return o.seasonAxis ? shortYear(iw)(+l || l) : l.length > 14 ? l.slice(0, 13) + "…" : l; }));
      gx.selectAll("text").attr("transform", rot ? "rotate(-40)" : null).style("text-anchor", rot ? "end" : "middle")
        .attr("dx", rot ? "-.5em" : null).attr("dy", rot ? ".4em" : null);
      // zero baseline
      let zl = svg.select("g.marks").select("line.zero");
      if (zl.empty()) zl = svg.select("g.marks").append("line").attr("class", "zero");
      zl.attr("x1", 0).attr("x2", iw).attr("y1", y(0)).attr("y2", y(0)).attr("stroke", "#9aa4b5").attr("shape-rendering", "crispEdges");
      yAxisLabel(svg, o.yLabel, { left: margin.left, yLabelInset: margin.left });
      emptyState(svg, iw, ih, data.length ? null : "No data for this selection");

      const col = (d) => d.color || (o.highlight && o.highlight.has(d.key) ? "#d22b3f" : d.value < 0 && o.negColor ? o.negColor : o.color || "#183257");
      svg.select("g.marks").selectAll("path.mark").data(data, (d) => d.key)
        .join((e) => e.append("path").attr("class", "mark").attr("d", (d) => barPath(x(d.key) + off, y(0), bw, y(0))))
        .attr("fill", col).attr("tabindex", 0).attr("role", "img")
        .attr("aria-label", (d) => `${d.label}: ${(o.tipFormat || yf)(d.value)}`)
        .on("pointerenter pointermove focus", (evt, d) => showTip(evt, tipBody(o.tipTitle ? o.tipTitle(d) : String(d.label),
          o.tipRows ? o.tipRows(d) : [{ value: (o.tipFormat || yf)(d.value), label: o.valueName || "Value", color: col(d), key: "swatch" }])))
        .on("pointerleave blur", hideTip)
        .transition(t).attr("d", (d) => barPath(x(d.key) + off, y(0), bw, y(d.value)));

      const L = o.labels || "none";
      const lf = o.labelFormat || o.tipFormat || yf;
      const fits = (d) => String(lf(d.value)).length * 7 <= x.step() - 2; // never let direct labels collide
      const lab = data.filter((d, i) => L === "all" ? bw >= 16 && data.every(fits) : L === "ends" ? (i === 0 || i === data.length - 1)
        : L === "highlight" ? (o.highlight && o.highlight.has(d.key)) || i === 0 || i === data.length - 1 : false);
      svg.select("g.labels").selectAll("text.dlabel").data(lab, (d) => d.key)
        .join("text").attr("class", "dlabel").attr("text-anchor", "middle")
        .attr("x", (d) => x(d.key) + x.bandwidth() / 2)
        .text((d) => (o.labelFormat || o.tipFormat || yf)(d.value))
        .transition(t).attr("y", (d) => (d.value >= 0 ? y(d.value) - 7 : y(d.value) + 15));
    }, opts);
  }

  /* ------------------------------------------------------------------ STACKED 100% COLUMNS
     opts: data [{key,label, ...values}], keys [..], colors {key:color}, names {key:label}, yFormat */
  function stacked(container, opts) {
    return base(container, (state, dur) => {
      const o = state.opts, data = o.data || [];
      const margin = { top: 16, right: 12, bottom: 30, left: 44 };
      const { svg, iw, ih } = svgFrame(state, heightFor(state, 340), margin);
      const x = d3.scaleBand().domain(data.map((d) => d.key)).range([0, iw]).paddingInner(0.22).paddingOuter(0.1);
      const bw = Math.min(46, x.bandwidth()), off = (x.bandwidth() - bw) / 2;
      const totals = data.map((d) => d3.sum(o.keys, (k) => d[k] || 0));
      const y = d3.scaleLinear().domain([0, 100]).range([ih, 0]);
      const t = svg.transition().duration(dur);
      svg.select("g.grid").call(d3.axisLeft(y).tickValues([0, 25, 50, 75, 100]).tickSize(-iw).tickFormat(""));
      svg.select("g.y").call(d3.axisLeft(y).tickValues([0, 25, 50, 75, 100]).tickFormat((v) => v + "%").tickSizeOuter(0));
      svg.select("g.y").select(".domain").remove();
      svg.select("g.x").attr("transform", `translate(${margin.left},${margin.top + ih})`)
        .call(d3.axisBottom(x).tickSizeOuter(0).tickValues(seasonTicks(data.map((d) => d.key), iw)).tickFormat((k) => shortYear(iw)(k)));
      const segs = [];
      data.forEach((d, i) => {
        let acc = 0;
        o.keys.forEach((k) => {
          const pct = totals[i] ? (d[k] || 0) / totals[i] * 100 : 0;
          segs.push({ id: d.key + k, row: d, k, y0: acc, y1: acc + pct, pct, raw: d[k] || 0 });
          acc += pct;
        });
      });
      svg.select("g.marks").selectAll("rect.mark").data(segs, (s) => s.id)
        .join((e) => e.append("rect").attr("class", "mark").attr("y", ih).attr("height", 0))
        .attr("x", (s) => x(s.row.key) + off).attr("width", bw).attr("fill", (s) => o.colors[s.k])
        .attr("tabindex", 0)
        .on("pointerenter pointermove focus", (evt, s) => showTip(evt, tipBody(String(s.row.label || s.row.key),
          o.keys.slice().reverse().map((k) => ({ value: fmt(totals[data.indexOf(s.row)] ? s.row[k] / totals[data.indexOf(s.row)] * 100 : 0, 1) + "%",
            label: o.names[k] + (o.rawFormat ? ` (${o.rawFormat(s.row[k] || 0)})` : ""), color: o.colors[k], key: "swatch" })))))
        .on("pointerleave blur", hideTip)
        .transition(t)
        // 2px surface gap between segments
        .attr("y", (s) => y(s.y1) + (s.y1 < 99.99 ? 1 : 0))
        .attr("height", (s) => Math.max(0, y(s.y0) - y(s.y1) - (s.y1 < 99.99 ? 1 : 0) - (s.y0 > 0.01 ? 1 : 0)));
      // direct labels inside the last column only when they fit
      const last = data[data.length - 1];
      const lab = last ? segs.filter((s) => s.row === last && (y(s.y0) - y(s.y1)) > 18 && bw >= 30) : [];
      svg.select("g.labels").selectAll("text.seglabel").data(lab, (s) => s.id).join("text").attr("class", "seglabel")
        .attr("text-anchor", "middle").attr("font-size", 11.5).attr("font-weight", 700)
        .attr("fill", (s) => (o.darkText && o.darkText.includes(s.k) ? INK : "#fff"))
        .attr("x", (s) => x(s.row.key) + x.bandwidth() / 2).attr("y", (s) => (y(s.y0) + y(s.y1)) / 2 + 4)
        .text((s) => fmt(s.pct, 1) + "%");
    }, opts);
  }

  /* ------------------------------------------------------------------ HISTOGRAM
     opts: bins [{x0,x1,count}], color, xLabel, yLabel, markers [{x, label}] */
  function histogram(container, opts) {
    return base(container, (state, dur) => {
      const o = state.opts, bins = o.bins || [];
      const margin = { top: 26, right: 14, bottom: 42, left: 52 };
      const { svg, iw, ih } = svgFrame(state, heightFor(state, 300), margin);
      const x = d3.scaleLinear().domain(bins.length ? [bins[0].x0, bins[bins.length - 1].x1] : [0, 1]).range([0, iw]);
      const y = d3.scaleLinear().domain([0, d3.max(bins, (b) => b.count) || 1]).nice(5).range([ih, 0]);
      const t = svg.transition().duration(dur);
      svg.select("g.grid").transition(t).call(d3.axisLeft(y).ticks(5).tickSize(-iw).tickFormat(""));
      svg.select("g.y").transition(t).call(d3.axisLeft(y).ticks(5).tickFormat((v) => fmt(v)).tickSizeOuter(0));
      svg.select("g.y").select(".domain").remove();
      svg.select("g.x").attr("transform", `translate(${margin.left},${margin.top + ih})`)
        .transition(t).call(d3.axisBottom(x).ticks(Math.max(3, Math.floor(iw / 70))).tickFormat(o.xFormat || ((v) => fmt(v))).tickSizeOuter(0));
      yAxisLabel(svg, o.yLabel || "Player-games", { left: margin.left, yLabelInset: margin.left });
      let xl = svg.select("text.axis-label.xl");
      if (xl.empty()) xl = svg.append("text").attr("class", "axis-label xl").attr("text-anchor", "middle");
      xl.attr("x", margin.left + iw / 2).attr("y", margin.top + ih + 36).text(o.xLabel || "");
      emptyState(svg, iw, ih, bins.some((b) => b.count) ? null : "No data for this selection");
      svg.select("g.marks").selectAll("path.mark").data(bins, (b, i) => i)
        .join((e) => e.append("path").attr("class", "mark"))
        .attr("fill", o.color || "#183257").attr("tabindex", 0)
        .on("pointerenter pointermove focus", (evt, b) => showTip(evt, tipBody(`${(o.xFormat || fmt)(b.x0)} to ${(o.xFormat || fmt)(b.x1)} ${o.unit || ""}`,
          [{ value: fmt(b.count), label: "player-games", color: o.color || "#183257", key: "swatch" },
           { value: fmt(b.share * 100, 1) + "%", label: "of selection" }])))
        .on("pointerleave blur", hideTip)
        .transition(t).attr("d", (b) => {
          const x0 = x(b.x0) + 1, w = Math.max(1, x(b.x1) - x(b.x0) - 2);
          return barPath(x0, ih, w, y(b.count), 3);
        });
      const mk = (o.markers || []).filter((m) => isFinite(m.x));
      const g = svg.select("g.labels").selectAll("g.marker").data(mk, (m) => m.label).join((e) => {
        const gg = e.append("g").attr("class", "marker");
        gg.append("line").attr("stroke", "#d22b3f").attr("stroke-width", 2);
        gg.append("text").attr("class", "dlabel").attr("stroke", "#fff").attr("stroke-width", 4).attr("paint-order", "stroke").attr("stroke-linejoin", "round");
        return gg;
      });
      g.select("line").transition(t).attr("x1", (m) => x(m.x)).attr("x2", (m) => x(m.x)).attr("y1", 0).attr("y2", ih);
      g.select("text").attr("text-anchor", (m) => (x(m.x) > iw * 0.75 ? "end" : "start"))
        .attr("dx", (m) => (x(m.x) > iw * 0.75 ? -6 : 6)).attr("y", (m, i) => 12 + i * 16)
        .text((m) => m.label).transition(t).attr("x", (m) => x(m.x));
    }, opts);
  }

  /* ------------------------------------------------------------------ RANGE PLOT (distribution summary per group)
     opts: rows [{key,label,color,p10,p25,median,p75,p90,mean,n}], xLabel, xFormat */
  function rangePlot(container, opts) {
    return base(container, (state, dur) => {
      const o = state.opts, rows = o.rows || [];
      const margin = { top: 34, right: 20, bottom: 40, left: 52 };
      const rowH = 58;
      const { svg, iw, ih } = svgFrame(state, margin.top + margin.bottom + rows.length * rowH, margin);
      const x = d3.scaleLinear().domain([Math.min(0, d3.min(rows, (r) => r.p10)), d3.max(rows, (r) => r.p90) * 1.08]).nice().range([0, iw]);
      const y = d3.scaleBand().domain(rows.map((r) => r.key)).range([0, ih]).padding(0.35);
      svg.select("g.grid").call(d3.axisBottom(x).ticks(6).tickSize(ih).tickFormat("")).select(".domain").remove();
      svg.select("g.x").attr("transform", `translate(${margin.left},${margin.top + ih})`)
        .call(d3.axisBottom(x).ticks(6).tickFormat(o.xFormat || ((v) => fmt(v))).tickSizeOuter(0));
      svg.select("g.y").call(d3.axisLeft(y).tickSize(0).tickPadding(10)).select(".domain").remove();
      svg.select("g.y").selectAll("text").attr("font-weight", 700).attr("fill", INK).attr("font-size", 13);
      let xl = svg.select("text.axis-label.xl");
      if (xl.empty()) xl = svg.append("text").attr("class", "axis-label xl").attr("text-anchor", "middle");
      xl.attr("x", margin.left + iw / 2).attr("y", margin.top + ih + 34).text(o.xLabel || "");
      // key
      const key = [{ t: "Middle 80% of games", w: 18, h: 3 }, { t: "Middle 50%", w: 18, h: 10 }, { t: "Median", w: 3, h: 14 }, { t: "Average", dot: true }];
      const kg = svg.select("g.overlay").selectAll("g.key").data([0]).join("g").attr("class", "key").attr("transform", "translate(0,-26)");
      let kx = 0;
      kg.selectAll("*").remove();
      key.forEach((k) => {
        if (state.width < 460) k.t = { "Middle 80% of games": "80%", "Middle 50%": "50%", Median: "Median", Average: "Avg" }[k.t] || k.t;
        if (k.dot) kg.append("circle").attr("cx", kx + 5).attr("cy", 0).attr("r", 5).attr("fill", "#fff").attr("stroke", INK).attr("stroke-width", 2);
        else kg.append("rect").attr("x", kx).attr("y", -k.h / 2).attr("width", k.w).attr("height", k.h).attr("rx", 1.5).attr("fill", k.t === "Median" ? INK : "#8d97a8");
        const tx = kg.append("text").attr("class", "annot").attr("x", kx + (k.dot ? 14 : k.w + 6)).attr("y", 4).text(k.t);
        kx += (k.dot ? 14 : k.w + 6) + tx.node().getComputedTextLength() + 16;
      });
      const t = svg.transition().duration(dur);
      const g = svg.select("g.marks").selectAll("g.row").data(rows, (r) => r.key).join((e) => {
        const gg = e.append("g").attr("class", "row");
        gg.append("rect").attr("class", "whisk");
        gg.append("rect").attr("class", "box");
        gg.append("rect").attr("class", "med");
        gg.append("circle").attr("class", "mean");
        gg.append("rect").attr("class", "hit").attr("fill", "transparent").attr("tabindex", 0);
        gg.append("text").attr("class", "dlabel p90");
        return gg;
      }).attr("transform", (r) => `translate(0,${y(r.key)})`);
      const bh = Math.min(22, y.bandwidth());
      const cy = y.bandwidth() / 2;
      g.select(".whisk").attr("fill", (r) => r.color).attr("opacity", 0.45).attr("y", cy - 1.5).attr("height", 3).attr("rx", 1.5)
        .transition(t).attr("x", (r) => x(r.p10)).attr("width", (r) => x(r.p90) - x(r.p10));
      g.select(".box").attr("fill", (r) => r.color).attr("y", cy - bh / 2).attr("height", bh).attr("rx", 4)
        .transition(t).attr("x", (r) => x(r.p25)).attr("width", (r) => Math.max(2, x(r.p75) - x(r.p25)));
      g.select(".med").attr("fill", INK).attr("y", cy - bh / 2 - 3).attr("height", bh + 6).attr("width", 3).attr("rx", 1.5)
        .transition(t).attr("x", (r) => x(r.median) - 1.5);
      g.select(".mean").attr("r", 5.5).attr("fill", "#fff").attr("stroke", INK).attr("stroke-width", 2).attr("cy", cy)
        .transition(t).attr("cx", (r) => x(r.mean));
      g.select(".p10").remove();
      g.select(".p90").attr("text-anchor", "start").attr("y", cy + 4).text((r) => fmt(r.p90, 1)).transition(t).attr("x", (r) => x(r.p90) + 8);
      g.select(".hit").attr("x", 0).attr("width", iw).attr("y", 0).attr("height", y.bandwidth())
        .on("pointerenter pointermove focus", (evt, r) => showTip(evt, tipBody(r.label, [
          { value: fmt(r.mean, 2), label: "Average (mean)" }, { value: fmt(r.median, 1), label: "Median" },
          { value: `${fmt(r.p25, 1)} – ${fmt(r.p75, 1)}`, label: "Middle 50%" },
          { value: `${fmt(r.p10, 1)} – ${fmt(r.p90, 1)}`, label: "Middle 80%" },
          { value: fmt(r.n), label: "Player-games" }])))
        .on("pointerleave blur", hideTip);
    }, opts);
  }

  /* ------------------------------------------------------------------ RANKED BARS (HTML, supports logos/headshots)
     opts: rows [{key, label, sub, value, color, badge:Node|fn, highlight}], format(v), max (optional), tipRows(r), tipHead(r) */
  function ranked(container, opts) {
    const node = typeof container === "string" ? document.querySelector(container) : container;
    node.classList.add("ranked");
    let state = opts;
    function render() {
      const o = state, rows = o.rows || [];
      const vals = rows.map((r) => r.value);
      const hi = Math.max(0, ...vals), lo = Math.min(0, ...vals);
      const span = hi - lo || 1;
      const existing = new Map([...node.children].filter((c) => c.dataset && c.dataset.key).map((c) => [c.dataset.key, c]));
      const frag = [];
      rows.forEach((r, i) => {
        let row = existing.get(String(r.key));
        if (!row) {
          row = el("div", { class: "rk-row", "data-key": String(r.key), tabindex: 0 },
            el("span", { class: "rk-rank" }),
            el("span", { class: "rk-id" }),
            el("span", { class: "rk-track" }, el("span", { class: "rk-bar" })),
            el("span", { class: "rk-val" }));
          row.addEventListener("pointerenter", (e) => row._tip && showTip(e, row._tip()));
          row.addEventListener("pointermove", moveTip);
          row.addEventListener("pointerleave", hideTip);
          row.addEventListener("focus", (e) => row._tip && showTip(e, row._tip()));
          row.addEventListener("blur", hideTip);
        } else existing.delete(String(r.key));
        row.querySelector(".rk-rank").textContent = o.noRank ? "" : String(i + 1);
        const id = row.querySelector(".rk-id");
        const idKids = [];
        if (r.badge) idKids.push(typeof r.badge === "function" ? r.badge() : r.badge);
        idKids.push(el("span", { class: "rk-text" }, el("span", { class: "rk-label", text: r.label }), r.sub ? el("span", { class: "rk-sub", text: r.sub }) : null));
        if (row._id !== r.label + "|" + (r.sub || "")) { id.replaceChildren(...idKids); row._id = r.label + "|" + (r.sub || ""); }
        const bar = row.querySelector(".rk-bar");
        const left = ((Math.min(0, r.value) - lo) / span) * 100, width = (Math.abs(r.value) / span) * 100;
        bar.style.background = r.color || (r.highlight ? "#d22b3f" : "#183257");
        bar.style.left = left + "%";
        if (!row._drawn && !reduceMotion) { bar.style.width = "0%"; requestAnimationFrame(() => requestAnimationFrame(() => (bar.style.width = width + "%"))); }
        else bar.style.width = width + "%";
        row._drawn = true;
        row.querySelector(".rk-val").textContent = (o.format || fmt)(r.value);
        row.classList.toggle("is-hi", !!r.highlight);
        row._tip = () => tipBody(o.tipTitle ? o.tipTitle(r) : null, o.tipRows ? o.tipRows(r) : [{ value: (o.format || fmt)(r.value), label: o.valueName || "Value" }], o.tipHead ? o.tipHead(r) : null);
        row.setAttribute("aria-label", `${i + 1}. ${r.label}${r.sub ? ", " + r.sub : ""}: ${(o.format || fmt)(r.value)}`);
        frag.push(row);
      });
      existing.forEach((n) => n.remove());
      node.replaceChildren(...frag);
      if (!rows.length) node.replaceChildren(el("p", { class: "rk-empty", text: "No data for this selection" }));
    }
    render();
    return { update(o) { state = Object.assign({}, state, o); render(); }, node };
  }

  window.Charts = { line, columns, stacked, histogram, rangePlot, ranked };
})();
