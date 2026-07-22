const test = require("node:test");
const assert = require("node:assert/strict");

require("ts-node/register/transpile-only");

const { analyzeMarketStructure, parseOandaBars } = require("../src/market-structure");

function candle(index, open, high, low, close, extras = {}) {
  return {
    time: new Date(Date.UTC(2026, 6, 20, 10, index)).toISOString(),
    complete: true,
    volume: 100 + index,
    mid: {
      o: String(open),
      h: String(high),
      l: String(low),
      c: String(close)
    },
    ...extras
  };
}

test("market structure uses only valid completed OANDA candles", () => {
  const rows = [
    candle(0, 9, 10, 8, 9),
    { time: "bad", complete: true, mid: { o: "x", h: "x", l: "x", c: "x" } },
    candle(1, 10, 11, 9, 10, { complete: false })
  ];

  assert.equal(parseOandaBars(rows).length, 2);
  const result = analyzeMarketStructure(rows);
  assert.equal(result.source, "OANDA_CANDLES");
  assert.equal(result.candleCount, 1);
  assert.equal(result.latestCandleTime, rows[0].time);
});

test("detects higher-high/higher-low structure and a real close above the latest swing", () => {
  const rows = [
    candle(0, 9, 10, 8.5, 9.5),
    candle(1, 10, 11, 9, 10.5),
    candle(2, 12, 15, 10, 13),
    candle(3, 11, 12, 9, 10),
    candle(4, 10, 13, 8, 11),
    candle(5, 12, 14, 10, 13),
    candle(6, 15, 18, 12, 16),
    candle(7, 13, 15, 11, 14),
    candle(8, 12, 16, 10, 13),
    candle(9, 14, 17, 12, 16),
    candle(10, 17, 20, 14, 19)
  ];

  const result = analyzeMarketStructure(rows);

  assert.equal(result.structure, "BULLISH");
  assert.equal(result.bos, "BULLISH");
  assert.deepEqual(result.swingHighs.map((item) => item.price), [18, 15]);
  assert.deepEqual(result.swingLows.map((item) => item.price), [10, 8]);
  assert.deepEqual(result.supportLevels, [10, 8]);
});

test("detects fair-value gaps and liquidity sweeps from candle geometry", () => {
  const rows = [
    candle(0, 9, 10, 8, 9),
    candle(1, 9, 10.5, 8.5, 10),
    candle(2, 12, 13, 11, 12.5),
    candle(3, 11, 12, 9, 10),
    candle(4, 10, 11, 8, 9),
    candle(5, 9, 10, 7, 8),
    candle(6, 11, 14, 9, 10)
  ];

  const result = analyzeMarketStructure(rows);

  assert.equal(result.fvg.direction, "BULLISH");
  assert.equal(result.fvg.low, 10);
  assert.equal(result.fvg.high, 11);
  assert.equal(result.liquiditySweep, "BEARISH");
});
