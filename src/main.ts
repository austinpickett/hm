import "./style.css";
import { layoutNextLine, prepareWithSegments } from "@chenglou/pretext";
import type { LayoutCursor, PreparedTextWithSegments } from "@chenglou/pretext";
import { HEADLINE_TEXT, BODY_TEXT } from "./text.ts";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const BODY_FONT = '17px "Instrument Serif", Georgia, "Times New Roman", serif';
const BODY_LINE_HEIGHT = 28;
const GUTTER = 48;
const BOTTOM_GAP = 20;
const MIN_SLOT_WIDTH = 50;
const NARROW_BP = 760;
const WIDE_BP = 1400;
const NARROW_GUTTER = 20;
const NARROW_BOTTOM_GAP = 16;
const GADGET_SCALE = 0.58;
const NARROW_GADGET_SCALE = 0.38;
const SILHOUETTE_PAD = 14;

const GADGET_NAMES = ["GameBoy_Pix", "Nokia_Pix"];

const gadgetDefs: GadgetDef[] = [
  { fx: 0.38, fy: 0.4, r: 75, vx: 14, vy: 8, rotSpeed: 0.35 },
  { fx: 0.68, fy: 0.65, r: 65, vx: -12, vy: -14, rotSpeed: -0.4 },
];

const stage = document.getElementById("stage")!;
const headlineEl = document.getElementById("headline")!;
headlineEl.textContent = HEADLINE_TEXT;

const threeCanvas = document.createElement("canvas");
threeCanvas.id = "three";
document.body.insertBefore(threeCanvas, stage);

const renderer = new THREE.WebGLRenderer({
  canvas: threeCanvas,
  alpha: true,
  antialias: true,
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.6;

const scene = new THREE.Scene();

const camera = new THREE.OrthographicCamera(
  -window.innerWidth / 2,
  window.innerWidth / 2,
  window.innerHeight / 2,
  -window.innerHeight / 2,
  0.1,
  2000,
);
camera.position.set(0, 0, 500);
camera.lookAt(0, 0, 0);

const ambientLight = new THREE.AmbientLight(0xffffff, 1.2);
scene.add(ambientLight);

const dirLight = new THREE.DirectionalLight(0xffffff, 2.2);
dirLight.position.set(200, 300, 400);
scene.add(dirLight);

const rimLight = new THREE.DirectionalLight(0xcccccc, 0.6);
rimLight.position.set(-200, -100, -200);
scene.add(rimLight);

const W0 = window.innerWidth;
const H0 = window.innerHeight;

const gadgets: Gadget[] = gadgetDefs.map((d) => ({
  x: d.fx * W0,
  y: d.fy * H0,
  r: d.r,
  vx: d.vx,
  vy: d.vy,
  paused: false,
  rotSpeed: d.rotSpeed,
  mesh: null,
  screenVerts: [] as ScreenVert[],
}));

let modelsLoaded = false;

const loader = new GLTFLoader();
loader.load("/gameboy/scene.gltf", (gltf) => {
  const root = gltf.scene;

  for (let i = 0; i < GADGET_NAMES.length; i++) {
    const name = GADGET_NAMES[i]!;
    const node = root.getObjectByName(name);
    if (!node) continue;

    const clone = node.clone(true);

    const box = new THREE.Box3().setFromObject(clone);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    clone.position.sub(center);

    const wrapper = new THREE.Group();
    wrapper.add(clone);

    const maxDim = Math.max(size.x, size.y, size.z);
    const targetSize = gadgetDefs[i]!.r * 1.4;
    const s = targetSize / maxDim;
    wrapper.scale.set(s, s, s);

    scene.add(wrapper);
    gadgets[i]!.mesh = wrapper;
  }

  modelsLoaded = true;
  scheduleRender();
});

const _projVec = new THREE.Vector3();

function projectMeshToScreen(
  group: THREE.Group,
  pw: number,
  ph: number,
): ScreenVert[] {
  const verts: ScreenVert[] = [];
  const halfW = pw / 2;
  const halfH = ph / 2;

  group.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const geo = child.geometry;
    const pos = geo.attributes.position;
    if (!pos) return;

    child.updateWorldMatrix(true, false);
    const mat = child.matrixWorld;

    for (let j = 0; j < pos.count; j++) {
      _projVec.set(pos.getX(j), pos.getY(j), pos.getZ(j));
      _projVec.applyMatrix4(mat);
      _projVec.project(camera);
      verts.push({
        sx: (1 + _projVec.x) * halfW,
        sy: (1 - _projVec.y) * halfH,
      });
    }
  });

  return verts;
}

