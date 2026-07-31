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
    SCAN_INTERVAL_MS: process.env.SCAN_INTERVAL_MS,
    MIN_SIGNAL_CONFIDENCE: process.env.MIN_SIGNAL_CONFIDENCE,
    FOREX_SIGNAL_PROFILE: process.env.FOREX_SIGNAL_PROFILE,
    MAX_RISK_PERCENT: process.env.MAX_RISK_PERCENT,
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

test("Rohato Practice profile accepts 30 second scans and caps the demo day at 100", () => {
  const config = readConfig({
    TRADING_MODE: "OANDA_DEMO",
    OANDA_ENVIRONMENT: "PRACTICE",
    OANDA_ORDER_EXECUTION_ENABLED: "true",
    LIVE_EXECUTION_VARIANT: "MAIN",
    SCAN_INTERVAL_MS: "30000",
    MIN_SIGNAL_CONFIDENCE: "55",
    MAX_NEW_TRADES_PER_CYCLE: "7",
    MAX_OPEN_POSITIONS: "15",
    MAX_DAILY_TRADES: "1000",
    FOREX_SIGNAL_PROFILE: "ROHATO_AGGRESSIVE_100"
  });

  assert.equal(config.LIVE_TRADING_ENABLED, true);
  assert.equal(config.SCAN_INTERVAL, 30000);
  assert.equal(config.MIN_CONFIDENCE, 55);
  assert.equal(config.MAX_NEW_TRADES_PER_CYCLE, 7);
  assert.equal(config.MAX_OPEN_TRADES, 15);
  assert.equal(config.MAX_DAILY_TRADES, 100);
  assert.equal(config.MAX_TRADES_PER_SYMBOL, 1);
  assert.equal(config.FOREX_SIGNAL_PROFILE, "ROHATO_AGGRESSIVE_100");
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
