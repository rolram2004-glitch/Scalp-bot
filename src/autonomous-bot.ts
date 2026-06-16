import { getScalpingSignal } from "./trading-ai";
import { generateMarketData } from "./market-engine";

const SYMBOLS = [
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
const CLOSE_INTERVAL = 20000;

const MAX_DAILY_TRADES = 1000;
const DAILY_TARGET = 800;
const MAX_OPEN_POSITIONS = 15;

async function scanSymbol(symbol: string) {
  try {
    const marketData = generateMarketData(symbol);

    const decision = await getScalpingSignal(
      marketData
    );

    console.log(
      `[${symbol}] ${decision.action} | ${decision.confidence}% | ${decision.reasoning}`
    );

    return decision;
  } catch (error) {
    console.error(`Error scanning ${symbol}`, error);

    return {
      action: "HOLD",
      confidence: 0,
      reasoning: "Scan error"
    };
  }
}

async function scanAllSymbols() {
  console.log("Starting market scan...");

  for (const symbol of SYMBOLS) {
    await scanSymbol(symbol);
  }

  console.log("Market scan complete");
}

async function monitorTrades() {
  console.log("Monitoring open trades...");
}

export function startAutonomousBot() {
  console.log("=================================");
  console.log("AUTONOMOUS BOT STARTED");
  console.log("Symbols:", SYMBOLS.length);
  console.log("Daily Target:", DAILY_TARGET);
  console.log("Max Daily Trades:", MAX_DAILY_TRADES);
  console.log("Max Open Positions:", MAX_OPEN_POSITIONS);
  console.log("=================================");

  scanAllSymbols();

  setInterval(() => {
    scanAllSymbols();
  }, SIGNAL_INTERVAL);

  setInterval(() => {
    monitorTrades();
  }, CLOSE_INTERVAL);
}
