/* ============================================================
 * PAPER SOCCER — жизнь по краям поля (client-only)
 *   stadium : светодиодные щиты за воротами, голуби, тени облаков
 *   night   : фотографы со вспышками, мотыльки у прожекторов
 *   winter  : ёлки с осыпающимся снегом, снеговик с шарфом
 *   beach   : крабы, морские звёзды, парусник на горизонте
 *   paper   : каракули на полях, которые рисуются сами и стираются
 *
 * Правило одно: ничего не рисуется внутри поля, в воротах и у угловых флагов.
 * Сценки живут в «слотах» — свободных прямоугольниках за линиями ворот и
 * у бровок. Если слота нет (узкий экран), сценка просто не рисуется.
 * ============================================================ */

import { goalHalf } from "./engine";
import { nightMastPositions, type Layout } from "./field";

type C2 = CanvasRenderingContext2D;

interface Slot {
  id: number; // 0 TL, 1 TR, 2 BL, 3 BR, 4+ — боковые
  x: number;
  y: number;
  w: number;
  h: number;
  end: boolean; // за линией ворот (иначе — у бровки)
  top: boolean; // верхний край поля
}

/** Свободные прямоугольники вокруг поля. */
function layoutSlots(L: Layout): Slot[] {
  const cw = L.cellW;
  const ch = L.cellH;
  const x0 = L.ox;
  const x1 = L.ox + cw * (L.cols - 1);
  const y0 = L.oy;
  const y1 = L.oy + ch * (L.rows - 1);
  const mid = (x0 + x1) / 2;
  const box = (goalHalf(L.cols) + 0.75) * cw; // сетка, штанги и запас
  const gap = 0.16 * ch;
  const out: Slot[] = [];

  const ends = [
    { id: 0, xa: x0 + 1.15 * cw, xb: mid - box, ya: y0 - 1.25 * ch, yb: y0 - gap, top: true },
    { id: 1, xa: mid + box, xb: x1 - 1.15 * cw, ya: y0 - 1.25 * ch, yb: y0 - gap, top: true },
    { id: 2, xa: x0 + 1.15 * cw, xb: mid - box, ya: y1 + gap, yb: y1 + 1.25 * ch, top: false },
    { id: 3, xa: mid + box, xb: x1 - 1.15 * cw, ya: y1 + gap, yb: y1 + 1.25 * ch, top: false },
  ];
  for (const e of ends) {
    // на телефоне справа внизу живёт кнопка «конец хода»
    if (L.phone && e.id === 3) continue;
    const sy = Math.max(3, e.ya);
    const sy2 = Math.min(L.h - 3, e.yb);
    const w = e.xb - e.xa;
    const h = sy2 - sy;
    if (w >= 0.9 * cw && h >= 0.55 * ch) out.push({ id: e.id, x: e.xa, y: sy, w, h, end: true, top: e.top });
  }

  // боковые полосы — только там, где поле действительно узкое по краям
  const sideL = Math.min(x0 - 3, 0.9 * cw);
  const sideR = Math.min(L.w - x1 - 3, 0.9 * cw);
  const fr = [0.3, 0.7];
  for (let i = 0; i < 2; i++) {
    const cy = y0 + (y1 - y0) * fr[i];
    const h = 1.5 * ch;
    if (sideL >= 0.64 * cw) out.push({ id: 4 + i, x: x0 - sideL, y: cy - h / 2, w: sideL - 0.12 * cw, h, end: false, top: false });
    if (sideR >= 0.64 * cw) out.push({ id: 6 + i, x: x1 + 0.12 * cw, y: cy - h / 2, w: sideR - 0.12 * cw, h, end: false, top: false });
  }
  return out;
}

function H(i: number, k: number): number {
  const s = Math.sin(i * 127.1 + k * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function ell(ctx: C2, x: number, y: number, rx: number, ry: number) {
  ctx.beginPath();
  ctx.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), 0, 0, 7);
}

/* ============================================================
 * СТАДИОН
 * ============================================================ */

/** Тени облаков, медленно плывущие по газону. */
export function drawCloudShadows(ctx: C2, L: Layout, t: number) {
  ctx.save();
  for (let i = 0; i < 3; i++) {
    const u = ((t * (0.012 + i * 0.005) + i * 0.37) % 1.4) - 0.2;
    const x = u * (L.w + 400) - 200;
    const y = L.h * (0.2 + 0.3 * i) + Math.sin(t * 0.1 + i) * L.h * 0.08;
    const rx = L.w * (0.32 + 0.1 * i);
    const ry = L.h * 0.12;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(1, ry / rx);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
    g.addColorStop(0, "rgba(0,20,8,0.09)");
    g.addColorStop(0.6, "rgba(0,20,8,0.04)");
    g.addColorStop(1, "rgba(0,20,8,0)");
    ctx.fillStyle = g;
    ctx.fillRect(-rx, -rx, rx * 2, rx * 2);
    ctx.restore();
  }
  ctx.restore();
}

function pigeon(ctx: C2, cx: number, cy: number, size: number, seed: number, t: number, range: number) {
  const ph = t * 0.2 + seed * 7;
  const x = cx + Math.sin(ph) * range;
  const dir = Math.cos(ph) >= 0 ? 1 : -1;
  const walking = Math.abs(Math.cos(ph)) > 0.18;
  const peck = Math.pow(Math.max(0, Math.sin(t * 3.6 + seed * 5)), 4) * size * 0.85 * (walking ? 0.25 : 1);
  const bob = walking ? Math.abs(Math.sin(t * 9 + seed)) * size * 0.06 : 0;
  const y = cy - bob;
  ctx.fillStyle = "rgba(0,0,0,0.2)";
  ell(ctx, x, cy + size * 0.66, size, size * 0.2);
  ctx.fill();
  // лапки
  const sw = walking ? Math.sin(t * 9 + seed) * size * 0.25 : 0;
  ctx.strokeStyle = "#d98a8a";
  ctx.lineWidth = Math.max(1, size * 0.1);
  ctx.beginPath();
  ctx.moveTo(x - size * 0.15, y + size * 0.5);
  ctx.lineTo(x - size * 0.15 + sw, cy + size * 0.66);
  ctx.moveTo(x + size * 0.15, y + size * 0.5);
  ctx.lineTo(x + size * 0.15 - sw, cy + size * 0.66);
  ctx.stroke();
  // хвост, тело, крыло
  ctx.fillStyle = "#6f7a87";
  ctx.beginPath();
  ctx.moveTo(x - dir * size * 0.8, y - size * 0.1);
  ctx.lineTo(x - dir * size * 1.5, y + size * 0.25);
  ctx.lineTo(x - dir * size * 0.7, y + size * 0.35);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#9aa4b0";
  ell(ctx, x, y, size, size * 0.64);
  ctx.fill();
  ctx.fillStyle = "#727d8a";
  ell(ctx, x - dir * size * 0.15, y - size * 0.04, size * 0.62, size * 0.36);
  ctx.fill();
  // голова с радужной шеей
  const hx = x + dir * size * 0.92;
  const hy = y - size * 0.42 + peck;
  ctx.fillStyle = "#8a95a2";
  ctx.beginPath();
  ctx.arc(hx, hy, size * 0.36, 0, 7);
  ctx.fill();
  ctx.fillStyle = "rgba(90,168,154,0.7)";
  ctx.beginPath();
  ctx.arc(x + dir * size * 0.68, y - size * 0.2 + peck * 0.6, size * 0.3, 0, 7);
  ctx.fill();
  ctx.fillStyle = "#f1c27a";
  ctx.beginPath();
  ctx.moveTo(hx + dir * size * 0.3, hy - size * 0.04);
  ctx.lineTo(hx + dir * size * 0.62, hy + size * 0.1 + peck * 0.1);
  ctx.lineTo(hx + dir * size * 0.28, hy + size * 0.12);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.arc(hx + dir * size * 0.1, hy - size * 0.08, size * 0.09, 0, 7);
  ctx.fill();
  ctx.fillStyle = "#111";
  ctx.beginPath();
  ctx.arc(hx + dir * size * 0.13, hy - size * 0.08, size * 0.045, 0, 7);
  ctx.fill();
}

function stadiumLife(ctx: C2, L: Layout, slots: Slot[], t: number) {
  const size = Math.min(L.cellW, L.cellH) * 0.13;
  for (const s of slots) {
    if (s.end) {
      if (s.id === 1 || s.id === 2) {
        const cy = s.y + s.h * 0.5;
        pigeon(ctx, s.x + s.w / 2, cy, size, s.id * 0.37, t, s.w * 0.3);
      }
    } else if (s.id === 4) {
      pigeon(ctx, s.x + s.w / 2, s.y + s.h / 2, Math.min(size, s.w * 0.22), 0.8, t, s.h * 0.2);
    }
  }
}

/* ============================================================
 * НОЧЬ
 * ============================================================ */

