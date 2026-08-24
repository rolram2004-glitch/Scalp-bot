export interface BotTrade {
  id: string;
  symbol?: string;
  side?: 'BUY' | 'SELL' | 'HOLD' | string;
  status?: 'OPEN' | 'CLOSED' | string;
  entryPrice?: number;
  currentPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
  riskAmount?: number;
  rewardAmount?: number;
  pnl?: number;
  pnlPips?: number;
  pnlR?: number;
  riskPips?: number;
  rewardPips?: number;
  openedAt?: string;
  closedAt?: string;
  setupType?: string;
  confidence?: number;
  setupScore?: number;
  scoreLabel?: 'WEAK' | 'DEVELOPING' | 'VALID' | 'STRONG';
  reasoning?: string;
  closeReason?: string;
  riskRewardRatio?: number;
  units?: number | string;
  initialUnits?: number | string;
  currentUnits?: number | string;
  source?: string;
  dataSource?: string;
  executionMode?: string;
  mode?: string;
  oandaOrderId?: string;
  oandaOrderID?: string;
  orderId?: string;
  orderID?: string;
  oandaTradeId?: string;
  oandaTradeID?: string;
  tradeId?: string;
  tradeID?: string;
  accountCurrency?: string;
  pnlCurrency?: string;
  verificationStatus?: 'VERIFIED' | 'NOT_VERIFIED' | string;
  strategyVariant?: 'MAIN' | 'INVERSE' | string;
  signalId?: string;
  signalAt?: string;
  priceTime?: string;
  pairedWithTradeId?: string;
}

export interface TradingDecisionSnapshot {
  action: 'BUY' | 'SELL' | 'HOLD' | string;
  confidence: number;
  setupScore?: number;
  scoreLabel?: 'WEAK' | 'DEVELOPING' | 'VALID' | 'STRONG';
  reasoning?: string;
  entryPrice?: number;
  lotSize?: number;
  riskRewardRatio?: number;
  setupType?: string;
  scannedAt: string;
}

export interface OandaStatus {
  connected?: boolean;
  currency?: string;
  balance?: string | number;
  nav?: string | number;
  unrealizedPL?: string | number;
  openTradeCount?: string | number;
  openPositionCount?: string | number;
  marginAvailable?: string | number;
  state?: string;
  accountId?: string;
  mode?: string;
  reason?: string;
  endpoint?: string;
  checkedAt?: string;
  errorStatus?: string | number | null;
  errorCode?: string | null;
  errorMessage?: string | null;
}

export interface SignalLaneSnapshot {
  variant: 'MAIN' | 'INVERSE';
  action: 'BUY' | 'SELL' | 'HOLD';
  confidence: number;
  setupScore?: number;
  scoreLabel?: 'WEAK' | 'DEVELOPING' | 'VALID' | 'STRONG';
  scoreBreakdown?: {
    trend: number;
    momentum: number;
    structure: number;
    liquidity: number;
    volatility: number;
    spread: number;
    session: number;
    risk: number;
  };
  reasoning: string;
  setupType?: string;
  entryPrice?: number;
  stopLossPrice?: number;
  takeProfitPrice?: number;
  structuralTargets?: number[];
  riskRewardRatio?: number;
  mode: string;
  selectedForExecution: boolean;
  executionState: 'SHADOW' | 'PAPER' | 'NOT_ELIGIBLE' | 'READY' | 'SUBMITTING' | 'SKIPPED' | 'REJECTED' | 'OPEN_VERIFIED';
  executionReason?: string;
  oandaOrderId?: string;
  oandaTradeId?: string;
  derivedFrom?: 'MAIN';
}

export interface PairedSignalSnapshot {
  pairId: string;
  symbol: string;
  evaluatedAt: string;
  market: {
    source: 'OANDA';
    instrument: string;
    time: string;
    bid: number;
    ask: number;
    mid: number;
    tradeable: boolean;
  };
  analysis: {
    candleTime: string;
    timeframe: string;
    ema20: number;
    ema50: number;
    ema200: number;
    rsi: number;
    spread: number;
    structureBias?: string;
    trend?: string;
    macdHistogram?: number;
    atr?: number;
    volatility?: string;
    volumeRatio?: number;
    breakOfStructure?: 'BULLISH' | 'BEARISH' | 'NONE';
    changeOfCharacter?: 'BULLISH' | 'BEARISH' | 'NONE';
    liquiditySweep?: 'BULLISH' | 'BEARISH' | 'NONE';
    fairValueGap?: string;
    equalHigh?: number;
    equalLow?: number;
    supportLevels?: number[];
    resistanceLevels?: number[];
    structureSource?: 'OANDA_CANDLES';
    candleCount?: number;
  };
  marketValid: boolean;
  marketValidationReason?: string;
  main: SignalLaneSnapshot;
  inverse: SignalLaneSnapshot;
  executionBlockedReason?: string;
}

export interface XauStrategyGate {
  key: string;
  label: string;
  passed: boolean;
  detail: string;
}

export interface XauAiReview {
  provider: 'DISABLED' | 'GEMINI' | 'OPENAI';
  model?: string;
  status: 'DISABLED' | 'APPROVED' | 'REJECTED' | 'ERROR';
  approved: boolean;
  reason: string;
  checkedAt: string;
}

export interface XauSignalCandidate {
  signalId: string;
  signature: string;
  symbol: 'XAUUSD';
  timeframe: 'M1';
  evaluatedAt: string;
  candleTime: string;
  priceTime: string;
  side?: 'BUY' | 'SELL';
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
  multiTimeframeConsensus: 'BUY' | 'SELL' | 'HOLD';
  multiTimeframeAlignment?: number;
  gates: XauStrategyGate[];
  ai?: XauAiReview;
}

