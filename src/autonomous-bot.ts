import { getScalpingSignal } from "./trading-ai";
import { generateMarketData } from "./market-engine";
import { canOpenTrade } from "./risk-engine";
import { getSession, isKillzone } from "./session-engine";
import { rankSignals } from "./signal-ranker";
import { MarketData, TradingDecision } from "./types";
import { executeVerifiedMarketOrder } from "./execution-engine";
import { createPairedSignalSnapshot, PairedSignalSnapshot, StrategyVariant } from "./signal-pair";
import { confirmSetupWithAi, AiConfirmationStatus } from "./ai-confirmation";
import { loadMultiTimeframeIntelligence, MultiTimeframeIntelligence } from "./multi-timeframe";
import {
  buildXauSignalCandidate,
  xauSignalLab,
  XauSignalLabSnapshot
} from "./xau-signal-lab";
const oanda = require("./oanda");
const config = require("./config");

const SYMBOLS = (config.SYMBOLS || []).map((symbol: string) => String(symbol).replace("_", ""));
const EXECUTION_SYMBOLS = SYMBOLS.filter((symbol: string) => !String(symbol).toUpperCase().startsWith("XAU"));

// Market data uses M5 candles; the configured interval controls how often the
// latest completed OANDA context is evaluated. Concurrent scans are blocked.
const SIGNAL_INTERVAL = Number(config.SCAN_INTERVAL || 2 * 60 * 1000);
const CLOSE_INTERVAL = 15000;
const PRICE_INTERVAL = 1000;

const MAX_DAILY_TRADES = Number(config.MAX_DAILY_TRADES);
const MAX_DAILY_TRADES_PER_SYMBOL = Number(config.MAX_DAILY_TRADES_PER_SYMBOL || 100);
const MAX_TRADES_PER_MINUTE = Number(config.MAX_TRADES_PER_MINUTE || 100);
const MIN_CONFIDENCE = Number(config.MIN_CONFIDENCE);
const MAX_OPEN_POSITIONS = Number(config.MAX_OPEN_TRADES || 15);
const MAX_NEW_TRADES_PER_CYCLE = Number(config.MAX_NEW_TRADES_PER_CYCLE || 6);
const MAX_DAILY_LOSS = Number(config.MAX_DAILY_LOSS || 50);
const DAILY_LOSS_LIMIT_ENABLED = config.DAILY_LOSS_LIMIT_ENABLED === true;
const SYMBOL_REENTRY_COOLDOWN_MS = Number(config.SYMBOL_REENTRY_COOLDOWN_MS ?? 10 * 60 * 1000);
const MINIMUM_SCORE_FOR_XAU_AI = 70;

interface BotTrade {
  id: string;
  symbol: string;
  side: "BUY" | "SELL" | "HOLD";
  entryPrice: number;
  currentPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
  riskAmount?: number;
  rewardAmount?: number;
  pnl?: number;
  pnlPips?: number;
  pnlR?: number;
  riskPips?: number;
  rewardPips?: number;
  openedAt: string;
  closedAt?: string;
  setupType?: string;
  confidence?: number;
  reasoning?: string;
  closeReason?: "TP HIT" | "SL HIT" | "MANUAL" | "SIGNAL EXIT" | "PAIR CLOSED" | "POST-FILL RECONCILIATION FAILURE";
  status: "OPEN" | "CLOSED";
  source: "PAPER" | "PAPER_SHADOW" | "OANDA" | "LOCAL_ORPHAN";
  units: number;
  accountCurrency?: string;
  pnlCurrency?: string;
  oandaOrderId?: string;
  oandaTradeId?: string;
  verificationStatus?: "VERIFIED" | "NOT_VERIFIED" | "PAPER_RECORDED";
  strategyVariant?: StrategyVariant;
  signalId?: string;
  signalAt?: string;
  priceTime?: string;
  managedByBot?: boolean;
  clientTag?: string;
  pairedWithTradeId?: string;
}

export interface BotSnapshot {
  status: "ONLINE" | "OFFLINE";
  isRunning: boolean;
  startedAt?: string;
  lastUpdated?: string;
  lastPriceAt?: string;
  priceFeedStatus: "CONNECTED" | "PARTIAL" | "DISCONNECTED";
  dataSource: string;
  oandaConnected: boolean;
  oandaReason?: string;
  executionMode: string;
  tradingMode: "PAPER" | "OANDA_DEMO" | "OANDA_LIVE";
  effectiveExecutionState:
    | "UNAVAILABLE"
    | "PAPER"
    | "OANDA_DEMO_BLOCKED"
    | "OANDA_DEMO_READY"
    | "OANDA_LIVE_BLOCKED"
    | "OANDA_LIVE_READY";
  liveTradingEnabled: boolean;
  liveExecutionVariant: StrategyVariant | "INVALID";
  liveExecutionVariantValid: boolean;
  aiProvider: "DISABLED" | "GEMINI" | "OPENAI";
  aiConfirmationRequired: boolean;
  aiStatus: AiConfirmationStatus | "NOT_CHECKED";
  lastAiReason?: string;
  lastAiCheckedAt?: string;
  lastAiSignalId?: string;
  accountCurrency?: string;
  symbols: string[];
  signalProfile: "ROHATO_ULTRA_100_PER_MINUTE" | "ROHATO_HYPER_100_PER_SYMBOL" | "ROHATO_AGGRESSIVE_100" | "AGGRESSIVE_25" | "BALANCED";
  maxDailyTrades: number;
  maxDailyTradesPerSymbol: number;
  maxTradesPerMinute: number;
  tradesLastMinute: number;
  minuteRemainingTrades: number;
  minimumConfidence: number;
  maxOpenPositions: number;
  maxNewTradesPerCycle: number;
  maxTradesPerSymbol: number;
  scanIntervalMs: number;
  dailyLossLimitEnabled: boolean;
  maxDailyLoss: number | null;
  symbolReentryCooldownMs: number;
  currentSymbol?: string;
  currentAction?: "BUY" | "SELL" | "HOLD";
  currentConfidence?: number;
  currentReasoning?: string;
  currentPrice?: number;
  entryPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
  riskAmount?: number;
  rewardAmount?: number;
  profitLoss?: number;
  dailyTradeCount: number;
  dailyTradeCountBySymbol: Record<string, number>;
  signalsAnalyzed: number;
  signalsDiscarded: number;
  openTrades: BotTrade[];
  orphanTrades: BotTrade[];
  pendingOrders: Array<{
    id: string;
    type: string;
    instrument?: string;
    units?: number;
    price?: number;
    state?: string;
    createTime?: string;
    clientTag?: string;
  }>;
  closedTrades: BotTrade[];
  shadowOpenTrades: BotTrade[];
  shadowClosedTrades: BotTrade[];
  shadowTradeCount: number;
  session: string;
  killzone: boolean;
  logs: string[];
  marketData?: Record<string, MarketData>;
  livePrices?: Record<string, { bid: number; ask: number; mid: number; time: string; tradeable: boolean; }>;
  lastSignals?: Record<string, TradingDecision & { scannedAt: string }>;
  pairedSignals?: Record<string, PairedSignalSnapshot>;
  latestPairedSignal?: PairedSignalSnapshot;
  xauSignalLab: XauSignalLabSnapshot;
  priceCoverage: number;
  priceExpected: number;
  reconciliationStatus: "NOT_RUN" | "VERIFIED" | "FAILED";
  lastReconciledAt?: string;
  lastOrderAttemptAt?: string;
  lastOrderStatus?: "SUBMITTING" | "OPEN_VERIFIED" | "REJECTED" | "SKIPPED";
  lastOrderReason?: string;
  lastOandaOrderId?: string;
  lastOandaTradeId?: string;
  dailyRiskStatus: {
    dateUTC: string;
    tradeCount: number;
    maxTrades: number;
    pnl: number | null;
    currency?: string;
    complete: boolean;
    reason?: string;
    remainingTrades: number;
    resetAt: string;
  };
  entryGateStatus:
    | "READY"
    | "SCANNER_STOPPED"
    | "EXECUTION_BLOCKED"
    | "MINUTE_RATE_LIMIT"
    | "DAILY_TRADE_LIMIT"
    | "DAILY_LOSS_LIMIT"
    | "MAX_OPEN_POSITIONS";
  entryGateReason: string;
  dailyRemainingTrades: number;
  nextDailyResetAt: string;
}

const botState: BotSnapshot = {
  status: "OFFLINE",
  isRunning: false,
  dataSource: "OANDA_UNAVAILABLE",
  oandaConnected: false,
  priceFeedStatus: "DISCONNECTED",
  executionMode: config.TRADING_MODE === "PAPER"
    ? "PAPER"
    : `${config.TRADING_MODE} BLOCKED UNTIL SAFETY GATES PASS`,
  tradingMode: config.TRADING_MODE,
  effectiveExecutionState: config.TRADING_MODE === "PAPER" ? "PAPER" :
    config.TRADING_MODE === "OANDA_DEMO" ? "OANDA_DEMO_BLOCKED" : "OANDA_LIVE_BLOCKED",
  liveTradingEnabled: config.LIVE_TRADING_ENABLED,
  liveExecutionVariant: config.LIVE_EXECUTION_VARIANT,
  liveExecutionVariantValid: config.LIVE_EXECUTION_VARIANT_VALID,
  aiProvider: config.AI_PROVIDER,
  aiConfirmationRequired: config.AI_CONFIRMATION_REQUIRED,
  aiStatus: config.AI_PROVIDER === "DISABLED" ? "DISABLED" : "NOT_CHECKED",
  symbols: SYMBOLS,
  signalProfile: config.FOREX_SIGNAL_PROFILE,
  maxDailyTrades: MAX_DAILY_TRADES,
  maxDailyTradesPerSymbol: MAX_DAILY_TRADES_PER_SYMBOL,
  maxTradesPerMinute: MAX_TRADES_PER_MINUTE,
  tradesLastMinute: 0,
  minuteRemainingTrades: MAX_TRADES_PER_MINUTE,
  minimumConfidence: MIN_CONFIDENCE,
  maxOpenPositions: MAX_OPEN_POSITIONS,
  maxNewTradesPerCycle: MAX_NEW_TRADES_PER_CYCLE,
  maxTradesPerSymbol: Number(config.MAX_TRADES_PER_SYMBOL || 1),
  scanIntervalMs: SIGNAL_INTERVAL,
  dailyLossLimitEnabled: DAILY_LOSS_LIMIT_ENABLED,
  maxDailyLoss: DAILY_LOSS_LIMIT_ENABLED ? MAX_DAILY_LOSS : null,
  symbolReentryCooldownMs: SYMBOL_REENTRY_COOLDOWN_MS,
  dailyTradeCount: 0,
  dailyTradeCountBySymbol: {},
  signalsAnalyzed: 0,
  signalsDiscarded: 0,
  openTrades: [],
  orphanTrades: [],
  pendingOrders: [],
  closedTrades: [],
  shadowOpenTrades: [],
  shadowClosedTrades: [],
  shadowTradeCount: 0,
  session: "OFF_HOURS",
  killzone: false,
  logs: [],
  marketData: {},
  livePrices: {},
  lastSignals: {},
  pairedSignals: {},
  xauSignalLab: xauSignalLab.getSnapshot(),
  priceCoverage: 0,
  // Execution readiness depends on the 15 FX pairs only. XAUUSD has its own
  // SIGNAL ONLY schedule and must never hold the FX order lane closed.
  priceExpected: EXECUTION_SYMBOLS.length,
  reconciliationStatus: "NOT_RUN",
  dailyRiskStatus: {
    dateUTC: new Date().toISOString().slice(0, 10),
    tradeCount: 0,
    maxTrades: MAX_DAILY_TRADES,
    pnl: null,
    complete: config.TRADING_MODE === "PAPER",
    reason: config.TRADING_MODE === "PAPER" ? undefined : "OANDA_RECONCILIATION_NOT_RUN",
    remainingTrades: MAX_DAILY_TRADES,
    resetAt: nextUtcResetAt()
  },
  entryGateStatus: "SCANNER_STOPPED",
  entryGateReason: "SCANNER_STOPPED",
  dailyRemainingTrades: MAX_DAILY_TRADES,
  nextDailyResetAt: nextUtcResetAt()
};

const listeners = new Set<(snapshot: BotSnapshot) => void>();
let signalTimer: ReturnType<typeof setInterval> | undefined;
let closeTimer: ReturnType<typeof setInterval> | undefined;
let priceTimer: ReturnType<typeof setInterval> | undefined;
let scanInProgress = false;
let runGeneration = 0;
let priceRefreshInProgress = false;
let lastPriceErrorLogAt = 0;
let reconciliationPromise: Promise<void> | undefined;
let dailyCounterDate = new Date().toISOString().slice(0, 10);
let dailyRiskDataComplete = config.TRADING_MODE === "PAPER";
let dailyRiskReason: string | undefined = config.TRADING_MODE === "PAPER"
  ? undefined
  : "OANDA_RECONCILIATION_NOT_RUN";
