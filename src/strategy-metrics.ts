export interface MetricTrade {
  id: string;
  symbol?: string;
  side?: string;
  status?: string;
  openedAt?: string;
  closedAt?: string;
  signalAt?: string;
  signalId?: string;
  entryPrice?: number;
  currentPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
  pnlR?: number;
  pnlPips?: number;
  riskPips?: number;
  pnl?: number;
  riskAmount?: number;
  source?: string;
  accountCurrency?: string;
  pnlCurrency?: string;
  oandaTradeId?: string;
}

export type ComparisonWinner = 'MAIN' | 'INVERSE' | 'TIE' | 'OPEN' | 'UNAVAILABLE';

export interface TradePairComparison {
  signalId: string;
  symbol: string;
  main: MetricTrade;
  inverse: MetricTrade;
  timestamp: number;
  mainR?: number;
  inverseR?: number;
  bothClosed: boolean;
  comparable: boolean;
  winner: ComparisonWinner;
}

export interface StrategyMetrics {
  sampleSize: number;
  openTrades: number;
  closedTrades: number;
  wins: number;
  losses: number;
  breakeven: number;
  winRate?: number;
  totalR?: number;
  averageR?: number;
  profitFactor?: number;
  maxDrawdownR?: number;
  bestR?: number;
  worstR?: number;
}

export interface MonetaryOutcomeSummary {
  sampleSize: number;
  wins: number;
  losses: number;
  breakeven: number;
  winRate?: number;
  lossRate?: number;
  comparable: boolean;
  currency?: string;
  grossProfit?: number;
  grossLoss?: number;
  netPnl?: number;
}

export interface EquityPoint {
  index: number;
  label: string;
  main: number;
  inverse: number;
}

