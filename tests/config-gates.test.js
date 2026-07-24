const test = require("node:test");
const assert = require("node:assert/strict");

function readConfig(env) {
  const previous = {
    TRADING_MODE: process.env.TRADING_MODE,
    OANDA_ENVIRONMENT: process.env.OANDA_ENVIRONMENT,
    OANDA_ORDER_EXECUTION_ENABLED: process.env.OANDA_ORDER_EXECUTION_ENABLED,
    OANDA_LIVE_CONFIRMATION: process.env.OANDA_LIVE_CONFIRMATION,
    LIVE_TRADING_ENABLED: process.env.LIVE_TRADING_ENABLED,
    LIVE_EXECUTION_VARIANT: process.env.LIVE_EXECUTION_VARIANT
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
  assert.equal(invalid.LIVE_TRADING_ENABLED, true);
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

