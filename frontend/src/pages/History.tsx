function price(value?: number) {
  return typeof value === 'number' ? value.toFixed(5) : '-';
}

function money(value = 0) {
  return `${value >= 0 ? '+' : '-'}$${Math.abs(value).toFixed(2)}`;
}

function duration(openedAt?: string, closedAt?: string) {
  if (!openedAt) return '-';
  const end = closedAt ? new Date(closedAt).getTime() : Date.now();
  const seconds = Math.max(0, Math.floor((end - new Date(openedAt).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)} min`;
}

export function HistoryPage({ status }: { status: any }) {
  const trades = [...(status?.closedTrades || []), ...(status?.openTrades || [])].slice(0, 80);

  return (
    <div className="history-page">
      <section className="page-hero">
        <div>
          <p className="eyebrow">History</p>
          <h1>Operazioni, setup e risultato per ogni trade.</h1>
        </div>
      </section>

      <section className="panel history-panel">
        <div className="history-head">
          <span>Ora / Coppia</span>
          <span>Tipo</span>
          <span>Setup</span>
          <span>Entrata - Uscita</span>
          <span>P&L</span>
        </div>

        <div className="history-list">
          {trades.length > 0 ? trades.map((trade: any) => (
            <article key={trade.id} className="history-item">
              <div>
                <strong>{trade.symbol}</strong>
                <span>{trade.openedAt ? new Date(trade.openedAt).toLocaleDateString() : '-'}</span>
                <span>{trade.openedAt ? new Date(trade.openedAt).toLocaleTimeString() : '-'}</span>
              </div>
              <div>
                <strong className={trade.side === 'BUY' ? 'win' : 'loss'}>{trade.side}</strong>
                <span>0.01 lot</span>
              </div>
              <div>
                <strong>{trade.setupType || 'EMA_STACK'}</strong>
                <span>{trade.closeReason || trade.status}</span>
              </div>
              <div>
                <strong>{price(trade.entryPrice)}</strong>
                <span>to {price(trade.currentPrice || trade.exitPrice)}</span>
              </div>
              <div className="history-result">
                <strong className={(trade.pnl || 0) >= 0 ? 'win' : 'loss'}>{money(trade.pnl || 0)}</strong>
                <span>{(trade.pnlPips || trade.pnl || 0).toFixed(1)} pip</span>
              </div>
              <div className="history-detail">
                <div>
                  <span>Ragionamento</span>
                  <p>{trade.reasoning || 'EMA, RSI, momentum e filtri rischio allineati.'}</p>
                </div>
                <div className="detail-grid">
                  <div><span>Entrata</span><strong>{price(trade.entryPrice)}</strong></div>
                  <div><span>Uscita</span><strong>{price(trade.currentPrice || trade.exitPrice)}</strong></div>
                  <div><span>Stop loss</span><strong className="loss">{price(trade.stopLoss)}</strong></div>
                  <div><span>Take profit</span><strong className="win">{price(trade.takeProfit)}</strong></div>
                  <div><span>Confidence</span><strong>{trade.confidence || status?.currentConfidence || 72}%</strong></div>
                  <div><span>Durata</span><strong>{duration(trade.openedAt, trade.closedAt)}</strong></div>
                </div>
              </div>
            </article>
          )) : <div className="empty-state">Nessuno storico disponibile. Premi START e lascia lavorare il paper trading.</div>}
        </div>
      </section>
    </div>
  );
}