function silhouetteInterval(
  verts: ScreenVert[],
  bandTop: number,
  bandBottom: number,
  pad: number,
): Interval | null {
  let minX = Infinity,
    maxX = -Infinity;
  let found = false;

  for (let i = 0; i < verts.length; i++) {
    const v = verts[i]!;
    if (v.sy >= bandTop - pad && v.sy <= bandBottom + pad) {
      if (v.sx < minX) minX = v.sx;
      if (v.sx > maxX) maxX = v.sx;
      found = true;
    }
  }

  if (!found) return null;
  return { left: minX - pad, right: maxX + pad };
}

await document.fonts.ready;
const prepared = prepareWithSegments(BODY_TEXT, BODY_FONT, {
  whiteSpace: "pre-wrap",
});

const linePool: HTMLSpanElement[] = [];

function carveSlots(base: Interval, blocked: Interval[]): Interval[] {
  let slots = [base];
  for (let i = 0; i < blocked.length; i++) {
    const b = blocked[i]!;
    const next: Interval[] = [];
    for (let j = 0; j < slots.length; j++) {
      const s = slots[j]!;
      if (b.right <= s.left || b.left >= s.right) {
        next.push(s);
        continue;
      }
      if (b.left > s.left) next.push({ left: s.left, right: b.left });
      if (b.right < s.right) next.push({ left: b.right, right: s.right });
    }
    slots = next;
  }
  return slots.filter((s) => s.right - s.left >= MIN_SLOT_WIDTH);
}

function layoutColumn(
  prep: PreparedTextWithSegments,
  startCursor: LayoutCursor,
  rx: number,
  ry: number,
  rw: number,
  rh: number,
  lh: number,
  gadgetList: Gadget[],
  pad: number,
): { lines: PosLine[]; cursor: LayoutCursor } {
  let cursor: LayoutCursor = startCursor;
  let lineTop = ry;
  const lines: PosLine[] = [];
  let done = false;
  while (lineTop + lh <= ry + rh && !done) {
    const bt = lineTop,
      bb = lineTop + lh;
    const blocked: Interval[] = [];
    for (let i = 0; i < gadgetList.length; i++) {
      const g = gadgetList[i]!;
      const iv = silhouetteInterval(g.screenVerts, bt, bb, pad);
      if (iv !== null) blocked.push(iv);
    }
    const slots = carveSlots({ left: rx, right: rx + rw }, blocked);
    if (slots.length === 0) {
      lineTop += lh;
      continue;
    }
    const ordered = [...slots].sort((a, b) => a.left - b.left);
    for (let i = 0; i < ordered.length; i++) {
      const s = ordered[i]!;
      const line = layoutNextLine(prep, cursor, s.right - s.left);
      if (line === null) {
        done = true;
        break;
      }
      lines.push({
        x: Math.round(s.left),
        y: Math.round(lineTop),
        text: line.text,
        width: line.width,
      });
      cursor = line.end;
    }
    lineTop += lh;
  }
  return { lines, cursor };
}

function hitGadgets(
  px: number,
  py: number,
  count: number,
  scale: number,
): number {
  for (let i = count - 1; i >= 0; i--) {
    const g = gadgets[i]!;
    const r = g.r * scale;
    const dx = px - g.x,
      dy = py - g.y;
    if (dx * dx + dy * dy <= r * r) return i;
  }
  return -1;
}

let pointer: Pt = { x: -9999, y: -9999 };
let drag: DragState | null = null;
let evDown: Pt | null = null;
let evMove: Pt | null = null;
let evUp: Pt | null = null;
let lastFrame: number | null = null;

function isTextTarget(t: EventTarget | null): boolean {
  return t instanceof Element && t.closest(".line") !== null;
}

stage.addEventListener("pointerdown", (e) => {
  if (isTextTarget(e.target)) return;
  const narrow = window.innerWidth < NARROW_BP;
  const gs = narrow ? NARROW_GADGET_SCALE : GADGET_SCALE;
  const hit = hitGadgets(e.clientX, e.clientY, gadgets.length, gs);
  if (hit !== -1) e.preventDefault();
  evDown = { x: e.clientX, y: e.clientY };
  scheduleRender();
});
stage.addEventListener(
  "touchmove",
  (e) => {
    e.preventDefault();
  },
  { passive: false },
);
window.addEventListener("pointermove", (e) => {
  evMove = { x: e.clientX, y: e.clientY };
  scheduleRender();
});
window.addEventListener("pointerup", (e) => {
  evUp = { x: e.clientX, y: e.clientY };
  scheduleRender();
});
window.addEventListener("pointercancel", (e) => {
  evUp = { x: e.clientX, y: e.clientY };
  scheduleRender();
});
window.addEventListener("resize", () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.left = -window.innerWidth / 2;
  camera.right = window.innerWidth / 2;
  camera.top = window.innerHeight / 2;
  camera.bottom = -window.innerHeight / 2;
  camera.updateProjectionMatrix();
  scheduleRender();
});