export interface SymbolEdge {
  symbol: string;
  pairs: number;
  mainR: number;
  inverseR: number;
  deltaR: number;
  winner: 'MAIN' | 'INVERSE' | 'TIE';
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function timestamp(trade?: MetricTrade) {
  if (!trade) return 0;
  return Date.parse(trade.closedAt || trade.openedAt || trade.signalAt || '') || 0;
}

function chooseRecord(current: MetricTrade | undefined, candidate: MetricTrade) {
  if (!current) return candidate;
  const currentClosed = current.status === 'CLOSED';
  const candidateClosed = candidate.status === 'CLOSED';
  if (candidateClosed !== currentClosed) return candidateClosed ? candidate : current;
  return timestamp(candidate) >= timestamp(current) ? candidate : current;
}

export function tradeResultR(trade?: MetricTrade) {
  if (!trade) return undefined;
  if (finite(trade.pnlR)) return trade.pnlR;
  if (finite(trade.pnlPips) && finite(trade.riskPips) && trade.riskPips > 0) {
    return trade.pnlPips / trade.riskPips;
  }
  const riskAmount = Number(trade.riskAmount);
  if (finite(trade.pnl) && Number.isFinite(riskAmount) && riskAmount > 0) {
    return trade.pnl / riskAmount;
  }
  return undefined;
}

export function calculateMonetaryOutcomeSummary(trades: MetricTrade[]): MonetaryOutcomeSummary {
  const records = trades.map((trade) => {
    const pnl = finite(trade.pnl) ? trade.pnl : undefined;
    const currency = String(trade.source === 'OANDA' ? trade.accountCurrency || '' : trade.pnlCurrency || '')
      .trim()
      .toUpperCase();
    return { pnl, currency };
  });
  const decided = records.filter((record) => finite(record.pnl) && record.pnl !== 0);
  const wins = decided.filter((record) => (record.pnl as number) > 0).length;
  const losses = decided.filter((record) => (record.pnl as number) < 0).length;
  const breakeven = records.filter((record) => record.pnl === 0).length;
  const currencies = new Set(records.map((record) => record.currency).filter(Boolean));
  const comparable = records.length > 0 &&
    records.every((record) => finite(record.pnl) && Boolean(record.currency)) &&
    currencies.size === 1;
  const values = comparable ? records.map((record) => record.pnl as number) : [];

  return {
    sampleSize: records.length,
    wins,
    losses,
    breakeven,
    winRate: decided.length > 0 ? (wins / decided.length) * 100 : undefined,
    lossRate: decided.length > 0 ? (losses / decided.length) * 100 : undefined,
    comparable,
    currency: comparable ? [...currencies][0] : undefined,
    grossProfit: comparable ? values.filter((value) => value > 0).reduce((sum, value) => sum + value, 0) : undefined,
    grossLoss: comparable ? values.filter((value) => value < 0).reduce((sum, value) => sum + value, 0) : undefined,
    netPnl: comparable ? values.reduce((sum, value) => sum + value, 0) : undefined
  };
}

export function pairTradesBySignal(mainTrades: MetricTrade[], inverseTrades: MetricTrade[]) {
  const mainBySignal = new Map<string, MetricTrade>();
  const inverseBySignal = new Map<string, MetricTrade>();

  mainTrades.forEach((trade) => {
    if (!trade.signalId) return;
    mainBySignal.set(trade.signalId, chooseRecord(mainBySignal.get(trade.signalId), trade));
  });
  inverseTrades.forEach((trade) => {
    if (!trade.signalId) return;
    inverseBySignal.set(trade.signalId, chooseRecord(inverseBySignal.get(trade.signalId), trade));
  });

  return [...mainBySignal.entries()]
    .flatMap(([signalId, main]) => {
      const inverse = inverseBySignal.get(signalId);
      if (!inverse) return [];
      const mainR = tradeResultR(main);
      const inverseR = tradeResultR(inverse);
      const bothClosed = main.status === 'CLOSED' && inverse.status === 'CLOSED';
      const comparable = bothClosed && finite(mainR) && finite(inverseR);
      const winner: ComparisonWinner = !bothClosed
        ? 'OPEN'
        : !comparable
          ? 'UNAVAILABLE'
          : Math.abs(mainR - inverseR) < 0.005
            ? 'TIE'
            : mainR > inverseR ? 'MAIN' : 'INVERSE';

      return [{
        signalId,
        symbol: String(main.symbol || inverse.symbol || 'N/A').toUpperCase().replace(/[^A-Z0-9]/g, ''),
        main,
        inverse,
        timestamp: Math.max(timestamp(main), timestamp(inverse)),
        mainR,
        inverseR,
        bothClosed,
        comparable,
        winner
      } satisfies TradePairComparison];
    })
    .sort((left, right) => right.timestamp - left.timestamp);
}

function metricsFromValues(values: number[], openTrades: number, closedTrades: number): StrategyMetrics {
  const wins = values.filter((value) => value > 0).length;
  const losses = values.filter((value) => value < 0).length;
  const breakeven = values.filter((value) => Math.abs(value) < 0.005).length;
  const decided = wins + losses;
  const gains = values.filter((value) => value > 0).reduce((sum, value) => sum + value, 0);
  const lossesR = Math.abs(values.filter((value) => value < 0).reduce((sum, value) => sum + value, 0));
  const totalR = values.reduce((sum, value) => sum + value, 0);
  let running = 0;
  let peak = 0;
  let maxDrawdownR = 0;

  values.forEach((value) => {
    running += value;
    peak = Math.max(peak, running);
    maxDrawdownR = Math.max(maxDrawdownR, peak - running);
  });

  return {
    sampleSize: values.length,
    openTrades,
    closedTrades,
    wins,
    losses,
    breakeven,
    winRate: decided > 0 ? (wins / decided) * 100 : undefined,
    totalR: values.length ? totalR : undefined,
    averageR: values.length ? totalR / values.length : undefined,
    profitFactor: values.length && gains > 0 ? (lossesR > 0 ? gains / lossesR : Number.POSITIVE_INFINITY) : values.length ? 0 : undefined,
    maxDrawdownR: values.length ? maxDrawdownR : undefined,
    bestR: values.length ? Math.max(...values) : undefined,
    worstR: values.length ? Math.min(...values) : undefined
  };
}

export function calculateTradeMetrics(trades: MetricTrade[]) {
  const chronological = [...trades].sort((left, right) => timestamp(left) - timestamp(right));
  const closed = chronological.filter((trade) => trade.status === 'CLOSED');
  const values = closed.map(tradeResultR).filter((value): value is number => finite(value));
  return metricsFromValues(values, trades.filter((trade) => trade.status === 'OPEN').length, closed.length);
}

export function calculatePairedLaneMetrics(pairs: TradePairComparison[], lane: 'MAIN' | 'INVERSE') {
  const chronological = [...pairs].sort((left, right) => left.timestamp - right.timestamp);
  const comparable = chronological.filter((pair) => pair.comparable);
  const values = comparable
    .map((pair) => lane === 'MAIN' ? pair.mainR : pair.inverseR)
    .filter((value): value is number => finite(value));
  return metricsFromValues(
    values,
    pairs.filter((pair) => !pair.bothClosed).length,
    pairs.filter((pair) => pair.bothClosed).length
  );
}

export function buildEquityCurve(pairs: TradePairComparison[]) {
  const comparable = [...pairs]
    .filter((pair) => pair.comparable && finite(pair.mainR) && finite(pair.inverseR))
    .sort((left, right) => left.timestamp - right.timestamp);
  let main = 0;
  let inverse = 0;
  const points: EquityPoint[] = [{ index: 0, label: 'START', main: 0, inverse: 0 }];
  comparable.forEach((pair, index) => {
    main += pair.mainR as number;
    inverse += pair.inverseR as number;
    points.push({ index: index + 1, label: pair.symbol, main, inverse });
  });
  return points;
}

export function calculateSymbolEdges(pairs: TradePairComparison[]) {
  const grouped = new Map<string, { pairs: number; mainR: number; inverseR: number }>();
  pairs.filter((pair) => pair.comparable && finite(pair.mainR) && finite(pair.inverseR)).forEach((pair) => {
    const current = grouped.get(pair.symbol) || { pairs: 0, mainR: 0, inverseR: 0 };
    current.pairs += 1;
    current.mainR += pair.mainR as number;
    current.inverseR += pair.inverseR as number;
    grouped.set(pair.symbol, current);
  });
  return [...grouped.entries()]
    .map(([symbol, value]): SymbolEdge => {
      const deltaR = value.mainR - value.inverseR;
      return {
        symbol,
        pairs: value.pairs,
        mainR: value.mainR,
        inverseR: value.inverseR,
        deltaR,
        winner: Math.abs(deltaR) < 0.005 ? 'TIE' : deltaR > 0 ? 'MAIN' : 'INVERSE'
      };
    })
    .sort((left, right) => right.pairs - left.pairs || Math.abs(right.deltaR) - Math.abs(left.deltaR));
}

export function comparisonCounts(pairs: TradePairComparison[]) {
  return pairs.reduce((totals, pair) => {
    if (pair.winner === 'MAIN') totals.main += 1;
    else if (pair.winner === 'INVERSE') totals.inverse += 1;
    else if (pair.winner === 'TIE') totals.ties += 1;
    else if (pair.winner === 'OPEN') totals.open += 1;
    else totals.unavailable += 1;
    return totals;
  }, { main: 0, inverse: 0, ties: 0, open: 0, unavailable: 0 });
}

export function sampleQuality(sampleSize: number) {
  if (sampleSize <= 0) return { label: 'NESSUN CAMPIONE', tone: 'neutral' as const };
  if (sampleSize < 10) return { label: 'CAMPIONE MINIMO', tone: 'warning' as const };
  if (sampleSize < 30) return { label: 'CAMPIONE RIDOTTO', tone: 'warning' as const };
  return { label: 'CAMPIONE UTILE', tone: 'good' as const };
}
