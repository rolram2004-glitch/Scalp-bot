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

const SIGNAL_INTERVAL = 60000;
const CLOSE_INTERVAL = 5000;

const MAX_DAILY_TRADES = 1000;
const DAILY_TARGET = 800;
const MAX_OPEN_POSITIONS = 15;
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
}

export interface BotSnapshot {
  status: "ONLINE" | "OFFLINE";
  isRunning: boolean;
  startedAt?: string;
  lastUpdated?: string;
  dataSource: string;
  oandaConnected: boolean;
  oandaReason?: string;
  executionMode: string;
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
}

const botState: BotSnapshot = {
  status: "OFFLINE",
  isRunning: false,
  dataSource: "OANDA_UNAVAILABLE",
  oandaConnected: false,
  executionMode: config.TRADING_MODE === "LIVE" && config.LIVE_TRADING_ENABLED ? "LIVE OANDA" : "PAPER",
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
  ,marketData: {}
};

const listeners = new Set<(snapshot: BotSnapshot) => void>();
let signalTimer: ReturnType<typeof setInterval> | undefined;
let closeTimer: ReturnType<typeof setInterval> | undefined;

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
        riskAmount: Number(config.NORMAL_STOP_LOSS_USD || 1.2),
        rewardAmount: Number(config.NORMAL_TAKE_PROFIT_USD || 2.4)
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

function hasOpenTradeForSymbol(symbol: string) {
  const normalized = cleanSymbol(symbol);
  return botState.openTrades.some((trade) => cleanSymbol(trade.symbol) === normalized);
}

function buildTrade(
  symbol: string,
  decision: TradingDecision,
  marketData: MarketData
): BotTrade {
  const entryPrice = decision.entryPrice ?? marketData.closePrice;
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
    reasoning: `${decision.reasoning}. Paper trading only, units ${tradeUnits(symbol)}, RR 1:2, risk ${riskAmount.toFixed(2)}, target ${rewardAmount.toFixed(2)}.`,
    status: "OPEN"
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
  const closed = botState.closedTrades || [];
  const open = botState.openTrades || [];

  const todaysClosed = closed.filter((t) => isToday(t.openedAt) || isToday(t.closedAt));

  const pnlToday = todaysClosed.reduce((s, t) => s + (t.pnl || 0), 0) + open.reduce((s, t) => s + (t.pnl || 0), 0);

  const wins = closed.filter((t) => (t.pnl || 0) > 0).length;
  const losses = closed.filter((t) => (t.pnl || 0) <= 0).length;
  const winRate = closed.length > 0 ? Math.round((wins / closed.length) * 1000) / 10 : 0;

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
    winRate,
    wins,
    losses,
    totalTrades: closed.length,
    openTrades: open.length,
    distribution,
    tradesPerDay: perDay
  };
}

