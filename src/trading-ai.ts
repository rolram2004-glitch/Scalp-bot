import {
  MarketData,
  TradingDecision
} from "./types";
import { getXauusdSignal } from "./xauusd-strategy";

type ForexSide = "BUY" | "SELL";
type ScoreBreakdown = NonNullable<TradingDecision["scoreBreakdown"]>;

const FOREX_MAX_SPREAD = 25;

function clampScore(value: number, maximum: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(maximum, Math.max(0, Math.round(value)));
}

function scoreLabel(score: number): NonNullable<TradingDecision["scoreLabel"]> {
  if (score >= 80) return "STRONG";
  if (score >= 65) return "VALID";
  if (score >= 45) return "DEVELOPING";
  return "WEAK";
}

function aligned(value: unknown, side: ForexSide) {
  return String(value || "").toUpperCase() === (side === "BUY" ? "BULLISH" : "BEARISH");
}

function forexScenarioScore(data: MarketData, side: ForexSide): ScoreBreakdown {
  const bullish = side === "BUY";
  const emaAligned = bullish
    ? data.bid > data.ema20 && data.ema20 > data.ema50 && data.ema50 > data.ema200
    : data.bid < data.ema20 && data.ema20 < data.ema50 && data.ema50 < data.ema200;
  const rsiAligned = bullish ? data.rsi > 55 : data.rsi < 45;
  const macdAligned = bullish ? data.macdHistogram > 0 : data.macdHistogram < 0;
  const structureAligned = aligned(data.structureBias, side);

  let liquidity = 0;
  if (aligned(data.liquiditySweep, side)) liquidity += 5;
  if (aligned(data.fairValueGap, side)) liquidity += 3;
  if (aligned(data.breakOfStructure, side) || aligned(data.changeOfCharacter, side)) liquidity += 2;

  const volatility = String(data.volatility || "").toUpperCase();
  const volatilityScore = volatility === "NORMAL" || volatility === "MEDIUM"
    ? 10
    : volatility === "LOW"
      ? 6
      : volatility === "HIGH"
        ? 4
        : 5;
  const spreadRatio = Number(data.spread) / FOREX_MAX_SPREAD;
  const spreadScore = !Number.isFinite(spreadRatio) || spreadRatio < 0
    ? 0
    : spreadRatio <= 0.4
      ? 10
      : spreadRatio <= 0.7
        ? 8
        : spreadRatio <= 1
          ? 5
          : 0;
  const executableQuote = Number.isFinite(data.bid) && data.bid > 0 &&
    Number.isFinite(data.ask) && data.ask >= data.bid &&
    data.tradeable !== false;

  return {
    trend: emaAligned ? 20 : 0,
    momentum: clampScore((rsiAligned ? 10 : 0) + (macdAligned ? 5 : 0), 15),
    structure: structureAligned ? 20 : data.killzone ? 8 : 0,
    liquidity: clampScore(liquidity, 10),
    volatility: clampScore(volatilityScore, 10),
    spread: clampScore(spreadScore, 10),
    session: data.killzone ? 5 : 3,
    risk: executableQuote && Number(data.spread) <= FOREX_MAX_SPREAD ? 10 : 0
  };
}

function totalScore(parts: ScoreBreakdown) {
  return Object.values(parts).reduce((sum, value) => sum + value, 0);
}

function scoreSummary(parts: ScoreBreakdown) {
  return [
    `trend ${parts.trend}/20`,
    `momentum ${parts.momentum}/15`,
    `structure ${parts.structure}/20`,
    `liquidity ${parts.liquidity}/10`,
    `volatility ${parts.volatility}/10`,
    `spread ${parts.spread}/10`,
    `session ${parts.session}/5`,
    `risk ${parts.risk}/10`
  ].join(", ");
}

