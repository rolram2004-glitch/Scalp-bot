import { AiConfirmationResult } from "./ai-confirmation";
import { MultiTimeframeIntelligence } from "./multi-timeframe";
import { MarketData, TradingDecision } from "./types";

export type XauSignalSide = "BUY" | "SELL";
export type XauSignalStatus =
  | "OPEN"
  | "TP1_HIT"
  | "TP2_HIT"
  | "TP3_HIT"
  | "STOPPED"
  | "PROTECTED"
  | "EXPIRED";

export interface XauStrategyGate {
  key: string;
  label: string;
  passed: boolean;
  detail: string;
}

export interface XauAiReview {
  provider: "DISABLED" | "GEMINI" | "OPENAI";
  model?: string;
  status: "DISABLED" | "APPROVED" | "REJECTED" | "ERROR";
  approved: boolean;
  reason: string;
  checkedAt: string;
}

export interface XauSignalCandidate {
  signalId: string;
  signature: string;
  symbol: "XAUUSD";
  timeframe: "M1";
  evaluatedAt: string;
  candleTime: string;
  priceTime: string;
  side?: XauSignalSide;
  entryPrice?: number;
  stopLoss?: number;
  takeProfits: number[];
  minimumRiskReward: number;
  riskRewardRatios: number[];
  setupScore: number;
  eligible: boolean;
  blocker?: string;
  runtimeBlocker?: string;
  reasoning: string;
  session: string;
  killzone: boolean;
  multiTimeframeConsensus: "BUY" | "SELL" | "HOLD";
  multiTimeframeAlignment?: number;
  gates: XauStrategyGate[];
  ai?: XauAiReview;
}

export interface XauSignalRecord {
  id: string;
  symbol: "XAUUSD";
  timeframe: "M1";
  source: "OANDA_SIGNAL_ONLY";
  orderSubmitted: false;
  side: XauSignalSide;
  status: XauSignalStatus;
  closeReason?: string;
  entryPrice: number;
  currentPrice: number;
  stopLoss: number;
  activeStop: number;
  takeProfits: number[];
  riskRewardRatios: number[];
  setupScore: number;
  openedAt: string;
  updatedAt: string;
  closedAt?: string;
  candleTime: string;
  priceTime: string;
  hitTargets: number;
  protectedAtBreakEven: boolean;
  liveR: number;
  resultR: number;
  maxFavorableR: number;
  maxAdverseR: number;
  session: string;
  reasoning: string;
  multiTimeframeConsensus: "BUY" | "SELL" | "HOLD";
  multiTimeframeAlignment?: number;
  gates: XauStrategyGate[];
  ai: XauAiReview;
}

export interface XauSignalLabSnapshot {
  symbol: "XAUUSD";
  mode: "SIGNAL_ONLY";
  executionEnabled: false;
  orderCount: 0;
  dataSource: "OANDA";
  resultUnit: "R";
  historyScope: "CURRENT_BOT_RUNTIME";
  strategy: {
    name: "GOLD LIQUIDITY CONFLUENCE";
    version: "1.0";
    triggerTimeframe: "M1";
    contextTimeframes: ["M5", "M15", "H1"];
    minimumRiskReward: 2;
    maxSignalsPerDay: 10;
    maxConcurrentSignals: 1;
    cooldownMinutes: 5;
    maxDurationMinutes: 90;
    management: "TP1 partial, stop to breakeven, TP2/TP3 scale-out";
  };
  dateUTC: string;
  todaySignals: number;
  remainingToday: number;
  openSignals: number;
  closedSignals: number;
  wins: number;
  losses: number;
  breakevens: number;
  winRate?: number;
  totalR: number;
  averageR?: number;
  latestUpdatedAt?: string;
  latestCandidate?: XauSignalCandidate;
  signals: XauSignalRecord[];
}

interface CandidateInput {
  signalId: string;
  evaluatedAt: string;
  decision: TradingDecision;
  market: MarketData;
  intelligence: MultiTimeframeIntelligence;
}

interface XauQuote {
  bid: number;
  ask: number;
  time: string;
  tradeable: boolean;
}

interface ReviewEligibility {
  allowed: boolean;
  reason?: string;
}