function syncPool(pool: HTMLSpanElement[], count: number): void {
  while (pool.length < count) {
    const el = document.createElement("span");
    el.className = "line";
    stage.appendChild(el);
    pool.push(el);
  }
  for (let i = 0; i < pool.length; i++)
    pool[i]!.style.display = i < count ? "" : "none";
}

const GLITCH_CHARS = "░▒▓█▄▀╬╫╪┼┤├─│┌┐└┘@#$%&";
let lastLineCount = 0;

function glitchRandomLine(): void {
  if (lastLineCount === 0) return;
  const idx = Math.floor(Math.random() * lastLineCount);
  const span = linePool[idx];
  if (!span || span.style.display === "none") return;
  const original = span.textContent ?? "";
  if (original.trim().length === 0) return;
  const chars = [...original];
  const n = 2 + Math.floor(Math.random() * 6);
  for (let i = 0; i < n; i++) {
    const pos = Math.floor(Math.random() * chars.length);
    if (chars[pos] === " " || chars[pos] === "\n") continue;
    chars[pos] = GLITCH_CHARS[Math.floor(Math.random() * GLITCH_CHARS.length)]!;
  }
  span.textContent = chars.join("");
  span.style.color = `rgba(255, 255, 255, 0.95)`;
  setTimeout(
    () => {
      span.textContent = original;
      span.style.color = "";
    },
    60 + Math.random() * 80,
  );
}

function scheduleGlitch(): void {
  setTimeout(
    () => {
      glitchRandomLine();
      scheduleGlitch();
    },
    3000 + Math.random() * 3000,
  );
}
scheduleGlitch();

let raf: number | null = null;
function scheduleRender(): void {
  if (raf !== null) return;
  raf = requestAnimationFrame(function frame(now) {
    raf = null;
    if (render(now)) scheduleRender();
  });
}

let prevLines: PosLine[] = [];

function posLinesEq(a: PosLine[], b: PosLine[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const l = a[i]!,
      r = b[i]!;
    if (l.x !== r.x || l.y !== r.y || l.text !== r.text) return false;
  }
  return true;
}

