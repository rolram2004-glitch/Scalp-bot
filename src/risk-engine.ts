const config = require("./config");

export const MAX_DAILY_TRADES = Number(config.MAX_DAILY_TRADES);

export const MAX_OPEN_POSITIONS = Number(config.MAX_OPEN_TRADES);

export const MAX_TRADES_PER_CYCLE = Number(config.MAX_NEW_TRADES_PER_CYCLE);

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