function photographer(ctx: C2, x: number, y: number, size: number, seed: number, t: number) {
  ctx.fillStyle = "rgba(2,10,12,0.82)";
  ctx.beginPath();
  ctx.ellipse(x, y + size * 0.55, size * 0.95, size * 0.7, 0, Math.PI, 0);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x, y - size * 0.15, size * 0.46, 0, 7);
  ctx.fill();
  ctx.fillStyle = "rgba(0,0,0,0.92)";
  ctx.fillRect(x + size * 0.1, y - size * 0.38, size * 0.7, size * 0.4);

  // Вспышки редкие: у каждого фотографа свой период 18–40 с, сама вспышка
  // короткая (0.22 с), двойная — лишь у каждого пятого и только изредка.
  const p = 18 + 22 * H(seed, 1);
  const el = (t + H(seed, 2) * p) % p;
  let b = el < 0.22 ? 1 - el / 0.22 : 0;
  if (H(seed, 3) > 0.8 && el > 0.5 && el < 0.72) b = Math.max(b, 1 - (el - 0.5) / 0.22);
  if (b <= 0.02) return;
  const lx = x + size * 0.8;
  const ly = y - size * 0.2;
  const r = size * (1.6 + 3.2 * b);
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  const g = ctx.createRadialGradient(lx, ly, 0, lx, ly, r);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.3, "rgba(220,244,255,0.55)");
  g.addColorStop(1, "rgba(190,230,255,0)");
  ctx.globalAlpha = b;
  ctx.fillStyle = g;
  ctx.fillRect(lx - r, ly - r, r * 2, r * 2);
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = Math.max(1, size * 0.12);
  ctx.beginPath();
  ctx.moveTo(lx - r * 0.9, ly);
  ctx.lineTo(lx + r * 0.9, ly);
  ctx.moveTo(lx, ly - r * 0.7);
  ctx.lineTo(lx, ly + r * 0.7);
  ctx.stroke();
  ctx.restore();
}

function nightLife(ctx: C2, L: Layout, slots: Slot[], t: number) {
  const size = Math.min(L.cellW, L.cellH) * 0.16;
  for (const s of slots) {
    const n = Math.max(1, Math.min(2, Math.floor(s.w / (1.0 * L.cellW))));
    for (let k = 0; k < n; k++) {
      const x = s.x + (s.w * (k + 0.5)) / n;
      const y = s.end ? s.y + s.h * 0.55 : s.y + s.h * (0.35 + 0.3 * H(s.id, k));
      photographer(ctx, x, y, Math.min(size, s.w * 0.22), s.id * 3 + k, t);
    }
  }
  // мотыльки у прожекторов
  const masts = nightMastPositions(L);
  const wing = L.cell * 0.045;
  for (let m = 0; m < masts.length; m++) {
    const mast = masts[m];
    if (mast.x < 0 || mast.x > L.w || mast.y < 0 || mast.y > L.h) continue;
    for (let k = 0; k < 3; k++) {
      const i = m * 3 + k;
      const R = L.cell * (0.34 + 0.4 * H(i, 1));
      const a = t * (1.6 + 1.4 * H(i, 2)) + H(i, 3) * 6.283;
      const mx = mast.x + Math.cos(a) * R;
      const my = mast.y + Math.sin(a * 1.37) * R * 0.7;
      const flap = 0.4 + 0.6 * Math.abs(Math.sin(t * 22 + i));
      ctx.fillStyle = "rgba(255,248,220,0.85)";
      ell(ctx, mx - wing * 0.9, my, wing * flap, wing * 0.65);
      ctx.fill();
      ell(ctx, mx + wing * 0.9, my, wing * flap, wing * 0.65);
      ctx.fill();
      ctx.fillStyle = "rgba(60,52,40,0.9)";
      ctx.beginPath();
      ctx.arc(mx, my, wing * 0.4, 0, 7);
      ctx.fill();
    }
  }
}

/* ============================================================
 * ЗИМА
 * ============================================================ */

/* ---------- зимняя «роща»: разные деревья, кусты и пни ---------- */

type PlantKind = "spruce" | "tall" | "pine" | "birch" | "bush" | "stump" | "lit";

interface Plant {
  kind: PlantKind;
  x: number; // центр по горизонтали
  y: number; // линия земли
  h: number;
  hw: number; // половина ширины
  seed: number;
}

const SPRUCE_GREENS = ["#1a4f3a", "#1d5a42", "#16453a", "#22604a", "#2a6a50", "#174a3c"];

function pickPlant(r: number, wide: boolean): PlantKind {
  if (r < 0.26) return "spruce";
  if (r < 0.42) return "tall";
  if (r < 0.56) return "pine";
  if (r < 0.7) return "birch";
  if (r < 0.84) return "bush";
  if (r < 0.92) return "stump";
  return wide ? "lit" : "spruce";
}

function heightFactor(kind: PlantKind, r: number): number {
  switch (kind) {
    case "spruce":
      return 0.52 + 0.4 * r;
    case "tall":
      return 0.78 + 0.22 * r;
    case "pine":
      return 0.68 + 0.3 * r;
    case "birch":
      return 0.58 + 0.36 * r;
    case "bush":
      return 0.2 + 0.14 * r;
    case "stump":
      return 0.12 + 0.07 * r;
    default:
      return 0.7 + 0.25 * r;
  }
}

function widthRatio(kind: PlantKind, r: number): number {
  switch (kind) {
    case "spruce":
      return 0.2 + 0.1 * r;
    case "tall":
      return 0.13 + 0.05 * r;
    case "pine":
      return 0.2 + 0.05 * r;
    case "birch":
      return 0.17 + 0.05 * r;
    case "bush":
      return 0.95 + 0.35 * r;
    case "stump":
      return 0.5 + 0.15 * r;
    default:
      return 0.24 + 0.04 * r;
  }
}

/** Тень и снежный бугорок у подножия — «сажают» дерево в сугроб. */
function snowMound(ctx: C2, x: number, y: number, hw: number, h: number) {
  const ry = Math.max(h * 0.035, hw * 0.1);
  ctx.fillStyle = "rgba(60,90,125,0.2)";
  ell(ctx, x + h * 0.1, y, hw * 1.2, ry);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.93)";
  ell(ctx, x - hw * 0.08, y - ry * 0.25, hw * 0.95, ry * 0.8);
  ctx.fill();
}

/** Время от времени с ветки срывается ком снега и рассыпается у земли. */
function snowDrop(ctx: C2, x: number, y: number, h: number, seed: number, t: number) {
  const p = 7 + 6 * H(seed, 1);
  const ph = (t + H(seed, 2) * p) % p;
  if (ph >= 0.9) return;
  const k = ph / 0.9;
  const side = H(seed, 3) < 0.5 ? -1 : 1;
  const fx = x + side * h * 0.18;
  const fy = y - h * 0.5 * (1 - k * k);
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.beginPath();
  ctx.arc(fx, fy, Math.max(1, h * 0.035), 0, 7);
  ctx.fill();
  if (k > 0.82) {
    const pk = (k - 0.82) / 0.18;
    ctx.strokeStyle = `rgba(255,255,255,${(0.7 * (1 - pk)).toFixed(3)})`;
    ctx.lineWidth = Math.max(1, h * 0.02);
    ctx.beginPath();
    ctx.arc(fx, y, h * (0.03 + 0.07 * pk), Math.PI, 0);
    ctx.stroke();
  }
}

/** Ель: разное число ярусов, ширина, наклон и «заснеженность»;
 *  края ярусов рваные, а с «lit» — ещё и гирлянда с мерцающими огоньками. */
