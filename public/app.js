// Claude HQ — blocky (Minecraft-style) edition. Projects are houses on a voxel island, Claude sessions are
// blocky robots, today's list is a quest log, live activity is the chat.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildDemo, tickDemo, DEMO_BRIEF } from './demo.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const ease = (t) => (t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const ago = (ts) => { if (!ts) return 'never'; const s = (Date.now() - ts) / 1000; return s < 60 ? 'just now' : s < 3600 ? `${Math.floor(s / 60)}m ago` : s < 86400 ? `${Math.floor(s / 3600)}h ago` : `${Math.floor(s / 86400)}d ago`; };
const hhmm = (ts) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
const toolName = (t) => String(t || '').replace(/^mcp__.*?__/, '').replace(/_/g, ' ');
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const params = new URLSearchParams(location.search);

const STATUS = {
  working: { c: '#55ff55', wool: '#5fc93a', label: 'Working now' },
  waiting: { c: '#ffaa00', wool: '#f9801d', label: 'Waiting on you' },
  recent: { c: '#bf7bff', wool: '#8932b8', label: 'Active today' },
  week: { c: '#55ccff', wool: '#3ab3da', label: 'This week' },
  quiet: { c: '#8b8b8b', wool: '#8e8e86', label: 'Quiet' },
  idle: { c: '#bf7bff', wool: '#8932b8', label: 'Idle' },
  resting: { c: '#8b8b8b', wool: '#8e8e86', label: 'Resting' },
};

await Promise.all(['16px "Press Start 2P"', '22px VT323'].map((f) => document.fonts.load(f))).catch(() => {});

/* ============================== chiptune sounds ============================== */
let actx = null, soundOn = localStorage.getItem('hq-sound') !== 'off';
function beep(notes, type = 'square', len = .07, vol = .06) {
  if (!soundOn) return;
  try {
    actx ??= new (window.AudioContext || window.webkitAudioContext)();
    let t = actx.currentTime;
    for (const f of notes) {
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = type; o.frequency.value = f; g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(.0001, t + len);
      o.connect(g).connect(actx.destination); o.start(t); o.stop(t + len + .02); t += len * .8;
    }
  } catch (_) {}
}
const SFX = {
  click: () => beep([880], 'square', .04, .04),
  xp: () => beep([1046, 1318, 1568, 2093], 'sine', .07, .08),
  achieve: () => beep([523, 784], 'square', .12, .05),
  alert: () => beep([660, 440, 660], 'triangle', .1, .07),
};

