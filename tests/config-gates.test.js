const test = require("node:test");
const assert = require("node:assert/strict");

function readConfig(env) {
  const previous = {
    TRADING_MODE: process.env.TRADING_MODE,
    OANDA_ENVIRONMENT: process.env.OANDA_ENVIRONMENT,
    OANDA_ORDER_EXECUTION_ENABLED: process.env.OANDA_ORDER_EXECUTION_ENABLED,
    OANDA_LIVE_CONFIRMATION: process.env.OANDA_LIVE_CONFIRMATION,
    LIVE_TRADING_ENABLED: process.env.LIVE_TRADING_ENABLED,
    LIVE_EXECUTION_VARIANT: process.env.LIVE_EXECUTION_VARIANT,
    MAX_OPEN_POSITIONS: process.env.MAX_OPEN_POSITIONS,
    MAX_NEW_TRADES_PER_CYCLE: process.env.MAX_NEW_TRADES_PER_CYCLE,
    MAX_DAILY_TRADES: process.env.MAX_DAILY_TRADES,
    MAX_DAILY_TRADES_PER_SYMBOL: process.env.MAX_DAILY_TRADES_PER_SYMBOL,
    MAX_TRADES_PER_MINUTE: process.env.MAX_TRADES_PER_MINUTE,
    SCAN_INTERVAL_MS: process.env.SCAN_INTERVAL_MS,
    SYMBOL_REENTRY_COOLDOWN_MS: process.env.SYMBOL_REENTRY_COOLDOWN_MS,
    MIN_SIGNAL_CONFIDENCE: process.env.MIN_SIGNAL_CONFIDENCE,
    FOREX_SIGNAL_PROFILE: process.env.FOREX_SIGNAL_PROFILE,
    DEFAULT_UNITS: process.env.DEFAULT_UNITS,
    NORMAL_STOP_LOSS_ACCOUNT: process.env.NORMAL_STOP_LOSS_ACCOUNT,
    NORMAL_TAKE_PROFIT_ACCOUNT: process.env.NORMAL_TAKE_PROFIT_ACCOUNT,
    ACCOUNT_TARGET_CURRENCY: process.env.ACCOUNT_TARGET_CURRENCY,
    MAX_RISK_PERCENT: process.env.MAX_RISK_PERCENT,
    DAILY_LOSS_LIMIT_ENABLED: process.env.DAILY_LOSS_LIMIT_ENABLED,
    MAX_DAILY_LOSS: process.env.MAX_DAILY_LOSS,
    AI_PROVIDER: process.env.AI_PROVIDER,
    AI_CONFIRMATION_REQUIRED: process.env.AI_CONFIRMATION_REQUIRED,
    AI_MIN_CONFIDENCE: process.env.AI_MIN_CONFIDENCE,
    GEMINI_MODEL: process.env.GEMINI_MODEL
  };
  Object.assign(process.env, env);
  delete require.cache[require.resolve("../src/config")];
  const config = require("../src/config");

  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  delete require.cache[require.resolve("../src/config")];
  return config;
}

test("OANDA_DEMO requires Practice, enable flag and one explicit execution variant", () => {
  const disabled = readConfig({
    TRADING_MODE: "OANDA_DEMO",
    OANDA_ENVIRONMENT: "PRACTICE",
    OANDA_ORDER_EXECUTION_ENABLED: "false",
    LIVE_TRADING_ENABLED: "false",
    LIVE_EXECUTION_VARIANT: "MAIN"
  });
  assert.equal(disabled.TRADING_MODE, "OANDA_DEMO");
  assert.equal(disabled.LIVE_TRADING_ENABLED, false);
  assert.equal(disabled.LIVE_EXECUTION_VARIANT_VALID, true);

  const invalid = readConfig({
    TRADING_MODE: "OANDA_DEMO",
    OANDA_ENVIRONMENT: "PRACTICE",
    OANDA_ORDER_EXECUTION_ENABLED: "true",
    LIVE_TRADING_ENABLED: "true",
    LIVE_EXECUTION_VARIANT: "BOTH"
  });
  assert.equal(invalid.LIVE_TRADING_ENABLED, false);
  assert.equal(invalid.LIVE_EXECUTION_VARIANT, "INVALID");
  assert.equal(invalid.LIVE_EXECUTION_VARIANT_VALID, false);

  const inverse = readConfig({
    TRADING_MODE: "OANDA_DEMO",
    OANDA_ENVIRONMENT: "PRACTICE",
    OANDA_ORDER_EXECUTION_ENABLED: "true",
    LIVE_TRADING_ENABLED: "true",
    LIVE_EXECUTION_VARIANT: "INVERSE"
  });
  assert.equal(inverse.LIVE_TRADING_ENABLED, true);
  assert.equal(inverse.LIVE_EXECUTION_VARIANT, "INVERSE");
  assert.equal(inverse.LIVE_EXECUTION_VARIANT_VALID, true);
});