const MAX_SIGNALS_PER_DAY = 10;
const MAX_CONCURRENT_SIGNALS = 1;
const COOLDOWN_MS = 5 * 60 * 1000;
const MAX_DURATION_MS = 90 * 60 * 1000;
const MINIMUM_SCORE = 70;
const MINIMUM_RISK_REWARD = 2;
const MINIMUM_VOLUME_RATIO = 1.15;

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function cleanSymbol(value: unknown) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function utcDate(value: string | number | Date = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : "";
}

function directionLabel(side: XauSignalSide) {
  return side === "BUY" ? "BULLISH" : "BEARISH";
}

function isFreshIso(value: unknown, now = Date.now()) {
  const parsed = Date.parse(String(value || ""));
  const age = now - parsed;
  return Number.isFinite(parsed) && age >= -5000 && age <= 30000;
}

function cleanTargets(values: unknown, side: XauSignalSide, entry: number, stop: number) {
  if (!Array.isArray(values)) return { targets: [], ratios: [] };
  const direction = side === "BUY" ? 1 : -1;
  const risk = Math.abs(entry - stop);
  if (!finite(risk) || risk <= 0) return { targets: [], ratios: [] };

  const directional = values
    .map(Number)
    .filter((value) => Number.isFinite(value) && value > 0 && (value - entry) * direction > 0)
    .sort((a, b) => direction > 0 ? a - b : b - a)
    .filter((value, index, array) => index === 0 || Math.abs(value - array[index - 1]) > 1e-10);
  const qualifying = directional
    .map((target) => ({ target, ratio: Math.abs(target - entry) / risk }))
    .filter(({ ratio }) => ratio >= MINIMUM_RISK_REWARD)
    .slice(0, 3);

  return {
    targets: qualifying.map(({ target }) => target),
    ratios: qualifying.map(({ ratio }) => Math.round(ratio * 100) / 100)
  };
}

function rejectionForSide(value: unknown, side: XauSignalSide) {
  return String(value || "").toUpperCase() === directionLabel(side);
}

function gate(key: string, label: string, passed: boolean, detail: string): XauStrategyGate {
  return { key, label, passed, detail };
}

