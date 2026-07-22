const test = require("node:test");
const assert = require("node:assert/strict");

require("ts-node/register/transpile-only");

const { getXauusdSignal } = require("../src/xauusd-strategy");

function xau(overrides = {}) {
  return {
    symbol: "XAUUSD",
    bid: 2400,
    ask: 2400.2,
    spread: 2,
    tradeable: true,
    session: "LONDON",
    structureSource: "OANDA_CANDLES",
    candleCount: 250,
    structureBias: "BULLISH",
    breakOfStructure: "BULLISH",
    changeOfCharacter: "NONE",
    liquiditySweep: "BULLISH",
    fairValueGap: "BULLISH",
    ema20: 2399,
    ema50: 2397,
    ema200: 2388,
    rsi: 61,
    macdHistogram: 0.8,
    atr: 3.2,
    supportLevels: [2396, 2390],
    resistanceLevels: [2404, 2409, 2414],
    ...overrides
  };
}

test("XAUUSD uses a dedicated structural confluence decision", () => {
  const decision = getXauusdSignal(xau());

  assert.equal(decision.action, "BUY");
  assert.equal(decision.setupType, "XAU_STRUCTURE_CONFLUENCE");
  assert.equal(decision.stopLossPrice, 2396);
  assert.deepEqual(decision.structuralTargets, [2404, 2409, 2414]);
  assert.ok(decision.confidence >= 70);
  assert.ok(decision.evidence.some((item) => item.label === "Liquidity sweep" && item.direction === "BUY"));
});

test("XAUUSD holds when real structural targets are unavailable", () => {
  const decision = getXauusdSignal(xau({ resistanceLevels: [] }));

  assert.equal(decision.action, "HOLD");
  assert.deepEqual(decision.structuralTargets, []);
  assert.match(decision.reasoning, /Nessun TP viene inventato/);
});

test("XAUUSD fails closed on incomplete data, off-hours, or excessive spread", () => {
  assert.equal(getXauusdSignal(xau({ candleCount: 40 })).action, "HOLD");
  assert.equal(getXauusdSignal(xau({ session: "OFF_HOURS" })).action, "HOLD");
  assert.equal(getXauusdSignal(xau({ spread: 81 })).action, "HOLD");
});