function spruce(ctx: C2, x: number, y: number, h: number, hw: number, seed: number, t: number, lit = false) {
  const sway = Math.sin(t * 0.9 + seed * 6) * 0.04 + Math.sin(t * 0.37 + seed) * 0.018;
  const lean = (H(seed, 11) - 0.5) * 0.07;
  const snow = 0.3 + 0.7 * H(seed, 12);
  const tiers = Math.max(3, Math.min(6, Math.round(2.4 + (h / hw) * 0.55 + (H(seed, 13) - 0.5) * 1.2)));
  const trunkH = h * 0.1;
  const body = h - trunkH * 0.6;
  const th = body / (1 + (tiers - 1) * 0.52);
  const step = th * 0.52;
  const lights = ["#ffd166", "#ff5a5f", "#5ad2ff", "#9fe870"];

  snowMound(ctx, x, y, hw, h);
  ctx.save();
  ctx.translate(x, y);
  ctx.transform(1, 0, sway + lean, 1, 0, 0);
  ctx.fillStyle = "#4a3426";
  ctx.fillRect(-hw * 0.12, -trunkH, hw * 0.24, trunkH);

  for (let k = 0; k < tiers; k++) {
    const base = -trunkH * 0.6 - k * step;
    const tw = hw * (1 - (0.72 * k) / tiers) * (0.93 + 0.14 * H(seed, 20 + k));
    const teeth = 3 + (k < 2 ? 1 : 0);
    const apexY = base - th;

    // контур яруса: вогнутые бока и рваный нижний край
    ctx.beginPath();
    ctx.moveTo(0, apexY);
    ctx.quadraticCurveTo(tw * 0.38, base - th * 0.4, tw, base + th * 0.03);
    for (let j = 1; j <= teeth * 2; j++) {
      const u = j / (teeth * 2);
      const px = tw - 2 * tw * u;
      const jit = (H(seed, 40 + k * 9 + j) - 0.5) * th * 0.04;
      const py = j % 2 ? base - th * 0.07 + jit : base + th * 0.04 + jit;
      ctx.lineTo(px, py);
    }
    ctx.quadraticCurveTo(-tw * 0.38, base - th * 0.4, 0, apexY);
    ctx.closePath();
    ctx.fillStyle = SPRUCE_GREENS[(Math.floor(H(seed, 14) * 6) + k) % SPRUCE_GREENS.length];
    ctx.fill();
    // объём: правая половина темнее
    ctx.fillStyle = "rgba(0,22,16,0.2)";
    ctx.beginPath();
    ctx.moveTo(0, apexY);
    ctx.quadraticCurveTo(tw * 0.38, base - th * 0.4, tw, base + th * 0.03);
    ctx.lineTo(0, base);
    ctx.closePath();
    ctx.fill();

    // снег: шапка по верху яруса с волнистым краем
    const cut = 0.34 + 0.32 * snow;
    const xr = tw * cut * 0.92;
    const yc = apexY + th * cut;
    ctx.fillStyle = "rgba(255,255,255,0.94)";
    ctx.beginPath();
    ctx.moveTo(0, apexY);
    ctx.lineTo(xr, yc);
    ctx.quadraticCurveTo(xr * 0.5, yc + th * 0.09, 0, yc + th * 0.03);
    ctx.quadraticCurveTo(-xr * 0.5, yc + th * 0.09, -xr, yc);
    ctx.closePath();
    ctx.fill();
    // комья снега на концах лап — тем гуще, чем заснеженнее дерево
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    for (let j = 0; j < teeth; j++) {
      if (H(seed, 70 + k * 7 + j) > snow + 0.15) continue;
      const u = (j * 2 + 1) / (teeth * 2);
      const px = tw - 2 * tw * u;
      ell(ctx, px, base - th * 0.02, tw * 0.2, th * 0.05);
      ctx.fill();
    }

    if (lit) {
      for (let j = 0; j <= teeth; j++) {
        const px = tw - (2 * tw * j) / teeth;
        const py = base - th * 0.02 + Math.sin((j / teeth) * Math.PI) * th * 0.05;
        const a = 0.5 + 0.5 * Math.sin(t * 3.1 + k * 1.9 + j * 1.3);
        const r = Math.max(1, hw * 0.045);
        ctx.fillStyle = lights[(k + j) % 4];
        ctx.globalAlpha = 0.45 + 0.55 * a;
        ctx.beginPath();
        ctx.arc(px, py, r, 0, 7);
        ctx.fill();
        ctx.globalAlpha = 0.22 * a;
        ctx.beginPath();
        ctx.arc(px, py, r * 2.6, 0, 7);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
  }

  if (lit) {
    // звезда на макушке
    const sr = Math.max(2, hw * 0.16);
    ctx.fillStyle = "#ffd166";
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = (i * Math.PI) / 5 - Math.PI / 2;
      const rr = i % 2 ? sr * 0.45 : sr;
      const px = Math.cos(a) * rr;
      const py = -h + Math.sin(a) * rr + sr * 0.35;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
  snowDrop(ctx, x, y, h, seed, t);
}

/** Сосна: высокий рыжий ствол и несколько «шапок» хвои наверху. */
function pine(ctx: C2, x: number, y: number, h: number, hw: number, seed: number, t: number) {
  const sway = Math.sin(t * 0.8 + seed * 5) * 0.035 + Math.sin(t * 0.31 + seed) * 0.015;
  const bend = (H(seed, 5) - 0.5) * hw * 0.5;
  const w0 = hw * 0.3;
  const w2 = hw * 0.17;
  const topY = -h * 0.66;

  snowMound(ctx, x, y, hw, h);
  ctx.save();
  ctx.translate(x, y);
  ctx.transform(1, 0, sway, 1, 0, 0);

  // ствол
  ctx.fillStyle = "#6b4a32";
  ctx.beginPath();
  ctx.moveTo(-w0, 0);
  ctx.quadraticCurveTo(-w0 * 0.6 + bend, -h * 0.35, -w2 + bend * 0.6, topY);
  ctx.lineTo(w2 + bend * 0.6, topY);
  ctx.quadraticCurveTo(w0 * 0.6 + bend, -h * 0.35, w0, 0);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "rgba(40,20,10,0.28)";
  ctx.beginPath();
  ctx.moveTo(w0 * 0.2, 0);
  ctx.quadraticCurveTo(w0 * 0.3 + bend, -h * 0.35, w2 * 0.2 + bend * 0.6, topY);
  ctx.lineTo(w2 + bend * 0.6, topY);
  ctx.quadraticCurveTo(w0 * 0.6 + bend, -h * 0.35, w0, 0);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "rgba(40,24,14,0.55)";
  ctx.lineWidth = Math.max(1, hw * 0.05);
  ctx.beginPath();
  for (let i = 0; i < 4; i++) {
    const yy = -h * (0.1 + 0.14 * i);
    const xx = bend * (i / 4) * 0.9;
    ctx.moveTo(xx - w0 * 0.5, yy);
    ctx.lineTo(xx - w0 * 0.1, yy - h * 0.012);
  }
  ctx.stroke();

  // хвоя: задние шапки первыми
  const clumps: [number, number, number, number][] = [
    [-0.15, -0.93, 0.62, 0],
    [0.9, -0.7, 0.76, 1],
    [-0.85, -0.66, 0.72, 2],
    [0.05, -0.79, 1.0, 3],
  ];
  const greens = ["#1f5a43", "#24694d", "#194a38", "#2a7054"];
  for (const [cx, cy, r, i] of clumps) {
    const px = cx * hw + bend * 0.6;
    const py = cy * h;
    const rx = r * hw * 1.05;
    const ry = rx * 0.52;
    ctx.fillStyle = greens[(i + Math.floor(H(seed, 6) * 4)) % 4];
    ell(ctx, px, py, rx, ry);
    ctx.fill();
    ctx.fillStyle = "rgba(0,22,16,0.22)";
    ell(ctx, px + rx * 0.25, py + ry * 0.3, rx * 0.7, ry * 0.6);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ell(ctx, px - rx * 0.05, py - ry * 0.52, rx * 0.84, ry * 0.5);
    ctx.fill();
    ell(ctx, px - rx * 0.55, py - ry * 0.15, rx * 0.28, ry * 0.2);
    ctx.fill();
  }
  ctx.restore();
  snowDrop(ctx, x, y, h * 0.9, seed, t);
}

/** Берёза: белый ствол с чёрными чёрточками и голые ветки со снегом сверху. */
function birch(ctx: C2, x: number, y: number, h: number, hw: number, seed: number, t: number) {
  const sway = Math.sin(t * 1.1 + seed * 4) * 0.05 + Math.sin(t * 0.4 + seed) * 0.02;
  const w0 = hw * 0.2;
  const w1 = hw * 0.1;
  const topY = -h * 0.86;

  snowMound(ctx, x, y, hw, h);
  ctx.save();
  ctx.translate(x, y);
  ctx.transform(1, 0, sway, 1, 0, 0);

  ctx.fillStyle = "#f1f4f6";
  ctx.beginPath();
  ctx.moveTo(-w0, 0);
  ctx.lineTo(-w1, topY);
  ctx.lineTo(w1, topY);
  ctx.lineTo(w0, 0);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "rgba(120,140,165,0.38)";
  ctx.beginPath();
  ctx.moveTo(w0 * 0.25, 0);
  ctx.lineTo(w1 * 0.25, topY);
  ctx.lineTo(w1, topY);
  ctx.lineTo(w0, 0);
  ctx.closePath();
  ctx.fill();
  // чёрные «глазки» коры
  ctx.fillStyle = "#2a2f35";
  for (let i = 0; i < 7; i++) {
    const u = 0.06 + 0.8 * H(seed, 30 + i);
    const wAt = w0 + (w1 - w0) * u;
    const ww = wAt * (0.5 + 0.9 * H(seed, 40 + i));
    const xx = -wAt + (2 * wAt - ww) * H(seed, 50 + i);
    ctx.fillRect(xx, -h * 0.86 * u, ww, Math.max(1, h * 0.012));
  }

  // голые ветки; на верхней стороне лежит снег
  const nb = 5 + Math.floor(H(seed, 8) * 3);
  const lw = Math.max(1, hw * 0.08);
  for (let i = 0; i < nb; i++) {
    const u = 0.32 + (0.5 * i) / nb + 0.05 * H(seed, 60 + i);
    const side = i % 2 ? 1 : -1;
    const sx = 0;
    const sy = topY * (u / 0.86);
    const ex = side * hw * (0.55 + 0.9 * H(seed, 70 + i));
    const ey = sy - h * (0.1 + 0.13 * H(seed, 80 + i));
    ctx.strokeStyle = "#39404a";
    ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.quadraticCurveTo(sx + ex * 0.5, sy - h * 0.012, ex, ey);
    ctx.moveTo(sx + ex * 0.6, sy + (ey - sy) * 0.55);
    ctx.lineTo(sx + ex * 0.9, ey - h * 0.07);
    ctx.stroke();
    ctx.strokeStyle = "rgba(255,255,255,0.95)";
    ctx.lineWidth = lw * 1.3;
    ctx.beginPath();
    ctx.moveTo(sx + ex * 0.28, sy + (ey - sy) * 0.18 - lw * 0.6);
    ctx.quadraticCurveTo(sx + ex * 0.62, sy - h * 0.018 - lw * 0.4, ex, ey - lw * 0.7);
    ctx.stroke();
  }
  // верхушка
  ctx.strokeStyle = "#39404a";
  ctx.lineWidth = lw * 0.8;
  ctx.beginPath();
  ctx.moveTo(0, topY);
  ctx.lineTo(hw * 0.12, -h);
  ctx.moveTo(0, topY);
  ctx.lineTo(-hw * 0.22, -h * 0.97);
  ctx.stroke();
  ctx.restore();
}

/** Заснеженный куст; у части кустов на ветках алеют ягоды рябины. */
function bush(ctx: C2, x: number, y: number, h: number, hw: number, seed: number, t: number) {
  snowMound(ctx, x, y, hw * 0.8, h * 2);
  // голые прутья
  ctx.strokeStyle = "#5a4332";
  ctx.lineWidth = Math.max(1, h * 0.07);
  ctx.lineCap = "round";
  const n = 9;
  const tips: [number, number][] = [];
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const bx = x + (H(seed, 90 + i) - 0.5) * hw * 0.9;
    const tx = x + (H(seed, 100 + i) - 0.5) * hw * 1.7 + Math.sin(t * 1.2 + i + seed) * hw * 0.03;
    const ty = y - h * (0.7 + 0.5 * H(seed, 110 + i));
    ctx.moveTo(bx, y);
    ctx.quadraticCurveTo((bx + tx) / 2, y - h * 0.5, tx, ty);
    tips.push([tx, ty]);
  }
  ctx.stroke();
  // снежные шапки
  for (let i = 0; i < 4; i++) {
    const cx = x + (i - 1.5) * hw * 0.42 + (H(seed, 120 + i) - 0.5) * hw * 0.15;
    const cy = y - h * (0.28 + 0.3 * H(seed, 130 + i));
    const rx = hw * (0.28 + 0.2 * H(seed, 140 + i));
    const ry = h * (0.3 + 0.18 * H(seed, 150 + i));
    ctx.fillStyle = "rgba(150,180,212,0.55)";
    ell(ctx, cx, cy + ry * 0.2, rx, ry);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.96)";
    ell(ctx, cx, cy, rx, ry * 0.92);
    ctx.fill();
  }
  if (H(seed, 7) > 0.45) {
    ctx.fillStyle = "#d0364a";
    const r = Math.max(1, h * 0.065);
    for (let i = 0; i < tips.length; i += 2) {
      ctx.beginPath();
      ctx.arc(tips[i][0], tips[i][1] + r * 0.6, r, 0, 7);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(tips[i][0] + r * 1.7, tips[i][1] + r * 1.7, r * 0.9, 0, 7);
      ctx.fill();
    }
  }
}

/** Пенёк под снежной шапкой. */
function stump(ctx: C2, x: number, y: number, h: number, hw: number, seed: number) {
  snowMound(ctx, x, y, hw * 1.2, h * 2.2);
  ctx.fillStyle = "#5b412e";
  ctx.beginPath();
  ctx.moveTo(x - hw * 0.9, y);
  ctx.lineTo(x - hw * 0.72, y - h);
  ctx.lineTo(x + hw * 0.72, y - h);
  ctx.lineTo(x + hw * 0.9, y);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "rgba(30,18,10,0.45)";
  ctx.lineWidth = Math.max(1, hw * 0.07);
  ctx.beginPath();
  for (let i = 0; i < 3; i++) {
    const xx = x + (i - 1) * hw * 0.45 + (H(seed, 160 + i) - 0.5) * hw * 0.2;
    ctx.moveTo(xx, y - h * 0.15);
    ctx.lineTo(xx + hw * 0.04, y - h * 0.8);
  }
  ctx.stroke();
  ctx.fillStyle = "#c79c6b";
  ell(ctx, x, y - h, hw * 0.74, hw * 0.22);
  ctx.fill();
  ctx.strokeStyle = "rgba(110,70,36,0.6)";
  ctx.lineWidth = Math.max(1, hw * 0.04);
  ell(ctx, x, y - h, hw * 0.46, hw * 0.13);
  ctx.stroke();
  ell(ctx, x, y - h, hw * 0.2, hw * 0.06);
  ctx.stroke();
  // снежная шапка сдвинута набок — на второй половине виден спил
  ctx.fillStyle = "rgba(255,255,255,0.96)";
  ell(ctx, x - hw * 0.28, y - h - hw * 0.05, hw * 0.55, hw * 0.19);
  ctx.fill();
  ell(ctx, x - hw * 0.62, y - h + hw * 0.12, hw * 0.16, hw * 0.12);
  ctx.fill();
}

function drawPlant(ctx: C2, p: Plant, t: number) {
  switch (p.kind) {
    case "spruce":
    case "tall":
      spruce(ctx, p.x, p.y, p.h, p.hw, p.seed, t);
      break;
    case "lit":
      spruce(ctx, p.x, p.y, p.h, p.hw, p.seed, t, true);
      break;
    case "pine":
      pine(ctx, p.x, p.y, p.h, p.hw, p.seed, t);
      break;
    case "birch":
      birch(ctx, p.x, p.y, p.h, p.hw, p.seed, t);
      break;
    case "bush":
      bush(ctx, p.x, p.y, p.h, p.hw, p.seed, t);
      break;
    default:
      stump(ctx, p.x, p.y, p.h, p.hw, p.seed);
  }
}

/** Расстановка рощи в свободной зоне: разные породы, высоты и просветы.
 *  Всё считается от номера зоны, поэтому композиция не меняется от кадра к кадру. */
function groveFor(L: Layout, s: Slot): Plant[] {
  const hMax = Math.min(s.h * 0.94, L.cellH * 1.05);
  const wide = s.w > 1.4 * L.cellW;
  const right = s.x + s.w;
  const seedBase = s.id * 17 + 3;
  const out: Plant[] = [];
  let x = s.x;
  for (let i = 0; i < 8; i++) {
    const sd = seedBase + i;
    const kind = pickPlant(H(sd, 1), wide);
    const base = 0.86 + 0.08 * H(sd, 2);
    const yG = s.y + s.h * base;
    let h = Math.min(hMax * heightFactor(kind, H(sd, 3)), (yG - s.y) * 0.98);
    let hw = h * widthRatio(kind, H(sd, 4));
    if (out.length === 0 && hw * 2 > s.w) {
      const f = s.w / (hw * 2);
      h *= f;
      hw *= f;
    }
    if (x + hw * 2 > right + 0.5) break;
    out.push({ kind, x: x + hw, y: yG, h, hw, seed: sd });
    const overlap = kind === "bush" || kind === "stump" ? 0.15 : 0.1 + 0.45 * H(sd, 5);
    const clearing = H(sd, 6) > 0.72 ? hw * (0.5 + H(sd, 7)) : 0;
    x += hw * 2 * (1 - overlap) + clearing;
  }
  if (out.length) {
    const last = out[out.length - 1];
    const spare = right - (last.x + last.hw);
    const shift = spare > 0 ? spare * (0.25 + 0.5 * H(seedBase, 9)) : 0;
    for (const p of out) p.x += shift;
  }
  // дальше от зрителя — рисуем раньше; внутри ряда выше — позади
  out.sort((a, b) => a.y - b.y || b.h - a.h);
  return out;
}

function snowman(ctx: C2, cx: number, by: number, size: number, t: number, scarf: string) {
  const r1 = size * 0.3;
  const r2 = size * 0.22;
  const r3 = size * 0.16;
  const y1 = by - r1;
  const y2 = by - r1 * 2 - r2 * 0.7;
  const y3 = y2 - r2 - r3 * 0.55;
  ctx.fillStyle = "rgba(60,90,125,0.22)";
  ell(ctx, cx + size * 0.12, by, size * 0.34, size * 0.05);
  ctx.fill();
  ctx.strokeStyle = "rgba(120,150,180,0.55)";
  ctx.lineWidth = Math.max(1, size * 0.02);
  ctx.fillStyle = "#f7fbff";
  for (const [y, r] of [[y1, r1], [y2, r2], [y3, r3]]) {
    ctx.beginPath();
    ctx.arc(cx, y, r, 0, 7);
    ctx.fill();
    ctx.stroke();
  }
  // шарф цвета команды, конец которого треплет ветер
  const wave = Math.sin(t * 3.2) * size * 0.06;
  ctx.strokeStyle = scarf;
  ctx.lineWidth = Math.max(2, size * 0.07);
  ctx.beginPath();
  ctx.moveTo(cx - r3 * 0.95, y3 + r3 * 0.95);
  ctx.quadraticCurveTo(cx, y3 + r3 * 1.25, cx + r3 * 0.95, y3 + r3 * 0.95);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx + r3 * 0.6, y3 + r3 * 1.1);
  ctx.quadraticCurveTo(cx + r3 * 1.8, y3 + r3 * 1.0 + wave, cx + r3 * 2.6, y3 + r3 * 1.5 + wave * 1.6);
  ctx.stroke();
  // шляпа, глаза, морковка, пуговицы
  ctx.fillStyle = "#1b2430";
  ctx.fillRect(cx - r3 * 0.9, y3 - r3 * 0.95, r3 * 1.8, r3 * 0.22);
  ctx.fillRect(cx - r3 * 0.55, y3 - r3 * 1.75, r3 * 1.1, r3 * 0.85);
  ctx.beginPath();
  ctx.arc(cx - r3 * 0.35, y3 - r3 * 0.15, Math.max(1, r3 * 0.12), 0, 7);
  ctx.arc(cx + r3 * 0.35, y3 - r3 * 0.15, Math.max(1, r3 * 0.12), 0, 7);
  ctx.fill();
  ctx.fillStyle = "#f08a2a";
  ctx.beginPath();
  ctx.moveTo(cx, y3 + r3 * 0.05);
  ctx.lineTo(cx + r3 * 1.15, y3 + r3 * 0.2);
  ctx.lineTo(cx, y3 + r3 * 0.35);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#1b2430";
  ctx.beginPath();
  ctx.arc(cx, y2 + r2 * 0.1, Math.max(1, r2 * 0.1), 0, 7);
  ctx.arc(cx, y2 + r2 * 0.55, Math.max(1, r2 * 0.1), 0, 7);
  ctx.fill();
}

