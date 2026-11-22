export function payPercentage(amount: number, budget: number): number {
  return budget === 0 ? (amount > 0 ? 100 : 0) : Math.min(100, (amount / budget) * 100);
}

export function payBarLevel(amount: number, budget: number): 'safe' | 'near' | 'over' {
  if (amount > budget) return 'over';
  return payPercentage(amount, budget) >= 90 ? 'near' : 'safe';
}
