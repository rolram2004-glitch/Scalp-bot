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
  accountCashRisk?: number;
  accountCashReward?: number;
  accountTargetCurrency?: string;
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

function pipSize(symbol: string) {
  const normalized = String(symbol || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return normalized.endsWith("JPY") ? 0.01 : 0.0001;
}

function executableEntry(action: SignalAction, market: SignalMarketSnapshot) {
  if (action === "BUY" && finite(market.ask)) return market.ask;
  if (action === "SELL" && finite(market.bid)) return market.bid;
  return market.mid;
}

export function invertAction(action: unknown): SignalAction {
  if (action === "BUY") return "SELL";
  if (action === "SELL") return "BUY";
  return "HOLD";
}

function protectiveLevelsValid(
  action: SignalAction,
  entry: number | undefined,
  stopLoss: number | undefined,
  takeProfit: number | undefined
) {
  if (action === "HOLD" || !finite(entry) || !finite(stopLoss) || !finite(takeProfit)) return false;
  const direction = action === "BUY" ? 1 : -1;
  return (entry - stopLoss) * direction > 0 && (takeProfit - entry) * direction > 0;
}

function riskReward(entry: number | undefined, stopLoss: number | undefined, takeProfit: number | undefined) {
  if (!finite(entry) || !finite(stopLoss) || !finite(takeProfit)) return undefined;
  const risk = Math.abs(entry - stopLoss);
  const reward = Math.abs(takeProfit - entry);
  return risk > 0 && reward > 0 ? reward / risk : undefined;
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
  const baseReasoning = String(input.mainDecision?.reasoning || "Decisione MAIN non disponibile.");
  const entry = finite(input.mainDecision?.entryPrice)
    ? input.mainDecision.entryPrice
    : executableEntry(mainAction, input.market);
  const inverseEntry = executableEntry(inverseAction, input.market);
  const mainTargets = cleanTargets(input.mainDecision?.structuralTargets, mainAction, entry);
  const unitPip = pipSize(input.symbol);
  const forexInstrument = !String(input.symbol || "").toUpperCase().replace(/[^A-Z0-9]/g, "").startsWith("XAU");
  const accountCashRisk = Number(input.accountCashRisk);
  const accountCashReward = Number(input.accountCashReward);
  const accountTargetCurrency = String(input.accountTargetCurrency || "").trim().toUpperCase();
  const accountCashRequested = input.accountCashRisk !== undefined ||
    input.accountCashReward !== undefined || input.accountTargetCurrency !== undefined;
  const inverseCashSelected = inverseSelected && forexInstrument && accountCashRequested;
  const inverseCashProtectionValid =
    Number.isFinite(accountCashRisk) && accountCashRisk > 0 &&
    Number.isFinite(accountCashReward) && accountCashReward > 0 &&
    accountTargetCurrency === "CHF";
  const stopPips = finite(input.mainDecision?.stopLossPips) && input.mainDecision.stopLossPips > 0
    ? input.mainDecision.stopLossPips
    : forexInstrument ? 10 : undefined;
  const targetPips = finite(input.mainDecision?.takeProfitPips) && input.mainDecision.takeProfitPips > 0
    ? input.mainDecision.takeProfitPips
    : forexInstrument ? 20 : undefined;
  const mainDirection = mainAction === "BUY" ? 1 : mainAction === "SELL" ? -1 : 0;
  const mainStop = finite(input.mainDecision?.stopLossPrice)
    ? input.mainDecision.stopLossPrice
    : stopPips && mainDirection ? entry - mainDirection * stopPips * unitPip : undefined;
  const mainTakeProfit = mainTargets[0] ?? (
    targetPips && mainDirection ? entry + mainDirection * targetPips * unitPip : undefined
  );
  // STRICT MIRROR rule:
  // - the MAIN take-profit price becomes the INVERSE stop-loss price;
  // - the MAIN stop-loss price becomes the INVERSE take-profit price.
  // Both lanes are derived from the same OANDA snapshot. The opposite side
  // enters on the opposite executable quote, so spread is deliberately visible
  // in the resulting risk/reward instead of being hidden by a synthetic price.
  const inverseStop = mainTakeProfit;
  const inverseTakeProfit = mainStop;
  const inverseLevelsValid = protectiveLevelsValid(
    inverseAction,
    inverseEntry,
    inverseStop,
    inverseTakeProfit
  );
  const inverseTargets = inverseLevelsValid && finite(inverseTakeProfit) ? [inverseTakeProfit] : [];
  const inverseEligible = inverseAction !== "HOLD" && confidence >= minimumConfidence &&
    (inverseCashSelected ? inverseCashProtectionValid : inverseLevelsValid);
  let executionBlockedReason: string | undefined;
  const marketValidationReason = realMarketSnapshot ? undefined : "OANDA_SIGNAL_SNAPSHOT_NOT_TRADEABLE_OR_FRESH";

  if (!validAction) executionBlockedReason = "INVALID_MAIN_ACTION";
  else if (liveRequested && !validVariant) executionBlockedReason = "INVALID_LIVE_EXECUTION_VARIANT";
  else if (liveRequested && input.executionGateVerified !== true) executionBlockedReason = "OANDA_SAFETY_GATES_NOT_VERIFIED";
  else if (liveRequested && !realMarketSnapshot) executionBlockedReason = marketValidationReason;
  else if (inverseCashSelected && !inverseCashProtectionValid) executionBlockedReason = "ACCOUNT_CASH_TARGETS_INVALID";
  else if (inverseSelected && !inverseCashSelected && !inverseLevelsValid) executionBlockedReason = "MIRROR_PROTECTIVE_LEVELS_INVALID_AFTER_SPREAD";

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
      stopLossPrice: mainAction === "HOLD" ? undefined : mainStop,
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
      reasoning: inverseCashSelected
        ? `CONTRARIO sullo stesso segnale: MAIN ${mainAction} -> MIRROR ${inverseAction}. Protezione OANDA sul prezzo eseguito: TP nominale +${accountCashReward.toFixed(2)} ${accountTargetCurrency}, SL nominale -${accountCashRisk.toFixed(2)} ${accountTargetCurrency}. ${baseReasoning}`
        : `STRICT MIRROR sullo stesso snapshot OANDA: MAIN ${mainAction} -> MIRROR ${inverseAction}; MAIN SL diventa MIRROR TP e MAIN TP diventa MIRROR SL. ${baseReasoning}`,
      setupType: input.mainDecision?.setupType ? `MIRROR_${input.mainDecision.setupType}` : "MIRROR",
      entryPrice: inverseAction === "HOLD" ? undefined : inverseEntry,
      stopLossPrice: inverseAction === "HOLD" || inverseCashSelected ? undefined : inverseStop,
      takeProfitPrice: inverseAction === "HOLD" || inverseCashSelected ? undefined : inverseTakeProfit,
      structuralTargets: inverseAction === "HOLD" || inverseCashSelected ? [] : inverseTargets,
      riskRewardRatio: inverseAction === "HOLD"
        ? undefined
        : inverseCashSelected && inverseCashProtectionValid
          ? accountCashReward / accountCashRisk
          : riskReward(inverseEntry, inverseStop, inverseTakeProfit),
      mode: inverseSelected ? oandaLaneMode : "PAPER SHADOW",
      selectedForExecution: inverseSelected,
      executionState: inverseSelected ? (inverseEligible ? "READY" : "NOT_ELIGIBLE") : "SHADOW",
      executionReason: inverseSelected && !inverseEligible
        ? inverseAction === "HOLD"
          ? "HOLD"
          : inverseCashSelected && !inverseCashProtectionValid
            ? "ACCOUNT_CASH_TARGETS_INVALID"
            : !inverseLevelsValid
              ? "MIRROR_PROTECTIVE_LEVELS_INVALID_AFTER_SPREAD"
              : "CONFIDENCE_BELOW_THRESHOLD"
        : undefined,
      derivedFrom: "MAIN"
    },
    executionBlockedReason
  };
}