export async function getScalpingSignal(
  data: MarketData
): Promise<TradingDecision> {
  const isGold = /XAU/i.test(data.symbol);
  if (isGold) {
    return getXauusdSignal(data);
  }

  const bullishStructure = data.structureBias === "BULLISH";
  const bearishStructure = data.structureBias === "BEARISH";
  // Preserve the original Forex entry logic: EMA stack + RSI. MACD remains
  // visible in the reasoning, but an opposite lagging histogram must not turn
  // an otherwise valid real-data setup into HOLD.
  const bullishMomentum = data.bid > data.ema20 && data.ema20 > data.ema50 && data.ema50 > data.ema200 && data.rsi > 55;
  const bearishMomentum = data.bid < data.ema20 && data.ema20 < data.ema50 && data.ema50 < data.ema200 && data.rsi < 45;
  const buyBreakdown = forexScenarioScore(data, "BUY");
  const sellBreakdown = forexScenarioScore(data, "SELL");
  const buyScore = totalScore(buyBreakdown);
  const sellScore = totalScore(sellBreakdown);
  const scenarioScores = { BUY: buyScore, SELL: sellScore };

  if (!Number.isFinite(data.spread) || data.spread < 0 || data.spread > FOREX_MAX_SPREAD) {
    const score = Math.max(buyScore, sellScore);
    const breakdown = buyScore >= sellScore ? buyBreakdown : sellBreakdown;
    return {
      action: "HOLD",
      confidence: score,
      setupScore: score,
      scoreLabel: scoreLabel(score),
      scoreBreakdown: breakdown,
      scenarioScores,
      reasoning: `HOLD: spread non executable (${Number.isFinite(data.spread) ? data.spread.toFixed(1) : "N/A"}). Setup score ${score}/100 (${scoreSummary(breakdown)}).`
    };
  }

  // BUY SETUP

  if (
    bullishMomentum &&
    (bullishStructure || data.killzone)
  ) {
    const score = buyScore;
    return {
      action: "BUY",
      confidence: score,
      setupScore: score,
      scoreLabel: scoreLabel(score),
      scoreBreakdown: buyBreakdown,
      scenarioScores,
      riskRewardRatio: 2,
      setupType: bullishStructure ? "EMA_TREND" : "KILLZONE_MOMENTUM",
      reasoning: `BUY accepted on real OANDA data. Setup score ${score}/100 (${scoreSummary(buyBreakdown)}). Price above EMA20/50/200, RSI ${data.rsi.toFixed(1)}, MACD histogram ${data.macdHistogram.toFixed(5)} (context only), structure ${data.structureBias || "UNKNOWN"}, high ${data.highPrice.toFixed(5)} / low ${data.lowPrice.toFixed(5)}.`
    };
  }

  // SELL SETUP

  if (
    bearishMomentum &&
    (bearishStructure || data.killzone)
  ) {
    const score = sellScore;
    return {
      action: "SELL",
      confidence: score,
      setupScore: score,
      scoreLabel: scoreLabel(score),
      scoreBreakdown: sellBreakdown,
      scenarioScores,
      riskRewardRatio: 2,
      setupType: bearishStructure ? "EMA_TREND" : "KILLZONE_MOMENTUM",
      reasoning: `SELL accepted on real OANDA data. Setup score ${score}/100 (${scoreSummary(sellBreakdown)}). Price below EMA20/50/200, RSI ${data.rsi.toFixed(1)}, MACD histogram ${data.macdHistogram.toFixed(5)} (context only), structure ${data.structureBias || "UNKNOWN"}, high ${data.highPrice.toFixed(5)} / low ${data.lowPrice.toFixed(5)}.`
    };
  }

  const bestSide: ForexSide = buyScore >= sellScore ? "BUY" : "SELL";
  const bestScore = bestSide === "BUY" ? buyScore : sellScore;
  const bestBreakdown = bestSide === "BUY" ? buyBreakdown : sellBreakdown;
  return {
    action: "HOLD",
    confidence: bestScore,
    setupScore: bestScore,
    scoreLabel: scoreLabel(bestScore),
    scoreBreakdown: bestBreakdown,
    scenarioScores,
    reasoning: `HOLD: no complete setup on real OANDA data. Best scenario ${bestSide} scores ${bestScore}/100 (${scoreSummary(bestBreakdown)}). EMA stack buy=${bullishMomentum}, sell=${bearishMomentum}, structure=${data.structureBias || "UNKNOWN"}, RSI=${data.rsi.toFixed(1)}.`
  };
}
