/** Мелкие цветовые помощники для визуальных эффектов (client-only). */

export function hexRgb(hex: string): [number, number, number] {
  const v = hex.replace("#", "");
  const full = v.length === 3 ? v.split("").map((c) => c + c).join("") : v;
  const n = parseInt(full, 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Цвет «#rrggbb» с заданной прозрачностью → строка rgba(). */
export function rgba(hex: string, a: number): string {
  const [r, g, b] = hexRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}
