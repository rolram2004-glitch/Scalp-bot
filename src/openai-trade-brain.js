"use strict";

const axios = require("axios");

function finite(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function redactReason(value, fallback) {
  const text = String(value || fallback)
    .replace(/Bearer\s+[^\s,;]+/gi, "Bearer [REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]{16,}\b/g, "[REDACTED]")
    .trim();
  return (text || fallback).slice(0, 280);
}

function extractOutputText(payload) {
  if (typeof payload?.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
  }

  const output = Array.isArray(payload?.output) ? payload.output : [];
  for (const item of output) {
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const part of content) {
      if (part?.type === "output_text" && typeof part?.text === "string" && part.text.trim()) {
        return part.text.trim();
      }
    }
  }
  return null;
}

function validInput(input) {
  const score = finite(input?.setupScore);
  const bid = finite(input?.bid);
  const ask = finite(input?.ask);
  const spread = finite(input?.spread);
  return Boolean(
    input?.signalId &&
    input?.symbol &&
    (input?.action === "BUY" || input?.action === "SELL") &&
    score !== null && score >= 0 && score <= 100 &&
    bid !== null && bid > 0 &&
    ask !== null && ask >= bid &&
    spread !== null && spread >= 0 &&
    Number.isFinite(Date.parse(String(input?.snapshotAt || ""))) &&
    Number.isFinite(Date.parse(String(input?.priceTime || ""))) &&
    input?.riskStatus === "PASS"
  );
}

function installOpenAiTradeBrain({ aiConfirmation, config }) {
  const apiKey = String(process.env.OPENAI_API_KEY || "").trim();
  if (!apiKey) return false;

  const requestedModel = String(process.env.OPENAI_MODEL || "gpt-5-mini").trim();
  const model = /^gpt-[A-Za-z0-9._-]+$/.test(requestedModel) ? requestedModel : "gpt-5-mini";

  // Keep the existing bot call-site compatible while reporting the real provider.
  config.AI_PROVIDER = "OPENAI";
  config.AI_CONFIRMATION_REQUIRED = true;
  config.OPENAI_API_KEY = apiKey;
  config.OPENAI_MODEL = model;
  config.GEMINI_API_KEY = apiKey;
  config.GEMINI_MODEL = model;
  const hyperPractice = config.TRADING_MODE === "OANDA_DEMO" &&
    config.FOREX_SIGNAL_PROFILE === "ROHATO_HYPER_100_PER_SYMBOL";
  config.AI_MIN_CONFIDENCE = Math.max(
    hyperPractice ? 50 : 55,
    Number(process.env.AI_MIN_CONFIDENCE || 60)
  );
  // More candidates reach GPT; GPT remains the final gate.
  config.MIN_CONFIDENCE = Math.min(Number(config.MIN_CONFIDENCE || 60), 55);

  aiConfirmation.confirmSetupWithAi = async function confirmWithOpenAi(input, settings) {
    const checkedAt = new Date().toISOString();
    const minimum = Math.max(0, Math.min(100, Number(settings?.minimumScore || config.AI_MIN_CONFIDENCE || 60)));

    if (!validInput(input)) {
      return {
        required: true,
        provider: "OPENAI",
        model,
        status: "ERROR",
        approved: false,
        reason: "OPENAI_INPUT_NOT_VERIFIED",
        checkedAt
      };
    }

    if (Number(input.setupScore) < 50) {
      return {
        required: true,
        provider: "OPENAI",
        model,
        status: "REJECTED",
        approved: false,
        reason: "SETUP_SCORE_BELOW_PREFILTER",
        checkedAt
      };
    }

    const schema = {
      type: "object",
      properties: {
        decision: { type: "string", enum: ["APPROVE", "REJECT"] },
        confidence: { type: "integer", minimum: 0, maximum: 100 },
        reason: { type: "string", minLength: 1, maxLength: 220 },
        signal_id: { type: "string", minLength: 1, maxLength: 160 }
      },
      required: ["decision", "confidence", "reason", "signal_id"],
      additionalProperties: false
    };

    const marketSnapshot = {
      signal_id: input.signalId,
      symbol: input.symbol,
      proposed_action: input.action,
      setup_score: input.setupScore,
      score_breakdown: input.scoreBreakdown || {},
      snapshot_at: input.snapshotAt,
      price_time: input.priceTime,
      bid: input.bid,
      ask: input.ask,
      spread: input.spread,
      timeframe: input.timeframe,
      trend: input.trend || "UNKNOWN",
      structure: input.structure || "UNKNOWN",
      session: input.session || "UNKNOWN",
      risk_status: input.riskStatus,
      analysis_only: input.analysisOnly === true,
      multi_timeframe: input.multiTimeframe,
      strategy_gates: input.strategyGates,
      deterministic_reasoning: input.reasoning
    };
    const analysisOnly = input.analysisOnly === true;

    try {
      const response = await axios.post(
        "https://api.openai.com/v1/responses",
        {
          model,
          store: false,
          reasoning: { effort: "low" },
          instructions: [
            analysisOnly
              ? "You are the final validation gate for an XAUUSD signal-only analysis lab. No broker order is allowed."
              : "You are the final decision gate for an OANDA Practice forex scalping bot.",
            "Use only the supplied verified market snapshot. Never invent prices, news, indicators, levels or account data.",
            "The deterministic engine proposes one side. APPROVE only when trend, structure, spread, timing and reasoning coherently support that exact side.",
            "REJECT stale, contradictory, overextended, range-noise or weak setups. Do not reverse the side and do not propose another order.",
            analysisOnly
              ? "This is analysis only: validate or reject the signal, but never authorize, describe or imply an OANDA order."
              : "Stop Loss, Take Profit, units, exposure limits and broker verification are controlled by code and cannot be changed by you.",
            "Return only the schema-constrained JSON."
          ].join(" "),
          input: JSON.stringify(marketSnapshot),
          text: {
            format: {
              type: "json_schema",
              name: analysisOnly ? "xau_signal_gate" : "oanda_trade_gate",
              description: analysisOnly
                ? "Final approve or reject decision for one XAUUSD signal-only candidate."
                : "Final approve or reject decision for one verified forex candidate.",
              strict: true,
              schema
            },
            verbosity: "low"
          },
          max_output_tokens: 180
        },
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "X-Client-Request-Id": String(input.signalId).slice(0, 120)
          },
          timeout: Math.min(15000, Math.max(5000, Number(settings?.timeoutMs) || 10000)),
          proxy: false
        }
      );

      const text = extractOutputText(response.data);
      if (!text) throw new Error("OPENAI_EMPTY_RESPONSE");
      const parsed = JSON.parse(text);
      const decision = String(parsed?.decision || "").toUpperCase();
      const confidence = Number(parsed?.confidence);
      const returnedSignalId = String(parsed?.signal_id || "");
      if (!["APPROVE", "REJECT"].includes(decision) ||
          !Number.isInteger(confidence) || confidence < 0 || confidence > 100 ||
          returnedSignalId !== input.signalId) {
        throw new Error("OPENAI_RESPONSE_VALIDATION_FAILED");
      }

      const approved = decision === "APPROVE" && confidence >= minimum;
      return {
        required: true,
        provider: "OPENAI",
        model,
        status: approved ? "APPROVED" : "REJECTED",
        approved,
        reason: redactReason(
          `${parsed?.reason || decision} | GPT confidence ${confidence}/100`,
          approved ? "OPENAI_APPROVED" : "OPENAI_REJECTED"
        ),
        checkedAt: new Date().toISOString()
      };
    } catch (error) {
      return {
        required: true,
        provider: "OPENAI",
        model,
        status: "ERROR",
        approved: false,
        reason: redactReason(
          error?.response?.data?.error?.code ||
          error?.response?.data?.error?.message ||
          error?.code ||
          error?.message,
          "OPENAI_CONFIRMATION_FAILED"
        ),
        checkedAt: new Date().toISOString()
      };
    }
  };

  return true;
}

module.exports = {
  installOpenAiTradeBrain,
  extractOutputText,
  validInput
};
