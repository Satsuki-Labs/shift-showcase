export function dialogPosition(
  height: number,
  viewportHeight: number,
  paddingTop: number,
  paddingBottom: number,
  previousTop?: number,
) {
  const boundedHeight = Math.min(height, Math.max(0, viewportHeight - paddingTop - paddingBottom));
  const centered = paddingTop + (viewportHeight - paddingTop - paddingBottom - boundedHeight) / 2;
  return {
    height: boundedHeight,
    top: Math.max(
      paddingTop,
      Math.min(previousTop ?? centered, viewportHeight - paddingBottom - boundedHeight),
    ),
  };
}
