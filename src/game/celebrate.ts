/* ============================================================
 * PAPER SOCCER — «салют» на гол: у каждой арены свой (client-only)
 *   stadium : солнечные лучи, ударные волны, дневной фейерверк
 *   night   : вспышки камер, мигающие прожекторы, фейерверк
 *   winter  : лавина снега и ледяные осколки
 *   beach   : накат волны с пеной и брызги
 *   paper   : чернильный фейерверк — кляксы и брызги пера
 * Состояние не хранится: всё считается от времени, прошедшего с гола.
 * ============================================================ */

import { nightMastPositions, type Layout } from "./field";
import { rgba } from "./color";

type C2 = CanvasRenderingContext2D;

export interface GoalShow {
  /** performance.now()/1000 в момент гола. */
  t0: number;
  scorer: 0 | 1;
  /** Центр створа ворот в координатах узлов. */
  x: number;
  y: number;
}

export const GOAL_SHOW_SEC = 2.5;

/** Детерминированный «шум» по паре индексов. */
function H(i: number, k: number): number {
  const s = Math.sin(i * 127.1 + k * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

interface Show {
  ctx: C2;
  L: Layout;
  e: number; // секунд с гола
  fade: number; // 1 → 0 в последние 0.6 с
  P: { x: number; y: number }; // центр ворот в пикселях
  color: string;
  C: number; // размер клетки
  down: number; // +1, если ворота сверху (поле «вниз» от них), иначе -1
}

export function drawGoalShow(
  ctx: C2,
  L: Layout,
  g: GoalShow,
  t: number,
  color: string,
  arena: string,
  toPx: (x: number, y: number) => { x: number; y: number },
) {
  const e = t - g.t0;
  if (e < 0 || e > GOAL_SHOW_SEC) return;
  const P = toPx(g.x, g.y);
  const S: Show = {
    ctx,
    L,
    e,
    fade: Math.max(0, Math.min(1, (GOAL_SHOW_SEC - e) / 0.6)),
    P,
    color,
    C: L.cell,
    down: P.y < L.h / 2 ? 1 : -1,
  };
  ctx.save();
  ctx.lineCap = "round";
  switch (arena) {
    case "night":
      night(S);
      break;
    case "winter":
      winter(S);
      break;
    case "beach":
      beach(S);
      break;
    case "paper":
      paper(S);
      break;
    default:
      stadium(S);
  }
  ctx.restore();
}

/** Искры фейерверка: расходятся, тянут хвост и падают под тяжестью. */
function sparks(S: Show, cx: number, cy: number, start: number, n: number, reach: number, color: string, salt: number, life = 1.15) {
  const e = S.e - start;
  if (e < 0 || e > life) return;
  const { ctx } = S;
  const a = 1 - e / life;
  const at = (ee: number, i: number) => {
    const ang = (i / n) * 6.2832 + H(i, salt) * 0.35;
    const sp = 0.55 + 0.45 * H(i, salt + 1);
    const d = reach * sp * (1 - Math.exp(-ee * 3.4));
    return { x: cx + Math.cos(ang) * d, y: cy + Math.sin(ang) * d + ee * ee * reach * 0.32 };
  };
  ctx.globalAlpha = a * a * S.fade;
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1, S.C * 0.035);
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const p1 = at(e, i);
    const p0 = at(Math.max(0, e - 0.07), i);
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(p1.x, p1.y);
  }
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  const r = Math.max(1, S.C * 0.03);
  for (let i = 0; i < n; i++) {
    const p = at(e, i);
    ctx.moveTo(p.x + r, p.y);
    ctx.arc(p.x, p.y, r, 0, 7);
  }
  ctx.fill();
}