test("missing execution lane and OANDA_LIVE without explicit confirmation fail closed", () => {
  const missingLane = readConfig({
    TRADING_MODE: "OANDA_DEMO",
    OANDA_ENVIRONMENT: "PRACTICE",
    OANDA_ORDER_EXECUTION_ENABLED: "true",
    LIVE_TRADING_ENABLED: "false",
    LIVE_EXECUTION_VARIANT: ""
  });
  assert.equal(missingLane.OANDA_ORDER_EXECUTION_ENABLED, true);
  assert.equal(missingLane.LIVE_TRADING_ENABLED, false);
  assert.equal(missingLane.LIVE_EXECUTION_VARIANT, "INVALID");
  assert.equal(missingLane.LIVE_EXECUTION_VARIANT_VALID, false);

  const unconfirmedLive = readConfig({
    TRADING_MODE: "OANDA_LIVE",
    OANDA_ENVIRONMENT: "LIVE",
    OANDA_ORDER_EXECUTION_ENABLED: "true",
    LIVE_TRADING_ENABLED: "false",
    LIVE_EXECUTION_VARIANT: "MAIN",
    OANDA_LIVE_CONFIRMATION: ""
  });
  assert.equal(unconfirmedLive.OANDA_ENVIRONMENT_VALID, true);
  assert.equal(unconfirmedLive.OANDA_ORDER_EXECUTION_ENABLED, true);
  assert.equal(unconfirmedLive.LIVE_TRADING_ENABLED, false);
  assert.equal(unconfirmedLive.OANDA_LIVE_CONFIRMED, false);
});

test("invalid numeric risk limits fall back to bounded safe values", () => {
  const config = readConfig({
    TRADING_MODE: "PAPER",
    MAX_OPEN_POSITIONS: "not-a-number",
    MAX_NEW_TRADES_PER_CYCLE: "999",
    MAX_DAILY_TRADES: "-4",
    MAX_RISK_PERCENT: "invalid",
    MAX_DAILY_LOSS: "invalid"
  });

  assert.equal(config.MAX_OPEN_TRADES, 15);
  assert.equal(config.MAX_NEW_TRADES_PER_CYCLE, 7);
  assert.equal(config.MAX_DAILY_TRADES, 1);
  assert.equal(config.RISK_PERCENT, 0.25);
  assert.equal(config.MAX_DAILY_LOSS, 50);
});

test("Rohato ultra Practice profile scans every second and enforces the 100-per-minute cap", () => {
  const config = readConfig({
    TRADING_MODE: "OANDA_DEMO",
    OANDA_ENVIRONMENT: "PRACTICE",
    OANDA_ORDER_EXECUTION_ENABLED: "true",
    LIVE_EXECUTION_VARIANT: "MAIN",
    SCAN_INTERVAL_MS: "500",
    SYMBOL_REENTRY_COOLDOWN_MS: "0",
    MIN_SIGNAL_CONFIDENCE: "45",
    MAX_NEW_TRADES_PER_CYCLE: "99",
    MAX_OPEN_POSITIONS: "15",
    MAX_DAILY_TRADES: "99999",
    MAX_DAILY_TRADES_PER_SYMBOL: "9999",
    MAX_TRADES_PER_MINUTE: "999",
    FOREX_SIGNAL_PROFILE: "ROHATO_ULTRA_100_PER_MINUTE"
  });

  assert.equal(config.LIVE_TRADING_ENABLED, true);
  assert.equal(config.SCAN_INTERVAL, 1000);
  assert.equal(config.SYMBOL_REENTRY_COOLDOWN_MS, 0);
  assert.equal(config.MIN_CONFIDENCE, 45);
  assert.equal(config.MAX_NEW_TRADES_PER_CYCLE, 15);
  assert.equal(config.MAX_OPEN_TRADES, 15);
  assert.equal(config.MAX_DAILY_TRADES, 15000);
  assert.equal(config.MAX_DAILY_TRADES_PER_SYMBOL, 1000);
  assert.equal(config.MAX_TRADES_PER_MINUTE, 100);
  assert.equal(config.MAX_TRADES_PER_SYMBOL, 1);
  assert.equal(config.FOREX_SIGNAL_PROFILE, "ROHATO_ULTRA_100_PER_MINUTE");
  assert.equal(config.DAILY_LOSS_LIMIT_ENABLED, false);
});

