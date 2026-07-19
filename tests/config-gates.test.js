const test = require("node:test");
const assert = require("node:assert/strict");

function readConfig(env) {
  const previous = {
    TRADING_MODE: process.env.TRADING_MODE,
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

test("LIVE requires both enable flag and one exact execution variant", () => {
  const disabled = readConfig({
    TRADING_MODE: "LIVE",
    LIVE_TRADING_ENABLED: "false",
    LIVE_EXECUTION_VARIANT: "MAIN"
  });
  assert.equal(disabled.TRADING_MODE, "LIVE");
  assert.equal(disabled.LIVE_TRADING_ENABLED, false);
  assert.equal(disabled.LIVE_EXECUTION_VARIANT_VALID, true);

  const invalid = readConfig({
    TRADING_MODE: "LIVE",
    LIVE_TRADING_ENABLED: "true",
    LIVE_EXECUTION_VARIANT: "BOTH"
  });
  assert.equal(invalid.LIVE_TRADING_ENABLED, true);
  assert.equal(invalid.LIVE_EXECUTION_VARIANT, "INVALID");
  assert.equal(invalid.LIVE_EXECUTION_VARIANT_VALID, false);

  const inverse = readConfig({
    TRADING_MODE: "LIVE",
    LIVE_TRADING_ENABLED: "true",
    LIVE_EXECUTION_VARIANT: "INVERSE"
  });
  assert.equal(inverse.LIVE_TRADING_ENABLED, true);
  assert.equal(inverse.LIVE_EXECUTION_VARIANT, "INVERSE");
  assert.equal(inverse.LIVE_EXECUTION_VARIANT_VALID, true);
});

