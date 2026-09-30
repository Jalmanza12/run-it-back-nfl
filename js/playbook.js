/* ==========================================================================
   playbook.js — the football engine behind the site's field, play tracker and
   touchdown scenes. Canvas 2D, no dependencies.

   - A pinhole perspective camera (with near-plane clipping) renders a regulation
     NFL field: 5-yard lines, 1-yard hash marks at NFL width (6.17 yd apart),
     sideline ticks, yard numbers + arrows, end zones, goalposts, the blue line of
     scrimmage and the yellow first-down line, under stadium lighting.
   - Players are stylized position markers (no photos). Motion uses Catmull-Rom
     splines through timed keyframes; the ball flies on a real arc with a shadow.
   - Plays are DATA-DRIVEN: a run gains exactly that season's league yards per carry,
     a completed pass gains exactly that season's yards per attempt, and the faint
     "ghost" traces behind a play are one per pass attempt / carry in an average game.
   - Rendering pauses when the canvas is off-screen, the tab is hidden, or motion is
     off (then a static play diagram is drawn instead).
   ========================================================================== */
(function () {
  "use strict";

  const HW = 26.665;                    // half field width (53⅓ yd)
  const HASH = 3.083;                   // NFL hash marks: 18'6" apart → ±3.08 yd from centre
  const NEAR = 0.8;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const EASE = {
    inOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
    out: (t) => 1 - Math.pow(1 - t, 3),
    in: (t) => t * t * t,
  };
  const COLORS = {
    turfA: "#2f7b48", turfB: "#2a7141", apron: "#1d5433", line: "rgba(255,255,255,.88)",
    off: "#183257", offRing: "#d22b3f", def: "#eef1f5", defRing: "#7d889b",
    los: "#3d8bff", first: "#ffd21f", ball: "#7a3a17", gold: "#f5c542",
  };

  /* ---------------------------------------------------------------- keyframe tracks */
  function track(keys, t) {
    const n = keys.length;
    if (t <= keys[0].t) return { x: keys[0].x, z: keys[0].z, moving: false };
    if (t >= keys[n - 1].t) return { x: keys[n - 1].x, z: keys[n - 1].z, moving: false };
    let i = 0;
    while (t > keys[i + 1].t) i++;
    const p0 = keys[Math.max(0, i - 1)], p1 = keys[i], p2 = keys[i + 1], p3 = keys[Math.min(n - 1, i + 2)];
    let u = (t - p1.t) / (p2.t - p1.t);
    if (p1.e) u = EASE[p1.e](u);
    const cr = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * u + (2 * a - 5 * b + 4 * c - d) * u * u + (-a + 3 * b - 3 * c + d) * u * u * u);
    const moving = Math.abs(p2.x - p1.x) + Math.abs(p2.z - p1.z) > 0.05;
    return { x: cr(p0.x, p1.x, p2.x, p3.x), z: cr(p0.z, p1.z, p2.z, p3.z), moving };
  }

  /* ---------------------------------------------------------------- camera */
  function Camera() {
    return { x: 0, y: 27, z: 30, yaw: 0, pitch: 0.7, fov: 0.8, W: 1, H: 1, F: 1, cy: 0.45 };
  }
  function setSize(cam, W, H) {
    cam.W = W; cam.H = H;
    cam.F = (H / 2) / Math.tan(cam.fov / 2);
  }
  function toCam(c, X, Y, Z) {
    const dx = X - c.x, dy = Y - c.y, dz = Z - c.z;
    const cyw = Math.cos(c.yaw), syw = Math.sin(c.yaw);
    const x1 = dx * cyw - dz * syw, z1 = dx * syw + dz * cyw;
    const cp = Math.cos(c.pitch), sp = Math.sin(c.pitch);
    return { x: x1, y: dy * cp + z1 * sp, d: -dy * sp + z1 * cp };
  }
  function scr(c, p) { const s = c.F / p.d; return { x: c.W / 2 + p.x * s, y: c.H * c.cy - p.y * s, s }; }
  function project(c, X, Y, Z) { const p = toCam(c, X, Y, Z); return p.d < NEAR ? null : scr(c, p); }
  // Sutherland–Hodgman against the near plane, then project
  function projPoly(c, pts) {
    const cam = pts.map((p) => toCam(c, p[0], p[1], p[2]));
    const out = [];
    for (let i = 0; i < cam.length; i++) {
      const a = cam[i], b = cam[(i + 1) % cam.length];
      const ain = a.d >= NEAR, bin = b.d >= NEAR;
      if (ain) out.push(a);
      if (ain !== bin) {
        const t = (NEAR - a.d) / (b.d - a.d);
        out.push({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), d: NEAR });
      }
    }
    return out.map((p) => scr(c, p));
  }
  function pathPoly(ctx, c, pts) {
    const q = projPoly(c, pts);
    if (q.length < 3) return false;
    ctx.moveTo(q[0].x, q[0].y);
    for (let i = 1; i < q.length; i++) ctx.lineTo(q[i].x, q[i].y);
    ctx.closePath();
    return true;
  }
  // ground quad from (x0,z0) to (x1,z1)
  const quad = (x0, z0, x1, z1, y = 0) => [[x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1]];
  // screen → ground (y = 0)
  function groundAt(c, sx, sy) {
    const vx = (sx - c.W / 2) / c.F, vy = (c.H * c.cy - sy) / c.F;
    const cyw = Math.cos(c.yaw), syw = Math.sin(c.yaw), cp = Math.cos(c.pitch), sp = Math.sin(c.pitch);
    const R = [cyw, 0, -syw], U = [syw * sp, cp, cyw * sp], Fw = [syw * cp, -sp, cyw * cp];
    const d = [R[0] * vx + U[0] * vy + Fw[0], R[1] * vx + U[1] * vy + Fw[1], R[2] * vx + U[2] * vy + Fw[2]];
    if (d[1] >= -1e-6) return null;
    const t = -c.y / d[1];
    return { x: c.x + d[0] * t, z: c.z + d[2] * t };
  }
  // text lying on the ground: reading direction (rx, rz), "up" of the letters toward (ux, uz)
  function groundText(ctx, c, dpr, text, X, Z, rx, rz, ux, uz, size, fill) {
    const P = project(c, X, 0, Z), A = project(c, X + rx, 0, Z + rz), B = project(c, X - ux, 0, Z - uz);
    if (!P || !A || !B) return;
    ctx.save();
    ctx.setTransform(dpr * (A.x - P.x), dpr * (A.y - P.y), dpr * (B.x - P.x), dpr * (B.y - P.y), dpr * P.x, dpr * P.y);
    ctx.fillStyle = fill; ctx.font = `800 ${size}px "Barlow Condensed", "Arial Narrow", sans-serif`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(text, 0, 0);
    ctx.restore();
  }

  /* ---------------------------------------------------------------- textures */
  let turfPattern = null;
  function turf(ctx) {
    if (turfPattern) return turfPattern;
    const c = document.createElement("canvas"); c.width = c.height = 96;
    const g = c.getContext("2d");
    let seed = 11; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 900; i++) {
      g.fillStyle = rnd() > 0.5 ? "rgba(255,255,255,.07)" : "rgba(0,0,0,.09)";
      g.fillRect(rnd() * 96, rnd() * 96, 1, 1 + rnd() * 2);
    }
    turfPattern = ctx.createPattern(c, "repeat");
    return turfPattern;
  }

  /* ---------------------------------------------------------------- field */
  function drawField(ctx, c, dpr, o) {
    const W = c.W, H = c.H;
    // stadium backdrop
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, "#050c18"); sky.addColorStop(0.35, "#0b1830"); sky.addColorStop(1, "#0a1628");
    ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);
    // stands (far tiers) + crowd texture
    for (let k = 0; k < 4; k++) {
      ctx.beginPath();
      if (pathPoly(ctx, c, [[-60, 1 + k * 3, 122 + k * 5], [60, 1 + k * 3, 122 + k * 5], [60, 4 + k * 3, 125 + k * 5], [-60, 4 + k * 3, 125 + k * 5]])) {
        ctx.fillStyle = k % 2 ? "#15294a" : "#1a3158"; ctx.fill();
      }
    }
    // apron + field + stripes
    ctx.beginPath(); if (pathPoly(ctx, c, quad(-HW - 7, -16, HW + 7, 118))) { ctx.fillStyle = COLORS.apron; ctx.fill(); }
    for (let z = 0; z < 100; z += 5) {
      ctx.beginPath(); if (pathPoly(ctx, c, quad(-HW, z, HW, z + 5))) { ctx.fillStyle = (z / 5) % 2 ? COLORS.turfA : COLORS.turfB; ctx.fill(); }
    }
    // end zones
    const ez = [[-10, 0, o.ezNear || "#183257", o.ezNearText || "RUN IT BACK"], [100, 110, o.ezFar || "#a91d30", o.ezFarText || "RUN IT BACK"]];
    ez.forEach(([z0, z1, col]) => { ctx.beginPath(); if (pathPoly(ctx, c, quad(-HW, z0, HW, z1))) { ctx.fillStyle = col; ctx.fill(); } });
    // turf grain (clipped to the playing surface)
    ctx.save(); ctx.beginPath();
    if (pathPoly(ctx, c, quad(-HW, -10, HW, 110))) { ctx.clip(); ctx.globalAlpha = 0.9; ctx.fillStyle = turf(ctx); ctx.fillRect(0, 0, W, H); }
    ctx.restore();
    ez.forEach(([z0, z1, , txt], i) => groundText(ctx, c, dpr, txt, 0, (z0 + z1) / 2, i ? 1 : -1, 0, 0, i ? 1 : -1, 5.2, "rgba(255,255,255,.9)"));

    // white paint: border, yard lines, hashes, ticks — one path, one fill
    ctx.beginPath();
    pathPoly(ctx, c, quad(-HW - 2, -10, -HW, 110)); pathPoly(ctx, c, quad(HW, -10, HW + 2, 110));
    pathPoly(ctx, c, quad(-HW - 2, -12, HW + 2, -10)); pathPoly(ctx, c, quad(-HW - 2, 110, HW + 2, 112));
    for (let z = 0; z <= 100; z += 5) { const w = z % 100 === 0 ? 0.13 : 0.07; pathPoly(ctx, c, quad(-HW, z - w, HW, z + w)); }
    if (o.detail !== "low") {
      for (let z = 1; z < 100; z++) {
        if (z % 5 === 0) continue;
        const w = 0.05;
        pathPoly(ctx, c, quad(-HASH - 0.33, z - w, -HASH + 0.33, z + w)); pathPoly(ctx, c, quad(HASH - 0.33, z - w, HASH + 0.33, z + w));
        pathPoly(ctx, c, quad(-HW, z - w, -HW + 0.67, z + w)); pathPoly(ctx, c, quad(HW - 0.67, z - w, HW, z + w));
      }
    }
    ctx.fillStyle = COLORS.line; ctx.fill();
    // yard numbers (read from each sideline) + direction arrows
    for (let z = 10; z <= 90; z += 10) {
      const n = String(z <= 50 ? z : 100 - z);
      groundText(ctx, c, dpr, n, -HW + 12, z, 0, 1, -1, 0, 2.6, "rgba(255,255,255,.82)");
      groundText(ctx, c, dpr, n, HW - 12, z, 0, -1, 1, 0, 2.6, "rgba(255,255,255,.82)");
      if (z !== 50 && o.detail !== "low") {
        const dir = z < 50 ? -1 : 1;
        ctx.beginPath();
        [-1, 1].forEach((side) => pathPoly(ctx, c, [[side * (HW - 11.2), 0, z + dir * 1.6], [side * (HW - 11.2) - 0.35, 0, z + dir * 1.1], [side * (HW - 11.2) + 0.35, 0, z + dir * 1.1]]));
        ctx.fillStyle = "rgba(255,255,255,.7)"; ctx.fill();
      }
    }
    // midfield mark
    ctx.beginPath();
    for (let a = 0; a <= 24; a++) { const q = project(c, Math.cos((a / 24) * Math.PI * 2) * 3.2, 0, 50 + Math.sin((a / 24) * Math.PI * 2) * 3.2); if (q) a ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y); }
    ctx.strokeStyle = "rgba(255,255,255,.45)"; ctx.lineWidth = 1.5; ctx.stroke();
    // goalposts
    [-10.3, 110.3].forEach((z) => {
      const seg = (a, b, w) => { const p = project(c, ...a), q = project(c, ...b); if (!p || !q) return; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.lineWidth = Math.max(1.5, w * (p.s + q.s) / 2); ctx.stroke(); };
      ctx.strokeStyle = "#f2c230"; ctx.lineCap = "round";
      seg([0, 0, z + Math.sign(z) * 1.5], [0, 3.33, z + Math.sign(z) * 1.5], 0.25);
      seg([0, 3.33, z + Math.sign(z) * 1.5], [0, 3.33, z], 0.22);
      seg([-3.08, 3.33, z], [3.08, 3.33, z], 0.2);
      seg([-3.08, 3.33, z], [-3.08, 14, z], 0.14); seg([3.08, 3.33, z], [3.08, 14, z], 0.14);
    });
    // broadcast lines: line of scrimmage (blue) + first down (yellow)
    if (o.los !== undefined) {
      const bl = (z, col, w) => { ctx.beginPath(); if (pathPoly(ctx, c, quad(-HW, z - w, HW, z + w, 0.01))) { ctx.fillStyle = col; ctx.fill(); } };
      bl(o.los, "rgba(61,139,255,.28)", 0.35); bl(o.los, COLORS.los, 0.12);
      if (o.firstDown !== undefined && o.firstDown < 100) { bl(o.firstDown, "rgba(255,210,31,.25)", 0.35); bl(o.firstDown, COLORS.first, 0.12); }
    }
    // hovered yard line
    if (o.hoverZ !== null && o.hoverZ !== undefined) {
      ctx.beginPath(); if (pathPoly(ctx, c, quad(-HW, o.hoverZ - 0.35, HW, o.hoverZ + 0.35, 0.02))) { ctx.fillStyle = "rgba(255,255,255,.55)"; ctx.fill(); }
    }
    // stadium light pools + vignette
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    [[0.12, 0.02], [0.88, 0.02], [0.5, -0.05]].forEach(([fx, fy]) => {
      const g = ctx.createRadialGradient(W * fx, H * fy, 0, W * fx, H * fy, Math.max(W, H) * 0.55);
      g.addColorStop(0, "rgba(255,248,230,.20)"); g.addColorStop(1, "rgba(255,248,230,0)");
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    });
    ctx.restore();
    const vg = ctx.createRadialGradient(W / 2, H * 0.55, Math.min(W, H) * 0.3, W / 2, H * 0.55, Math.max(W, H) * 0.8);
    vg.addColorStop(0, "rgba(5,12,24,0)"); vg.addColorStop(1, "rgba(5,12,24,.55)");
    ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
  }

  /* ---------------------------------------------------------------- plays */
  // Offensive + defensive formation (x across, dz relative to the line of scrimmage)
  const FORM = {
    LT: [-2.9, -1.1], LG: [-1.45, -1], C: [0, -0.9], RG: [1.45, -1], RT: [2.9, -1.1],
    QB: [0, -5], RB: [1.6, -5.2], TE: [4.3, -1.1], X: [-20, -0.4], Z: [18, -0.4], SL: [11.5, -1.2],
    DE1: [-3.9, 1], DT1: [-1, 1], DT2: [1.1, 1], DE2: [4.3, 1], LB1: [-4, 5], LB2: [0.6, 5.4], LB3: [4.8, 5],
    CB1: [-19.5, 6.5], CB2: [17.6, 6.5], S1: [-8, 13], S2: [8.5, 13.5],
  };
  const ROLES = { LT: "OL", LG: "OL", C: "OL", RG: "OL", RT: "OL", QB: "QB", RB: "RB", TE: "TE", X: "WR", Z: "WR", SL: "WR",
    DE1: "DL", DT1: "DL", DT2: "DL", DE2: "DL", LB1: "LB", LB2: "LB", LB3: "LB", CB1: "CB", CB2: "CB", S1: "S", S2: "S" };
  const OFF = ["LT", "LG", "C", "RG", "RT", "QB", "RB", "TE", "X", "Z", "SL"];

  // season-level inputs from report_metrics.json
  function seasonInputs(D, season) {
    const at = (arr) => { const r = arr.find((d) => d.season === season); return r ? r.value : arr[arr.length - 1].value; };
    return {
      ypa: at(D.f1.ypa), attPg: at(D.f1.att_pg), ypc: at(D.f5.ypc), carPg: at(D.f5.car_pg),
      sackRate: at(D.f3.sack_rate), givePg: at(D.f4.give_pg), qbShare: at(D.f6.qb_share),
      tdPg: at(D.td.td_pg),
    };
  }

  function buildPlay(name, season, D) {
    const I = seasonInputs(D, season);
    const SNAP = 1.2;
    const P = { name, season, los: 35, togo: 10, snap: SNAP, dur: 5, actors: {}, ball: [], events: [], routes: [], lane: null, ghosts: null, follow: false, color: {} };
    // default keys: everyone starts in formation, small realistic drift after the snap
    const K = (id, pts) => { P.actors[id] = pts.map(([t, x, dz, e]) => ({ t, x, dz, e })); };
    const base = (pass) => {
      Object.entries(FORM).forEach(([id, [x, dz]]) => {
        const r = ROLES[id];
        if (r === "OL") K(id, [[0, x, dz], [SNAP, x, dz], [SNAP + 0.7, x * 1.05, dz + (pass ? -1.1 : 1.2), "out"], [9, x * 1.05, dz + (pass ? -1.3 : 1.6)]]);
        else if (r === "DL") K(id, [[0, x, dz], [SNAP, x, dz], [SNAP + 0.8, x * 0.95, dz - 1.3, "out"], [9, x * 0.9, dz - 1.8]]);
        else if (r === "LB") K(id, [[0, x, dz], [SNAP, x, dz], [SNAP + 1.2, x * 1.1, dz + (pass ? 2.5 : -1.5), "out"], [9, x * 1.1, dz + (pass ? 3 : -2)]]);
        else if (r === "CB") K(id, [[0, x, dz], [SNAP, x, dz], [SNAP + 1.4, x * 0.97, dz + 5, "out"], [9, x * 0.95, dz + 7]]);
        else if (r === "S") K(id, [[0, x, dz], [SNAP, x, dz], [SNAP + 1.6, x * 1.2, dz + 3, "out"], [9, x * 1.25, dz + 4]]);
        else K(id, [[0, x, dz], [9, x, dz]]);
      });
    };
    const ev = (t, text, at, kind) => P.events.push({ t, text, at, kind: kind || "info" });

    switch (name) {
      case "pass": case "home": case "team": {
        P.los = 30; base(true);
        K("QB", [[0, 0, -5], [SNAP, 0, -5], [SNAP + 0.55, 0, -7, "out"], [SNAP + 1, 0, -6.6], [9, 0, -6.6]]);
        const gain = I.ypa, cz = 5;                              // quick in: caught at 5, run to the league YPA
        K("Z", [[0, 18, -0.4], [SNAP, 18, -0.4], [SNAP + 0.7, 18, 3.6, "out"], [SNAP + 1.25, 13.5, 4.8], [SNAP + 1.8, 9.5, cz], [SNAP + 2.5, 7.2, gain, "out"], [9, 7, gain]]);
        K("CB2", [[0, 17.6, 6.5], [SNAP, 17.6, 6.5], [SNAP + 0.9, 17, 6.2], [SNAP + 1.8, 11.5, 7.5], [SNAP + 2.5, 7.9, gain + 0.9, "out"], [9, 7.8, gain + 1]]);
        K("X", [[0, -20, -0.4], [SNAP, -20, -0.4], [SNAP + 2.2, -20, 19, "in"], [9, -19.5, 26]]);
        K("SL", [[0, 11.5, -1.2], [SNAP, 11.5, -1.2], [SNAP + 0.9, 11.5, 5.5, "out"], [SNAP + 1.4, 16, 6], [9, 21, 6.4]]);
        K("TE", [[0, 4.3, -1.1], [SNAP, 4.3, -1.1], [SNAP + 2.4, 6, 13, "out"], [9, 6.5, 15]]);
        K("RB", [[0, 1.6, -5.2], [SNAP, 1.6, -5.2], [SNAP + 1.1, 2.2, -4.5], [SNAP + 2.2, 7.5, -1], [9, 9, 1]]);
        P.routes = ["Z", "X", "SL", "TE", "RB"]; P.target = "Z";
        const tThrow = SNAP + 1.35, tCatch = SNAP + 1.8;
        P.ball = [{ t: 0, holder: "C" }, { t: SNAP, holder: "QB", snap: true }, { t: tThrow, from: "QB", to: "Z", t1: tCatch, apex: 2.2 }, { t: tCatch, holder: "Z" }];
        ev(SNAP, "SNAP", "QB"); ev(tThrow, "THROW", "QB"); ev(tCatch, "CATCH", "Z", "good");
        ev(SNAP + 2.55, `+${gain.toFixed(2)} YDS · LEAGUE YDS/ATTEMPT ${season}`, "Z", "stat");
        P.ghosts = { kind: "pass", n: Math.round(I.attPg), note: `${I.attPg.toFixed(1)} pass attempts per team-game` };
        P.dur = SNAP + 3.6;
        break;
      }
      case "deep": {
        P.los = 22; base(true); P.follow = true;
        K("QB", [[0, 0, -1.2], [SNAP, 0, -1.2], [SNAP + 0.9, 0, -8, "out"], [SNAP + 1.3, 0, -7.5], [9, 0, -7.5]]);
        K("X", [[0, -20, -0.4], [SNAP, -20, -0.4], [SNAP + 1.2, -20, 10, "in"], [SNAP + 2.7, -18.5, 38], [SNAP + 3.3, -17.5, 46, "out"], [9, -17, 47]]);
        K("CB1", [[0, -19.5, 6.5], [SNAP, -19.5, 6.5], [SNAP + 1.2, -19.6, 11], [SNAP + 2.7, -17.2, 35.5], [SNAP + 3.3, -16.8, 44.5, "out"], [9, -16.6, 46]]);
        K("S1", [[0, -8, 13], [SNAP, -8, 13], [SNAP + 2.7, -14.5, 33], [SNAP + 3.3, -16, 45], [9, -16.2, 46]]);
        K("Z", [[0, 18, -0.4], [SNAP, 18, -0.4], [SNAP + 1.6, 18, 12, "out"], [SNAP + 2.2, 14, 14], [9, 11, 15]]);
        K("TE", [[0, 4.3, -1.1], [SNAP, 4.3, -1.1], [SNAP + 1.6, 6, 8], [9, 8, 9]]);
        P.routes = ["X", "Z", "TE"]; P.target = "X";
        const tThrow = SNAP + 1.35, tCatch = SNAP + 2.7;
        P.ball = [{ t: 0, holder: "C" }, { t: SNAP, holder: "QB", snap: true }, { t: tThrow, from: "QB", to: "X", t1: tCatch, apex: 11 }, { t: tCatch, holder: "X" }];
        ev(SNAP, "SNAP", "QB"); ev(tThrow, "DEEP SHOT", "QB"); ev(tCatch, "40+ YARDS", "X", "good");
        P.dur = SNAP + 4.1;
        break;
      }
      case "sack": {
        P.los = 35; base(true);
        K("QB", [[0, 0, -1.2], [SNAP, 0, -1.2], [SNAP + 0.9, 0, -7.2, "out"], [SNAP + 1.55, 0.3, -7.3], [SNAP + 1.62, 0.4, -7.8], [9, 0.4, -7.9]]);
        K("DE2", [[0, 4.3, 1], [SNAP, 4.3, 1], [SNAP + 0.55, 6.6, -1.8, "out"], [SNAP + 1.1, 5, -6], [SNAP + 1.55, 1.1, -7.5, "in"], [9, 0.9, -8.1]]);
        K("RT", [[0, 2.9, -1.1], [SNAP, 2.9, -1.1], [SNAP + 0.7, 4.4, -2.4], [9, 3.6, -3]]);
        ["X", "Z", "SL", "TE"].forEach((id) => { const [x, dz] = FORM[id]; K(id, [[0, x, dz], [SNAP, x, dz], [SNAP + 2, x * 0.95, dz + 12, "out"], [9, x * 0.93, dz + 13]]); });
        P.routes = ["DE2", "X", "Z", "SL", "TE"]; P.rusher = "DE2";
        P.ball = [{ t: 0, holder: "C" }, { t: SNAP, holder: "QB", snap: true }];
        P.down = { QB: SNAP + 1.6, DE2: SNAP + 1.7 };
        ev(SNAP, "SNAP", "QB"); ev(SNAP + 1.1, "PRESSURE", "DE2", "bad"); ev(SNAP + 1.6, "SACK", "QB", "bad");
        ev(SNAP + 2.2, `1 IN ${Math.round(100 / I.sackRate)} DROPBACKS · ${season}`, "QB", "stat");
        P.dur = SNAP + 3.3;
        break;
      }
      case "giveaway": {
        P.los = 40; base(true);
        K("QB", [[0, 0, -5], [SNAP, 0, -5], [SNAP + 0.55, 0, -7, "out"], [9, 0, -6.8]]);
        K("Z", [[0, 18, -0.4], [SNAP, 18, -0.4], [SNAP + 0.7, 18, 4, "out"], [SNAP + 1.3, 13, 6.5], [SNAP + 1.9, 10.5, 8], [9, 10, 8.4]]);
        K("CB2", [[0, 17.6, 6.5], [SNAP, 17.6, 6.5], [SNAP + 1.1, 15.5, 8], [SNAP + 1.8, 11.6, 8.6, "in"], [SNAP + 2.6, 13, -2, "out"], [SNAP + 3.3, 16, -9], [9, 16.5, -10]]);
        K("X", [[0, -20, -0.4], [SNAP, -20, -0.4], [SNAP + 2.2, -20, 18], [9, -20, 20]]);
        K("SL", [[0, 11.5, -1.2], [SNAP, 11.5, -1.2], [SNAP + 1, 11.5, 5], [SNAP + 1.8, 15, 6], [SNAP + 2.8, 15, 0], [9, 15.5, -4]]);
        P.routes = ["Z", "CB2", "X"]; P.target = "CB2";
        const tThrow = SNAP + 1.2, tInt = SNAP + 1.8;
        P.ball = [{ t: 0, holder: "C" }, { t: SNAP, holder: "QB", snap: true }, { t: tThrow, from: "QB", to: "CB2", t1: tInt, apex: 2.4 }, { t: tInt, holder: "CB2", turnover: true }];
        ev(SNAP, "SNAP", "QB"); ev(tThrow, "THROW", "QB"); ev(tInt, "INTERCEPTED", "CB2", "bad"); ev(SNAP + 2.6, "TURNOVER", "CB2", "bad");
        ev(SNAP + 3.3, `${I.givePg.toFixed(2)} GIVEAWAYS PER TEAM-GAME · ${season}`, "CB2", "stat");
        P.dur = SNAP + 4;
        break;
      }
      case "rush": {
        P.los = 35; base(false);
        const gain = I.ypc;                                        // the run gains exactly the league YPC
        K("QB", [[0, 0, -1.2], [SNAP, 0, -1.2], [SNAP + 0.45, 0.6, -3], [SNAP + 1, -0.8, -4.5], [9, -1, -4.8]]);
        K("RB", [[0, 0, -6.2], [SNAP, 0, -6.2], [SNAP + 0.5, 0.7, -3.4], [SNAP + 0.95, 1.9, -0.8], [SNAP + 1.45, 2.3, gain * 0.6], [SNAP + 1.9, 2.4, gain, "out"], [9, 2.4, gain]]);
        K("RG", [[0, 1.45, -1], [SNAP, 1.45, -1], [SNAP + 0.8, 0.6, 1.3, "out"], [9, 0.4, 1.6]]);
        K("RT", [[0, 2.9, -1.1], [SNAP, 2.9, -1.1], [SNAP + 0.8, 4, 1.2, "out"], [9, 4.2, 1.5]]);
        K("TE", [[0, 4.3, -1.1], [SNAP, 4.3, -1.1], [SNAP + 0.8, 5.4, 1.6, "out"], [9, 5.6, 2]]);
        K("LB2", [[0, 0.6, 5.4], [SNAP, 0.6, 5.4], [SNAP + 1.9, 2.2, gain + 0.9, "in"], [9, 2.2, gain + 0.8]]);
        K("LB3", [[0, 4.8, 5], [SNAP, 4.8, 5], [SNAP + 1.9, 3.3, gain + 0.6, "in"], [9, 3.2, gain + 0.5]]);
        P.routes = ["RB"]; P.target = "RB";
        P.lane = { x0: 1.3, x1: 3.3, dz0: -1, dz1: 3.5, t0: SNAP + 0.3, t1: SNAP + 1.6 };
        P.ball = [{ t: 0, holder: "C" }, { t: SNAP, holder: "QB", snap: true }, { t: SNAP + 0.5, holder: "RB" }];
        ev(SNAP, "SNAP", "QB"); ev(SNAP + 0.5, "HANDOFF", "RB"); ev(SNAP + 1.9, `+${gain.toFixed(2)} YDS · LEAGUE YDS/CARRY ${season}`, "RB", "stat");
        P.ghosts = { kind: "rush", n: Math.round(I.carPg), note: `${I.carPg.toFixed(1)} carries per team-game` };
        P.dur = SNAP + 3.1;
        break;
      }
      case "scramble": {
        P.los = 35; base(true);
        K("QB", [[0, 0, -5], [SNAP, 0, -5], [SNAP + 0.6, 0, -7.2, "out"], [SNAP + 1.15, 0.4, -7.4], [SNAP + 1.6, 4.5, -6.8], [SNAP + 2.3, 10, -1.5], [SNAP + 3.1, 13.5, 6.5], [SNAP + 3.5, 15, 9.5, "out"], [9, 15.2, 9.8]]);
        K("DE1", [[0, -3.9, 1], [SNAP, -3.9, 1], [SNAP + 1.2, -1.8, -6.6], [SNAP + 1.8, -0.2, -7.4], [9, 0, -7.5]]);
        K("DE2", [[0, 4.3, 1], [SNAP, 4.3, 1], [SNAP + 1.2, 2.2, -5.9], [SNAP + 1.8, 2.4, -6.5], [9, 3, -6.2]]);
        K("DT2", [[0, 1.1, 1], [SNAP, 1.1, 1], [SNAP + 1.3, 0.5, -5.4], [9, 0.6, -5.8]]);
        K("LB3", [[0, 4.8, 5], [SNAP, 4.8, 5], [SNAP + 1.8, 7, 2.5], [SNAP + 3.4, 14.4, 9.8, "in"], [9, 14.6, 10]]);
        ["X", "Z", "SL", "TE"].forEach((id) => { const [x, dz] = FORM[id]; K(id, [[0, x, dz], [SNAP, x, dz], [SNAP + 2.2, x * 0.95, dz + 13, "out"], [9, x * 0.93, dz + 15]]); });
        P.routes = ["QB"]; P.target = "QB";
        P.ball = [{ t: 0, holder: "C" }, { t: SNAP, holder: "QB", snap: true }];
        ev(SNAP, "SNAP", "QB"); ev(SNAP + 1.2, "POCKET COLLAPSES", "DE1", "bad"); ev(SNAP + 1.9, "QB SCRAMBLE", "QB", "good");
        ev(SNAP + 3.4, `QBs: ${I.qbShare.toFixed(1)}% OF RUSH YDS · ${season}`, "QB", "stat");
        P.dur = SNAP + 4.1;
        break;
      }
      case "te": {
        P.los = 30; base(true);
        K("QB", [[0, 0, -5], [SNAP, 0, -5], [SNAP + 0.55, 0, -7, "out"], [9, 0, -6.8]]);
        K("TE", [[0, 4.3, -1.1], [SNAP, 4.3, -1.1], [SNAP + 0.8, 4.8, 5, "out"], [SNAP + 1.7, 5.4, 12], [SNAP + 2.5, 5.2, 17.5, "out"], [9, 5.2, 18]]);
        K("LB3", [[0, 4.8, 5], [SNAP, 4.8, 5], [SNAP + 1.7, 6.2, 11], [SNAP + 2.5, 5.9, 18.2, "in"], [9, 5.9, 18.4]]);
        K("RB", [[0, 1.6, -5.2], [SNAP, 1.6, -5.2], [SNAP + 1.2, 5, -3], [SNAP + 2.2, 9, -1], [9, 10, 0]]);
        K("X", [[0, -20, -0.4], [SNAP, -20, -0.4], [SNAP + 2.2, -20, 16], [9, -20, 18]]);
        K("Z", [[0, 18, -0.4], [SNAP, 18, -0.4], [SNAP + 1.3, 18, 9], [SNAP + 1.8, 20, 7], [9, 21, 7]]);
        P.routes = ["TE", "RB", "X", "Z"]; P.target = "TE"; P.dim = ["RB"];
        const tThrow = SNAP + 1.25, tCatch = SNAP + 1.7;
        P.ball = [{ t: 0, holder: "C" }, { t: SNAP, holder: "QB", snap: true }, { t: tThrow, from: "QB", to: "TE", t1: tCatch, apex: 3.4 }, { t: tCatch, holder: "TE" }];
        ev(SNAP, "SNAP", "QB"); ev(tThrow, "THROW", "QB"); ev(tCatch, "TE · SEAM", "TE", "good");
        const sh = D.f7.share.find((d) => d.season === season) || D.f7.share[D.f7.share.length - 1];
        ev(SNAP + 2.4, `TEs ${sh.TE.toFixed(1)}% · RBs ${sh.RB.toFixed(1)}% OF TARGETS · ${season}`, "TE", "stat");
        P.dur = SNAP + 3.4;
        break;
      }
      case "touchdown": case "fantasy": {
        P.los = 82; P.togo = 18; base(true); P.follow = true;
        K("QB", [[0, 0, -5], [SNAP, 0, -5], [SNAP + 0.5, 0, -7, "out"], [9, 0, -6.8]]);
        K("Z", [[0, 18, -0.4], [SNAP, 18, -0.4], [SNAP + 0.9, 19, 8, "out"], [SNAP + 1.9, 20.5, 19.5], [SNAP + 2.4, 20, 22.5, "out"], [SNAP + 3.3, 17.5, 24, "out"], [9, 17, 24]]);
        K("CB2", [[0, 17.6, 6.5], [SNAP, 17.6, 6.5], [SNAP + 1, 18.4, 10], [SNAP + 1.9, 19.4, 18.3], [SNAP + 2.4, 19.2, 20.8], [9, 19, 21]]);
        K("X", [[0, -20, -0.4], [SNAP, -20, -0.4], [SNAP + 1, -20, 7], [SNAP + 1.5, -15, 9], [SNAP + 3.3, 13, 21.5], [9, 14.5, 22.5]]);
        K("TE", [[0, 4.3, -1.1], [SNAP, 4.3, -1.1], [SNAP + 1.6, 6, 12], [SNAP + 3.3, 15, 21], [9, 15.5, 22]]);
        P.routes = ["Z", "X", "TE"]; P.target = "Z";
        const tThrow = SNAP + 1.2, tCatch = SNAP + 2.1;
        P.ball = [{ t: 0, holder: "C" }, { t: SNAP, holder: "QB", snap: true }, { t: tThrow, from: "QB", to: "Z", t1: tCatch, apex: 6 }, { t: tCatch, holder: "Z" }];
        P.celebrate = { id: "Z", t: SNAP + 2.5 };
        ev(SNAP, "SNAP", "QB"); ev(tThrow, "THROW", "QB"); ev(tCatch, "CAUGHT", "Z", "good"); ev(SNAP + 2.35, "TOUCHDOWN", "Z", "td");
        ev(SNAP + 3.1, `${I.tdPg.toFixed(2)} TDs PER TEAM-GAME · ${season}`, "Z", "stat");
        P.dur = SNAP + 3.9;
        break;
      }
      case "henry": {
        P.los = 45; P.togo = 10; base(false); P.follow = true;
        K("QB", [[0, 0, -1.2], [SNAP, 0, -1.2], [SNAP + 0.45, -0.6, -3], [SNAP + 1, 1.5, -4.2], [9, 2, -4.5]]);
        K("RB", [[0, 0, -6.2], [SNAP, 0, -6.2], [SNAP + 0.5, -0.4, -3.6], [SNAP + 1, -3.4, -1.5], [SNAP + 1.45, -5.6, 3], [SNAP + 2.1, -6, 14, "in"], [SNAP + 3, -4, 32], [SNAP + 3.8, -2, 50], [SNAP + 4.2, -1, 57, "out"], [9, -1, 58]]);
        K("LB1", [[0, -4, 5], [SNAP, -4, 5], [SNAP + 1.45, -5.3, 4.6], [SNAP + 1.7, -6.4, 3.9], [9, -7.5, 2.6]]);
        K("S1", [[0, -8, 13], [SNAP, -8, 13], [SNAP + 2.3, -6.6, 16.5], [SNAP + 3.8, -3.6, 46], [9, -3, 50]]);
        K("CB1", [[0, -19.5, 6.5], [SNAP, -19.5, 6.5], [SNAP + 2.4, -12, 18], [SNAP + 4.1, -3, 52], [9, -2.6, 53]]);
        P.routes = ["RB"]; P.target = "RB";
        P.lane = { x0: -6.8, x1: -3.8, dz0: -1, dz1: 5, t0: SNAP + 0.4, t1: SNAP + 1.8 };
        P.ball = [{ t: 0, holder: "C" }, { t: SNAP, holder: "QB", snap: true }, { t: SNAP + 0.5, holder: "RB" }];
        P.celebrate = { id: "RB", t: SNAP + 4.2 };
        const h = D.f11.top;
        ev(SNAP, "SNAP", "QB"); ev(SNAP + 0.5, "HANDOFF", "RB"); ev(SNAP + 1.7, "STIFF-ARM · BREAKS FREE", "RB", "good"); ev(SNAP + 4.05, "TOUCHDOWN", "RB", "td");
        ev(SNAP + 4.6, `${h.name.toUpperCase()}: ${h.scrimmage_yards.toLocaleString("en-US")} SCRIMMAGE YDS`, "RB", "stat");
        P.dur = SNAP + 5.3;
        break;
      }
      default: return buildPlay("pass", season, D);
    }
    P.firstDown = P.los + P.togo;
    // absolute field coordinates
    Object.values(P.actors).forEach((keys) => keys.forEach((k) => { k.z = P.los + k.dz; }));
    return P;
  }

  /* ---------------------------------------------------------------- ghost traces (data density) */
  function ghostPaths(g, los, season) {
    let seed = 97 + season; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const out = [];
    for (let i = 0; i < g.n; i++) {
      if (g.kind === "pass") {
        const x0 = [-20, -12, 4.3, 11.5, 18][i % 5] + (rnd() - 0.5) * 2, d1 = 3 + rnd() * 14, brk = (rnd() - 0.5) * 16;
        out.push([[x0, los], [x0 + brk * 0.1, los + d1], [x0 + brk, los + d1 + rnd() * 6]]);
      } else {
        const gap = (rnd() - 0.5) * 12, d = 1 + rnd() * 7;
        out.push([[gap * 0.2, los - 6], [gap * 0.7, los - 0.5], [gap, los + d]]);
      }
    }
    return out;
  }

  /* ---------------------------------------------------------------- stage */
  function createStage(canvas, opts) {
    const ctx = canvas.getContext("2d");
    const cam = Camera();
    const mode = opts.mode || "field";
    if (mode === "tracker") cam.fov = 0.56;          // tighter lens for the small docked insets
    const D = opts.data;
    let dpr = 1, W = 0, H = 0;
    let play = null, season = opts.season || 2025, t = 0, playing = true, loop = opts.loop !== false;
    let motion = opts.motion !== false, visible = false, raf = 0, last = 0;   // IntersectionObserver turns it on
    let hoverZ = null, selected = null, highlight = false, parX = 0, parY = 0, parTX = 0, parTY = 0, dolly = 0, speed = 1;
    let ghosts = [], fired = new Set(), hits = [], camZ = null, doneCb = null;
    const detail = opts.detail || (window.matchMedia("(max-width: 760px)").matches ? "low" : "high");
    const drawStats = { n: 0, ms: 0 };
    let confetti = [];
    function burst(x, y) {           // subtle celebration: ~70 pieces, desktop cinema only
      const cols = ["#d22b3f", "#ffffff", "#f5c542", "#3d8bff"];
      for (let i = 0; i < 70; i++) {
        const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2, v = 220 + Math.random() * 320;
        confetti.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, r: Math.random() * 6, s: 3 + Math.random() * 4, c: cols[i % 4], life: 1.6 + Math.random() * 0.8 });
      }
    }

    function resize() {
      const r = canvas.getBoundingClientRect();
      if (!r.width || !r.height) return;
      dpr = Math.min(window.devicePixelRatio || 1, detail === "low" ? 1.5 : 2);
      W = r.width; H = r.height;
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      // narrower frames (phones) get a tighter lens so the players stay readable
      const aspect = W / H;
      if (mode === "field") cam.fov = aspect < 1.25 ? 0.6 : aspect < 1.6 ? 0.7 : 0.8;
      if (mode === "cinema") cam.fov = aspect < 1.25 ? 0.72 : 0.8;
      setSize(cam, W, H);
      draw();
    }

    // precomputed keyframe arrays (x/z absolute)
    let tracks = {};
    function prepare() {
      tracks = {};
      Object.entries(play.actors).forEach(([id, keys]) => (tracks[id] = keys.map((k) => ({ t: k.t, x: k.x, z: k.z, e: k.e }))));
      ghosts = play.ghosts ? ghostPaths(play.ghosts, play.los, season) : [];
      fired = new Set(); camZ = null;
    }
    const pos = (id, time) => track(tracks[id], time);

    function ballAt(time) {
      let seg = play.ball[0];
      for (const b of play.ball) if (b.t <= time) seg = b;
      if (seg.from) {
        const a = pos(seg.from, seg.t), b = pos(seg.to, seg.t1), u = clamp((time - seg.t) / (seg.t1 - seg.t), 0, 1);
        return { x: lerp(a.x, b.x, u), z: lerp(a.z + 0.4, b.z, u), y: 1.6 + Math.sin(u * Math.PI) * seg.apex - u * 0.3, air: true, u, seg };
      }
      const h = pos(seg.holder, time);
      return { x: h.x + 0.35, z: h.z + (seg.holder === "C" ? 0.45 : 0.2), y: seg.holder === "C" ? 0.25 : 1.05, holder: seg.holder, turnover: !!seg.turnover };
    }

    /* camera per mode, following the ball on long plays */
    function aimCamera(dt) {
      const k = 1 - Math.pow(0.004, dt);                 // smooth parallax toward the pointer
      parX = lerp(parX, parTX, k); parY = lerp(parY, parTY, k);
      const b = ballAt(t);
      let base;
      // broadcast "skycam": high behind the offense, looking downfield
      if (mode === "tracker") base = { y: 30, back: 30, pitch: 0.78 };
      else if (mode === "cinema") base = { y: 17, back: 22, pitch: 0.55 };
      else base = { y: 27 + parY * 3 - dolly * 5, back: 31 - dolly * 7, pitch: 0.7 + parY * 0.04 - dolly * 0.03 };
      let target = play.los - base.back;
      if (play.follow || mode === "cinema") target = Math.max(target, b.z - base.back - 4);
      camZ = camZ === null ? target : lerp(camZ, target, 1 - Math.pow(0.02, dt));
      cam.z = camZ; cam.y = base.y; cam.pitch = base.pitch;
      cam.x = mode === "field" ? parX * 2.2 : 0;
      cam.yaw = mode === "field" ? parX * -0.05 : 0;
      if (mode === "cinema" && b.air) cam.x = lerp(0, b.x * 0.25, b.u || 0);
      return target;
    }

    /* drawing */
    function tag(text, x, y, kind, alpha, scale) {
      ctx.save();
      ctx.globalAlpha = alpha;
      const fs = Math.round((kind === "td" ? 20 : kind === "stat" ? 12 : 12.5) * scale);
      ctx.font = `800 ${fs}px Inter, system-ui, sans-serif`;
      const w = ctx.measureText(text).width + fs * 1.2, h = fs * 1.9;
      let bx = clamp(x - w / 2, 6, W - w - 6), by = clamp(y - h, 6, H - h - 6);
      const bg = { bad: "#d22b3f", good: "#0f7a4c", td: "#d22b3f", stat: "rgba(6,15,29,.9)", info: "rgba(6,15,29,.85)" }[kind];
      ctx.fillStyle = bg;
      ctx.beginPath(); ctx.roundRect(bx, by, w, h, 6); ctx.fill();
      if (kind === "stat") { ctx.fillStyle = COLORS.first; ctx.fillRect(bx, by, 4, h); }
      ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(text, bx + w / 2 + (kind === "stat" ? 2 : 0), by + h / 2 + 1);
      ctx.restore();
    }

    function drawPolyline(pts, color, width, alpha, dash) {
      const proj = pts.map((p) => project(cam, p[0], 0.05, p[1])).filter(Boolean);
      if (proj.length < 2) return null;
      ctx.save();
      ctx.globalAlpha = alpha; ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineCap = "round"; ctx.lineJoin = "round";
      if (dash) ctx.setLineDash(dash);
      ctx.beginPath(); ctx.moveTo(proj[0].x, proj[0].y);
      for (let i = 1; i < proj.length; i++) ctx.lineTo(proj[i].x, proj[i].y);
      ctx.stroke(); ctx.restore();
      return proj;
    }
    function arrowHead(proj, color, alpha) {
      if (!proj || proj.length < 2) return;
      const a = proj[proj.length - 2], b = proj[proj.length - 1], ang = Math.atan2(b.y - a.y, b.x - a.x), s = 7;
      ctx.save(); ctx.globalAlpha = alpha; ctx.fillStyle = color;
      ctx.beginPath(); ctx.moveTo(b.x + Math.cos(ang) * s, b.y + Math.sin(ang) * s);
      ctx.lineTo(b.x + Math.cos(ang + 2.5) * s, b.y + Math.sin(ang + 2.5) * s); ctx.lineTo(b.x + Math.cos(ang - 2.5) * s, b.y + Math.sin(ang - 2.5) * s);
      ctx.fill(); ctx.restore();
    }
    function sampleRoute(id, t0, t1) {
      const out = [];
      for (let s = t0; s <= t1 + 1e-6; s += 0.06) { const p = pos(id, s); out.push([p.x, p.z]); }
      return out;
    }

    function draw() {
      if (!W || !play) return;
      const t0 = performance.now();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const static_ = !motion;
      drawField(ctx, cam, dpr, { los: play.los, firstDown: play.firstDown, hoverZ, detail, ezFarText: "RUN IT BACK", ezNearText: "2015 · 2025" });
      // ghost traces — one per attempt/carry in an average game that season
      const ghostA = mode === "tracker" ? 0.1 : 0.16;
      ghosts.forEach((g) => drawPolyline(g, "#ffffff", 1, ghostA));
      // rushing lane
      if (play.lane && (static_ || (t >= play.lane.t0 && t <= play.lane.t1 + 0.8))) {
        const L = play.lane, a = static_ ? 0.35 : clamp(Math.min((t - L.t0) / 0.3, (L.t1 + 0.8 - t) / 0.5), 0, 1) * 0.45;
        ctx.save(); ctx.globalAlpha = a; ctx.beginPath();
        if (pathPoly(ctx, cam, quad(L.x0, play.los + L.dz0, L.x1, play.los + L.dz1, 0.03))) {
          const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, "rgba(95,212,155,.0)"); g.addColorStop(1, "rgba(95,212,155,.9)");
          ctx.fillStyle = "#5fd49b"; ctx.fill();
        }
        ctx.restore();
      }
      // routes: telestrator pre-snap, then trails behind the runners
      const emph = highlight ? 1.35 : 1;
      play.routes.forEach((id) => {
        const off = OFF.includes(id), dim = play.dim && play.dim.includes(id);
        const col = off ? (id === play.target ? COLORS.first : "#ffffff") : "#ff6b7d";
        const full = sampleRoute(id, play.snap, play.dur - 0.3);
        if (static_ || t < play.snap) {
          const k = static_ ? 1 : clamp(t / (play.snap * 0.9), 0, 1);
          const part = full.slice(0, Math.max(2, Math.round(full.length * k)));
          const pr = drawPolyline(part, col, 2.4 * emph, (dim ? 0.35 : 0.85), [6, 5]);
          if (k >= 1) arrowHead(pr, col, dim ? 0.35 : 0.9);
        } else {
          drawPolyline(full, col, 1.4, 0.18, [4, 6]);
          const tr = sampleRoute(id, play.snap, Math.min(t, play.dur - 0.3));
          drawPolyline(tr, col, 5 * emph, 0.16);
          drawPolyline(tr, col, 2.6 * emph, dim ? 0.45 : 0.95);
        }
      });
      // players (far → near)
      const tt = static_ ? 0 : t;
      const b = ballAt(tt);
      const carrier = !static_ && !b.air ? b.holder : null;
      const list = Object.keys(tracks).map((id) => ({ id, p: pos(id, tt) }));
      list.sort((a, c) => c.p.z - a.p.z);
      hits = [];
      list.forEach(({ id, p }) => {
        const g = project(cam, p.x, 0, p.z); if (!g) return;
        const role = ROLES[id], off = OFF.includes(id);
        const r = clamp(0.78 * g.s, 3, 26);
        const down = play.down && play.down[id] !== undefined && tt >= play.down[id];
        const cel = play.celebrate && play.celebrate.id === id && tt >= play.celebrate.t;
        const lift = down ? 0.25 : 1.05 + (p.moving && motion ? Math.abs(Math.sin(tt * 14 + p.x)) * 0.12 : 0) + (cel ? Math.abs(Math.sin(tt * 9)) * 0.9 : 0);
        const body = project(cam, p.x, lift, p.z); if (!body) return;
        // shadow
        ctx.fillStyle = "rgba(0,0,0,.38)";
        ctx.beginPath(); ctx.ellipse(g.x, g.y, r * 1.05, r * 0.42, 0, 0, Math.PI * 2); ctx.fill();
        const isC = carrier === id, sel = selected === id;
        const focus = play.target === id || play.rusher === id;
        // ring glow for ball carrier / selection
        if (isC || sel) { ctx.fillStyle = isC ? "rgba(245,197,66,.35)" : "rgba(255,255,255,.35)"; ctx.beginPath(); ctx.arc(body.x, body.y, r * 1.55, 0, Math.PI * 2); ctx.fill(); }
        const turnoverSide = b.turnover && !off;
        const grad = ctx.createRadialGradient(body.x - r * 0.35, body.y - r * 0.4, r * 0.2, body.x, body.y, r);
        if (off) { grad.addColorStop(0, "#2d5391"); grad.addColorStop(1, COLORS.off); } else { grad.addColorStop(0, "#ffffff"); grad.addColorStop(1, turnoverSide ? "#ffe3e7" : "#cfd6e2"); }
        ctx.fillStyle = grad;
        ctx.beginPath();
        if (down) ctx.ellipse(body.x, body.y, r * 1.15, r * 0.6, 0.4, 0, Math.PI * 2); else ctx.arc(body.x, body.y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.lineWidth = Math.max(1.2, r * 0.16);
        ctx.strokeStyle = isC ? COLORS.gold : off ? (focus ? COLORS.first : COLORS.offRing) : (focus ? "#d22b3f" : COLORS.defRing);
        ctx.stroke();
        if (r > 7 && role !== "OL" && role !== "DL" || (r > 10)) {
          ctx.fillStyle = off ? "#fff" : "#0d1726";
          ctx.font = `800 ${Math.round(r * 0.78)}px Inter, system-ui, sans-serif`;
          ctx.textAlign = "center"; ctx.textBaseline = "middle";
          ctx.fillText(role === "OL" || role === "DL" ? "" : role, body.x, body.y + 0.5);
        }
        hits.push({ id, role, off, x: body.x, y: body.y, r: Math.max(r, 12) });
      });
      // football + in-air trail
      const bp = project(cam, b.x, 0, b.z), bb = project(cam, b.x, b.y, b.z);
      if (bp && bb) {
        const br = Math.max(2.5, 0.42 * bb.s);
        ctx.fillStyle = "rgba(0,0,0,.35)"; ctx.beginPath(); ctx.ellipse(bp.x, bp.y, br, br * 0.4, 0, 0, Math.PI * 2); ctx.fill();
        if (b.air && motion) {
          const tr = [];
          for (let k = 8; k >= 0; k--) { const bt = ballAt(Math.max(b.seg.t, t - k * 0.035)); const q = project(cam, bt.x, bt.y, bt.z); if (q) tr.push(q); }
          ctx.strokeStyle = "rgba(255,255,255,.5)"; ctx.lineWidth = br * 0.8; ctx.lineCap = "round";
          ctx.beginPath(); tr.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y))); ctx.stroke();
        }
        if (static_ && play.ball.some((s) => s.from)) {  // dashed ball path in the static diagram
          const s = play.ball.find((x) => x.from), pts = [];
          for (let k = 0; k <= 16; k++) { const bt = ballAt(s.t + (s.t1 - s.t) * (k / 16)); const q = project(cam, bt.x, bt.y, bt.z); if (q) pts.push(q); }
          ctx.save(); ctx.setLineDash([3, 4]); ctx.strokeStyle = "rgba(245,197,66,.9)"; ctx.lineWidth = 2;
          ctx.beginPath(); pts.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y))); ctx.stroke(); ctx.restore();
        }
        ctx.save(); ctx.translate(bb.x, bb.y); ctx.rotate(b.air ? -0.5 : -0.2);
        ctx.fillStyle = COLORS.ball; ctx.beginPath(); ctx.ellipse(0, 0, br * 1.25, br * 0.78, 0, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = "#fff"; ctx.lineWidth = Math.max(1, br * 0.2); ctx.beginPath(); ctx.moveTo(-br * 0.45, 0); ctx.lineTo(br * 0.45, 0); ctx.stroke();
        ctx.restore();
      }
      // broadcast tags
      if (!static_) {
        play.events.forEach((e) => {
          const age = t - e.t; if (age < 0) return;
          if (mode === "cinema" && (e.kind === "td" || e.kind === "stat")) { if (!fired.has(e)) { fired.add(e); opts.onEvent && opts.onEvent(e, P()); if (e.kind === "td" && detail !== "low") { const pp = pos(e.at, e.t); const qq = project(cam, pp.x, 2.2, pp.z); if (qq) burst(qq.x, qq.y); } } return; } // the page overlay owns this moment
          const life = e.kind === "stat" ? 99 : e.kind === "td" ? 2.4 : 1.1;
          if (age > life) return;
          const a = clamp(Math.min(age / 0.15, (life - age) / 0.3), 0, 1);
          const p = pos(e.at, e.t + Math.min(age, 0.4)); const q = project(cam, p.x, 2.2, p.z); if (!q) return;
          const pop = e.kind === "td" ? 1 + 0.25 * Math.max(0, 1 - age / 0.25) : 1;
          tag(e.text, q.x, q.y - (e.kind === "stat" ? 18 : 6), e.kind, a, (mode === "tracker" ? 0.8 : 1) * pop);
          if (!fired.has(e)) {
            fired.add(e); opts.onEvent && opts.onEvent(e, P());
            if (e.kind === "td" && mode === "cinema" && detail !== "low") burst(q.x, q.y);
          }
        });
      } else {
        const st = play.events.find((e) => e.kind === "stat");
        if (st) { const p = pos(st.at, play.dur); const q = project(cam, p.x, 2.2, p.z); if (q) tag(st.text, q.x, q.y - 18, "stat", 1, mode === "tracker" ? 0.8 : 1); }
      }
      // confetti
      if (confetti.length) {
        confetti.forEach((c) => { ctx.save(); ctx.globalAlpha = clamp(c.life, 0, 1); ctx.translate(c.x, c.y); ctx.rotate(c.r); ctx.fillStyle = c.c; ctx.fillRect(-c.s / 2, -c.s / 4, c.s, c.s / 2); ctx.restore(); });
      }
      // yard-line hover label
      if (hoverZ !== null) {
        const q = project(cam, HW - 1, 0.1, hoverZ);
        if (q) { const yl = hoverZ <= 50 ? hoverZ : 100 - hoverZ; const side = hoverZ === 50 ? "MIDFIELD" : (hoverZ < 50 ? "OWN " : "OPP ") + yl;
          const toGo = hoverZ > play.los ? ` · ${(hoverZ - play.los).toFixed(0)} YDS PAST LOS` : hoverZ < play.los ? ` · ${(play.los - hoverZ).toFixed(0)} YDS BEHIND LOS` : " · LINE OF SCRIMMAGE";
          tag(side + toGo, q.x - 60, q.y, "info", 1, 0.9); }
      }
      drawStats.ms = drawStats.ms * 0.95 + (performance.now() - t0) * 0.05; drawStats.n++;
    }
    const P = () => ({ play: play.name, season, t });

    function frame(now) {
      raf = 0;
      if (!play || !visible || document.hidden) return;
      const dt = Math.min(0.05, (now - (last || now)) / 1000); last = now;
      if (motion && playing) {
        let sp = speed;
        if (mode === "cinema" && play.ball.some((b) => b.from)) { // brief slow motion around the catch
          const s = play.ball.find((b) => b.from); if (t > s.t1 - 0.35 && t < s.t1 + 0.25) sp *= 0.4;
        }
        t += dt * sp;
        confetti.forEach((c) => { c.vy += 520 * dt; c.vx *= 0.99; c.x += c.vx * dt; c.y += c.vy * dt; c.r += dt * 8; c.life -= dt; });
        confetti = confetti.filter((c) => c.life > 0 && c.y < H + 20);
        if (t > play.dur + (opts.hold !== undefined ? opts.hold : 1.3)) {
          if (loop) { t = 0; fired = new Set(); camZ = null; }
          else { t = play.dur + (opts.hold || 1.3); playing = false; doneCb && doneCb(); }
        }
      }
      const tgt = aimCamera(dt || 0.016);
      draw();
      if (motion && playing) raf = requestAnimationFrame(frame);
      else if (motion && (Math.abs(camZ - tgt) > 0.05 || Math.abs(parX - parTX) + Math.abs(parY - parTY) > 0.003)) raf = requestAnimationFrame(frame); // finish easing, then idle
    }
    function kick() { if (!raf && visible && !document.hidden) { last = 0; raf = requestAnimationFrame(frame); } }
    const redraw = () => { if (!play) return; if (!motion || !playing) { aimCamera(1); draw(); } else kick(); };

    // interaction: hover yard lines, click players, parallax
    if (opts.interactive) {
      canvas.addEventListener("pointermove", (e) => {
        const r = canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
        const gp = groundAt(cam, x, y);
        let hz = null;
        if (gp && Math.abs(gp.x) <= HW && gp.z >= 0 && gp.z <= 100) { const n = Math.round(gp.z / 5) * 5; if (Math.abs(gp.z - n) < 1.4) hz = n; }
        const over = hits.find((h) => Math.hypot(h.x - x, h.y - y) <= h.r);
        canvas.style.cursor = over ? "pointer" : "default";
        if (hz !== hoverZ) { hoverZ = hz; redraw(); }
      });
      canvas.addEventListener("pointerleave", () => { hoverZ = null; redraw(); });
      canvas.addEventListener("click", (e) => {
        const r = canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
        const h = hits.slice().reverse().find((q) => Math.hypot(q.x - x, q.y - y) <= q.r);
        selected = h ? h.id : null;
        opts.onPlayerClick && opts.onPlayerClick(h ? { id: h.id, role: h.role, offense: h.off } : null, { x: h ? h.x : x, y: h ? h.y : y });
        redraw();
      });
    }

    new IntersectionObserver(([en]) => { visible = en.isIntersecting; if (visible) { resize(); kick(); } }, { threshold: 0.02 }).observe(canvas);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) kick(); });
    new ResizeObserver(() => resize()).observe(canvas);

    const api = {
      setPlay(name, s, o = {}) {
        if (s) season = s;
        play = buildPlay(name, season, D); prepare();
        t = o.start !== undefined ? o.start : 0; playing = o.autoplay !== false; loop = o.loop !== undefined ? o.loop : loop;
        doneCb = o.onDone || null;
        if (motion && playing) kick(); else redraw();
        return api;
      },
      setSeason(s) { if (play && s !== season) { season = s; const n = play.name; play = buildPlay(n, season, D); prepare(); t = 0; playing = true; motion ? kick() : redraw(); } },
      replay() { t = 0; fired = new Set(); camZ = null; confetti = []; playing = true; motion ? kick() : redraw(); },
      pause() { playing = false; redraw(); }, resume() { playing = true; kick(); },
      setMotion(on) { motion = on; if (!on) { cancelAnimationFrame(raf); raf = 0; } redraw(); if (on) { playing = true; kick(); } },
      setHighlight(on) { highlight = on; redraw(); },
      setParallax(x, y) { parTX = x; parTY = y; if (!motion) { parX = x; parY = y; } if (mode === "field") (motion ? kick() : redraw()); },
      setDolly(v) { dolly = v; if (mode === "field") kick(); },
      select(id) { selected = id; redraw(); },
      playerScreen(id) { const h = hits.find((q) => q.id === id); return h ? { x: h.x, y: h.y } : null; },
      resize,
      get playing() { return playing && motion; },
      state() { return { play: play && play.name, season, t: +t.toFixed(2), dur: play && play.dur, playing: playing && motion, motion, ghosts: ghosts.length, events: [...fired].map((e) => e.text), ms: +drawStats.ms.toFixed(2), frames: drawStats.n, selected }; },
      play: () => play,
    };
    return api;
  }

  window.Playbook = { createStage, buildPlay, seasonInputs, ROLES };
})();