export function buildXauSignalCandidate(input: CandidateInput): XauSignalCandidate {
  const { decision, market, intelligence } = input;
  const now = Date.parse(input.evaluatedAt);
  const action = decision.action === "BUY" || decision.action === "SELL"
    ? decision.action
    : undefined;
  const entry = action === "BUY" ? Number(market.ask) : action === "SELL" ? Number(market.bid) : undefined;
  const stop = Number(decision.stopLossPrice);
  const directionalStop = Boolean(
    action &&
    finite(entry) && entry > 0 &&
    finite(stop) && stop > 0 &&
    (action === "BUY" ? stop < entry : stop > entry)
  );
  const targets = action && directionalStop
    ? cleanTargets(decision.structuralTargets, action, entry as number, stop)
    : { targets: [], ratios: [] };
  const setupScore = Math.max(0, Math.min(100, Number(decision.setupScore ?? decision.confidence) || 0));
  const frames = Array.isArray(intelligence?.frames) ? intelligence.frames : [];
  const frame = (timeframe: string) => frames.find((item) => item.timeframe === timeframe);
  const m1 = frame("M1");
  const m5 = frame("M5");
  const m15 = frame("M15");
  const h1 = frame("H1");
  const directional = action ? directionLabel(action) : "NONE";
  const opposite = action === "BUY" ? "SELL" : "BUY";
  const alignedFrames = action
    ? frames.filter((item) => item.available && item.direction === action).length
    : 0;
  const htfAligned = Boolean(
    action &&
    m15?.available && h1?.available &&
    m15.direction !== opposite &&
    h1.direction !== opposite &&
    (m15.direction === action || h1.direction === action)
  );
  const m1Trigger = Boolean(
    action &&
    m1?.available &&
    (m1.direction === action || rejectionForSide(m1.rejection, action))
  );
  const volumeRatio = Math.max(
    finite(m1?.volumeRatio) ? Number(m1.volumeRatio) : 0,
    finite(m5?.volumeRatio) ? Number(m5.volumeRatio) : 0,
    finite(market.volumeRatio) ? Number(market.volumeRatio) : 0
  );
  const structureTriggers = [
    market.breakOfStructure,
    market.changeOfCharacter,
    market.liquiditySweep,
    market.fairValueGap
  ].filter((value) => String(value || "").toUpperCase() === directional);
  const marketReady = Boolean(
    cleanSymbol(market.symbol) === "XAUUSD" &&
    market.tradeable === true &&
    finite(market.bid) && market.bid > 0 &&
    finite(market.ask) && market.ask >= market.bid &&
    isFreshIso(market.priceTime, Number.isFinite(now) ? now : Date.now()) &&
    market.structureSource === "OANDA_CANDLES" &&
    Number(market.candleCount || 0) >= 200
  );
  const mtfAligned = Boolean(
    action &&
    intelligence?.availableFrames >= 3 &&
    intelligence.consensus === action &&
    alignedFrames >= 3
  );
  const sessionValid = market.killzone === true;
  const scoreValid = Boolean(action && setupScore >= MINIMUM_SCORE);
  const structureValid = structureTriggers.length >= 1;
  const volumeValid = volumeRatio >= MINIMUM_VOLUME_RATIO;
  const rrValid = targets.targets.length >= 1;

  const gates: XauStrategyGate[] = [
    gate("REAL_DATA", "Dati OANDA reali", marketReady, marketReady ? "Quote fresca e almeno 200 candele confermate." : "Quote/struttura OANDA non complete o non fresche."),
    gate("KILLZONE", "Killzone professionale", sessionValid, sessionValid ? String(market.session) : `${market.session || "N/A"}: attesa London Open o London/NY overlap.`),
    gate("SETUP_SCORE", "Setup score", scoreValid, `${Math.round(setupScore)}/100 · minimo ${MINIMUM_SCORE}/100.`),
    gate("MTF_CONTEXT", "Bias H1 + M15", htfAligned, `H1 ${h1?.direction || "N/A"} · M15 ${m15?.direction || "N/A"}.`),
    gate("MTF_ALIGNMENT", "Allineamento 3/4", mtfAligned, `${alignedFrames}/${intelligence?.availableFrames || 0} timeframe allineati ${action || "HOLD"}.`),
    gate("M1_TRIGGER", "Trigger M1", m1Trigger, `M1 ${m1?.direction || "N/A"} · rejection ${m1?.rejection || "N/A"}.`),
    gate("STRUCTURE", "Liquidità / struttura", structureValid, structureTriggers.length ? structureTriggers.join(" + ") : "Nessun BOS, CHoCH, sweep o FVG direzionale."),
    gate("VOLUME", "Volume spike", volumeValid, `${volumeRatio > 0 ? volumeRatio.toFixed(2) : "N/A"}x · minimo ${MINIMUM_VOLUME_RATIO.toFixed(2)}x.`),
    gate("RISK_REWARD", "R:R strutturale", rrValid, rrValid ? `TP1 reale 1:${targets.ratios[0].toFixed(2)}.` : `Nessun target strutturale reale ad almeno 1:${MINIMUM_RISK_REWARD}.`)
  ];
  const failed = gates.find((item) => !item.passed);
  const candleTime = String(m1?.candleTime || market.candleTime || "");
  const signature = `XAUUSD:${candleTime || input.evaluatedAt}:${action || "HOLD"}`;

  return {
    signalId: input.signalId,
    signature,
    symbol: "XAUUSD",
    timeframe: "M1",
    evaluatedAt: input.evaluatedAt,
    candleTime,
    priceTime: String(market.priceTime || ""),
    side: action,
    entryPrice: finite(entry) && entry > 0 ? entry : undefined,
    stopLoss: directionalStop ? stop : undefined,
    takeProfits: targets.targets,
    minimumRiskReward: MINIMUM_RISK_REWARD,
    riskRewardRatios: targets.ratios,
    setupScore,
    eligible: gates.every((item) => item.passed),
    blocker: failed?.key,
    reasoning: `${decision.reasoning} MTF: ${intelligence?.reasoning || "non disponibile"}`,
    session: String(market.session || "N/A"),
    killzone: market.killzone === true,
    multiTimeframeConsensus: intelligence?.consensus || "HOLD",
    multiTimeframeAlignment: intelligence?.alignmentScore,
    gates
  };
}