export interface XauSignalRecord {
  id: string;
  symbol: 'XAUUSD';
  timeframe: 'M1';
  source: 'OANDA_SIGNAL_ONLY';
  orderSubmitted: false;
  side: 'BUY' | 'SELL';
  status: 'OPEN' | 'TP1_HIT' | 'TP2_HIT' | 'TP3_HIT' | 'STOPPED' | 'PROTECTED' | 'EXPIRED';
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
  multiTimeframeConsensus: 'BUY' | 'SELL' | 'HOLD';
  multiTimeframeAlignment?: number;
  gates: XauStrategyGate[];
  ai: XauAiReview;
}

export interface XauSignalLabSnapshot {
  symbol: 'XAUUSD';
  mode: 'SIGNAL_ONLY';
  executionEnabled: false;
  orderCount: 0;
  dataSource: 'OANDA';
  resultUnit: 'R';
  historyScope: 'CURRENT_BOT_RUNTIME';
  strategy: {
    name: string;
    version: string;
    triggerTimeframe: 'M1';
    contextTimeframes: ['M5', 'M15', 'H1'];
    minimumRiskReward: number;
    maxSignalsPerDay: number;
    maxConcurrentSignals: number;
    cooldownMinutes: number;
    maxDurationMinutes: number;
    management: string;
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

export interface StatusSnapshot {
  status: string;
  isRunning: boolean;
  startedAt?: string;
  lastUpdated?: string;
  lastPriceAt?: string;
  priceFeedStatus?: 'CONNECTED' | 'PARTIAL' | 'DISCONNECTED';
  dataSource: string;
  oandaConnected?: boolean;
  oandaReason?: string;
  executionMode: string;
  tradingMode: 'PAPER' | 'OANDA_DEMO' | 'OANDA_LIVE';
  effectiveExecutionState:
    | 'UNAVAILABLE'
    | 'PAPER'
    | 'OANDA_DEMO_BLOCKED'
    | 'OANDA_DEMO_READY'
    | 'OANDA_LIVE_BLOCKED'
    | 'OANDA_LIVE_READY';
  liveTradingEnabled: boolean;
  liveExecutionVariant: 'MAIN' | 'INVERSE' | 'INVALID';
  liveExecutionVariantValid: boolean;
  aiProvider?: 'DISABLED' | 'GEMINI' | 'OPENAI';
  aiConfirmationRequired?: boolean;
  aiStatus?: 'DISABLED' | 'NOT_CHECKED' | 'APPROVED' | 'REJECTED' | 'ERROR';
  lastAiReason?: string;
  lastAiCheckedAt?: string;
  lastAiSignalId?: string;
  accountCurrency?: string;
  symbols: string[];
  signalProfile?: 'ROHATO_ULTRA_100_PER_MINUTE' | 'ROHATO_HYPER_100_PER_SYMBOL' | 'ROHATO_AGGRESSIVE_100' | 'AGGRESSIVE_25' | 'BALANCED';
  maxDailyTrades: number;
  maxDailyTradesPerSymbol?: number;
  maxTradesPerMinute?: number;
  tradesLastMinute?: number;
  minuteRemainingTrades?: number;
  minimumConfidence?: number;
  maxOpenPositions: number;
  maxNewTradesPerCycle?: number;
  maxTradesPerSymbol?: number;
  scanIntervalMs?: number;
  dailyLossLimitEnabled?: boolean;
  maxDailyLoss?: number | null;
  symbolReentryCooldownMs?: number;
  currentSymbol?: string;
  currentAction?: string;
  currentConfidence?: number;
  currentReasoning?: string;
  currentPrice?: number;
  entryPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
  riskAmount?: number;
  rewardAmount?: number;
  profitLoss?: number;
  dailyTradeCount: number;
  dailyTradeCountBySymbol?: Record<string, number>;
  signalsAnalyzed: number;
  signalsDiscarded: number;
  openTrades: BotTrade[];
  closedTrades: BotTrade[];
  orphanTrades: BotTrade[];
  shadowOpenTrades: BotTrade[];
  shadowClosedTrades: BotTrade[];
  shadowTradeCount: number;
  session: string;
  killzone: boolean;
  logs: string[];
  marketData?: Record<string, any>;
  livePrices?: Record<string, { bid: number; ask: number; mid: number; time: string; tradeable: boolean }>;
  lastSignals?: Record<string, TradingDecisionSnapshot>;
  pairedSignals?: Record<string, PairedSignalSnapshot>;
  latestPairedSignal?: PairedSignalSnapshot;
  xauSignalLab?: XauSignalLabSnapshot;
  priceCoverage?: number;
  priceExpected?: number;
  reconciliationStatus?: 'NOT_RUN' | 'VERIFIED' | 'FAILED';
  lastReconciledAt?: string;
  lastOrderAttemptAt?: string;
  lastOrderStatus?: 'SUBMITTING' | 'OPEN_VERIFIED' | 'REJECTED' | 'SKIPPED';
  lastOrderReason?: string;
  lastOandaOrderId?: string;
  lastOandaTradeId?: string;
  entryGateStatus?:
    | 'READY'
    | 'SCANNER_STOPPED'
    | 'EXECUTION_BLOCKED'
    | 'MINUTE_RATE_LIMIT'
    | 'DAILY_TRADE_LIMIT'
    | 'DAILY_LOSS_LIMIT'
    | 'MAX_OPEN_POSITIONS';
  entryGateReason?: string;
  dailyRemainingTrades?: number;
  nextDailyResetAt?: string;
  dailyRiskStatus: {
    dateUTC: string;
    tradeCount: number;
    maxTrades: number;
    pnl: number | null;
    currency?: string;
    complete: boolean;
    reason?: string;
    remainingTrades?: number;
    resetAt?: string;
  };
}