/* ---------- стадион: солнечные лучи + ударные волны ---------- */
function stadium(S: Show) {
  const { ctx, L, e, fade, P, C, color } = S;
  const k = Math.max(0, 1 - e / GOAL_SHOW_SEC);

  // вращающиеся лучи из ворот
  const len = C * 14 * (0.55 + 0.45 * Math.min(1, e * 3));
  const rot = e * 0.35;
  const rays = 16;
  const g = ctx.createRadialGradient(P.x, P.y, 0, P.x, P.y, len);
  g.addColorStop(0, "rgba(255,246,206,0.46)");
  g.addColorStop(0.5, rgba(color, 0.16));
  g.addColorStop(1, rgba(color, 0));
  ctx.globalCompositeOperation = "screen";
  ctx.globalAlpha = Math.min(1, e * 5) * fade * (0.45 + 0.55 * k);
  ctx.fillStyle = g;
  ctx.beginPath();
  for (let i = 0; i < rays; i++) {
    const a0 = rot + (i * 6.2832) / rays;
    const a1 = a0 + (3.1416 / rays) * 0.9;
    ctx.moveTo(P.x, P.y);
    ctx.lineTo(P.x + Math.cos(a0) * len, P.y + Math.sin(a0) * len);
    ctx.lineTo(P.x + Math.cos(a1) * len, P.y + Math.sin(a1) * len);
    ctx.closePath();
  }
  ctx.fill();
  ctx.globalCompositeOperation = "source-over";

  // три ударные волны, расходящиеся по газону
  for (let i = 0; i < 3; i++) {
    const el = e - i * 0.18;
    if (el < 0) continue;
    const a = Math.max(0, 1 - el / 1.3) * 0.55 * fade;
    if (a <= 0) continue;
    ctx.globalAlpha = a;
    ctx.strokeStyle = i === 1 ? "#fff6c9" : color;
    ctx.lineWidth = C * (0.16 - i * 0.04);
    ctx.beginPath();
    ctx.arc(P.x, P.y, C * (0.8 + el * 10), 0, 7);
    ctx.stroke();
  }

  // дневной фейерверк над воротами
  const cols = [color, "#ffd166", "#ffffff"];
  for (let b = 0; b < 3; b++) {
    const cx = P.x + (H(b, 3) * 2 - 1) * C * 5;
    const cy = P.y + S.down * C * (2.4 + H(b, 4) * 3.4);
    sparks(S, cx, cy, 0.1 + b * 0.38, 22, C * (2.6 + H(b, 5) * 1.4), cols[b], b * 7);
  }
  void L;
}

/* ---------- ночь: вспышки камер + мигающие прожекторы ---------- */
function night(S: Show) {
  const { ctx, L, e, fade, P, C, color } = S;
  const masts = nightMastPositions(L);

  // прожекторы мигают, как после гола на телетрансляции
  const blink = e < 1.3 ? (Math.sin(e * 34) > 0.1 ? 1 : 0.15) : 0.3 * Math.max(0, 1 - (e - 1.3) / 1.2);
  ctx.globalCompositeOperation = "screen";
  ctx.globalAlpha = 0.13 * blink * fade;
  ctx.fillStyle = "#cfeeff";
  ctx.fillRect(0, 0, L.w, L.h);
  for (const m of masts) {
    const r = C * (2.4 + blink * 2.2);
    const g = ctx.createRadialGradient(m.x, m.y, 0, m.x, m.y, r);
    g.addColorStop(0, "rgba(255,255,255,0.85)");
    g.addColorStop(0.35, "rgba(190,236,255,0.32)");
    g.addColorStop(1, "rgba(150,220,255,0)");
    ctx.globalAlpha = blink * fade;
    ctx.fillStyle = g;
    ctx.fillRect(m.x - r, m.y - r, r * 2, r * 2);
  }

  // фотовспышки по периметру: сверху, снизу и у бровок
  const x0 = L.ox;
  const x1 = L.ox + L.cellW * (L.cols - 1);
  const y0 = L.oy;
  const y1 = L.oy + L.cellH * (L.rows - 1);
  for (let i = 0; i < 32; i++) {
    const local = (e - H(i, 1) * 1.9) / 0.26;
    if (local < 0 || local > 1) continue;
    const z = H(i, 2);
    let px: number;
    let py: number;
    if (z < 0.36) {
      px = H(i, 3) * L.w;
      py = Math.max(6, y0 - L.cellH * (0.25 + 0.9 * H(i, 4)));
    } else if (z < 0.72) {
      px = H(i, 3) * L.w;
      py = Math.min(L.h - 6, y1 + L.cellH * (0.25 + 0.9 * H(i, 4)));
    } else {
      px = H(i, 5) < 0.5 ? Math.max(3, x0 - L.cellW * 0.3 * H(i, 3)) : Math.min(L.w - 3, x1 + L.cellW * 0.3 * H(i, 3));
      py = y0 + (y1 - y0) * H(i, 4);
    }
    const b = (1 - local) * (1 - local);
    const r = C * (0.35 + 0.55 * H(i, 6));
    const g = ctx.createRadialGradient(px, py, 0, px, py, r);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.4, "rgba(220,244,255,0.5)");
    g.addColorStop(1, "rgba(190,230,255,0)");
    ctx.globalAlpha = b * fade;
    ctx.fillStyle = g;
    ctx.fillRect(px - r, py - r, r * 2, r * 2);
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = Math.max(1, C * 0.02);
    const sl = r * 1.5;
    ctx.beginPath();
    ctx.moveTo(px - sl, py);
    ctx.lineTo(px + sl, py);
    ctx.moveTo(px, py - sl * 0.8);
    ctx.lineTo(px, py + sl * 0.8);
    ctx.stroke();
  }

  // фейерверк в цвете забившей команды
  ctx.globalCompositeOperation = "lighter";
  for (let b = 0; b < 3; b++) {
    const cx = P.x + (H(b, 13) * 2 - 1) * C * 5;
    const cy = P.y + S.down * C * (2.2 + H(b, 14) * 3.6);
    sparks(S, cx, cy, 0.12 + b * 0.4, 26, C * (2.8 + H(b, 15) * 1.4), b === 1 ? "#ffffff" : color, b * 5 + 2);
  }
  ctx.globalCompositeOperation = "source-over";
}

