/* ============================================================
 * PAPER SOCCER — real-time renderer (Canvas2D, HiDPI)
 * Baked pitch texture + dynamic ink, ball, hints, drag arrow,
 * particles, camera shake.
 * ============================================================ */

import { EdgeRec, Pt, PlayerIdx, goalHalf } from "./engine";
import { Particles } from "./fx";
import {
  buildField,
  computeLayout,
  cornerFlagPositions,
  Layout,
  nightMastPositions,
  TEAM,
} from "./field";
import { getArena } from "./arenas";
import { Shake } from "./fx";
import { hashStr } from "./fx";
import { drawEdgeLife, drawCloudShadows } from "./edgelife";
import { drawGoalShow, type GoalShow } from "./celebrate";

/** Neon core and accent colours for glowing strokes and nodes.
 *  Оба выводятся из текущего цвета команды (TEAM), поэтому выбор цвета в меню
 *  сразу перекрашивает и ядро штриха, и широкую ауру вокруг него. */
function hexRgb(hex: string): [number, number, number] {
  const v = hex.replace("#", "");
  const full = v.length === 3 ? v.split("").map((c) => c + c).join("") : v;
  const int = parseInt(full, 16) || 0;
  return [(int >> 16) & 255, (int >> 8) & 255, int & 255];
}

/** Белёсое ядро неона: цвет команды, смешанный с белым на 72%. */
function inkHiOf(hex: string): string {
  const [r, g, b] = hexRgb(hex);
  const mix = (v: number) => Math.round(v + (255 - v) * 0.72);
  return `rgb(${mix(r)},${mix(g)},${mix(b)})`;
}

/** Широкая мягкая аура вокруг линии. */
function glowWideOf(hex: string): string {
  const [r, g, b] = hexRgb(hex);
  return `rgba(${r},${g},${b},0.22)`;
}

type Vec3 = [number, number, number];

/** Мяч «телстар» — усечённый икосаэдр: 60 вершин, 90 рёбер, 12 чёрных
 *  пятиугольников и 20 белых шестиугольников. Геометрия настоящая, поэтому
 *  вершины каждого пятиугольника смотрят ровно на пять соседних
 *  пятиугольников, а швы идут по истинным рёбрам — как на реальном мяче. */
const BALL = (() => {
  const phi = (1 + Math.sqrt(5)) / 2;
  const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

  /** Чётные (циклические) перестановки со всеми комбинациями знаков. */
  const spread = (seeds: Vec3[]): Vec3[] => {
    const out: Vec3[] = [];
    const seen = new Set<string>();
    for (const [a, b, c] of seeds) {
      const cyc: Vec3[] = [
        [a, b, c],
        [b, c, a],
        [c, a, b],
      ];
      for (const [x, y, z] of cyc) {
        for (const sx of [1, -1]) {
          for (const sy of [1, -1]) {
            for (const sz of [1, -1]) {
              const l = Math.hypot(x * sx, y * sy, z * sz);
              const n: Vec3 = [(x * sx) / l, (y * sy) / l, (z * sz) / l];
              const k = n.map((v) => (Math.abs(v) < 1e-9 ? 0 : v).toFixed(5)).join(",");
              if (seen.has(k)) continue;
              seen.add(k);
              out.push(n);
            }
          }
        }
      }
    }
    return out;
  };

  const verts = spread([
    [0, 1, 3 * phi],
    [1, 2 + phi, 2 * phi],
    [phi, 2, 2 * phi + 1],
  ]);
  // 12 осей пятиугольников — направления вершин икосаэдра
  const axes = spread([[0, 1, phi]]);

  const gap = (i: number, j: number) =>
    Math.hypot(verts[i][0] - verts[j][0], verts[i][1] - verts[j][1], verts[i][2] - verts[j][2]);
  let min = Infinity;
  for (let i = 0; i < verts.length; i++) for (let j = i + 1; j < verts.length; j++) min = Math.min(min, gap(i, j));
  const edges: [number, number][] = [];
  for (let i = 0; i < verts.length; i++) {
    for (let j = i + 1; j < verts.length; j++) if (gap(i, j) < min * 1.1) edges.push([i, j]);
  }

  // пятиугольник = пять ближайших к оси вершин, обойдённых по кругу
  const pentagons = axes.map((axis) => {
    const ring = verts
      .map((v, i) => ({ i, d: dot(v, axis) }))
      .sort((a, b) => b.d - a.d)
      .slice(0, 5)
      .map((e) => e.i);
    const ref = verts[ring[0]];
    const rd = dot(ref, axis);
    const t: Vec3 = [ref[0] - axis[0] * rd, ref[1] - axis[1] * rd, ref[2] - axis[2] * rd];
    const tl = Math.hypot(t[0], t[1], t[2]);
    const ux: Vec3 = [t[0] / tl, t[1] / tl, t[2] / tl];
    const uy: Vec3 = [
      axis[1] * ux[2] - axis[2] * ux[1],
      axis[2] * ux[0] - axis[0] * ux[2],
      axis[0] * ux[1] - axis[1] * ux[0],
    ];
    const at = (i: number) => Math.atan2(dot(verts[i], uy), dot(verts[i], ux));
    return ring.sort((a, b) => at(a) - at(b));
  });

  return { verts, axes, edges, pentagons };
})();

export interface BallView {
  x: number; // node coords (float)
  y: number;
  z: number; // height in cells (penalty flight)
  scale: number;
  squash: number; // 0..1 impact amount
  rotX: number;
  rotY: number;
  visible: boolean;
}

export interface SceneView {
  edges: EdgeRec[];
  ball: BallView;
  current: PlayerIdx;
  hints: Pt[];
  interactive: boolean;
  drag: { active: boolean; x: number; y: number; target: Pt | null };
  tSec: number;
  /** Идущий «салют» после гола (см. celebrate.ts). */
  goalShow?: GoalShow | null;
  /** Снег на задних перекладинах, [0] — верхние, [1] — нижние (см. director). */
  snowBar?: [number, number];
  /** Песок на задних перекладинах пляжных ворот, по паре ворот. */
  sandBar?: [number, number];
  /** Износ/налёт у ворот от атак, по паре ворот (стадион и тетрадь). */
  goalWear?: [number, number];
  /** Забитые голы по воротам — для нарисованных звёздочек на тетради. */
  goalMarks?: [number, number];
  /** Дымка ночного матча 0..1. */
  nightHaze?: number;
}