/* ============================== renderer ============================== */
const PIX = +(params.get('pixel') || .5);           // render at half resolution, upscale with hard pixels
const canvas = $('#gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2) * PIX);
renderer.setSize(innerWidth, innerHeight, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
scene.fog = new THREE.Fog('#a6c8ff', 60, 170);
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, .1, 900);
camera.position.set(60, 30, 60);
const controls = new OrbitControls(camera, canvas);
Object.assign(controls, { enableDamping: true, dampingFactor: .08, minDistance: 8, maxDistance: 110, maxPolarAngle: 1.36, autoRotateSpeed: .4 });
controls.target.set(0, 4, 0);

const hemi = new THREE.HemisphereLight('#cfe3ff', '#5c4a32', .9); scene.add(hemi);
const sunLight = new THREE.DirectionalLight('#fff3d6', 1.1); scene.add(sunLight, sunLight.target);

/* ============================== pixel textures ============================== */
function rng(seed) { return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const shade = (hex, k) => { const c = new THREE.Color(hex); c.multiplyScalar(k); return '#' + c.getHexString(); };
function pixTex(draw, w = 16, h = w, seed = 1) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'); draw(g, rng(seed), w, h);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestMipmapLinearFilter; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const noise = (base, vary) => (g, r, w, h) => { for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) { g.fillStyle = shade(base, 1 + (r() - .5) * vary); g.fillRect(x, y, 1, 1); } };
const T = {
  grassTop: pixTex(noise('#6aa84f', .32), 16, 16, 2),
  grassSide: pixTex((g, r) => { noise('#866043', .35)(g, r, 16, 16); for (let x = 0; x < 16; x++) { const d = 2 + (r() < .45 ? 1 : 0) + (r() < .2 ? 1 : 0); for (let y = 0; y < d; y++) { g.fillStyle = shade('#6aa84f', 1 + (r() - .5) * .3); g.fillRect(x, y, 1, 1); } } }, 16, 16, 3),
  dirt: pixTex(noise('#866043', .35), 16, 16, 4),
  sand: pixTex(noise('#dbcf9e', .14), 16, 16, 5),
  path: pixTex(noise('#9c8a55', .25), 16, 16, 6),
  cobble: pixTex((g, r) => { noise('#7b7b7b', .3)(g, r, 16, 16); g.fillStyle = '#4e4e4e'; for (let i = 0; i < 22; i++) g.fillRect(Math.floor(r() * 16), Math.floor(r() * 16), 1 + Math.floor(r() * 3), 1); }, 16, 16, 7),
  planks: pixTex((g, r) => { noise('#a27f4e', .14)(g, r, 16, 16); g.fillStyle = '#6e5232'; for (let y = 3; y < 16; y += 4) g.fillRect(0, y, 16, 1); for (let y = 0; y < 16; y += 4) g.fillRect((y * 5) % 16, y, 1, 3); }, 16, 16, 8),
  log: pixTex((g, r) => { for (let x = 0; x < 16; x++) for (let y = 0; y < 16; y++) { g.fillStyle = shade(x % 4 === 0 ? '#4d3a24' : '#6b5133', 1 + (r() - .5) * .25); g.fillRect(x, y, 1, 1); } }, 16, 16, 9),
  logTop: pixTex((g, r) => { noise('#a27f4e', .1)(g, r, 16, 16); g.strokeStyle = '#7a5c36'; for (let k = 2; k < 8; k += 2) g.strokeRect(8 - k, 8 - k, k * 2, k * 2); g.fillStyle = '#6b5133'; g.fillRect(0, 0, 16, 1); g.fillRect(0, 15, 16, 1); g.fillRect(0, 0, 1, 16); g.fillRect(15, 0, 1, 16); }, 16, 16, 10),
  leaves: pixTex((g, r) => { for (let x = 0; x < 16; x++) for (let y = 0; y < 16; y++) { const v = r(); g.fillStyle = v < .12 ? '#1f3d14' : shade('#3f7a2a', 1 + (r() - .5) * .5); g.fillRect(x, y, 1, 1); } }, 16, 16, 11),
  glass: pixTex((g) => { g.clearRect(0, 0, 16, 16); g.fillStyle = 'rgba(200,230,255,.18)'; g.fillRect(1, 1, 14, 14); g.fillStyle = '#d9f0ff'; g.fillRect(0, 0, 16, 1); g.fillRect(0, 15, 16, 1); g.fillRect(0, 0, 1, 16); g.fillRect(15, 0, 1, 16); g.fillRect(3, 3, 2, 1); g.fillRect(3, 4, 1, 2); }, 16, 16, 12),
  wool: pixTex((g, r) => { for (let x = 0; x < 16; x++) for (let y = 0; y < 16; y++) { g.fillStyle = shade('#ffffff', .86 + r() * .14 - ((x + y) % 4 === 0 ? .06 : 0)); g.fillRect(x, y, 1, 1); } }, 16, 16, 13),
  gold: pixTex((g, r) => { noise('#f5d442', .2)(g, r, 16, 16); g.fillStyle = '#fff6a8'; g.fillRect(2, 2, 3, 1); g.fillRect(2, 2, 1, 3); g.fillStyle = '#b88d12'; g.fillRect(0, 15, 16, 1); g.fillRect(15, 0, 1, 16); }, 16, 16, 14),
  diamond: pixTex((g, r) => { noise('#5ee9e2', .18)(g, r, 16, 16); g.fillStyle = '#d6fffc'; g.fillRect(2, 2, 3, 1); g.fillRect(2, 2, 1, 3); g.fillStyle = '#2aa59f'; g.fillRect(0, 15, 16, 1); g.fillRect(15, 0, 1, 16); }, 16, 16, 15),
  glow: pixTex((g, r) => { for (let x = 0; x < 16; x++) for (let y = 0; y < 16; y++) { g.fillStyle = r() < .3 ? '#ffe9a6' : shade('#e7b64a', .85 + r() * .3); g.fillRect(x, y, 1, 1); } }, 16, 16, 16),
  water: pixTex(noise('#2f63d8', .16), 16, 16, 17),
};
T.water.wrapS = T.water.wrapT = THREE.RepeatWrapping; T.water.repeat.set(110, 110);
const lam = (map, o = {}) => new THREE.MeshLambertMaterial({ map, ...o });
const M = {
  grass: [lam(T.grassSide), lam(T.grassSide), lam(T.grassTop), lam(T.dirt), lam(T.grassSide), lam(T.grassSide)],
  dirt: lam(T.dirt), sand: lam(T.sand), cobble: lam(T.cobble), planks: lam(T.planks),
  path: [lam(T.dirt), lam(T.dirt), lam(T.path), lam(T.dirt), lam(T.dirt), lam(T.dirt)],
  log: [lam(T.log), lam(T.log), lam(T.logTop), lam(T.logTop), lam(T.log), lam(T.log)],
  leaves: lam(T.leaves), glass: lam(T.glass, { transparent: true, alphaTest: .05, depthWrite: false }),
  gold: lam(T.gold), diamond: lam(T.diamond),
  glow: lam(T.glow, { emissive: '#ffcf66', emissiveMap: T.glow, emissiveIntensity: .6 }),
};
const BOX = new THREE.BoxGeometry(1, 1, 1);

/* ============================== sky, sun, moon, stars, clouds ============================== */
const skyMat = new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false,
  uniforms: { uTop: { value: new THREE.Color() }, uBot: { value: new THREE.Color() } },
  vertexShader: `varying float vY; void main(){ vY = normalize(position).y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`,
  fragmentShader: `uniform vec3 uTop, uBot; varying float vY; void main(){ float k = smoothstep(-.05, .55, vY); vec3 c = mix(uBot, uTop, k); c = floor(c * 48.) / 48.; gl_FragColor = vec4(c, 1.); }`,
});
const sky = new THREE.Mesh(new THREE.SphereGeometry(500, 24, 12), skyMat); scene.add(sky);
const squareSprite = (fill, glow) => {
  const t = pixTex((g) => { g.fillStyle = glow; g.fillRect(0, 0, 32, 32); g.fillStyle = fill; g.fillRect(6, 6, 20, 20); }, 32, 32);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, fog: false, depthWrite: false, transparent: true })); s.scale.set(40, 40, 1); return s;
};
const sunS = squareSprite('#fff9d6', 'rgba(255,240,170,.25)'), moonS = squareSprite('#dfe6ff', 'rgba(200,210,255,.12)');
scene.add(sunS, moonS);
const stars = (() => {
  const n = 1400, p = new Float32Array(n * 3), r = rng(77);
  for (let i = 0; i < n; i++) { const th = r() * Math.PI * 2, ph = Math.acos(r() * .95); p.set([Math.sin(ph) * Math.cos(th) * 420, Math.cos(ph) * 420, Math.sin(ph) * Math.sin(th) * 420], i * 3); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  const s = new THREE.Points(g, new THREE.PointsMaterial({ color: '#ffffff', size: 2, sizeAttenuation: false, transparent: true, fog: false }));
  scene.add(s); return s;
})();
const clouds = new THREE.Group(); scene.add(clouds);
{
  const r = rng(31), cells = [];
  for (let x = -150; x < 150; x += 6) for (let z = -150; z < 150; z += 6) if (r() < .16) cells.push([x, z]);
  const mk = (off) => {
    const m = new THREE.InstancedMesh(new THREE.BoxGeometry(6, 1.4, 6), new THREE.MeshLambertMaterial({ color: '#ffffff', transparent: true, opacity: .86, emissive: '#ffffff', emissiveIntensity: .35 }), cells.length);
    const mx = new THREE.Matrix4(); cells.forEach(([x, z], i) => { mx.makeTranslation(x + off, 46, z); m.setMatrixAt(i, mx); }); clouds.add(m);
  };
  mk(0); mk(300);
}
const water = new THREE.Mesh(new THREE.PlaneGeometry(320, 320), lam(T.water, { transparent: true, opacity: .82 }));
water.rotation.x = -Math.PI / 2; water.position.y = 1.62; scene.add(water);

let timeMode = params.get('time') || 'auto';   // auto | day | sunset | night
function dayPhase() {
  if (timeMode === 'day') return 13; if (timeMode === 'sunset') return 18.6; if (timeMode === 'night') return 23;
  const d = new Date(); return d.getHours() + d.getMinutes() / 60;
}
const C = (h) => new THREE.Color(h);
const SKY = { dayTop: C('#5d8ef0'), dayBot: C('#a9cbff'), setTop: C('#46529c'), setBot: C('#ff9a5a'), nightTop: C('#03050d'), nightBot: C('#111a3d') };
let dayF = 1;
function updateSky(t) {
  const h = dayPhase(), a = ((h - 6) / 24) * Math.PI * 2, el = Math.sin(a);
  dayF = clamp(el * 3 + .45);
  const dusk = clamp(1 - Math.abs(el) / .28) * (h > 12 || h < 4 ? 1 : .8);
  const top = SKY.nightTop.clone().lerp(SKY.dayTop, dayF).lerp(SKY.setTop, dusk * .6);
  const bot = SKY.nightBot.clone().lerp(SKY.dayBot, dayF).lerp(SKY.setBot, dusk * .75);
  skyMat.uniforms.uTop.value.copy(top); skyMat.uniforms.uBot.value.copy(bot);
  scene.fog.color.copy(bot); renderer.setClearColor(bot);
  const sp = new THREE.Vector3(Math.cos(a) * 320, Math.sin(a) * 320, -90);
  sunS.position.copy(sp).add(camera.position); moonS.position.copy(sp).multiplyScalar(-1).add(camera.position);
  sunLight.position.copy(el > -.05 ? sp : sp.clone().multiplyScalar(-1)).normalize().multiplyScalar(80);
  sunLight.color.set(el > -.05 ? '#fff1d0' : '#9fb0ff').lerp(C('#ffb070'), dusk * .7);
  sunLight.intensity = el > -.05 ? .35 + dayF * .85 : .28;
  hemi.intensity = .35 + dayF * .65;
  stars.material.opacity = 1 - dayF;
  M.glow.emissiveIntensity = .5 + (1 - dayF) * 1.4;
  clawdMat.emissiveIntensity = .12 + (1 - dayF) * .45;
  sky.position.copy(camera.position);
  stars.position.copy(camera.position);
  clouds.position.x = ((t * 1.3) % 300) - 300;
  $('#btnTime').textContent = dayF > .5 ? '☀' : '☾';
}

/* ============================== the island ============================== */
const hash = (x, z) => { const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return s - Math.floor(s); };
const vnoise = (x, z) => { const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi, u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const a = hash(xi, zi), b = hash(xi + 1, zi), c = hash(xi, zi + 1), d = hash(xi + 1, zi + 1); return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v; };
const fbm = (x, z) => vnoise(x / 9, z / 9) * .65 + vnoise(x / 4, z / 4) * .35;
const R = 46, PY = 3;                            // world half-size; plot / plaza ground height
const H = new Map(), TOP = new Map();            // column height, top block type
const k = (x, z) => x + ',' + z;
const heightAt = (x, z) => H.get(k(Math.round(x), Math.round(z))) ?? 1;

let world = null;
const plots = new Map();          // project id → plot
const hitBoxes = [];

const rot = (lx, lz, r) => { const c = [1, 0, -1, 0][r], s = [0, 1, 0, -1][r]; return [Math.round(lx * c + lz * s), Math.round(-lx * s + lz * c)]; };

function buildWorld(list) {
  if (world) { scene.remove(world); world.traverse((o) => { if (o.isInstancedMesh || (o.isMesh && o.userData.own)) o.geometry !== BOX && o.geometry.dispose(); }); }
  world = new THREE.Group(); scene.add(world);
  hitBoxes.length = 0; plots.clear(); H.clear(); TOP.clear(); SOLID.clear();

  // 1. where the houses go: rings around the beacon, most recent closest, each turned to face outwards
  const rings = [{ r: 13, n: 6 }, { r: 21, n: 9 }, { r: 29, n: 12 }];
  const spots = [];
  list.slice(0, 27).forEach((p, i) => {
    let ring = 0, idx = i; while (ring < rings.length - 1 && idx >= rings[ring].n) { idx -= rings[ring].n; ring++; }
    const RG = rings[ring], a = (idx / RG.n) * Math.PI * 2 + ring * .5 + Math.PI / 2;
    const x = Math.round(Math.cos(a) * RG.r), z = Math.round(Math.sin(a) * RG.r);
    const out = new THREE.Vector2(x, z).normalize();
    let best = 0, bd = -2; for (let r = 0; r < 4; r++) { const [fx, fz] = rot(0, 1, r); const d = fx * out.x + fz * out.y; if (d > bd) { bd = d; best = r; } }
    spots.push({ p, x, z, r: best });
  });

  // 2. heightmap: noisy island, flattened under houses, the plaza and the paths
  for (let x = -R; x <= R; x++) for (let z = -R; z <= R; z++) {
    const d = Math.hypot(x, z), coast = 35 + (fbm(x * .7 + 50, z * .7) - .5) * 10;
    let h = 3 + Math.round((fbm(x, z) - .5) * 5);
    if (d > coast) h = Math.round(3 - (d - coast) * .8);
    let flat = clamp((d - 6.5) / 3);
    for (const s of spots) { const m = Math.max(Math.abs(x - s.x), Math.abs(z - s.z)); flat = Math.min(flat, clamp((m - 4.5) / 3)); }
    h = Math.round(lerp(PY, h, flat));
    H.set(k(x, z), clamp(h, 0, 8));
  }
  for (const s of spots) {   // paths from the plaza to each front door
    const [fx, fz] = rot(0, 1, s.r), door = [s.x + fx * 4, s.z + fz * 4];
    const len = Math.hypot(door[0], door[1]);
    for (let t = 6 / len; t <= 1; t += .3 / len) {
      const px = Math.round(door[0] * t), pz = Math.round(door[1] * t);
      if (Math.hypot(px, pz) < 6) continue;
      H.set(k(px, pz), PY); TOP.set(k(px, pz), 'path');
    }
  }

  // 3. collect blocks
  const B = { grass: [], dirt: [], sand: [], path: [], cobble: [], planks: [], log: [], leaves: [], glass: [], gold: [], diamond: [], glow: [] };
  const occupied = new Set();
  const put = (type, x, y, z) => { B[type].push(x, y, z); occupied.add(x + ',' + y + ',' + z); };
  // houses
  for (const s of spots) {
    const L = (lx, y, lz, type) => { const [dx, dz] = rot(lx, lz, s.r); put(type, s.x + dx, y, s.z + dz); };
    for (let lx = -2; lx <= 2; lx++) for (let lz = -2; lz <= 2; lz++) { const [dx, dz] = rot(lx, lz, s.r); TOP.set(k(s.x + dx, s.z + dz), 'floor'); SOLID.add(k(s.x + dx, s.z + dz)); }
    for (let y = PY; y <= PY + 2; y++) for (let lx = -2; lx <= 2; lx++) for (let lz = -2; lz <= 2; lz++) {
      const edgeX = Math.abs(lx) === 2, edgeZ = Math.abs(lz) === 2;
      if (!edgeX && !edgeZ) continue;
      if (lz === 2 && lx === 0 && y <= PY + 1) continue;                                    // door
      if (edgeX && edgeZ) { L(lx, y, lz, 'log'); continue; }                                // corner posts
      if (y === PY + 1 && ((edgeX && lz === 0) || (lz === -2 && lx === 0) || (lz === 2 && Math.abs(lx) === 1))) { L(lx, y, lz, 'glass'); continue; }
      L(lx, y, lz, 'planks');
    }
    L(2, PY, 3, 'glow');                                                                       // lamp by the door
    s.roof = [];
    [[3, PY + 3], [2, PY + 4], [1, PY + 5], [0, PY + 6]].forEach(([n, y]) => { for (let lx = -n; lx <= n; lx++) for (let lz = -n; lz <= n; lz++) { if (n === 3 && Math.abs(lx) < 3 && Math.abs(lz) < 3) continue; const [dx, dz] = rot(lx, lz, s.r); s.roof.push(s.x + dx, y, s.z + dz); } });
    for (let lx = -2; lx <= 2; lx++) for (let lz = -2; lz <= 2; lz++) { const [dx, dz] = rot(lx, lz, s.r); s.roof.push(s.x + dx, PY + 3, s.z + dz); }
  }
  // beacon pyramid
  for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) { put(Math.abs(x) === 3 && Math.abs(z) === 3 ? 'diamond' : 'gold', x, PY, z); SOLID.add(k(x, z)); }
  for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) put('diamond', x, PY + 1, z);
  for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) put('gold', x, PY + 2, z);
  // trees
  const r = rng(99);
  let trees = 0;
  for (let tries = 0; tries < 900 && trees < 22; tries++) {
    const x = Math.round((r() - .5) * 64), z = Math.round((r() - .5) * 64), h = H.get(k(x, z));
    if (!(h >= 3) || Math.hypot(x, z) < 9 || TOP.get(k(x, z))) continue;
    if (spots.some((s) => Math.max(Math.abs(x - s.x), Math.abs(z - s.z)) < 6)) continue;
    let clear = true; for (let dx = -2; dx <= 2 && clear; dx++) for (let dz = -2; dz <= 2; dz++) if (TOP.get(k(x + dx, z + dz)) === 'path') { clear = false; break; }
    if (!clear) continue;
    const th = 4 + (r() < .4 ? 1 : 0);
    for (let y = h; y < h + th; y++) put('log', x, y, z);
    const top = h + th;
    for (let dy = -2; dy <= 1; dy++) {
      const n = dy < 0 ? 2 : 1;
      for (let dx = -n; dx <= n; dx++) for (let dz = -n; dz <= n; dz++) {
        if (n === 2 && Math.abs(dx) === 2 && Math.abs(dz) === 2 && r() < .7) continue;
        if (dy === 1 && Math.abs(dx) + Math.abs(dz) > 1) continue;
        if (dx === 0 && dz === 0 && dy < 0) continue;
        put('leaves', x + dx, top + dy, z + dz);
      }
    }
    TOP.set(k(x, z), 'tree'); SOLID.add(k(x, z)); trees++;
  }
  // terrain columns (top three layers are enough to look solid from any angle)
  for (let x = -R; x <= R; x++) for (let z = -R; z <= R; z++) {
    const h = H.get(k(x, z)), d = Math.hypot(x, z);
    if (h <= 0) continue;
    const top = TOP.get(k(x, z));
    const sandy = h <= 2;
    for (let y = Math.max(0, h - 3); y < h; y++) {
      let type = y === h - 1 ? (top === 'path' ? 'path' : top === 'floor' ? 'planks' : sandy ? 'sand' : 'grass') : sandy ? 'sand' : 'dirt';
      if (Math.hypot(x, z) < 7 && y === h - 1 && d < 7) type = 'cobble';                        // plaza
      put(type, x, y, z);
    }
  }
  // 4. instanced meshes
  const mx = new THREE.Matrix4();
  for (const [type, arr] of Object.entries(B)) {
    const n = arr.length / 3; if (!n) continue;
    const mesh = new THREE.InstancedMesh(BOX, M[type], n);
    for (let i = 0; i < n; i++) { mx.makeTranslation(arr[i * 3], arr[i * 3 + 1] + .5, arr[i * 3 + 2]); mesh.setMatrixAt(i, mx); }
    world.add(mesh);
  }
  // flowers and grass tufts
  const cross = mergeGeometries([new THREE.PlaneGeometry(.8, .8).rotateY(Math.PI / 4), new THREE.PlaneGeometry(.8, .8).rotateY(-Math.PI / 4)]).translate(0, .4, 0);
  const flowerTex = [
    pixTex((g) => { g.fillStyle = '#3f7a2a'; g.fillRect(7, 8, 2, 8); g.fillStyle = '#d82c2c'; g.fillRect(5, 3, 6, 5); g.fillStyle = '#ffd23f'; g.fillRect(7, 5, 2, 1); }, 16, 16),
    pixTex((g) => { g.fillStyle = '#3f7a2a'; g.fillRect(7, 8, 2, 8); g.fillStyle = '#ffe14d'; g.fillRect(6, 4, 4, 4); }, 16, 16),
    pixTex((g, r) => { for (let i = 0; i < 9; i++) { g.fillStyle = shade('#5c9e3e', .8 + r() * .4); const x = 1 + Math.floor(r() * 14); g.fillRect(x, 6 + Math.floor(r() * 6), 1, 10); } }, 16, 16),
  ];
  flowerTex.forEach((tx, fi) => {
    const pos = [];
    const r2 = rng(200 + fi);
    for (let i = 0; i < (fi === 2 ? 160 : 40); i++) {
      const x = Math.round((r2() - .5) * 66), z = Math.round((r2() - .5) * 66), h = H.get(k(x, z));
      if (!(h >= 3) || TOP.get(k(x, z)) || Math.hypot(x, z) < 8 || occupied.has(x + ',' + h + ',' + z)) continue;
      pos.push(x, h, z);
    }
    const m = new THREE.InstancedMesh(cross, new THREE.MeshLambertMaterial({ map: tx, transparent: true, alphaTest: .5, side: THREE.DoubleSide }), pos.length / 3);
    for (let i = 0; i < pos.length / 3; i++) { mx.makeTranslation(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]); m.setMatrixAt(i, mx); }
    world.add(m);
  });

  // 5. per-house extras: wool roof, sign board, floating name tag, beacon beam, click box
  for (const s of spots) {
    const roof = new THREE.InstancedMesh(BOX, lam(T.wool, { color: '#8e8e86' }), s.roof.length / 3);
    for (let i = 0; i < s.roof.length / 3; i++) { mx.makeTranslation(s.roof[i * 3], s.roof[i * 3 + 1] + .5, s.roof[i * 3 + 2]); roof.setMatrixAt(i, mx); }
    world.add(roof);
    const g = new THREE.Group(); g.position.set(s.x, PY, s.z); g.rotation.y = s.r * Math.PI / 2; world.add(g);
    const sign = makeSign(); sign.mesh.position.set(-3.6, 1.55, 2.7); g.add(sign.mesh);
    [-.9, .9].forEach((px) => { const post = new THREE.Mesh(new THREE.BoxGeometry(.18, 1.2, .18), M.planks.clone()); post.material.map = T.log; post.position.set(-3.6 + px, .6, 2.66); g.add(post); });
    const tag = nameTag(); tag.position.set(0, 8.2, 0); g.add(tag);
    const beam = new THREE.Mesh(new THREE.BoxGeometry(.7, 80, .7), new THREE.MeshBasicMaterial({ color: '#55ff55', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    beam.position.y = 47; g.add(beam);
    const bang = textSprite('!', '#ffaa00'); bang.position.set(0, 10.4, 0); bang.visible = false; g.add(bang);
    const hit = new THREE.Mesh(new THREE.BoxGeometry(7.2, 7, 7.2), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.set(0, 3.2, 0); hit.userData.hit = { type: 'plot', id: s.p.id }; g.add(hit); hitBoxes.push(hit);
    const sel = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(7.3, 7.1, 7.3)), new THREE.LineBasicMaterial({ color: '#000000' }));
    sel.position.copy(hit.position); sel.visible = false; g.add(sel);
    plots.set(s.p.id, { ...s, g, roof, sign, tag, beam, bang, sel, st: 'quiet', front: rot(0, 1, s.r) });
  }
  // the beacon on the pyramid
  const beacon = new THREE.Group(); beacon.position.set(0, PY + 3, 0); world.add(beacon);
  const beaconGlass = new THREE.Mesh(BOX, M.glass); beaconGlass.position.y = .5; beacon.add(beaconGlass);
  const coreCube = new THREE.Mesh(new THREE.BoxGeometry(.55, .55, .55), new THREE.MeshBasicMaterial({ color: '#7ff9ff' })); coreCube.position.y = .5; beacon.add(coreCube);
  const coreBeam = new THREE.Mesh(new THREE.BoxGeometry(.9, 120, .9), new THREE.MeshBasicMaterial({ color: '#ffd28a', transparent: true, opacity: .5, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  coreBeam.position.y = 61; beacon.add(coreBeam);
  const coreTag = nameTag(); coreTag.position.y = 4; beacon.add(coreTag);
  const coreHit = new THREE.Mesh(new THREE.BoxGeometry(7.4, 5, 7.4), new THREE.MeshBasicMaterial({ visible: false })); coreHit.position.set(0, PY + 2, 0); coreHit.userData.hit = { type: 'core' }; world.add(coreHit); hitBoxes.push(coreHit);
  world.userData = { coreCube, coreBeam, coreTag, beacon };
}

/* ---------- signs and name tags (pixel font on canvas) ---------- */
function makeSign() {
  const c = document.createElement('canvas'); c.width = 160; c.height = 96;
  const t = new THREE.CanvasTexture(c); t.magFilter = THREE.NearestFilter; t.minFilter = THREE.LinearFilter; t.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.44, .1), [M.planks, M.planks, M.planks, M.planks, new THREE.MeshLambertMaterial({ map: t }), M.planks]);
  return { mesh, c, t, key: '' };
}
function drawSign(sign, p, st) {
  const lines = (p.activity || []).slice(0, 4);
  const key = p.name + st + lines.map((a) => a.ts).join();
  if (sign.key === key) return; sign.key = key;
  const g = sign.c.getContext('2d');
  const r = rng(5);
  for (let x = 0; x < 160; x += 2) for (let y = 0; y < 96; y += 2) { g.fillStyle = shade('#a27f4e', .9 + r() * .2); g.fillRect(x, y, 2, 2); }
  g.fillStyle = '#6e5232'; for (let y = 22; y < 96; y += 24) g.fillRect(0, y, 160, 2);
  g.textBaseline = 'top'; g.font = '8px "Press Start 2P"';
  g.fillStyle = '#000'; g.fillText(p.name.toUpperCase().slice(0, 18), 6, 6);
  g.fillStyle = shade(STATUS[st].c, .55); g.fillText(STATUS[st].label.toUpperCase().slice(0, 18), 6, 18);
  g.fillStyle = '#2a1d0e';
  if (!lines.length) g.fillText('- NO ACTIVITY -', 6, 44);
  lines.forEach((a, i) => g.fillText(`${toolName(a.tool).slice(0, 6).toUpperCase()} ${String(a.detail || '').slice(0, 11)}`, 6, 34 + i * 14));
  sign.t.needsUpdate = true;
}
function nameTag() {
  const c = document.createElement('canvas'); c.width = 512; c.height = 96;
  const t = new THREE.CanvasTexture(c); t.magFilter = THREE.NearestFilter; t.minFilter = THREE.LinearFilter; t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false, fog: false })); s.renderOrder = 20;
  s.userData = { c, t, key: '' }; s.scale.set(8, 1.5, 1); return s;
}
function drawTag(s, title, sub, color, scale = 1) {
  const key = title + sub + color + scale; if (s.userData.key === key) return; s.userData.key = key;
  const { c, t } = s.userData, g = c.getContext('2d');
  g.clearRect(0, 0, 512, 96); g.font = '16px "Press Start 2P"';
  let tt = title; while (g.measureText(tt).width > 480 && tt.length > 3) tt = tt.slice(0, -1);
  if (tt !== title) tt = tt.slice(0, -1) + '…';
  g.font = '12px "Press Start 2P"'; const sw = sub ? g.measureText(sub).width : 0; g.font = '16px "Press Start 2P"';
  const w = Math.max(g.measureText(tt).width, sw) + 24, x = (512 - w) / 2;
  g.fillStyle = 'rgba(0,0,0,.42)'; g.fillRect(x, sub ? 8 : 30, w, sub ? 80 : 36);
  g.textAlign = 'center'; g.textBaseline = 'top';
  g.fillStyle = '#3f3f3f'; g.fillText(tt, 258, sub ? 20 : 42); g.fillStyle = '#ffffff'; g.fillText(tt, 256, sub ? 18 : 40);
  if (sub) { g.font = '12px "Press Start 2P"'; g.fillStyle = '#222'; g.fillText(sub, 257, 57); g.fillStyle = color; g.fillText(sub, 256, 56); }
  t.needsUpdate = true; s.userData.base = [10.5 * scale, 1.97 * scale]; s.scale.set(10.5 * scale, 1.97 * scale, 1);
}
function textSprite(txt, color) {
  const t = pixTex((g) => { g.fillStyle = '#000'; g.fillRect(9, 2, 14, 22); g.fillRect(9, 26, 14, 5); g.fillStyle = color; g.fillRect(11, 4, 10, 18); g.fillRect(11, 26, 10, 3); }, 32, 32);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false, fog: false })); s.scale.set(1.6, 1.6, 1); return s;
}