/* ---------- зима: лавина снега + ледяные осколки ---------- */
function winter(S: Show) {
  const { ctx, L, e, fade, P, C } = S;

  // белёсая пелена: нарастает вместе с лавиной и оседает
  const veil = Math.sin(Math.min(1, e / 1.9) * Math.PI) * 0.3 * fade;
  const vg = ctx.createLinearGradient(0, 0, 0, L.h);
  vg.addColorStop(0, `rgba(236,247,255,${veil})`);
  vg.addColorStop(1, `rgba(236,247,255,${veil * 0.25})`);
  ctx.globalAlpha = 1;
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, L.w, L.h);

  // 220 комьев снега, обрушивающихся сверху
  const wind = Math.sin(e * 1.3) * C * 1.5;
  const body = new Path2D();
  const shade = new Path2D();
  for (let i = 0; i < 220; i++) {
    const el = e - H(i, 1) * 0.8;
    if (el < 0) continue;
    const big = Math.pow(H(i, 2), 3);
    const r = C * (0.035 + 0.2 * big);
    const speed = C * (6 + 13 * (0.35 + big) * (0.6 + 0.4 * H(i, 3)));
    const x = H(i, 4) * L.w + Math.sin(el * 3 + i) * C * 0.4 + wind * el * 0.5;
    const y = -r * 2 + el * speed;
    if (y > L.h + r) continue;
    body.moveTo(x + r, y);
    body.arc(x, y, r, 0, 7);
    if (r > C * 0.12) {
      shade.moveTo(x + r, y + r * 0.2);
      shade.arc(x, y + r * 0.2, r, 0, 7);
    }
  }
  ctx.globalAlpha = 0.34 * fade;
  ctx.fillStyle = "#94b4d2";
  ctx.fill(shade);
  ctx.globalAlpha = 0.92 * fade;
  ctx.fillStyle = "#ffffff";
  ctx.fill(body);

  // ледяные осколки из ворот
  ctx.globalCompositeOperation = "lighter";
  for (let b = 0; b < 2; b++) {
    sparks(S, P.x + (b ? 1 : -1) * C * 2, P.y + S.down * C * 1.6, 0.05 + b * 0.3, 24, C * 3, b ? "#ffffff" : "#bfe6ff", b * 9 + 1);
  }
  ctx.globalCompositeOperation = "source-over";
}

