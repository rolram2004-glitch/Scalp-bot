export interface MarketData {
  symbol: string;
  timeframe: string;

  bid: number;
  ask: number;
  spread: number;
  priceTime?: string;
  candleTime?: string;
  tradeable?: boolean;

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

  swingHighs?: Array<{ time: string; price: number }>;
  swingLows?: Array<{ time: string; price: number }>;
  supportLevels?: number[];
  resistanceLevels?: number[];

  structureBias?: string;
  fairValueGap?: string;
  fairValueGapZone?: { direction: "BULLISH" | "BEARISH"; low: number; high: number; time: string };
  liquidityLevel?: string;
  breakOfStructure?: "BULLISH" | "BEARISH" | "NONE";
  changeOfCharacter?: "BULLISH" | "BEARISH" | "NONE";
  liquiditySweep?: "BULLISH" | "BEARISH" | "NONE";
  equalHigh?: number;
  equalLow?: number;
  structureSource?: "OANDA_CANDLES";
  candleCount?: number;

  session: string;
  killzone?: boolean;

  trend: string;
  volatility: string;

  accountBalance?: number;
  accountEquity?: number;

  openPositions?: number;
  todayTradeCount?: number;
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

  evidence?: Array<{ label: string; direction: "BUY" | "SELL" | "NEUTRAL"; value: string }>;
  stopLossPrice?: number;
  structuralTargets?: number[];
}
