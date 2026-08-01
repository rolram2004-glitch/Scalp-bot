const test = require('node:test');
const assert = require('node:assert/strict');
require('ts-node/register/transpile-only');

const {
  buildEquityCurve,
  calculatePairedLaneMetrics,
  calculateSymbolEdges,
  pairTradesBySignal,
  tradeResultR
} = require('../src/strategy-metrics.ts');

function trade(overrides) {
  return {
    id: overrides.id,
    symbol: 'EURUSD',
    side: 'BUY',
    status: 'CLOSED',
    openedAt: '2026-07-31T10:00:00.000Z',
    closedAt: '2026-07-31T10:05:00.000Z',
    riskPips: 10,
    signalId: overrides.signalId,
    ...overrides
  };
}

test('normalizes results to R without mixing currencies', () => {
  assert.equal(tradeResultR(trade({ id: 'a', signalId: 's1', pnlR: 1.25, pnl: 999 })), 1.25);
  assert.equal(tradeResultR(trade({ id: 'b', signalId: 's2', pnlPips: -5 })), -0.5);
  assert.equal(tradeResultR(trade({ id: 'c', signalId: 's3', pnl: 4, riskAmount: 2 })), 2);
});

test('pairs MAIN and INVERSE strictly by the same signal id', () => {
  const main = [
    trade({ id: 'm1', signalId: 'pair-1', pnlR: 2 }),
    trade({ id: 'm2', signalId: 'main-only', pnlR: -1 })
  ];
  const inverse = [
    trade({ id: 'i1', signalId: 'pair-1', pnlR: -1, side: 'SELL' }),
    trade({ id: 'i2', signalId: 'inverse-only', pnlR: 2, side: 'SELL' })
  ];
  const pairs = pairTradesBySignal(main, inverse);
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].signalId, 'pair-1');
  assert.equal(pairs[0].winner, 'MAIN');
});

test('calculates paired-only profit factor, expectancy and drawdown', () => {
  const main = [
    trade({ id: 'm1', signalId: 's1', pnlR: 2, closedAt: '2026-07-31T10:05:00.000Z' }),
    trade({ id: 'm2', signalId: 's2', pnlR: -1, closedAt: '2026-07-31T11:05:00.000Z' }),
    trade({ id: 'm3', signalId: 's3', pnlR: -0.5, closedAt: '2026-07-31T12:05:00.000Z' })
  ];
  const inverse = [
    trade({ id: 'i1', signalId: 's1', pnlR: -1, side: 'SELL', closedAt: '2026-07-31T10:05:00.000Z' }),
    trade({ id: 'i2', signalId: 's2', pnlR: 2, side: 'SELL', closedAt: '2026-07-31T11:05:00.000Z' }),
    trade({ id: 'i3', signalId: 's3', pnlR: 1, side: 'SELL', closedAt: '2026-07-31T12:05:00.000Z' })
  ];
  const pairs = pairTradesBySignal(main, inverse);
  const metrics = calculatePairedLaneMetrics(pairs, 'MAIN');
  assert.equal(metrics.sampleSize, 3);
  assert.equal(metrics.totalR, 0.5);
  assert.equal(metrics.averageR, 0.5 / 3);
  assert.equal(metrics.profitFactor, 2 / 1.5);
  assert.equal(metrics.maxDrawdownR, 1.5);
});

test('builds chronological paired equity curves and per-symbol edges', () => {
  const main = [
    trade({ id: 'm2', signalId: 's2', symbol: 'GBPUSD', pnlR: -1, closedAt: '2026-07-31T11:05:00.000Z' }),
    trade({ id: 'm1', signalId: 's1', symbol: 'EURUSD', pnlR: 2, closedAt: '2026-07-31T10:05:00.000Z' })
  ];
  const inverse = [
    trade({ id: 'i2', signalId: 's2', symbol: 'GBPUSD', pnlR: 2, side: 'SELL', closedAt: '2026-07-31T11:05:00.000Z' }),
    trade({ id: 'i1', signalId: 's1', symbol: 'EURUSD', pnlR: -1, side: 'SELL', closedAt: '2026-07-31T10:05:00.000Z' })
  ];
  const pairs = pairTradesBySignal(main, inverse);
  const curve = buildEquityCurve(pairs);
  assert.deepEqual(curve.map((point) => [point.main, point.inverse]), [[0, 0], [2, -1], [1, 1]]);
  const edges = calculateSymbolEdges(pairs);
  assert.equal(edges.find((item) => item.symbol === 'EURUSD').winner, 'MAIN');
  assert.equal(edges.find((item) => item.symbol === 'GBPUSD').winner, 'INVERSE');
});
