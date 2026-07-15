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
  verificationStatus?: 'VERIFIED' | 'NOT_VERIFIED' | string;
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
  accountId?: string;
  mode?: string;
  reason?: string;
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
  accountCurrency?: string;
  symbols: string[];
  dailyTarget: number;
  maxDailyTrades: number;
  maxOpenPositions: number;
  defaultLotSize?: number;
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
  session: string;
  killzone: boolean;
  logs: string[];
  marketData?: Record<string, any>;
  livePrices?: Record<string, { bid: number; ask: number; mid: number; time: string; tradeable: boolean }>;
  lastSignals?: Record<string, TradingDecisionSnapshot>;
}
