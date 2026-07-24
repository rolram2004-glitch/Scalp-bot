export interface BotTrade {
  id: string;
  symbol?: string;
  side?: 'BUY' | 'SELL' | 'HOLD' | string;
  status?: 'OPEN' | 'CLOSED' | string;
  entryPrice?: number;
  currentPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
  pnl?: number;
  pnlPips?: number;
  openedAt?: string;
  closedAt?: string;
  setupType?: string;
  confidence?: number;
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
}

export interface TradingDecisionSnapshot {
  action: 'BUY' | 'SELL' | 'HOLD' | string;
  confidence: number;
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
  reasoning: string;
  setupType?: string;
  mode: 'LIVE OANDA PRACTICE' | 'PAPER' | 'PAPER SHADOW';
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

export interface StatusSnapshot {
  status: string;
  isRunning: boolean;
  startedAt?: string;
  lastUpdated?: string;
  lastPriceAt?: string;
  priceFeedStatus?: 'CONNECTED' | 'DISCONNECTED';
  dataSource: string;
  oandaConnected?: boolean;
  oandaReason?: string;
  executionMode: string;
  tradingMode: 'PAPER' | 'LIVE';
  liveTradingEnabled: boolean;
  liveExecutionVariant: 'MAIN' | 'INVERSE' | 'INVALID';
  liveExecutionVariantValid: boolean;
  accountCurrency?: string;
  symbols: string[];
  maxDailyTrades: number;
  minimumConfidence?: number;
  maxOpenPositions: number;
  maxDailyLoss?: number;
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
  signalsAnalyzed: number;
  signalsDiscarded: number;
  openTrades: BotTrade[];
  closedTrades: BotTrade[];
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
  priceCoverage?: number;
  priceExpected?: number;
  reconciliationStatus?: 'NOT_RUN' | 'VERIFIED' | 'FAILED';
  lastReconciledAt?: string;
  lastOrderAttemptAt?: string;
  lastOrderStatus?: 'SUBMITTING' | 'OPEN_VERIFIED' | 'REJECTED' | 'SKIPPED';
  lastOrderReason?: string;
  lastOandaOrderId?: string;
  lastOandaTradeId?: string;
}
