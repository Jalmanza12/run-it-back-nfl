/* ==========================================================================
   common.js — shared helpers for both pages (nav, formatting, identity, tooltip, motion)
   ========================================================================== */
(function () {
  "use strict";
  document.documentElement.classList.remove("no-js");

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------------------------------------------------------------- team metadata
     Primary colours are used only for fallback badges/avatars, never to encode data. */
  const TEAM_COLORS = {
    ARI: "#97233F", ATL: "#A71930", BAL: "#241773", BUF: "#00338D", CAR: "#0085CA", CHI: "#0B162A",
    CIN: "#FB4F14", CLE: "#311D00", DAL: "#041E42", DEN: "#FB4F14", DET: "#0076B6", GB: "#203731",
    HOU: "#03202F", IND: "#002C5F", JAX: "#006778", KC: "#E31837", LA: "#003594", LAC: "#0080C6",
    LV: "#000000", MIA: "#008E97", MIN: "#4F2683", NE: "#002244", NO: "#101820", NYG: "#0B2265",
    NYJ: "#125740", PHI: "#004C54", PIT: "#101820", SEA: "#002244", SF: "#AA0000", TB: "#D50A0A",
    TEN: "#0C2340", WAS: "#5A1414",
  };
  const ESPN_CODE = { WAS: "wsh", LA: "lar" };
  const logoUrl = (t) => `https://a.espncdn.com/combiner/i?img=/i/teamlogos/nfl/500/${ESPN_CODE[t] || t.toLowerCase()}.png&w=80&h=80`;

  /* ---------------------------------------------------------------- formatting */
  const nf = (d) => new Intl.NumberFormat("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  const cache = {};
  function fmt(v, d = 0) {
    if (v === null || v === undefined || Number.isNaN(v)) return "—";
    const f = cache[d] || (cache[d] = nf(d));
    return f.format(v).replace("-", "−");
  }
  function fmtSigned(v, d = 1) { return (v > 0 ? "+" : "") + fmt(v, d); }
  function compact(v) {
    const a = Math.abs(v);
    if (a >= 1e6) return fmt(v / 1e6, a >= 1e7 ? 1 : 2) + "M";
    if (a >= 1e4) return fmt(v / 1e3, 1) + "K";
    return fmt(v, 0);
  }

  /* ---------------------------------------------------------------- DOM helpers */
  function el(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === "class") n.className = v;
      else if (k === "text") n.textContent = v;
      else if (k === "style" && typeof v === "object") Object.assign(n.style, v);
      else n.setAttribute(k, v === true ? "" : v);
    }
    for (const k of kids.flat()) if (k !== null && k !== undefined && k !== false)
      n.appendChild(typeof k === "string" ? document.createTextNode(k) : k);
    return n;
  }

  /** Team logo in a round badge; the coloured abbreviation shows until (and unless) the logo loads. */
  function teamBadge(code, size) {
    const b = el("span", { class: "team-badge", title: code, style: { "--tc": TEAM_COLORS[code] || "#183257" } });
    if (size) { b.style.width = b.style.height = size + "px"; }
    b.appendChild(el("span", { class: "fallback", "aria-hidden": "true", text: code }));
    const img = el("img", { alt: "", decoding: "async" }); // small; eager so it is ready when scrolled into view
    img.addEventListener("load", () => b.classList.add("loaded"));
    img.addEventListener("error", () => img.remove());
    img.src = logoUrl(code);
    b.appendChild(img);
    return b;
  }

  function initials(name) {
    const parts = String(name).replace(/\b(Jr\.?|Sr\.?|II|III|IV)\b/g, "").trim().split(/\s+/);
    return ((parts[0] || "")[0] || "") + ((parts[parts.length - 1] || "")[0] || "");
  }

  // nflverse headshots are full-size (≈3400px) Cloudinary images: request a 120px face crop instead.
  const thumb = (u) => String(u).replace("/f_auto,q_auto/", "/f_auto,q_auto,w_120,h_120,c_thumb,g_face/");

  /** Player headshot; falls back to initials on the team colour if the image is missing or fails. */
  function avatar(name, img, team) {
    const a = el("span", { class: "avatar", style: { "--tc": TEAM_COLORS[team] || "#183257" }, "aria-hidden": "true" },
      initials(name).toUpperCase());
    if (img) {
      const i = el("img", { alt: "", loading: "lazy", decoding: "async", referrerpolicy: "no-referrer" });
      i.addEventListener("load", () => i.classList.add("loaded"));
      i.addEventListener("error", () => i.remove());
      i.src = thumb(img);
      a.appendChild(i);
    }
    return a;
  }

  function posPill(p) { return el("span", { class: "pos-pill " + p, text: p }); }

  /* ---------------------------------------------------------------- tooltip (singleton) */
  let tipEl = null;
  function tip() {
    if (!tipEl) { tipEl = el("div", { class: "tooltip", role: "status", "aria-live": "polite" }); document.body.appendChild(tipEl); }
    return tipEl;
  }
  /** content: a Node (built with el/textContent — never innerHTML with data). */
  function showTip(evt, content) {
    const t = tip();
    t.replaceChildren(content);
    t.classList.add("show");
    moveTip(evt);
  }
  function moveTip(evt) {
    const t = tip();
    let x, y;
    if (evt && evt.clientX !== undefined && (evt.clientX || evt.clientY)) { x = evt.clientX; y = evt.clientY; }
    else if (evt && evt.target && evt.target.getBoundingClientRect) {
      const r = evt.target.getBoundingClientRect(); x = r.left + r.width / 2; y = r.top;
    } else return;
    const w = t.offsetWidth, h = t.offsetHeight, pad = 14;
    let left = x + pad, top = y - h - pad;
    if (left + w > window.innerWidth - 8) left = x - w - pad;
    if (left < 8) left = 8;
    if (top < 8) top = y + pad;
    t.style.left = left + "px"; t.style.top = top + "px";
  }
  function hideTip() { if (tipEl) tipEl.classList.remove("show"); }
  window.addEventListener("scroll", hideTip, { passive: true });

  /** Standard tooltip body: optional title, then value-first rows [{value, label, color, key:'line'|'swatch'}] */
  function tipBody(title, rows, head) {
    const box = el("div");
    if (title) box.appendChild(el("div", { class: "tt-title", text: title }));
    if (head) box.appendChild(head);
    for (const r of rows) {
      const lab = el("span");
      if (r.color) lab.appendChild(el("i", { class: r.key === "swatch" ? "swatch" : "linekey", style: { background: r.color } }));
      lab.appendChild(document.createTextNode(r.label));
      box.appendChild(el("div", { class: "tt-row" }, lab, el("b", { text: r.value })));
    }
    return box;
  }

  /* ---------------------------------------------------------------- motion */
  function countUp(node, value, decimals = 0, opts = {}) {
    const format = opts.format || ((v) => fmt(v, decimals));
    const from = opts.from !== undefined ? opts.from : 0;
    if (reduceMotion || !isFinite(value) || !isFinite(from) || from === value) { node.textContent = format(value); return; }
    const dur = opts.duration || 900, t0 = performance.now();
    cancelAnimationFrame(node._raf);
    const step = (now) => {
      const p = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - p, 3);
      node.textContent = format(from + (value - from) * e);
      if (p < 1) node._raf = requestAnimationFrame(step); else node.textContent = format(value);
    };
    node._raf = requestAnimationFrame(step);
  }

  function observeReveals(root = document) {
    const els = root.querySelectorAll(".reveal:not(.in)");
    if (reduceMotion || !("IntersectionObserver" in window)) { els.forEach((e) => e.classList.add("in")); return; }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => { if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); } });
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });
    els.forEach((e) => io.observe(e));
  }

  /* ---------------------------------------------------------------- nav */
  function initNav() {
    const toggle = document.querySelector(".nav-toggle"), links = document.querySelector(".nav-links");
    if (toggle && links) {
      toggle.addEventListener("click", () => {
        const open = links.classList.toggle("open");
        toggle.setAttribute("aria-expanded", String(open));
      });
      links.addEventListener("click", (e) => {
        if (e.target.closest("a")) { links.classList.remove("open"); toggle.setAttribute("aria-expanded", "false"); }
      });
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && links.classList.contains("open")) { links.classList.remove("open"); toggle.setAttribute("aria-expanded", "false"); toggle.focus(); }
      });
    }
    observeReveals();
  }
  document.addEventListener("DOMContentLoaded", initNav);

  /** Fetch JSON with a readable error message if the page is opened from file:// */
  async function loadJSON(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Could not load ${url} (HTTP ${res.status})`);
    return res.json();
  }
  function showLoadError(container, err) {
    const msg = location.protocol === "file:"
      ? "This page loads its data with fetch(), which browsers block for file:// pages. Run a local server (see README): python3 -m http.server"
      : "The data could not be loaded: " + err.message;
    container.replaceChildren(el("div", { class: "load-error", role: "alert", text: msg }));
  }

  window.RIB = {
    TEAM_COLORS, logoUrl, fmt, fmtSigned, compact, el, teamBadge, avatar, initials, posPill,
    showTip, moveTip, hideTip, tipBody, countUp, observeReveals, reduceMotion, loadJSON, showLoadError,
    POS_COLORS: { QB: "#2563c9", RB: "#e0512b", WR: "#12a071", TE: "#e8a300" },
    NAVY: "#183257", RED: "#d22b3f", MUTED: "#b9c2d0",
  };
})();
