/* ==========================================================================
   three-football.js — a procedurally modelled NFL-style football (Three.js).
   No external model files: geometry, leather texture, seams and laces are all
   generated in code. Decorative only (aria-hidden); the page works without it.

   Interaction: drag to spin (with inertia) · click/tap to throw a spiral ·
   tilts with page scroll · idles with a slow spiral (off under reduced motion).
   ========================================================================== */
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
// the site-wide Motion switch (common.js) overrides the OS setting when the visitor uses it
const still = () => (window.RIB && window.RIB.motion ? !window.RIB.motion.on : reduceMotion);

/* ---------------------------------------------------------------- textures */
function leatherTextures(size = 512) {
  // pebbled leather: base colour + bump/roughness from the same noise field
  const c = document.createElement("canvas"); c.width = c.height = size;
  const b = document.createElement("canvas"); b.width = b.height = size;
  const g = c.getContext("2d"), h = b.getContext("2d");
  const grad = g.createLinearGradient(0, 0, 0, size);
  grad.addColorStop(0, "#5a2812"); grad.addColorStop(0.5, "#673016"); grad.addColorStop(1, "#542510");
  g.fillStyle = grad; g.fillRect(0, 0, size, size);
  h.fillStyle = "#808080"; h.fillRect(0, 0, size, size);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 9000; i++) {
    const x = rnd() * size, y = rnd() * size, r = 0.8 + rnd() * 1.8;
    const light = rnd() > 0.5;
    g.fillStyle = light ? "rgba(150,80,40,0.10)" : "rgba(40,15,5,0.12)";
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    h.fillStyle = light ? "rgba(255,255,255,0.35)" : "rgba(0,0,0,0.25)";
    h.beginPath(); h.arc(x, y, r, 0, Math.PI * 2); h.fill();
  }
  const map = new THREE.CanvasTexture(c); map.colorSpace = THREE.SRGBColorSpace;
  const bump = new THREE.CanvasTexture(b);
  [map, bump].forEach((t) => { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(2, 1); t.anisotropy = 4; });
  return { map, bump };
}

/* ---------------------------------------------------------------- model */
const L = 1.4;          // half-length (tip to centre)
const R = 0.86;         // max radius
const radiusAt = (y) => R * Math.pow(Math.max(0, 1 - (y / L) ** 2), 0.72); // prolate, slightly pointed tips

export function buildFootball() {
  const group = new THREE.Group();
  const { map, bump } = leatherTextures();

  // body: lathe around the long (Y) axis
  const pts = [];
  const N = 64;
  for (let i = 0; i <= N; i++) { const y = -L + (2 * L * i) / N; pts.push(new THREE.Vector2(Math.max(0.0001, radiusAt(y)), y)); }
  const body = new THREE.Mesh(
    new THREE.LatheGeometry(pts, 96),
    new THREE.MeshStandardMaterial({ map, bumpMap: bump, bumpScale: 1.2, roughness: 0.62, metalness: 0.0, color: 0xffffff })
  );
  group.add(body);

  // point on the surface at long-axis position y and angle a (slightly lifted by `lift`)
  const surf = (y, a, lift = 0) => { const r = radiusAt(y) + lift; return new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r); };

  // four panel seams along meridians
  const seamMat = new THREE.MeshStandardMaterial({ color: 0x2a1208, roughness: 0.9 });
  [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2].forEach((a) => {
    const curve = new THREE.CatmullRomCurve3(Array.from({ length: 40 }, (_, i) => surf(-L * 0.97 + (1.94 * L * i) / 39, a, 0.004)));
    group.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 80, 0.012, 6, false), seamMat));
  });

  // laces over the top seam (angle = PI/2 → +Z side faces the camera after rotation)
  const laceMat = new THREE.MeshStandardMaterial({ color: 0xf4f1ea, roughness: 0.55 });
  const top = Math.PI / 2;
  const spine = new THREE.CatmullRomCurve3(Array.from({ length: 20 }, (_, i) => surf(-L * 0.36 + (0.72 * L * i) / 19, top, 0.02)));
  group.add(new THREE.Mesh(new THREE.TubeGeometry(spine, 40, 0.028, 8, false), laceMat));
  const n = 8;
  for (let k = 0; k < n; k++) {
    const y = -L * 0.3 + (0.6 * L * k) / (n - 1);
    const span = 0.2 / radiusAt(y) * R; // angular half-width of each cross lace
    const arc = new THREE.CatmullRomCurve3(Array.from({ length: 9 }, (_, i) => surf(y, top - span + (2 * span * i) / 8, 0.028)));
    group.add(new THREE.Mesh(new THREE.TubeGeometry(arc, 16, 0.024, 8, false), laceMat));
  }

  // lay it on its side: long axis → X, laces facing viewer/up
  group.rotation.z = Math.PI / 2;
  const holder = new THREE.Group();
  holder.add(group);
  return holder;
}