function targetWeights(targetCount: number) {
  if (targetCount <= 1) return [1];
  if (targetCount === 2) return [0.6, 0.4];
  return [0.4, 0.35, 0.25];
}

function cloneCandidate(candidate: XauSignalCandidate | undefined) {
  if (!candidate) return undefined;
  return {
    ...candidate,
    takeProfits: [...candidate.takeProfits],
    riskRewardRatios: [...candidate.riskRewardRatios],
    gates: candidate.gates.map((item) => ({ ...item })),
    ai: candidate.ai ? { ...candidate.ai } : undefined
  };
}

function cloneSignal(signal: XauSignalRecord) {
  return {
    ...signal,
    takeProfits: [...signal.takeProfits],
    riskRewardRatios: [...signal.riskRewardRatios],
    gates: signal.gates.map((item) => ({ ...item })),
    ai: { ...signal.ai }
  };
}

export class XauSignalLab {
  private signals: XauSignalRecord[] = [];
  private reviewedSignatures = new Set<string>();
  private latestCandidate?: XauSignalCandidate;
  private latestUpdatedAt?: string;

  observeCandidate(candidate: XauSignalCandidate) {
    const preservedAi = this.latestCandidate?.signature === candidate.signature
      ? this.latestCandidate.ai
      : undefined;
    this.latestCandidate = {
      ...cloneCandidate(candidate)!,
      ai: preservedAi
    };
    this.latestUpdatedAt = candidate.evaluatedAt;
  }

  canRequestAi(candidate: XauSignalCandidate, at = candidate.evaluatedAt): ReviewEligibility {
    if (!candidate.eligible) return { allowed: false, reason: candidate.blocker || "STRATEGY_GATES_NOT_PASSED" };
    if (this.reviewedSignatures.has(candidate.signature)) return { allowed: false, reason: "M1_CANDLE_ALREADY_REVIEWED" };
    if (this.todaySignals(at) >= MAX_SIGNALS_PER_DAY) return { allowed: false, reason: "DAILY_SIGNAL_CAP_REACHED" };
    if (this.signals.some((signal) => !signal.closedAt)) return { allowed: false, reason: "ONE_XAU_SIGNAL_ALREADY_OPEN" };

    const latestClosed = this.signals
      .filter((signal) => signal.closedAt)
      .sort((a, b) => String(b.closedAt).localeCompare(String(a.closedAt)))[0];
    if (latestClosed?.closedAt) {
      const elapsed = Date.parse(at) - Date.parse(latestClosed.closedAt);
      if (Number.isFinite(elapsed) && elapsed >= 0 && elapsed < COOLDOWN_MS) {
        return { allowed: false, reason: "FIVE_MINUTE_COOLDOWN_ACTIVE" };
      }
    }
    return { allowed: true };
  }

  setRuntimeBlocker(candidate: XauSignalCandidate, reason?: string) {
    this.observeCandidate(candidate);
    if (this.latestCandidate) this.latestCandidate.runtimeBlocker = reason;
  }

