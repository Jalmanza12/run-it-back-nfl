/* ==========================================================================
   field3d.js — "3D Stadium": the 32 teams as columns standing on a football field.
   Everything is modelled in code (field, end zones, goalposts, stands, columns).
   Column height = the dashboard's current measure; colour = same sequential scale
   as the 2D team map. Linked to the dashboard filters through update().

   Honesty rules: heights start at zero by default ("From zero"). The "Zoomed" mode
   stretches the min→max range and is labelled as such in the UI. Exact values are
   always in the tooltip, the value labels, the 2D team map and the data table.
   ========================================================================== */
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const FIELD_X = 50, END = 10, HALF_W = 26.65; // yards
const MAX_H = 17;

/* ---------------------------------------------------------------- field texture */
function fieldTexture() {
  const W = 2400, H = Math.round(W * (2 * HALF_W) / (2 * (FIELD_X + END)));
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  const g = c.getContext("2d");
  const px = W / (2 * (FIELD_X + END));             // pixels per yard
  const X = (yd) => (yd + FIELD_X + END) * px;       // field x (yards, -60..60) → canvas x
  // turf stripes (every 5 yards)
  for (let yd = -FIELD_X; yd < FIELD_X; yd += 5) {
    g.fillStyle = ((yd + 50) / 5) % 2 ? "#2c7a47" : "#317f4c";
    g.fillRect(X(yd), 0, 5 * px + 1, H);
  }
  // end zones
  const ez = [["AFC", "#183257", -FIELD_X - END], ["NFC", "#a91d30", FIELD_X]];
  ez.forEach(([t, col, x0]) => {
    g.fillStyle = col; g.fillRect(X(x0), 0, END * px, H);
    g.save(); g.translate(X(x0 + END / 2), H / 2); g.rotate(x0 < 0 ? -Math.PI / 2 : Math.PI / 2);
    g.fillStyle = "rgba(255,255,255,.92)"; g.font = `800 ${Math.round(px * 7)}px "Barlow Condensed", Arial Narrow, sans-serif`;
    g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(t, 0, 0); g.restore();
  });
  // lines
  g.strokeStyle = "rgba(255,255,255,.85)";
  for (let yd = -FIELD_X; yd <= FIELD_X; yd += 5) {
    g.lineWidth = Math.abs(yd) === FIELD_X ? px * 0.5 : px * 0.18;
    g.beginPath(); g.moveTo(X(yd), 0); g.lineTo(X(yd), H); g.stroke();
  }
  // hash marks + sideline ticks
  g.lineWidth = px * 0.12;
  for (let yd = -FIELD_X + 1; yd < FIELD_X; yd++) {
    if (yd % 5 === 0) continue;
    [0.02, 0.38, 0.62, 0.98].forEach((f) => { g.beginPath(); g.moveTo(X(yd), H * f - px * 0.6); g.lineTo(X(yd), H * f + px * 0.6); g.stroke(); });
  }
  // yard numbers
  g.fillStyle = "rgba(255,255,255,.8)"; g.font = `700 ${Math.round(px * 2.6)}px "Barlow Condensed", Arial Narrow, sans-serif`;
  g.textAlign = "center"; g.textBaseline = "middle";
  for (let yd = -40; yd <= 40; yd += 10) {
    const n = String(50 - Math.abs(yd));
    [[H * 0.16, 0], [H * 0.84, Math.PI]].forEach(([y, rot]) => { g.save(); g.translate(X(yd), y); g.rotate(rot); g.fillText(n, 0, 0); g.restore(); });
  }
  // sideline border
  g.strokeStyle = "#fff"; g.lineWidth = px * 0.6; g.strokeRect(X(-FIELD_X - END), 0, (2 * (FIELD_X + END)) * px, H);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* ---------------------------------------------------------------- sprites */
function textSprite(text, { size = 64, color = "#fff", bg = "rgba(10,22,40,.82)", w = 256, h = 96 } = {}) {
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  s.userData.draw = (t) => {
    const g = c.getContext("2d"); g.clearRect(0, 0, w, h);
    g.font = `800 ${size}px Inter, system-ui, sans-serif`;
    const tw = Math.min(w - 8, g.measureText(t).width + 28);
    g.fillStyle = bg; const x = (w - tw) / 2, r = 18;
    g.beginPath(); g.roundRect(x, 8, tw, h - 16, r); g.fill();
    g.fillStyle = color; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(t, w / 2, h / 2 + 2);
    tex.needsUpdate = true;
  };
  s.userData.draw(text);
  s.scale.set(6, 6 * h / w, 1);
  return s;
}
function badgeSprite(code, color, logoUrl) {
  const c = document.createElement("canvas"); c.width = c.height = 128;
  const g = c.getContext("2d");
  const drawBase = () => { g.clearRect(0, 0, 128, 128); g.fillStyle = "#fff"; g.beginPath(); g.arc(64, 64, 62, 0, Math.PI * 2); g.fill(); };
  drawBase();
  g.fillStyle = color; g.beginPath(); g.arc(64, 64, 56, 0, Math.PI * 2); g.fill();
  g.fillStyle = "#fff"; g.font = "800 40px Inter, system-ui, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(code, 64, 67);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const img = new Image(); img.crossOrigin = "anonymous";
  img.onload = () => { drawBase(); g.drawImage(img, 14, 14, 100, 100); tex.needsUpdate = true; s.userData.onLoad && s.userData.onLoad(); };
  img.src = logoUrl;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  s.scale.set(4.4, 4.4, 1);
  return s;
}

/* ---------------------------------------------------------------- scene */
export function createField3D(container, opts) {
  const { teams, teamColor, logoUrl, onHover, onClick } = opts;
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" }); }
  catch (e) { return null; }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor(0x0a1628);
  container.appendChild(renderer.domElement);
  renderer.domElement.setAttribute("role", "img");
  renderer.domElement.setAttribute("aria-label", "3D view of the 32 teams as columns on a football field; heights show the selected measure. The same numbers are in the team map and table.");

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x0a1628, 170, 320);
  const camera = new THREE.PerspectiveCamera(38, 1, 1, 600);
  const HOME = new THREE.Vector3(0, 92, 84);
  camera.position.copy(HOME);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 2, 0);
  controls.enableDamping = true; controls.dampingFactor = 0.08;
  controls.enablePan = false; controls.enableZoom = false;   // page scroll stays page scroll; zoom via buttons
  controls.minPolarAngle = 0.25; controls.maxPolarAngle = 1.36;
  controls.minDistance = 40; controls.maxDistance = 190;
  controls.autoRotateSpeed = 0.7;
  controls.update();

  // lights
  scene.add(new THREE.HemisphereLight(0xcfe0ff, 0x0b1a10, 0.9));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(-40, 90, 50); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -75, right: 75, top: 45, bottom: -45, near: 10, far: 250 });
  sun.shadow.bias = -0.0005;
  scene.add(sun);
  const rim = new THREE.DirectionalLight(0xff4058, 0.7); rim.position.set(60, 30, -60); scene.add(rim);

  // ground, field, stands
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(420, 320), new THREE.MeshStandardMaterial({ color: 0x0c1c33, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -0.05; ground.receiveShadow = true; scene.add(ground);
  const field = new THREE.Mesh(new THREE.PlaneGeometry(2 * (FIELD_X + END), 2 * HALF_W), new THREE.MeshStandardMaterial({ map: fieldTexture(), roughness: 0.95 }));
  field.material.map.anisotropy = renderer.capabilities.getMaxAnisotropy();
  field.rotation.x = -Math.PI / 2; field.receiveShadow = true; scene.add(field);
  const standMat = new THREE.MeshStandardMaterial({ color: 0x1a2f52, roughness: 0.9 });
  const standMat2 = new THREE.MeshStandardMaterial({ color: 0x223a61, roughness: 0.9 });
  for (const side of [-1, 1]) {
    for (let k = 0; k < 6; k++) {   // stepped bleachers along both sidelines
      const step = new THREE.Mesh(new THREE.BoxGeometry(150, 1.6 + k * 1.6, 3.2), k % 2 ? standMat : standMat2);
      step.position.set(0, (1.6 + k * 1.6) / 2, side * (HALF_W + 8 + k * 3.2)); step.receiveShadow = true; scene.add(step);
    }
  }
  // goalposts
  const gold = new THREE.MeshStandardMaterial({ color: 0xf2c230, roughness: 0.4, metalness: 0.2 });
  for (const sx of [-1, 1]) {
    const x = sx * (FIELD_X + END);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 3.4, 12), gold); post.position.set(x + sx * 1.8, 1.7, 0); scene.add(post);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 1.8, 12), gold); neck.rotation.z = Math.PI / 2; neck.position.set(x + sx * 0.9, 3.4, 0); scene.add(neck);
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 6.2, 12), gold); bar.rotation.x = Math.PI / 2; bar.position.set(x, 3.4, 0); scene.add(bar);
    for (const z of [-3.1, 3.1]) { const up = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 11.7, 12), gold); up.position.set(x, 3.4 + 5.85, z); up.castShadow = true; scene.add(up); }
  }

  /* ---------------------------------------------------------------- columns */
  const colGeo = new THREE.CylinderGeometry(2.5, 2.5, 1, 40); colGeo.translate(0, 0.5, 0);
  const baseGeo = new THREE.CylinderGeometry(3.2, 3.2, 0.35, 40);
  const ringGeo = new THREE.TorusGeometry(2.8, 0.28, 12, 48); ringGeo.rotateX(Math.PI / 2);
  const divisions = [...new Set(teams.map((t) => t.division))].sort();
  const cols = teams.map((t, i) => {
    const confSide = t.conference === "AFC" ? -1 : 1;
    const divRow = divisions.filter((d) => d.startsWith(t.conference)).indexOf(t.division);
    const k = teams.filter((u) => u.division === t.division).indexOf(t);
    const x = confSide * (11 + k * 10), z = -19.5 + divRow * 13;
    const g = new THREE.Group(); g.position.set(x, 0, z);
    const base = new THREE.Mesh(baseGeo, new THREE.MeshStandardMaterial({ color: teamColor(t.code), roughness: 0.6 }));
    base.position.y = 0.17; base.receiveShadow = true; g.add(base);
    const mat = new THREE.MeshStandardMaterial({ color: 0x2a78d6, roughness: 0.38, metalness: 0.08, emissive: 0x000000 });
    const col = new THREE.Mesh(colGeo, mat); col.castShadow = true; col.receiveShadow = true; col.userData.team = i; g.add(col);
    const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xd22b3f })); ring.visible = false; g.add(ring);
    const logo = badgeSprite(t.code, teamColor(t.code), logoUrl(t.code)); logo.userData.onLoad = invalidate; g.add(logo);
    const label = textSprite("—", { size: 54 }); g.add(label);
    scene.add(g);
    return { g, col, mat, ring, logo, label, h: 0.4, target: 0.4, value: undefined };
  });
  const colMeshes = cols.map((c) => c.col);

  /* ---------------------------------------------------------------- state + update */
  let zoomed = false, showLabels = true, last = null;
  function layout() {
    if (!last) return;
    const { values, colorOf, format, selected } = last;
    const vs = [...values.values()];
    const lo = Math.min(...vs), hi = Math.max(...vs), maxAbs = Math.max(...vs.map(Math.abs)) || 1;
    cols.forEach((c, i) => {
      const v = values.get(i);
      c.value = v;
      const on = v !== undefined;
      c.target = !on ? 0.3 : zoomed ? 2.5 + (hi > lo ? (v - lo) / (hi - lo) : 0.5) * (MAX_H - 2.5) : Math.max(0.4, (Math.abs(v) / maxAbs) * MAX_H);
      c.mat.color.set(on ? colorOf(v) : "#39465a");
      c.mat.transparent = !on; c.mat.opacity = on ? 1 : 0.5;
      c.ring.visible = selected.has(i);
      c.logo.material.opacity = on ? 1 : 0.35;
      c.label.visible = on && showLabels;
      if (on) c.label.userData.draw(format(v));
    });
    if (reduceMotion) cols.forEach((c) => (c.h = c.target));
    invalidate();
  }
  function place(c) {
    c.col.scale.y = c.h;
    c.ring.position.y = c.h + 0.1;
    c.logo.position.y = c.h + 3.0;
    c.label.position.y = c.h + 6.1;
  }
  cols.forEach(place);

  /* ---------------------------------------------------------------- hover / click */
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  let hover = -1, down = null;
  const el = renderer.domElement;
  function pick(e) {
    const r = el.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects(colMeshes, false)[0];
    return hit ? hit.object.userData.team : -1;
  }
  function setHover(i, e) {
    if (hover !== i) {
      if (hover >= 0) cols[hover].mat.emissive.set(0x000000);
      hover = i;
      if (i >= 0) cols[i].mat.emissive.set(0x3a1c22);
      el.style.cursor = i >= 0 ? "pointer" : "grab";
      invalidate();
    }
    onHover && onHover(i >= 0 ? i : null, e, i >= 0 ? cols[i].value : undefined);
  }
  el.addEventListener("pointermove", (e) => { if (!down || (Math.abs(e.clientX - down.x) + Math.abs(e.clientY - down.y) < 5)) setHover(pick(e), e); });
  el.addEventListener("pointerleave", (e) => setHover(-1, e));
  el.addEventListener("pointerdown", (e) => { down = { x: e.clientX, y: e.clientY }; controls.autoRotate = false; opts.onInteract && opts.onInteract(); });
  el.addEventListener("pointerup", (e) => {
    if (down && Math.abs(e.clientX - down.x) + Math.abs(e.clientY - down.y) < 5) { const i = pick(e); if (i >= 0 && onClick) onClick(i); }
    down = null;
  });
  controls.addEventListener("change", invalidate);

  /* ---------------------------------------------------------------- render loop (idle-aware) */
  let frames = 0, running = false, visible = true;
  function invalidate(n = 2) { frames = Math.max(frames, n); start(); }
  function start() { if (!running && visible && !document.hidden) { running = true; requestAnimationFrame(tick); } }
  function tick() {
    let moving = false;
    cols.forEach((c) => {
      const d = c.target - c.h;
      if (Math.abs(d) > 0.01) { c.h += d * 0.14; moving = true; } else c.h = c.target;
      place(c);
    });
    const damping = controls.update();
    renderer.render(scene, camera);
    frames = Math.max(0, frames - 1);
    if (moving || damping || controls.autoRotate || frames > 0) requestAnimationFrame(tick);
    else running = false;
  }
  new IntersectionObserver(([en]) => { visible = en.isIntersecting; if (visible) invalidate(); }).observe(container);
  document.addEventListener("visibilitychange", () => invalidate());

  function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.fov = w / h < 1.1 ? 50 : 36;
    camera.updateProjectionMatrix();
    invalidate();
  }
  new ResizeObserver(resize).observe(container);
  resize();

  return {
    update(u) { last = u; layout(); },
    setZoomed(b) { zoomed = b; layout(); },
    setLabels(b) { showLabels = b; layout(); },
    setAutoRotate(b) { controls.autoRotate = b && !reduceMotion; invalidate(); },
    zoom(f) { const d = camera.position.clone().sub(controls.target); const len = THREE.MathUtils.clamp(d.length() * f, controls.minDistance, controls.maxDistance); camera.position.copy(controls.target).add(d.setLength(len)); invalidate(); },
    resetView() { camera.position.copy(HOME); controls.target.set(0, 2, 0); controls.update(); invalidate(); },
    // QA hook: what the 3D scene is currently showing
    snapshot() { return cols.map((c, i) => ({ code: teams[i].code, value: c.value, target: +c.target.toFixed(3), ring: c.ring.visible })); },
  };
}
