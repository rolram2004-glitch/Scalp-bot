import { getScalpingSignal } from "./trading-ai";
import { generateMarketData } from "./market-engine";
import { canOpenTrade } from "./risk-engine";
import { getSession, isKillzone } from "./session-engine";
import { rankSignals } from "./signal-ranker";
import { MarketData, TradingDecision } from "./types";
import { executeVerifiedMarketOrder } from "./execution-engine";
import { createPairedSignalSnapshot, PairedSignalSnapshot, StrategyVariant } from "./signal-pair";
const oanda = require("./oanda");
const config = require("./config");

const SYMBOLS = (config.SYMBOLS || []).map((symbol: string) => String(symbol).replace("_", ""));

// Market data uses M5 candles; evaluate the latest real OANDA data every two minutes.
const SIGNAL_INTERVAL = Number(config.SCAN_INTERVAL || 2 * 60 * 1000);
const CLOSE_INTERVAL = 5000;
const PRICE_INTERVAL = 1000;

const MAX_DAILY_TRADES = Number(config.MAX_DAILY_TRADES);
const MIN_CONFIDENCE = Number(config.MIN_CONFIDENCE);
const MAX_OPEN_POSITIONS = Number(config.MAX_OPEN_TRADES || 15);
const MAX_NEW_TRADES_PER_CYCLE = Number(config.MAX_NEW_TRADES_PER_CYCLE || 6);
const MAX_DAILY_LOSS = Number(config.MAX_DAILY_LOSS || 50);

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
  openedAt: string;
  closedAt?: string;
  setupType?: string;
  confidence?: number;
  reasoning?: string;
  closeReason?: "TP HIT" | "SL HIT" | "MANUAL" | "SIGNAL EXIT";
  status: "OPEN" | "CLOSED";
  source: "PAPER" | "PAPER_SHADOW" | "OANDA" | "LOCAL_ORPHAN";
  units: number;
  accountCurrency?: string;
  pnlCurrency?: string;
  oandaOrderId?: string;
  oandaTradeId?: string;
  verificationStatus?: "VERIFIED" | "NOT_VERIFIED";
  strategyVariant?: StrategyVariant;
  signalId?: string;
  signalAt?: string;
  priceTime?: string;
  managedByBot?: boolean;
  clientTag?: string;
}

export interface BotSnapshot {
  status: "ONLINE" | "OFFLINE";
  isRunning: boolean;
  startedAt?: string;
  lastUpdated?: string;
  lastPriceAt?: string;
  priceFeedStatus: "CONNECTED" | "DISCONNECTED";
  dataSource: string;
  oandaConnected: boolean;
  oandaReason?: string;
  executionMode: string;
  tradingMode: "PAPER" | "LIVE";
  liveTradingEnabled: boolean;
  liveExecutionVariant: StrategyVariant | "INVALID";
  liveExecutionVariantValid: boolean;
  accountCurrency?: string;
  symbols: string[];
  maxDailyTrades: number;
  minimumConfidence: number;
  maxOpenPositions: number;
  maxDailyLoss: number;
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
  signalsAnalyzed: number;
  signalsDiscarded: number;
  openTrades: BotTrade[];
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
  priceCoverage: number;
  priceExpected: number;
  reconciliationStatus: "NOT_RUN" | "VERIFIED" | "FAILED";
  lastReconciledAt?: string;
  lastOrderAttemptAt?: string;
  lastOrderStatus?: "SUBMITTING" | "OPEN_VERIFIED" | "REJECTED" | "SKIPPED";
  lastOrderReason?: string;
  lastOandaOrderId?: string;
  lastOandaTradeId?: string;
}

