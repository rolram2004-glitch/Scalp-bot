const test = require("node:test");
const assert = require("node:assert/strict");

require("ts-node/register/transpile-only");

const {
  buildXauSignalCandidate,
  XauSignalLab
} = require("../src/xau-signal-lab");

function intelligence(candleTime = "2026-07-30T13:00:00.000Z", overrides = {}) {
  const frame = (timeframe, extra = {}) => ({
    timeframe,
    available: true,
    source: "OANDA_CANDLES",
    candleTime,
    candleCount: 250,
    direction: "BUY",
    alignmentScore: 80,
    structure: "BULLISH",
    bos: "BULLISH",
    liquiditySweep: "BULLISH",
    volumeRatio: 1.35,
    rejection: timeframe === "M1" ? "BULLISH" : "NONE",
    ...extra
  });
  return {
    symbol: "XAUUSD",
    evaluatedAt: candleTime,
    source: "OANDA",
    frames: [frame("M1"), frame("M5"), frame("M15"), frame("H1")],
    availableFrames: 4,
    consensus: "BUY",
    alignmentScore: 100,
    reasoning: "4/4 timeframe OANDA allineati BUY.",
    ...overrides
  };
}

function candidateAt(iso = "2026-07-30T13:00:10.000Z") {
  return buildXauSignalCandidate({
    signalId: `SIG-XAUUSD-${iso}`,
    evaluatedAt: iso,
    decision: {
      action: "BUY",
      confidence: 86,
      setupScore: 86,
      setupType: "XAU_STRUCTURE_CONFLUENCE",
      reasoning: "Liquidity sweep and bullish structure confirmed.",
      stopLossPrice: 2396,
      structuralTargets: [2404, 2409, 2414]
    },
    market: {
      symbol: "XAUUSD",
      timeframe: "M5",
      bid: 2400,
      ask: 2400.2,
      spread: 2,
      priceTime: iso,
      candleTime: iso,
      tradeable: true,
      highPrice: 2401,
      lowPrice: 2398,
      closePrice: 2400.1,
      ema20: 2399,
      ema50: 2397,
      ema200: 2388,
      rsi: 61,
      macdMain: 1,
      macdSignal: 0.5,
      macdHistogram: 0.5,
      atr: 3.2,
      volumeRatio: 1.3,
      structureBias: "BULLISH",
      breakOfStructure: "BULLISH",
      changeOfCharacter: "NONE",
      liquiditySweep: "BULLISH",
      fairValueGap: "BULLISH",
      structureSource: "OANDA_CANDLES",
      candleCount: 250,
      session: "LONDON_NY_OVERLAP",
      killzone: true,
      trend: "BULLISH",
      volatility: "NORMAL"
    },
    intelligence: intelligence(iso)
  });
}

function aiApproval(checkedAt) {
  return {
    required: true,
    provider: "OPENAI",
    model: "gpt-5-mini",
    status: "APPROVED",
    approved: true,
    reason: "Verified MTF confluence supports the supplied side.",
    checkedAt
  };
}

test("XAU professional candidate requires real >= 1:2 targets and every strategy gate", () => {
  const candidate = candidateAt();

  assert.equal(candidate.eligible, true);
  assert.equal(candidate.timeframe, "M1");
  assert.equal(candidate.side, "BUY");
  assert.deepEqual(candidate.takeProfits, [2409, 2414]);
  assert.ok(candidate.riskRewardRatios.every((ratio) => ratio >= 2));
  assert.ok(candidate.gates.every((item) => item.passed));
});

