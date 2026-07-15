import { getScalpingSignal } from "./trading-ai";
import { generateMarketData } from "./market-engine";
import { canOpenTrade } from "./risk-engine";
import { getSession, isKillzone } from "./session-engine";
import { rankSignals } from "./signal-ranker";
import {
  detectFVG,
  detectLiquidity,
  detectOrderBlock,
  detectStructure
} from "./smart-money";
import { MarketData, TradingDecision } from "./types";
import { executeVerifiedMarketOrder } from "./execution-engine";
const oanda = require("./oanda");
const config = require("./config");

const SYMBOLS = [
  "XAUUSD",
  "EURUSD",
  "GBPUSD",
  "USDJPY",
  "USDCAD",
  "AUDUSD",
  "USDCHF",
  "NZDUSD",
  "GBPJPY",
  "EURJPY",
  "AUDJPY",
  "NZDJPY",
  "EURGBP",
  "EURAUD",
  "EURCAD",
  "GBPAUD"
];

// Market data uses M5 candles, so run one decision cycle per five-minute bar.
const SIGNAL_INTERVAL = 5 * 60 * 1000;
const CLOSE_INTERVAL = 5000;
const PRICE_INTERVAL = 1000;

const MAX_DAILY_TRADES = 1000;
const DAILY_TARGET = 800;
const MAX_OPEN_POSITIONS = 15;
const MAX_NEW_TRADES_PER_CYCLE = Number(config.MAX_NEW_TRADES_PER_CYCLE || 6);
const DEFAULT_LOT_SIZE = Number(process.env.DEFAULT_LOT_SIZE || 0.01);
const MAX_DAILY_LOSS = Number(process.env.MAX_DAILY_LOSS || 50);

interface BotTrade {
  id: string;
  symbol: string;
  side: "BUY" | "SELL" | "HOLD";
  entryPrice: number;
  currentPrice: number;
  stopLoss?: number;
  takeProfit?: number;
  riskAmount?: number;
  rewardAmount?: number;
  pnl: number;
  pnlPips?: number;
  openedAt: string;
  closedAt?: string;
  setupType?: string;
  confidence?: number;
  reasoning?: string;
  closeReason?: "TP HIT" | "SL HIT" | "MANUAL" | "SIGNAL EXIT";
  status: "OPEN" | "CLOSED";
  source: "PAPER" | "OANDA" | "LOCAL_ORPHAN";
  units: number;
  accountCurrency?: string;
  pnlCurrency?: string;
  oandaOrderId?: string;
  oandaTradeId?: string;
  verificationStatus?: "VERIFIED" | "NOT_VERIFIED";
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
  accountCurrency?: string;
  symbols: string[];
  dailyTarget: number;
  maxDailyTrades: number;
  maxOpenPositions: number;
  defaultLotSize: number;
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
  session: string;
  killzone: boolean;
  logs: string[];
  marketData?: Record<string, MarketData>;
  livePrices?: Record<string, { bid: number; ask: number; mid: number; time: string; tradeable: boolean; }>;
  lastSignals?: Record<string, TradingDecision & { scannedAt: string }>;
}

const botState: BotSnapshot = {
  status: "OFFLINE",
  isRunning: false,
  dataSource: "OANDA_UNAVAILABLE",
  oandaConnected: false,
  priceFeedStatus: "DISCONNECTED",
  executionMode: config.TRADING_MODE === "LIVE" && config.LIVE_TRADING_ENABLED ? "LIVE OANDA PRACTICE" : "PAPER",
  symbols: SYMBOLS,
  dailyTarget: DAILY_TARGET,
  maxDailyTrades: MAX_DAILY_TRADES,
  maxOpenPositions: MAX_OPEN_POSITIONS,
  defaultLotSize: DEFAULT_LOT_SIZE,
  maxDailyLoss: MAX_DAILY_LOSS,
  dailyTradeCount: 0,
  signalsAnalyzed: 0,
  signalsDiscarded: 0,
  openTrades: [],
  closedTrades: [],
  session: "OFF_HOURS",
  killzone: false,
  logs: []
  ,marketData: {},
  livePrices: {},
  lastSignals: {}
};