/* ============================== Clawd — the Claude Code mascot, in voxels ============================== */
// From Claude Code's own terminal sprite (3 rows of quadrant blocks, colour clawd_body rgb(215,119,87)):
//    ▐▛███▜▌      row 0–1: body, two black eye holes (poses move them: default / look-left / look-right)
//   ▝▜█████▛▘     row 2:   arms stick out          (arms-up pose raises them a row)
//     ▘▘ ▝▝       row 4:   four little legs
// Terminal cells are twice as tall as wide, so one sprite pixel is A wide and 2A tall.
const agents = new Map();
const A = .14, B = 2 * A, DEPTH = .95;
const PXX = (px) => (px - 8.5) * A, ROWY = (row) => (4 - row) * B + B / 2;
const CLAWD_ORANGE = '#d77757';
const clawdMat = new THREE.MeshLambertMaterial({ map: pixTex(noise(CLAWD_ORANGE, .08), 8, 8, 21), emissive: CLAWD_ORANGE, emissiveIntensity: .12 });   // a touch of glow keeps the brand orange readable at night
const eyeMat = new THREE.MeshBasicMaterial({ color: '#000000' });
const goldMat = new THREE.MeshLambertMaterial({ map: T.gold });
const EYES = { default: [[5, 1], [12, 1]], 'look-left': [[4, 0], [12, 0]], 'look-right': [[5, 0], [13, 0]] };
function makeClawd({ crown = false, hitId = null } = {}) {
  const g = new THREE.Group();
  const body = new THREE.Group(); g.add(body);
  const box = (w, h, d, mat, parent, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); parent.add(m); return m; };
  const torso = box(12 * A, 4 * B, DEPTH, clawdMat, body, 0, 3 * B, 0);
  const arms = [[1.5, -1], [15.5, 1]].map(([px]) => { const pv = new THREE.Group(); pv.position.set(PXX(px), ROWY(2), 0); body.add(pv); box(2 * A, B, DEPTH * .62, clawdMat, pv, 0, 0, 0); return pv; });
  const legs = [4, 6, 11, 13].map((px) => box(A, B, DEPTH * .5, clawdMat, g, PXX(px), ROWY(4), 0));
  const eyes = [0, 1].map(() => box(A, B, .04, eyeMat, body, 0, 0, DEPTH / 2 + .015));
  if (crown) {                                    // you get a little gold crown, so you can tell yourself apart
    box(8 * A, A, 6 * A, goldMat, body, 0, 5 * B + A / 2, 0);
    [-3, 0, 3].forEach((dx) => box(A * 1.6, A * 1.8, A * 1.6, goldMat, body, dx * A, 5 * B + A * 1.8, 0));
  }
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 1.1), new THREE.MeshBasicMaterial({ color: '#000', transparent: true, opacity: .28, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2; shadow.position.y = .02; g.add(shadow);
  const tag = nameTag(); tag.position.y = 2.25; g.add(tag);
  const q = textSprite('?', '#ffaa00'); q.position.set(0, 2.9, 0); q.visible = false; g.add(q);
  if (hitId) [torso, ...arms.flatMap((a) => a.children), ...legs].forEach((m) => (m.userData.hit = { type: 'agent', id: hitId }));
  const c = { g, body, torso, arms, legs, eyes, tag, q, pose: '', walk: 0, seed: Math.random() * 10, nextLook: 0, look: 'default', blinkAt: 2 + Math.random() * 3 };
  setEyes(c, 'default');
  return c;
}
function setEyes(c, pose) {
  if (c.pose === pose) return; c.pose = pose;
  EYES[pose].forEach(([px, row], i) => c.eyes[i].position.set(PXX(px), ROWY(row), DEPTH / 2 + .015));
}
// Shared animation: legs patter in pairs when walking, arms hammer when working, arms-up + hop when waiting,
// glances left/right when idle (exactly the poses Claude Code's sprite has), squished with closed eyes when resting.
function animateClawd(c, state, moving, t, dt) {
  const s = c.seed, step = Math.sin(t * 14 + s);
  c.walk = lerp(c.walk, moving ? 1 : 0, .25);
  c.legs.forEach((l, i) => { const up = (i % 2 ? Math.max(0, step) : Math.max(0, -step)) * c.walk * A * 1.6; l.position.y = ROWY(4) + up; });
  let bodyY = Math.abs(step) * c.walk * .06, armL = 0, armR = 0, sq = 1;
  if (!moving && state === 'working') { armL = Math.max(0, Math.sin(t * 16 + s)) * B; armR = Math.max(0, Math.sin(t * 16 + s + Math.PI)) * B; }
  if (!moving && state === 'waiting') { armL = armR = B * (1 + .25 * Math.sin(t * 12 + s)); bodyY = Math.max(0, Math.sin(t * 4.5 + s)) * .5; }
  if (!moving && state === 'resting') sq = .86;
  c.arms[0].position.y = ROWY(2) + armL; c.arms[1].position.y = ROWY(2) + armR;
  c.arms[0].position.x = PXX(1.5) + (armL ? A * .5 : 0); c.arms[1].position.x = PXX(15.5) - (armR ? A * .5 : 0);
  c.body.position.y = lerp(c.body.position.y, bodyY, .5);
  c.body.scale.y = lerp(c.body.scale.y, sq, .15);
  c.g.rotation.z = Math.sin(t * 7 + s) * .05 * c.walk;                 // a little waddle
  // eyes: glance around when idle, blink now and then, closed when resting
  if (t > c.nextLook) { c.nextLook = t + 1.5 + Math.random() * 2.5; c.look = state === 'idle' || state === 'player' ? ['default', 'look-left', 'look-right', 'default'][Math.floor(Math.random() * 4)] : 'default'; }
  setEyes(c, moving ? 'default' : c.look);
  c.blinkAt -= dt; const blink = c.blinkAt < .12; if (c.blinkAt < 0) c.blinkAt = 2 + Math.random() * 4;
  c.eyes.forEach((e) => (e.scale.y = state === 'resting' ? .18 : blink ? .2 : 1));
  c.q.position.y = 2.9 + Math.sin(t * 3) * .12;
}
function makeAgent(a) {
  const c = makeClawd({ hitId: a.id }); world.add(c.g);
  const ang = Math.random() * Math.PI * 2;
  c.g.position.set(Math.cos(ang) * 5.5, PY, Math.sin(ang) * 5.5);
  const ag = Object.assign(c, { a, target: c.g.position.clone(), face: 0, nextDust: 0, wanderAt: 0 });
  agents.set(a.id, ag);
  return ag;
}
function seatFor(a, i, n) {
  const pl = a.project && plots.get(a.project);
  if (pl) {
    const off = n > 1 ? (i - (n - 1) / 2) * 2.2 : 0;
    const ox = off * [1, 0, -1, 0][pl.r], oz = -off * [0, 1, 0, -1][pl.r];   // side-by-side along the house front
    return { pos: new THREE.Vector3(pl.x + pl.front[0] * 3.8 + ox, PY, pl.z + pl.front[1] * 3.8 + oz), face: pl.r * Math.PI / 2 + Math.PI };
  }
  const ang = (i / Math.max(1, n)) * Math.PI * 2 + .7;
  const v = new THREE.Vector3(Math.cos(ang) * 5.6, PY, Math.sin(ang) * 5.6);
  return { pos: v, face: Math.atan2(-v.x, -v.z) };
}
// idle agents stroll between houses so the city feels alive; working / waiting ones stay at their desk
function wanderTarget() {
  const list = [...plots.values()];
  if (!list.length || Math.random() < .25) { const a = Math.random() * Math.PI * 2; return new THREE.Vector3(Math.cos(a) * 5.6, PY, Math.sin(a) * 5.6); }
  const pl = list[Math.floor(Math.random() * list.length)];
  return new THREE.Vector3(pl.x + pl.front[0] * 4.4 + (Math.random() - .5) * 2, PY, pl.z + pl.front[1] * 4.4 + (Math.random() - .5) * 2);
}

/* ============================== you: a Clawd you walk around the city (Gather-style) ============================== */
const player = makeClawd({ crown: true });
scene.add(player.g);
player.g.position.set(3.5, PY, 5);              // on the plaza, beside the beacon
player.g.rotation.y = Math.PI / 4;
const keys = new Set();
let follow = false, near = null;
const speech = (() => {                       // speech bubble over an agent when you walk up to it
  const c = document.createElement('canvas'); c.width = 512; c.height = 160;
  const t = new THREE.CanvasTexture(c); t.magFilter = THREE.NearestFilter; t.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false, fog: false })); sp.scale.set(6, 1.875, 1); sp.visible = false; sp.renderOrder = 30;
  scene.add(sp);
  return { sp, c, t, key: '' };
})();
function drawSpeech(text) {
  if (speech.key === text) return; speech.key = text;
  const g = speech.c.getContext('2d'); g.clearRect(0, 0, 512, 160);
  g.fillStyle = '#000'; g.fillRect(4, 4, 504, 122); g.fillStyle = '#fff'; g.fillRect(8, 8, 496, 114);
  g.fillStyle = '#000'; g.fillRect(230, 126, 24, 12); g.fillStyle = '#fff'; g.fillRect(234, 122, 16, 10);
  g.fillStyle = '#000'; g.font = '13px "Press Start 2P"'; g.textBaseline = 'top';
  const words = text.split(' '); let line = '', y = 18;
  for (const w of words) { const test = line ? line + ' ' + w : w; if (g.measureText(test).width > 470) { g.fillText(line, 20, y); y += 22; line = w; if (y > 96) { line += '…'; break; } } else line = test; }
  if (y <= 96) g.fillText(line, 20, y);
  speech.t.needsUpdate = true;
}
const SOLID = new Set();
function blocked(x, z, fromY) {
  const kx = Math.round(x), kz = Math.round(z);
  if (SOLID.has(kx + ',' + kz)) return true;
  const h = H.get(kx + ',' + kz) ?? 0;
  if (h <= 1) return true;                     // the sea
  return h - fromY > 1.05;                     // can step up one block, not climb cliffs
}
function updatePlayer(dt, t) {
  const fwd = new THREE.Vector3(); camera.getWorldDirection(fwd); fwd.y = 0; fwd.normalize();
  const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
  const mv = new THREE.Vector3();
  if (keys.has('w') || keys.has('arrowup')) mv.add(fwd);
  if (keys.has('s') || keys.has('arrowdown')) mv.sub(fwd);
  if (keys.has('d') || keys.has('arrowright')) mv.add(right);
  if (keys.has('a') || keys.has('arrowleft')) mv.sub(right);
  const moving = mv.lengthSq() > 0;
  const p = player.g.position;
  if (moving) {
    follow = true; fly = null; idleT = 0;
    mv.normalize().multiplyScalar((keys.has('shift') ? 7.5 : 4.2) * dt);
    const y0 = heightAt(p.x, p.z);
    if (!blocked(p.x + mv.x, p.z, y0)) p.x += mv.x;            // slide along walls: try each axis on its own
    if (!blocked(p.x, p.z + mv.z, y0)) p.z += mv.z;
    const want = Math.atan2(mv.x, mv.z);
    player.g.rotation.y += (((want - player.g.rotation.y + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * .3;
    if (t > (player.stepAt || 0)) { player.stepAt = t + (keys.has('shift') ? .2 : .3); beep([220 + Math.random() * 40], 'triangle', .03, .02); }
  }
  player.vy = (player.vy || 0) - 22 * dt;
  player.jumpY = Math.max(0, (player.jumpY || 0) + player.vy * dt);
  if (player.jumpY === 0) player.vy = 0;
  p.y = lerp(p.y, heightAt(p.x, p.z), .3);
  player.body.position.y = player.jumpY;
  animateClawd(player, 'player', moving, t, dt);
  if (follow && !fly) {                                          // third-person camera that keeps your orbit angle
    const delta = new THREE.Vector3(p.x, p.y + 1.4, p.z).sub(controls.target).multiplyScalar(.12);
    controls.target.add(delta); camera.position.add(delta);
  }
  // what's nearby? a front door, the beacon, or an agent
  near = null;
  let best = 2.6;
  for (const pl of plots.values()) {
    const door = new THREE.Vector3(pl.x + pl.front[0] * 3.4, PY, pl.z + pl.front[1] * 3.4);
    const d = door.distanceTo(new THREE.Vector3(p.x, PY, p.z)); if (d < best) { best = d; near = { type: 'plot', id: pl.p.id, name: pl.p.name }; }
  }
  if (Math.hypot(p.x, p.z) < 6.2) near = { type: 'core' };
  for (const ag of agents.values()) { const d = ag.g.position.distanceTo(p); if (d < 2.4) near = { type: 'agent', id: ag.a.id, name: ag.a.title, ag }; }
  const bar = $('#actionbar');
  if (near?.type === 'plot') bar.innerHTML = `[E] Enter <b>${esc(near.name)}</b>`;
  else if (near?.type === 'core') bar.innerHTML = `[E] Open the <b>quest log</b>`;
  else if (near?.type === 'agent') bar.innerHTML = `[E] Talk to <b>${esc(near.name)}</b>`;
  bar.classList.toggle('on', !!near && entered);
  if (near?.type === 'agent') {
    const a = near.ag.a;
    drawSpeech(a.question ? `${a.question}` : a.state === 'working' ? `Busy! ${toolName(a.activity[0]?.tool || '')} ${a.activity[0]?.detail || ''}` : (a.lastText || 'Hi! Nothing to report.'));
    speech.sp.position.copy(near.ag.g.position).add(new THREE.Vector3(0, 3.6, 0)); speech.sp.visible = true;
  } else speech.sp.visible = false;
}
function interact() {
  if (!near) return;
  SFX.click();
  if (near.type === 'plot') openPanel(near.id);
  if (near.type === 'core') toggleQuests(true);
  if (near.type === 'agent') { const a = near.ag.a; if (a.project && plots.has(a.project)) { openPanel(a.project); } }
}

/* ---------- block particles ---------- */
const PCOUNT = 260;
const particles = new THREE.InstancedMesh(new THREE.BoxGeometry(.13, .13, .13), new THREE.MeshLambertMaterial(), PCOUNT);
particles.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(PCOUNT * 3), 3);
scene.add(particles);
const pool = Array.from({ length: PCOUNT }, () => ({ life: 0, p: new THREE.Vector3(), v: new THREE.Vector3() }));
let pNext = 0;
function burst(pos, color, n = 6, up = 3) {
  const c = new THREE.Color(color);
  for (let i = 0; i < n; i++) {
    const q = pool[pNext]; pNext = (pNext + 1) % PCOUNT;
    q.life = .9 + Math.random() * .5; q.p.copy(pos); q.v.set((Math.random() - .5) * 3, up * (.6 + Math.random() * .6), (Math.random() - .5) * 3);
    particles.setColorAt(pool.indexOf(q), c.clone().multiplyScalar(.8 + Math.random() * .4));
  }
  particles.instanceColor.needsUpdate = true;
}
function updateParticles(dt) {
  const mx = new THREE.Matrix4();
  pool.forEach((q, i) => {
    if (q.life > 0) { q.life -= dt; q.v.y -= 9 * dt; q.p.addScaledVector(q.v, dt); if (q.p.y < PY + .07) { q.p.y = PY + .07; q.v.set(0, 0, 0); } }
    mx.makeScale(q.life > 0 ? 1 : 0, q.life > 0 ? 1 : 0, q.life > 0 ? 1 : 0).setPosition(q.p);
    particles.setMatrixAt(i, mx);
  });
  particles.instanceMatrix.needsUpdate = true;
}

/* ============================== state → world ============================== */
let S = null, plotKey = '';
const plotState = (p) => {
  const here = (S?.agents || []).filter((a) => a.project === p.id);
  if (here.some((a) => a.state === 'working')) return 'working';
  if (here.some((a) => a.state === 'waiting')) return 'waiting';
  return p.status === 'working' ? 'recent' : p.status;
};
function applyState(next) {
  const prev = S; S = next;
  const list = S.projects.slice(0, 27);
  const key = list.map((p) => p.id).join('|');
  if (key !== plotKey) {                                   // the set of houses changed → rebuild the island
    plotKey = key;
    agents.clear(); buildWorld(list);
  }
  for (const p of list) {
    const pl = plots.get(p.id); if (!pl) continue;
    pl.p = p; pl.st = plotState(p);
    const col = STATUS[pl.st];
    pl.roof.material.color.set(col.wool);
    pl.beam.material.color.set(col.c);
    drawSign(pl.sign, p, pl.st);
    const loud = ['working', 'waiting', 'recent'].includes(pl.st);
    drawTag(pl.tag, p.name, `${col.label} · ${ago(p.lastTs || p.lastCommit)}`, col.c, loud ? 1 : .72);
    pl.tag.material.opacity = loud ? 1 : .7;
    pl.bang.visible = pl.st === 'waiting';
  }
  const aids = new Set(S.agents.map((a) => a.id));
  for (const [id, ag] of agents) if (!aids.has(id)) { world.remove(ag.g); agents.delete(id); }
  const byPlot = {}; S.agents.forEach((a) => (byPlot[a.project || '_'] ||= []).push(a.id));
  for (const a of S.agents) {
    const ag = agents.get(a.id) || makeAgent(a);
    const was = ag.a.state; ag.a = a;
    const grp = byPlot[a.project || '_'], seat = seatFor(a, grp.indexOf(a.id), grp.length);
    ag.target.copy(seat.pos); ag.face = seat.face;
    ag.q.visible = a.state === 'waiting';
    drawTag(ag.tag, a.title, STATUS[a.state].label, STATUS[a.state].c, .58);
    if (prev && was !== a.state) {
      if (a.state === 'waiting') { toast('Agent needs you!', `Claude is waiting in “${a.title}”`, '#ffaa00'); SFX.alert(); }
      else if (a.state === 'working' && was !== 'working') toast('Agent online', `${a.title} started working`, '#55ff55');
    }
  }
  const open = S.today.filter((t) => !t.done).length;
  drawTag(world.userData.coreTag, 'TODAY', `${open} quests · ${S.stats.waiting} need you`, '#ffff55', 1.1);
  renderHud(prev); renderQuests();
  if (openPlot) renderPlot(openPlot, true);
}

/* ============================== HUD ============================== */
const greeting = () => { const h = new Date().getHours(); return h < 5 ? 'Working late' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; };
let hoverName = '';
function renderF3() {
  if (!S) return;
  const st = S.stats, tgt = controls.target;
  const lines = [
    `Claude HQ 1.0 (<b>${DEMO ? 'demo data' : $('#live').classList.contains('off') ? 'offline' : 'live'}</b>)`,
    `${new Date().toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })} · ${hhmm(Date.now())} · ${dayF > .5 ? 'day' : 'night'}`,
    `Agents: <b>${st.working}</b> working, <b>${st.waiting}</b> waiting on you`,
    `Plots: ${st.projects} · Prompts today: ${st.promptsToday}`,
    `Spend (sessions active today): $${st.costToday.toFixed(2)}`,
    `XYZ: ${tgt.x.toFixed(1)} / ${tgt.y.toFixed(1)} / ${tgt.z.toFixed(1)}`,
    hoverName ? `Looking at: <b>${esc(hoverName)}</b>` : 'Looking at: —',
  ];
  $('#f3').innerHTML = lines.map((l) => `<div>${l}</div>`).join('');
}
function renderHud(prev) {
  const total = S.today.length, done = S.today.filter((t) => t.done).length;
  $('#xpFill').style.width = `${total ? (done / total) * 100 : 100}%`;
  $('#xpLvl').textContent = done;
  $('#questCount').textContent = total - done;
  const top = S.projects.slice(0, 9);
  $('#hotbar').innerHTML = top.map((p, i) => {
    const st = plots.get(p.id)?.st || p.status;
    return `<div class="slot ${openPlot === p.id ? 'sel' : ''}" data-id="${esc(p.id)}" data-tip="${esc(p.name)}|${STATUS[st].label} · ${ago(p.lastTs)}"><small>${i + 1}</small><i style="background:${STATUS[st].wool}"></i><b>${esc(p.name.replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase())}</b></div>`;
  }).join('');
  // chat = live activity
  const items = S.feed.slice(0, 9).reverse();
  $('#chat').innerHTML = items.map((a, i) => {
    const proj = S.projects.find((p) => p.id === a.project);
    return `<div class="line ${i < items.length - 4 ? 'old' : ''}">[${hhmm(a.ts)}] <span class="who">&lt;Claude&gt;</span> <span class="tool">${esc(toolName(a.tool))}</span> ${esc(String(a.detail || '').slice(0, 54))} <span class="proj">· ${esc(proj?.name || a.session || '')}</span></div>`;
  }).join('');
  renderF3();
}
$('#hotbar').addEventListener('click', (e) => { const s = e.target.closest('.slot'); if (s) { SFX.click(); focusPlot(s.dataset.id); } });

/* ---------- quest log ---------- */
const GROUPS = [['reply', '! NEEDS YOU'], ['ship', '+ SHIP IT'], ['loop', '? OPEN LOOPS'], ['momentum', '> KEEP GOING']];   // the pixel font has no emoji
function renderQuests() {
  const open = S.today.filter((t) => !t.done).length;
  $('#questSub').textContent = `${greeting()}, ${S.user}! ${open ? `${open} quest${open > 1 ? 's' : ''} left today.` : 'All quests done. GG!'}`;
  $('#questList').innerHTML = GROUPS.map(([kind, name]) => {
    const items = S.today.filter((t) => t.kind === kind); if (!items.length) return '';
    return `<div class="group">${name}</div>` + items.map((t) => `<div class="quest ${t.done ? 'done' : ''}" data-id="${esc(t.id)}" data-project="${esc(t.project || '')}">
      <div class="box" data-check></div><div style="flex:1;min-width:0"><div class="t">${esc(t.title)}</div>${t.why ? `<div class="w">${esc(t.why)}</div>` : ''}</div><span class="tag ${kind}">${kind.toUpperCase()}</span></div>`).join('');
  }).join('') || '<div class="card">No quests. Go touch grass. 🌱</div>';
}
$('#questList').addEventListener('click', (e) => {
  const q = e.target.closest('.quest'); if (!q) return;
  if (e.target.closest('[data-check]')) {
    const t = S.today.find((x) => x.id === q.dataset.id); t.done = !t.done;
    if (t.done) { SFX.xp(); toast('Quest complete!', t.title, '#55ff55'); if (world) burst(new THREE.Vector3(0, PY + 4, 0), '#7efc20', 18, 5); } else SFX.click();
    renderQuests(); renderHud();
    drawTag(world.userData.coreTag, 'TODAY', `${S.today.filter((t) => !t.done).length} quests · ${S.stats.waiting} need you`, '#ffff55', 1.1);
    if (!DEMO) fetch('/api/done', { method: 'POST', body: JSON.stringify({ id: t.id, done: t.done }) });
    return;
  }
  if (q.dataset.project && plots.has(q.dataset.project)) focusPlot(q.dataset.project);
});
function md(s) {
  const inline = (x) => esc(x).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\[\[([^\]]+)\]\]/g, '<code>$1</code>').replace(/(https?:\/\/[^\s<)]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
  let out = '', list = false;
  for (const raw of String(s || '').split('\n')) {
    const l = raw.trimEnd(), li = l.match(/^\s*(?:[-*]|\d+\.)\s+(.*)/);
    if (li) { if (!list) { out += '<ul>'; list = true; } out += `<li>${inline(li[1])}</li>`; continue; }
    if (list) { out += '</ul>'; list = false; }
    const h = l.match(/^#{1,3}\s+(.*)/);
    if (h) out += `<h3>${inline(h[1])}</h3>`; else if (l.trim()) out += `<p>${inline(l)}</p>`;
  }
  return out + (list ? '</ul>' : '');
}
$('#btnBrief').addEventListener('click', async () => {
  const b = $('#btnBrief'); b.disabled = true; b.textContent = '✦ CLAUDE IS THINKING…'; SFX.click();
  try {
    const r = DEMO ? await new Promise((ok) => setTimeout(() => ok({ text: DEMO_BRIEF }), 1200)) : await fetch('/api/brief', { method: 'POST', body: JSON.stringify({ force: !!$('#briefOut').innerHTML }) }).then((r) => r.json());
    $('#briefOut').innerHTML = r.error ? `<div class="card">Couldn’t reach Claude: ${esc(r.error)}</div>` : `<div class="card md">${md(r.text)}</div>`;
    if (!r.error) SFX.achieve();
  } catch (e) { $('#briefOut').innerHTML = `<div class="card">${esc(e.message)}</div>`; }
  b.disabled = false; b.textContent = '✦ ASK CLAUDE AGAIN';
});

/* ---------- plot panel ---------- */
let openPlot = null, tab = 'info';
function renderPlot(id, keep) {
  const p = S.projects.find((x) => x.id === id); if (!p) return;
  const st = plots.get(id)?.st || p.status, col = STATUS[st].c;
  const here = S.agents.filter((a) => a.project === id);
  const body = $('#plotBody'), top = body.scrollTop;
  let content = '';
  if (tab === 'info') {
    content = here.map((a) => `<div class="card"><span class="state" style="color:${STATUS[a.state].c}">${STATUS[a.state].label.toUpperCase()}</span>
        <div style="margin-top:8px">🤖 ${esc(a.title)}</div>${a.question ? `<div class="md" style="color:var(--orange)">Claude asked: ${esc(a.question)}</div>` : ''}
        ${a.lastPrompt ? `<div style="color:var(--dim);font-size:19px;margin-top:4px">You: ${esc(a.lastPrompt)}</div>` : ''}</div>`).join('')
      + (p.notes ? `<div class="card md">${md(p.notes.text.slice(0, 2200))}</div>` : '')
      + `<div class="card"><dl class="kv"><dt>Last active</dt><dd>${ago(p.lastTs)}</dd><dt>Sessions</dt><dd>${p.sessions.length}</dd>
         <dt>Git</dt><dd>${p.git ? `${p.git.dirty ? `${p.git.dirty} uncommitted` : 'clean'}${p.git.ahead ? ` · ${p.git.ahead} to push` : ''}` : 'not a repo'}</dd></dl></div>`;
  } else if (tab === 'log') {
    content = `<div class="card feed">${p.activity.map((a) => `<div class="row"><time>${hhmm(a.ts)}</time><div><b>${esc(toolName(a.tool))}</b><span>${esc(a.detail)}</span></div></div>`).join('') || 'Nothing logged yet.'}</div>`;
  } else if (tab === 'sessions') {
    content = p.sessions.map((s) => `<div class="card"><div>${esc(s.title)}</div><div style="color:var(--dim);font-size:19px">${ago(s.lastTs)} · ${s.weight} touches</div>
      <div class="copy" data-copy="claude --resume ${esc(s.id)}" title="Click to copy">&gt; claude --resume ${esc(s.id.slice(0, 8))}…</div></div>`).join('') || '<div class="card">No sessions yet.</div>';
  } else {
    const g = p.git;
    content = g ? `<div class="card"><dl class="kv"><dt>Branch</dt><dd>${esc(g.branch)}</dd><dt>Remote</dt><dd>${g.remote ? `<a href="${esc(g.remote)}" target="_blank" style="color:var(--blue)">${esc(g.remote)}</a>` : 'none'}</dd><dt>Uncommitted</dt><dd>${g.dirty}</dd><dt>To push</dt><dd>${g.ahead ?? '—'}</dd></dl></div>
      ${g.changes.length ? `<div class="card" style="font-size:19px">${g.changes.map(esc).join('<br>')}</div>` : ''}
      <div class="card feed">${g.commits.map((c) => `<div class="row"><time>${esc(c.h)}</time><div>${esc(c.s)} <span>· ${ago(c.t)}</span></div></div>`).join('')}</div>` : '<div class="card">Not a git repository.</div>';
  }
  body.innerHTML = `<div class="p-title">${esc(p.name)}</div>
    <span class="state" style="color:${col}">${STATUS[st].label.toUpperCase()}</span>
    <div class="p-path" data-copy="${esc(p.root)}" title="Click to copy">${esc(p.root)}</div>
    <div class="p-links"><button class="mcbtn" data-open="${esc(p.root)}">OPEN FOLDER</button>
      ${p.live ? `<a class="mcbtn" href="${esc(p.live)}" target="_blank" rel="noopener">LIVE SITE ↗</a>` : ''}
      ${p.git?.remote ? `<a class="mcbtn" href="${esc(p.git.remote)}" target="_blank" rel="noopener">REPO ↗</a>` : ''}</div>
    <div class="tabs">${['info', 'log', 'sessions', 'git'].map((t) => `<button class="mcbtn ${t === tab ? 'on' : ''}" data-tab="${t}">${t.toUpperCase()}</button>`).join('')}</div>
    ${content}`;
  if (keep) body.scrollTop = top;
}
$('#plotBody').addEventListener('click', (e) => {
  const t = e.target.closest('[data-tab]'); if (t) { SFX.click(); tab = t.dataset.tab; renderPlot(openPlot); return; }
  const o = e.target.closest('[data-open]'); if (o) { SFX.click(); if (DEMO) toast('Demo mode', 'Opening folders works when HQ runs on your PC', '#55ccff'); else fetch('/api/open', { method: 'POST', body: JSON.stringify({ root: o.dataset.open }) }); return; }
  const c = e.target.closest('[data-copy]'); if (c) { navigator.clipboard.writeText(c.dataset.copy); toast('Copied!', c.dataset.copy.slice(0, 40), '#55ccff'); }
});
function openPanel(id) { openPlot = id; tab = 'info'; renderPlot(id); $('#plot').classList.add('open'); renderHud(); }
function closeDrawer(w) { $('#' + w).classList.remove('open'); if (w === 'plot') { openPlot = null; renderHud(); } }
document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => { SFX.click(); closeDrawer(b.dataset.close); }));
const toggleQuests = (on) => $('#quests').classList.toggle('open', on ?? !$('#quests').classList.contains('open'));
$('#btnQuests').addEventListener('click', () => { SFX.click(); toggleQuests(); });
$('#btnSound').addEventListener('click', () => { soundOn = !soundOn; localStorage.setItem('hq-sound', soundOn ? 'on' : 'off'); $('#btnSound').style.opacity = soundOn ? 1 : .5; SFX.click(); });
$('#btnSound').style.opacity = soundOn ? 1 : .5;
$('#btnTime').addEventListener('click', () => { const order = ['auto', 'day', 'sunset', 'night']; timeMode = order[(order.indexOf(timeMode) + 1) % 4]; SFX.click(); toast('Time set', timeMode === 'auto' ? 'Following your clock' : timeMode, '#ffff55'); });

