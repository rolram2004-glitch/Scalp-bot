import { MarketData, TradingDecision } from "./types";

type Direction = "BUY" | "SELL" | "NEUTRAL";

interface Vote {
  label: string;
  direction: Direction;
  value: string;
  weight: number;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function directionalVote(label: string, value: unknown, bullish: string, bearish: string, weight: number): Vote {
  const normalized = String(value || "").toUpperCase();
  return {
    label,
    direction: normalized === bullish ? "BUY" : normalized === bearish ? "SELL" : "NEUTRAL",
    value: normalized || "N/A",
    weight
  };
}

function formatLevel(value: number) {
  return value.toFixed(3);
}

export function getXauusdSignal(data: MarketData): TradingDecision {
  const price = finite(data.ask) && finite(data.bid) ? (data.ask + data.bid) / 2 : undefined;
  const dataReady = data.tradeable === true &&
    data.structureSource === "OANDA_CANDLES" &&
    Number(data.candleCount || 0) >= 200 &&
    finite(price) &&
    finite(data.ema20) &&
    finite(data.ema50) &&
    finite(data.ema200) &&
    finite(data.rsi) &&
    finite(data.macdHistogram) &&
    finite(data.atr);

  if (!dataReady) {
    return {
      action: "HOLD",
      confidence: 0,
      setupType: "XAU_STRUCTURE_DATA_GUARD",
      reasoning: "XAUUSD HOLD: struttura o indicatori OANDA insufficienti; nessun livello viene inventato."
    };
  }

  if (data.session === "OFF_HOURS") {
    return {
      action: "HOLD",
      confidence: 0,
      setupType: "XAU_SESSION_GUARD",
      reasoning: "XAUUSD HOLD: sessione fuori orario operativo."
    };
  }

  if (data.spread > 80) {
    return {
      action: "HOLD",
      confidence: 0,
      setupType: "XAU_SPREAD_GUARD",
      reasoning: `XAUUSD HOLD: spread OANDA ${data.spread.toFixed(1)} oltre il limite configurato.`
    };
  }

  const emaDirection: Direction = price > data.ema20 && data.ema20 > data.ema50 && data.ema50 > data.ema200
    ? "BUY"
    : price < data.ema20 && data.ema20 < data.ema50 && data.ema50 < data.ema200
      ? "SELL"
      : "NEUTRAL";
  const rsiDirection: Direction = data.rsi >= 52 && data.rsi <= 70
    ? "BUY"
    : data.rsi <= 48 && data.rsi >= 30
      ? "SELL"
      : "NEUTRAL";
  const macdDirection: Direction = data.macdHistogram > 0 ? "BUY" : data.macdHistogram < 0 ? "SELL" : "NEUTRAL";

  const votes: Vote[] = [
    directionalVote("Market structure", data.structureBias, "BULLISH", "BEARISH", 3),
    directionalVote("Break of structure", data.breakOfStructure, "BULLISH", "BEARISH", 2),
    directionalVote("Change of character", data.changeOfCharacter, "BULLISH", "BEARISH", 2),
    directionalVote("Liquidity sweep", data.liquiditySweep, "BULLISH", "BEARISH", 2),
    directionalVote("Fair value gap", data.fairValueGap, "BULLISH", "BEARISH", 1),
    { label: "EMA 20/50/200", direction: emaDirection, value: emaDirection, weight: 2 },
    { label: "RSI 14", direction: rsiDirection, value: data.rsi.toFixed(1), weight: 1 },
    { label: "MACD histogram", direction: macdDirection, value: data.macdHistogram.toFixed(5), weight: 1 }
  ];

  const maximum = votes.reduce((sum, vote) => sum + vote.weight, 0);
  const buyScore = votes.filter((vote) => vote.direction === "BUY").reduce((sum, vote) => sum + vote.weight, 0);
  const sellScore = votes.filter((vote) => vote.direction === "SELL").reduce((sum, vote) => sum + vote.weight, 0);
  const leadingDirection: Direction = buyScore > sellScore ? "BUY" : sellScore > buyScore ? "SELL" : "NEUTRAL";
  const leadingScore = Math.max(buyScore, sellScore);
  const confidence = Math.round((leadingScore / maximum) * 100);
  const scoreDifference = Math.abs(buyScore - sellScore);
  const structuralTargets = leadingDirection === "BUY"
    ? (data.resistanceLevels || []).filter((level) => finite(level) && level > price).slice(0, 3)
    : leadingDirection === "SELL"
      ? (data.supportLevels || []).filter((level) => finite(level) && level < price).slice(0, 3)
      : [];
  const stopLossPrice = leadingDirection === "BUY"
    ? (data.supportLevels || []).find((level) => finite(level) && level < price)
    : leadingDirection === "SELL"
      ? (data.resistanceLevels || []).find((level) => finite(level) && level > price)
      : undefined;
  const evidence = votes.map(({ label, direction, value }) => ({ label, direction, value }));
  const voteSummary = `BUY ${buyScore}/${maximum}, SELL ${sellScore}/${maximum}`;

  if (
    leadingDirection === "NEUTRAL" ||
    leadingScore < 8 ||
    scoreDifference < 3 ||
    !finite(stopLossPrice) ||
    structuralTargets.length === 0
  ) {
    const missingLevels = !finite(stopLossPrice) || structuralTargets.length === 0
      ? " Livelli strutturali stop/target insufficienti."
      : "";
    return {
      action: "HOLD",
      confidence,
      setupType: "XAU_STRUCTURE_CONFLUENCE",
      reasoning: `XAUUSD HOLD: confluenza insufficiente (${voteSummary}).${missingLevels} Nessun TP viene inventato.`,
      evidence,
      structuralTargets
    };
  }

  return {
    action: leadingDirection,
    confidence,
    setupType: "XAU_STRUCTURE_CONFLUENCE",
    reasoning: `XAUUSD ${leadingDirection}: confluenza strutturale ${voteSummary}; stop su swing ${formatLevel(stopLossPrice)}, target reali ${structuralTargets.map(formatLevel).join(" / ")}.`,
    riskRewardRatio: 2,
    evidence,
    stopLossPrice,
    structuralTargets
  };
}