/* ---------- пляж: накат волны с пеной ---------- */
function beach(S: Show) {
  const { ctx, L, e, fade, P, C } = S;
  const ease = (x: number) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);
  // волна накатывает от моря (сверху), затем откатывает
  const advance = Math.min(1, e / 1.35);
  const retreat = e > 1.35 ? Math.min(1, (e - 1.35) / 1.15) : 0;
  const f = ease(advance) * (1 - ease(retreat));
  const frontY = -C * 2 + f * (L.h + C * 3);
  const waveY = (x: number) => frontY + Math.sin(x * 0.04 + e * 5) * C * 0.25 + Math.sin(x * 0.011 - e * 2.3) * C * 0.2;

  if (frontY > 0) {
    // тело воды
    const wg = ctx.createLinearGradient(0, Math.max(0, frontY - C * 8), 0, frontY);
    wg.addColorStop(0, "rgba(60,180,205,0)");
    wg.addColorStop(1, "rgba(70,190,212,0.28)");
    ctx.globalAlpha = Math.min(1, fade * 1.6);
    ctx.fillStyle = wg;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    for (let x = 0; x <= L.w; x += 8) ctx.lineTo(x, waveY(x));
    ctx.lineTo(L.w, 0);
    ctx.closePath();
    ctx.fill();

    // пенный гребень
    ctx.strokeStyle = "#ffffff";
    ctx.globalAlpha = 0.85 * fade;
    ctx.lineWidth = C * 0.28;
    ctx.beginPath();
    for (let x = 0; x <= L.w; x += 8) (x === 0 ? ctx.moveTo(x, waveY(x)) : ctx.lineTo(x, waveY(x)));
    ctx.stroke();
    ctx.globalAlpha = 0.4 * fade;
    ctx.lineWidth = C * 0.12;
    ctx.beginPath();
    for (let x = 0; x <= L.w; x += 8) (x === 0 ? ctx.moveTo(x, waveY(x) - C * 0.3) : ctx.lineTo(x, waveY(x) - C * 0.3));
    ctx.stroke();

    // пузырьки пены за гребнем — остаются на песке при откате
    const foam = new Path2D();
    for (let i = 0; i < 46; i++) {
      const x = H(i, 1) * L.w;
      const y = waveY(x) - H(i, 2) * C * 2.2;
      if (y < 0) continue;
      const r = C * (0.025 + 0.07 * H(i, 3));
      foam.moveTo(x + r, y);
      foam.arc(x, y, r, 0, 7);
    }
    ctx.globalAlpha = 0.62 * fade;
    ctx.fillStyle = "#f4fdff";
    ctx.fill(foam);
  }

  // брызги у ворот
  ctx.globalCompositeOperation = "lighter";
  sparks(S, P.x, P.y + S.down * C * 1.2, 0.0, 26, C * 3.2, "#e6fbff", 4, 1.0);
  sparks(S, P.x, P.y + S.down * C * 1.2, 0.25, 18, C * 2.4, "#ffe9b0", 8, 0.9);
  ctx.globalCompositeOperation = "source-over";
}

/* ---------- бумага: чернильный фейерверк ---------- */
function paper(S: Show) {
  const { ctx, e, fade, P, C, color } = S;
  const inks = [color, "#2f3f7a"];
  const starts = [0, 0.28, 0.55, 0.85, 1.15];
  for (let b = 0; b < starts.length; b++) {
    const el = e - starts[b];
    if (el < 0) continue;
    const grow = 1 - Math.exp(-el * 7);
    const alpha = fade * Math.max(0, 1 - Math.max(0, el - 1.0) / 1.4);
    if (alpha <= 0) continue;
    const cx = P.x + (H(b, 1) * 2 - 1) * C * 5;
    const cy = P.y + S.down * C * (1.5 + H(b, 2) * 5);

    for (let c = 0; c < 2; c++) {
      const ink = inks[(b + c) % 2];
      const blob = new Path2D();
      ctx.strokeStyle = ink;
      ctx.lineWidth = Math.max(1, C * 0.05);
      ctx.beginPath();
      for (let i = c; i < 18; i += 2) {
        const a = (i / 18) * 6.2832 + H(b, 10 + i) * 0.3;
        const r0 = C * 0.2 * grow;
        const r1 = C * (0.55 + 1.7 * H(b, 20 + i)) * grow;
        ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
        ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
        // капля на конце росчерка
        const dr = C * (0.03 + 0.05 * H(b, 40 + i));
        const dx = cx + Math.cos(a) * (r1 + dr * 1.6);
        const dy = cy + Math.sin(a) * (r1 + dr * 1.6);
        blob.moveTo(dx + dr, dy);
        blob.arc(dx, dy, dr, 0, 7);
      }
      ctx.globalAlpha = alpha * 0.9;
      ctx.stroke();
      ctx.fillStyle = ink;
      ctx.fill(blob);
    }

    // центральная клякса
    ctx.globalAlpha = alpha;
    ctx.fillStyle = inks[b % 2];
    ctx.beginPath();
    ctx.arc(cx, cy, C * (0.16 + 0.12 * H(b, 3)) * grow, 0, 7);
    ctx.fill();
  }
}
