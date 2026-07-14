export const MAX_DAILY_TRADES = 1000;

export const DAILY_TARGET = 800;

export const MAX_OPEN_POSITIONS = 15;

export const MAX_TRADES_PER_CYCLE = 8;

export function canOpenTrade(
  todayTrades: number,
  openPositions: number
): boolean {
  if (todayTrades >= MAX_DAILY_TRADES) {
    return false;
  }

  if (openPositions >= MAX_OPEN_POSITIONS) {
    return false;
  }

  return true;
}
