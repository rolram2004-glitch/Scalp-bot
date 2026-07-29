import { TradingDecision } from "./types";

export type StrategyVariant = "MAIN" | "INVERSE";
export type SignalAction = "BUY" | "SELL" | "HOLD";

export interface SignalMarketSnapshot {
  source: "OANDA";
  instrument: string;
  time: string;
  bid: number;
  ask: number;
  mid: number;
  tradeable: boolean;
}

export interface SignalAnalysisSnapshot {
  candleTime: string;
  timeframe: string;
  ema20: number;
  ema50: number;
  ema200: number;
  rsi: number;
  spread: number;
  structureBias?: string;
  trend?: string;
  macdHistogram?: number;
  atr?: number;
  volatility?: string;
  volumeRatio?: number;
  breakOfStructure?: "BULLISH" | "BEARISH" | "NONE";
  changeOfCharacter?: "BULLISH" | "BEARISH" | "NONE";
  liquiditySweep?: "BULLISH" | "BEARISH" | "NONE";
  fairValueGap?: string;
  equalHigh?: number;
  equalLow?: number;
  supportLevels?: number[];
  resistanceLevels?: number[];
  structureSource?: "OANDA_CANDLES";
  candleCount?: number;
}

export type LaneExecutionState =
  | "SHADOW"
  | "PAPER"
  | "NOT_ELIGIBLE"
  | "READY"
  | "SUBMITTING"
  | "SKIPPED"
  | "REJECTED"
  | "OPEN_VERIFIED";

export interface SignalLaneSnapshot {
  variant: StrategyVariant;
  action: SignalAction;
  confidence: number;
  setupScore?: number;
  scoreLabel?: "WEAK" | "DEVELOPING" | "VALID" | "STRONG";
  scoreBreakdown?: TradingDecision["scoreBreakdown"];
  reasoning: string;
  setupType?: string;
  entryPrice?: number;
  stopLossPrice?: number;
  takeProfitPrice?: number;
  structuralTargets?: number[];
  riskRewardRatio?: number;
  mode: "OANDA DEMO" | "OANDA LIVE" | "PAPER" | "PAPER SHADOW";
  selectedForExecution: boolean;
  executionState: LaneExecutionState;
  executionReason?: string;
  oandaOrderId?: string;
  oandaTradeId?: string;
  derivedFrom?: "MAIN";
}

export interface PairedSignalSnapshot {
  pairId: string;
  symbol: string;
  evaluatedAt: string;
  market: SignalMarketSnapshot;
  analysis: SignalAnalysisSnapshot;
  marketValid: boolean;
  marketValidationReason?: string;
  main: SignalLaneSnapshot;
  inverse: SignalLaneSnapshot;
  executionBlockedReason?: string;
}

interface PairedSignalInput {
  signalId: string;
  symbol: string;
  evaluatedAt: string;
  market: SignalMarketSnapshot;
  analysis: SignalAnalysisSnapshot;
  mainDecision: TradingDecision;
  tradingMode: string;
  liveExecutionVariant: unknown;
  executionGateVerified: boolean;
  minimumConfidence?: number;
}