const botState: BotSnapshot = {
  status: "OFFLINE",
  isRunning: false,
  dataSource: "OANDA_UNAVAILABLE",
  oandaConnected: false,
  priceFeedStatus: "DISCONNECTED",
  executionMode: config.TRADING_MODE === "LIVE"
    ? !config.LIVE_TRADING_ENABLED
      ? "LIVE BLOCKED - ENABLE FLAG FALSE"
      : config.LIVE_EXECUTION_VARIANT_VALID
        ? `LIVE OANDA PRACTICE (${config.LIVE_EXECUTION_VARIANT})`
        : "LIVE BLOCKED - INVALID VARIANT"
    : "PAPER",
  tradingMode: config.TRADING_MODE,
  liveTradingEnabled: config.LIVE_TRADING_ENABLED,
  liveExecutionVariant: config.LIVE_EXECUTION_VARIANT,
  liveExecutionVariantValid: config.LIVE_EXECUTION_VARIANT_VALID,
  symbols: SYMBOLS,
  maxDailyTrades: MAX_DAILY_TRADES,
  minimumConfidence: MIN_CONFIDENCE,
  maxOpenPositions: MAX_OPEN_POSITIONS,
  maxDailyLoss: MAX_DAILY_LOSS,
  dailyTradeCount: 0,
  signalsAnalyzed: 0,
  signalsDiscarded: 0,
  openTrades: [],
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
  priceCoverage: 0,
  priceExpected: SYMBOLS.length,
  reconciliationStatus: "NOT_RUN"
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

function liveExecutionActive() {
  return config.TRADING_MODE === "LIVE" &&
    config.LIVE_TRADING_ENABLED === true &&
    config.LIVE_EXECUTION_VARIANT_VALID === true;
}

function liveExecutionRequested() {
  return config.TRADING_MODE === "LIVE" && config.LIVE_TRADING_ENABLED === true;
}

function liveModeConfigured() {
  return config.TRADING_MODE === "LIVE";
}

function emitState() {
  const snapshot = {
    ...botState,
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
        riskAmount: Number(config.NORMAL_STOP_LOSS_ACCOUNT || 1.2),
        rewardAmount: Number(config.NORMAL_TAKE_PROFIT_ACCOUNT || 2.4)
      };
}

function priceDistanceForCash(symbol: string, cashAmount: number) {
  return cashAmount / Math.max(tradeUnits(symbol), 1);
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
  return Number.isFinite(candidate) && candidate > 0 ? candidate : marketData.closePrice;
}

function parseGemmoClientTag(tag: unknown) {
  const match = /^GEMMO-(MAIN|INVERSE)-(SIG-[A-Za-z0-9._-]+)$/.exec(String(tag || ""));
  return match
    ? { strategyVariant: match[1] as StrategyVariant, signalId: match[2], clientTag: match[0] }
    : null;
}

function hasConflictingManagedVariant() {
  return botState.openTrades.some((trade) =>
    trade.source === "OANDA" &&
    (trade.managedByBot !== true || trade.strategyVariant !== config.LIVE_EXECUTION_VARIANT)
  );
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

function paperExitPrice(side: "BUY" | "SELL" | "HOLD", marketData: MarketData) {
  const candidate = side === "BUY" ? Number(marketData.bid) : Number(marketData.ask);
  return Number.isFinite(candidate) && candidate > 0 ? candidate : marketData.closePrice;
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
  const { riskAmount, rewardAmount } = cashRules(symbol);
  const stopLoss = entryPrice - direction * priceDistanceForCash(symbol, riskAmount);
  const takeProfit = entryPrice + direction * priceDistanceForCash(symbol, rewardAmount);
  const currentPrice = paperExitPrice(decision.action, marketData);
  const pnl = calculatePaperPnl(symbol, decision.action, entryPrice, currentPrice);
  const multiplier = pipMultiplier(symbol);

  return {
    id: `PAPER-${symbol}-${Date.now()}`,
    symbol,
    side: decision.action,
    entryPrice,
    currentPrice,
    stopLoss,
    takeProfit,
    riskAmount,
    rewardAmount,
    pnl,
    pnlPips: direction * (currentPrice - entryPrice) * multiplier,
    openedAt: new Date().toISOString(),
    setupType: decision.setupType,
    confidence: decision.confidence,
    reasoning: `${decision.reasoning}. Paper trading only, units ${tradeUnits(symbol)}, RR 1:2; P&L espresso nella valuta quotata.`,
    status: "OPEN",
    source: "PAPER",
    units: tradeUnits(symbol),
    pnlCurrency: quoteCurrency(symbol),
    verificationStatus: "VERIFIED",
    strategyVariant: "MAIN",
    signalId: pairedSignal?.pairId,
    signalAt: pairedSignal?.evaluatedAt,
    priceTime: pairedSignal?.market.time
  };
}

export function getBotSnapshot(): BotSnapshot {
  return {
    ...botState,
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
  const eligible = (trade: BotTrade) => config.TRADING_MODE === "LIVE"
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
  const pnlComplete = relevantPnlTrades.length > 0 && pnlTrades.length === relevantPnlTrades.length;
  const pnlToday = pnlComplete && pnlCurrency
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
    let updated = 0;
    let latestTime: string | undefined;

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

      if (time && (!latestTime || time > latestTime)) latestTime = time;
      updated += 1;
    }

    if (updated === 0) throw new Error("OANDA_PRICE_SNAPSHOT_EMPTY");
    botState.livePrices = nextPrices;
    botState.priceCoverage = updated;
    botState.lastPriceAt = latestTime;
    botState.priceFeedStatus = "CONNECTED";
    botState.oandaConnected = true;
    botState.oandaReason = undefined;
    botState.dataSource = "OANDA MARKET DATA";
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
  const marketPrice = optionalFinite(botState.marketData?.[symbol]?.closePrice);
  const currentPrice = marketPrice && marketPrice > 0
    ? marketPrice
    : previous?.currentPrice;
  const openedAt = String(remote?.openTime || previous?.openedAt || "");
  if (!signedUnits || !symbol || !entryPrice || !Number.isFinite(Date.parse(openedAt))) {
    throw new Error("OANDA_OPEN_TRADE_FIELDS_INCOMPLETE");
  }
  const ownership = parseGemmoClientTag(remote?.clientExtensions?.tag);
  const unrealizedPL = optionalFinite(remote?.unrealizedPL);

  return {
    id: `OANDA-${remote.id}`,
    symbol,
    side: signedUnits < 0 ? "SELL" : "BUY",
    units: Math.abs(signedUnits),
    entryPrice,
    currentPrice,
    stopLoss: optionalFinite(remote?.stopLossOrder?.price),
    takeProfit: optionalFinite(remote?.takeProfitOrder?.price),
    riskAmount: previous?.riskAmount,
    rewardAmount: previous?.rewardAmount,
    pnl: unrealizedPL,
    pnlPips: previous?.pnlPips,
    openedAt,
    setupType: previous?.setupType || (!ownership ? "OANDA_EXTERNAL" : undefined),
    confidence: previous?.confidence,
    reasoning: previous?.reasoning || (ownership
      ? "Posizione GEMMO aperta e verificata direttamente tramite OANDA Practice."
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
    clientTag: ownership?.clientTag
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
  return {
    id: `OANDA-${remote.id}`,
    symbol: cleanSymbol(remote?.instrument),
    side: signedUnits < 0 ? "SELL" : "BUY",
    units: Math.abs(signedUnits),
    entryPrice,
    currentPrice: closePrice && closePrice > 0 ? closePrice : previous?.currentPrice,
    stopLoss: previous?.stopLoss,
    takeProfit: previous?.takeProfit,
    riskAmount: previous?.riskAmount,
    rewardAmount: previous?.rewardAmount,
    pnl: optionalFinite(remote?.realizedPL),
    pnlPips: previous?.pnlPips,
    openedAt,
    closedAt: remote?.closeTime || previous?.closedAt,
    setupType: previous?.setupType || (!ownership ? "OANDA_EXTERNAL" : undefined),
    confidence: previous?.confidence,
    reasoning: previous?.reasoning || (ownership
      ? "Trade GEMMO chiuso e verificato direttamente tramite OANDA Practice."
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
    clientTag: ownership?.clientTag
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

async function reconcileLiveTradesOnce() {
  try {
    const [account, remoteOpenTrades, remoteOpenPositions, remoteClosedTrades] = await Promise.all([
      oanda.getAccount(),
      oanda.getOpenTrades(),
      oanda.getOpenPositions(),
      oanda.getClosedTrades(80)
    ]);
    if (!account?.currency || !Array.isArray(remoteOpenTrades) || !Array.isArray(remoteOpenPositions) || !Array.isArray(remoteClosedTrades)) {
      throw new Error("OANDA_RECONCILIATION_UNAVAILABLE");
    }
    const tradeInstruments = new Set(remoteOpenTrades.map((trade: any) => cleanSymbol(trade?.instrument)));
    const unmatchedPosition = remoteOpenPositions.find((position: any) => {
      const hasUnits = Number(position?.long?.units || 0) !== 0 || Number(position?.short?.units || 0) !== 0;
      return hasUnits && !tradeInstruments.has(cleanSymbol(position?.instrument));
    });
    if (unmatchedPosition) throw new Error("OANDA_POSITION_TRADE_MISMATCH");

    const currency = String(account.currency).toUpperCase();
    botState.accountCurrency = currency;
    const previousById = new Map(
      [...botState.openTrades, ...botState.closedTrades]
        .filter((trade) => trade.oandaTradeId)
        .map((trade) => [String(trade.oandaTradeId), trade])
    );
    const remoteIds = new Set(remoteOpenTrades.map((trade: any) => String(trade.id)));
    const verifiedOpen = remoteOpenTrades.map((remote: any) =>
      mapVerifiedOandaTrade(remote, currency, previousById.get(String(remote.id)))
    );
    const newlyClosed: BotTrade[] = [];
    const orphans: BotTrade[] = [];

    for (const local of botState.openTrades.filter((trade) => trade.oandaTradeId && !remoteIds.has(String(trade.oandaTradeId)))) {
      try {
        const verified = await oanda.getTrade(String(local.oandaTradeId));
        if (String(verified?.state || "").toUpperCase() === "CLOSED") {
          const realizedPL = optionalFinite(verified?.realizedPL);
          const closePrice = optionalFinite(verified?.averageClosePrice);
          const closedAt = typeof verified?.closeTime === "string" && Number.isFinite(Date.parse(verified.closeTime))
            ? verified.closeTime
            : undefined;
          newlyClosed.push({
            ...local,
            status: "CLOSED",
            source: "OANDA",
            verificationStatus: "VERIFIED",
            pnl: realizedPL,
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
      .slice(0, 80);

    if (newlyClosed.length > 0) {
      newlyClosed.forEach((trade) => pushLog(
        `[${trade.symbol}] chiusura verificata OANDA | P&L ${Number.isFinite(trade.pnl) ? `${currency} ${Number(trade.pnl).toFixed(2)}` : "N/A"}`
      ));
    }
    botState.openTrades = [...verifiedOpen, ...orphans];
    botState.oandaConnected = true;
    botState.oandaReason = undefined;
    botState.reconciliationStatus = "VERIFIED";
    botState.lastReconciledAt = new Date().toISOString();
    botState.lastUpdated = new Date().toISOString();
    emitState();
  } catch (error) {
    botState.oandaConnected = false;
    botState.oandaReason = "reconciliation_failed";
    botState.reconciliationStatus = "FAILED";
    pushLog("OANDA reconciliation failed: le posizioni esistenti non sono state alterate");
  }
}

function buildShadowTrade(
  symbol: string,
  lane: PairedSignalSnapshot["main"],
  marketData: MarketData,
  pairedSignal: PairedSignalSnapshot
): BotTrade {
  const decision: TradingDecision = {
    action: lane.action,
    confidence: lane.confidence,
    reasoning: lane.reasoning,
    setupType: lane.setupType
  };
  const trade = buildTrade(symbol, decision, marketData, pairedSignal);
  return {
    ...trade,
    id: `SHADOW-${lane.variant}-${symbol}-${pairedSignal.pairId}`,
    source: "PAPER_SHADOW",
    strategyVariant: lane.variant,
    reasoning: `${lane.reasoning}. PAPER SHADOW: nessun ordine OANDA, prezzi bid/ask reali.`,
    verificationStatus: "NOT_VERIFIED"
  };
}

function shadowLaneForPair(pair: PairedSignalSnapshot) {
  if (liveExecutionActive()) {
    return config.LIVE_EXECUTION_VARIANT === "MAIN" ? pair.inverse : pair.main;
  }
  return pair.inverse;
}

function closeShadowTradeAtMarket(index: number, marketData: MarketData, reason: "SIGNAL EXIT" | "TP HIT" | "SL HIT") {
  const trade = botState.shadowOpenTrades[index];
  if (!trade) return;
  const exitPrice = paperExitPrice(trade.side, marketData);
  const multiplier = pipMultiplier(trade.symbol);
  const closed: BotTrade = {
    ...trade,
    status: "CLOSED",
    currentPrice: exitPrice,
    pnl: calculatePaperPnl(trade.symbol, trade.side, trade.entryPrice, exitPrice),
    pnlPips: trade.side === "BUY"
      ? (exitPrice - trade.entryPrice) * multiplier
      : (trade.entryPrice - exitPrice) * multiplier,
    closedAt: new Date().toISOString(),
    closeReason: reason
  };
  botState.shadowOpenTrades = botState.shadowOpenTrades.filter((_, itemIndex) => itemIndex !== index);
  botState.shadowClosedTrades = [closed, ...botState.shadowClosedTrades].slice(0, 80);
  pushLog(`[${trade.symbol}] ${trade.strategyVariant} PAPER SHADOW ${reason} | ${trade.pnlCurrency || "quote currency"} ${Number(closed.pnl).toFixed(2)} | no OANDA order`);
}

function updateShadowFromSignal(
  symbol: string,
  pair: PairedSignalSnapshot,
  marketData: MarketData,
  cycle: { shadowOpened: number }
) {
  if (liveModeConfigured() && !liveExecutionActive()) return;
  const lane = shadowLaneForPair(pair);
  const existingIndex = botState.shadowOpenTrades.findIndex((trade) => cleanSymbol(trade.symbol) === cleanSymbol(symbol));

  if (lane.action === "HOLD" || lane.confidence < MIN_CONFIDENCE) {
    if (existingIndex >= 0) closeShadowTradeAtMarket(existingIndex, marketData, "SIGNAL EXIT");
    return;
  }
  if (existingIndex >= 0) return;
  if (cycle.shadowOpened >= MAX_NEW_TRADES_PER_CYCLE || botState.shadowOpenTrades.length >= MAX_OPEN_POSITIONS) return;

  const shadow = buildShadowTrade(symbol, lane, marketData, pair);
  botState.shadowOpenTrades = [shadow, ...botState.shadowOpenTrades].slice(0, MAX_OPEN_POSITIONS);
  botState.shadowTradeCount += 1;
  cycle.shadowOpened += 1;
  pushLog(`[${symbol}] ${lane.variant} PAPER SHADOW ${lane.action} opened on OANDA quote ${pair.market.time} | no OANDA order`);
}

async function closeVerifiedOandaTrade(trade: BotTrade) {
  if (!canAutoCloseOandaTrade(trade, config.LIVE_EXECUTION_VARIANT)) {
    pushLog(`[${trade.symbol}] chiusura bloccata: trade OANDA non attribuito alla corsia GEMMO attiva`);
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
    const closed: BotTrade = {
      ...trade,
      status: "CLOSED",
      source: "OANDA",
      verificationStatus: "VERIFIED",
      pnl: realizedPL,
      currentPrice: closePrice,
      closedAt: closeTime,
      closeReason: "SIGNAL EXIT"
    };
    botState.openTrades = botState.openTrades.filter((item) => item.oandaTradeId !== trade.oandaTradeId);
    botState.closedTrades = [closed, ...botState.closedTrades].slice(0, 80);
    pushLog(`[${trade.symbol}] SIGNAL EXIT verificata da OANDA | P&L ${Number.isFinite(closed.pnl) ? `${trade.accountCurrency || "N/A"} ${Number(closed.pnl).toFixed(2)}` : "N/A"}`);
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
    if (liveExecutionActive() && typeof analytics.pnlToday === "number" && analytics.pnlToday <= -MAX_DAILY_LOSS) {
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
      tradingMode: liveExecutionActive() ? "LIVE" : liveModeConfigured() ? "BLOCKED" : "PAPER",
      liveExecutionVariant: config.LIVE_EXECUTION_VARIANT,
      minimumConfidence: MIN_CONFIDENCE
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
    botState.currentAction = rankedDecision.action;
    botState.currentConfidence = rankedDecision.confidence;
    botState.currentReasoning = rankedDecision.reasoning;
    botState.lastSignals = botState.lastSignals || {};
    botState.lastSignals[symbol] = {
      ...rankedDecision,
      scannedAt: evaluatedAt
    };
    botState.pairedSignals = botState.pairedSignals || {};
    botState.pairedSignals[symbol] = pairedSignal;
    botState.latestPairedSignal = pairedSignal;
    botState.currentPrice = pairedSignal.market.mid;
    botState.entryPrice = rankedDecision.action === "HOLD"
      ? undefined
      : rankedDecision.entryPrice ?? pairedSignal.market.mid;
    const signalDirection = rankedDecision.action === "SELL" ? -1 : 1;
    const cash = cashRules(symbol);
    botState.stopLoss = rankedDecision.action === "HOLD"
      ? undefined
      : isGold(symbol)
      ? rankedDecision.stopLossPrice
      : liveModeConfigured()
      ? undefined
      : enrichedMarketData.closePrice - signalDirection * priceDistanceForCash(symbol, cash.riskAmount);
    botState.takeProfit = rankedDecision.action === "HOLD"
      ? undefined
      : isGold(symbol)
      ? rankedDecision.structuralTargets?.[0]
      : liveModeConfigured()
      ? undefined
      : enrichedMarketData.closePrice + signalDirection * priceDistanceForCash(symbol, cash.rewardAmount);
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
      pushLog(`[${symbol}] PAPER/LIVE signal blocked: ${pairedSignal.marketValidationReason}`);
      return;
    }

    if (isGold(symbol)) {
      botState.signalsDiscarded += rankedDecision.action === "HOLD" ? 0 : 1;
      pushLog(`[${symbol}] ANALYSIS ONLY: struttura XAUUSD aggiornata; nessun trade PAPER, SHADOW o OANDA viene aperto`);
      emitState();
      return;
    }

    updateShadowFromSignal(symbol, pairedSignal, enrichedMarketData, cycle);

    if (rankedDecision.action === "HOLD" || rankedDecision.confidence < MIN_CONFIDENCE) {
      botState.signalsDiscarded += 1;

      const sameSymbolIndex = botState.openTrades.findIndex((trade) => trade.symbol === symbol);
      if (sameSymbolIndex >= 0) {
        const lastTrade = botState.openTrades[sameSymbolIndex];
        if (liveExecutionActive() && lastTrade.source === "OANDA") {
          if (canAutoCloseOandaTrade(lastTrade, config.LIVE_EXECUTION_VARIANT)) {
            await closeVerifiedOandaTrade(lastTrade);
          } else {
            pushLog(`[${symbol}] SIGNAL EXIT ignored: OANDA trade is external or belongs to another GEMMO lane`);
          }
        } else if (!liveExecutionActive() && lastTrade.source === "PAPER") {
          const multiplier = pipMultiplier(lastTrade.symbol);
          const exitPrice = paperExitPrice(lastTrade.side, enrichedMarketData);
          lastTrade.status = "CLOSED";
          lastTrade.currentPrice = exitPrice;
          lastTrade.pnl = calculatePaperPnl(lastTrade.symbol, lastTrade.side, lastTrade.entryPrice, exitPrice);
          lastTrade.pnlPips = lastTrade.side === "BUY"
            ? (exitPrice - lastTrade.entryPrice) * multiplier
            : (lastTrade.entryPrice - exitPrice) * multiplier;
          lastTrade.closedAt = new Date().toISOString();
          lastTrade.closeReason = "SIGNAL EXIT";

          botState.closedTrades = [lastTrade, ...botState.closedTrades].slice(0, 80);
          botState.openTrades = botState.openTrades.filter((_, index) => index !== sameSymbolIndex);
        }
      }

      pushLog(
        `[${symbol}] ${rankedDecision.action} | ${rankedDecision.confidence}% | ${rankedDecision.reasoning}`
      );
    } else if (liveModeConfigured() && !liveExecutionActive()) {
      botState.signalsDiscarded += 1;
      const reason = !config.LIVE_TRADING_ENABLED
        ? "LIVE_TRADING_ENABLED must be true"
        : "LIVE_EXECUTION_VARIANT must be exactly MAIN or INVERSE";
      pushLog(`[${symbol}] LIVE execution blocked: ${reason}`);
    } else if (liveExecutionActive() && pairedSignal.executionBlockedReason) {
      botState.signalsDiscarded += 1;
      pushLog(`[${symbol}] LIVE execution blocked: ${pairedSignal.executionBlockedReason}`);
    } else if (liveExecutionActive() && hasConflictingManagedVariant()) {
      botState.signalsDiscarded += 1;
      updatePairExecution(pairedSignal, "SKIPPED", "OANDA_EXTERNAL_OR_DIFFERENT_GEMMO_VARIANT_OPEN");
      pushLog(`[${symbol}] LIVE execution skipped: an external/unknown OANDA trade or another GEMMO lane is still open`);
    } else if (hasOpenTradeForSymbol(symbol)) {
      botState.signalsDiscarded += 1;
      if (liveExecutionActive()) updatePairExecution(pairedSignal, "SKIPPED", "POSITION_ALREADY_OPEN");
      pushLog(`[${symbol}] trade skipped: one open position per symbol is already active`);
    } else if (cycle.opened >= MAX_NEW_TRADES_PER_CYCLE) {
      botState.signalsDiscarded += 1;
      if (liveExecutionActive()) updatePairExecution(pairedSignal, "SKIPPED", "CYCLE_CAP_REACHED");
      pushLog(`[${symbol}] valid signal queued: cycle cap ${MAX_NEW_TRADES_PER_CYCLE} reached`);
    } else if (canOpenTrade(botState.dailyTradeCount, botState.openTrades.length)) {
      if (liveExecutionActive()) {
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
          strategyVariant: config.LIVE_EXECUTION_VARIANT,
          signalId: pairedSignal.pairId,
          signalAt: pairedSignal.evaluatedAt
        });
        if (result.status === "OPENED") {
          const trade: BotTrade = {
            id: `OANDA-${result.trade.oandaTradeId}`,
            ...result.trade,
            pnl: undefined,
            pnlPips: undefined,
            setupType: decisionForExecution.setupType,
            confidence: decisionForExecution.confidence,
            reasoning: `${decisionForExecution.reasoning}. Ordine ${config.LIVE_EXECUTION_VARIANT} e trade verificati tramite OANDA Practice.`,
            status: "OPEN",
            verificationStatus: "VERIFIED",
            managedByBot: true
          };
          botState.dailyTradeCount += 1;
          cycle.opened += 1;
          botState.openTrades = [trade, ...botState.openTrades];
          botState.accountCurrency = trade.accountCurrency;
          botState.entryPrice = trade.entryPrice;
          botState.stopLoss = trade.stopLoss;
          botState.takeProfit = trade.takeProfit;
          updatePairExecution(pairedSignal, "OPEN_VERIFIED", undefined, {
            orderId: trade.oandaOrderId,
            tradeId: trade.oandaTradeId
          });
          botState.lastOrderStatus = "OPEN_VERIFIED";
          botState.lastOandaOrderId = trade.oandaOrderId;
          botState.lastOandaTradeId = trade.oandaTradeId;
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
        cycle.opened += 1;
        botState.openTrades = [trade, ...botState.openTrades].slice(0, MAX_OPEN_POSITIONS);
        pushLog(
          `[${symbol}] PAPER ${rankedDecision.action} | ${rankedDecision.confidence}% | ${rankedDecision.reasoning}`
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
    if (scanInProgress) pushLog("Market scan skipped: previous two-minute cycle is still running");
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
    const currentPrice = Number(trade.side === "SELL" ? quote?.ask : quote?.bid);
    if (botState.priceFeedStatus !== "CONNECTED" || !quote || !isFreshTradeableQuote(quote) || !Number.isFinite(currentPrice) || currentPrice <= 0) {
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
    botState.shadowClosedTrades = [...justClosed.reverse(), ...botState.shadowClosedTrades].slice(0, 80);
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

      const updatedTrade = {
        ...trade,
        currentPrice: fillPrice,
        pnl,
        pnlPips: trade.side === "BUY"
          ? (fillPrice - trade.entryPrice) * multiplier
          : (trade.entryPrice - fillPrice) * multiplier
      };

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
      botState.closedTrades = [...justClosed.reverse(), ...botState.closedTrades].slice(0, 80);
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
  pushLog(`Minimum Signal Confidence: ${MIN_CONFIDENCE}%`);
  pushLog(`Max Open Positions: ${MAX_OPEN_POSITIONS}`);
  pushLog(`Max New Trades Per Cycle: ${MAX_NEW_TRADES_PER_CYCLE}`);
  pushLog(liveExecutionActive()
    ? `Execution: LIVE OANDA PRACTICE (${config.LIVE_EXECUTION_VARIANT}). Every trade requires OANDA order ID and verified trade ID.`
    : liveModeConfigured()
      ? `Execution: LIVE BLOCKED. ${config.LIVE_TRADING_ENABLED ? "LIVE_EXECUTION_VARIANT must be exactly MAIN or INVERSE." : "LIVE_TRADING_ENABLED must be true."}`
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
  canAutoCloseOandaTrade,
  paperExecutablePrice,
  paperExitPrice,
  isFreshTradeableQuote
};