/* ---------- toasts (achievement style) ---------- */
function toast(h, b, color) {
  const d = document.createElement('div'); d.className = 'toast';
  d.innerHTML = `<div class="ic" style="background:${color}"></div><div><div class="h">${esc(h)}</div><div class="b">${esc(b)}</div></div>`;
  $('#toasts').appendChild(d); setTimeout(() => d.remove(), 5100);
  while ($('#toasts').children.length > 4) $('#toasts').firstChild.remove();
}

/* ---------- /tp command bar ---------- */
let cmdSel = 0, cmdItems = [];
function openCmd() { $('#cmd').classList.remove('hidden'); $('#cmdInput').value = ''; cmdSel = 0; renderCmd(); setTimeout(() => $('#cmdInput').focus(), 0); }
function closeCmd() { $('#cmd').classList.add('hidden'); }
function renderCmd() {
  const q = $('#cmdInput').value.toLowerCase();
  cmdItems = [
    { label: 'spawn', sub: 'fly home', act: () => flyHome() },
    { label: 'me', sub: 'back to your Clawd', act: () => { follow = true; } },
    { label: 'quests', sub: 'open the quest log', act: () => toggleQuests(true) },
    ...S.projects.map((p) => ({ label: p.name, sub: STATUS[plots.get(p.id)?.st || p.status].label, act: () => focusPlot(p.id) })),
    ...S.agents.map((a) => ({ label: a.title, sub: `agent · ${STATUS[a.state].label}`, act: () => (a.project && plots.has(a.project) ? focusPlot(a.project) : flyTo(new THREE.Vector3(0, PY, 0), 14)) })),
  ].filter((x) => !q || x.label.toLowerCase().includes(q)).slice(0, 10);
  cmdSel = Math.min(cmdSel, Math.max(0, cmdItems.length - 1));
  $('#cmdList').innerHTML = cmdItems.map((x, i) => `<div class="opt ${i === cmdSel ? 'sel' : ''}" data-i="${i}"><span>${esc(x.label)}</span><small>${esc(x.sub)}</small></div>`).join('');
}
$('#cmdInput').addEventListener('input', () => { cmdSel = 0; renderCmd(); });
$('#cmdList').addEventListener('mousedown', (e) => { const o = e.target.closest('.opt'); if (o) { e.preventDefault(); cmdItems[+o.dataset.i].act(); closeCmd(); } });
$('#cmdInput').addEventListener('blur', () => setTimeout(closeCmd, 120));
$('#btnCmd').addEventListener('click', () => { SFX.click(); openCmd(); });
addEventListener('keydown', (e) => {
  const cmdOpen = !$('#cmd').classList.contains('hidden');
  if (!$('#title').classList.contains('gone')) { if (e.key === 'Enter' || e.key === ' ') enterWorld(); return; }
  if (cmdOpen) {
    if (e.key === 'ArrowDown') { cmdSel = Math.min(cmdSel + 1, cmdItems.length - 1); renderCmd(); e.preventDefault(); }
    if (e.key === 'ArrowUp') { cmdSel = Math.max(cmdSel - 1, 0); renderCmd(); e.preventDefault(); }
    if (e.key === 'Enter' && cmdItems[cmdSel]) { cmdItems[cmdSel].act(); closeCmd(); }
    if (e.key === 'Escape') closeCmd();
    return;
  }
  if (e.target.closest?.('input')) return;
  const kk = e.key.toLowerCase();
  if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift'].includes(kk)) { keys.add(kk); if (kk.startsWith('arrow')) e.preventDefault(); return; }
  if (kk === ' ') { e.preventDefault(); if (!player.jumpY) { player.vy = 7.5; beep([392, 523], 'square', .05, .03); } return; }
  if (kk === 'e') { interact(); return; }
  if (e.key === '/' || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k')) { e.preventDefault(); openCmd(); return; }
  if (e.key.toLowerCase() === 'q' || e.key.toLowerCase() === 't') { SFX.click(); toggleQuests(); }
  if (e.key === 'Escape') { closeDrawer('plot'); closeDrawer('quests'); flyHome(); }
  if (/^[1-9]$/.test(e.key)) { const p = S.projects[+e.key - 1]; if (p) { SFX.click(); focusPlot(p.id); } }
});

/* ============================== camera ============================== */
let fly = null, followAfterFly = false;
const HOME = { pos: new THREE.Vector3(0, 30, 42), target: new THREE.Vector3(0, 4, 0) };
function flyTo(target, dist, dir) {
  const out = dir ? dir.clone() : target.clone().setY(0); if (out.lengthSq() < 1) out.set(0, 0, 1); out.normalize();
  const toP = target.clone().add(out.multiplyScalar(dist)).add(new THREE.Vector3(0, dist * .6, 0));
  fly = { fromP: camera.position.clone(), fromT: controls.target.clone(), toP, toT: target.clone().setY(target.y + 2.5), t: 0, dur: 1.2 };
}
function homeView() { const t = player.g.position.clone().add(new THREE.Vector3(0, 1.4, 0)); return { pos: t.clone().add(new THREE.Vector3(0, 11, 16)), target: t }; }
function flyHome() { follow = false; const hv = homeView(); HOME.pos.copy(hv.pos); HOME.target.copy(hv.target); followAfterFly = true;  fly = { fromP: camera.position.clone(), fromT: controls.target.clone(), toP: HOME.pos.clone(), toT: HOME.target.clone(), t: 0, dur: 1.2 }; }
function focusPlot(id) {
  const pl = plots.get(id); if (!pl) return;
  follow = false;
  flyTo(new THREE.Vector3(pl.x, PY, pl.z), 13, new THREE.Vector3(pl.front[0] + pl.x * .02, 0, pl.front[1] + pl.z * .02));
  openPanel(id);
}

/* ============================== picking ============================== */
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
let hovered = null, downAt = null, idleT = 0;
function pick(x, y) {
  ndc.set((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1); ray.setFromCamera(ndc, camera);
  const objs = [...hitBoxes, ...[...agents.values()].map((a) => a.g)];
  for (const h of ray.intersectObjects(objs, true)) { let o = h.object; while (o && !o.userData.hit) o = o.parent; if (o) return o.userData.hit; }
  return null;
}
const tip = $('#tooltip');
function showTip(x, y, title, sub) { tip.innerHTML = `<b>${esc(title)}</b>${sub ? `<span>${esc(sub)}</span>` : ''}`; tip.style.left = x + 14 + 'px'; tip.style.top = y + 14 + 'px'; tip.classList.add('on'); }
canvas.addEventListener('pointermove', (e) => {
  const h = pick(e.clientX, e.clientY); hovered = h;
  canvas.style.cursor = h ? 'pointer' : 'default';
  plots.forEach((pl) => (pl.sel.visible = h?.type === 'plot' && h.id === pl.p.id));
  if (!h) { tip.classList.remove('on'); hoverName = ''; return; }
  if (h.type === 'plot') { const pl = plots.get(h.id); hoverName = pl.p.name; showTip(e.clientX, e.clientY, pl.p.name, `${STATUS[pl.st].label} · ${ago(pl.p.lastTs)}${pl.p.git?.dirty ? ` · ${pl.p.git.dirty} uncommitted` : ''}`); }
  if (h.type === 'agent') { const a = agents.get(h.id).a; hoverName = a.title; showTip(e.clientX, e.clientY, '🤖 ' + a.title, `${STATUS[a.state].label}${a.activity[0] ? ` · ${toolName(a.activity[0].tool)} ${String(a.activity[0].detail || '').slice(0, 30)}` : ''}`); }
  if (h.type === 'core') { hoverName = 'Beacon of Today'; showTip(e.clientX, e.clientY, 'Beacon of Today', `${S.today.filter((t) => !t.done).length} quests · click to open`); }
});
$('#hotbar').addEventListener('mousemove', (e) => { const s = e.target.closest('.slot'); if (!s) return tip.classList.remove('on'); const [a, b] = s.dataset.tip.split('|'); showTip(e.clientX, e.clientY - 70, a, b); });
$('#hotbar').addEventListener('mouseleave', () => tip.classList.remove('on'));
canvas.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; idleT = 0; });
canvas.addEventListener('pointerup', (e) => {
  if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 6) return;
  const h = pick(e.clientX, e.clientY); if (!h) return;
  SFX.click();
  if (h.type === 'plot') focusPlot(h.id);
  if (h.type === 'agent') { const a = agents.get(h.id).a; if (a.project && plots.has(a.project)) focusPlot(a.project); }
  if (h.type === 'core') { toggleQuests(true); burst(new THREE.Vector3(0, PY + 4, 0), '#ffd28a', 14, 5); }
});
canvas.addEventListener('pointerleave', () => tip.classList.remove('on'));

