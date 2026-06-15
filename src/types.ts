export interface MarketData {
  symbol: string;
  timeframe: string;

  bid: number;
  ask: number;
  spread: number;

  highPrice: number;
  lowPrice: number;
  closePrice: number;

  ema20: number;
  ema50: number;
  ema200: number;

  rsi: number;

  macdMain: number;
  macdSignal: number;
  macdHistogram: number;

  adx?: number;
  plusDI?: number;
  minusDI?: number;

  bollingerUpper?: number;
  bollingerMid?: number;
  bollingerLower?: number;

  volume?: number;
  volumeRatio?: number;

  atr?: number;

  swingHigh?: number;
  swingLow?: number;

  structureBias?: string;
  nearOrderBlock?: boolean;
  fairValueGap?: string;
  liquidityLevel?: string;

  session: string;
  killzone?: boolean;

  trend: string;
  volatility: string;

  accountBalance: number;
  accountEquity: number;

  openPositions: number;
  todayTradeCount: number;
}

export interface TradingDecision {
  action: "BUY" | "SELL" | "HOLD";
  confidence: number;

  entryPrice?: number;

  stopLossPips?: number;
  takeProfitPips?: number;

  lotSize?: number;

  reasoning: string;

  riskRewardRatio?: number;

  setupType?: string;
}