function winterLife(ctx: C2, L: Layout, slots: Slot[], t: number, colors: [string, string]) {
  for (const s of slots) {
    const hMax = Math.min(s.h * 0.92, L.cellH * 1.0);
    let area: Slot = s;
    let man: { x: number; size: number } | null = null;
    if (s.id === 1 && s.w >= 1.2 * L.cellW) {
      const size = Math.min(hMax, s.w * 0.8);
      if (s.w >= size * 0.72 + 0.9 * L.cellW) {
        // снеговик у края, а слева от него — деревья
        const cx = s.x + s.w - size * 0.45;
        man = { x: cx, size };
        area = { ...s, w: cx - size * 0.36 - s.x };
      } else {
        man = { x: s.x + s.w * 0.5, size };
        area = { ...s, w: 0 };
      }
    }
    if (area.w >= 0.4 * L.cellW) {
      for (const p of groveFor(L, area)) drawPlant(ctx, p, t);
    }
    if (man) snowman(ctx, man.x, s.y + s.h * 0.9, man.size, t, colors[1]);
  }
}

/* ============================================================
 * ПЛЯЖ
 * ============================================================ */

function crab(ctx: C2, cx: number, cy: number, size: number, seed: number, t: number, range: number) {
  const ph = t * 0.45 + seed * 9;
  const x = cx + Math.sin(ph) * range;
  const moving = Math.abs(Math.cos(ph));
  const wig = Math.sin(t * 20 + seed) * size * 0.12 * moving;
  const claw = Math.sin(t * 2.4 + seed) * 0.25;
  ctx.fillStyle = "rgba(90,60,20,0.2)";
  ell(ctx, x, cy + size * 0.55, size * 1.1, size * 0.2);
  ctx.fill();
  ctx.strokeStyle = "#c2452c";
  ctx.lineWidth = Math.max(1, size * 0.1);
  ctx.beginPath();
  for (const sd of [-1, 1]) {
    for (let k = 0; k < 3; k++) {
      const bx = x + sd * size * (0.35 + k * 0.18);
      ctx.moveTo(bx, cy + size * 0.2);
      ctx.lineTo(bx + sd * size * 0.5, cy + size * 0.5 + (k % 2 ? wig : -wig));
    }
  }
  ctx.stroke();
  // клешни
  for (const sd of [-1, 1]) {
    const ax = x + sd * size * 0.85;
    const ay = cy - size * (0.35 + claw * sd);
    ctx.strokeStyle = "#c2452c";
    ctx.lineWidth = Math.max(1, size * 0.12);
    ctx.beginPath();
    ctx.moveTo(x + sd * size * 0.6, cy);
    ctx.lineTo(ax, ay);
    ctx.stroke();
    ctx.fillStyle = "#e2593a";
    ctx.beginPath();
    ctx.arc(ax + sd * size * 0.12, ay - size * 0.12, size * 0.3, 0, 7);
    ctx.fill();
    ctx.fillStyle = "rgba(90,60,20,0.55)";
    ctx.beginPath();
    ctx.moveTo(ax + sd * size * 0.12, ay - size * 0.12);
    ctx.lineTo(ax + sd * size * 0.42, ay - size * 0.34);
    ctx.lineTo(ax + sd * size * 0.4, ay - size * 0.08);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = "#e2593a";
  ell(ctx, x, cy, size, size * 0.68);
  ctx.fill();
  ctx.fillStyle = "rgba(255,200,170,0.4)";
  ell(ctx, x - size * 0.2, cy - size * 0.2, size * 0.5, size * 0.22);
  ctx.fill();
  // глаза на стебельках
  ctx.strokeStyle = "#c2452c";
  ctx.lineWidth = Math.max(1, size * 0.08);
  ctx.beginPath();
  ctx.moveTo(x - size * 0.25, cy - size * 0.55);
  ctx.lineTo(x - size * 0.28, cy - size * 0.9);
  ctx.moveTo(x + size * 0.25, cy - size * 0.55);
  ctx.lineTo(x + size * 0.28, cy - size * 0.9);
  ctx.stroke();
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.arc(x - size * 0.28, cy - size * 0.95, size * 0.13, 0, 7);
  ctx.arc(x + size * 0.28, cy - size * 0.95, size * 0.13, 0, 7);
  ctx.fill();
  ctx.fillStyle = "#111";
  ctx.beginPath();
  ctx.arc(x - size * 0.28, cy - size * 0.95, size * 0.06, 0, 7);
  ctx.arc(x + size * 0.28, cy - size * 0.95, size * 0.06, 0, 7);
  ctx.fill();
}

function starfish(ctx: C2, cx: number, cy: number, r: number, rot: number) {
  ctx.fillStyle = "#ee8a5c";
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = rot + (i * Math.PI) / 5 - Math.PI / 2;
    const rr = i % 2 ? r * 0.45 : r;
    const px = cx + Math.cos(a) * rr;
    const py = cy + Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "rgba(255,226,196,0.85)";
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const a = rot + (i * 2 * Math.PI) / 5 - Math.PI / 2;
    ctx.moveTo(cx + Math.cos(a) * r * 0.28 + r * 0.05, cy + Math.sin(a) * r * 0.28);
    ctx.arc(cx + Math.cos(a) * r * 0.28, cy + Math.sin(a) * r * 0.28, Math.max(0.6, r * 0.05), 0, 7);
  }
  ctx.fill();
}