function render(now: number): boolean {
  const pw = document.documentElement.clientWidth;
  const ph = document.documentElement.clientHeight;
  const narrow = pw < NARROW_BP;
  const wide = pw >= WIDE_BP;
  const gutter = narrow ? NARROW_GUTTER : GUTTER;
  const bottomGap = narrow ? NARROW_BOTTOM_GAP : BOTTOM_GAP;
  const gScale = narrow ? NARROW_GADGET_SCALE : GADGET_SCALE;

  if (evDown !== null) {
    pointer = evDown;
    if (drag === null) {
      const idx = hitGadgets(pointer.x, pointer.y, gadgets.length, gScale);
      if (idx !== -1) {
        const g = gadgets[idx]!;
        drag = { idx, spx: pointer.x, spy: pointer.y, sox: g.x, soy: g.y };
      }
    }
  }
  if (evMove !== null) {
    pointer = evMove;
    if (drag !== null) {
      const g = gadgets[drag.idx]!;
      g.x = drag.sox + (pointer.x - drag.spx);
      g.y = drag.soy + (pointer.y - drag.spy);
    }
  }
  if (evUp !== null) {
    pointer = evUp;
    if (drag !== null) {
      const dx = pointer.x - drag.spx,
        dy = pointer.y - drag.spy;
      const g = gadgets[drag.idx]!;
      if (dx * dx + dy * dy < 16) g.paused = !g.paused;
      else {
        g.x = drag.sox + dx;
        g.y = drag.soy + dy;
      }
      drag = null;
    }
  }
  evDown = evMove = evUp = null;

  const dragIdx = drag?.idx ?? -1;
  const lf = lastFrame ?? now;
  const dt = Math.min((now - lf) / 1000, 0.05);
  let animating = false;

  for (let i = 0; i < gadgets.length; i++) {
    const g = gadgets[i]!;
    const r = g.r * gScale;
    if (g.paused || i === dragIdx) continue;
    animating = true;
    g.x += g.vx * dt;
    g.y += g.vy * dt;
    if (g.x - r < 0) {
      g.x = r;
      g.vx = Math.abs(g.vx);
    }
    if (g.x + r > pw) {
      g.x = pw - r;
      g.vx = -Math.abs(g.vx);
    }
    if (g.y - r < gutter * 0.5) {
      g.y = r + gutter * 0.5;
      g.vy = Math.abs(g.vy);
    }
    if (g.y + r > ph - bottomGap) {
      g.y = ph - bottomGap - r;
      g.vy = -Math.abs(g.vy);
    }
  }

  for (let i = 0; i < gadgets.length; i++) {
    const a = gadgets[i]!,
      ar = a.r * gScale;
    for (let j = i + 1; j < gadgets.length; j++) {
      const b = gadgets[j]!,
        br = b.r * gScale;
      const dx = b.x - a.x,
        dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const minD = ar + br + (narrow ? 12 : 20);
      if (dist >= minD || dist <= 0.1) continue;
      const f = (minD - dist) * 0.8,
        nx = dx / dist,
        ny = dy / dist;
      if (!a.paused && i !== dragIdx) {
        a.vx -= nx * f * dt;
        a.vy -= ny * f * dt;
      }
      if (!b.paused && j !== dragIdx) {
        b.vx += nx * f * dt;
        b.vy += ny * f * dt;
      }
    }
  }

  if (modelsLoaded) {
    for (let i = 0; i < gadgets.length; i++) {
      const g = gadgets[i]!;
      if (!g.mesh) continue;
      const r = g.r * gScale;
      const scaleRatio = (r * 2) / (gadgetDefs[i]!.r * 1.4);
      g.mesh.scale.setScalar(
        (scaleRatio * gadgetDefs[i]!.r * 1.4) / Math.max(1, g.r),
      );

      g.mesh.position.set(g.x - pw / 2, -(g.y - ph / 2), 0);

      if (!g.paused && i !== dragIdx) {
        g.mesh.rotation.y += g.rotSpeed * dt;
        g.mesh.rotation.x += g.rotSpeed * 0.3 * dt;
      }

      g.mesh.visible = true;
      const opacity = g.paused ? 0.5 : 1.0;
      g.mesh.traverse((child) => {
        if (child instanceof THREE.Mesh && child.material) {
          const mat = child.material as THREE.MeshStandardMaterial;
          if (mat.opacity !== opacity) {
            mat.transparent = true;
            mat.opacity = opacity;
          }
        }
      });

      g.mesh.updateMatrixWorld(true);
      g.screenVerts = projectMeshToScreen(g.mesh, pw, ph);
    }
    renderer.render(scene, camera);
  }

  const hlH = narrow ? 30 : 44;
  headlineEl.style.left = `${gutter}px`;
  headlineEl.style.top = `${gutter}px`;
  headlineEl.style.fontSize = `${narrow ? 24 : 36}px`;

  const bodyTop = gutter + hlH + 20;
  const bodyH = ph - bodyTop - bottomGap;
  const numCols = narrow ? 1 : wide ? 3 : 2;
  const colGap = narrow ? 0 : 32;
  const totalGap = colGap * (numCols - 1);
  const colW = Math.floor((pw - gutter * 2 - totalGap) / numCols);
  const pad = narrow ? 8 : SILHOUETTE_PAD;

  let allLines: PosLine[] = [];
  let cursor: LayoutCursor = { segmentIndex: 0, graphemeIndex: 0 };

  for (let col = 0; col < numCols; col++) {
    const colX = gutter + col * (colW + colGap);
    const result = layoutColumn(
      prepared,
      cursor,
      colX,
      bodyTop,
      colW,
      bodyH,
      BODY_LINE_HEIGHT,
      gadgets,
      pad,
    );
    allLines = allLines.concat(result.lines);
    cursor = result.cursor;
  }

  if (!posLinesEq(allLines, prevLines)) {
    syncPool(linePool, allLines.length);
    for (let i = 0; i < allLines.length; i++) {
      const el = linePool[i]!,
        l = allLines[i]!;
      el.textContent = l.text;
      el.style.left = `${l.x}px`;
      el.style.top = `${l.y}px`;
      el.style.font = BODY_FONT;
      el.style.lineHeight = `${BODY_LINE_HEIGHT}px`;
    }
    lastLineCount = allLines.length;
    prevLines = allLines;
  }

  const hovered = hitGadgets(pointer.x, pointer.y, gadgets.length, gScale);
  document.body.style.cursor =
    drag !== null ? "grabbing" : hovered !== -1 ? "grab" : "";

  lastFrame = animating ? now : null;

  return animating || true;
}

scheduleRender();

interface Interval {
  left: number;
  right: number;
}
interface PosLine {
  x: number;
  y: number;
  width: number;
  text: string;
}
interface ScreenVert {
  sx: number;
  sy: number;
}
interface GadgetDef {
  fx: number;
  fy: number;
  r: number;
  vx: number;
  vy: number;
  rotSpeed: number;
}
interface Gadget {
  x: number;
  y: number;
  r: number;
  vx: number;
  vy: number;
  paused: boolean;
  rotSpeed: number;
  mesh: THREE.Group | null;
  screenVerts: ScreenVert[];
}
interface Pt {
  x: number;
  y: number;
}
interface DragState {
  idx: number;
  spx: number;
  spy: number;
  sox: number;
  soy: number;
}