  recordAiReview(candidate: XauSignalCandidate, result: AiConfirmationResult): XauSignalRecord | undefined {
    const ai: XauAiReview = {
      provider: result.provider,
      model: result.model,
      status: result.status,
      approved: result.approved,
      reason: result.reason,
      checkedAt: result.checkedAt
    };
    this.reviewedSignatures.add(candidate.signature);
    this.latestCandidate = { ...cloneCandidate(candidate)!, ai };
    this.latestUpdatedAt = result.checkedAt;
    if (!candidate.eligible || !result.approved) return undefined;

    const capacity = this.canRequestAiAfterReview(candidate, result.checkedAt);
    if (!capacity.allowed) {
      this.latestCandidate.runtimeBlocker = capacity.reason;
      return undefined;
    }
    if (!candidate.side || !finite(candidate.entryPrice) || !finite(candidate.stopLoss) || candidate.takeProfits.length === 0) {
      this.latestCandidate.runtimeBlocker = "CANDIDATE_LEVELS_NOT_VERIFIED";
      return undefined;
    }

    const openedAt = result.checkedAt;
    const signal: XauSignalRecord = {
      id: `XAU-SIGNAL-${openedAt.replace(/[^0-9]/g, "")}`,
      symbol: "XAUUSD",
      timeframe: "M1",
      source: "OANDA_SIGNAL_ONLY",
      orderSubmitted: false,
      side: candidate.side,
      status: "OPEN",
      entryPrice: candidate.entryPrice,
      currentPrice: candidate.entryPrice,
      stopLoss: candidate.stopLoss,
      activeStop: candidate.stopLoss,
      takeProfits: [...candidate.takeProfits],
      riskRewardRatios: [...candidate.riskRewardRatios],
      setupScore: candidate.setupScore,
      openedAt,
      updatedAt: openedAt,
      candleTime: candidate.candleTime,
      priceTime: candidate.priceTime,
      hitTargets: 0,
      protectedAtBreakEven: false,
      liveR: 0,
      resultR: 0,
      maxFavorableR: 0,
      maxAdverseR: 0,
      session: candidate.session,
      reasoning: candidate.reasoning,
      multiTimeframeConsensus: candidate.multiTimeframeConsensus,
      multiTimeframeAlignment: candidate.multiTimeframeAlignment,
      gates: candidate.gates.map((item) => ({ ...item })),
      ai
    };
    this.signals = [signal, ...this.signals].slice(0, 100);
    return cloneSignal(signal);
  }

  updateQuote(quote: XauQuote, now = new Date()): XauSignalRecord[] {
    if (
      quote?.tradeable !== true ||
      !finite(quote?.bid) || quote.bid <= 0 ||
      !finite(quote?.ask) || quote.ask < quote.bid ||
      !isFreshIso(quote.time, now.getTime())
    ) {
      return [];
    }

    const closed: XauSignalRecord[] = [];
    for (const signal of this.signals) {
      if (signal.closedAt) continue;
      const price = signal.side === "BUY" ? quote.bid : quote.ask;
      const direction = signal.side === "BUY" ? 1 : -1;
      const risk = Math.abs(signal.entryPrice - signal.stopLoss);
      if (!finite(risk) || risk <= 0) continue;
      const liveR = ((price - signal.entryPrice) * direction) / risk;
      signal.currentPrice = price;
      signal.priceTime = quote.time;
      signal.updatedAt = now.toISOString();
      signal.liveR = Math.round(liveR * 100) / 100;
      signal.maxFavorableR = Math.max(signal.maxFavorableR, signal.liveR);
      signal.maxAdverseR = Math.min(signal.maxAdverseR, signal.liveR);

      const activeStop = signal.protectedAtBreakEven ? signal.entryPrice : signal.stopLoss;
      signal.activeStop = activeStop;
      const stopHit = signal.side === "BUY" ? price <= activeStop : price >= activeStop;
      if (stopHit) {
        signal.resultR = signal.hitTargets === 0 ? -1 : Math.round(signal.resultR * 100) / 100;
        signal.status = signal.hitTargets === 0 ? "STOPPED" : "PROTECTED";
        signal.closeReason = signal.hitTargets === 0 ? "STRUCTURAL_STOP_HIT" : "BREAKEVEN_AFTER_PARTIALS";
        signal.closedAt = now.toISOString();
        closed.push(cloneSignal(signal));
        continue;
      }

      const weights = targetWeights(signal.takeProfits.length);
      for (let index = signal.hitTargets; index < signal.takeProfits.length; index += 1) {
        const target = signal.takeProfits[index];
        const targetHit = signal.side === "BUY" ? price >= target : price <= target;
        if (!targetHit) break;
        signal.hitTargets = index + 1;
        signal.resultR += weights[index] * signal.riskRewardRatios[index];
        signal.resultR = Math.round(signal.resultR * 100) / 100;
        signal.status = (`TP${Math.min(index + 1, 3)}_HIT`) as XauSignalStatus;
        signal.protectedAtBreakEven = true;
        signal.activeStop = signal.entryPrice;
      }

      if (signal.hitTargets === signal.takeProfits.length && signal.takeProfits.length > 0) {
        signal.closeReason = "FINAL_STRUCTURAL_TARGET_HIT";
        signal.closedAt = now.toISOString();
        closed.push(cloneSignal(signal));
        continue;
      }

      const age = now.getTime() - Date.parse(signal.openedAt);
      if (Number.isFinite(age) && age >= MAX_DURATION_MS) {
        const realizedWeight = weights.slice(0, signal.hitTargets).reduce((sum, value) => sum + value, 0);
        const remainingWeight = Math.max(0, 1 - realizedWeight);
        signal.resultR = Math.round((signal.resultR + remainingWeight * signal.liveR) * 100) / 100;
        signal.status = "EXPIRED";
        signal.closeReason = "NINETY_MINUTE_SIGNAL_EXPIRY";
        signal.closedAt = now.toISOString();
        closed.push(cloneSignal(signal));
      }
    }
    if (closed.length > 0) this.latestUpdatedAt = now.toISOString();
    return closed;
  }

