import { TradingDecision } from "./types";

export function rankSignals(
  signals: TradingDecision[]
): TradingDecision[] {
  return [...signals].sort(
    (a, b) => b.confidence - a.confidence
  );
}