test("XAU candidate fails closed when killzone, volume, or MTF alignment is absent", () => {
  const base = candidateAt();
  const broken = buildXauSignalCandidate({
    signalId: "SIG-XAU-BROKEN",
    evaluatedAt: base.evaluatedAt,
    decision: {
      action: "BUY",
      confidence: 86,
      reasoning: "Candidate.",
      stopLossPrice: 2396,
      structuralTargets: [2409]
    },
    market: {
      symbol: "XAUUSD",
      timeframe: "M5",
      bid: 2400,
      ask: 2400.2,
      spread: 2,
      priceTime: base.evaluatedAt,
      candleTime: base.evaluatedAt,
      tradeable: true,
      highPrice: 2401,
      lowPrice: 2398,
      closePrice: 2400.1,
      ema20: 2399,
      ema50: 2397,
      ema200: 2388,
      rsi: 61,
      macdMain: 1,
      macdSignal: 0.5,
      macdHistogram: 0.5,
      volumeRatio: 0.8,
      structureBias: "BULLISH",
      breakOfStructure: "BULLISH",
      structureSource: "OANDA_CANDLES",
      candleCount: 250,
      session: "NEW_YORK",
      killzone: false,
      trend: "BULLISH",
      volatility: "NORMAL"
    },
    intelligence: (() => {
      const mtf = intelligence(base.evaluatedAt, {
        consensus: "HOLD",
        alignmentScore: 50
      });
      mtf.frames = mtf.frames.map((frame) => ({ ...frame, volumeRatio: 0.8 }));
      return mtf;
    })()
  });

  assert.equal(broken.eligible, false);
  assert.ok(broken.gates.some((item) => item.key === "KILLZONE" && !item.passed));
  assert.ok(broken.gates.some((item) => item.key === "MTF_ALIGNMENT" && !item.passed));
  assert.ok(broken.gates.some((item) => item.key === "VOLUME" && !item.passed));
});

test("XAU ledger records signals only after AI approval and never submits an order", () => {
  const lab = new XauSignalLab();
  const candidate = candidateAt();
  assert.equal(lab.canRequestAi(candidate).allowed, true);

  const signal = lab.recordAiReview(candidate, aiApproval("2026-07-30T13:00:12.000Z"));
  assert.ok(signal);
  assert.equal(signal.orderSubmitted, false);
  assert.equal(signal.source, "OANDA_SIGNAL_ONLY");

  lab.updateQuote({
    bid: 2409.2,
    ask: 2409.4,
    time: "2026-07-30T13:01:00.000Z",
    tradeable: true
  }, new Date("2026-07-30T13:01:00.000Z"));
  let snapshot = lab.getSnapshot(new Date("2026-07-30T13:01:00.000Z"));
  assert.equal(snapshot.signals[0].status, "TP1_HIT");
  assert.equal(snapshot.signals[0].protectedAtBreakEven, true);
  assert.ok(snapshot.signals[0].resultR > 0);

  lab.updateQuote({
    bid: 2400.2,
    ask: 2400.4,
    time: "2026-07-30T13:02:00.000Z",
    tradeable: true
  }, new Date("2026-07-30T13:02:00.000Z"));
  snapshot = lab.getSnapshot(new Date("2026-07-30T13:02:00.000Z"));
  assert.equal(snapshot.signals[0].status, "PROTECTED");
  assert.equal(snapshot.signals[0].closeReason, "BREAKEVEN_AFTER_PARTIALS");
  assert.equal(snapshot.orderCount, 0);
  assert.equal(snapshot.executionEnabled, false);
});

test("XAU ledger enforces one open signal and a maximum of ten per UTC day", () => {
  const lab = new XauSignalLab();

  for (let index = 0; index < 10; index += 1) {
    const minute = index * 6;
    const openedAt = new Date(Date.UTC(2026, 6, 30, 0, minute, 10)).toISOString();
    const candidate = candidateAt(openedAt);
    assert.equal(lab.canRequestAi(candidate, openedAt).allowed, true);
    const signal = lab.recordAiReview(candidate, aiApproval(openedAt));
    assert.ok(signal);
    const closeAt = new Date(Date.parse(openedAt) + 1000);
    lab.updateQuote({
      bid: 2415,
      ask: 2415.2,
      time: closeAt.toISOString(),
      tradeable: true
    }, closeAt);
  }

  const eleventhAt = "2026-07-30T02:00:10.000Z";
  const eligibility = lab.canRequestAi(candidateAt(eleventhAt), eleventhAt);
  const snapshot = lab.getSnapshot(new Date(eleventhAt));
  assert.equal(eligibility.allowed, false);
  assert.equal(eligibility.reason, "DAILY_SIGNAL_CAP_REACHED");
  assert.equal(snapshot.todaySignals, 10);
  assert.equal(snapshot.remainingToday, 0);
  assert.equal(snapshot.orderCount, 0);
});
