import { StatusSnapshot } from '../types';

export function SetupPage({ status, news = [], oandaStatus }: { status: StatusSnapshot | null; news?: any[]; oandaStatus?: any }) {
  const hasLiveData = Boolean(oandaStatus?.connected);
  const running = Boolean(status?.isRunning);

  return (
    <div className="setup-page">
      <section className="page-hero">
        <div>
          <p className="eyebrow">Setup</p>
          <h1>Controllo operativo, dati OANDA e sicurezza del bot.</h1>
        </div>
        <div className={hasLiveData ? 'system-active' : 'system-warning'}>
          {hasLiveData ? 'OANDA CONNECTED' : 'OANDA NON CONNESSO'}
        </div>
      </section>

      <section className="setup-grid">
        <div className="setup-card featured">
          <span>Stato bot</span>
          <strong>{running ? 'RUNNING' : 'STOPPED'}</strong>
          <p>{running ? 'Il motore sta scansionando coppie e gestendo trade paper.' : 'Premi START per avviare scansione, feed e paper trading.'}</p>
        </div>
        <div className="setup-card">
          <span>Dati mercato</span>
          <strong>{status?.dataSource || 'UNKNOWN'}</strong>
          <p>{hasLiveData ? `OANDA collegato${oandaStatus?.currency ? `, account ${oandaStatus.currency}` : ''}.` : 'Credenziali non valide o feed non raggiungibile: nessun dato falso viene mostrato.'}</p>
        </div>
        <div className="setup-card">
          <span>Esecuzione</span>
          <strong>{status?.executionMode || 'PAPER TRADING'}</strong>
          <p>Resta in paper trading finche non confermiamo capitale, size, max loss e ambiente live.</p>
        </div>
        <div className="setup-card">
          <span>Risk guard</span>
          <strong>{status?.maxOpenPositions ?? 0} posizioni max</strong>
          <p>Trade oggi {status?.dailyTradeCount ?? 0}/{status?.maxDailyTrades ?? 0}. Lotto basso {status?.defaultLotSize ?? 0.01}. Max loss {status?.maxDailyLoss ?? 50}.</p>
        </div>
      </section>

      <section className="panel setup-panel">
        <div className="panel-title"><h2>Setup operativo</h2><span>{status?.session || 'SESSION'}</span></div>
        <div className="setup-checks">
          <div className={running ? 'check-row ok' : 'check-row warn'}><b />Motore autonomo {running ? 'attivo' : 'fermo'}</div>
          <div className={hasLiveData ? 'check-row ok' : 'check-row warn'}><b />OANDA {hasLiveData ? 'collegato' : 'non collegato in questa sessione'}</div>
          <div className="check-row ok"><b />Paper trading protetto</div>
          <div className="check-row ok"><b />SL/TP paper: normale 1.20/2.40, XAUUSD 7.5/15</div>
          <div className={hasLiveData ? 'check-row ok' : 'check-row warn'}><b />Grafico solo con candele OANDA reali</div>
        </div>
      </section>

      <section className="panel setup-panel">
        <div className="panel-title"><h2>Calendario news</h2><span>{news.length ? 'risk filter' : 'non configurato'}</span></div>
        <div className="news-list">
          {news.length > 0 ? news.map((item: any) => (
            <div key={item.id} className={`news-row ${String(item.impact).toLowerCase()}`}>
              <div><strong>{item.currency}</strong><span>{new Date(item.time).toLocaleTimeString()}</span></div>
              <div><strong>{item.title}</strong><span>{item.note}</span></div>
              <b>{item.impact}</b>
            </div>
          )) : <div className="empty-state">Calendario news reale non collegato. Il bot non inventa eventi.</div>}
        </div>
      </section>

      <section className="panel setup-panel">
        <div className="panel-title"><h2>Coppie monitorate</h2><span>{status?.symbols?.length || 0} symbols</span></div>
        <div className="symbol-cloud">
          {(status?.symbols || []).map((symbol) => <span key={symbol}>{symbol}</span>)}
        </div>
      </section>

      <section className="panel setup-panel">
        <div className="panel-title"><h2>Ultima decisione</h2><span>{status?.currentConfidence ?? 0}%</span></div>
        <div className="decision-box">
          <div><span>Symbol</span><strong>{status?.currentSymbol || '-'}</strong></div>
          <div><span>Action</span><strong className={status?.currentAction === 'BUY' ? 'win' : status?.currentAction === 'SELL' ? 'loss' : ''}>{status?.currentAction || '-'}</strong></div>
          <div><span>Entry</span><strong>{status?.entryPrice?.toFixed(5) || '-'}</strong></div>
          <div><span>SL</span><strong className="loss">{status?.stopLoss?.toFixed(5) || '-'}</strong></div>
          <div><span>TP</span><strong className="win">{status?.takeProfit?.toFixed(5) || '-'}</strong></div>
        </div>
        <p className="reasoning-text">{status?.currentReasoning || 'In attesa del prossimo scan.'}</p>
      </section>
    </div>
  );
}