test("NORMAL Practice keeps direction with SL 0.30 CHF and TP 0.03 CHF", () => {
  const config = readConfig({
    TRADING_MODE: "OANDA_DEMO",
    OANDA_ENVIRONMENT: "PRACTICE",
    OANDA_ORDER_EXECUTION_ENABLED: "true",
    LIVE_EXECUTION_VARIANT: "MAIN",
    DEFAULT_UNITS: "1000",
    NORMAL_STOP_LOSS_ACCOUNT: "0.3",
    NORMAL_TAKE_PROFIT_ACCOUNT: "0.03",
    ACCOUNT_TARGET_CURRENCY: "chf"
  });

  assert.equal(config.DEFAULT_UNITS, 1000);
  assert.equal(config.NORMAL_STOP_LOSS_ACCOUNT, 0.3);
  assert.equal(config.NORMAL_TAKE_PROFIT_ACCOUNT, 0.03);
  assert.equal(config.ACCOUNT_TARGET_CURRENCY, "CHF");
});

test("PAPER daily trade cap cannot be raised above 100 by a stale Railway variable", () => {
  const config = readConfig({
    TRADING_MODE: "PAPER",
    MAX_DAILY_TRADES: "999999"
  });

  assert.equal(config.MAX_DAILY_TRADES, 100);
});

test("real-money OANDA_LIVE remains hard capped at 25", () => {
  const config = readConfig({
    TRADING_MODE: "OANDA_LIVE",
    OANDA_ENVIRONMENT: "LIVE",
    OANDA_ORDER_EXECUTION_ENABLED: "true",
    OANDA_LIVE_CONFIRMATION: "I_CONFIRM_REAL_MONEY",
    LIVE_EXECUTION_VARIANT: "MAIN",
    MAX_DAILY_TRADES: "100"
  });

  assert.equal(config.LIVE_TRADING_ENABLED, true);
  assert.equal(config.MAX_DAILY_TRADES, 25);
  assert.equal(config.MAX_DAILY_TRADES_PER_SYMBOL, 25);
  assert.equal(config.MAX_TRADES_PER_MINUTE, 25);
  assert.equal(config.DAILY_LOSS_LIMIT_ENABLED, true);
});

test("Gemini remains disabled by default and parses only explicit safe configuration", () => {
  const disabled = readConfig({
    TRADING_MODE: "PAPER",
    AI_PROVIDER: "unknown",
    AI_CONFIRMATION_REQUIRED: "false",
    GEMINI_MODEL: "../../bad-model"
  });
  assert.equal(disabled.AI_PROVIDER, "DISABLED");
  assert.equal(disabled.AI_CONFIRMATION_REQUIRED, false);
  assert.equal(disabled.GEMINI_MODEL, "gemini-3.5-flash-lite");

  const configured = readConfig({
    TRADING_MODE: "PAPER",
    AI_PROVIDER: "GEMINI",
    AI_CONFIRMATION_REQUIRED: "true",
    AI_MIN_CONFIDENCE: "72",
    GEMINI_MODEL: "gemini-3.6-flash"
  });
  assert.equal(configured.AI_PROVIDER, "GEMINI");
  assert.equal(configured.AI_CONFIRMATION_REQUIRED, true);
  assert.equal(configured.AI_MIN_CONFIDENCE, 72);
  assert.equal(configured.GEMINI_MODEL, "gemini-3.6-flash");

  const openai = readConfig({
    TRADING_MODE: "PAPER",
    AI_PROVIDER: "OPENAI",
    AI_CONFIRMATION_REQUIRED: "true"
  });
  assert.equal(openai.AI_PROVIDER, "OPENAI");
  assert.equal(openai.AI_CONFIRMATION_REQUIRED, true);
});
