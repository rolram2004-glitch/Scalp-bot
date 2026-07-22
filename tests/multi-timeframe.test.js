const test = require("node:test");
const assert = require("node:assert/strict");

require("ts-node/register/transpile-only");

const { analyzeTimeframe, loadMultiTimeframeIntelligence } = require("../src/multi-timeframe");

function trendingCandles(count = 250) {
  const rows = [];
  let close = 100;
  for (let index = 0; index < count; index += 1) {
    const open = close;
    close += index % 3 === 2 ? -0.025 : 0.02;
    rows.push({
      time: new Date(Date.UTC(2026, 6, 20, 0, index)).toISOString(),
      complete: true,
      volume: 100 + (index % 11),
      mid: {
        o: open.toFixed(5),
        h: (Math.max(open, close) + 0.015).toFixed(5),
        l: (Math.min(open, close) - 0.015).toFixed(5),
        c: close.toFixed(5)
      }
    });
  }
  return rows;
}

test("timeframe intelligence is calculated only from sufficient OANDA candles", () => {
  const missing = analyzeTimeframe("M5", trendingCandles(40));
  assert.equal(missing.available, false);
  assert.match(missing.reason, /40_OF_200/);

  const result = analyzeTimeframe("M5", trendingCandles());
  assert.equal(result.available, true);
  assert.equal(result.source, "OANDA_CANDLES");
  assert.equal(result.candleCount, 250);
  assert.ok(["BUY", "SELL", "HOLD"].includes(result.direction));
  assert.ok(Number.isFinite(result.alignmentScore));
  assert.ok(Number.isFinite(result.ema200));
  assert.ok(Number.isFinite(result.rsi));
});

test("multi-timeframe loader reports exact coverage without filling missing frames", async () => {
  const oanda = {
    async getCandles(_instrument, _count, timeframe) {
      return timeframe === "H1" ? [] : trendingCandles();
    }
  };

  const result = await loadMultiTimeframeIntelligence(oanda, "EURUSD");
  assert.equal(result.source, "OANDA");
  assert.equal(result.symbol, "EURUSD");
  assert.equal(result.frames.length, 4);
  assert.equal(result.availableFrames, 3);
  assert.equal(result.frames.find((frame) => frame.timeframe === "H1").available, false);
});