const listeners = new Set<(snapshot: BotSnapshot) => void>();
let signalTimer: ReturnType<typeof setInterval> | undefined;
let closeTimer: ReturnType<typeof setInterval> | undefined;
let priceTimer: ReturnType<typeof setInterval> | undefined;
let scanInProgress = false;
let runGeneration = 0;
let priceRefreshInProgress = false;
let lastPriceErrorLogAt = 0;

function liveExecutionActive() {
  return config.TRADING_MODE === "LIVE" && config.LIVE_TRADING_ENABLED === true;
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

function hasOpenTradeForSymbol(symbol: string) {
  const normalized = cleanSymbol(symbol);
  return botState.openTrades.some((trade) => cleanSymbol(trade.symbol) === normalized);
}

function buildTrade(
  symbol: string,
  decision: TradingDecision,
  marketData: MarketData
): BotTrade {
  const entryPrice = paperExecutablePrice(decision.action, marketData);
  const direction = decision.action === "SELL" ? -1 : 1;
  const { riskAmount, rewardAmount } = cashRules(symbol);
  const stopLoss = entryPrice - direction * priceDistanceForCash(symbol, riskAmount);
  const takeProfit = entryPrice + direction * priceDistanceForCash(symbol, rewardAmount);

  return {
    id: `PAPER-${symbol}-${Date.now()}`,
    symbol,
    side: decision.action,
    entryPrice,
    currentPrice: marketData.closePrice,
    stopLoss,
    takeProfit,
    riskAmount,
    rewardAmount,
    pnl: 0,
    pnlPips: 0,
    openedAt: new Date().toISOString(),
    setupType: decision.setupType || "EMA_STACK",
    confidence: decision.confidence,
    reasoning: `${decision.reasoning}. Paper trading only, units ${tradeUnits(symbol)}, RR 1:2; P&L espresso nella valuta quotata.`,
    status: "OPEN",
    source: "PAPER",
    units: tradeUnits(symbol),
    pnlCurrency: quoteCurrency(symbol),
    verificationStatus: "VERIFIED"
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
  const closed = (botState.closedTrades || []).filter((trade) => trade.source !== "LOCAL_ORPHAN");
  const open = (botState.openTrades || []).filter((trade) => trade.source !== "LOCAL_ORPHAN");

  const todaysClosed = closed.filter((t) => isToday(t.openedAt) || isToday(t.closedAt));
  const pnlTrades = [...todaysClosed, ...open].filter((trade) => Number.isFinite(trade.pnl));
  const pnlCurrencies = new Set(
    pnlTrades
      .map((trade) => trade.source === "OANDA" ? trade.accountCurrency : trade.pnlCurrency)
      .filter((currency): currency is string => Boolean(currency))
  );
  const pnlCurrency = pnlCurrencies.size === 1 ? [...pnlCurrencies][0] : null;
  const pnlToday = pnlTrades.length > 0 && pnlCurrency
    ? pnlTrades.reduce((sum, trade) => sum + trade.pnl, 0)
    : null;

  const wins = closed.filter((t) => (t.pnl || 0) > 0).length;
  const losses = closed.filter((t) => (t.pnl || 0) <= 0).length;
  const winRate = closed.length > 0 ? Math.round((wins / closed.length) * 1000) / 10 : null;

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
  priceRefreshInProgress = true;

  try {
    const prices = await oanda.getPrices(SYMBOLS);
    if (!Array.isArray(prices) || prices.length === 0) {
      throw new Error("OANDA_PRICE_SNAPSHOT_UNAVAILABLE");
    }

    botState.livePrices = botState.livePrices || {};
    let updated = 0;
    let latestTime = botState.lastPriceAt;

    for (const item of prices) {
      const symbol = cleanSymbol(item?.instrument);
      const bid = Number(item?.bids?.[0]?.price ?? item?.closeoutBid);
      const ask = Number(item?.asks?.[0]?.price ?? item?.closeoutAsk);
      if (!symbol || !Number.isFinite(bid) || !Number.isFinite(ask) || bid <= 0 || ask <= 0) continue;

      const mid = (bid + ask) / 2;
      const time = String(item?.time || "");
      botState.livePrices[symbol] = {
        bid,
        ask,
        mid,
        time,
        tradeable: item?.tradeable !== false && String(item?.status || "tradeable").toLowerCase() === "tradeable"
      };

      const existing = botState.marketData?.[symbol];
      if (existing) {
        const multiplier = isGold(symbol) ? 10 : pipMultiplier(symbol);
        botState.marketData![symbol] = {
          ...existing,
          bid,
          ask,
          closePrice: mid,
          spread: Math.max(0, ask - bid) * multiplier
        };
      }

      if (time && (!latestTime || time > latestTime)) latestTime = time;
      updated += 1;
    }

    if (updated === 0) throw new Error("OANDA_PRICE_SNAPSHOT_EMPTY");
    botState.lastPriceAt = latestTime;
    botState.priceFeedStatus = "CONNECTED";
    botState.oandaConnected = true;
    botState.oandaReason = undefined;
    botState.dataSource = "OANDA MARKET DATA";
    emitState();
  } catch (_error) {
    botState.priceFeedStatus = "DISCONNECTED";
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
  const signedUnits = Number(remote?.currentUnits || remote?.initialUnits || 0);
  const symbol = cleanSymbol(remote?.instrument);
  const entryPrice = Number(remote?.price);
  const marketPrice = Number(botState.marketData?.[symbol]?.closePrice);
  const currentPrice = Number.isFinite(marketPrice) && marketPrice > 0
    ? marketPrice
    : previous?.currentPrice || entryPrice;

  return {
    id: `OANDA-${remote.id}`,
    symbol,
    side: signedUnits < 0 ? "SELL" : "BUY",
    units: Math.abs(signedUnits),
    entryPrice,
    currentPrice,
    stopLoss: Number(remote?.stopLossOrder?.price) || previous?.stopLoss,
    takeProfit: Number(remote?.takeProfitOrder?.price) || previous?.takeProfit,
    riskAmount: previous?.riskAmount,
    rewardAmount: previous?.rewardAmount,
    pnl: Number(remote?.unrealizedPL || 0),
    pnlPips: previous?.pnlPips,
    openedAt: remote?.openTime || previous?.openedAt || new Date().toISOString(),
    setupType: previous?.setupType || "OANDA_SYNC",
    confidence: previous?.confidence,
    reasoning: previous?.reasoning || "Posizione aperta verificata direttamente tramite OANDA Practice.",
    status: "OPEN",
    source: "OANDA",
    accountCurrency,
    oandaOrderId: previous?.oandaOrderId,
    oandaTradeId: String(remote.id),
    verificationStatus: "VERIFIED"
  };
}

function mapClosedOandaTrade(remote: any, accountCurrency: string, previous?: BotTrade): BotTrade {
  const signedUnits = Number(remote?.initialUnits || remote?.currentUnits || 0);
  const entryPrice = Number(remote?.price);
  const closePrice = Number(remote?.averageClosePrice);
  return {
    id: `OANDA-${remote.id}`,
    symbol: cleanSymbol(remote?.instrument),
    side: signedUnits < 0 ? "SELL" : "BUY",
    units: Math.abs(signedUnits),
    entryPrice,
    currentPrice: Number.isFinite(closePrice) && closePrice > 0 ? closePrice : previous?.currentPrice || entryPrice,
    stopLoss: previous?.stopLoss,
    takeProfit: previous?.takeProfit,
    riskAmount: previous?.riskAmount,
    rewardAmount: previous?.rewardAmount,
    pnl: Number(remote?.realizedPL || 0),
    pnlPips: previous?.pnlPips,
    openedAt: remote?.openTime || previous?.openedAt || new Date().toISOString(),
    closedAt: remote?.closeTime || previous?.closedAt,
    setupType: previous?.setupType || "OANDA_SYNC",
    confidence: previous?.confidence,
    reasoning: previous?.reasoning || "Trade chiuso verificato direttamente tramite OANDA Practice.",
    closeReason: previous?.closeReason || "MANUAL",
    status: "CLOSED",
    source: "OANDA",
    accountCurrency,
    oandaOrderId: previous?.oandaOrderId,
    oandaTradeId: String(remote.id),
    verificationStatus: "VERIFIED"
  };
}

async function reconcileLiveTrades() {
  if (!liveExecutionActive()) return;

  try {
    const [account, remoteOpenTrades, remoteClosedTrades] = await Promise.all([
      oanda.getAccount(),
      oanda.getOpenTrades(),
      oanda.getClosedTrades(80)
    ]);
    if (!account?.currency || !Array.isArray(remoteOpenTrades) || !Array.isArray(remoteClosedTrades)) {
      throw new Error("OANDA_RECONCILIATION_UNAVAILABLE");
    }

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
          newlyClosed.push({
            ...local,
            status: "CLOSED",
            source: "OANDA",
            verificationStatus: "VERIFIED",
            pnl: Number(verified.realizedPL || 0),
            currentPrice: Number(verified.averageClosePrice) || local.currentPrice,
            closedAt: verified.closeTime || new Date().toISOString(),
            closeReason: local.closeReason || "MANUAL"
          });
        } else if (String(verified?.state || "").toUpperCase() === "OPEN") {
          verifiedOpen.push(mapVerifiedOandaTrade(verified, currency, local));
        } else {
          orphans.push({
            ...local,
            source: "LOCAL_ORPHAN",
            verificationStatus: "NOT_VERIFIED",
            pnl: 0,
            reasoning: "LOCAL ORPHAN / NOT VERIFIED: non incluso nel P&L OANDA."
          });
        }
      } catch (_error) {
        orphans.push({
          ...local,
          source: "LOCAL_ORPHAN",
          verificationStatus: "NOT_VERIFIED",
          pnl: 0,
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
      newlyClosed.forEach((trade) => pushLog(`[${trade.symbol}] chiusura verificata OANDA | P&L ${currency} ${trade.pnl.toFixed(2)}`));
    }
    botState.openTrades = [...verifiedOpen, ...orphans].slice(0, MAX_OPEN_POSITIONS);
    botState.oandaConnected = true;
    botState.oandaReason = undefined;
    botState.lastUpdated = new Date().toISOString();
    emitState();
  } catch (error) {
    botState.oandaConnected = false;
    botState.oandaReason = "reconciliation_failed";
    pushLog("OANDA reconciliation failed: le posizioni esistenti non sono state alterate");
  }
}

async function closeVerifiedOandaTrade(trade: BotTrade) {
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
    const closed: BotTrade = {
      ...trade,
      status: "CLOSED",
      source: "OANDA",
      verificationStatus: "VERIFIED",
      pnl: Number(verified.realizedPL || 0),
      currentPrice: Number(verified.averageClosePrice) || trade.currentPrice,
      closedAt: verified.closeTime || new Date().toISOString(),
      closeReason: "SIGNAL EXIT"
    };
    botState.openTrades = botState.openTrades.filter((item) => item.oandaTradeId !== trade.oandaTradeId);
    botState.closedTrades = [closed, ...botState.closedTrades].slice(0, 80);
    pushLog(`[${trade.symbol}] SIGNAL EXIT verificata da OANDA | P&L ${trade.accountCurrency || "N/A"} ${closed.pnl.toFixed(2)}`);
    return true;
  } catch (error: any) {
    const reason = error?.response?.data?.errorCode || error?.message || "OANDA_CLOSE_FAILED";
    pushLog(`[${trade.symbol}] chiusura OANDA rifiutata: ${String(reason).slice(0, 120)}`);
    return false;
  }
}

async function scanSymbol(symbol: string, cycle: { opened: number }, generation: number) {
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

    botState.signalsAnalyzed += 1;
    botState.currentSymbol = symbol;
    botState.currentAction = rankedDecision.action;
    botState.currentConfidence = rankedDecision.confidence;
    botState.currentReasoning = rankedDecision.reasoning;
    botState.lastSignals = botState.lastSignals || {};
    botState.lastSignals[symbol] = {
      ...rankedDecision,
      scannedAt: new Date().toISOString()
    };
    botState.currentPrice = enrichedMarketData.closePrice;
    botState.entryPrice = rankedDecision.entryPrice ?? enrichedMarketData.closePrice;
    const signalDirection = rankedDecision.action === "SELL" ? -1 : 1;
    const cash = cashRules(symbol);
    botState.stopLoss = liveExecutionActive()
      ? undefined
      : enrichedMarketData.closePrice - signalDirection * priceDistanceForCash(symbol, cash.riskAmount);
    botState.takeProfit = liveExecutionActive()
      ? undefined
      : enrichedMarketData.closePrice + signalDirection * priceDistanceForCash(symbol, cash.rewardAmount);
    botState.riskAmount = cash.riskAmount;
    botState.rewardAmount = cash.rewardAmount;
    botState.profitLoss = 0;
    botState.session = session;
    botState.killzone = killzone;
    botState.lastUpdated = new Date().toISOString();

    if (!botState.isRunning || generation !== runGeneration) {
      pushLog(`[${symbol}] decision recorded but execution skipped: bot stopped`);
      return;
    }

    if (rankedDecision.action === "HOLD" || rankedDecision.confidence < 50) {
      botState.signalsDiscarded += 1;

      const sameSymbolIndex = botState.openTrades.findIndex((trade) => trade.symbol === symbol);
      if (sameSymbolIndex >= 0) {
        const lastTrade = botState.openTrades[sameSymbolIndex];
        if (liveExecutionActive() && lastTrade.source === "OANDA") {
          await closeVerifiedOandaTrade(lastTrade);
        } else if (!liveExecutionActive() && lastTrade.source === "PAPER") {
          const multiplier = pipMultiplier(lastTrade.symbol);
          const exitPrice = paperExecutablePrice(lastTrade.side, enrichedMarketData);
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
    } else if (hasOpenTradeForSymbol(symbol)) {
      botState.signalsDiscarded += 1;
      pushLog(`[${symbol}] trade skipped: one open position per symbol is already active`);
    } else if (cycle.opened >= MAX_NEW_TRADES_PER_CYCLE) {
      botState.signalsDiscarded += 1;
      pushLog(`[${symbol}] valid signal queued: cycle cap ${MAX_NEW_TRADES_PER_CYCLE} reached`);
    } else if (canOpenTrade(botState.dailyTradeCount, botState.openTrades.length)) {
      if (liveExecutionActive()) {
        if (!botState.isRunning || generation !== runGeneration) {
          pushLog(`[${symbol}] order skipped: bot stopped before submission`);
          return;
        }
        const result = await executeVerifiedMarketOrder({
          oanda,
          symbol,
          side: rankedDecision.action as "BUY" | "SELL",
          units: tradeUnits(symbol),
          riskAmount: cash.riskAmount,
          rewardAmount: cash.rewardAmount
        });
        if (result.status === "OPENED") {
          const trade: BotTrade = {
            id: `OANDA-${result.trade.oandaTradeId}`,
            ...result.trade,
            pnl: 0,
            pnlPips: 0,
            setupType: rankedDecision.setupType || "EMA_STACK",
            confidence: rankedDecision.confidence,
            reasoning: `${rankedDecision.reasoning}. Ordine e trade verificati tramite OANDA Practice.`,
            status: "OPEN",
            verificationStatus: "VERIFIED"
          };
          botState.dailyTradeCount += 1;
          cycle.opened += 1;
          botState.openTrades = [trade, ...botState.openTrades].slice(0, MAX_OPEN_POSITIONS);
          botState.accountCurrency = trade.accountCurrency;
          botState.entryPrice = trade.entryPrice;
          botState.stopLoss = trade.stopLoss;
          botState.takeProfit = trade.takeProfit;
          pushLog(`[${symbol}] OANDA OPEN VERIFIED | ${trade.side} ${trade.units} | trade ID ${trade.oandaTradeId}`);
        } else {
          botState.signalsDiscarded += 1;
          pushLog(`[${symbol}] ${result.status}: ${result.reason}`);
        }
      } else {
        const trade = buildTrade(symbol, rankedDecision, enrichedMarketData);
        botState.dailyTradeCount += 1;
        cycle.opened += 1;
        botState.openTrades = [trade, ...botState.openTrades].slice(0, MAX_OPEN_POSITIONS);
        pushLog(
          `[${symbol}] PAPER ${rankedDecision.action} | ${rankedDecision.confidence}% | ${rankedDecision.reasoning}`
        );
      }
    } else {
      pushLog(`[${symbol}] trade skipped due to risk caps`);
    }

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
    if (scanInProgress) pushLog("Market scan skipped: previous five-minute cycle is still running");
    return;
  }

  scanInProgress = true;
  const generation = runGeneration;
  const cycle = { opened: 0, checked: 0 };
  pushLog(`Starting market scan: 15 FX + XAUUSD | maximum ${MAX_NEW_TRADES_PER_CYCLE} valid new entries`);

  try {
    if (liveExecutionActive()) {
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
    pushLog(`Market scan complete: ${cycle.checked}/${SYMBOLS.length} instruments checked, ${cycle.opened} new ${liveExecutionActive() ? "OANDA" : "PAPER"} trades`);
  } finally {
    scanInProgress = false;
  }
}

async function monitorTrades() {
  if (liveExecutionActive()) {
    await reconcileLiveTrades();
    return;
  }

  if (botState.openTrades.length > 0) {
    const stillOpen: BotTrade[] = [];
    const justClosed: BotTrade[] = [];

    for (const trade of botState.openTrades) {
      const multiplier = pipMultiplier(trade.symbol);
      const priceData = await oanda.getPrice(trade.symbol);
      const currentPrice = Number(trade.side === "SELL"
        ? priceData?.asks?.[0]?.price ?? priceData?.closeoutAsk
        : priceData?.bids?.[0]?.price ?? priceData?.closeoutBid);

      if (!Number.isFinite(currentPrice) || currentPrice <= 0) {
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
      const fillPrice = hitTakeProfit
        ? trade.takeProfit ?? currentPrice
        : hitStopLoss
          ? trade.stopLoss ?? currentPrice
          : currentPrice;
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
        pushLog(`[${trade.symbol}] ${trade.closeReason} | paper P&L ${trade.pnlCurrency || "quote currency"} ${trade.pnl.toFixed(2)}`);
      });
    }

    botState.openTrades = stillOpen;
    botState.lastUpdated = new Date().toISOString();
    emitState();
  }
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
      if (status.connected && liveExecutionActive()) {
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
  pushLog(`Daily Target: ${DAILY_TARGET}`);
  pushLog(`Max Daily Trades: ${MAX_DAILY_TRADES}`);
  pushLog(`Max Open Positions: ${MAX_OPEN_POSITIONS}`);
  pushLog(`Max New Trades Per Cycle: ${MAX_NEW_TRADES_PER_CYCLE}`);
  pushLog(liveExecutionActive()
    ? "Execution: LIVE OANDA PRACTICE. Every trade requires OANDA order ID and verified trade ID."
    : "Execution: PAPER TRADING ONLY. OANDA orders disabled.");
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