/* ============================== loop ============================== */
const clock = new THREE.Clock();
let entered = false, f3At = 0;
function frame() {
  const dt = Math.min(clock.getDelta(), .05), t = clock.elapsedTime;
  updateSky(t);
  T.water.offset.set((t * .01) % 1, (t * .006) % 1);

  if (!entered) {                       // title screen: slow panorama around the island
    const a = t * .06;
    camera.position.set(Math.cos(a) * 62, 30, Math.sin(a) * 62); controls.target.set(0, 4, 0); camera.lookAt(controls.target);
  } else if (fly) {
    fly.t = Math.min(1, fly.t + dt / fly.dur); const e = ease(fly.t);
    camera.position.lerpVectors(fly.fromP, fly.toP, e); controls.target.lerpVectors(fly.fromT, fly.toT, e);
    if (fly.t >= 1) { fly = null; if (followAfterFly) { follow = true; followAfterFly = false; } }
  }
  if (entered) { idleT += dt; controls.autoRotate = !REDUCED && idleT > 30 && !fly && !openPlot; controls.update(); }

  if (world) {
    const { coreCube, coreBeam } = world.userData;
    coreCube.rotation.y += dt * 1.2; coreCube.rotation.x += dt * .7;
    coreBeam.material.opacity = .42 + Math.sin(t * 3) * .08;
    for (const pl of plots.values()) {
      const on = pl.st === 'working' ? .55 : pl.st === 'waiting' ? .35 + Math.sin(t * 5) * .15 : 0;
      pl.beam.material.opacity = lerp(pl.beam.material.opacity, on, .08);
      pl.beam.visible = pl.beam.material.opacity > .01;
      pl.bang.position.y = 10.4 + Math.abs(Math.sin(t * 4)) * .5;
      const [bw, bh] = pl.tag.userData.base || [10.5, 1.97], kd = clamp(camera.position.distanceTo(pl.g.position) / 34, .32, 1);
      pl.tag.scale.set(bw * kd, bh * kd, 1);
    }
  }

  for (const ag of agents.values()) {
    const st = ag.a.state;
    if ((st === 'idle' || st === 'resting') && t > ag.wanderAt) { ag.wanderAt = t + 7 + Math.random() * 9; ag.target.copy(Math.random() < .35 ? seatFor(ag.a, 0, 1).pos : wanderTarget()); }
    const p = ag.g.position, d = ag.target.clone().sub(p); d.y = 0;
    const dist = d.length(), moving = dist > .12;
    if (moving) {
      p.addScaledVector(d.normalize(), Math.min(dist, dt * (st === 'working' || st === 'waiting' ? 3.6 : 2.2)));
      ag.g.rotation.y += (((Math.atan2(d.x, d.z) - ag.g.rotation.y + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * .25;
    } else {
      const want = st === 'waiting' ? Math.atan2(camera.position.x - p.x, camera.position.z - p.z) : ag.face;
      ag.g.rotation.y += (((want - ag.g.rotation.y + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * .1;
    }
    p.y = lerp(p.y, heightAt(p.x, p.z), .25);
    animateClawd(ag, st, moving, t, dt);
    if (!moving && st === 'working' && t > ag.nextDust) {   // bits fly off the house it's working on
      ag.nextDust = t + .28;
      burst(p.clone().add(new THREE.Vector3(Math.sin(ag.g.rotation.y) * 1.1, 1.0, Math.cos(ag.g.rotation.y) * 1.1)), Math.random() < .5 ? '#a27f4e' : CLAWD_ORANGE, 3, 2.4);
    }
  }
  if (entered) updatePlayer(dt, t);
  updateParticles(dt);
  if (t > f3At) { f3At = t + .5; renderF3(); }
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
addEventListener('blur', () => keys.clear());
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight, false); });

/* ============================== boot + title screen ============================== */
window.__hq = { renderer, scene, camera, controls, player, agents };
document.body.classList.add('titled');
let DEMO = params.has('demo');
let first = null;
if (!DEMO) { try { const r = await fetch('/api/state'); if (r.ok) first = await r.json(); } catch (_) {} }
if (!first) { DEMO = true; first = buildDemo(); }
if (DEMO) document.body.classList.add('demo');
applyState(first);
drawTag(player.tag, first.user, 'YOU', '#ffff55', .55);
// the title-screen Clawd, drawn from the same sprite as Claude Code's banner
{
  const g = $('#clawdArt').getContext('2d'); g.fillStyle = CLAWD_ORANGE;
  ['...############...', '...##.######.##...', '.################.', '...############...', '....#.#....#.#....']
    .forEach((row, y) => [...row].forEach((ch, x) => ch === '#' && g.fillRect(x, y, 1, 1)));
}
requestAnimationFrame(frame);
const splashes = () => {
  const open = S.today.filter((t) => !t.done).length;
  return [`${greeting()}, ${S.user}!`, `${open} quests today!`, `${S.stats.working} agent${S.stats.working === 1 ? '' : 's'} online!`, S.stats.waiting ? `${S.stats.waiting} waiting on you!` : 'Nobody is waiting on you!', 'Now with Clawds!', DEMO ? 'Demo city!' : '100% local!', 'Ship it!'];
};
let si = 0;
const showSplash = () => { if (!S) return; const list = splashes(); $('#splash').textContent = list[si++ % list.length]; };
showSplash(); const splashTimer = setInterval(showSplash, 3200);
$('#titleInfo').textContent = DEMO ? 'Demo data · run it on your PC to see your own Claude agents' : `Agents: ${first.stats.working} working · ${first.stats.waiting} waiting`;
function enterWorld(quests) {
  if (entered) return;
  entered = true; clearInterval(splashTimer); SFX.achieve();
  $('#title').classList.add('gone'); document.body.classList.remove('titled');
  const hv = homeView(); HOME.pos.copy(hv.pos); HOME.target.copy(hv.target); followAfterFly = true;
  fly = { fromP: camera.position.clone(), fromT: controls.target.clone(), toP: HOME.pos.clone(), toT: HOME.target.clone(), t: 0, dur: 2.2 };
  const seen = localStorage.getItem('hq-day');
  if (quests || seen !== S.date || S.stats.waiting) setTimeout(() => toggleQuests(true), quests ? 300 : 1600);
  try { localStorage.setItem('hq-day', S.date); } catch (_) {}
}
$('#enter').addEventListener('click', () => enterWorld(false));
$('#enterQuests').addEventListener('click', () => enterWorld(true));
if (params.has('skip')) enterWorld(false);
if (params.get('view')) {          // ?view=camX,camY,camZ,targetX,targetY,targetZ — a fixed camera, handy for screenshots
  const v = params.get('view').split(',').map(Number); fly = null;
  camera.position.set(v[0], v[1], v[2]); controls.target.set(v[3], v[4], v[5]); controls.update();
}

if (DEMO) {                      // the demo city ticks along on its own
  $('#live').textContent = '● DEMO'; $('#live').title = 'Sample data. Run Claude HQ locally to see your own agents.';
  setInterval(() => applyState(tickDemo(S)), 5000);
} else {
  const es = new EventSource('/api/events');
  es.addEventListener('state', (e) => applyState(JSON.parse(e.data)));
  es.onopen = () => $('#live').classList.remove('off');
  es.onerror = () => $('#live').classList.add('off');
}