function sailboat(ctx: C2, L: Layout, t: number) {
  const seaBottom = L.oy - L.cell * 1.25;
  if (seaBottom < 36) return;
  const size = Math.min(L.cell * 0.9, seaBottom * 0.28);
  const x = ((t * 0.012 + 0.2) % 1) * (L.w + size * 4) - size * 2;
  const y = seaBottom * 0.52 + Math.sin(t * 1.1) * size * 0.04;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(Math.sin(t * 0.8) * 0.03);
  // кильватер
  ctx.strokeStyle = "rgba(255,255,255,0.35)";
  ctx.lineWidth = Math.max(1, size * 0.04);
  ctx.beginPath();
  ctx.moveTo(-size * 0.7, size * 0.3);
  ctx.lineTo(-size * 1.7, size * 0.34);
  ctx.moveTo(-size * 0.6, size * 0.38);
  ctx.lineTo(-size * 1.4, size * 0.43);
  ctx.stroke();
  // корпус
  ctx.fillStyle = "#7a4e2d";
  ctx.beginPath();
  ctx.moveTo(-size * 0.75, size * 0.15);
  ctx.lineTo(size * 0.75, size * 0.15);
  ctx.lineTo(size * 0.5, size * 0.4);
  ctx.lineTo(-size * 0.55, size * 0.4);
  ctx.closePath();
  ctx.fill();
  // мачта и паруса
  ctx.strokeStyle = "#4a3426";
  ctx.lineWidth = Math.max(1, size * 0.04);
  ctx.beginPath();
  ctx.moveTo(0, size * 0.15);
  ctx.lineTo(0, -size * 0.95);
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.moveTo(size * 0.06, -size * 0.9);
  ctx.lineTo(size * 0.6, size * 0.1);
  ctx.lineTo(size * 0.06, size * 0.1);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#fff1d6";
  ctx.beginPath();
  ctx.moveTo(-size * 0.06, -size * 0.7);
  ctx.lineTo(-size * 0.55, size * 0.1);
  ctx.lineTo(-size * 0.06, size * 0.1);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#e2593a";
  ctx.beginPath();
  ctx.moveTo(0, -size * 0.95);
  ctx.lineTo(size * 0.22 + Math.sin(t * 5) * size * 0.03, -size * 0.88);
  ctx.lineTo(0, -size * 0.8);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function beachLife(ctx: C2, L: Layout, slots: Slot[], t: number) {
  sailboat(ctx, L, t);
  const size = Math.min(L.cellW, L.cellH) * 0.16;
  for (const s of slots) {
    const isCrab = s.id === 1 || s.id === 2 || (s.id >= 4 && s.id % 2 === 1);
    const sz = Math.min(size, s.w * 0.22, s.h * 0.28);
    const cy = s.y + s.h * 0.62;
    if (isCrab) {
      crab(ctx, s.x + s.w / 2, cy, sz, s.id * 0.31, t, Math.max(0, s.w / 2 - sz * 2.2));
    } else {
      starfish(ctx, s.x + s.w * (0.35 + 0.3 * H(s.id, 1)), cy, sz * 0.95, H(s.id, 2) * 1.2);
      if (s.w > 1.6 * L.cellW) starfish(ctx, s.x + s.w * 0.82, s.y + s.h * 0.4, sz * 0.55, H(s.id, 3));
    }
  }
}

/* ============================================================
 * ТЕТРАДЬ — каракули, которые рисуются сами и стираются
 * ============================================================ */

type Stroke = number[];
interface Doodle {
  strokes: Stroke[];
  total: number;
}

const circ = (cx: number, cy: number, r: number, n = 22, a0 = 0, a1 = Math.PI * 2): Stroke => {
  const s: number[] = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    s.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  return s;
};

const mk = (strokes: Stroke[]): Doodle => {
  let total = 0;
  for (const st of strokes) for (let i = 2; i < st.length; i += 2) total += Math.hypot(st[i] - st[i - 2], st[i + 1] - st[i - 1]);
  return { strokes, total };
};

/** Эллипс или его дуга. */
const ov = (cx: number, cy: number, rx: number, ry: number, n = 24, a0 = 0, a1 = Math.PI * 2): Stroke => {
  const s: number[] = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    s.push(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry);
  }
  return s;
};