async function scanSymbol(symbol: string) {
  try {
    const analytics = getAnalytics();
    if (analytics.pnlToday <= -MAX_DAILY_LOSS) {
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
    botState.currentPrice = enrichedMarketData.closePrice;
    botState.entryPrice = rankedDecision.entryPrice ?? enrichedMarketData.closePrice;
    const signalDirection = rankedDecision.action === "SELL" ? -1 : 1;
    const cash = cashRules(symbol);
    botState.stopLoss = enrichedMarketData.closePrice - signalDirection * priceDistanceForCash(symbol, cash.riskAmount);
    botState.takeProfit = enrichedMarketData.closePrice + signalDirection * priceDistanceForCash(symbol, cash.rewardAmount);
    botState.riskAmount = cash.riskAmount;
    botState.rewardAmount = cash.rewardAmount;
    botState.profitLoss = 0;
    botState.session = session;
    botState.killzone = killzone;
    botState.lastUpdated = new Date().toISOString();

    if (rankedDecision.action === "HOLD" || rankedDecision.confidence < 50) {
      botState.signalsDiscarded += 1;

      const sameSymbolIndex = botState.openTrades.findIndex((trade) => trade.symbol === symbol);
      if (sameSymbolIndex >= 0) {
        const lastTrade = botState.openTrades[sameSymbolIndex];
        const multiplier = pipMultiplier(lastTrade.symbol);
        lastTrade.status = "CLOSED";
        lastTrade.currentPrice = enrichedMarketData.closePrice;
        lastTrade.pnl = calculatePaperPnl(lastTrade.symbol, lastTrade.side, lastTrade.entryPrice, enrichedMarketData.closePrice);
        lastTrade.pnlPips = lastTrade.side === "BUY"
          ? (enrichedMarketData.closePrice - lastTrade.entryPrice) * multiplier
          : (lastTrade.entryPrice - enrichedMarketData.closePrice) * multiplier;
        lastTrade.closedAt = new Date().toISOString();
        lastTrade.closeReason = "SIGNAL EXIT";

        botState.closedTrades = [lastTrade, ...botState.closedTrades].slice(0, 80);
        botState.openTrades = botState.openTrades.filter((_, index) => index !== sameSymbolIndex);
      }

      pushLog(
        `[${symbol}] ${rankedDecision.action} | ${rankedDecision.confidence}% | ${rankedDecision.reasoning}`
      );
    } else if (hasOpenTradeForSymbol(symbol)) {
      botState.signalsDiscarded += 1;
      pushLog(`[${symbol}] trade skipped: one open paper trade per symbol is already active`);
    } else if (canOpenTrade(botState.dailyTradeCount, botState.openTrades.length)) {
      const trade = buildTrade(symbol, rankedDecision, enrichedMarketData);
      botState.dailyTradeCount += 1;
      botState.openTrades = [trade, ...botState.openTrades].slice(0, MAX_OPEN_POSITIONS);

      pushLog(
        `[${symbol}] ${rankedDecision.action} | ${rankedDecision.confidence}% | ${rankedDecision.reasoning}`
      );
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
  if (!botState.isRunning) {
    return;
  }

  pushLog("Starting market scan...");

  for (const symbol of SYMBOLS) {
    await scanSymbol(symbol);
  }

  pushLog("Market scan complete");
}

async function monitorTrades() {
  if (botState.openTrades.length > 0) {
    const stillOpen: BotTrade[] = [];
    const justClosed: BotTrade[] = [];

    for (const trade of botState.openTrades) {
      const multiplier = pipMultiplier(trade.symbol);
      const priceData = await oanda.getPrice(trade.symbol);
      const currentPrice = Number(
        priceData?.closeoutBid ?? priceData?.closeoutAsk ?? priceData?.bids?.[0]?.price ?? priceData?.asks?.[0]?.price
      );

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
      const pnl = hitTakeProfit
        ? Number(trade.rewardAmount || cashRules(trade.symbol).rewardAmount)
        : hitStopLoss
          ? -Number(trade.riskAmount || cashRules(trade.symbol).riskAmount)
          : calculatePaperPnl(trade.symbol, trade.side, trade.entryPrice, currentPrice);

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
        pushLog(`[${trade.symbol}] ${trade.closeReason} | paper P&L ${trade.pnl.toFixed(2)}`);
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
  botState.startedAt = new Date().toISOString();
  botState.lastUpdated = botState.startedAt;

  (async () => {
    try {
      const status = await oanda.getConnectionStatus();
      botState.oandaConnected = Boolean(status.connected);
      botState.oandaReason = status.reason;
      botState.dataSource = status.connected ? "OANDA MARKET DATA" : "OANDA_UNAVAILABLE";
      pushLog(status.connected ? "OANDA connected: real prices only" : "OANDA not connected: no market data will be invented");
      emitState();
    } catch (e) {
      botState.oandaConnected = false;
      botState.oandaReason = "status_error";
      botState.dataSource = "OANDA_UNAVAILABLE";
      pushLog("OANDA status check failed: no market data will be invented");
      emitState();
    }
  })();

  pushLog("=================================");
  pushLog("AUTONOMOUS BOT STARTED");
  pushLog(`Symbols: ${SYMBOLS.length}`);
  pushLog(`Daily Target: ${DAILY_TARGET}`);
  pushLog(`Max Daily Trades: ${MAX_DAILY_TRADES}`);
  pushLog(`Max Open Positions: ${MAX_OPEN_POSITIONS}`);
  pushLog("Execution: PAPER TRADING ONLY. Live orders disabled.");
  pushLog("=================================");

  void scanAllSymbols();

  if (signalTimer) clearInterval(signalTimer);
  if (closeTimer) clearInterval(closeTimer);

  signalTimer = setInterval(() => {
    void scanAllSymbols();
  }, SIGNAL_INTERVAL);

  closeTimer = setInterval(() => {
    void monitorTrades();
  }, CLOSE_INTERVAL);
}

export function stopAutonomousBot() {
  if (signalTimer) clearInterval(signalTimer);
  if (closeTimer) clearInterval(closeTimer);
  signalTimer = undefined;
  closeTimer = undefined;
  botState.status = "OFFLINE";
  botState.isRunning = false;
  botState.lastUpdated = new Date().toISOString();
  pushLog("AUTONOMOUS BOT STOPPED");
  emitState();
}