export class Renderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private field: HTMLCanvasElement | null = null;
  layout: Layout;
  private dpr: number;
  cols: number;
  rows: number;
  arena = "stadium";
  private lastW = 0;
  private lastH = 0;
  /** Safe-area insets в CSS-px (чёлка / Dynamic Island / индикатор дома).
   *  Поле не залезает под них: табло и сетка ворот остаются видны и доступны. */
  private safeTop = 0;
  private safeBottom = 0;
  private safeLeft = 0;
  private safeRight = 0;
  /** Touch capability (фолды, планшеты, телефоны) — увеличенные хинты и мяч. */
  touch = false;

  setTouch(v: boolean) {
    this.touch = v;
  }

  /** Принимает safe-area от GameCanvas. Пересчёт сделает следующий resize(). */
  setSafeInsets(top: number, bottom: number, left: number, right: number) {
    this.safeTop = Math.max(0, top || 0);
    this.safeBottom = Math.max(0, bottom || 0);
    this.safeLeft = Math.max(0, left || 0);
    this.safeRight = Math.max(0, right || 0);
  }

  constructor(canvas: HTMLCanvasElement, cols: number, rows: number, dpr: number) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas-2d-unavailable");
    this.canvas = canvas;
    this.ctx = ctx;
    this.dpr = dpr;
    this.cols = cols;
    this.rows = rows;
    this.layout = computeLayout(2, 2, cols, rows);
  }

  setArena(id: string) {
    if (id === this.arena) return;
    this.arena = id;
    if (this.lastW > 0) this.resize(this.lastW, this.lastH);
  }

  /** Device pixel ratio can change (rotation on some Androids, moving the
   *  window to another display, browser zoom) — re-bake at the new density. */
  setDpr(dpr: number) {
    if (Math.abs(dpr - this.dpr) < 0.01) return;
    this.dpr = dpr;
    if (this.lastW > 0) this.resize(this.lastW, this.lastH);
  }

  resize(w: number, h: number) {
    this.lastW = w;
    this.lastH = h;
    // Reserve a HUD strip at the top so the scoreboard never covers the north
    // goal. The strip scales with the viewport: a phone held sideways has very
    // little height, so the desktop-sized strip would starve the pitch.
    // Phones use the compact scoreboard + pill (~70px stack), so their strip
    // is slimmer than the tablet/desktop one.
    const portrait = h > w;
    const short = h < 560; // phone in landscape, split view, short window
    const phone = Math.min(w, h) < 600;
    // Табло уменьшено (~58–62px вместо 88–104px), поэтому полоса сверху тонкая —
    // поле поднимается, и у южных ворот остаётся место под кнопку «конец хода».
    // Safe-area сверху/снизу добавляется поверх: чёлка и индикатор дома не
    // должны закрывать табло, ворота и кнопку.
    const hudStrip = short
      ? Math.min(66, Math.max(44, Math.round(h * 0.16)))
      : portrait && phone
        ? Math.min(74, Math.max(60, Math.round(h * 0.09)))
        : portrait
          ? Math.min(78, Math.max(56, Math.round(h * 0.085)))
          : Math.min(62, Math.max(48, Math.round(h * 0.062)));
    const topInset = hudStrip + this.safeTop;
    // Снизу держим заметно больше: кнопка «конец хода» стоит по центру,
    // ровно под нижними воротами, и ей нужен чистый пятачок под сеткой.
    const baseBottom = short
      ? Math.min(38, Math.max(20, Math.round(h * 0.06)))
      : portrait
        ? Math.min(44, Math.max(30, Math.round(h * 0.045)))
        : Math.min(48, Math.max(26, Math.round(h * 0.042)));
    const bottomPad = baseBottom + this.safeBottom;
    const compact = !(w >= 1100 && h >= 700);
    this.layout = computeLayout(w, h, this.cols, this.rows, {
      topInset,
      bottomPad,
      leftInset: this.safeLeft,
      rightInset: this.safeRight,
      compact,
      phone,
    });

    // A long phone pitch may be taller than the viewport: the canvas grows to
    // the full content height and the wrapper scrolls. Desktop/tablet always
    // fit, so contentH === h there.
    const ch = Math.ceil(this.layout.contentH);
    this.canvas.width = Math.max(2, Math.round(w * this.dpr));
    this.canvas.height = Math.max(2, Math.round(ch * this.dpr));
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${ch}px`;

    // Bake the texture over the FULL content height so a scrolling pitch has
    // grass, vignette and arena effects all the way down (L.h drives every
    // full-canvas fill inside buildField).
    const dlBase = computeLayout(w * this.dpr, h * this.dpr, this.cols, this.rows, {
      topInset: topInset * this.dpr,
      bottomPad: bottomPad * this.dpr,
      leftInset: this.safeLeft * this.dpr,
      rightInset: this.safeRight * this.dpr,
      compact,
      phone,
    });
    const dl: Layout = { ...dlBase, h: Math.ceil(dlBase.contentH) };
    this.field = buildField(dl, this.arena);
  }

  /** Scrollable content height in CSS px (>= viewport height). */
  get contentHeight(): number {
    return Math.ceil(this.layout.contentH);
  }

  /** Returns true when the pitch dimensions actually changed. */
  setSize(cols: number, rows: number): boolean {
    if (cols === this.cols && rows === this.rows) return false;
    this.cols = cols;
    this.rows = rows;
    return true;
  }

  toPx(x: number, y: number): { x: number; y: number } {
    return { x: this.layout.ox + x * this.layout.cellW, y: this.layout.oy + y * this.layout.cellH };
  }

  toNode(px: number, py: number): { x: number; y: number } {
    return { x: (px - this.layout.ox) / this.layout.cellW, y: (py - this.layout.oy) / this.layout.cellH };
  }

  teamColor(p: PlayerIdx): string {
    return p === 0 ? TEAM.home : TEAM.away;
  }

  draw(v: SceneView, fx: Particles, shake: Shake, dt: number, t: number) {
    const ctx = this.ctx;
    const L = this.layout;
    const cell = L.cell;
    // Gameplay UI (ball, hints, drag arrow) is sized by uiCell: on phones that
    // is the fixed column width, so it never shrinks on a long pitch.
    const ui = L.uiCell;
    const H = Math.ceil(L.contentH);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, L.w, H);
    const off = shake.offset(t);
    ctx.save();
    ctx.translate(L.w / 2 + off.x, H / 2 + off.y);
    ctx.rotate(off.r);
    ctx.translate(-L.w / 2, -H / 2);

    if (this.field) ctx.drawImage(this.field, 0, 0, L.w, H);
    this.drawArenaFx(ctx, t, v);
    this.drawBarSnow(ctx, v);
    this.drawGoalState(ctx, v, t);
    // Жизнь по краям: только в свободных зонах за воротами и у бровок —
    // под линиями и мячом, поэтому узлы и ворота она никогда не закрывает.
    if (this.arena === "stadium") drawCloudShadows(ctx, L, t);
    drawEdgeLife(ctx, L, this.arena, t, [this.teamColor(0), this.teamColor(1)]);
    this.drawCornerFlags(ctx, t);

    this.drawEdges(ctx, v, cell);
    this.drawHints(ctx, v, ui, t);
    if (v.drag.active) this.drawArrow(ctx, v, ui, t);
    this.drawBall(ctx, v, ui, t);
    this.drawParticles(ctx, fx, cell);
    this.drawGoalLayer(ctx, v, t);

    ctx.restore();
    void dt;
  }

  /** «Салют» на гол — свой у каждой арены. */
  private drawGoalLayer(ctx: CanvasRenderingContext2D, v: SceneView, t: number) {
    const goal = v.goalShow;
    if (!goal) return;
    drawGoalShow(ctx, this.layout, goal, t, this.teamColor(goal.scorer), this.arena, (x, y) => this.toPx(x, y));
  }

  /** Animated corner flags: thick visible pole + cloth pennant that ripples
   *  with the wind. Drawn per-frame so the cloth sways; the baked pitch only
   *  keeps a small socket shadow where the pole meets the grass. */
  private drawCornerFlags(ctx: CanvasRenderingContext2D, t: number) {
    const L = this.layout;
    const cw = L.cellW;
    const ch = L.cellH;
    const winter = getArena(this.arena).id === "winter";
    const flags = cornerFlagPositions(L, this.arena);
    const windPhase = t * 2.2;

    // Winter FX leaves "screen" blending + partial alpha on the context; reset
    // so flag cloth renders at full opacity in exactly the same team colours
    // as every other arena.
    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;

    for (let i = 0; i < flags.length; i++) {
      const flag = flags[i];
      const sway = Math.sin(windPhase + i * 1.7); // −1…1 per-flag offset
      const flap = Math.sin(t * 5.6 + i * 2.3); // cloth flutter

      // ── pole: thick, two-tone, always readable on chalk lines ──
      const poleTop = flag.y - ch * 0.78;
      const poleW = Math.max(2.2, cw * 0.075);
      ctx.lineCap = "round";
      // dark outline for contrast against grass and chalk
      ctx.strokeStyle = "rgba(6,10,6,0.5)";
      ctx.lineWidth = poleW * 1.9;
      ctx.beginPath();
      ctx.moveTo(flag.x, flag.y);
      ctx.lineTo(flag.x, poleTop);
      ctx.stroke();
      // metal gradient body
      const pole = ctx.createLinearGradient(flag.x - poleW / 2, 0, flag.x + poleW / 2, 0);
      pole.addColorStop(0, "#8d939b");
      pole.addColorStop(0.45, "#f2f4f7");
      pole.addColorStop(1, "#6f757d");
      ctx.strokeStyle = pole;
      ctx.lineWidth = poleW;
      ctx.beginPath();
      ctx.moveTo(flag.x, flag.y);
      ctx.lineTo(flag.x, poleTop);
      ctx.stroke();
      // base collar so the pole does not look glued to the line
      ctx.fillStyle = "#cfd3d8";
      ctx.beginPath();
      ctx.roundRect(flag.x - poleW * 0.75, flag.y - poleW * 0.5, poleW * 1.5, poleW * 0.75, poleW * 0.3);
      ctx.fill();
      // pole cap (snow-capped on the winter arena so it reads on white snow)
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(flag.x, poleTop - cw * 0.035, Math.max(1.4, cw * 0.075), 0, 7);
      ctx.fill();
      if (winter) {
        ctx.fillStyle = "rgba(160,205,235,0.85)";
        ctx.beginPath();
        ctx.arc(flag.x, poleTop - cw * 0.03, Math.max(1, cw * 0.05), 0, Math.PI);
        ctx.fill();
      }

      // ── pennant: rippling cloth pointing inward ──
      // Same team colours on every arena — no winter-specific recolouring.
      const color = flag.color;
      const len = cw * (0.42 + 0.03 * Math.sin(t * 3.1 + i)); // breathing length
      const tipX = flag.x + flag.inX * len;
      const topY = poleTop + cw * 0.06;
      const botY = topY + ch * 0.3;
      const midY = (topY + botY) / 2;
      // cloth bends: inner tip sways more than the pole edge
      const bend = sway * ch * 0.075 + flap * ch * 0.035;
      const ripple = Math.sin(windPhase * 1.5 + i * 2.6) * ch * 0.03;

      // soft shadow of the cloth on the grass
      ctx.globalAlpha = 0.18;
      ctx.fillStyle = "rgba(0,0,0,1)";
      ctx.beginPath();
      ctx.moveTo(flag.x + cw * 0.05, topY + ch * 0.08);
      ctx.quadraticCurveTo(flag.x + flag.inX * len * 0.6, midY + bend * 0.5 + ch * 0.1, tipX + cw * 0.05, midY + bend + ch * 0.12);
      ctx.quadraticCurveTo(flag.x + flag.inX * len * 0.55, midY + bend * 0.4 + ch * 0.16, flag.x + cw * 0.05, botY + ch * 0.1);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;

      // cloth: two curved edges so it visibly waves
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(flag.x, topY);
      ctx.quadraticCurveTo(
        flag.x + flag.inX * len * 0.55,
        topY + (botY - topY) * 0.2 + bend,
        tipX,
        midY + bend * 0.8 + ripple,
      );
      ctx.quadraticCurveTo(
        flag.x + flag.inX * len * 0.55,
        botY - (botY - topY) * 0.2 + bend * 0.6,
        flag.x,
        botY,
      );
      ctx.closePath();
      ctx.fill();
      // bright outline LAST — identical on every arena
      ctx.strokeStyle = "rgba(255,255,255,0.8)";
      ctx.lineWidth = Math.max(1.2, cw * 0.038);
      ctx.stroke();
      // darker trailing edge for depth
      ctx.fillStyle = "rgba(0,0,0,0.22)";
      ctx.beginPath();
      ctx.moveTo(tipX, midY + bend * 0.8 + ripple);
      ctx.quadraticCurveTo(
        flag.x + flag.inX * len * 0.55,
        botY - (botY - topY) * 0.2 + bend * 0.6,
        flag.x,
        botY,
      );
      ctx.quadraticCurveTo(
        flag.x + flag.inX * len * 0.35,
        botY - (botY - topY) * 0.25 + bend * 0.5,
        tipX,
        midY + bend * 0.8 + ripple,
      );
      ctx.closePath();
      ctx.fill();
      // glossy highlight along the top edge
      ctx.strokeStyle = "rgba(255,255,255,0.4)";
      ctx.lineWidth = Math.max(0.8, cw * 0.022);
      ctx.beginPath();
      ctx.moveTo(flag.x, topY);
      ctx.quadraticCurveTo(
        flag.x + flag.inX * len * 0.55,
        topY + (botY - topY) * 0.2 + bend,
        tipX,
        midY + bend * 0.8 + ripple,
      );
      ctx.stroke();
    }
    ctx.restore();
  }

  /** Снег на задних перекладинах ворот (зимняя арена): валик растёт вместе
   *  с `snowBar` (0..1) в течение матча, а после гола сползает — комья
   *  сыплются вниз из Particles.barSnowDrop.
   *
   *  `snowBar` ведётся отдельно для каждой пары ворот: после гола снег сползает
   *  только со створа, в который залетел мяч, а соседние ворота не трогаются. */
  private drawBarSnow(ctx: CanvasRenderingContext2D, v: SceneView) {
    const loads = v.snowBar ?? [0, 0];
    if (this.arena !== "winter" || (loads[0] <= 0.004 && loads[1] <= 0.004)) return;
    const L = this.layout;
    const gh = goalHalf(L.cols);
    const mid = (L.cols - 1) / 2;
    const x0 = L.ox + (mid - gh) * L.cellW;
    const x1 = L.ox + (mid + gh) * L.cellW;
    const cell = L.cell;
    const ch = L.cellH;
    // Задняя перекладина верхних ворот — клетка выше линии ворот, нижних —
    // клетка ниже; out всегда указывает наружу от поля. Третий элемент —
    // индекс пары ворот в snowBar.
    const rails: [number, number, number][] = [
      [L.oy - ch, -1, 0],
      [L.oy + ch * (L.rows - 1) + ch, 1, 1],
    ];

    ctx.save();
    ctx.lineJoin = "round";
    for (const [railY, out, idx] of rails) {
      const load = loads[idx];
      if (load <= 0.004) continue;
      const seg = Math.max(8, Math.round((x1 - x0) / Math.max(4, L.cellW * 0.3)));
      const th = cell * (0.03 + 0.07 * load);
      // неровная кромка: крупные горбы + мелкая рябь, чтобы валик не был плоским
      const ridge = (i: number) => {
        const u = i / seg;
        const lump = 0.5 + 0.5 * Math.sin(u * 11.3 + railY * 0.11);
        const fine = 0.5 + 0.5 * Math.sin(u * 23.7 + railY * 0.31);
        return th * (0.6 + 0.8 * lump) * (0.7 + 0.35 * fine);
      };
      const baseY = railY - out * th * 0.4; // край валика со стороны поля
      const wavy = (i: number) => railY + out * ridge(i);
      const px = (i: number) => x0 + ((x1 - x0) * i) / seg;

      // 1 · холодная подложка под снежным валиком
      ctx.fillStyle = "rgba(158,188,222,0.55)";
      ctx.beginPath();
      ctx.moveTo(x0, baseY + out * th * 0.3);
      for (let i = 0; i <= seg; i++) ctx.lineTo(px(i), wavy(i) + out * th * 0.22);
      ctx.lineTo(x1, baseY + out * th * 0.3);
      ctx.closePath();
      ctx.fill();

      // 2 · сам валик, лежащий на рейке
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.moveTo(x0, baseY);
      for (let i = 0; i <= seg; i++) ctx.lineTo(px(i), wavy(i));
      ctx.lineTo(x1, baseY);
      ctx.closePath();
      ctx.fill();

      // 3 · редкие морщинки — объём и фактура снега
      ctx.strokeStyle = "rgba(174,204,236,0.55)";
      ctx.lineWidth = Math.max(0.5, cell * 0.011);
      ctx.beginPath();
      const step = Math.max(2, Math.floor(seg / 6));
      for (let i = step; i < seg; i += step) {
        ctx.moveTo(px(i), baseY + out * th * 0.2);
        ctx.lineTo(px(i) - cell * 0.05, wavy(i) * 0.55 + baseY * 0.45);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  /** Состояние ворот остальных арен: износ стадиона, песок пляжа и чернила
   *  тетради. Всё рисуется поверх текстуры поля, но под линиями и мячом. */
  private drawGoalState(ctx: CanvasRenderingContext2D, v: SceneView, t: number) {
    if (this.arena === "stadium") this.drawStadiumWear(ctx, v, t);
    else if (this.arena === "beach") this.drawBeachSand(ctx, v, t);
    else if (this.arena === "paper") this.drawPaperGoalInk(ctx, v, t);
  }

  private goalGeom() {
    const L = this.layout;
    const gh = goalHalf(L.cols);
    const mid = (L.cols - 1) / 2;
    return {
      x0: L.ox + (mid - gh) * L.cellW,
      x1: L.ox + (mid + gh) * L.cellW,
      yTop: L.oy,
      yBot: L.oy + L.cellH * (L.rows - 1),
    };
  }

  private actualGoal(v: SceneView): { idx: 0 | 1; age: number } | null {
    const g = v.goalShow;
    if (!g) return null;
    if (g.y !== 0 && g.y !== this.rows - 1) return null; // тупик: мяч в створ не входил
    const age = v.tSec - g.t0;
    return age >= 0 && age < 2.5 ? { idx: g.scorer, age } : null;
  }

  private drawStadiumWear(ctx: CanvasRenderingContext2D, v: SceneView, t: number) {
    const L = this.layout;
    const loads = v.goalWear ?? [0, 0];
    const G = this.goalGeom();
    const cell = L.cell;
    const ch = L.cellH;
    for (const idx of [0, 1] as const) {
      const wear = loads[idx];
      if (wear <= 0.01) continue;
      const yLine = idx === 0 ? G.yTop : G.yBot;
      const into = idx === 0 ? 1 : -1;
      const depth = ch * 1.2;
      const yA = Math.min(yLine, yLine + into * depth);
      ctx.save();
      ctx.beginPath();
      ctx.rect(G.x0 - cell * 0.3, yA, G.x1 - G.x0 + cell * 0.6, depth);
      ctx.clip();
      // примятая, вытоптанная трава перед створом
      const grad = ctx.createLinearGradient(0, yLine, 0, yLine + into * depth);
      grad.addColorStop(0, `rgba(74,58,34,${0.1 + wear * 0.22})`);
      grad.addColorStop(1, "rgba(74,58,34,0)");
      ctx.fillStyle = grad;
      ctx.fillRect(G.x0 - cell * 0.3, yA, G.x1 - G.x0 + cell * 0.6, depth);
      // потёртости и проплешины — детерминированно, чтобы не «кипели» по кадрам
      for (let i = 0; i < 26; i++) {
        const seed = hashStr(`wear-${idx}-${i}`);
        const px = G.x0 + (((seed >>> 3) % 1000) / 1000) * (G.x1 - G.x0);
        const py = yLine + into * (((seed >>> 13) % 1000) / 1000) * depth;
        const rr = cell * (0.05 + ((seed >>> 21) % 50) / 500);
        ctx.globalAlpha = wear * (0.1 + ((seed >>> 7) % 40) / 160);
        ctx.fillStyle = i % 3 === 0 ? "#6d5836" : "#24351c";
        ctx.beginPath();
        ctx.ellipse(px, py, rr * 1.7, rr, 0, 0, 7);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      // стёртый мел на самой линии ворот между штангами
      ctx.strokeStyle = `rgba(32,42,24,${0.12 + wear * 0.25})`;
      ctx.lineWidth = Math.max(1, cell * 0.075);
      ctx.beginPath();
      ctx.moveTo(G.x0, yLine);
      ctx.lineTo(G.x1, yLine);
      ctx.stroke();
      ctx.restore();
    }

    // сетка забитых ворот пару секунд «дышит» от удара
    const hit = this.actualGoal(v);
    if (hit) {
      const idx = hit.idx;
      const yLine = idx === 0 ? G.yTop : G.yBot;
      const out = idx === 0 ? -1 : 1;
      const amp = Math.max(0, 1 - hit.age / 1.1) * cell * 0.07;
      if (amp > 0.2) {
        ctx.save();
        ctx.strokeStyle = "rgba(240,244,238,0.22)";
        ctx.lineWidth = Math.max(0.7, cell * 0.018);
        ctx.beginPath();
        for (let x = G.x0; x <= G.x1; x += L.cellW * 0.2) {
          const off = Math.sin(hit.age * 34 + x * 0.11) * amp;
          ctx.moveTo(x + off, yLine);
          ctx.lineTo(x + off * 0.4, yLine + out * ch);
        }
        for (let s = 1; s < 5; s++) {
          const yy = yLine + out * ch * (s / 5);
          ctx.moveTo(G.x0, yy + Math.sin(hit.age * 30 + s) * amp * 0.5);
          ctx.lineTo(G.x1, yy + Math.cos(hit.age * 27 + s) * amp * 0.5);
        }
        ctx.stroke();
        ctx.restore();
      }
    }
    void t;
  }

  private drawBeachSand(ctx: CanvasRenderingContext2D, v: SceneView, t: number) {
    const L = this.layout;
    const loads = v.sandBar ?? [0, 0];
    const G = this.goalGeom();
    const cell = L.cell;
    const ch = L.cellH;
    // песок, осевший на задних перекладинах и верхней кромке сетки
    for (const idx of [0, 1] as const) {
      const load = loads[idx];
      if (load <= 0.004) continue;
      const railY = idx === 0 ? G.yTop - ch : G.yBot + ch;
      ctx.save();
      for (let i = 0; i < 46; i++) {
        const seed = hashStr(`sand-rail-${idx}-${i}`);
        const px = G.x0 + (((seed >>> 3) % 1000) / 1000) * (G.x1 - G.x0);
        const py = railY + Math.sin(i * 2.7 + idx) * cell * 0.035;
        const rr = Math.max(0.6, cell * (0.012 + ((seed >>> 11) % 30) / 900));
        ctx.globalAlpha = load * (0.25 + ((seed >>> 17) % 60) / 90);
        ctx.fillStyle = i % 4 === 0 ? "#fff3cf" : "#dfc084";
        ctx.beginPath();
        ctx.arc(px, py, rr, 0, 7);
        ctx.fill();
      }
      ctx.globalAlpha = 0.2 + load * 0.4;
      ctx.strokeStyle = "#e8cf97";
      ctx.lineWidth = Math.max(1, cell * (0.02 + load * 0.035));
      ctx.beginPath();
      ctx.moveTo(G.x0, railY);
      ctx.lineTo(G.x1, railY);
      ctx.stroke();
      ctx.restore();
    }

    // после гола волна подкатывает именно к забитому створу и мочит песок
    const hit = this.actualGoal(v);
    if (hit) {
      const idx = hit.idx;
      const yLine = idx === 0 ? G.yTop : G.yBot;
      const into = idx === 0 ? 1 : -1;
      const k = Math.min(1, hit.age / 1.35);
      const reach = ch * (0.25 + 0.75 * k);
      const fade = Math.max(0, 1 - hit.age / 2.2);
      if (fade > 0) {
        const yA = Math.min(yLine, yLine + into * reach);
        ctx.save();
        ctx.fillStyle = `rgba(70,150,175,${0.13 * fade})`;
        ctx.fillRect(G.x0 - cell * 0.4, yA, G.x1 - G.x0 + cell * 0.8, reach);
        ctx.strokeStyle = `rgba(255,255,255,${0.65 * fade})`;
        ctx.lineWidth = Math.max(1, cell * 0.055);
        ctx.beginPath();
        for (let x = G.x0 - cell * 0.4; x <= G.x1 + cell * 0.4; x += Math.max(5, cell * 0.2)) {
          const yy = yLine + into * reach + Math.sin(x * 0.06 + t * 5) * cell * 0.05;
          if (x === G.x0 - cell * 0.4) ctx.moveTo(x, yy);
          else ctx.lineTo(x, yy);
        }
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  private drawPaperGoalInk(ctx: CanvasRenderingContext2D, v: SceneView, t: number) {
    const L = this.layout;
    const loads = v.goalWear ?? [0, 0];
    const marks = v.goalMarks ?? [0, 0];
    const G = this.goalGeom();
    const cell = L.cell;
    const ch = L.cellH;
    for (const idx of [0, 1] as const) {
      const wear = loads[idx];
      const yLine = idx === 0 ? G.yTop : G.yBot;
      const out = idx === 0 ? -1 : 1;
      const backY = yLine + out * ch;
      if (wear > 0.01) {
        ctx.save();
        // графитный налёт и потёртости пасты на рамке ворот
        ctx.strokeStyle = `rgba(45,60,110,${0.1 + wear * 0.3})`;
        ctx.lineWidth = Math.max(1, cell * (0.03 + wear * 0.05));
        ctx.beginPath();
        ctx.moveTo(G.x0, backY);
        ctx.lineTo(G.x1, backY);
        ctx.moveTo(G.x0, yLine);
        ctx.lineTo(G.x0, backY);
        ctx.moveTo(G.x1, yLine);
        ctx.lineTo(G.x1, backY);
        ctx.stroke();
        for (let i = 0; i < 22; i++) {
          const seed = hashStr(`ink-${idx}-${i}`);
          const px = G.x0 + (((seed >>> 3) % 1000) / 1000) * (G.x1 - G.x0);
          const py = backY + (((seed >>> 13) % 1000) / 1000 - 0.5) * cell * 0.3;
          ctx.globalAlpha = wear * (0.15 + ((seed >>> 7) % 50) / 120);
          ctx.fillStyle = i % 4 === 0 ? "#707a94" : "#2f3f7a";
          ctx.beginPath();
          ctx.arc(px, py, Math.max(0.5, cell * 0.014), 0, 7);
          ctx.fill();
        }
        ctx.restore();
      }

      // звёздочки за забитые голы — рядом с задней рейкой, новейшая дорисовывается
      const count = Math.min(5, marks[idx]);
      const hit = this.actualGoal(v);
      for (let s = 0; s < count; s++) {
        const cx = G.x1 + cell * (0.38 + s * 0.3);
        const cy = backY;
        const isNew = hit !== null && hit.idx === idx && s === count - 1;
        const grow = isNew ? Math.min(1, hit.age / 0.45) : 1;
        if (grow <= 0) continue;
        this.drawInkStar(ctx, cx, cy, cell * 0.11 * grow, 0.55 + 0.4 * grow, t + s);
      }
    }
  }

  private drawInkStar(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, alpha: number, seed: number) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = "#2e4290";
    ctx.lineWidth = Math.max(0.8, r * 0.16);
    ctx.lineJoin = "round";
    ctx.beginPath();
    for (let i = 0; i <= 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5 + Math.sin(seed + i) * 0.03;
      const rr = i % 2 === 0 ? r : r * 0.45;
      const px = cx + Math.cos(a) * rr;
      const py = cy + Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
    ctx.restore();
  }

  /** Arena ambience. Deterministic functions of time keep the effect stable,
   * cheap and replay-safe; gameplay remains perfectly readable underneath. */
  private drawArenaFx(ctx: CanvasRenderingContext2D, t: number, v: SceneView) {
    const L = this.layout;
    const C = L.cell;
    const x0 = L.ox;
    const y0 = L.oy;
    const x1 = x0 + L.cellW * (L.cols - 1);
    const y1 = y0 + L.cellH * (L.rows - 1);

    if (this.arena === "night") {
      ctx.save();

      ctx.globalCompositeOperation = "screen";

      // ── 1. Volumetric breathing of the 4 corner floodlight shafts ───────
      const midX = (x0 + x1) / 2;
      const midY = (y0 + y1) / 2;
      const haze = v.nightHaze ?? 0;
      const beamPulse = (0.045 + 0.02 * Math.sin(t * 1.5)) * (0.75 + haze * 0.7);
      const bg = ctx.createRadialGradient(midX, midY, 0, midX, midY, (x1 - x0) * 0.72);
      bg.addColorStop(0, `rgba(195, 240, 255, ${beamPulse})`);
      bg.addColorStop(0.5, `rgba(145, 220, 248, ${beamPulse * 0.4})`);
      bg.addColorStop(1, "rgba(110, 200, 240, 0)");
      ctx.fillStyle = bg;
      ctx.fillRect(x0 - C, y0 - C, (x1 - x0) + C * 2, (y1 - y0) + C * 2);

      // ── 3. Low stadium mist drifting horizontally across the pitch ─────
      // Дымка густеет по ходу матча (nightHaze); у забитого створа после гола
      // она на пару секунд проседает — свет «пробил» её вспышками.
      const goalAge = v.goalShow ? t - v.goalShow.t0 : 99;
      const goalSide = v.goalShow && goalAge < 2 ? v.goalShow.scorer : -1;
      for (let i = 0; i < 4; i++) {
        const speed = 0.03 + i * 0.012;
        void speed;
        const my = y0 + ((y1 - y0) / 4) * (i + 0.5) + Math.sin(t * 0.4 + i * 1.8) * C * 0.4;
        const mh = C * 0.85;
        let mistA = 0.03 + haze * 0.05;
        if (goalSide >= 0) {
          const nearScored = goalSide === 0 ? my < (y0 + y1) / 2 : my > (y0 + y1) / 2;
          if (nearScored) mistA *= 0.35 + 0.65 * Math.min(1, goalAge / 2);
        }
        const mg = ctx.createLinearGradient(0, my - mh, 0, my + mh);
        mg.addColorStop(0, "rgba(150, 215, 240, 0)");
        mg.addColorStop(0.5, `rgba(165, 225, 245, ${mistA})`);
        mg.addColorStop(1, "rgba(150, 215, 240, 0)");
        ctx.fillStyle = mg;
        ctx.fillRect(x0 - C * 0.5, my - mh, (x1 - x0) + C, mh * 2);
      }

      // ── 3.5 Fog pools + extra moths around the floodlight masts ─────────
      // Мошкары прибывает вместе с дымкой; после гола у забитого створа
      // прожекторы стробят, и мошки разлетаются шире.
      for (const mast of nightMastPositions(L)) {
        if (mast.x < -C || mast.x > L.w + C || mast.y < -C || mast.y > L.h + C) continue;
        const onScoredSide = goalSide >= 0 && (goalSide === 0 ? mast.y < (y0 + y1) / 2 : mast.y > (y0 + y1) / 2);
        const fogR = C * (2 + haze * 2.6);
        const fogA = (0.04 + haze * 0.1) * (onScoredSide ? 0.35 : 1);
        const fg = ctx.createRadialGradient(mast.x, mast.y, 0, mast.x, mast.y, fogR);
        fg.addColorStop(0, `rgba(205,240,255,${fogA})`);
        fg.addColorStop(1, "rgba(150,220,255,0)");
        ctx.fillStyle = fg;
        ctx.fillRect(mast.x - fogR, mast.y - fogR, fogR * 2, fogR * 2);
        if (onScoredSide && Math.sin(goalAge * 30) > 0.1) {
          ctx.globalAlpha = 0.16;
          ctx.fillStyle = "#eaf7ff";
          ctx.beginPath();
          ctx.arc(mast.x, mast.y, C * 0.8, 0, 7);
          ctx.fill();
          ctx.globalAlpha = 1;
        }
        const moths = Math.round(haze * 3);
        for (let k = 0; k < moths; k++) {
          const seed = hashStr(`mast-moth-${Math.round(mast.x)}-${Math.round(mast.y)}-${k}`);
          const orbit = C * (0.32 + ((seed >>> 5) % 40) / 100 + (onScoredSide ? 0.35 : 0));
          const a = t * (1.4 + ((seed >>> 9) % 50) / 45) + seed;
          const mx = mast.x + Math.cos(a) * orbit;
          const my = mast.y + Math.sin(a * 1.3) * orbit * 0.62;
          ctx.globalAlpha = 0.35 + 0.35 * Math.abs(Math.sin(t * 18 + k));
          ctx.fillStyle = "#fff3cf";
          ctx.beginPath();
          ctx.arc(mx, my, Math.max(0.7, C * 0.016), 0, 7);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }

      // ── 4. Slow, broad light sweeps from both touchlines ───────────────
      for (let i = 0; i < 2; i++) {
        const phase = t * (0.18 + i * 0.035) + i * 2.7;
        const cy = (y0 + y1) / 2 + Math.sin(phase) * (y1 - y0) * 0.34;
        const cx = i === 0 ? x0 - C * 0.5 : x1 + C * 0.5;
        const r = C * 4.5;
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        g.addColorStop(0, "rgba(205,240,255,0.11)");
        g.addColorStop(0.35, "rgba(135,210,235,0.05)");
        g.addColorStop(1, "rgba(110,190,220,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, 7);
        ctx.fill();
      }

      // ── 5. Airborne motes / vapor particles caught in floodlight beams ─
      for (let i = 0; i < 48; i++) {
        const seed = hashStr(`night-${i}`);
        const u = ((seed % 1000) / 1000 + t * (0.007 + (i % 5) * 0.0015)) % 1;
        const vx = x0 + (((seed >>> 10) % 1000) / 1000) * (x1 - x0);
        const vy = y1 - u * (y1 - y0);
        const twinkle = 0.3 + 0.7 * Math.abs(Math.sin(t * 1.5 + i * 1.77));
        ctx.globalAlpha = 0.12 + twinkle * 0.22;
        ctx.fillStyle = "#e0f6ff";
        ctx.beginPath();
        ctx.arc(vx + Math.sin(t * 0.4 + i) * C * 0.18, vy, Math.max(0.6, C * 0.019), 0, 7);
        ctx.fill();
      }

      ctx.restore();
    } else if (this.arena === "paper") {
      ctx.save();
      // ── 1 · Dust motes & paper fibres floating above the desk ──
      for (let i = 0; i < 40; i++) {
        const seed = hashStr(`paper-${i}`);
        const speed = 0.02 + (i % 4) * 0.01;
        const u = ((seed % 1000) / 1000 + t * speed) % 1;
        const gx = x0 + (((seed >>> 9) % 1000) / 1000) * (x1 - x0);
        const gy = y0 - C + u * (y1 - y0 + C * 2);
        const sway = Math.sin(t * (0.6 + (i % 3) * 0.2) + i * 0.8) * C * (0.08 + (i % 3) * 0.05);
        const isFibre = i % 4 === 0;
        ctx.globalAlpha = 0.14 + (i % 3) * 0.08;
        if (isFibre) {
          ctx.save();
          ctx.translate(gx + sway, gy);
          ctx.rotate(t * 0.8 + i);
          ctx.fillStyle = "#cfc9b4";
          const w = Math.max(1, C * 0.022);
          ctx.fillRect(-w, -w * 0.3, w * 2, w * 0.6);
          ctx.restore();
        } else {
          ctx.fillStyle = "#b9b3a0";
          ctx.beginPath();
          ctx.arc(gx + sway, gy, Math.max(0.5, C * 0.01), 0, 7);
          ctx.fill();
        }
      }

      // ── 3 · Desk-lamp sheen sweeping slowly across the sheet ──
      ctx.globalCompositeOperation = "screen";
      const sweep = (Math.sin(t * 0.16) * 0.5 + 0.5) * L.w;
      const sheen = ctx.createLinearGradient(sweep - L.w * 0.3, 0, sweep + L.w * 0.3, L.h);
      sheen.addColorStop(0, "rgba(255,252,235,0)");
      sheen.addColorStop(0.5, "rgba(255,252,235,0.10)");
      sheen.addColorStop(1, "rgba(255,252,235,0)");
      ctx.fillStyle = sheen;
      ctx.fillRect(0, 0, L.w, L.h);

      // ── 4 · Page crease: a soft horizontal fold shadow across the sheet ──
      ctx.globalCompositeOperation = "multiply";
      const creaseY = L.h * 0.94;
      const wrinkle = ctx.createLinearGradient(0, creaseY - C * 1.4, 0, creaseY + C * 1.4);
      const wp = 0.03 + 0.012 * Math.sin(t * 0.9);
      wrinkle.addColorStop(0, "rgba(90,100,125,0)");
      wrinkle.addColorStop(0.5, `rgba(90,100,125,${wp})`);
      wrinkle.addColorStop(1, "rgba(90,100,125,0)");
      ctx.fillStyle = wrinkle;
      ctx.fillRect(0, creaseY - C * 1.4, L.w, C * 2.8);

      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 1;
      ctx.restore();
    } else if (this.arena === "winter") {
      ctx.save();

      // ── 1 · Subzero frosty stadium ambient mist (холодное морозное дыхание стадиона) ──
      ctx.globalCompositeOperation = "screen";
      const frostGlow = ctx.createLinearGradient(0, y0, 0, y1);
      const breath = 0.045 + 0.02 * Math.sin(t * 1.1);
      frostGlow.addColorStop(0, `rgba(215, 240, 255, ${breath * 1.4})`);
      frostGlow.addColorStop(0.5, `rgba(185, 225, 250, ${breath * 0.8})`);
      frostGlow.addColorStop(1, `rgba(215, 240, 255, ${breath * 1.4})`);
      ctx.fillStyle = frostGlow;
      ctx.fillRect(0, 0, L.w, L.h);

      // ── 2 · Low ground blizzard wisps / drift swirls (снежная позёмка у поля) ──
      for (let s = 0; s < 5; s++) {
        const swirlU = ((t * (0.09 + s * 0.025) + s * 0.23) % 1);
        const sx = x0 - C * 2 + swirlU * (x1 - x0 + C * 4);
        const sy = y0 + ((s + 0.5) / 5) * (y1 - y0) + Math.sin(t * 1.8 + s * 2.1) * C * 0.35;
        const swLen = C * (2.2 + s * 0.6);
        const swG = ctx.createLinearGradient(sx - swLen, sy, sx + swLen, sy);
        swG.addColorStop(0, "rgba(255,255,255,0)");
        swG.addColorStop(0.5, "rgba(235,248,255,0.09)");
        swG.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = swG;
        ctx.beginPath();
        ctx.ellipse(sx, sy, swLen, C * 0.22, 0.08 * Math.sin(t + s), 0, 7);
        ctx.fill();
      }
      ctx.globalCompositeOperation = "source-over";

      // ── 3 · Rich multi-depth snowfall with dynamic wind drift ──
      // Wind gust simulation with smooth undulating direction
      const wind = Math.sin(t * 0.65) * 0.45 + Math.cos(t * 0.23) * 0.35;

      // 140 snowflakes in 4 depth layers: from tiny background powder to big fluffy flakes
      for (let i = 0; i < 140; i++) {
        const seed = hashStr(`snow-${i}`);
        const depth = i % 4; // 0=distant fine, 1=mid, 2=near, 3=foreground fluff
        const speed = 0.022 + depth * 0.016;
        const u = ((seed % 1000) / 1000 + t * speed) % 1;
        const baseX = ((seed >>> 10) % 1000) / 1000;
        const swirl = Math.sin(t * (0.55 + depth * 0.15) + i * 0.83) * C * (0.12 + depth * 0.14);
        const fx = x0 + baseX * (x1 - x0) + swirl + wind * C * (0.3 + depth * 0.35);
        const fy = y0 - C + u * (y1 - y0 + C * 2);

        if (depth === 3) {
          // Large fluffy foreground flakes with soft halo
          const rFluff = Math.max(1.8, C * 0.035);
          ctx.globalAlpha = 0.65;
          ctx.fillStyle = "#ffffff";
          ctx.beginPath();
          ctx.arc(fx, fy, rFluff, 0, 7);
          ctx.fill();
          // soft glow
          ctx.globalAlpha = 0.25;
          ctx.beginPath();
          ctx.arc(fx, fy, rFluff * 1.8, 0, 7);
          ctx.fill();
        } else {
          // Standard and fine crystalline snowflakes
          const rr = Math.max(0.7, C * (0.012 + depth * 0.008));
          ctx.globalAlpha = 0.28 + depth * 0.18;
          ctx.fillStyle = depth === 0 ? "#e0f2fe" : "#ffffff";
          ctx.beginPath();
          ctx.arc(fx, fy, rr, 0, 7);
          ctx.fill();
        }
      }

      // ── 4 · Diamond ice glints & cross-reflections on frozen patches ──
      ctx.globalCompositeOperation = "screen";
      for (let i = 0; i < 12; i++) {
        const seed = hashStr(`ice-${i}`);
        const gx = x0 + (((seed >>> 8) % 1000) / 1000) * (x1 - x0);
        const gy = y0 + (((seed >>> 19) % 1000) / 1000) * (y1 - y0);
        const pulse = Math.max(0, Math.sin(t * 1.2 + i * 1.3));
        if (pulse < 0.6) continue;
        const intensity = (pulse - 0.6) / 0.4;
        ctx.globalAlpha = intensity * 0.75;

        // 4-pointed diffraction star on the ice
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1.2;
        const sparkLen = C * (0.14 + intensity * 0.12);
        ctx.beginPath();
        ctx.moveTo(gx - sparkLen, gy);
        ctx.lineTo(gx + sparkLen, gy);
        ctx.moveTo(gx, gy - sparkLen);
        ctx.lineTo(gx, gy + sparkLen);
        ctx.stroke();

        // Diagonal sub-spikes
        ctx.lineWidth = 0.6;
        const diagLen = sparkLen * 0.55;
        ctx.beginPath();
        ctx.moveTo(gx - diagLen, gy - diagLen);
        ctx.lineTo(gx + diagLen, gy + diagLen);
        ctx.moveTo(gx - diagLen, gy + diagLen);
        ctx.lineTo(gx + diagLen, gy - diagLen);
        ctx.stroke();
      }
      ctx.restore();
    } else if (this.arena === "beach") {
      ctx.save();
      const seaBottom = y0 - C * 1.25;
      const surf = Math.sin(t * 0.55); // slow advance / retreat of the tide
      // ── rolling foam layers washing onto the wet sand ────────────────
      if (seaBottom > 4) {
        for (let layer = 0; layer < 3; layer++) {
          const reach = C * (0.22 + layer * 0.2) * (0.55 + 0.45 * surf + layer * 0.12);
          ctx.globalAlpha = 0.28 - layer * 0.07;
          ctx.strokeStyle = "#ffffff";
          ctx.lineWidth = Math.max(1, C * (0.07 - layer * 0.015));
          ctx.beginPath();
          for (let x = 0; x <= L.w; x += L.w / 22) {
            const yy =
              seaBottom +
              reach +
              Math.sin(x * 0.045 + t * (1.1 + layer * 0.3) + layer) * C * 0.06 +
              Math.sin(x * 0.013 - t * 0.8) * C * 0.04;
            if (x === 0) ctx.moveTo(x, yy);
            else ctx.lineTo(x, yy);
          }
          ctx.stroke();
        }
        // ── sun glitter dancing on the swell ───────────────────────────
        ctx.globalCompositeOperation = "screen";
        for (let i = 0; i < 26; i++) {
          const seed = hashStr(`glint-${i}`);
          const gx = (((seed >>> 7) % 1000) / 1000) * L.w;
          const gy = (((seed >>> 17) % 1000) / 1000) * seaBottom;
          const blink = Math.max(0, Math.sin(t * 2.4 + i * 1.31));
          if (blink < 0.55) continue;
          ctx.globalAlpha = (blink - 0.55) * 0.5;
          ctx.strokeStyle = "#fffdf0";
          ctx.lineWidth = Math.max(1, C * 0.02);
          ctx.beginPath();
          ctx.moveTo(gx - C * 0.14, gy);
          ctx.lineTo(gx + C * 0.14, gy);
          ctx.stroke();
        }
        ctx.globalCompositeOperation = "source-over";
      }
      // ── wind-blown sand grains drifting across the pitch ────────────
      for (let i = 0; i < 54; i++) {
        const seed = hashStr(`grain-${i}`);
        const speed = 0.05 + (i % 4) * 0.018;
        const u = (((seed % 1000) / 1000) + t * speed) % 1;
        const gy0 = (((seed >>> 11) % 1000) / 1000) * (y1 - y0);
        const bob = Math.sin(t * (0.7 + (i % 3) * 0.2) + i) * C * (0.06 + (i % 3) * 0.04);
        const gx = x0 - C * 0.4 + u * (x1 - x0 + C * 0.8);
        const gy = y0 + gy0 + bob;
        ctx.globalAlpha = 0.16 + (i % 3) * 0.07;
        ctx.fillStyle = i % 5 === 0 ? "#fffdf2" : "#f0dcae";
        ctx.beginPath();
        ctx.arc(gx, gy, Math.max(0.5, C * 0.012), 0, 7);
        ctx.fill();
      }
      // ── two gulls gliding over the shore ───────────────────────────
      for (let g = 0; g < 2; g++) {
        const cycle = (((t * 0.055 + g * 0.5) % 1) + 1) % 1;
        const gx = x0 - C * 1.2 + cycle * (x1 - x0 + C * 2.4);
        const gy = y0 - C * 0.55 + Math.sin(cycle * Math.PI * 2 + g * 2) * C * 0.75 + g * C * 0.5;
        const flap = Math.sin(t * 5.2 + g * 1.7) * 0.45 + 0.55;
        const ws = C * 0.2;
        ctx.globalAlpha = 0.34;
        ctx.strokeStyle = "#2b3138";
        ctx.lineWidth = Math.max(1, C * 0.022);
        ctx.beginPath();
        ctx.moveTo(gx - ws, gy + ws * flap * 0.5);
        ctx.quadraticCurveTo(gx - ws * 0.4, gy - ws * 0.3, gx, gy);
        ctx.quadraticCurveTo(gx + ws * 0.4, gy - ws * 0.3, gx + ws, gy + ws * flap * 0.5);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  private drawEdges(ctx: CanvasRenderingContext2D, v: SceneView, cell: number) {
    // Soft neon aesthetic: gentle diffuse ambient glow under a luminous neon body
    // with a crisp glowing inner core. Lines are soft, stylish, and easily readable.
    // Плотность линий влияет на толщину и яркость ПЛАВНО. Раньше был резкий
    // переключатель «many» на 45-й линии: подсветка мгновенно пропадала и
    // выглядела как баг. Теперь градиент идёт от 20 до 160 линий и не
    // опускает свечение ниже видимого порога.
    const dense = Math.min(1, Math.max(0, (v.edges.length - 20) / 140));
    const w = cell * (0.11 - 0.025 * dense);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    // Light arenas (snow / sand / paper) need a stronger dark underlay so neon reads.
    const light = this.arena === "winter" || this.arena === "paper" || this.arena === "beach";
    // 1 · Soft ground contact shadow for realistic 3D separation
    ctx.globalAlpha = light ? 0.46 - 0.1 * dense : 0.24 - 0.06 * dense;
    ctx.strokeStyle = light ? "rgba(20, 30, 50, 0.85)" : "rgba(0, 10, 4, 0.6)";
    ctx.lineWidth = light ? w * 1.45 : w * 1.8;
    ctx.beginPath();
    for (const e of v.edges) {
      const a = this.toPx(e.a.x, e.a.y);
      const b = this.toPx(e.b.x, e.b.y);
      ctx.moveTo(a.x + w * 0.3, a.y + w * 0.45);
      ctx.lineTo(b.x + w * 0.3, b.y + w * 0.45);
    }
    ctx.stroke();

    // 2 · Outer soft neon aura / halo
    for (const team of [0, 1] as PlayerIdx[]) {
      ctx.globalAlpha = 0.42 - 0.08 * dense;
      ctx.strokeStyle = glowWideOf(this.teamColor(team));
      ctx.lineWidth = w * (2.8 - 0.3 * dense);
      ctx.beginPath();
      for (const e of v.edges) {
        if (e.by !== team) continue;
        const a = this.toPx(e.a.x, e.a.y);
        const b = this.toPx(e.b.x, e.b.y);
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
      }
      ctx.stroke();

      // Medium bloom layer
      ctx.globalAlpha = 0.65 - 0.1 * dense;
      ctx.strokeStyle = this.teamColor(team);
      ctx.lineWidth = w * 1.5;
      ctx.beginPath();
      for (const e of v.edges) {
        if (e.by !== team) continue;
        const a = this.toPx(e.a.x, e.a.y);
        const b = this.toPx(e.b.x, e.b.y);
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
      }
      ctx.stroke();

      // Sharp primary neon line
      ctx.globalAlpha = 0.95;
      ctx.strokeStyle = this.teamColor(team);
      ctx.lineWidth = w;
      ctx.beginPath();
      for (const e of v.edges) {
        if (e.by !== team) continue;
        const a = this.toPx(e.a.x, e.a.y);
        const b = this.toPx(e.b.x, e.b.y);
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
      }
      ctx.stroke();

      // Ultra-bright core (white / pastel glow inside the neon tube)
      ctx.globalAlpha = 0.85 - 0.12 * dense;
      ctx.strokeStyle = inkHiOf(this.teamColor(team));
      ctx.lineWidth = w * 0.35;
      ctx.beginPath();
      for (const e of v.edges) {
        if (e.by !== team) continue;
        const a = this.toPx(e.a.x, e.a.y);
        const b = this.toPx(e.b.x, e.b.y);
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
      }
      ctx.stroke();
    }

    // 3 · Neon joints at nodes
    const joints = new Map<string, number>(); // bitmask: 1 = home, 2 = away
    for (const e of v.edges) {
      const bit = e.by === 0 ? 1 : 2;
      const ka = `${e.a.x},${e.a.y}`;
      const kb = `${e.b.x},${e.b.y}`;
      joints.set(ka, (joints.get(ka) ?? 0) | bit);
      joints.set(kb, (joints.get(kb) ?? 0) | bit);
    }
    const jr = w * 0.65;
    for (const [k, mask] of joints) {
      const [nx, ny] = k.split(",").map(Number);
      const p = this.toPx(nx, ny);
      ctx.globalAlpha = 0.95;
      if (mask === 3) {
        ctx.fillStyle = this.teamColor(0);
        ctx.beginPath();
        ctx.arc(p.x, p.y, jr, Math.PI * 0.5, Math.PI * 1.5);
        ctx.fill();
        ctx.fillStyle = this.teamColor(1);
        ctx.beginPath();
        ctx.arc(p.x, p.y, jr, -Math.PI * 0.5, Math.PI * 0.5);
        ctx.fill();
      } else {
        ctx.fillStyle = this.teamColor(mask === 1 ? 0 : 1);
        ctx.beginPath();
        ctx.arc(p.x, p.y, jr, 0, 7);
        ctx.fill();
      }
      // Glowing white core dot
      ctx.globalAlpha = 0.95;
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(p.x, p.y, jr * 0.42, 0, 7);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  private drawHints(ctx: CanvasRenderingContext2D, v: SceneView, cell: number, t: number) {
    const col = this.teamColor(v.current);
    const coreCol = inkHiOf(col);
    const bp = this.toPx(v.ball.x, v.ball.y);
    ctx.lineCap = "round";
    // Phones and touch foldables get chunkier hint nodes so taps land reliably on a fingertip.
    const ph = this.layout.phone || this.touch;

    for (const h of v.hints) {
      const p = this.toPx(h.x, h.y);
      const pulse = 0.5 + 0.5 * Math.sin(t * 4.6 + (hashStr(`${h.x},${h.y}`) % 6));
      const isHover = v.drag.active && v.drag.target && v.drag.target.x === h.x && v.drag.target.y === h.y;

      // 1 · Guide ray from ball towards target node
      ctx.strokeStyle = col;
      ctx.globalAlpha = isHover ? 0.9 : 0.45 + pulse * 0.25;
      ctx.lineWidth = cell * (isHover ? (ph ? 0.075 : 0.065) : ph ? 0.055 : 0.045);
      ctx.beginPath();
      ctx.moveTo(bp.x + (p.x - bp.x) * 0.38, bp.y + (p.y - bp.y) * 0.38);
      ctx.lineTo(p.x - (p.x - bp.x) * 0.22, p.y - (p.y - bp.y) * 0.22);
      ctx.stroke();

      // 2 · Dark contrast backing disc (ensures the node NEVER blends into the dark green grass)
      const baseR = cell * (isHover ? (ph ? 0.36 : 0.28) : ph ? 0.26 + pulse * 0.03 : 0.19 + pulse * 0.02);
      ctx.globalAlpha = 0.75;
      ctx.fillStyle = "rgba(4, 14, 8, 0.85)";
      ctx.beginPath();
      ctx.arc(p.x, p.y, baseR + cell * (ph ? 0.08 : 0.06), 0, 7);
      ctx.fill();

      // 3 · Outer glowing pulse ring — sized so a node and its diagonal
      // neighbour no longer overlap (ring max ≈ 0.42 cell vs 1-cell spacing).
      const ringR = baseR + cell * (isHover ? (ph ? 0.16 : 0.13) : ph ? 0.1 + pulse * 0.03 : 0.08 + pulse * 0.03);
      ctx.globalAlpha = isHover ? 0.85 : 0.4 + pulse * 0.4;
      ctx.strokeStyle = col;
      ctx.lineWidth = cell * 0.045;
      ctx.beginPath();
      ctx.arc(p.x, p.y, ringR, 0, 7);
      ctx.stroke();

      // 4 · Bright neon main disc
      ctx.globalAlpha = isHover ? 1.0 : 0.88 + pulse * 0.12;
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(p.x, p.y, baseR, 0, 7);
      ctx.fill();

      // 5 · High-contrast white hot core (makes blue unmistakably bright and visible)
      ctx.globalAlpha = isHover ? 1.0 : 0.92;
      ctx.fillStyle = coreCol;
      ctx.beginPath();
      ctx.arc(p.x, p.y, baseR * 0.55, 0, 7);
      ctx.fill();

      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(p.x, p.y, baseR * 0.28, 0, 7);
      ctx.fill();

      ctx.globalAlpha = 1;
    }
  }

  private drawArrow(ctx: CanvasRenderingContext2D, v: SceneView, cell: number, t: number) {
    const bp = this.toPx(v.ball.x, v.ball.y);
    // Free-drag tip must use the per-axis cell size (rectangular cells on phones).
    const tp = v.drag.target
      ? this.toPx(v.drag.target.x, v.drag.target.y)
      : { x: this.layout.ox + v.drag.x * this.layout.cellW, y: this.layout.oy + v.drag.y * this.layout.cellH };
    const col = this.teamColor(v.current);
    const dx = tp.x - bp.x;
    const dy = tp.y - bp.y;
    const len = Math.hypot(dx, dy);
    if (len < 2) return;
    const clampL = v.drag.target ? len : Math.min(len, cell * 1.6);
    const ux = dx / len;
    const uy = dy / len;
    const ex = bp.x + ux * clampL;
    const ey = bp.y + uy * clampL;
    ctx.strokeStyle = col;
    ctx.lineWidth = cell * 0.085;
    ctx.lineCap = "round";
    ctx.setLineDash([cell * 0.28, cell * 0.2]);
    ctx.lineDashOffset = -t * cell * 1.4;
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.moveTo(bp.x + ux * cell * 0.4, bp.y + uy * cell * 0.4);
    ctx.lineTo(ex - ux * cell * 0.24, ey - uy * cell * 0.24);
    ctx.stroke();
    ctx.setLineDash([]);
    // arrow head
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(ex, ey);
    ctx.lineTo(ex - ux * cell * 0.34 - uy * cell * 0.2, ey - uy * cell * 0.34 + ux * cell * 0.2);
    ctx.lineTo(ex - ux * cell * 0.34 + uy * cell * 0.2, ey - uy * cell * 0.34 - ux * cell * 0.2);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  private drawBall(ctx: CanvasRenderingContext2D, v: SceneView, cell: number, t: number) {
    if (!v.ball.visible) return;
    const ground = this.toPx(v.ball.x, v.ball.y);
    const z = v.ball.z * cell;
    // Phones and touch foldables get a bigger ball so the grab target matches a fingertip, but the
    // ball must stay clear of the neighbouring hint nodes (radius < 0.5 cell).
    const isTouch = this.layout.phone || this.touch;
    const ballK = isTouch ? 0.46 : 0.4;
    const r = Math.max(2.5, cell * ballK * v.ball.scale);
    const cx = ground.x;
    const cy = ground.y - z;

    // turn ring on the grass
    if (v.interactive) {
      const col = this.teamColor(v.current);
      const pulse = 0.5 + 0.5 * Math.sin(t * 3.4);
      ctx.strokeStyle = col;
      ctx.globalAlpha = 0.3 + pulse * 0.3;
      ctx.lineWidth = cell * 0.045;
      ctx.setLineDash([cell * 0.3, cell * 0.24]);
      ctx.lineDashOffset = t * cell * 0.8;
      ctx.beginPath();
      ctx.arc(ground.x, ground.y, cell * (isTouch ? 0.72 : 0.62), 0, 7);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }

    // contact shadow (softens & shrinks with height)
    const lift = 1 / (1 + v.ball.z * 1.6);
    if (this.arena === "night") {
      // 4 directional soft shadows use the exact same responsive mast positions
      // as the visible LED heads (portrait / landscape / desktop).
      const masts = nightMastPositions(this.layout);
      for (const mast of masts) {
        const dx = ground.x - mast.x;
        const dy = ground.y - mast.y;
        const dist = Math.hypot(dx, dy) || 1;
        const ux = dx / dist;
        const uy = dy / dist;
        const shLen = r * 1.05 * lift;
        const shWidth = r * 0.48 * lift;
        const angle = Math.atan2(uy, ux);
        ctx.save();
        ctx.translate(ground.x + ux * shLen * 0.45, ground.y + uy * shLen * 0.45);
        ctx.rotate(angle);
        ctx.scale(shLen / (r * 0.65), shWidth / (r * 0.65));
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 0.65);
        g.addColorStop(0, `rgba(0,0,0,${0.24 * lift})`);
        g.addColorStop(0.5, `rgba(0,0,0,${0.10 * lift})`);
        g.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(0, 0, r * 0.65, 0, 7);
        ctx.fill();
        ctx.restore();
      }
      // Dark overlap core directly under the ball
      ctx.save();
      ctx.translate(ground.x, ground.y + r * 0.14);
      ctx.scale(1, 0.42);
      const cg = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 0.62 * lift);
      cg.addColorStop(0, `rgba(0,0,0,${0.46 * lift})`);
      cg.addColorStop(0.55, `rgba(0,0,0,${0.18 * lift})`);
      cg.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = cg;
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.62 * lift, 0, 7);
      ctx.fill();
      ctx.restore();
    } else {
      const shR = r * 1.15 * lift;
      ctx.save();
      ctx.translate(ground.x + r * 0.12, ground.y + r * 0.42);
      ctx.scale(1, 0.38);
      const sg = ctx.createRadialGradient(0, 0, 0, 0, 0, shR * 1.6);
      sg.addColorStop(0, `rgba(0,0,0,${0.42 * lift})`);
      sg.addColorStop(0.55, `rgba(0,0,0,${0.18 * lift})`);
      sg.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = sg;
      ctx.beginPath();
      ctx.arc(0, 0, shR * 1.6, 0, 7);
      ctx.fill();
      ctx.restore();
    }

    // squash
    const sq = v.ball.squash;
    const sx = 1 + sq * 0.2;
    const sy = 1 - sq * 0.18;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(sx, sy);
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, 7);
    ctx.clip();

    // 1 · matte leather base — key light upper-left, ambient wrap
    const lx = -0.42;
    const ly = -0.46;
    const base = ctx.createRadialGradient(lx * r, ly * r, r * 0.05, 0, 0, r * 1.15);
    base.addColorStop(0, "#fbfbf7");
    base.addColorStop(0.35, "#eceee8");
    base.addColorStop(0.7, "#c2c7bf");
    base.addColorStop(1, "#7c837b");
    ctx.fillStyle = base;
    ctx.fillRect(-r, -r, r * 2, r * 2);

    // 2 · black pentagons — dodecahedron normals, rotated, projected as
    //     ellipses that shrink & flatten toward the rim (correct foreshortening)
    const { rotX, rotY } = v.ball;
    const cX = Math.cos(rotX), sX = Math.sin(rotX);
    const cY = Math.cos(rotY), sY = Math.sin(rotY);
    // Rotate a unit vector: X then Y (shared by pentagons and seams)
    const rot = (n: [number, number, number]) => {
      const y1 = n[1] * cX - n[2] * sX;
      const z1 = n[1] * sX + n[2] * cX;
      const x2 = n[0] * cY + z1 * sY;
      const z2 = -n[0] * sY + z1 * cY;
      return { x: x2, y: y1, z: z2 };
    };
    // Пятиугольник занимает 20.08° дуги, то есть ровно sin(20.08°)=0.343 радиуса
    // на экране — размер и расположение берутся прямо из геометрии мяча.
    const RV = BALL.verts.map(rot);
    /** Ортографическая проекция; точки за кромкой прижимаются к силуэту. */
    const put = (p: { x: number; y: number; z: number }): [number, number] => {
      if (p.z >= 0) return [p.x * r, -p.y * r];
      const l = Math.hypot(p.x, p.y) || 1;
      return [(p.x / l) * r, -(p.y / l) * r];
    };
    const SEG = 4;
    /** Ребро по дуге большого круга — на шаре оно изогнуто, а не прямое. */
    const arcTo = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }, open: boolean) => {
      const d = Math.min(1, Math.max(-1, a.x * b.x + a.y * b.y + a.z * b.z));
      const om = Math.acos(d);
      const so = Math.sin(om);
      for (let s = open ? 0 : 1; s <= SEG; s++) {
        const u = s / SEG;
        const p =
          so < 1e-6
            ? a
            : {
                x: (Math.sin((1 - u) * om) * a.x + Math.sin(u * om) * b.x) / so,
                y: (Math.sin((1 - u) * om) * a.y + Math.sin(u * om) * b.y) / so,
                z: (Math.sin((1 - u) * om) * a.z + Math.sin(u * om) * b.z) / so,
              };
        const [px, py] = put(p);
        if (s === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
    };

    for (let f = 0; f < BALL.pentagons.length; f++) {
      const ring = BALL.pentagons[f];
      // Виден, если на лицевой стороне есть хоть один угол: у кромки
      // пятиугольник плавно выходит серпом, а не выскакивает целиком.
      if (!ring.some((i) => RV[i].z > 0)) continue;
      const axis = rot(BALL.axes[f]);
      // lambert with key light from upper-left
      const lam = Math.max(0, axis.x * -0.5 + axis.y * 0.55 + axis.z * 0.68);
      const shade = 16 + lam * 30;
      ctx.beginPath();
      for (let k = 0; k < 5; k++) arcTo(RV[ring[k]], RV[ring[(k + 1) % 5]], k === 0);
      ctx.closePath();
      ctx.fillStyle = `rgb(${shade | 0},${(shade * 1.04) | 0},${(shade * 1.12) | 0})`;
      ctx.fill();
      // stitched edge + inner leather highlight
      ctx.strokeStyle = "rgba(255,255,255,0.16)";
      ctx.lineWidth = Math.max(0.6, r * 0.03);
      ctx.stroke();
    }

    // 3 · швы — настоящие 90 рёбер, поэтому белые шестиугольники читаются сами
    ctx.strokeStyle = "rgba(50,56,52,0.26)";
    ctx.lineWidth = Math.max(0.6, r * 0.024);
    ctx.lineCap = "round";
    ctx.beginPath();
    for (const [i, j] of BALL.edges) {
      const a = RV[i];
      const b = RV[j];
      if (a.z <= 0 && b.z <= 0) continue;
      arcTo(a, b, true);
    }
    ctx.stroke();

    // 4 · leather grain
    ctx.globalAlpha = 0.08;
    ctx.fillStyle = "#000";
    for (let i = 0; i < 22; i++) {
      const a = (i * 2.399) % (Math.PI * 2);
      const d = Math.sqrt(((i * 7919) % 100) / 100) * r * 0.95;
      ctx.beginPath();
      ctx.arc(Math.cos(a) * d, Math.sin(a) * d, r * 0.028, 0, 7);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // 5 · fresnel rim (dark edge, thin) + grass bounce light from below
    const rim = ctx.createRadialGradient(0, 0, r * 0.78, 0, 0, r);
    rim.addColorStop(0, "rgba(0,0,0,0)");
    rim.addColorStop(1, "rgba(10,14,12,0.45)");
    ctx.fillStyle = rim;
    ctx.fillRect(-r, -r, r * 2, r * 2);
    const bl = getArena(this.arena).bounceLight;
    const bounce = ctx.createLinearGradient(0, r * 0.35, 0, r);
    bounce.addColorStop(0, `rgba(${bl},0)`);
    bounce.addColorStop(1, `rgba(${bl},0.20)`);
    ctx.fillStyle = bounce;
    ctx.fillRect(-r, 0, r * 2, r);

    // 6 · specular — 4 floodlight glints in night mode, single sun glint otherwise
    if (this.arena === "night") {
      const glints = [
        [-0.34, -0.36, 0.95],
        [0.34, -0.36, 0.90],
        [-0.30, 0.28, 0.72],
        [0.30, 0.28, 0.68],
      ];
      for (const [gx, gy, strength] of glints) {
        const spec = ctx.createRadialGradient(gx * r, gy * r, 0, gx * r, gy * r, r * 0.24);
        spec.addColorStop(0, `rgba(255,255,255,${0.95 * strength})`);
        spec.addColorStop(0.4, `rgba(215,245,255,${0.38 * strength})`);
        spec.addColorStop(1, "rgba(200,240,255,0)");
        ctx.fillStyle = spec;
        ctx.fillRect(-r, -r, r * 2, r * 2);
      }
    } else {
      const spec = ctx.createRadialGradient(lx * r * 0.95, ly * r * 0.95, 0, lx * r * 0.95, ly * r * 0.95, r * 0.34);
      spec.addColorStop(0, "rgba(255,255,255,0.92)");
      spec.addColorStop(0.35, "rgba(255,255,255,0.35)");
      spec.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = spec;
      ctx.fillRect(-r, -r, r * 2, r * 2);
    }
    ctx.restore();

    // crisp silhouette
    ctx.strokeStyle = "rgba(10,14,10,0.42)";
    ctx.lineWidth = Math.max(1, cell * 0.018);
    ctx.beginPath();
    ctx.ellipse(cx, cy, r * sx, r * sy, 0, 0, 7);
    ctx.stroke();
  }

  private drawParticles(ctx: CanvasRenderingContext2D, fx: Particles, cell: number) {
    for (const p of fx.list) {
      const k = 1 - p.life / p.ttl;
      const pos = this.toPx(p.x, p.y);
      const zz = p.z * cell;
      ctx.globalAlpha = Math.min(1, k * 1.6);
      if (p.kind === "dust") {
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y - zz, p.size * cell * (1 + p.life * 2.4), 0, 7);
        ctx.fill();
      } else if (p.kind === "mud") {
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y - zz, p.size * cell, 0, 7);
        ctx.fill();
      } else if (p.kind === "snow") {
        // bright snow puffs and frosty crystalline specks
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y - zz, p.size * cell * (1 + p.life * 1.5), 0, 7);
        ctx.fill();
        // icy glint highlight
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(pos.x - p.size * cell * 0.25, pos.y - zz - p.size * cell * 0.25, Math.max(0.6, p.size * cell * 0.45), 0, 7);
        ctx.fill();
      } else if (p.kind === "sand") {
        // tiny dry sand grains
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y - zz, Math.max(0.5, p.size * cell), 0, 7);
        ctx.fill();
      } else if (p.kind === "ink") {
        // ink droplet: squash flat as it lands on the page
        const squash = 1 - Math.min(0.65, p.z * 0.9);
        ctx.save();
        ctx.translate(pos.x, pos.y - zz);
        ctx.scale(1, squash);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(0, 0, Math.max(0.7, p.size * cell), 0, 7);
        ctx.fill();
        // wet gloss highlight on fresh ink
        ctx.globalAlpha *= 0.5;
        ctx.fillStyle = "#cfd9ff";
        ctx.beginPath();
        ctx.arc(-p.size * cell * 0.3, -p.size * cell * 0.3, Math.max(0.4, p.size * cell * 0.34), 0, 7);
        ctx.fill();
        ctx.restore();
      } else if (p.kind === "fibre") {
        // paper fluff / eraser crumb: light spinning fleck
        ctx.save();
        ctx.translate(pos.x, pos.y - zz);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        const w = p.size * cell * 1.5;
        ctx.fillRect(-w, -w * 0.32, w * 2, w * 0.64);
        ctx.restore();
      } else {
        // blade / confetti: spinning quads
        ctx.save();
        ctx.translate(pos.x, pos.y - zz);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        const w = p.size * cell;
        ctx.fillRect(-w, -w * 0.28, w * 2, w * 0.56);
        ctx.restore();
      }
    }
    ctx.globalAlpha = 1;
  }
}