/** Восемь лучей вокруг солнца. */
const sunRays = (): Stroke[] =>
  Array.from({ length: 8 }, (_, i) => {
    const a = (i * Math.PI) / 4;
    return [0.5 + Math.cos(a) * 0.3, 0.5 + Math.sin(a) * 0.3, 0.5 + Math.cos(a) * 0.46, 0.5 + Math.sin(a) * 0.46];
  });

/** Пять лепестков вокруг сердцевины цветка. */
const flowerPetals = (): Stroke[] =>
  Array.from({ length: 5 }, (_, i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
    return circ(0.5 + Math.cos(a) * 0.17, 0.36 + Math.sin(a) * 0.17, 0.1, 14);
  });

const spiralStroke = (): Stroke => {
  const s: number[] = [];
  for (let i = 0; i <= 60; i++) {
    const a = (i / 60) * Math.PI * 6;
    const r = 0.04 + (0.42 * i) / 60;
    s.push(0.5 + Math.cos(a) * r, 0.5 + Math.sin(a) * r);
  }
  return s;
};

/** Поворот набора штрихов вокруг точки (по умолчанию — центр рисунка). */
const rot = (strokes: Stroke[], deg: number, cx = 0.5, cy = 0.5): Stroke[] => {
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return strokes.map((st) => {
    const o: number[] = [];
    for (let i = 0; i < st.length; i += 2) {
      const dx = st[i] - cx;
      const dy = st[i + 1] - cy;
      o.push(cx + dx * c - dy * s, cy + dx * s + dy * c);
    }
    return o;
  });
};

/** Прямоугольник по углам (x0,y0)–(x1,y1) одним замкнутым штрихом. */
const box = (x0: number, y0: number, x1: number, y1: number): Stroke => [x0, y0, x1, y0, x1, y1, x0, y1, x0, y0];

const DOODLES_FUN: Doodle[] = [
  // звезда
  mk([[0.5, 0.05, 0.62, 0.38, 0.97, 0.38, 0.69, 0.59, 0.8, 0.93, 0.5, 0.72, 0.2, 0.93, 0.31, 0.59, 0.03, 0.38, 0.38, 0.38, 0.5, 0.05]]),
  // смайлик
  mk([circ(0.5, 0.5, 0.45, 28), circ(0.35, 0.4, 0.04, 8), circ(0.65, 0.4, 0.04, 8), circ(0.5, 0.52, 0.26, 14, Math.PI * 0.2, Math.PI * 0.8)]),
  // ракета
  mk([
    [0.5, 0.02, 0.62, 0.2, 0.64, 0.62, 0.36, 0.62, 0.38, 0.2, 0.5, 0.02],
    [0.36, 0.5, 0.2, 0.72, 0.36, 0.66],
    [0.64, 0.5, 0.8, 0.72, 0.64, 0.66],
    circ(0.5, 0.34, 0.07, 10),
    [0.42, 0.7, 0.5, 0.96, 0.58, 0.7],
  ]),
  // домик
  mk([
    [0.12, 0.5, 0.5, 0.12, 0.88, 0.5],
    [0.2, 0.46, 0.2, 0.92, 0.8, 0.92, 0.8, 0.46],
    [0.42, 0.92, 0.42, 0.64, 0.58, 0.64, 0.58, 0.92],
  ]),
  // человечек, бьющий по мячу
  mk([circ(0.4, 0.2, 0.1, 12), [0.4, 0.3, 0.4, 0.62], [0.4, 0.4, 0.2, 0.52], [0.4, 0.4, 0.6, 0.48], [0.4, 0.62, 0.28, 0.92], [0.4, 0.62, 0.6, 0.78, 0.66, 0.9], circ(0.84, 0.88, 0.08, 10)]),
  // спираль
  mk([spiralStroke()]),
  // солнце с улыбкой
  mk([
    circ(0.5, 0.5, 0.2, 24),
    ...sunRays(),
    circ(0.5, 0.52, 0.11, 10, Math.PI * 0.2, Math.PI * 0.8),
    circ(0.44, 0.45, 0.022, 6),
    circ(0.56, 0.45, 0.022, 6),
  ]),
  // цветок
  mk([...flowerPetals(), circ(0.5, 0.36, 0.075, 12), [0.5, 0.63, 0.5, 0.97], [0.5, 0.86, 0.7, 0.76, 0.74, 0.88, 0.5, 0.86]]),
  // котик
  mk([
    ov(0.5, 0.6, 0.34, 0.28, 28),
    [0.19, 0.46, 0.21, 0.13, 0.4, 0.34],
    [0.81, 0.46, 0.79, 0.13, 0.6, 0.34],
    circ(0.38, 0.56, 0.035, 8),
    circ(0.62, 0.56, 0.035, 8),
    [0.46, 0.66, 0.54, 0.66, 0.5, 0.71, 0.46, 0.66],
    [0.5, 0.71, 0.44, 0.77],
    [0.5, 0.71, 0.56, 0.77],
    [0.36, 0.66, 0.06, 0.62],
    [0.36, 0.71, 0.06, 0.75],
    [0.64, 0.66, 0.94, 0.62],
    [0.64, 0.71, 0.94, 0.75],
  ]),
  // парусник
  mk([
    [0.12, 0.66, 0.88, 0.66, 0.74, 0.84, 0.26, 0.84, 0.12, 0.66],
    [0.5, 0.66, 0.5, 0.08],
    [0.54, 0.14, 0.54, 0.62, 0.86, 0.62, 0.54, 0.14],
    [0.46, 0.26, 0.46, 0.62, 0.17, 0.62, 0.46, 0.26],
    [0.5, 0.08, 0.64, 0.12, 0.5, 0.17],
    [0.06, 0.95, 0.18, 0.91, 0.3, 0.95, 0.42, 0.91, 0.54, 0.95, 0.66, 0.91, 0.78, 0.95, 0.94, 0.91],
  ]),
  // рыбка
  mk([
    ov(0.42, 0.5, 0.3, 0.2, 26),
    [0.7, 0.5, 0.93, 0.3, 0.93, 0.7, 0.7, 0.5],
    circ(0.27, 0.45, 0.03, 8),
    [0.13, 0.54, 0.2, 0.56],
    [0.38, 0.32, 0.46, 0.17, 0.56, 0.33],
    ov(0.5, 0.5, 0.09, 0.1, 8, -Math.PI / 2, Math.PI / 2),
    circ(0.1, 0.28, 0.03, 8),
    circ(0.17, 0.16, 0.04, 8),
  ]),
  // бумажный самолётик
  mk([
    [0.06, 0.46, 0.94, 0.1, 0.64, 0.9, 0.46, 0.6, 0.06, 0.46],
    [0.94, 0.1, 0.46, 0.6],
    [0.46, 0.6, 0.5, 0.84, 0.64, 0.9],
    [0.03, 0.74, 0.11, 0.72],
    [0.15, 0.69, 0.23, 0.67],
  ]),
  // кубок
  mk([
    [0.28, 0.12, 0.72, 0.12, 0.7, 0.4, 0.6, 0.56, 0.4, 0.56, 0.3, 0.4, 0.28, 0.12],
    [0.28, 0.18, 0.13, 0.18, 0.13, 0.36, 0.32, 0.45],
    [0.72, 0.18, 0.87, 0.18, 0.87, 0.36, 0.68, 0.45],
    [0.5, 0.56, 0.5, 0.74],
    [0.33, 0.74, 0.67, 0.74, 0.72, 0.9, 0.28, 0.9, 0.33, 0.74],
    [0.5, 0.2, 0.54, 0.29, 0.62, 0.29, 0.56, 0.35, 0.58, 0.43, 0.5, 0.38, 0.42, 0.43, 0.44, 0.35, 0.38, 0.29, 0.46, 0.29, 0.5, 0.2],
  ]),
  // дерево
  mk([
    [0.44, 0.95, 0.44, 0.62],
    [0.56, 0.95, 0.56, 0.62],
    circ(0.5, 0.3, 0.2, 18),
    circ(0.31, 0.46, 0.16, 16),
    circ(0.69, 0.46, 0.16, 16),
    circ(0.42, 0.3, 0.03, 6),
    circ(0.6, 0.4, 0.03, 6),
    [0.15, 0.95, 0.85, 0.95],
  ]),
  // футбольный мяч
  mk([
    circ(0.5, 0.5, 0.44, 30),
    [0.5, 0.34, 0.65, 0.45, 0.59, 0.63, 0.41, 0.63, 0.35, 0.45, 0.5, 0.34],
    [0.5, 0.34, 0.5, 0.06],
    [0.65, 0.45, 0.92, 0.36],
    [0.59, 0.63, 0.75, 0.86],
    [0.41, 0.63, 0.25, 0.86],
    [0.35, 0.45, 0.08, 0.36],
  ]),
  // молния
  mk([[0.58, 0.04, 0.24, 0.54, 0.46, 0.54, 0.38, 0.96, 0.78, 0.4, 0.54, 0.4, 0.58, 0.04]]),
  // бабочка
  mk([
    ov(0.3, 0.34, 0.22, 0.2, 20),
    ov(0.7, 0.34, 0.22, 0.2, 20),
    ov(0.35, 0.68, 0.15, 0.17, 18),
    ov(0.65, 0.68, 0.15, 0.17, 18),
    [0.5, 0.2, 0.5, 0.86],
    [0.5, 0.2, 0.4, 0.06],
    [0.5, 0.2, 0.6, 0.06],
    circ(0.28, 0.34, 0.06, 10),
    circ(0.72, 0.34, 0.06, 10),
  ]),
  // корона
  mk([
    [0.1, 0.8, 0.06, 0.28, 0.3, 0.55, 0.5, 0.2, 0.7, 0.55, 0.94, 0.28, 0.9, 0.8, 0.1, 0.8],
    [0.1, 0.68, 0.9, 0.68],
    circ(0.06, 0.23, 0.04, 8),
    circ(0.5, 0.14, 0.04, 8),
    circ(0.94, 0.23, 0.04, 8),
  ]),
  // машинка
  mk([
    [0.06, 0.68, 0.06, 0.52, 0.26, 0.47, 0.36, 0.28, 0.66, 0.28, 0.78, 0.47, 0.94, 0.52, 0.94, 0.68, 0.06, 0.68],
    [0.4, 0.34, 0.4, 0.47, 0.51, 0.47, 0.51, 0.34, 0.4, 0.34],
    [0.57, 0.34, 0.57, 0.47, 0.72, 0.47, 0.64, 0.34, 0.57, 0.34],
    circ(0.28, 0.72, 0.1, 14),
    circ(0.72, 0.72, 0.1, 14),
    circ(0.28, 0.72, 0.035, 6),
    circ(0.72, 0.72, 0.035, 6),
    [0.02, 0.86, 0.98, 0.86],
  ]),
];

