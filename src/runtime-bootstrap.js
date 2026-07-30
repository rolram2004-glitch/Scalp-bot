"use strict";

require("dotenv").config();

const environment = String(process.env.OANDA_ENVIRONMENT || "PRACTICE").trim().toUpperCase();
const requestedMode = String(process.env.TRADING_MODE || "PAPER").trim().toUpperCase();
const hasPracticeCredentials = Boolean(
  String(process.env.OANDA_API_KEY || "").trim() &&
  String(process.env.OANDA_ACCOUNT_ID || "").trim()
);
const forcePaper = process.env.FORCE_PAPER_MODE === "true";

// The user explicitly requested automatic execution on the OANDA Practice account.
// This never promotes a service to OANDA_LIVE and never overrides LIVE safeguards.
if (
  environment === "PRACTICE" &&
  requestedMode !== "OANDA_LIVE" &&
  hasPracticeCredentials &&
  !forcePaper
) {
  process.env.TRADING_MODE = "OANDA_DEMO";
  process.env.OANDA_ORDER_EXECUTION_ENABLED = "true";
  process.env.LIVE_EXECUTION_VARIANT = ["MAIN", "INVERSE"].includes(
    String(process.env.LIVE_EXECUTION_VARIANT || "MAIN").trim().toUpperCase()
  )
    ? String(process.env.LIVE_EXECUTION_VARIANT || "MAIN").trim().toUpperCase()
    : "MAIN";
}

// The project requirement is a ceiling of 1000 trades per UTC day.
process.env.MAX_DAILY_TRADES = "1000";

// Prime and patch the shared OANDA instance before server.js imports the bot.
// A bulk pricing request can fail when one account instrument is temporarily
// unavailable. Recover symbols one by one without inventing prices.
const oanda = require("./oanda");
const originalGetPrices = oanda.getPrices.bind(oanda);
const originalGetPrice = oanda.getPrice.bind(oanda);

oanda.getPrices = async function resilientGetPrices(symbols) {
  const requested = Array.isArray(symbols) ? symbols : [symbols];
  const bulk = await originalGetPrices(requested);
  if (Array.isArray(bulk) && bulk.length > 0) return bulk;

  const recovered = await Promise.all(
    requested.map(async (symbol) => {
      try {
        return await originalGetPrice(symbol);
      } catch (_error) {
        return null;
      }
    })
  );

  return recovered.filter(Boolean);
};

console.log(
  `[BOOTSTRAP] mode=${process.env.TRADING_MODE || "PAPER"} environment=${environment} ` +
  `orders=${process.env.OANDA_ORDER_EXECUTION_ENABLED === "true" ? "enabled" : "disabled"} maxDaily=1000`
);