/* ---------------------------------------------------------------- mount */
export function mountFootball(container, opts = {}) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
  } catch (e) { container.classList.add("no-webgl"); return null; }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;
  container.appendChild(renderer.domElement);
  renderer.domElement.setAttribute("aria-hidden", "true");

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.45;

  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
  camera.position.set(0, 0.35, 6.2);

  scene.add(new THREE.HemisphereLight(0xdbe6ff, 0x1a0f08, 0.6));
  const key = new THREE.DirectionalLight(0xfff1dd, 2.4); key.position.set(3, 4, 5); scene.add(key);
  const rim = new THREE.DirectionalLight(0xff3350, 2.2); rim.position.set(-4, 1.5, -3); scene.add(rim);
  const fill = new THREE.DirectionalLight(0x5b8cff, 0.8); fill.position.set(-3, -2, 4); scene.add(fill);

  const ball = buildFootball();
  const spinner = new THREE.Group(); // tilt (scroll) → spinner → ball (spiral about its long axis)
  spinner.add(ball);
  spinner.rotation.set(-0.25, -0.5, 0.18);
  scene.add(spinner);

  // soft contact shadow
  const sc = document.createElement("canvas"); sc.width = sc.height = 128;
  const sg = sc.getContext("2d"), rg = sg.createRadialGradient(64, 64, 4, 64, 64, 64);
  rg.addColorStop(0, "rgba(0,0,0,0.55)"); rg.addColorStop(1, "rgba(0,0,0,0)");
  sg.fillStyle = rg; sg.fillRect(0, 0, 128, 128);
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 1.1), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(sc), transparent: true, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2; shadow.position.y = -1.45; scene.add(shadow);

  /* interaction state */
  let dragging = false, moved = 0, lastX = 0, lastY = 0;
  let vx = 0, vy = 0;                          // drag inertia (rad/frame)
  let spiral = still() ? 0 : 0.012;         // spin about long axis
  let idleSpiral = spiral;
  let throwT = 0;                               // throw animation clock
  const el = renderer.domElement;
  el.style.touchAction = "pan-y";
  el.style.cursor = "grab";

  el.addEventListener("pointerdown", (e) => { dragging = true; moved = 0; lastX = e.clientX; lastY = e.clientY; el.setPointerCapture(e.pointerId); el.style.cursor = "grabbing"; });
  el.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const dx = e.clientX - lastX, dy = e.clientY - lastY;
    moved += Math.abs(dx) + Math.abs(dy);
    lastX = e.clientX; lastY = e.clientY;
    vx = dx * 0.008; vy = dy * 0.008;
    spinner.rotation.y += vx; spinner.rotation.x += vy;
  });
  const end = (e) => {
    if (!dragging) return;
    dragging = false; el.style.cursor = "grab";
    if (moved < 6) throwIt();
  };
  el.addEventListener("pointerup", end); el.addEventListener("pointercancel", end);

  function throwIt() { throwT = 1; spiral = 0.55; opts.onThrow && opts.onThrow(); }

  /* sizing + visibility */
  function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.position.z = w / h < 1 ? 7.6 : 6.2;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(container);
  resize();

  let visible = true;
  new IntersectionObserver(([en]) => { visible = en.isIntersecting; if (visible) loop(); }, { threshold: 0 }).observe(container);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) loop(); });

  let scrollTilt = 0;
  window.addEventListener("scroll", () => { scrollTilt = Math.min(1, window.scrollY / 700); }, { passive: true });

  let running = false, t0 = performance.now();
  function frame(now) {
    if (!visible || document.hidden) { running = false; return; }
    const dt = Math.min(3, (now - t0) / 16.67); t0 = now;
    if (!dragging) {
      spinner.rotation.y += vx * dt; spinner.rotation.x += vy * dt;
      vx *= Math.pow(0.94, dt); vy *= Math.pow(0.94, dt);
    }
    ball.rotation.x += spiral * dt;                          // spiral about the long axis
    if (spiral > idleSpiral) spiral = Math.max(idleSpiral, spiral * Math.pow(0.975, dt));
    if (throwT > 0) {                                        // arc up and back down
      throwT = Math.max(0, throwT - 0.012 * dt);
      const p = 1 - throwT;
      spinner.position.y = Math.sin(p * Math.PI) * 0.9;
      spinner.position.x = Math.sin(p * Math.PI * 2) * 0.25;
    } else if (!still()) {
      spinner.position.y = Math.sin(now / 900) * 0.06;      // gentle float
    }
    const tiltTarget = -0.25 + scrollTilt * 0.6;
    spinner.rotation.x += (tiltTarget - spinner.rotation.x) * (dragging ? 0 : 0.03) * dt;
    shadow.material.opacity = 0.9 - Math.abs(spinner.position.y) * 0.5;
    shadow.scale.setScalar(1 - spinner.position.y * 0.25);
    renderer.render(scene, camera);
    if (still() && !dragging && Math.abs(vx) + Math.abs(vy) < 1e-4 && throwT === 0 && spiral <= idleSpiral) { running = false; return; }
    requestAnimationFrame(frame);
  }
  function loop() { if (running) return; running = true; t0 = performance.now(); requestAnimationFrame(frame); }
  el.addEventListener("pointerdown", loop);
  window.addEventListener("rib:motion", () => { idleSpiral = still() ? 0 : 0.012; spiral = Math.max(idleSpiral, Math.min(spiral, idleSpiral || spiral)); loop(); });
  loop();
  container.classList.add("is-3d");
  return { throwIt, renderer };
}