/** Школьные рисунки: то, что рисуют на полях тетради на скучном уроке. */
const DOODLES_SCHOOL: Doodle[] = [
  // раскрытая книга
  mk([
    [0.5, 0.22, 0.28, 0.14, 0.06, 0.2, 0.06, 0.8, 0.28, 0.74, 0.5, 0.82, 0.72, 0.74, 0.94, 0.8, 0.94, 0.2, 0.72, 0.14, 0.5, 0.22],
    [0.5, 0.22, 0.5, 0.82],
    [0.14, 0.32, 0.42, 0.38],
    [0.14, 0.44, 0.42, 0.5],
    [0.14, 0.56, 0.42, 0.62],
    [0.58, 0.38, 0.86, 0.32],
    [0.58, 0.5, 0.86, 0.44],
    [0.58, 0.62, 0.86, 0.56],
  ]),
  // карандаш
  mk(
    rot(
      [
        box(0.4, 0.2, 0.6, 0.72),
        [0.4, 0.72, 0.5, 0.95, 0.6, 0.72],
        [0.46, 0.84, 0.54, 0.84],
        [0.4, 0.2, 0.4, 0.08, 0.43, 0.05, 0.57, 0.05, 0.6, 0.08, 0.6, 0.2],
        [0.4, 0.27, 0.6, 0.27],
        [0.5, 0.27, 0.5, 0.72],
      ],
      42,
    ),
  ),
  // линейка
  mk(
    rot(
      [
        box(0.04, 0.35, 0.96, 0.65),
        ...Array.from({ length: 12 }, (_, i): Stroke => {
          const x = 0.08 + i * 0.077;
          return [x, 0.35, x, 0.35 + (i % 5 === 0 ? 0.17 : 0.09)];
        }),
      ],
      -16,
    ),
  ),
  // рюкзак
  mk([
    ov(0.5, 0.3, 0.28, 0.2, 16, Math.PI, Math.PI * 2),
    [0.22, 0.3, 0.22, 0.9, 0.78, 0.9, 0.78, 0.3],
    ov(0.5, 0.12, 0.1, 0.08, 10, Math.PI, Math.PI * 2),
    [0.3, 0.46, 0.7, 0.46],
    box(0.32, 0.6, 0.68, 0.82),
    [0.42, 0.6, 0.42, 0.66, 0.58, 0.66, 0.58, 0.6],
    [0.22, 0.52, 0.12, 0.54, 0.12, 0.76, 0.22, 0.78],
    [0.78, 0.52, 0.88, 0.54, 0.88, 0.76, 0.78, 0.78],
  ]),
  // глобус
  mk([
    circ(0.5, 0.45, 0.38, 28),
    ov(0.5, 0.45, 0.15, 0.38, 20),
    [0.12, 0.45, 0.88, 0.45],
    [0.19, 0.28, 0.81, 0.28],
    [0.19, 0.62, 0.81, 0.62],
    [0.5, 0.03, 0.5, 0.86],
    [0.5, 0.86, 0.5, 0.92],
    [0.3, 0.95, 0.7, 0.95],
  ]),
  // яблоко
  mk([
    ov(0.5, 0.6, 0.38, 0.33, 28),
    [0.38, 0.32, 0.5, 0.38, 0.62, 0.32],
    [0.5, 0.38, 0.53, 0.14],
    [0.53, 0.2, 0.72, 0.09, 0.74, 0.24, 0.53, 0.2],
    [0.28, 0.5, 0.25, 0.62],
  ]),
  // школьный звонок
  mk([
    [0.2, 0.76, 0.26, 0.44, 0.34, 0.27, 0.5, 0.19, 0.66, 0.27, 0.74, 0.44, 0.8, 0.76, 0.2, 0.76],
    [0.14, 0.76, 0.86, 0.76],
    circ(0.5, 0.85, 0.07, 10),
    circ(0.5, 0.13, 0.05, 8),
    [0.08, 0.42, 0.05, 0.3, 0.09, 0.2],
    [0.92, 0.42, 0.95, 0.3, 0.91, 0.2],
  ]),
  // колба с пузырьками
  mk([
    [0.4, 0.08, 0.6, 0.08],
    [0.42, 0.08, 0.42, 0.38, 0.12, 0.86, 0.88, 0.86, 0.58, 0.38, 0.58, 0.08],
    [0.25, 0.64, 0.75, 0.64],
    circ(0.42, 0.52, 0.04, 8),
    circ(0.56, 0.46, 0.03, 8),
    circ(0.5, 0.75, 0.035, 8),
    circ(0.35, 0.76, 0.025, 8),
  ]),
  // прямоугольный треугольник
  mk([
    [0.12, 0.82, 0.12, 0.2, 0.88, 0.82, 0.12, 0.82],
    [0.12, 0.7, 0.24, 0.7, 0.24, 0.82],
    [0.12, 0.82, 0.4236, 0.4477],
    ov(0.88, 0.82, 0.14, 0.14, 8, Math.PI, Math.PI + 0.68),
  ]),
  // будильник
  mk([
    circ(0.5, 0.55, 0.33, 26),
    ...Array.from({ length: 12 }, (_, i): Stroke => {
      const a = (i * Math.PI) / 6;
      return [0.5 + Math.cos(a) * 0.26, 0.55 + Math.sin(a) * 0.26, 0.5 + Math.cos(a) * 0.3, 0.55 + Math.sin(a) * 0.3];
    }),
    [0.5, 0.55, 0.5, 0.36],
    [0.5, 0.55, 0.65, 0.62],
    circ(0.24, 0.2, 0.1, 10, Math.PI * 0.75, Math.PI * 2),
    circ(0.76, 0.2, 0.1, 10, Math.PI, Math.PI * 2.25),
    [0.3, 0.84, 0.22, 0.96],
    [0.7, 0.84, 0.78, 0.96],
  ]),
  // матрёшка
  mk([
    ov(0.5, 0.63, 0.34, 0.34, 30),
    circ(0.5, 0.29, 0.17, 20),
    circ(0.44, 0.27, 0.022, 6),
    circ(0.56, 0.27, 0.022, 6),
    circ(0.5, 0.31, 0.055, 8, Math.PI * 0.2, Math.PI * 0.8),
    [0.35, 0.36, 0.3, 0.48],
    [0.65, 0.36, 0.7, 0.48],
    [0.3, 0.48, 0.7, 0.48],
    ov(0.5, 0.68, 0.15, 0.17, 18),
    circ(0.44, 0.66, 0.035, 8),
    circ(0.56, 0.66, 0.035, 8),
    circ(0.5, 0.61, 0.035, 8),
    circ(0.5, 0.71, 0.035, 8),
    circ(0.5, 0.66, 0.028, 8),
    [0.16, 0.56, 0.06, 0.6, 0.16, 0.66],
    [0.84, 0.56, 0.94, 0.6, 0.84, 0.66],
  ]),
  // атом
  mk([
    circ(0.5, 0.5, 0.06, 10),
    ...rot([ov(0.5, 0.5, 0.44, 0.16, 30)], 0),
    ...rot([ov(0.5, 0.5, 0.44, 0.16, 30)], 60),
    ...rot([ov(0.5, 0.5, 0.44, 0.16, 30)], 120),
    circ(0.94, 0.5, 0.035, 8),
    circ(0.28, 0.12, 0.035, 8),
    circ(0.28, 0.88, 0.035, 8),
  ]),
  // «пятёрка» в кружке — оценка из дневника
  mk([
    ov(0.5, 0.5, 0.46, 0.4, 30),
    [0.66, 0.19, 0.31, 0.19, 0.31, 0.46],
    [0.31, 0.45, 0.45, 0.42, 0.6, 0.45, 0.7, 0.55, 0.7, 0.67, 0.6, 0.79, 0.45, 0.8, 0.35, 0.73, 0.32, 0.66],
  ]),
  // пенал с карандашами
  mk([
    box(0.06, 0.5, 0.94, 0.82),
    [0.06, 0.61, 0.94, 0.61],
    [0.22, 0.5, 0.22, 0.22, 0.28, 0.1, 0.34, 0.22, 0.34, 0.5],
    [0.46, 0.5, 0.46, 0.18, 0.52, 0.06, 0.58, 0.18, 0.58, 0.5],
    [0.7, 0.5, 0.7, 0.26, 0.76, 0.14, 0.82, 0.26, 0.82, 0.5],
    [0.84, 0.72, 0.9, 0.72],
  ]),
  // транспортир
  mk([
    circ(0.5, 0.78, 0.44, 26, Math.PI, Math.PI * 2),
    [0.06, 0.78, 0.94, 0.78],
    circ(0.5, 0.78, 0.28, 20, Math.PI, Math.PI * 2),
    ...Array.from({ length: 11 }, (_, i): Stroke => {
      const a = Math.PI + (i * Math.PI) / 10;
      const r1 = i % 5 === 0 ? 0.34 : 0.4;
      return [0.5 + Math.cos(a) * r1, 0.78 + Math.sin(a) * r1, 0.5 + Math.cos(a) * 0.44, 0.78 + Math.sin(a) * 0.44];
    }),
    [0.5, 0.78, 0.5, 0.7],
  ]),
  // куб
  mk([
    box(0.12, 0.34, 0.62, 0.88),
    [0.12, 0.34, 0.36, 0.12, 0.88, 0.12, 0.62, 0.34],
    [0.88, 0.12, 0.88, 0.66, 0.62, 0.88],
  ]),
  // график параболы
  mk([
    [0.1, 0.94, 0.1, 0.06],
    [0.04, 0.12, 0.1, 0.05, 0.16, 0.12],
    [0.1, 0.9, 0.95, 0.9],
    [0.88, 0.84, 0.95, 0.9, 0.88, 0.96],
    Array.from({ length: 21 }, (_, i) => {
      const u = (i / 20) * 2 - 1;
      return [0.52 + u * 0.36, 0.2 + u * u * 0.6];
    }).flat(),
    [0.52, 0.9, 0.52, 0.84],
  ]),
  // колокольчик с бантом — «последний звонок»
  mk([
    [0.3, 0.74, 0.3, 0.42, 0.4, 0.28, 0.6, 0.28, 0.7, 0.42, 0.7, 0.74],
    [0.24, 0.74, 0.76, 0.74],
    circ(0.5, 0.84, 0.06, 10),
    [0.44, 0.28, 0.44, 0.2],
    [0.56, 0.28, 0.56, 0.2],
    [0.5, 0.44, 0.24, 0.3, 0.18, 0.52, 0.42, 0.58, 0.5, 0.44],
    [0.5, 0.44, 0.76, 0.3, 0.82, 0.52, 0.58, 0.58, 0.5, 0.44],
    circ(0.5, 0.5, 0.05, 10),
    [0.46, 0.54, 0.34, 0.78],
    [0.54, 0.54, 0.66, 0.78],
  ]),
  // портфель
  mk([
    box(0.1, 0.24, 0.9, 0.9),
    [0.1, 0.4, 0.9, 0.4],
    [0.34, 0.24, 0.34, 0.1, 0.42, 0.06, 0.58, 0.06, 0.66, 0.1, 0.66, 0.24],
    box(0.36, 0.5, 0.64, 0.66),
    [0.5, 0.5, 0.5, 0.66],
    circ(0.5, 0.74, 0.045, 10),
    [0.06, 0.9, 0.94, 0.9],
  ]),
];

