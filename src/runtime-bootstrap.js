"use strict";

require("dotenv").config();

const environment = String(process.env.OANDA_ENVIRONMENT || "PRACTICE").trim().toUpperCase();
const requestedMode = String(process.env.TRADING_MODE || "PAPER").trim().toUpperCase();
const hasPracticeCredentials = Boolean(
  String(process.env.OANDA_API_KEY || "").trim() &&
  String(process.env.OANDA_ACCOUNT_ID || "").trim()
);
const forcePaper = process.env.FORCE_PAPER_MODE === "true";
const hasOpenAiKey = Boolean(String(process.env.OPENAI_API_KEY || "").trim());

// Automatically use only the OANDA Practice account when valid demo credentials exist.
// This never promotes the service to OANDA_LIVE and never bypasses real-money safeguards.
if (
  environment === "PRACTICE" &&
  requestedMode !== "OANDA_LIVE" &&
  hasPracticeCredentials &&
  !forcePaper
) {
  process.env.TRADING_MODE = "OANDA_DEMO";
  process.env.OANDA_ORDER_EXECUTION_ENABLED = "true";
  // This Practice deployment is intentionally the CONTRARIO/MIRROR lane. The
  // old strategy still decides the signal, but only the opposite direction is
  // submitted. Protective prices are derived from fixed CHF amounts after the
  // broker quote/fill is known; the old 20/10-pip levels are never submitted.
  process.env.PRACTICE_EXECUTION_VARIANT = "INVERSE";
  process.env.LIVE_EXECUTION_VARIANT = "INVERSE";
  process.env.DEFAULT_UNITS = "1000";
  process.env.ACCOUNT_TARGET_CURRENCY = "CHF";
  process.env.NORMAL_STOP_LOSS_ACCOUNT = "1.2";
  process.env.NORMAL_TAKE_PROFIT_ACCOUNT = "0.2";
}

// ROHATO_ULTRA_100_PER_MINUTE is enabled only on Practice. It evaluates all 15
// executable FX pairs every second, can submit one candidate per symbol in a
// cycle and permits at most 100 entries per rolling minute. Broker
// verification, one open position per symbol and daily-loss protection remain
// mandatory. OANDA_LIVE and PAPER keep their separate hard caps in config.js.
const effectiveMode = String(process.env.TRADING_MODE || requestedMode).trim().toUpperCase();
process.env.MAX_DAILY_TRADES = effectiveMode === "OANDA_DEMO" ? "15000" : effectiveMode === "OANDA_LIVE" ? "25" : "100";
process.env.MAX_DAILY_TRADES_PER_SYMBOL = effectiveMode === "OANDA_DEMO" ? "1000" : effectiveMode === "OANDA_LIVE" ? "25" : "100";
process.env.MAX_TRADES_PER_MINUTE = effectiveMode === "OANDA_DEMO" ? "100" : effectiveMode === "OANDA_LIVE" ? "25" : "100";
process.env.MAX_NEW_TRADES_PER_CYCLE = effectiveMode === "OANDA_DEMO" ? "15" : "7";
process.env.MAX_OPEN_POSITIONS = "15";
process.env.SCAN_INTERVAL_MS = effectiveMode === "OANDA_DEMO" ? "1000" : "30000";
process.env.POSITION_MANAGEMENT_INTERVAL_MS = "5000";
process.env.SYMBOL_REENTRY_COOLDOWN_MS = effectiveMode === "OANDA_DEMO" ? "0" : "600000";
process.env.MIN_SIGNAL_CONFIDENCE = effectiveMode === "OANDA_DEMO" ? "45" : hasOpenAiKey ? "50" : "55";
process.env.FOREX_SIGNAL_PROFILE = effectiveMode === "OANDA_DEMO"
  ? "ROHATO_ULTRA_100_PER_MINUTE"
  : "ROHATO_AGGRESSIVE_100";
process.env.NORMAL_STOP_LOSS_PIPS = "10";
process.env.NORMAL_TAKE_PROFIT_PIPS = "20";

if (hasOpenAiKey) {
  process.env.AI_PROVIDER = "OPENAI";
  process.env.AI_CONFIRMATION_REQUIRED = "true";
  process.env.AI_MIN_CONFIDENCE = String(effectiveMode === "OANDA_DEMO" ? "50" : process.env.AI_MIN_CONFIDENCE || "58");
  process.env.OPENAI_MODEL = String(process.env.OPENAI_MODEL || "gpt-5-mini");
}

require("ts-node/register/transpile-only");

const config = require("./config");
const aiConfirmation = require("./ai-confirmation");
const { installOpenAiTradeBrain } = require("./openai-trade-brain");
const openAiBrainEnabled = installOpenAiTradeBrain({ aiConfirmation, config });

const oanda = require("./oanda");
const originalGetPrices = oanda.getPrices.bind(oanda);
const originalGetPrice = oanda.getPrice.bind(oanda);

function normalizeOandaSymbol(symbol) {
  const compact = String(symbol || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return compact.length === 6 ? `${compact.slice(0, 3)}_${compact.slice(3)}` : compact;
}

// Recover symbols one by one if a bulk OANDA pricing call fails. No synthetic prices.
oanda.getPrices = async function resilientGetPrices(symbols) {
  const requested = Array.isArray(symbols) ? symbols : [symbols];
  const bulk = await originalGetPrices(requested);
  if (Array.isArray(bulk) && bulk.length > 0) return bulk;
  const recovered = await Promise.all(
    requested.map(async (symbol) => {
      try { return await originalGetPrice(symbol); } catch (_error) { return null; }
    })
  );
  return recovered.filter(Boolean);
};

console.log(
  `[BOOTSTRAP] mode=${process.env.TRADING_MODE || "PAPER"} environment=${environment} ` +
  `orders=${process.env.OANDA_ORDER_EXECUTION_ENABLED === "true" ? "enabled" : "disabled"} ` +
  `brain=${openAiBrainEnabled ? `OPENAI:${config.OPENAI_MODEL}` : "DETERMINISTIC"} ` +
  `profile=${config.FOREX_SIGNAL_PROFILE} scan=${config.SCAN_INTERVAL / 1000}s forex=15 confidence=${config.MIN_CONFIDENCE} ` +
  `maxNew=${config.MAX_NEW_TRADES_PER_CYCLE} maxOpen=15 cooldown=${config.SYMBOL_REENTRY_COOLDOWN_MS / 60000}m ` +
  `MIRROR=TP+0.20CHF/SL-1.20CHF units=1000 exits=SL_TP_ONLY ` +
  `maxMinute=${config.MAX_TRADES_PER_MINUTE} maxDaily=${config.MAX_DAILY_TRADES} ` +
  `maxDailyPerSymbol=${config.MAX_DAILY_TRADES_PER_SYMBOL}`
);
