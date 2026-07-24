import { useState } from 'react';
import { BotTrade, StatusSnapshot } from '../types';

type HistoryFilter = 'LIVE' | 'PAPER' | 'SHADOW';

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function compactSymbol(value?: string) {
  return String(value || '').toUpperCase().replace(/[^A-Z]/g, '');
}

function quoteCurrency(symbol?: string) {
  const normalized = compactSymbol(symbol);
  return normalized.length === 6 ? normalized.slice(-3) : undefined;
}

function price(value: unknown, symbol?: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 'N/A';
  const normalized = compactSymbol(symbol);
  return parsed.toFixed(normalized.includes('JPY') || normalized.includes('XAU') ? 3 : 5);
}

function dateTime(value?: string) {
  if (!value) return { date: 'N/A', time: 'N/A' };
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return { date: 'N/A', time: 'N/A' };
  return { date: parsed.toLocaleDateString(), time: parsed.toLocaleTimeString() };
}

function money(trade: BotTrade, filter: HistoryFilter) {
  if (!finite(trade.pnl)) return 'N/A';
  const currency = filter === 'LIVE'
    ? trade.accountCurrency
    : trade.pnlCurrency || quoteCurrency(trade.symbol);
  if (!currency) return 'N/A';
  return `${trade.pnl >= 0 ? '+' : '-'}${Math.abs(trade.pnl).toFixed(2)} ${currency}`;
}

function duration(trade: BotTrade) {
  if (!trade.openedAt) return 'N/A';
  if (!trade.closedAt) return trade.status === 'OPEN' ? 'OPEN' : 'N/A';
  const start = Date.parse(trade.openedAt);
  const end = Date.parse(trade.closedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 'N/A';
  const seconds = Math.floor((end - start) / 1000);
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)} min`;
}

function identifier(trade: BotTrade) {
  return trade.oandaTradeId || trade.oandaTradeID || trade.tradeId || trade.tradeID;
}

export function HistoryPage({ status }: { status: StatusSnapshot | null }) {
  const [filter, setFilter] = useState<HistoryFilter>('LIVE');
  const live = [...(status?.closedTrades || []), ...(status?.openTrades || [])]
    .filter((trade) => trade.source === 'OANDA' && trade.verificationStatus === 'VERIFIED');
  const paper = [...(status?.closedTrades || []), ...(status?.openTrades || [])]
    .filter((trade) => trade.source === 'PAPER');
  const shadow = [...(status?.shadowClosedTrades || []), ...(status?.shadowOpenTrades || [])]
    .filter((trade) => trade.source === 'PAPER_SHADOW');
  const selected = (filter === 'LIVE' ? live : filter === 'PAPER' ? paper : shadow)
    .sort((left, right) => Date.parse(right.closedAt || right.openedAt || '') - Date.parse(left.closedAt || left.openedAt || ''))
    .slice(0, 80);

  return (
    <div className="history-page">
      <section className="page-hero">
        <div><p className="eyebrow">History</p><h1>Ledger separati: OANDA verificato, PAPER e PAPER SHADOW.</h1></div>
        <div className="system-warning">NESSUNA FONTE MISTA</div>
      </section>

      <div className="time-tabs">
        {(['LIVE', 'PAPER', 'SHADOW'] as HistoryFilter[]).map((item) => (
          <button key={item} className={filter === item ? 'time-chip active' : 'time-chip'} onClick={() => setFilter(item)}>
            {item === 'LIVE' ? 'LIVE OANDA' : item === 'PAPER' ? 'PAPER' : 'PAPER SHADOW'} · {item === 'LIVE' ? live.length : item === 'PAPER' ? paper.length : shadow.length}
          </button>
        ))}
      </div>

      <section className="panel history-panel">
        <div className="history-head"><span>Ora / Strumento</span><span>Direzione / Unita</span><span>Setup / Stato</span><span>Entrata / Uscita</span><span>P&amp;L</span></div>
        <div className="history-list">
          {selected.length > 0 ? selected.map((trade) => {
            const opened = dateTime(trade.openedAt);
            const tradeId = identifier(trade);
            const pnl = money(trade, filter);
            return (
              <article key={`${filter}-${trade.id}`} className="history-item">
                <div><strong>{trade.symbol || 'N/A'}</strong><span>{opened.date}</span><span>{opened.time}</span></div>
                <div><strong className={trade.side === 'BUY' ? 'win' : trade.side === 'SELL' ? 'loss' : ''}>{trade.side || 'N/A'}</strong><span>{finite(Number(trade.units)) ? `${trade.units} units` : 'Units N/A'}</span></div>
                <div><strong>{trade.setupType || 'N/A'}</strong><span>{trade.status || 'N/A'} · {trade.closeReason || 'reason N/A'}</span></div>
                <div><strong>{price(trade.entryPrice, trade.symbol)}</strong><span>to {price(trade.currentPrice, trade.symbol)}</span></div>
                <div className="history-result"><strong className={finite(trade.pnl) ? trade.pnl < 0 ? 'loss' : 'win' : ''}>{pnl}</strong><span>{finite(trade.pnlPips) ? `${trade.pnlPips >= 0 ? '+' : ''}${trade.pnlPips.toFixed(1)} pips` : 'Pips N/A'}</span></div>
                <div className="history-detail">
                  <div><span>Ragionamento</span><p>{trade.reasoning || 'N/A'}</p></div>
                  <div className="detail-grid">
                    <div><span>Fonte</span><strong>{trade.source || 'N/A'}</strong></div>
                    <div><span>Verifica</span><strong>{trade.verificationStatus || 'N/A'}</strong></div>
                    <div><span>OANDA trade ID</span><strong>{tradeId || 'N/A'}</strong></div>
                    <div><span>OANDA order ID</span><strong>{trade.oandaOrderId || trade.oandaOrderID || trade.orderId || trade.orderID || 'N/A'}</strong></div>
                    <div><span>Stop loss</span><strong className="loss">{price(trade.stopLoss, trade.symbol)}</strong></div>
                    <div><span>Take profit</span><strong className="win">{price(trade.takeProfit, trade.symbol)}</strong></div>
                    <div><span>Confidence</span><strong>{finite(trade.confidence) ? `${trade.confidence}%` : 'N/A'}</strong></div>
                    <div><span>Durata</span><strong>{duration(trade)}</strong></div>
                  </div>
                </div>
              </article>
            );
          }) : <div className="empty-state">{status ? `Nessun trade ${filter === 'LIVE' ? 'OANDA verificato' : filter} disponibile.` : 'DATI NON DISPONIBILI'}</div>}
        </div>
      </section>
    </div>
  );
}