const DOODLES: Doodle[] = [...DOODLES_FUN, ...DOODLES_SCHOOL];

const CYCLE = 17;

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
/** Шаг выбора рисунка, взаимно простой с их числом: рисунки идут по кругу
 *  без повторов, а соседние поля одновременно рисуют разное. */
const coprime = (from: number): number => {
  let s = from;
  while (gcd(s, DOODLES.length) !== 1) s++;
  return s;
};
const PICK_STEP = coprime(7);
const PICK_SLOT = coprime(3);

function drawDoodle(ctx: C2, d: Doodle, x: number, y: number, sz: number, prog: number) {
  let remain = prog * d.total;
  let tipX = x;
  let tipY = y;
  ctx.beginPath();
  for (const st of d.strokes) {
    if (remain <= 0) break;
    ctx.moveTo(x + st[0] * sz, y + st[1] * sz);
    tipX = x + st[0] * sz;
    tipY = y + st[1] * sz;
    for (let i = 2; i < st.length; i += 2) {
      const dx = st[i] - st[i - 2];
      const dy = st[i + 1] - st[i - 1];
      const l = Math.hypot(dx, dy);
      if (l >= remain) {
        const k = l > 0 ? remain / l : 0;
        tipX = x + (st[i - 2] + dx * k) * sz;
        tipY = y + (st[i - 1] + dy * k) * sz;
        ctx.lineTo(tipX, tipY);
        remain = 0;
        break;
      }
      tipX = x + st[i] * sz;
      tipY = y + st[i + 1] * sz;
      ctx.lineTo(tipX, tipY);
      remain -= l;
    }
  }
  ctx.stroke();
  if (prog < 1) {
    ctx.beginPath();
    ctx.arc(tipX, tipY, Math.max(1, sz * 0.025), 0, 7);
    ctx.fill();
  }
}

function paperLife(ctx: C2, L: Layout, slots: Slot[], t: number) {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  // Поля за красной чертой остаются чистыми: каракули там не рисуются.
  const redX = Math.round(L.w * 0.06);
  for (const s of slots) {
    if (!s.end && s.x < redX) continue;
    const local = t + s.id * 4.3;
    const cyc = Math.floor(local / CYCLE);
    const ph = (local - cyc * CYCLE) / CYCLE;
    const d = DOODLES[(cyc * PICK_STEP + s.id * PICK_SLOT) % DOODLES.length];
    let prog = 1;
    let alpha = 1;
    if (ph < 0.42) {
      const k = ph / 0.42;
      prog = 1 - Math.pow(1 - k, 1.6);
    } else if (ph >= 0.78 && ph < 0.9) {
      alpha = 1 - (ph - 0.78) / 0.12;
    } else if (ph >= 0.9) {
      continue;
    }
    const sz = Math.min(s.w, s.h) * 0.85;
    ctx.globalAlpha = 0.8 * alpha;
    ctx.strokeStyle = "#2e4290";
    ctx.fillStyle = "#2e4290";
    ctx.lineWidth = Math.max(1, L.cellW * 0.03);
    drawDoodle(ctx, d, s.x + (s.w - sz) / 2, s.y + (s.h - sz) / 2, sz, prog);
  }
  ctx.globalAlpha = 1;
}

/* ============================================================
 * ВХОД
 * ============================================================ */

export function drawEdgeLife(ctx: C2, L: Layout, arena: string, t: number, colors: [string, string]) {
  if (L.w < 120 || L.h < 120) return;
  const slots = layoutSlots(L);
  ctx.save();
  switch (arena) {
    case "stadium":
      stadiumLife(ctx, L, slots, t);
      break;
    case "night":
      nightLife(ctx, L, slots, t);
      break;
    case "winter":
      winterLife(ctx, L, slots, t, colors);
      break;
    case "beach":
      beachLife(ctx, L, slots, t);
      break;
    case "paper":
      paperLife(ctx, L, slots, t);
      break;
    default:
      break;
  }
  ctx.restore();
}
