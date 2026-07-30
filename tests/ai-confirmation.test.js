const test = require("node:test");
const assert = require("node:assert/strict");
require("ts-node/register/transpile-only");

const axios = require("axios");
const { confirmSetupWithAi } = require("../src/ai-confirmation");

const input = {
  signalId: "SIG-EURUSD-20260724",
  symbol: "EURUSD",
  action: "BUY",
  setupScore: 74,
  scoreBreakdown: { trend: 16, momentum: 14, structure: 15 },
  snapshotAt: "2026-07-24T18:20:00.000Z",
  priceTime: "2026-07-24T18:20:00.000Z",
  bid: 1.1367,
  ask: 1.1368,
  spread: 1,
  timeframe: "M5",
  trend: "BULLISH",
  structure: "BULLISH",
  session: "LONDON_NY_OVERLAP",
  riskStatus: "PASS",
  reasoning: "Deterministic setup evidence."
};

test("AI confirmation is skipped without a network call when not required", async () => {
  const originalPost = axios.post;
  let calls = 0;
  axios.post = async () => {
    calls += 1;
    throw new Error("must not call");
  };
  try {
    const result = await confirmSetupWithAi(input, {
      provider: "DISABLED",
      required: false,
      model: "gemini-3.5-flash-lite",
      minimumScore: 65
    });
    assert.equal(result.status, "DISABLED");
    assert.equal(result.approved, true);
    assert.equal(calls, 0);
  } finally {
    axios.post = originalPost;
  }
});

test("required Gemini confirmation fails closed without credentials", async () => {
  const result = await confirmSetupWithAi(input, {
    provider: "GEMINI",
    required: true,
    model: "gemini-3.5-flash-lite",
    minimumScore: 65
  });
  assert.equal(result.status, "ERROR");
  assert.equal(result.approved, false);
  assert.equal(result.reason, "GEMINI_API_KEY_MISSING");
});

test("required OpenAI confirmation fails closed when runtime adapter is not installed", async () => {
  const result = await confirmSetupWithAi({ ...input, analysisOnly: true }, {
    provider: "OPENAI",
    required: true,
    model: "gpt-5-mini",
    minimumScore: 65
  });
  assert.equal(result.status, "ERROR");
  assert.equal(result.approved, false);
  assert.equal(result.reason, "AI_PROVIDER_NOT_CONFIGURED");
});

test("Gemini approval accepts only schema-valid output for the same signal", async () => {
  const originalPost = axios.post;
  let captured;
  axios.post = async (url, body, options) => {
    captured = { url, body, options };
    return {
      data: {
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                decision: "APPROVE",
                reason: "Structure and momentum agree.",
                signal_id: input.signalId
              })
            }]
          }
        }]
      }
    };
  };
  try {
    const result = await confirmSetupWithAi(input, {
      provider: "GEMINI",
      required: true,
      apiKey: "unit-test-key",
      model: "gemini-3.5-flash-lite",
      minimumScore: 65
    });
    assert.equal(result.status, "APPROVED");
    assert.equal(result.approved, true);
    assert.match(captured.url, /gemini-3\.5-flash-lite:generateContent$/);
    assert.equal(captured.options.proxy, false);
    assert.equal(captured.options.timeout, 8000);
    assert.equal(captured.options.headers["x-goog-api-key"], "unit-test-key");
    assert.equal(captured.body.generationConfig.responseMimeType, "application/json");
  } finally {
    axios.post = originalPost;
  }
});

test("wrong signal ID or malformed Gemini output fails closed", async () => {
  const originalPost = axios.post;
  axios.post = async () => ({
    data: {
      candidates: [{
        content: {
          parts: [{
            text: JSON.stringify({
              decision: "APPROVE",
              reason: "Mismatch.",
              signal_id: "ANOTHER-SIGNAL"
            })
          }]
        }
      }]
    }
  });
  try {
    const result = await confirmSetupWithAi(input, {
      provider: "GEMINI",
      required: true,
      apiKey: "unit-test-key",
      model: "gemini-3.5-flash-lite",
      minimumScore: 65
    });
    assert.equal(result.status, "ERROR");
    assert.equal(result.approved, false);
    assert.equal(result.reason, "GEMINI_RESPONSE_VALIDATION_FAILED");
  } finally {
    axios.post = originalPost;
  }
});
