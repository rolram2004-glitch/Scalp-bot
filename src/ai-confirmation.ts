import axios from "axios";

export type AiDecision = "APPROVE" | "REJECT";
export type AiConfirmationStatus = "DISABLED" | "APPROVED" | "REJECTED" | "ERROR";

export interface AiConfirmationInput {
  signalId: string;
  symbol: string;
  action: "BUY" | "SELL";
  setupScore: number;
  scoreBreakdown?: Record<string, number>;
  snapshotAt: string;
  priceTime: string;
  bid: number;
  ask: number;
  spread: number;
  timeframe: string;
  trend?: string;
  structure?: string;
  session?: string;
  riskStatus: "PASS";
  reasoning: string;
}

export interface AiConfirmationSettings {
  provider: "DISABLED" | "GEMINI";
  required: boolean;
  apiKey?: string;
  model: string;
  minimumScore: number;
  timeoutMs?: number;
}

export interface AiConfirmationResult {
  required: boolean;
  provider: "DISABLED" | "GEMINI";
  model?: string;
  status: AiConfirmationStatus;
  approved: boolean;
  reason: string;
  checkedAt: string;
}

const MODEL_PATTERN = /^gemini-[a-z0-9.-]+$/i;

function finite(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function safeReason(value: unknown, fallback: string) {
  const text = String(value || fallback)
    .replace(/Bearer\s+[^\s,;]+/gi, "Bearer [REDACTED]")
    .replace(/[0-9a-f]{32}-[0-9a-f]{32}/gi, "[REDACTED]")
    .replace(/\bAIza[A-Za-z0-9_-]{24,}\b/g, "[REDACTED]")
    .replace(/\bAQ\.[A-Za-z0-9_-]{24,}\b/g, "[REDACTED]")
    .trim();
  return (text || fallback).slice(0, 280);
}

function validInput(input: AiConfirmationInput) {
  const score = finite(input.setupScore);
  const bid = finite(input.bid);
  const ask = finite(input.ask);
  const spread = finite(input.spread);
  return Boolean(
    input.signalId &&
    input.symbol &&
    (input.action === "BUY" || input.action === "SELL") &&
    score !== null && score >= 0 && score <= 100 &&
    bid !== null && bid > 0 &&
    ask !== null && ask >= bid &&
    spread !== null && spread >= 0 &&
    Number.isFinite(Date.parse(input.snapshotAt)) &&
    Number.isFinite(Date.parse(input.priceTime)) &&
    input.riskStatus === "PASS"
  );
}

function extractStructuredText(payload: any) {
  const parts = payload?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return null;
  const text = parts
    .map((part: any) => typeof part?.text === "string" ? part.text : "")
    .join("")
    .trim();
  return text || null;
}

export async function confirmSetupWithAi(
  input: AiConfirmationInput,
  settings: AiConfirmationSettings
): Promise<AiConfirmationResult> {
  const checkedAt = new Date().toISOString();
  if (!settings.required) {
    return {
      required: false,
      provider: settings.provider,
      status: "DISABLED",
      approved: true,
      reason: "AI confirmation not required by configuration.",
      checkedAt
    };
  }
  if (settings.provider !== "GEMINI") {
    return {
      required: true,
      provider: settings.provider,
      status: "ERROR",
      approved: false,
      reason: "AI_PROVIDER_NOT_CONFIGURED",
      checkedAt
    };
  }
  if (!settings.apiKey) {
    return {
      required: true,
      provider: "GEMINI",
      status: "ERROR",
      approved: false,
      reason: "GEMINI_API_KEY_MISSING",
      checkedAt
    };
  }
  if (!validInput(input)) {
    return {
      required: true,
      provider: "GEMINI",
      status: "ERROR",
      approved: false,
      reason: "AI_INPUT_NOT_VERIFIED",
      checkedAt
    };
  }
  if (input.setupScore < settings.minimumScore) {
    return {
      required: true,
      provider: "GEMINI",
      status: "REJECTED",
      approved: false,
      reason: "SETUP_SCORE_BELOW_AI_GATE",
      checkedAt
    };
  }

  const model = MODEL_PATTERN.test(settings.model) ? settings.model : "gemini-3.5-flash-lite";
  const schema = {
    type: "object",
    properties: {
      decision: {
        type: "string",
        enum: ["APPROVE", "REJECT"],
        description: "APPROVE only when the supplied technical setup and risk gate are coherent."
      },
      reason: {
        type: "string",
        description: "Short reason based only on the supplied snapshot. Do not create prices or levels."
      },
      signal_id: {
        type: "string",
        description: "Copy the supplied signal_id exactly."
      }
    },
    required: ["decision", "reason", "signal_id"],
    additionalProperties: false
  };
  const prompt = [
    "You are a final risk confirmation classifier for an OANDA trading system.",
    "Use only the supplied JSON. Never invent prices, change risk, propose orders, tools, or a different side.",
    "REJECT if the data is incomplete, contradictory, stale, or the explanation does not support the action.",
    "Return only the schema-constrained decision.",
    JSON.stringify({
      signal_id: input.signalId,
      symbol: input.symbol,
      action: input.action,
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
      deterministic_reasoning: input.reasoning
    })
  ].join("\n\n");

  try {
    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: schema
        }
      },
      {
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": settings.apiKey
        },
        timeout: Math.min(15000, Math.max(3000, Number(settings.timeoutMs) || 8000)),
        proxy: false
      }
    );
    const text = extractStructuredText(response.data);
    if (!text) throw new Error("GEMINI_EMPTY_RESPONSE");
    const parsed = JSON.parse(text);
    const decision = String(parsed?.decision || "").toUpperCase() as AiDecision;
    const returnedSignalId = String(parsed?.signal_id || "");
    if (!["APPROVE", "REJECT"].includes(decision) || returnedSignalId !== input.signalId) {
      throw new Error("GEMINI_RESPONSE_VALIDATION_FAILED");
    }
    const approved = decision === "APPROVE";
    return {
      required: true,
      provider: "GEMINI",
      model,
      status: approved ? "APPROVED" : "REJECTED",
      approved,
      reason: safeReason(parsed?.reason, approved ? "APPROVED" : "REJECTED"),
      checkedAt: new Date().toISOString()
    };
  } catch (error: any) {
    return {
      required: true,
      provider: "GEMINI",
      model,
      status: "ERROR",
      approved: false,
      reason: safeReason(
        error?.response?.data?.error?.status ||
        error?.response?.data?.error?.message ||
        error?.code ||
        error?.message,
        "GEMINI_CONFIRMATION_FAILED"
      ),
      checkedAt: new Date().toISOString()
    };
  }
}

export const aiConfirmationTestUtils = {
  validInput,
  extractStructuredText
};
