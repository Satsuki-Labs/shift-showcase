export function confirmPeriodDelete(
  remaining: readonly string[],
  confirmAnyway: () => void,
  remove: () => void,
) {
  if (remaining.length) confirmAnyway();
  else remove();
}