let recentEntryTimes: number[] = [];

function executionFeedOperational(
  state: Pick<BotSnapshot, "priceFeedStatus" | "priceCoverage" | "priceExpected" | "lastPriceAt">,
  now = Date.now()
) {
  const priceTime = Date.parse(String(state.lastPriceAt || ""));
  const priceFresh = Number.isFinite(priceTime) && now - priceTime >= -5000 && now - priceTime <= 30000;

  // OANDA can update thin Sunday-open instruments at different times. Requiring
  // all 15 FX quotes to be fresh in the same one-second snapshot globally
  // blocks valid symbols. Each scanned symbol is still fail-closed below:
  // generateMarketData and pairedSignal.marketValid require that symbol's own
  // executable quote to be fresh and tradeable before any order can be sent.
  return state.priceFeedStatus !== "DISCONNECTED" &&
    state.priceCoverage > 0 &&
    state.priceExpected > 0 &&
    priceFresh;
}

function liveExecutionActive() {
  const modeReady = config.TRADING_MODE === "OANDA_DEMO" ||
    (config.TRADING_MODE === "OANDA_LIVE" && config.OANDA_LIVE_CONFIRMED === true);
  const aiGateConfigured = config.AI_CONFIRMATION_REQUIRED !== true ||
    (["GEMINI", "OPENAI"].includes(String(config.AI_PROVIDER)) &&
      Boolean(config.GEMINI_API_KEY || config.OPENAI_API_KEY));
  return modeReady &&
    config.OANDA_ORDER_EXECUTION_ENABLED === true &&
    config.LIVE_TRADING_ENABLED === true &&
    config.LIVE_EXECUTION_VARIANT_VALID === true &&
    config.OANDA_ENVIRONMENT_VALID === true &&
    botState.oandaConnected === true &&
    botState.reconciliationStatus === "VERIFIED" &&
    executionFeedOperational(botState) &&
    dailyRiskDataComplete &&
    aiGateConfigured;
}

function liveModeConfigured() {
  return config.TRADING_MODE === "OANDA_DEMO" || config.TRADING_MODE === "OANDA_LIVE";
}

function effectiveExecutionState(): BotSnapshot["effectiveExecutionState"] {
  if (config.TRADING_MODE === "PAPER") return "PAPER";
  if (config.TRADING_MODE === "OANDA_DEMO") {
    return liveExecutionActive() ? "OANDA_DEMO_READY" : "OANDA_DEMO_BLOCKED";
  }
  return liveExecutionActive() ? "OANDA_LIVE_READY" : "OANDA_LIVE_BLOCKED";
}

function nextUtcResetAt(reference = new Date()) {
  return new Date(Date.UTC(
    reference.getUTCFullYear(),
    reference.getUTCMonth(),
    reference.getUTCDate() + 1
  )).toISOString();
}

function entryGate(analytics: ReturnType<typeof getAnalytics>) {
  if (!botState.isRunning) {
    return { status: "SCANNER_STOPPED" as const, reason: "SCANNER_STOPPED" };
  }
  if (liveModeConfigured() && !liveExecutionActive()) {
    return { status: "EXECUTION_BLOCKED" as const, reason: dailyRiskReason || "OANDA_EXECUTION_GATES_NOT_READY" };
  }
  if (rollingMinuteTradeCount() >= MAX_TRADES_PER_MINUTE) {
    return { status: "MINUTE_RATE_LIMIT" as const, reason: `ROLLING_MINUTE_LIMIT_${MAX_TRADES_PER_MINUTE}` };
  }
  if (botState.dailyTradeCount >= MAX_DAILY_TRADES) {
    return { status: "DAILY_TRADE_LIMIT" as const, reason: `DAILY_LIMIT_${MAX_DAILY_TRADES}_UTC` };
  }
  if (dailyLossCapReached(analytics.pnlToday)) {
    return { status: "DAILY_LOSS_LIMIT" as const, reason: `DAILY_LOSS_LIMIT_${MAX_DAILY_LOSS}` };
  }
  if (botState.openTrades.length >= MAX_OPEN_POSITIONS) {
    return { status: "MAX_OPEN_POSITIONS" as const, reason: `MAX_OPEN_POSITIONS_${MAX_OPEN_POSITIONS}` };
  }
  return { status: "READY" as const, reason: "ENTRY_GATES_VERIFIED" };
}

function ensureDailyCounterDate() {
  const today = new Date().toISOString().slice(0, 10);
  if (today === dailyCounterDate) return;
  dailyCounterDate = today;
  botState.dailyTradeCount = 0;
  botState.dailyTradeCountBySymbol = {};
  recentEntryTimes = [];
  if (liveModeConfigured()) {
    botState.reconciliationStatus = "NOT_RUN";
    dailyRiskDataComplete = false;
    dailyRiskReason = "OANDA_DAILY_RECONCILIATION_REQUIRED";
  }
}

function refreshDerivedState() {
  ensureDailyCounterDate();
  const tradesLastMinute = rollingMinuteTradeCount();
  botState.tradesLastMinute = tradesLastMinute;
  botState.minuteRemainingTrades = Math.max(0, MAX_TRADES_PER_MINUTE - tradesLastMinute);
  const analytics = getAnalytics();
  const state = effectiveExecutionState();
  botState.effectiveExecutionState = state;
  botState.executionMode = state === "PAPER"
    ? "PAPER"
    : state.endsWith("_READY")
      ? `${config.TRADING_MODE} (${config.LIVE_EXECUTION_VARIANT})`
      : `${config.TRADING_MODE} BLOCKED`;
  const resetAt = nextUtcResetAt();
  const remainingTrades = Math.max(0, MAX_DAILY_TRADES - botState.dailyTradeCount);
  const gate = entryGate(analytics);
  botState.entryGateStatus = gate.status;
  botState.entryGateReason = gate.reason;
  botState.dailyRemainingTrades = remainingTrades;
  botState.nextDailyResetAt = resetAt;
  botState.dailyRiskStatus = {
    dateUTC: dailyCounterDate,
    tradeCount: botState.dailyTradeCount,
    maxTrades: MAX_DAILY_TRADES,
    pnl: analytics.pnlToday,
    currency: analytics.pnlCurrency || botState.accountCurrency,
    complete: config.TRADING_MODE === "PAPER" ? true : dailyRiskDataComplete && analytics.pnlComplete,
    reason: config.TRADING_MODE === "PAPER"
      ? undefined
      : dailyRiskDataComplete && analytics.pnlComplete
        ? undefined
        : dailyRiskReason || "OANDA_DAILY_RISK_DATA_INCOMPLETE",
    remainingTrades,
    resetAt
  };
  botState.xauSignalLab = xauSignalLab.getSnapshot();
}

function emitState() {
  refreshDerivedState();
  const snapshot = {
    ...botState,
    closedTrades: [...botState.closedTrades].slice(0, 500),
    logs: [...botState.logs].slice(-50)
  };

  listeners.forEach((listener) => listener(snapshot));
}

function pushLog(message: string) {
  botState.logs.push(message);
  if (botState.logs.length > 50) {
    botState.logs = botState.logs.slice(-50);
  }

  emitState();
}

