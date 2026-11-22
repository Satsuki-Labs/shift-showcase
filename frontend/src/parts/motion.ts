/** 名前が無い、または時間として読めない値は例外にする。0秒とは区別する。 */
export function motionMs(element: Element, name: string): number {
  const value = getComputedStyle(element).getPropertyValue(name).trim();
  const time = /^([+-]?(?:\d*\.\d+|\d+))(ms|s)$/.exec(value);
  if (!time) throw new Error(`Invalid or missing motion time: ${name}`);
  return Number(time[1]) * (time[2] === 's' ? 1000 : 1);
}

/** CSSのキーワードとcubic-bezierを読む。名前が無い、未対応の値は例外にする。 */
export function motionEasing(element: Element, name: string): (progress: number) => number {
  const value = getComputedStyle(element).getPropertyValue(name).trim();
  if (value === 'linear') return (progress) => Math.max(0, Math.min(1, progress));
  const keywords: Record<string, readonly number[]> = {
    ease: [0.25, 0.1, 0.25, 1],
    'ease-in': [0.42, 0, 1, 1],
    'ease-out': [0, 0, 0.58, 1],
    'ease-in-out': [0.42, 0, 0.58, 1],
  };
  const literal = /^cubic-bezier\(([^)]+)\)$/.exec(value);
  const points = keywords[value] ?? literal?.[1].split(',').map(Number);
  if (
    !points ||
    points.length !== 4 ||
    points.some((point) => !Number.isFinite(point)) ||
    points[0] < 0 ||
    points[0] > 1 ||
    points[2] < 0 ||
    points[2] > 1
  ) {
    throw new Error(`Invalid or missing motion easing: ${name}`);
  }
  const [x1, y1, x2, y2] = points;
  const curve = (t: number, a: number, b: number) =>
    3 * (1 - t) ** 2 * t * a + 3 * (1 - t) * t ** 2 * b + t ** 3;
  return (progress) => {
    if (progress <= 0) return 0;
    if (progress >= 1) return 1;
    let low = 0,
      high = 1;
    for (let i = 0; i < 16; i++) {
      const middle = (low + high) / 2;
      if (curve(middle, x1, x2) < progress) low = middle;
      else high = middle;
    }
    return curve((low + high) / 2, y1, y2);
  };
}
