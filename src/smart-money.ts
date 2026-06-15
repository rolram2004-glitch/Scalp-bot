export function detectOrderBlock(): boolean {
  return Math.random() > 0.7;
}

export function detectFVG(): string {
  return Math.random() > 0.5
    ? "BULLISH_FVG"
    : "BEARISH_FVG";
}

export function detectLiquidity(): string {
  return Math.random() > 0.5
    ? "BUY_SIDE"
    : "SELL_SIDE";
}

export function detectStructure(): string {
  return Math.random() > 0.5
    ? "BULLISH"
    : "BEARISH";
}