function cleanSymbol(symbol: string) {
  return String(symbol || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function optionalFinite(value: unknown) {
  if (value === null || value === undefined || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function isGold(symbol: string) {
  return cleanSymbol(symbol).includes("XAU");
}

function tradeUnits(symbol: string) {
  return isGold(symbol) ? Number(config.XAUUSD_UNITS || 1) : Number(config.DEFAULT_UNITS || 1000);
}

function cashRules(symbol: string) {
  return isGold(symbol)
    ? {
        riskAmount: Number(config.XAUUSD_STOP_LOSS_AMOUNT || 7.5),
        rewardAmount: Number(config.XAUUSD_TAKE_PROFIT_USD || 15)
      }
    : {
        riskAmount: Number(config.NORMAL_STOP_LOSS_ACCOUNT || 0.2),
        rewardAmount: Number(config.NORMAL_TAKE_PROFIT_ACCOUNT || 2)
      };
}

function pipSize(symbol: string) {
  return /JPY$/i.test(cleanSymbol(symbol)) ? 0.01 : 0.0001;
}

function fixedPipPlan(symbol: string, entryPrice: number, side: "BUY" | "SELL" | "HOLD") {
  const direction = side === "SELL" ? -1 : 1;
  const riskPips = Number(config.NORMAL_STOP_LOSS_PIPS || 10);
  const rewardPips = Number(config.NORMAL_TAKE_PROFIT_PIPS || 20);
  const unitPip = pipSize(symbol);
  const units = tradeUnits(symbol);
  return {
    riskPips,
    rewardPips,
    stopLoss: entryPrice - direction * riskPips * unitPip,
    takeProfit: entryPrice + direction * rewardPips * unitPip,
    riskAmount: riskPips * unitPip * units,
    rewardAmount: rewardPips * unitPip * units
  };
}

function variantPipDefaults(variant?: StrategyVariant) {
  const mainRisk = Number(config.NORMAL_STOP_LOSS_PIPS || 10);
  const mainReward = Number(config.NORMAL_TAKE_PROFIT_PIPS || 20);
  return variant === "INVERSE"
    ? { riskPips: mainReward, rewardPips: mainRisk }
    : { riskPips: mainRisk, rewardPips: mainReward };
}

function laneProtectionPlan(
  symbol: string,
  entryPrice: number,
  side: "BUY" | "SELL" | "HOLD",
  stopLoss: unknown,
  takeProfit: unknown
) {
  const stop = optionalFinite(stopLoss);
  const target = optionalFinite(takeProfit);
  if (side === "HOLD" || !Number.isFinite(entryPrice) || !stop || !target) return null;
  const direction = side === "BUY" ? 1 : -1;
  if ((entryPrice - stop) * direction <= 0 || (target - entryPrice) * direction <= 0) return null;
  const multiplier = pipMultiplier(symbol);
  const riskPips = Math.abs(entryPrice - stop) * multiplier;
  const rewardPips = Math.abs(target - entryPrice) * multiplier;
  const units = tradeUnits(symbol);
  return {
    stopLoss: stop,
    takeProfit: target,
    riskPips,
    rewardPips,
    riskAmount: Math.abs(entryPrice - stop) * units,
    rewardAmount: Math.abs(target - entryPrice) * units
  };
}

function normalizedR(pnlPips: unknown, riskPips: unknown) {
  const pnl = Number(pnlPips);
  const risk = Number(riskPips);
  return Number.isFinite(pnl) && Number.isFinite(risk) && risk > 0 ? pnl / risk : undefined;
}

function calculatePaperPnl(symbol: string, side: "BUY" | "SELL" | "HOLD", entryPrice: number, currentPrice: number) {
  if (side === "HOLD") return 0;
  const direction = side === "BUY" ? 1 : -1;
  return (currentPrice - entryPrice) * direction * tradeUnits(symbol);
}

function quoteCurrency(symbol: string) {
  const normalized = cleanSymbol(symbol);
  return normalized.length >= 6 ? normalized.slice(-3) : undefined;
}

function paperExecutablePrice(side: "BUY" | "SELL" | "HOLD", marketData: MarketData) {
  const candidate = side === "SELL" ? Number(marketData.bid) : Number(marketData.ask);
  if (!Number.isFinite(candidate) || candidate <= 0) {
    throw new Error("OANDA_EXECUTABLE_ENTRY_PRICE_UNAVAILABLE");
  }
  return candidate;
}

function parseGemmoClientTag(tag: unknown) {
  const match = /^GEMMO-(MAIN|INVERSE)-(SIG-[A-Za-z0-9._-]+)$/.exec(String(tag || ""));
  return match
    ? { strategyVariant: match[1] as StrategyVariant, signalId: match[2], clientTag: match[0] }
    : null;
}

function isVerifiedRohatoOandaTrade(
  trade: Pick<BotTrade, "source" | "managedByBot" | "strategyVariant" | "signalId" | "clientTag" | "oandaTradeId">
) {
  const ownership = parseGemmoClientTag(trade.clientTag);
  return trade.source === "OANDA" &&
    trade.managedByBot === true &&
    Boolean(trade.oandaTradeId) &&
    Boolean(ownership) &&
    ownership?.strategyVariant === trade.strategyVariant &&
    ownership?.signalId === trade.signalId;
}

function hasUnverifiedOandaExposure(
  trades: Array<Pick<BotTrade, "source" | "managedByBot" | "strategyVariant" | "signalId" | "clientTag" | "oandaTradeId">> = botState.openTrades
) {
  // A verified Rohato trade from the previous lane is safe to leave under its
  // broker-side SL/TP. It blocks only its own symbol through
  // hasOpenTradeForSymbol(), not every unrelated FX pair. Manual, malformed or
  // otherwise unverified OANDA exposure still fails closed globally.
  return trades.some((trade) => trade.source === "OANDA" && !isVerifiedRohatoOandaTrade(trade));
}

function canAutoCloseOandaTrade(trade: Pick<BotTrade, "source" | "managedByBot" | "strategyVariant" | "clientTag" | "oandaTradeId">, variant: StrategyVariant) {
  return trade.source === "OANDA" &&
    trade.managedByBot === true &&
    trade.strategyVariant === variant &&
    Boolean(trade.clientTag) &&
    Boolean(trade.oandaTradeId);
}

function updatePairExecution(
  pair: PairedSignalSnapshot,
  state: "SUBMITTING" | "SKIPPED" | "REJECTED" | "OPEN_VERIFIED",
  reason?: string,
  ids?: { orderId?: string; tradeId?: string }
) {
  const lane = config.LIVE_EXECUTION_VARIANT === "INVERSE" ? pair.inverse : pair.main;
  if (!lane.selectedForExecution) return;
  lane.executionState = state;
  lane.executionReason = reason;
  lane.oandaOrderId = ids?.orderId;
  lane.oandaTradeId = ids?.tradeId;
}

function syncPairProtectionWithVerifiedTrade(pair: PairedSignalSnapshot, trade: BotTrade, variant: StrategyVariant) {
  const stopLoss = optionalFinite(trade.stopLoss);
  const takeProfit = optionalFinite(trade.takeProfit);
  if (!stopLoss || !takeProfit) return;
  const activeLane = variant === "INVERSE" ? pair.inverse : pair.main;
  const mirrorLane = variant === "INVERSE" ? pair.main : pair.inverse;
  activeLane.entryPrice = trade.entryPrice;
  activeLane.stopLossPrice = stopLoss;
  activeLane.takeProfitPrice = takeProfit;
  mirrorLane.stopLossPrice = takeProfit;
  mirrorLane.takeProfitPrice = stopLoss;
  mirrorLane.structuralTargets = [stopLoss];
  const activePlan = laneProtectionPlan(pair.symbol, trade.entryPrice, trade.side, stopLoss, takeProfit);
  if (activePlan) activeLane.riskRewardRatio = activePlan.rewardPips / activePlan.riskPips;
  if (mirrorLane.entryPrice) {
    const mirrorPlan = laneProtectionPlan(
      pair.symbol,
      mirrorLane.entryPrice,
      mirrorLane.action,
      mirrorLane.stopLossPrice,
      mirrorLane.takeProfitPrice
    );
    if (mirrorPlan) mirrorLane.riskRewardRatio = mirrorPlan.rewardPips / mirrorPlan.riskPips;
  }
}

function paperExitPrice(side: "BUY" | "SELL" | "HOLD", marketData: MarketData) {
  const candidate = side === "BUY" ? Number(marketData.bid) : Number(marketData.ask);
  if (!Number.isFinite(candidate) || candidate <= 0) {
    throw new Error("OANDA_EXECUTABLE_EXIT_PRICE_UNAVAILABLE");
  }
  return candidate;
}

function isFreshTradeableQuote(quote: { bid?: unknown; ask?: unknown; time?: unknown; tradeable?: unknown }) {
  const bid = Number(quote?.bid);
  const ask = Number(quote?.ask);
  const time = Date.parse(String(quote?.time || ""));
  const age = Date.now() - time;
  return Number.isFinite(bid) && bid > 0 &&
    Number.isFinite(ask) && ask >= bid &&
    Number.isFinite(time) && age >= -5000 && age <= 30000 &&
    quote?.tradeable === true;
}

function shadowExecutableExitPrice(
  side: "BUY" | "SELL" | "HOLD",
  quote: { bid?: unknown; ask?: unknown; time?: unknown; tradeable?: unknown } | undefined
) {
  if (!quote || side === "HOLD" || !isFreshTradeableQuote(quote)) return undefined;
  const price = Number(side === "SELL" ? quote.ask : quote.bid);
  return Number.isFinite(price) && price > 0 ? price : undefined;
}

function executionFeedCoverage(
  prices: NonNullable<BotSnapshot["livePrices"]>,
  symbols: string[] = SYMBOLS
) {
  const executionSymbols = symbols.filter((symbol) => !isGold(symbol));
  let covered = 0;
  let latestTime: string | undefined;
  for (const symbol of executionSymbols) {
    const quote = prices[cleanSymbol(symbol)];
    if (!quote) continue;
    covered += 1;
    if (quote.time && (!latestTime || quote.time > latestTime)) latestTime = quote.time;
  }
  return { covered, expected: executionSymbols.length, latestTime };
}

function hasOpenTradeForSymbol(symbol: string) {
  const normalized = cleanSymbol(symbol);
  return botState.openTrades.some((trade) => cleanSymbol(trade.symbol) === normalized);
}

function buildTrade(
  symbol: string,
  decision: TradingDecision,
  marketData: MarketData,
  pairedSignal?: PairedSignalSnapshot
): BotTrade {
  const entryPrice = paperExecutablePrice(decision.action, marketData);
  const direction = decision.action === "SELL" ? -1 : 1;
  const plan = fixedPipPlan(symbol, entryPrice, decision.action);
  const currentPrice = paperExitPrice(decision.action, marketData);
  const pnl = calculatePaperPnl(symbol, decision.action, entryPrice, currentPrice);
  const multiplier = pipMultiplier(symbol);
  const pnlPips = direction * (currentPrice - entryPrice) * multiplier;

  return {
    id: `PAPER-${symbol}-${Date.now()}`,
    symbol,
    side: decision.action,
    entryPrice,
    currentPrice,
    stopLoss: plan.stopLoss,
    takeProfit: plan.takeProfit,
    riskAmount: plan.riskAmount,
    rewardAmount: plan.rewardAmount,
    pnl,
    pnlPips,
    pnlR: normalizedR(pnlPips, plan.riskPips),
    riskPips: plan.riskPips,
    rewardPips: plan.rewardPips,
    openedAt: new Date().toISOString(),
    setupType: decision.setupType,
    confidence: decision.confidence,
    reasoning: `${decision.reasoning}. Paper trading only, units ${tradeUnits(symbol)}, SL ${plan.riskPips} pip, TP ${plan.rewardPips} pip; P&L espresso nella valuta quotata e risultato normalizzato in R.`,
    status: "OPEN",
    source: "PAPER",
    units: tradeUnits(symbol),
    pnlCurrency: quoteCurrency(symbol),
    verificationStatus: "PAPER_RECORDED",
    strategyVariant: "MAIN",
    signalId: pairedSignal?.pairId,
    signalAt: pairedSignal?.evaluatedAt,
    priceTime: pairedSignal?.market.time
  };
}

export function getBotSnapshot(): BotSnapshot {
  refreshDerivedState();
  return {
    ...botState,
    closedTrades: [...botState.closedTrades].slice(0, 500),
    logs: [...botState.logs].slice(-50)
  };
}

export function subscribeToBotUpdates(
  listener: (snapshot: BotSnapshot) => void
) {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

function pipMultiplier(symbol: string) {
  if (/JPY$/.test(symbol)) return 100; // JPY pairs quoted to 2 decimals
  return 10000; // most FX pairs quoted to 4/5 decimals
}

function isToday(dateIso?: string) {
  if (!dateIso) return false;
  const d = new Date(dateIso);
  const now = new Date();
  return (
    d.getUTCFullYear() === now.getUTCFullYear() &&
    d.getUTCMonth() === now.getUTCMonth() &&
    d.getUTCDate() === now.getUTCDate()
  );
}

export function getAnalytics() {
  ensureDailyCounterDate();
  const eligible = (trade: BotTrade) => liveModeConfigured()
    ? trade.source === "OANDA" && trade.verificationStatus === "VERIFIED"
    : trade.source === "PAPER";
  const closed = (botState.closedTrades || []).filter(eligible);
  const open = (botState.openTrades || []).filter(eligible);

  const todaysClosed = closed.filter((t) => isToday(t.openedAt) || isToday(t.closedAt));
  const relevantPnlTrades = [...todaysClosed, ...open];
  const pnlTrades = relevantPnlTrades.filter((trade) => Number.isFinite(trade.pnl));
  const pnlCurrencies = new Set(
    pnlTrades
      .map((trade) => trade.source === "OANDA" ? trade.accountCurrency : trade.pnlCurrency)
      .filter((currency): currency is string => Boolean(currency))
  );
  const pnlCurrency = pnlCurrencies.size === 1 ? [...pnlCurrencies][0] : null;
  const pnlComplete = relevantPnlTrades.length === 0 ||
    (pnlTrades.length === relevantPnlTrades.length && Boolean(pnlCurrency));
  const pnlToday = relevantPnlTrades.length > 0 && pnlComplete && pnlCurrency
    ? pnlTrades.reduce((sum, trade) => sum + Number(trade.pnl), 0)
    : null;

  const decided = closed.filter((trade) => Number.isFinite(trade.pnl) && trade.pnl !== 0);
  const wins = decided.filter((trade) => Number(trade.pnl) > 0).length;
  const losses = decided.filter((trade) => Number(trade.pnl) < 0).length;
  const winRate = decided.length > 0 ? Math.round((wins / decided.length) * 1000) / 10 : null;

  // distribution by setupType
  const distribution: Record<string, number> = {};
  closed.forEach((t) => {
    const key = (t as any).setupType || "UNKNOWN";
    distribution[key] = (distribution[key] || 0) + 1;
  });

  // trades per day (last 30 days)
  const perDay: Record<string, number> = {};
  closed.forEach((t) => {
    const d = (t as any).closedAt ? new Date((t as any).closedAt) : new Date((t as any).openedAt);
    if (Number.isNaN(d.getTime())) return;
    const key = d.toISOString().slice(0, 10);
    perDay[key] = (perDay[key] || 0) + 1;
  });

  return {
    pnlToday,
    pnlCurrency,
    pnlComplete,
    winRate,
    wins,
    losses,
    totalTrades: closed.length,
    openTrades: open.length,
    executionMode: botState.executionMode,
    distribution,
    tradesPerDay: perDay
  };
}

async function refreshLivePrices() {
  if (!botState.isRunning || priceRefreshInProgress) return;
  if (!botState.oandaConnected) {
    botState.priceFeedStatus = "DISCONNECTED";
    botState.priceCoverage = 0;
    return;
  }
  priceRefreshInProgress = true;

  try {
    const prices = await oanda.getPrices(SYMBOLS);
    if (!Array.isArray(prices) || prices.length === 0) {
      throw new Error("OANDA_PRICE_SNAPSHOT_UNAVAILABLE");
    }

    const nextPrices: NonNullable<BotSnapshot["livePrices"]> = {};
    for (const item of prices) {
      const symbol = cleanSymbol(item?.instrument);
      const bid = Number(item?.bids?.[0]?.price ?? item?.closeoutBid);
      const ask = Number(item?.asks?.[0]?.price ?? item?.closeoutAsk);
      const time = String(item?.time || "");
      const timeValue = Date.parse(time);
      const age = Date.now() - timeValue;
      if (!symbol || !Number.isFinite(bid) || !Number.isFinite(ask) || bid <= 0 || ask < bid ||
        !Number.isFinite(timeValue) || age < -5000 || age > 30000) continue;

      const mid = (bid + ask) / 2;
      const tradeable = item?.tradeable === true && String(item?.status || "").toLowerCase() === "tradeable";
      nextPrices[symbol] = {
        bid,
        ask,
        mid,
        time,
        tradeable
      };

      const existing = botState.marketData?.[symbol];
      if (existing) {
        const multiplier = isGold(symbol) ? 10 : pipMultiplier(symbol);
        botState.marketData![symbol] = {
          ...existing,
           bid,
           ask,
           closePrice: mid,
           spread: Math.max(0, ask - bid) * multiplier,
           priceTime: time,
           tradeable
         };
      }

    }

    const fxCoverage = executionFeedCoverage(nextPrices);
    if (fxCoverage.covered === 0) throw new Error("OANDA_FX_PRICE_SNAPSHOT_EMPTY");
    botState.livePrices = nextPrices;
    botState.priceCoverage = fxCoverage.covered;
    botState.priceExpected = fxCoverage.expected;
    botState.lastPriceAt = fxCoverage.latestTime;
    botState.priceFeedStatus = fxCoverage.covered === fxCoverage.expected ? "CONNECTED" : "PARTIAL";
    botState.oandaConnected = true;
    botState.oandaReason = undefined;
    botState.dataSource = "OANDA MARKET DATA";
    const xauQuote = nextPrices.XAUUSD;
    if (xauQuote) {
      const closedSignals = xauSignalLab.updateQuote(xauQuote);
      for (const signal of closedSignals) {
        botState.logs.push(
          `[XAUUSD] SIGNAL ONLY ${signal.status} | risultato ${signal.resultR >= 0 ? "+" : ""}${signal.resultR.toFixed(2)}R | nessun ordine OANDA`
        );
      }
      if (botState.logs.length > 50) botState.logs = botState.logs.slice(-50);
    }
    emitState();
  } catch (_error) {
    botState.priceFeedStatus = "DISCONNECTED";
    botState.priceCoverage = 0;
    botState.livePrices = {};
    const now = Date.now();
    if (now - lastPriceErrorLogAt >= 30000) {
      lastPriceErrorLogAt = now;
      pushLog("OANDA one-second price feed unavailable: no synthetic price used");
    } else {
      emitState();
    }
  } finally {
    priceRefreshInProgress = false;
  }
}

function mapVerifiedOandaTrade(remote: any, accountCurrency: string, previous?: BotTrade): BotTrade {
  const signedUnits = optionalFinite(remote?.currentUnits ?? remote?.initialUnits);
  const symbol = cleanSymbol(remote?.instrument);
  const entryPrice = optionalFinite(remote?.price) ?? previous?.entryPrice;
  const quote = botState.livePrices?.[symbol];
  const quotePrice = signedUnits && signedUnits < 0
    ? optionalFinite(quote?.ask)
    : optionalFinite(quote?.bid);
  const currentPrice = quote && isFreshTradeableQuote(quote) && quotePrice
    ? quotePrice
    : undefined;
  const openedAt = String(remote?.openTime || previous?.openedAt || "");
  if (!signedUnits || !symbol || !entryPrice || !Number.isFinite(Date.parse(openedAt))) {
    throw new Error("OANDA_OPEN_TRADE_FIELDS_INCOMPLETE");
  }
  const ownership = parseGemmoClientTag(remote?.clientExtensions?.tag);
  const unrealizedPL = optionalFinite(remote?.unrealizedPL);
  const side: "BUY" | "SELL" = signedUnits < 0 ? "SELL" : "BUY";
  const livePnlPips = currentPrice
    ? (side === "BUY" ? currentPrice - entryPrice : entryPrice - currentPrice) * pipMultiplier(symbol)
    : previous?.pnlPips;
  const fallbackPips = ownership ? variantPipDefaults(ownership.strategyVariant) : undefined;
  const riskPips = previous?.riskPips ?? fallbackPips?.riskPips;

  return {
    id: `OANDA-${remote.id}`,
    symbol,
    side,
    units: Math.abs(signedUnits),
    entryPrice,
    currentPrice,
    stopLoss: optionalFinite(remote?.stopLossOrder?.price),
    takeProfit: optionalFinite(remote?.takeProfitOrder?.price),
    riskAmount: previous?.riskAmount,
    rewardAmount: previous?.rewardAmount,
    pnl: unrealizedPL,
    pnlPips: livePnlPips,
    pnlR: normalizedR(livePnlPips, riskPips),
    riskPips,
    rewardPips: previous?.rewardPips ?? fallbackPips?.rewardPips,
    openedAt,
    setupType: previous?.setupType || (!ownership ? "OANDA_EXTERNAL" : undefined),
    confidence: previous?.confidence,
    reasoning: previous?.reasoning || (ownership
      ? "Posizione Rohato aperta e verificata direttamente tramite OANDA Practice."
      : "Posizione OANDA verificata ma non gestita dal bot: nessuna chiusura automatica."),
    status: "OPEN",
    source: "OANDA",
    accountCurrency,
    oandaOrderId: previous?.oandaOrderId,
    oandaTradeId: String(remote.id),
    verificationStatus: "VERIFIED",
    strategyVariant: ownership?.strategyVariant,
    signalId: ownership?.signalId,
    signalAt: previous?.signalAt,
    priceTime: previous?.priceTime,
    managedByBot: Boolean(ownership),
    clientTag: ownership?.clientTag,
    pairedWithTradeId: previous?.pairedWithTradeId
  };
}

function mapClosedOandaTrade(remote: any, accountCurrency: string, previous?: BotTrade): BotTrade {
  const signedUnits = optionalFinite(remote?.initialUnits ?? remote?.currentUnits);
  const entryPrice = optionalFinite(remote?.price) ?? previous?.entryPrice;
  const closePrice = optionalFinite(remote?.averageClosePrice);
  const openedAt = String(remote?.openTime || previous?.openedAt || "");
  if (!signedUnits || !entryPrice || !Number.isFinite(Date.parse(openedAt))) {
    throw new Error("OANDA_CLOSED_TRADE_FIELDS_INCOMPLETE");
  }
  const ownership = parseGemmoClientTag(remote?.clientExtensions?.tag);
  const symbol = cleanSymbol(remote?.instrument);
  const side: "BUY" | "SELL" = signedUnits < 0 ? "SELL" : "BUY";
  const pnlPips = closePrice && closePrice > 0
    ? (side === "BUY" ? closePrice - entryPrice : entryPrice - closePrice) * pipMultiplier(symbol)
    : previous?.pnlPips;
  const fallbackPips = ownership ? variantPipDefaults(ownership.strategyVariant) : undefined;
  const riskPips = previous?.riskPips ?? fallbackPips?.riskPips;
  return {
    id: `OANDA-${remote.id}`,
    symbol,
    side,
    units: Math.abs(signedUnits),
    entryPrice,
    currentPrice: closePrice && closePrice > 0 ? closePrice : previous?.currentPrice,
    stopLoss: previous?.stopLoss,
    takeProfit: previous?.takeProfit,
    riskAmount: previous?.riskAmount,
    rewardAmount: previous?.rewardAmount,
    pnl: optionalFinite(remote?.realizedPL),
    pnlPips,
    pnlR: normalizedR(pnlPips, riskPips),
    riskPips,
    rewardPips: previous?.rewardPips ?? fallbackPips?.rewardPips,
    openedAt,
    closedAt: remote?.closeTime || previous?.closedAt,
    setupType: previous?.setupType || (!ownership ? "OANDA_EXTERNAL" : undefined),
    confidence: previous?.confidence,
    reasoning: previous?.reasoning || (ownership
      ? "Trade Rohato chiuso e verificato direttamente tramite OANDA Practice."
      : "Trade OANDA chiuso verificato; origine bot non dimostrata."),
    closeReason: previous?.closeReason,
    status: "CLOSED",
    source: "OANDA",
    accountCurrency,
    oandaOrderId: previous?.oandaOrderId,
    oandaTradeId: String(remote.id),
    verificationStatus: "VERIFIED",
    strategyVariant: ownership?.strategyVariant,
    signalId: ownership?.signalId,
    signalAt: previous?.signalAt,
    priceTime: previous?.priceTime,
    managedByBot: Boolean(ownership),
    clientTag: ownership?.clientTag,
    pairedWithTradeId: previous?.pairedWithTradeId
  };
}

async function reconcileLiveTrades() {
  if (!liveModeConfigured()) return;
  if (reconciliationPromise) {
    await reconciliationPromise;
    return;
  }

  reconciliationPromise = reconcileLiveTradesOnce();
  try {
    await reconciliationPromise;
  } finally {
    reconciliationPromise = undefined;
  }
}

function countUtcTradeEntries(trades: any[], dateUTC = new Date().toISOString().slice(0, 10)) {
  return new Set(
    (Array.isArray(trades) ? trades : [])
      .filter((trade) => typeof trade?.openTime === "string" && trade.openTime.slice(0, 10) === dateUTC)
      .map((trade) => String(trade?.id || ""))
      .filter(Boolean)
  ).size;
}

function countUtcTradeEntriesBySymbol(
  trades: any[],
  dateUTC = new Date().toISOString().slice(0, 10)
) {
  const uniqueEntries = new Map<string, string>();
  for (const trade of Array.isArray(trades) ? trades : []) {
    if (typeof trade?.openTime !== "string" || trade.openTime.slice(0, 10) !== dateUTC) continue;
    const id = String(trade?.id || "");
    const symbol = cleanSymbol(trade?.instrument || trade?.symbol || "");
    if (id && symbol) uniqueEntries.set(id, symbol);
  }
  const counts: Record<string, number> = {};
  for (const symbol of uniqueEntries.values()) counts[symbol] = (counts[symbol] || 0) + 1;
  return counts;
}

function dailySymbolCapReached(count: number, maximum = MAX_DAILY_TRADES_PER_SYMBOL) {
  return Number.isFinite(count) && Number.isFinite(maximum) && maximum > 0 && count >= maximum;
}

function dailyLossCapReached(
  pnl: number | null | undefined,
  maximum = MAX_DAILY_LOSS,
  enabled = DAILY_LOSS_LIMIT_ENABLED
) {
  return enabled === true &&
    typeof pnl === "number" &&
    Number.isFinite(pnl) &&
    Number.isFinite(maximum) &&
    maximum > 0 &&
    pnl <= -maximum;
}

function rollingMinuteTradeCount(entryTimes = recentEntryTimes, now = Date.now()) {
  const cutoff = now - 60_000;
  const filtered = entryTimes.filter((value) =>
    Number.isFinite(value) && value > cutoff && value <= now + 5_000
  );
  if (entryTimes === recentEntryTimes) recentEntryTimes = filtered;
  return filtered.length;
}

function minuteTradeCapReached(
  entryTimes = recentEntryTimes,
  now = Date.now(),
  maximum = MAX_TRADES_PER_MINUTE
) {
  return rollingMinuteTradeCount(entryTimes, now) >= maximum;
}

function recentUtcEntryTimes(
  trades: any[],
  dateUTC = new Date().toISOString().slice(0, 10)
) {
  const unique = new Map<string, number>();
  for (const trade of Array.isArray(trades) ? trades : []) {
    if (typeof trade?.openTime !== "string" || trade.openTime.slice(0, 10) !== dateUTC) continue;
    const id = String(trade?.id || "");
    const openedAt = Date.parse(trade.openTime);
    if (id && Number.isFinite(openedAt)) unique.set(id, openedAt);
  }
  return [...unique.values()];
}

function symbolCooldownRemainingMs(
  symbol: string,
  closedTrades: Pick<BotTrade, "symbol" | "closedAt">[] = botState.closedTrades,
  now = Date.now()
) {
  if (SYMBOL_REENTRY_COOLDOWN_MS <= 0) return 0;
  const normalized = cleanSymbol(symbol);
  const latestClose = closedTrades
    .filter((trade) => cleanSymbol(trade.symbol) === normalized)
    .map((trade) => Date.parse(String(trade.closedAt || "")))
    .filter(Number.isFinite)
    .reduce((latest, value) => Math.max(latest, value), 0);
  if (!latestClose) return 0;
  return Math.max(0, SYMBOL_REENTRY_COOLDOWN_MS - (now - latestClose));
}

async function reconcileLiveTradesOnce() {
  try {
    const reconciliationDateUTC = new Date().toISOString().slice(0, 10);
    const [account, remoteOpenTrades, remoteOpenPositions, remoteClosedTrades, remotePendingOrders] = await Promise.all([
      oanda.getAccount(),
      oanda.getOpenTrades(),
      oanda.getOpenPositions(),
      oanda.getClosedTradesSince(reconciliationDateUTC, MAX_DAILY_TRADES),
      oanda.getPendingOrders()
    ]);
    if (!account?.currency || !Array.isArray(remoteOpenTrades) || !Array.isArray(remoteOpenPositions) ||
        !Array.isArray(remoteClosedTrades) || !Array.isArray(remotePendingOrders)) {
      throw new Error("OANDA_RECONCILIATION_UNAVAILABLE");
    }
    const tradeUnitsByInstrument = new Map<string, number>();
    for (const trade of remoteOpenTrades) {
      const instrument = cleanSymbol(trade?.instrument);
      const units = Number(trade?.currentUnits);
      if (!instrument || !Number.isFinite(units) || units === 0) {
        throw new Error("OANDA_OPEN_TRADE_UNITS_INVALID");
      }
      tradeUnitsByInstrument.set(instrument, (tradeUnitsByInstrument.get(instrument) || 0) + units);
    }
    const positionUnitsByInstrument = new Map<string, number>();
    for (const position of remoteOpenPositions) {
      const instrument = cleanSymbol(position?.instrument);
      const longUnits = Number(position?.long?.units || 0);
      const shortUnits = Number(position?.short?.units || 0);
      if (!instrument || !Number.isFinite(longUnits) || !Number.isFinite(shortUnits)) {
        throw new Error("OANDA_OPEN_POSITION_UNITS_INVALID");
      }
      const netUnits = longUnits + shortUnits;
      if (netUnits !== 0) positionUnitsByInstrument.set(instrument, netUnits);
    }
    const reconciliationInstruments = new Set([
      ...tradeUnitsByInstrument.keys(),
      ...positionUnitsByInstrument.keys()
    ]);
    for (const instrument of reconciliationInstruments) {
      const tradeUnits = tradeUnitsByInstrument.get(instrument);
      const positionUnits = positionUnitsByInstrument.get(instrument);
      if (tradeUnits === undefined || positionUnits === undefined || Math.abs(tradeUnits - positionUnits) > 1e-9) {
        throw new Error("OANDA_POSITION_TRADE_MISMATCH");
      }
    }

    const currency = String(account.currency).toUpperCase();
    botState.accountCurrency = currency;
    const previousById = new Map(
      [...botState.openTrades, ...botState.orphanTrades, ...botState.closedTrades]
        .filter((trade) => trade.oandaTradeId)
        .map((trade) => [String(trade.oandaTradeId), trade])
    );
    const remoteIds = new Set(remoteOpenTrades.map((trade: any) => String(trade.id)));
    const verifiedOpen = remoteOpenTrades.map((remote: any) =>
      mapVerifiedOandaTrade(remote, currency, previousById.get(String(remote.id)))
    );
    const newlyClosed: BotTrade[] = [];
    const orphans: BotTrade[] = [];

    const locallyTracked = [...botState.openTrades, ...botState.orphanTrades];
    for (const local of locallyTracked.filter((trade) => trade.oandaTradeId && !remoteIds.has(String(trade.oandaTradeId)))) {
      try {
        const verified = await oanda.getTrade(String(local.oandaTradeId));
        if (String(verified?.state || "").toUpperCase() === "CLOSED") {
          const realizedPL = optionalFinite(verified?.realizedPL);
          const closePrice = optionalFinite(verified?.averageClosePrice);
          const closedPips = closePrice
            ? (local.side === "BUY" ? closePrice - local.entryPrice : local.entryPrice - closePrice) * pipMultiplier(local.symbol)
            : local.pnlPips;
          const closedAt = typeof verified?.closeTime === "string" && Number.isFinite(Date.parse(verified.closeTime))
            ? verified.closeTime
            : undefined;
          newlyClosed.push({
            ...local,
            status: "CLOSED",
            source: "OANDA",
            verificationStatus: "VERIFIED",
            pnl: realizedPL,
            pnlPips: closedPips,
            pnlR: normalizedR(closedPips, local.riskPips),
            currentPrice: closePrice,
            closedAt,
            closeReason: local.closeReason
          });
        } else if (String(verified?.state || "").toUpperCase() === "OPEN") {
          verifiedOpen.push(mapVerifiedOandaTrade(verified, currency, local));
        } else {
          orphans.push({
            ...local,
            source: "LOCAL_ORPHAN",
            verificationStatus: "NOT_VERIFIED",
            pnl: undefined,
            reasoning: "LOCAL ORPHAN / NOT VERIFIED: non incluso nel P&L OANDA."
          });
        }
      } catch (_error) {
        orphans.push({
          ...local,
          source: "LOCAL_ORPHAN",
          verificationStatus: "NOT_VERIFIED",
          pnl: undefined,
          reasoning: "LOCAL ORPHAN / NOT VERIFIED: verifica OANDA non disponibile."
        });
      }
    }

    const closedById = new Map<string, BotTrade>();
    for (const remote of remoteClosedTrades) {
      const mapped = mapClosedOandaTrade(remote, currency, previousById.get(String(remote.id)));
      closedById.set(String(mapped.oandaTradeId), mapped);
    }
    for (const closed of newlyClosed) {
      closedById.set(String(closed.oandaTradeId), closed);
    }
    botState.closedTrades = [...closedById.values()]
      .sort((a, b) => String(b.closedAt || "").localeCompare(String(a.closedAt || "")))
      .slice(0, MAX_DAILY_TRADES);

    if (newlyClosed.length > 0) {
      newlyClosed.forEach((trade) => pushLog(
        `[${trade.symbol}] chiusura verificata OANDA | P&L ${Number.isFinite(trade.pnl) ? `${currency} ${Number(trade.pnl).toFixed(2)}` : "N/A"}`
      ));
    }
    botState.openTrades = verifiedOpen;
    botState.orphanTrades = orphans;
    botState.pendingOrders = remotePendingOrders.map((order: any) => {
      if (!order?.id || !order?.type) throw new Error("OANDA_PENDING_ORDER_FIELDS_INCOMPLETE");
      return {
        id: String(order.id),
        type: String(order.type),
        instrument: order.instrument ? cleanSymbol(order.instrument) : undefined,
        units: optionalFinite(order.units),
        price: optionalFinite(order.price),
        state: order.state ? String(order.state) : undefined,
        createTime: typeof order.createTime === "string" ? order.createTime : undefined,
        clientTag: order?.clientExtensions?.tag ? String(order.clientExtensions.tag) : undefined
      };
    });
    dailyCounterDate = reconciliationDateUTC;
    // The daily entry cap counts entries opened today. A position opened
    // yesterday and merely closed today must affect P&L, not consume a new slot.
    botState.dailyTradeCount = countUtcTradeEntries(
      [...remoteOpenTrades, ...remoteClosedTrades],
      dailyCounterDate
    );
    botState.dailyTradeCountBySymbol = countUtcTradeEntriesBySymbol(
      [...remoteOpenTrades, ...remoteClosedTrades],
      dailyCounterDate
    );
    recentEntryTimes = recentUtcEntryTimes(
      [...remoteOpenTrades, ...remoteClosedTrades],
      dailyCounterDate
    );
    rollingMinuteTradeCount();
    const todayVerified = [...verifiedOpen, ...botState.closedTrades].filter((trade) =>
      isToday(trade.openedAt) || isToday(trade.closedAt)
    );
    dailyRiskDataComplete = todayVerified.every((trade) =>
      Number.isFinite(trade.pnl) && trade.accountCurrency === currency
    );
    dailyRiskReason = dailyRiskDataComplete ? undefined : "OANDA_DAILY_PNL_INCOMPLETE";
    botState.oandaConnected = true;
    botState.oandaReason = undefined;
    botState.reconciliationStatus = "VERIFIED";
    botState.lastReconciledAt = new Date().toISOString();
    botState.lastUpdated = new Date().toISOString();
    emitState();
  } catch (error) {
    const staleOanda = botState.openTrades
      .filter((trade) => trade.source === "OANDA")
      .map((trade): BotTrade => ({
        ...trade,
        source: "LOCAL_ORPHAN",
        verificationStatus: "NOT_VERIFIED",
        pnl: undefined,
        reasoning: "LOCAL ORPHAN / NOT VERIFIED: riconciliazione OANDA fallita."
      }));
    const existingOrphans = botState.orphanTrades.filter((trade) =>
      !staleOanda.some((stale) => stale.oandaTradeId === trade.oandaTradeId)
    );
    botState.orphanTrades = [...staleOanda, ...existingOrphans];
    botState.openTrades = botState.openTrades.filter((trade) => trade.source !== "OANDA");
    botState.pendingOrders = [];
    botState.oandaConnected = false;
    botState.oandaReason = "reconciliation_failed";
    botState.reconciliationStatus = "FAILED";
    dailyRiskDataComplete = false;
    dailyRiskReason = "OANDA_RECONCILIATION_FAILED";
    pushLog("OANDA reconciliation failed: trade locali spostati in LOCAL ORPHAN / NOT VERIFIED");
  }
}

function buildShadowTrade(
  symbol: string,
  lane: PairedSignalSnapshot["main"],
  marketData: MarketData,
  pairedSignal: PairedSignalSnapshot,
  pairedWithTradeId: string
): BotTrade {
  const decision: TradingDecision = {
    action: lane.action,
    confidence: lane.confidence,
    reasoning: lane.reasoning,
    setupType: lane.setupType
  };
  const trade = buildTrade(symbol, decision, marketData, pairedSignal);
  const protection = laneProtectionPlan(
    symbol,
    trade.entryPrice,
    trade.side,
    lane.stopLossPrice,
    lane.takeProfitPrice
  );
  if (!protection) {
    throw new Error("PAPER_SHADOW_PROTECTIVE_LEVELS_INVALID");
  }
  return {
    ...trade,
    id: `SHADOW-${lane.variant}-${symbol}-${pairedSignal.pairId}`,
    source: "PAPER_SHADOW",
    strategyVariant: lane.variant,
    stopLoss: protection.stopLoss,
    takeProfit: protection.takeProfit,
    riskAmount: protection.riskAmount,
    rewardAmount: protection.rewardAmount,
    riskPips: protection.riskPips,
    rewardPips: protection.rewardPips,
    pnlR: normalizedR(trade.pnlPips, protection.riskPips),
    setupType: lane.setupType,
    reasoning: `${lane.reasoning}. PAPER SHADOW: nessun ordine OANDA, livelli protettivi della corsia preservati; SL ${protection.riskPips.toFixed(2)} pip / TP ${protection.rewardPips.toFixed(2)} pip inclusivo dello spread.`,
    verificationStatus: "NOT_VERIFIED",
    pairedWithTradeId
  };
}

function shadowLaneForPair(pair: PairedSignalSnapshot) {
  if (liveExecutionActive()) {
    return config.LIVE_EXECUTION_VARIANT === "MAIN" ? pair.inverse : pair.main;
  }
  return pair.inverse;
}

function closeShadowTradeAtMarket(index: number, marketData: MarketData, reason: "PAIR CLOSED" | "TP HIT" | "SL HIT") {
  const trade = botState.shadowOpenTrades[index];
  if (!trade) return;
  const exitPrice = paperExitPrice(trade.side, marketData);
  const multiplier = pipMultiplier(trade.symbol);
  const pnlPips = trade.side === "BUY"
    ? (exitPrice - trade.entryPrice) * multiplier
    : (trade.entryPrice - exitPrice) * multiplier;
  const closed: BotTrade = {
    ...trade,
    status: "CLOSED",
    currentPrice: exitPrice,
    pnl: calculatePaperPnl(trade.symbol, trade.side, trade.entryPrice, exitPrice),
    pnlPips,
    pnlR: normalizedR(pnlPips, trade.riskPips),
    closedAt: new Date().toISOString(),
    closeReason: reason
  };
  botState.shadowOpenTrades = botState.shadowOpenTrades.filter((_, itemIndex) => itemIndex !== index);
  botState.shadowClosedTrades = [closed, ...botState.shadowClosedTrades].slice(0, 100);
  pushLog(`[${trade.symbol}] ${trade.strategyVariant} PAPER SHADOW ${reason} | ${trade.pnlCurrency || "quote currency"} ${Number(closed.pnl).toFixed(2)} | no OANDA order`);
}

function openPairedShadowTrade(
  symbol: string,
  pair: PairedSignalSnapshot,
  marketData: MarketData,
  cycle: { shadowOpened: number },
  pairedWithTradeId: string
) {
  if (liveModeConfigured() && !liveExecutionActive()) return;
  const lane = shadowLaneForPair(pair);
  const existingIndex = botState.shadowOpenTrades.findIndex((trade) => cleanSymbol(trade.symbol) === cleanSymbol(symbol));

  if (lane.action === "HOLD" || lane.confidence < MIN_CONFIDENCE) return;
  if (!laneProtectionPlan(symbol, paperExecutablePrice(lane.action, marketData), lane.action, lane.stopLossPrice, lane.takeProfitPrice)) {
    pushLog(`[${symbol}] ${lane.variant} PAPER SHADOW skipped: strict protective levels are not directional after spread`);
    return;
  }
  if (existingIndex >= 0) closeShadowTradeAtMarket(existingIndex, marketData, "PAIR CLOSED");
  if (cycle.shadowOpened >= MAX_NEW_TRADES_PER_CYCLE || botState.shadowOpenTrades.length >= MAX_OPEN_POSITIONS) return;

  const shadow = buildShadowTrade(symbol, lane, marketData, pair, pairedWithTradeId);
  botState.shadowOpenTrades = [shadow, ...botState.shadowOpenTrades].slice(0, MAX_OPEN_POSITIONS);
  botState.shadowTradeCount += 1;
  cycle.shadowOpened += 1;
  pushLog(`[${symbol}] ${lane.variant} PAPER SHADOW ${lane.action} paired with ${pairedWithTradeId} | same signal ${pair.pairId} | no OANDA order`);
}

async function closeVerifiedOandaTrade(
  trade: BotTrade,
  closeReason: NonNullable<BotTrade["closeReason"]> = "SIGNAL EXIT"
) {
  if (!canAutoCloseOandaTrade(trade, config.LIVE_EXECUTION_VARIANT)) {
    pushLog(`[${trade.symbol}] chiusura bloccata: trade OANDA non attribuito alla corsia Rohato attiva`);
    return false;
  }
  if (!trade.oandaTradeId) {
    pushLog(`[${trade.symbol}] chiusura bloccata: OANDA trade ID assente`);
    return false;
  }

  try {
    await oanda.closeTrade(trade.oandaTradeId, "ALL");
    const verified = await oanda.getTrade(trade.oandaTradeId);
    if (String(verified?.state || "").toUpperCase() !== "CLOSED") {
      pushLog(`[${trade.symbol}] chiusura non verificata: trade mantenuto aperto`);
      return false;
    }
    const realizedPL = optionalFinite(verified?.realizedPL);
    const closePrice = optionalFinite(verified?.averageClosePrice);
    const closeTime = typeof verified?.closeTime === "string" && Number.isFinite(Date.parse(verified.closeTime))
      ? verified.closeTime
      : undefined;
    const multiplier = pipMultiplier(trade.symbol);
    const pnlPips = closePrice
      ? (trade.side === "BUY" ? closePrice - trade.entryPrice : trade.entryPrice - closePrice) * multiplier
      : trade.pnlPips;
    const closed: BotTrade = {
      ...trade,
      status: "CLOSED",
      source: "OANDA",
      verificationStatus: "VERIFIED",
      pnl: realizedPL,
      pnlPips,
      pnlR: normalizedR(pnlPips, trade.riskPips),
      currentPrice: closePrice,
      closedAt: closeTime,
      closeReason
    };
    botState.openTrades = botState.openTrades.filter((item) => item.oandaTradeId !== trade.oandaTradeId);
    botState.closedTrades = [closed, ...botState.closedTrades].slice(0, MAX_DAILY_TRADES);
    pushLog(`[${trade.symbol}] ${closeReason} verificata da OANDA | P&L ${Number.isFinite(closed.pnl) ? `${trade.accountCurrency || "N/A"} ${Number(closed.pnl).toFixed(2)}` : "N/A"}`);
    return true;
  } catch (error: any) {
    const reason = error?.response?.data?.errorCode || error?.message || "OANDA_CLOSE_FAILED";
    pushLog(`[${trade.symbol}] chiusura OANDA rifiutata: ${String(reason).slice(0, 120)}`);
    return false;
  }
}

async function scanSymbol(symbol: string, cycle: { opened: number; shadowOpened: number }, generation: number) {
  try {
    const analytics = getAnalytics();
    if (!isGold(symbol) && liveModeConfigured() && (!dailyRiskDataComplete || analytics.pnlComplete !== true)) {
      pushLog(`[${symbol}] skipped: OANDA daily risk data incomplete`);
      return;
    }
    if (!isGold(symbol) && liveExecutionActive() && dailyLossCapReached(analytics.pnlToday)) {
      pushLog(`[${symbol}] skipped: daily loss guard active`);
      return;
    }

    const marketData = await generateMarketData(symbol);
    botState.dataSource = "OANDA MARKET DATA";
    botState.oandaConnected = true;
    botState.oandaReason = undefined;
    const session = getSession();
    const killzone = isKillzone();

    const enrichedMarketData = {
      ...marketData,
      session,
      killzone
    };

      // cache latest market data for this symbol so frontend can read it
      botState.marketData = botState.marketData || {};
      botState.marketData[symbol] = enrichedMarketData;

    const decision = await getScalpingSignal(enrichedMarketData);
    const rankedSignals = rankSignals([decision]);
    const rankedDecision = rankedSignals[0] ?? decision;
    const evaluatedAt = new Date().toISOString();
    const signalId = `SIG-${cleanSymbol(symbol)}-${evaluatedAt.replace(/[^0-9]/g, "")}`;
    const bid = Number(enrichedMarketData.bid);
    const ask = Number(enrichedMarketData.ask);
    const pairedSignal = createPairedSignalSnapshot({
      signalId,
      symbol,
      evaluatedAt,
      market: {
        source: "OANDA",
        instrument: symbol,
        time: String(enrichedMarketData.priceTime || ""),
        bid,
        ask,
        mid: Number.isFinite(bid) && Number.isFinite(ask) ? (bid + ask) / 2 : Number(enrichedMarketData.closePrice),
        tradeable: enrichedMarketData.tradeable === true
      },
      analysis: {
        candleTime: String(enrichedMarketData.candleTime || ""),
        timeframe: enrichedMarketData.timeframe,
        ema20: Number(enrichedMarketData.ema20),
        ema50: Number(enrichedMarketData.ema50),
        ema200: Number(enrichedMarketData.ema200),
        rsi: Number(enrichedMarketData.rsi),
        spread: Number(enrichedMarketData.spread),
        structureBias: enrichedMarketData.structureBias,
        trend: enrichedMarketData.trend,
        macdHistogram: enrichedMarketData.macdHistogram,
        atr: enrichedMarketData.atr,
        volatility: enrichedMarketData.volatility,
        volumeRatio: enrichedMarketData.volumeRatio,
        breakOfStructure: enrichedMarketData.breakOfStructure,
        changeOfCharacter: enrichedMarketData.changeOfCharacter,
        liquiditySweep: enrichedMarketData.liquiditySweep,
        fairValueGap: enrichedMarketData.fairValueGap,
        equalHigh: enrichedMarketData.equalHigh,
        equalLow: enrichedMarketData.equalLow,
        supportLevels: enrichedMarketData.supportLevels,
        resistanceLevels: enrichedMarketData.resistanceLevels,
        structureSource: enrichedMarketData.structureSource,
        candleCount: enrichedMarketData.candleCount
      },
      mainDecision: rankedDecision,
      tradingMode: config.TRADING_MODE,
      liveExecutionVariant: config.LIVE_EXECUTION_VARIANT,
      executionGateVerified: liveExecutionActive(),
      minimumConfidence: MIN_CONFIDENCE,
      accountCashRisk: Number(config.NORMAL_STOP_LOSS_ACCOUNT),
      accountCashReward: Number(config.NORMAL_TAKE_PROFIT_ACCOUNT),
      accountTargetCurrency: String(config.ACCOUNT_TARGET_CURRENCY || "")
    });
    if (isGold(symbol)) {
      pairedSignal.executionBlockedReason = "XAU_ANALYSIS_ONLY_VALIDATION_PENDING";
      pairedSignal.main.executionState = "NOT_ELIGIBLE";
      pairedSignal.main.executionReason = "XAU_ANALYSIS_ONLY";
      pairedSignal.inverse.executionState = "NOT_ELIGIBLE";
      pairedSignal.inverse.executionReason = "XAU_ANALYSIS_ONLY";
    }
    const selectedLane = config.LIVE_EXECUTION_VARIANT === "INVERSE"
      ? pairedSignal.inverse
      : pairedSignal.main;
    const decisionForExecution: TradingDecision = liveExecutionActive()
      ? {
          ...rankedDecision,
          action: selectedLane.action,
          reasoning: selectedLane.reasoning,
          setupType: selectedLane.setupType
        }
      : rankedDecision;

    botState.signalsAnalyzed += 1;
    botState.currentSymbol = symbol;
    // Publish the same final action that the configured Practice lane uses.
    // Every indicator/setup first produces one MAIN decision, then INVERSE
    // flips that result exactly once. XAUUSD remains analysis-only.
    const publishInverseDecision = config.LIVE_EXECUTION_VARIANT === "INVERSE" &&
      !isGold(symbol) && liveModeConfigured();
    const publishedDecision = publishInverseDecision
      ? decisionForExecution
      : rankedDecision;
    botState.currentAction = publishedDecision.action;
    botState.currentConfidence = rankedDecision.confidence;
    botState.currentReasoning = publishedDecision.reasoning;
    botState.lastSignals = botState.lastSignals || {};
    botState.lastSignals[symbol] = {
      // Preserve the unmodified indicator result for the MAIN audit trail.
      // The public current decision and OANDA order use the INVERSE lane.
      ...rankedDecision,
      scannedAt: evaluatedAt
    };
    botState.pairedSignals = botState.pairedSignals || {};
    botState.pairedSignals[symbol] = pairedSignal;
    botState.latestPairedSignal = pairedSignal;
    botState.currentPrice = pairedSignal.market.mid;
    botState.entryPrice = publishedDecision.action === "HOLD"
      ? undefined
      : publishInverseDecision
        ? selectedLane.entryPrice ?? pairedSignal.market.mid
        : rankedDecision.entryPrice ?? pairedSignal.market.mid;
    const cash = cashRules(symbol);
    const paperPlan = rankedDecision.action === "HOLD"
      ? undefined
      : fixedPipPlan(symbol, pairedSignal.market.mid, rankedDecision.action);
    botState.stopLoss = rankedDecision.action === "HOLD"
      ? undefined
      : isGold(symbol)
      ? rankedDecision.stopLossPrice
      : liveModeConfigured()
      ? undefined
      : paperPlan?.stopLoss;
    botState.takeProfit = rankedDecision.action === "HOLD"
      ? undefined
      : isGold(symbol)
      ? rankedDecision.structuralTargets?.[0]
      : liveModeConfigured()
      ? undefined
      : paperPlan?.takeProfit;
    botState.riskAmount = isGold(symbol) ? undefined : cash.riskAmount;
    botState.rewardAmount = isGold(symbol) ? undefined : cash.rewardAmount;
    botState.profitLoss = undefined;
    botState.session = session;
    botState.killzone = killzone;
    botState.lastUpdated = new Date().toISOString();

    if (!botState.isRunning || generation !== runGeneration) {
      pushLog(`[${symbol}] decision recorded but execution skipped: bot stopped`);
      return;
    }

    if (!pairedSignal.marketValid) {
      botState.signalsDiscarded += 1;
      pushLog(`[${symbol}] PAPER/OANDA signal blocked: ${pairedSignal.marketValidationReason}`);
      return;
    }

    if (isGold(symbol)) {
      let intelligence: MultiTimeframeIntelligence;
      try {
        intelligence = await loadMultiTimeframeIntelligence(oanda, symbol);
      } catch (_error) {
        intelligence = {
          symbol: "XAUUSD",
          evaluatedAt,
          source: "OANDA",
          frames: [],
          availableFrames: 0,
          consensus: "HOLD",
          reasoning: "Dati multi-timeframe OANDA non disponibili."
        };
      }
      const candidate = buildXauSignalCandidate({
        signalId: pairedSignal.pairId,
        evaluatedAt,
        decision: rankedDecision,
        market: enrichedMarketData,
        intelligence
      });
      xauSignalLab.observeCandidate(candidate);
      const reviewEligibility = xauSignalLab.canRequestAi(candidate, evaluatedAt);
      if (!reviewEligibility.allowed) {
        xauSignalLab.setRuntimeBlocker(candidate, reviewEligibility.reason);
        if (rankedDecision.action !== "HOLD") botState.signalsDiscarded += 1;
        pushLog(
          `[${symbol}] SIGNAL ONLY in attesa: ${reviewEligibility.reason || candidate.blocker || "GATES_NOT_PASSED"} | nessun ordine OANDA`
        );
        emitState();
        return;
      }

      const aiResult = await confirmSetupWithAi({
        signalId: pairedSignal.pairId,
        symbol,
        action: candidate.side as "BUY" | "SELL",
        setupScore: candidate.setupScore,
        scoreBreakdown: rankedDecision.scoreBreakdown as Record<string, number> | undefined,
        snapshotAt: candidate.evaluatedAt,
        priceTime: candidate.priceTime,
        bid: pairedSignal.market.bid,
        ask: pairedSignal.market.ask,
        spread: Number(enrichedMarketData.spread),
        timeframe: candidate.timeframe,
        trend: intelligence.consensus,
        structure: enrichedMarketData.structureBias,
        session,
        riskStatus: "PASS",
        reasoning: candidate.reasoning,
        analysisOnly: true,
        multiTimeframe: intelligence.frames.map((frame) => ({
          timeframe: frame.timeframe,
          direction: frame.direction,
          alignmentScore: frame.alignmentScore,
          structure: frame.structure,
          bos: frame.bos,
          rejection: frame.rejection,
          volumeRatio: frame.volumeRatio
        })),
        strategyGates: candidate.gates
      }, {
        provider: config.AI_PROVIDER,
        required: true,
        apiKey: config.AI_PROVIDER === "OPENAI" ? config.OPENAI_API_KEY : config.GEMINI_API_KEY,
        model: config.AI_PROVIDER === "OPENAI" ? config.OPENAI_MODEL : config.GEMINI_MODEL,
        minimumScore: MINIMUM_SCORE_FOR_XAU_AI,
        timeoutMs: 10000
      });
      if (!botState.isRunning || generation !== runGeneration) {
        xauSignalLab.setRuntimeBlocker(candidate, "BOT_STOPPED_BEFORE_AI_RESULT");
        return;
      }
      const openedSignal = xauSignalLab.recordAiReview(candidate, aiResult);
      if (openedSignal) {
        pushLog(
          `[${symbol}] AI ${aiResult.status}: segnale ${openedSignal.side} aperto a ${openedSignal.entryPrice.toFixed(3)} | SL ${openedSignal.stopLoss.toFixed(3)} | ${openedSignal.takeProfits.length} target reali | ZERO ordini`
        );
      } else {
        botState.signalsDiscarded += 1;
        pushLog(`[${symbol}] SIGNAL ONLY AI ${aiResult.status}: ${aiResult.reason} | nessun ordine OANDA`);
      }
      emitState();
      return;
    }

    const cooldownRemaining = symbolCooldownRemainingMs(symbol);
    const symbolDailyTradeCount = botState.dailyTradeCountBySymbol[cleanSymbol(symbol)] || 0;

    if (rankedDecision.action === "HOLD" || rankedDecision.confidence < MIN_CONFIDENCE) {
      botState.signalsDiscarded += 1;

      // PROTECTED_EXIT_ONLY: a later HOLD or weaker signal never closes a
      // verified position. Broker-side SL/TP remain authoritative.

      pushLog(
        `[${symbol}] ${rankedDecision.action} | setup score ${rankedDecision.confidence}/100 | ${rankedDecision.reasoning}`
      );
    } else if (liveModeConfigured() && !liveExecutionActive()) {
      botState.signalsDiscarded += 1;
      const reason = !config.OANDA_ORDER_EXECUTION_ENABLED || !config.LIVE_TRADING_ENABLED
        ? "OANDA_ORDER_EXECUTION_ENABLED and LIVE_TRADING_ENABLED must both be true"
        : !config.OANDA_ENVIRONMENT_VALID
          ? "OANDA_ENVIRONMENT does not match TRADING_MODE"
          : !config.LIVE_EXECUTION_VARIANT_VALID
            ? "LIVE_EXECUTION_VARIANT must be exactly MAIN or INVERSE"
            : config.AI_CONFIRMATION_REQUIRED === true &&
              (!["GEMINI", "OPENAI"].includes(String(config.AI_PROVIDER)) ||
                !(config.GEMINI_API_KEY || config.OPENAI_API_KEY))
              ? "AI confirmation is required but the selected provider is not configured"
            : "OANDA safety gates are not verified";
      pushLog(`[${symbol}] OANDA execution blocked: ${reason}`);
    } else if (liveExecutionActive() && pairedSignal.executionBlockedReason) {
      botState.signalsDiscarded += 1;
      pushLog(`[${symbol}] OANDA execution blocked: ${pairedSignal.executionBlockedReason}`);
    } else if (liveExecutionActive() && hasUnverifiedOandaExposure()) {
      botState.signalsDiscarded += 1;
      updatePairExecution(pairedSignal, "SKIPPED", "OANDA_EXTERNAL_OR_UNVERIFIED_TRADE_OPEN");
      pushLog(`[${symbol}] OANDA execution skipped: external or unverified OANDA exposure is still open`);
    } else if (hasOpenTradeForSymbol(symbol)) {
      botState.signalsDiscarded += 1;
      if (liveExecutionActive()) updatePairExecution(pairedSignal, "SKIPPED", "POSITION_ALREADY_OPEN");
      pushLog(`[${symbol}] trade skipped: one open position per symbol is already active`);
    } else if (minuteTradeCapReached()) {
      botState.signalsDiscarded += 1;
      if (liveExecutionActive()) updatePairExecution(pairedSignal, "SKIPPED", "ROLLING_MINUTE_TRADE_CAP_REACHED");
      pushLog(`[${symbol}] valid signal blocked: rolling minute cap ${MAX_TRADES_PER_MINUTE} reached`);
    } else if (cycle.opened >= MAX_NEW_TRADES_PER_CYCLE) {
      botState.signalsDiscarded += 1;
      if (liveExecutionActive()) updatePairExecution(pairedSignal, "SKIPPED", "CYCLE_CAP_REACHED");
      pushLog(`[${symbol}] valid signal queued: cycle cap ${MAX_NEW_TRADES_PER_CYCLE} reached`);
    } else if (dailySymbolCapReached(symbolDailyTradeCount)) {
      botState.signalsDiscarded += 1;
      if (liveExecutionActive()) updatePairExecution(pairedSignal, "SKIPPED", "DAILY_SYMBOL_TRADE_CAP_REACHED");
      pushLog(`[${symbol}] valid signal blocked: daily symbol cap ${MAX_DAILY_TRADES_PER_SYMBOL} reached`);
    } else if (cooldownRemaining > 0) {
      botState.signalsDiscarded += 1;
      if (liveExecutionActive()) updatePairExecution(pairedSignal, "SKIPPED", "SYMBOL_REENTRY_COOLDOWN");
      pushLog(`[${symbol}] valid signal waiting: re-entry cooldown ${Math.ceil(cooldownRemaining / 60000)}m remaining`);
    } else if (canOpenTrade(botState.dailyTradeCount, botState.openTrades.length)) {
      if (liveExecutionActive()) {
        if (config.AI_CONFIRMATION_REQUIRED === true) {
          const aiResult = await confirmSetupWithAi({
            signalId: pairedSignal.pairId,
            symbol,
            // Confirm the actual indicator setup first. The configured
            // MIRROR lane flips its approved final action exactly once below.
            action: rankedDecision.action as "BUY" | "SELL",
            setupScore: Number(rankedDecision.confidence),
            scoreBreakdown: (rankedDecision as TradingDecision & {
              scoreBreakdown?: Record<string, number>;
            }).scoreBreakdown,
            snapshotAt: pairedSignal.evaluatedAt,
            priceTime: pairedSignal.market.time,
            bid: pairedSignal.market.bid,
            ask: pairedSignal.market.ask,
            spread: Number(enrichedMarketData.spread),
            timeframe: String(enrichedMarketData.timeframe || config.TIMEFRAME),
            trend: enrichedMarketData.trend,
            structure: enrichedMarketData.structureBias,
            session,
            riskStatus: "PASS",
            reasoning: rankedDecision.reasoning
          }, {
            provider: config.AI_PROVIDER,
            required: true,
            apiKey: config.GEMINI_API_KEY,
            model: config.GEMINI_MODEL,
            minimumScore: Number(config.AI_MIN_CONFIDENCE),
            timeoutMs: 8000
          });
          botState.aiStatus = aiResult.status;
          botState.lastAiReason = aiResult.reason;
          botState.lastAiCheckedAt = aiResult.checkedAt;
          botState.lastAiSignalId = pairedSignal.pairId;
          if (!aiResult.approved) {
            const aiReason = `AI_${aiResult.status}: ${aiResult.reason}`;
            botState.signalsDiscarded += 1;
            updatePairExecution(pairedSignal, "SKIPPED", aiReason);
            pushLog(`[${symbol}] OANDA execution skipped: ${aiReason}`);
            emitState();
            return;
          }
        }
        if (!botState.isRunning || generation !== runGeneration) {
          updatePairExecution(pairedSignal, "SKIPPED", "BOT_STOPPED_BEFORE_SUBMISSION");
          pushLog(`[${symbol}] order skipped: bot stopped before submission`);
          return;
        }
        updatePairExecution(pairedSignal, "SUBMITTING");
        botState.lastOrderAttemptAt = new Date().toISOString();
        botState.lastOrderStatus = "SUBMITTING";
        botState.lastOrderReason = undefined;
        botState.lastOandaOrderId = undefined;
        botState.lastOandaTradeId = undefined;
        emitState();
        const result = await executeVerifiedMarketOrder({
          oanda,
          symbol,
          side: decisionForExecution.action as "BUY" | "SELL",
          units: tradeUnits(symbol),
          riskAmount: cash.riskAmount,
          rewardAmount: cash.rewardAmount,
          protectionMode: "ACCOUNT_CASH",
          targetAccountCurrency: String(config.ACCOUNT_TARGET_CURRENCY || ""),
          strategyVariant: config.LIVE_EXECUTION_VARIANT,
          signalId: pairedSignal.pairId,
          signalAt: pairedSignal.evaluatedAt
        });
        if (result.status === "OPENED") {
          const verifiedProtection = laneProtectionPlan(
            symbol,
            result.trade.entryPrice,
            result.trade.side,
            result.trade.stopLoss,
            result.trade.takeProfit
          );
          if (!verifiedProtection) {
            const emergencyTrade: BotTrade = {
              id: `OANDA-${result.trade.oandaTradeId}`,
              ...result.trade,
              reasoning: "Verified protective levels became non-directional after fill; fail-closed emergency exit.",
              status: "OPEN",
              verificationStatus: "VERIFIED",
              managedByBot: true
            };
            const exposureClosed = await closeVerifiedOandaTrade(
              emergencyTrade,
              "POST-FILL RECONCILIATION FAILURE"
            );
            const reason = exposureClosed
              ? "VERIFIED_PROTECTIVE_LEVELS_NOT_DIRECTIONAL_EXPOSURE_CLOSED"
              : "VERIFIED_PROTECTIVE_LEVELS_NOT_DIRECTIONAL_EMERGENCY_CLOSE_NOT_VERIFIED";
            botState.signalsDiscarded += 1;
            updatePairExecution(pairedSignal, "REJECTED", reason);
            botState.lastOrderStatus = "REJECTED";
            botState.lastOrderReason = reason;
            pushLog(`[${symbol}] ${reason}`);
            return;
          }
          const provisionalTrade: BotTrade = {
            id: `OANDA-${result.trade.oandaTradeId}`,
            ...result.trade,
            pnl: undefined,
            pnlPips: undefined,
            setupType: decisionForExecution.setupType,
            confidence: decisionForExecution.confidence,
            riskPips: verifiedProtection.riskPips,
            rewardPips: verifiedProtection.rewardPips,
            reasoning: `${decisionForExecution.reasoning}. Ordine ${config.LIVE_EXECUTION_VARIANT} verificato tramite OANDA ${config.OANDA_ENVIRONMENT}.`,
            status: "OPEN",
            verificationStatus: "VERIFIED",
            managedByBot: true
          };
          botState.openTrades = [provisionalTrade, ...botState.openTrades];
          await reconcileLiveTrades();
          const trade = botState.openTrades.find((item) =>
            item.source === "OANDA" &&
            item.verificationStatus === "VERIFIED" &&
            item.oandaTradeId === provisionalTrade.oandaTradeId
          );
          if (!trade) {
            const exposureClosed = await closeVerifiedOandaTrade(
              provisionalTrade,
              "POST-FILL RECONCILIATION FAILURE"
            );
            if (exposureClosed) {
              botState.orphanTrades = botState.orphanTrades.filter(
                (item) => item.oandaTradeId !== provisionalTrade.oandaTradeId
              );
            }
            const reason = exposureClosed
              ? "OANDA_POST_FILL_RECONCILIATION_FAILED_EXPOSURE_CLOSED"
              : "OANDA_POST_FILL_RECONCILIATION_FAILED_EMERGENCY_CLOSE_NOT_VERIFIED";
            botState.signalsDiscarded += 1;
            updatePairExecution(pairedSignal, "REJECTED", reason);
            botState.lastOrderStatus = "REJECTED";
            botState.lastOrderReason = reason;
            pushLog(`[${symbol}] ${reason}: posizione non mostrata come OANDA aperta`);
            return;
          }
          cycle.opened += 1;
          botState.accountCurrency = trade.accountCurrency;
          botState.entryPrice = trade.entryPrice;
          botState.stopLoss = trade.stopLoss;
          botState.takeProfit = trade.takeProfit;
          syncPairProtectionWithVerifiedTrade(pairedSignal, trade, config.LIVE_EXECUTION_VARIANT);
          updatePairExecution(pairedSignal, "OPEN_VERIFIED", undefined, {
            orderId: trade.oandaOrderId,
            tradeId: trade.oandaTradeId
          });
          botState.lastOrderStatus = "OPEN_VERIFIED";
          botState.lastOandaOrderId = trade.oandaOrderId;
          botState.lastOandaTradeId = trade.oandaTradeId;
          openPairedShadowTrade(
            symbol,
            pairedSignal,
            enrichedMarketData,
            cycle,
            `OANDA-${trade.oandaTradeId}`
          );
          pushLog(`[${symbol}] OANDA ${config.LIVE_EXECUTION_VARIANT} OPEN VERIFIED | ${trade.side} ${trade.units} | trade ID ${trade.oandaTradeId}`);
        } else {
          botState.signalsDiscarded += 1;
          updatePairExecution(pairedSignal, result.status, result.reason);
          botState.lastOrderStatus = result.status;
          botState.lastOrderReason = result.reason;
          pushLog(`[${symbol}] ${result.status}: ${result.reason}`);
        }
      } else {
        const trade = buildTrade(symbol, rankedDecision, enrichedMarketData, pairedSignal);
        botState.dailyTradeCount += 1;
        recentEntryTimes.push(Date.now());
        const normalizedSymbol = cleanSymbol(symbol);
        botState.dailyTradeCountBySymbol[normalizedSymbol] =
          (botState.dailyTradeCountBySymbol[normalizedSymbol] || 0) + 1;
        cycle.opened += 1;
        botState.openTrades = [trade, ...botState.openTrades].slice(0, MAX_OPEN_POSITIONS);
        openPairedShadowTrade(symbol, pairedSignal, enrichedMarketData, cycle, trade.id);
        pushLog(
          `[${symbol}] PAPER ${rankedDecision.action} | setup score ${rankedDecision.confidence}/100 | ${rankedDecision.reasoning}`
        );
      }
    } else {
      if (liveExecutionActive()) updatePairExecution(pairedSignal, "SKIPPED", "RISK_CAP_ACTIVE");
      pushLog(`[${symbol}] trade skipped due to risk caps`);
    }

    pushLog(`[${symbol}] pair ${pairedSignal.pairId} | MAIN ${pairedSignal.main.action} | INVERSE ${pairedSignal.inverse.action} | same OANDA quote ${pairedSignal.market.time || "N/A"}`);

    emitState();
  } catch (error) {
    console.error(`Error scanning ${symbol}`, error);
    botState.dataSource = "OANDA_UNAVAILABLE";
    botState.oandaConnected = false;
    botState.signalsDiscarded += 1;
    pushLog(`[${symbol}] OANDA data unavailable: no fake price used`);
    emitState();
  }
}

async function scanAllSymbols() {
  if (!botState.isRunning || scanInProgress) {
    if (scanInProgress) pushLog("Market scan skipped: previous fast cycle is still running");
    return;
  }

  scanInProgress = true;
  const generation = runGeneration;
  const cycle = { opened: 0, shadowOpened: 0, checked: 0 };
  pushLog(`Starting market scan: 15 FX + XAUUSD | maximum ${MAX_NEW_TRADES_PER_CYCLE} valid new entries`);

  try {
    const connection = await oanda.getConnectionStatus();
    botState.oandaConnected = Boolean(connection?.connected);
    botState.oandaReason = connection?.reason;
    botState.accountCurrency = connection?.currency ? String(connection.currency).toUpperCase() : undefined;
    if (!connection?.connected) {
      botState.dataSource = "OANDA_UNAVAILABLE";
      botState.priceFeedStatus = "DISCONNECTED";
      botState.priceCoverage = 0;
      pushLog(`Market scan blocked: OANDA ${connection?.reason || "DISCONNECTED"}`);
      emitState();
      return;
    }
    if (liveModeConfigured()) {
      await reconcileLiveTrades();
      if (botState.reconciliationStatus !== "VERIFIED" || !botState.oandaConnected || !dailyRiskDataComplete) {
        pushLog("Market scan blocked: OANDA reconciliation or daily risk state is not verified");
        emitState();
        return;
      }
    }
    for (const symbol of SYMBOLS) {
      if (!botState.isRunning || generation !== runGeneration) {
        pushLog("Market scan cancelled: bot stopped");
        break;
      }
      await scanSymbol(symbol, cycle, generation);
      cycle.checked += 1;
    }
    const executionLabel = liveExecutionActive() ? "OANDA" : liveModeConfigured() ? "BLOCKED" : "PAPER";
    pushLog(`Market scan complete: ${cycle.checked}/${SYMBOLS.length} instruments checked, ${cycle.opened} new ${executionLabel} trades, ${cycle.shadowOpened} PAPER SHADOW trades`);
  } finally {
    scanInProgress = false;
  }
}

async function monitorShadowTrades() {
  if (botState.shadowOpenTrades.length === 0) return;
  const stillOpen: BotTrade[] = [];
  const justClosed: BotTrade[] = [];

  for (const trade of botState.shadowOpenTrades) {
    const quote = botState.livePrices?.[cleanSymbol(trade.symbol)];
    const currentPrice = shadowExecutableExitPrice(trade.side, quote);
    if (!quote || currentPrice === undefined) {
      stillOpen.push(trade);
      continue;
    }

    const hitTakeProfit = trade.takeProfit
      ? trade.side === "BUY" ? currentPrice >= trade.takeProfit : currentPrice <= trade.takeProfit
      : false;
    const hitStopLoss = trade.stopLoss
      ? trade.side === "BUY" ? currentPrice <= trade.stopLoss : currentPrice >= trade.stopLoss
      : false;
    const multiplier = pipMultiplier(trade.symbol);
    const updated: BotTrade = {
      ...trade,
      currentPrice,
      priceTime: quote.time,
      pnl: calculatePaperPnl(trade.symbol, trade.side, trade.entryPrice, currentPrice),
      pnlPips: trade.side === "BUY"
        ? (currentPrice - trade.entryPrice) * multiplier
        : (trade.entryPrice - currentPrice) * multiplier
    };
    updated.pnlR = normalizedR(updated.pnlPips, trade.riskPips);

    if (hitTakeProfit || hitStopLoss) {
      justClosed.push({
        ...updated,
        status: "CLOSED",
        closedAt: new Date().toISOString(),
        closeReason: hitTakeProfit ? "TP HIT" : "SL HIT"
      });
    } else {
      stillOpen.push(updated);
    }
  }

  botState.shadowOpenTrades = stillOpen;
  if (justClosed.length > 0) {
    botState.shadowClosedTrades = [...justClosed.reverse(), ...botState.shadowClosedTrades].slice(0, 100);
    justClosed.forEach((trade) => pushLog(
      `[${trade.symbol}] ${trade.strategyVariant} PAPER SHADOW ${trade.closeReason} | ${trade.pnlCurrency || "quote currency"} ${Number(trade.pnl).toFixed(2)} | no OANDA order`
    ));
  }
}

async function monitorTrades() {
  if (liveModeConfigured()) {
    await reconcileLiveTrades();
  }

  if (!liveModeConfigured() && botState.openTrades.length > 0) {
    const stillOpen: BotTrade[] = [];
    const justClosed: BotTrade[] = [];

    for (const trade of botState.openTrades) {
      const multiplier = pipMultiplier(trade.symbol);
      const priceData = await oanda.getPrice(trade.symbol);
      const quote = {
        bid: priceData?.bids?.[0]?.price ?? priceData?.closeoutBid,
        ask: priceData?.asks?.[0]?.price ?? priceData?.closeoutAsk,
        time: priceData?.time,
        tradeable: priceData?.tradeable === true && String(priceData?.status || "").toLowerCase() === "tradeable"
      };
      const currentPrice = Number(trade.side === "SELL"
        ? quote.ask
        : quote.bid);

      if (!isFreshTradeableQuote(quote) || !Number.isFinite(currentPrice) || currentPrice <= 0) {
        stillOpen.push(trade);
        pushLog(`[${trade.symbol}] open trade not updated: OANDA price unavailable`);
        continue;
      }

      const hitTakeProfit = trade.takeProfit
        ? trade.side === "BUY"
          ? currentPrice >= trade.takeProfit
          : currentPrice <= trade.takeProfit
        : false;
      const hitStopLoss = trade.stopLoss
        ? trade.side === "BUY"
          ? currentPrice <= trade.stopLoss
          : currentPrice >= trade.stopLoss
        : false;
      const fillPrice = currentPrice;
      const pnl = calculatePaperPnl(trade.symbol, trade.side, trade.entryPrice, fillPrice);

      const updatedTrade: BotTrade = {
        ...trade,
        currentPrice: fillPrice,
        pnl,
        pnlPips: trade.side === "BUY"
          ? (fillPrice - trade.entryPrice) * multiplier
          : (trade.entryPrice - fillPrice) * multiplier
      };
      updatedTrade.pnlR = normalizedR(updatedTrade.pnlPips, trade.riskPips);

      if (hitTakeProfit || hitStopLoss) {
        justClosed.push({
          ...updatedTrade,
          status: "CLOSED",
          closedAt: new Date().toISOString(),
          closeReason: hitTakeProfit ? "TP HIT" : "SL HIT"
        });
      } else {
        stillOpen.push(updatedTrade);
      }
    }

    if (justClosed.length > 0) {
      botState.closedTrades = [...justClosed.reverse(), ...botState.closedTrades].slice(0, 100);
      justClosed.forEach((trade) => {
        pushLog(`[${trade.symbol}] ${trade.closeReason} | paper P&L ${trade.pnlCurrency || "quote currency"} ${Number(trade.pnl).toFixed(2)}`);
      });
    }

    botState.openTrades = stillOpen;
    botState.lastUpdated = new Date().toISOString();
    emitState();
  }

  await monitorShadowTrades();
  botState.lastUpdated = new Date().toISOString();
  emitState();
}

export function startAutonomousBot() {
  if (botState.isRunning) {
    return;
  }

  botState.status = "ONLINE";
  botState.isRunning = true;
  runGeneration += 1;
  botState.startedAt = new Date().toISOString();
  botState.lastUpdated = botState.startedAt;

  (async () => {
    try {
      const status = await oanda.getConnectionStatus();
      botState.oandaConnected = Boolean(status.connected);
      botState.oandaReason = status.reason;
      botState.accountCurrency = status.currency ? String(status.currency).toUpperCase() : undefined;
      botState.dataSource = status.connected ? "OANDA MARKET DATA" : "OANDA_UNAVAILABLE";
      pushLog(status.connected
        ? `OANDA Practice connected: account ${botState.accountCurrency || "currency N/A"}`
        : "OANDA not connected: no market data will be invented");
      if (status.connected) {
        await refreshLivePrices();
      }
      if (status.connected && liveModeConfigured()) {
        await reconcileLiveTrades();
      }
      emitState();
    } catch (e) {
      botState.oandaConnected = false;
      botState.oandaReason = "status_error";
      botState.dataSource = "OANDA_UNAVAILABLE";
      pushLog("OANDA status check failed: no market data will be invented");
      emitState();
    }
    await scanAllSymbols();
  })();

  pushLog("=================================");
  pushLog("AUTONOMOUS BOT STARTED");
  pushLog(`Symbols: ${SYMBOLS.length}`);
  pushLog(`Max Daily Trades: ${MAX_DAILY_TRADES}`);
  pushLog(`Max Daily Trades Per FX Symbol: ${MAX_DAILY_TRADES_PER_SYMBOL}`);
  pushLog(`Max Trades Per Rolling Minute: ${MAX_TRADES_PER_MINUTE}`);
  pushLog(`Forex Signal Profile: ${config.FOREX_SIGNAL_PROFILE}`);
  pushLog(`Minimum Signal Confidence: ${MIN_CONFIDENCE}%`);
  pushLog(`Max Open Positions: ${MAX_OPEN_POSITIONS}`);
  pushLog(`Max New Trades Per Cycle: ${MAX_NEW_TRADES_PER_CYCLE}`);
  pushLog(liveExecutionActive()
    ? `Execution: ${config.TRADING_MODE} (${config.LIVE_EXECUTION_VARIANT}). Every trade requires OANDA order ID, trade ID, position and protections.`
    : liveModeConfigured()
      ? `Execution: ${config.TRADING_MODE} BLOCKED until every account, feed, reconciliation, risk and confirmation gate passes.`
      : "Execution: PAPER TRADING ONLY. OANDA orders disabled; MAIN and INVERSE comparison is shadow-only.");
  pushLog("=================================");

  if (signalTimer) clearInterval(signalTimer);
  if (closeTimer) clearInterval(closeTimer);
  if (priceTimer) clearInterval(priceTimer);

  signalTimer = setInterval(() => {
    void scanAllSymbols();
  }, SIGNAL_INTERVAL);

  closeTimer = setInterval(() => {
    void monitorTrades();
  }, CLOSE_INTERVAL);

  priceTimer = setInterval(() => {
    void refreshLivePrices();
  }, PRICE_INTERVAL);
}

export function stopAutonomousBot() {
  if (signalTimer) clearInterval(signalTimer);
  if (closeTimer) clearInterval(closeTimer);
  if (priceTimer) clearInterval(priceTimer);
  signalTimer = undefined;
  closeTimer = undefined;
  priceTimer = undefined;
  priceRefreshInProgress = false;
  runGeneration += 1;
  botState.status = "OFFLINE";
  botState.isRunning = false;
  botState.lastUpdated = new Date().toISOString();
  pushLog("AUTONOMOUS BOT STOPPED");
  emitState();
}

export const autonomousTestUtils = {
  parseGemmoClientTag,
  isVerifiedRohatoOandaTrade,
  hasUnverifiedOandaExposure,
  canAutoCloseOandaTrade,
  paperExecutablePrice,
  paperExitPrice,
  isFreshTradeableQuote,
  shadowExecutableExitPrice,
  executionFeedCoverage,
  executionFeedOperational,
  fixedPipPlan,
  variantPipDefaults,
  laneProtectionPlan,
  countUtcTradeEntries,
  countUtcTradeEntriesBySymbol,
  dailySymbolCapReached,
  dailyLossCapReached,
  rollingMinuteTradeCount,
  minuteTradeCapReached,
  recentUtcEntryTimes,
  symbolCooldownRemainingMs,
  normalizedR
};
