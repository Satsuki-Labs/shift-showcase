/** The panel outline, in SVG coordinates; no DOM or React measurements here. */
export function panelShape({
  width,
  height,
  step,
  raised,
  radius,
  inset = 0.5,
}: {
  width: number;
  height: number;
  step: number;
  raised: { side: 'left' | 'right'; width: number } | null;
  radius: number;
  inset?: number;
}): string {
  const h = inset,
    r = radius,
    b = radius,
    W = width,
    H = height;
  const d = [`M ${h} ${H - h - b}`];
  if (raised?.side === 'left') {
    const x = raised.width;
    d.push(
      `L ${h} ${h + r}`,
      `A ${r} ${r} 0 0 1 ${h + r} ${h}`,
      `L ${x - h - r} ${h}`,
      `A ${r} ${r} 0 0 1 ${x - h} ${h + r}`,
      `L ${x - h} ${step + h - r}`,
      `A ${r} ${r} 0 0 0 ${x - h + r} ${step + h}`,
      `L ${W - h - r} ${step + h}`,
      `A ${r} ${r} 0 0 1 ${W - h} ${step + h + r}`,
    );
  } else {
    d.push(`L ${h} ${step + h + r}`, `A ${r} ${r} 0 0 1 ${h + r} ${step + h}`);
    if (raised) {
      const x = W - raised.width;
      d.push(
        `L ${x - r} ${step + h}`,
        `A ${r} ${r} 0 0 0 ${x + h} ${step + h - r}`,
        `L ${x + h} ${h + r}`,
        `A ${r} ${r} 0 0 1 ${x + h + r} ${h}`,
        `L ${W - h - r} ${h}`,
        `A ${r} ${r} 0 0 1 ${W - h} ${h + r}`,
      );
    } else d.push(`L ${W - h - r} ${step + h}`, `A ${r} ${r} 0 0 1 ${W - h} ${step + h + r}`);
  }
  d.push(`L ${W - h} ${H - h - b}`);
  d.push(`A ${b} ${b} 0 0 1 ${W - h - b} ${H - h}`);
  d.push(`L ${h + b} ${H - h}`);
  d.push(`A ${b} ${b} 0 0 1 ${h} ${H - h - b}`);
  return [...d, 'Z'].join(' ');
}