function isSignalAction(action: unknown): action is SignalAction {
  return action === "BUY" || action === "SELL" || action === "HOLD";
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function cleanTargets(values: unknown, action: SignalAction, entry: number) {
  if (!Array.isArray(values) || action === "HOLD" || !finite(entry)) return [];
  const direction = action === "BUY" ? 1 : -1;
  return values
    .map(Number)
    .filter((value) => Number.isFinite(value) && value > 0 && (value - entry) * direction > 0)
    .sort((a, b) => direction > 0 ? a - b : b - a)
    .filter((value, index, array) => index === 0 || Math.abs(value - array[index - 1]) > 1e-10)
    .slice(0, 3);
}

function mirrorPrice(value: number | undefined, pivot: number) {
  return finite(value) && finite(pivot) ? pivot - (value - pivot) : undefined;
}

export function invertAction(action: unknown): SignalAction {
  if (action === "BUY") return "SELL";
  if (action === "SELL") return "BUY";
  return "HOLD";
}

export function createPairedSignalSnapshot(input: PairedSignalInput): PairedSignalSnapshot {
  const validAction = isSignalAction(input.mainDecision?.action);
  const mainAction: SignalAction = validAction ? input.mainDecision.action : "HOLD";
  const inverseAction = invertAction(mainAction);
  const variant = String(input.liveExecutionVariant || "").toUpperCase();
  const validVariant = variant === "MAIN" || variant === "INVERSE";
  const marketTime = Date.parse(String(input.market?.time || ""));
  const marketAge = Date.now() - marketTime;
  const sameInstrument = String(input.market?.instrument || "").toUpperCase().replace(/[^A-Z0-9]/g, "") ===
    String(input.symbol || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const realMarketSnapshot =
    input.market?.source === "OANDA" &&
    sameInstrument &&
    Number.isFinite(marketTime) && marketAge >= -5000 && marketAge <= 30000 &&
    Number.isFinite(input.market.bid) && input.market.bid > 0 &&
    Number.isFinite(input.market.ask) && input.market.ask > 0 &&
    input.market.ask >= input.market.bid &&
    input.market.tradeable === true;
  const requestedMode = String(input.tradingMode || "").toUpperCase();
  const liveRequested = requestedMode === "OANDA_DEMO" || requestedMode === "OANDA_LIVE";
  const paperMode = requestedMode === "PAPER";
  const liveAllowed = liveRequested && input.executionGateVerified === true &&
    validAction && validVariant && realMarketSnapshot;
  const oandaLaneMode = requestedMode === "OANDA_LIVE" ? "OANDA LIVE" : "OANDA DEMO";
  const mainSelected = liveAllowed && variant === "MAIN";
  const inverseSelected = liveAllowed && variant === "INVERSE";
  const confidence = Number(input.mainDecision?.setupScore ?? input.mainDecision?.confidence) || 0;
  const requestedThreshold = Number(input.minimumConfidence);
  const minimumConfidence = Number.isFinite(requestedThreshold)
    ? Math.min(100, Math.max(0, requestedThreshold))
    : 65;
  const mainEligible = mainAction !== "HOLD" && confidence >= minimumConfidence;
  const inverseEligible = inverseAction !== "HOLD" && confidence >= minimumConfidence;
  const baseReasoning = String(input.mainDecision?.reasoning || "Decisione MAIN non disponibile.");
  const entry = finite(input.mainDecision?.entryPrice) ? input.mainDecision.entryPrice : input.market.mid;
  const mainTargets = cleanTargets(input.mainDecision?.structuralTargets, mainAction, entry);
  const mainTakeProfit = mainTargets[0] ?? (finite(input.mainDecision?.takeProfitPips) ? undefined : undefined);
  const inverseStop = mirrorPrice(input.mainDecision?.stopLossPrice, entry);
  const inverseTargets = mainTargets.map((target) => mirrorPrice(target, entry)).filter(finite);
  let executionBlockedReason: string | undefined;
  const marketValidationReason = realMarketSnapshot ? undefined : "OANDA_SIGNAL_SNAPSHOT_NOT_TRADEABLE_OR_FRESH";

  if (!validAction) executionBlockedReason = "INVALID_MAIN_ACTION";
  else if (liveRequested && !validVariant) executionBlockedReason = "INVALID_LIVE_EXECUTION_VARIANT";
  else if (liveRequested && input.executionGateVerified !== true) executionBlockedReason = "OANDA_SAFETY_GATES_NOT_VERIFIED";
  else if (liveRequested && !realMarketSnapshot) executionBlockedReason = marketValidationReason;

  return {
    pairId: input.signalId,
    symbol: input.symbol,
    evaluatedAt: input.evaluatedAt,
    market: { ...input.market },
    analysis: { ...input.analysis },
    marketValid: realMarketSnapshot,
    marketValidationReason,
    main: {
      variant: "MAIN",
      action: mainAction,
      confidence,
      setupScore: input.mainDecision?.setupScore ?? confidence,
      scoreLabel: input.mainDecision?.scoreLabel,
      scoreBreakdown: input.mainDecision?.scoreBreakdown,
      reasoning: baseReasoning,
      setupType: input.mainDecision?.setupType,
      entryPrice: mainAction === "HOLD" ? undefined : entry,
      stopLossPrice: mainAction === "HOLD" ? undefined : input.mainDecision?.stopLossPrice,
      takeProfitPrice: mainAction === "HOLD" ? undefined : mainTakeProfit,
      structuralTargets: mainAction === "HOLD" ? [] : mainTargets,
      riskRewardRatio: input.mainDecision?.riskRewardRatio,
      mode: mainSelected ? oandaLaneMode : paperMode ? "PAPER" : "PAPER SHADOW",
      selectedForExecution: mainSelected,
      executionState: mainSelected ? (mainEligible ? "READY" : "NOT_ELIGIBLE") : paperMode ? "PAPER" : "SHADOW",
      executionReason: mainSelected && !mainEligible ? (mainAction === "HOLD" ? "HOLD" : "CONFIDENCE_BELOW_THRESHOLD") : undefined
    },
    inverse: {
      variant: "INVERSE",
      action: inverseAction,
      confidence,
      setupScore: input.mainDecision?.setupScore ?? confidence,
      scoreLabel: input.mainDecision?.scoreLabel,
      scoreBreakdown: input.mainDecision?.scoreBreakdown,
      reasoning: `Scenario contrario calcolato sullo stesso snapshot OANDA della MAIN. MAIN ${mainAction}; INVERSE ${inverseAction}. ${baseReasoning}`,
      setupType: input.mainDecision?.setupType ? `INVERSE_${input.mainDecision.setupType}` : "INVERSE",
      entryPrice: inverseAction === "HOLD" ? undefined : entry,
      stopLossPrice: inverseAction === "HOLD" ? undefined : inverseStop,
      takeProfitPrice: inverseAction === "HOLD" ? undefined : inverseTargets[0],
      structuralTargets: inverseAction === "HOLD" ? [] : inverseTargets,
      riskRewardRatio: input.mainDecision?.riskRewardRatio,
      mode: inverseSelected ? oandaLaneMode : "PAPER SHADOW",
      selectedForExecution: inverseSelected,
      executionState: inverseSelected ? (inverseEligible ? "READY" : "NOT_ELIGIBLE") : "SHADOW",
      executionReason: inverseSelected && !inverseEligible ? (inverseAction === "HOLD" ? "HOLD" : "CONFIDENCE_BELOW_THRESHOLD") : undefined,
      derivedFrom: "MAIN"
    },
    executionBlockedReason
  };
}