  getSnapshot(at = new Date()): XauSignalLabSnapshot {
    const today = utcDate(at);
    const todaySignals = this.signals.filter((signal) => utcDate(signal.openedAt) === today).length;
    const open = this.signals.filter((signal) => !signal.closedAt);
    const closed = this.signals.filter((signal) => Boolean(signal.closedAt));
    const wins = closed.filter((signal) => signal.resultR > 0).length;
    const losses = closed.filter((signal) => signal.resultR < 0).length;
    const breakevens = closed.filter((signal) => signal.resultR === 0).length;
    const totalR = Math.round(closed.reduce((sum, signal) => sum + signal.resultR, 0) * 100) / 100;

    return {
      symbol: "XAUUSD",
      mode: "SIGNAL_ONLY",
      executionEnabled: false,
      orderCount: 0,
      dataSource: "OANDA",
      resultUnit: "R",
      historyScope: "CURRENT_BOT_RUNTIME",
      strategy: {
        name: "GOLD LIQUIDITY CONFLUENCE",
        version: "1.0",
        triggerTimeframe: "M1",
        contextTimeframes: ["M5", "M15", "H1"],
        minimumRiskReward: MINIMUM_RISK_REWARD,
        maxSignalsPerDay: MAX_SIGNALS_PER_DAY,
        maxConcurrentSignals: MAX_CONCURRENT_SIGNALS,
        cooldownMinutes: 5,
        maxDurationMinutes: 90,
        management: "TP1 partial, stop to breakeven, TP2/TP3 scale-out"
      },
      dateUTC: today,
      todaySignals,
      remainingToday: Math.max(0, MAX_SIGNALS_PER_DAY - todaySignals),
      openSignals: open.length,
      closedSignals: closed.length,
      wins,
      losses,
      breakevens,
      winRate: closed.length > 0 ? Math.round((wins / closed.length) * 1000) / 10 : undefined,
      totalR,
      averageR: closed.length > 0 ? Math.round((totalR / closed.length) * 100) / 100 : undefined,
      latestUpdatedAt: this.latestUpdatedAt,
      latestCandidate: cloneCandidate(this.latestCandidate),
      signals: this.signals.map(cloneSignal)
    };
  }

  private todaySignals(at: string) {
    const today = utcDate(at);
    return this.signals.filter((signal) => utcDate(signal.openedAt) === today).length;
  }

  private canRequestAiAfterReview(candidate: XauSignalCandidate, at: string): ReviewEligibility {
    if (!isFreshIso(candidate.priceTime, Date.parse(at))) {
      return { allowed: false, reason: "OANDA_QUOTE_STALE_AFTER_AI_REVIEW" };
    }
    if (this.todaySignals(at) >= MAX_SIGNALS_PER_DAY) return { allowed: false, reason: "DAILY_SIGNAL_CAP_REACHED" };
    if (this.signals.some((signal) => !signal.closedAt)) return { allowed: false, reason: "ONE_XAU_SIGNAL_ALREADY_OPEN" };
    return candidate.eligible ? { allowed: true } : { allowed: false, reason: candidate.blocker };
  }
}

export const xauSignalLab = new XauSignalLab();
