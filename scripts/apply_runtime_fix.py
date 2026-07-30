from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def write(path: str, content: str) -> None:
    (ROOT / path).write_text(content, encoding="utf-8")


def replace_once(content: str, old: str, new: str, label: str) -> str:
    if old not in content:
        raise RuntimeError(f"Missing expected block: {label}")
    return content.replace(old, new, 1)


# 1) Practice credentials automatically select OANDA_DEMO. Real-money LIVE still
# requires the explicit live environment and confirmation phrase.
path = "src/config.js"
text = read(path)
old = '''const requestedTradingMode = String(process.env.TRADING_MODE || "PAPER").trim().toUpperCase();
const tradingMode = ["PAPER", "OANDA_DEMO", "OANDA_LIVE"].includes(requestedTradingMode)
  ? requestedTradingMode
  : "PAPER";
const requestedOandaEnvironment = String(process.env.OANDA_ENVIRONMENT || "PRACTICE").trim().toUpperCase();
const oandaEnvironment = requestedOandaEnvironment === "LIVE" ? "LIVE" : "PRACTICE";
const oandaEnvironmentValid = tradingMode === "OANDA_LIVE"
  ? oandaEnvironment === "LIVE"
  : oandaEnvironment === "PRACTICE";
const orderExecutionEnabled = process.env.OANDA_ORDER_EXECUTION_ENABLED === "true";
'''
new = '''const requestedOandaEnvironment = String(process.env.OANDA_ENVIRONMENT || "PRACTICE").trim().toUpperCase();
const oandaEnvironment = requestedOandaEnvironment === "LIVE" ? "LIVE" : "PRACTICE";
const configuredApiKey = String(process.env.OANDA_API_KEY || "").trim();
const configuredAccountId = String(process.env.OANDA_ACCOUNT_ID || "").trim();
const requestedTradingMode = String(process.env.TRADING_MODE || "PAPER").trim().toUpperCase();
const explicitTradingMode = ["PAPER", "OANDA_DEMO", "OANDA_LIVE"].includes(requestedTradingMode)
  ? requestedTradingMode
  : "PAPER";
const forcePaperMode = process.env.FORCE_PAPER_MODE === "true";
const autoOandaPractice = Boolean(
  process.env.AUTO_OANDA_PRACTICE !== "false" &&
  !forcePaperMode &&
  oandaEnvironment === "PRACTICE" &&
  configuredApiKey &&
  configuredAccountId &&
  explicitTradingMode !== "OANDA_LIVE"
);
const tradingMode = autoOandaPractice ? "OANDA_DEMO" : explicitTradingMode;
const oandaEnvironmentValid = tradingMode === "OANDA_LIVE"
  ? oandaEnvironment === "LIVE"
  : oandaEnvironment === "PRACTICE";
const orderExecutionEnabled = autoOandaPractice || process.env.OANDA_ORDER_EXECUTION_ENABLED === "true";
'''
text = replace_once(text, old, new, "config mode selection")
text = replace_once(
    text,
    '  OANDA_API_KEY: process.env.OANDA_API_KEY,\n  OANDA_ACCOUNT_ID: process.env.OANDA_ACCOUNT_ID,\n',
    '  OANDA_API_KEY: configuredApiKey,\n  OANDA_ACCOUNT_ID: configuredAccountId,\n  AUTO_OANDA_PRACTICE_ACTIVE: autoOandaPractice,\n  FORCE_PAPER_MODE: forcePaperMode,\n',
    "config credential exports"
)
write(path, text)

# 2) A single unavailable instrument must not disconnect every market. Bulk first,
# then recover each instrument individually.
path = "src/oanda.js"
text = read(path)
old = '''    } catch (error) {
      this.rememberError("prices", error);
      return [];
    }
  }

  async getPricingContext(symbol) {
'''
new = '''    } catch (error) {
      this.rememberError("prices", error);
      const recovered = await Promise.all(
        instruments.map(async (instrument) => {
          try {
            const response = await axios.get(
              `${this.baseURL}/accounts/${config.OANDA_ACCOUNT_ID}/pricing`,
              this.requestOptions({ params: { instruments: instrument } })
            );
            return response.data?.prices?.[0] || null;
          } catch (_individualError) {
            return null;
          }
        })
      );
      const validPrices = recovered.filter(Boolean);
      if (validPrices.length > 0) this.rememberSuccess();
      return validPrices;
    }
  }

  async getPricingContext(symbol) {
'''
text = replace_once(text, old, new, "OANDA price fallback")
write(path, text)

# 3) Live execution can operate with partial global coverage because the execution
# engine re-checks the selected instrument, tradeability and price freshness before
# submitting each order.
path = "src/autonomous-bot.ts"
text = read(path)
text = text.replace(
    '// Market data uses M5 candles; evaluate the latest real OANDA data every two minutes.',
    '// Market data uses M5 candles; evaluate the latest real OANDA data every configured scan interval.'
)
text = replace_once(
    text,
    '''    botState.priceFeedStatus === "CONNECTED" &&
    botState.priceCoverage === botState.priceExpected &&
''',
    '''    botState.priceFeedStatus !== "DISCONNECTED" &&
    botState.priceCoverage > 0 &&
''',
    "partial feed execution gate"
)
old_hold = '''      const sameSymbolIndex = botState.openTrades.findIndex((trade) => trade.symbol === symbol);
      if (sameSymbolIndex >= 0) {
        const lastTrade = botState.openTrades[sameSymbolIndex];
        if (liveExecutionActive() && lastTrade.source === "OANDA") {
          if (canAutoCloseOandaTrade(lastTrade, config.LIVE_EXECUTION_VARIANT)) {
            await closeVerifiedOandaTrade(lastTrade);
          } else {
            pushLog(`[${symbol}] SIGNAL EXIT ignored: OANDA trade is external or belongs to another GEMMO lane`);
          }
        } else if (!liveExecutionActive() && lastTrade.source === "PAPER") {
          const multiplier = pipMultiplier(lastTrade.symbol);
          const exitPrice = paperExitPrice(lastTrade.side, enrichedMarketData);
          lastTrade.status = "CLOSED";
          lastTrade.currentPrice = exitPrice;
          lastTrade.pnl = calculatePaperPnl(lastTrade.symbol, lastTrade.side, lastTrade.entryPrice, exitPrice);
          lastTrade.pnlPips = lastTrade.side === "BUY"
            ? (exitPrice - lastTrade.entryPrice) * multiplier
            : (lastTrade.entryPrice - exitPrice) * multiplier;
          lastTrade.closedAt = new Date().toISOString();
          lastTrade.closeReason = "SIGNAL EXIT";

          botState.closedTrades = [lastTrade, ...botState.closedTrades].slice(0, 80);
          botState.openTrades = botState.openTrades.filter((_, index) => index !== sameSymbolIndex);
        }
      }

'''
new_hold = '''      // HOLD is not an exit instruction. Existing positions remain managed by
      // OANDA SL/TP, manual close or an explicit structural invalidation routine.

'''
text = replace_once(text, old_hold, new_hold, "do not close on HOLD")
write(path, text)

# 4) Frontend treats any fresh, non-zero OANDA coverage as usable. It still shows
# PARTIAL rather than pretending all instruments are available.
path = "frontend/src/trading-state.ts"
text = read(path)
old = '''export function hasFullFreshCoverage(status: StatusSnapshot | null | undefined) {
  const coverage = status?.priceCoverage;
  const expected = status?.priceExpected;
  return status?.priceFeedStatus === 'CONNECTED' &&
    typeof coverage === 'number' &&
    Number.isFinite(coverage) &&
    typeof expected === 'number' &&
    Number.isFinite(expected) &&
    expected > 0 &&
    coverage >= expected;
}
'''
new = '''export function hasFullFreshCoverage(status: StatusSnapshot | null | undefined) {
  const coverage = status?.priceCoverage;
  return status?.priceFeedStatus !== 'DISCONNECTED' &&
    typeof coverage === 'number' &&
    Number.isFinite(coverage) &&
    coverage > 0;
}
'''
text = replace_once(text, old, new, "frontend usable coverage")
write(path, text)

# 5) MAIN and INVERSE cards expose the actual plan, not just a score.
path = "frontend/src/pages/Terminal.tsx"
text = read(path)
old = '''function SignalLaneCard({ lane, title }: { lane: any; title: string }) {
  if (!lane) return <div className="signal-duel-card unavailable"><span>{title}</span><strong>N/A</strong><small>NESSUN SNAPSHOT REALE</small></div>;
  const directionClass = lane.action === 'BUY' ? 'positive' : lane.action === 'SELL' ? 'negative' : 'neutral';
  return (
    <article className={`signal-duel-card ${lane.action === 'BUY' ? 'buy' : lane.action === 'SELL' ? 'sell' : 'hold'}`}>
      <header><span>{title}</span><strong className={directionClass}>{lane.action || 'N/A'}</strong></header>
      <div className="signal-duel-card__confidence">
        <b>{setupScoreText(lane)}</b>
        <span>SETUP SCORE</span>
      </div>
      <dl>
        <div><dt>Setup</dt><dd>{lane.setupType || 'N/A'}</dd></div>
        <div><dt>State</dt><dd>{lane.executionState || 'N/A'}</dd></div>
      </dl>
      <p>{lane.reasoning || 'DATI NON DISPONIBILI'}</p>
    </article>
  );
}
'''
new = '''function SignalLaneCard({ lane, title }: { lane: any; title: string }) {
  if (!lane) return <div className="signal-duel-card unavailable"><span>{title}</span><strong>N/A</strong><small>NESSUN SNAPSHOT REALE</small></div>;
  const directionClass = lane.action === 'BUY' ? 'positive' : lane.action === 'SELL' ? 'negative' : 'neutral';
  const targets = Array.isArray(lane.structuralTargets) ? lane.structuralTargets : [];
  return (
    <article className={`signal-duel-card ${lane.action === 'BUY' ? 'buy' : lane.action === 'SELL' ? 'sell' : 'hold'}`}>
      <header><span>{title}</span><strong className={directionClass}>{lane.action || 'N/A'}</strong></header>
      <div className="signal-duel-card__confidence">
        <b>{setupScoreText(lane)}</b>
        <span>SETUP SCORE</span>
      </div>
      <div className="signal-lane-levels">
        <div><span>ENTRY</span><strong>{price(lane.entryPrice)}</strong></div>
        <div><span>STOP LOSS</span><strong className="negative">{price(lane.stopLossPrice)}</strong></div>
        <div><span>TP1</span><strong className="positive">{price(targets[0] ?? lane.takeProfitPrice)}</strong></div>
        <div><span>TP2</span><strong className="positive">{price(targets[1])}</strong></div>
        <div><span>TP3</span><strong className="positive">{price(targets[2])}</strong></div>
        <div><span>R:R</span><strong>{Number.isFinite(Number(lane.riskRewardRatio)) ? `1:${Number(lane.riskRewardRatio).toFixed(2)}` : 'N/A'}</strong></div>
      </div>
      <dl>
        <div><dt>Setup</dt><dd>{lane.setupType || 'N/A'}</dd></div>
        <div><dt>State</dt><dd>{lane.executionState || 'N/A'}</dd></div>
      </dl>
      <p>{lane.reasoning || 'DATI NON DISPONIBILI'}</p>
    </article>
  );
}
'''
text = replace_once(text, old, new, "dashboard lane levels")
text = text.replace('if (hasFullFreshCoverage(status) && fresh(status.lastPriceAt)) return \'OANDA 1S FULL COVERAGE\';', "if (hasFullFreshCoverage(status) && fresh(status.lastPriceAt)) return status?.priceFeedStatus === 'CONNECTED' ? 'OANDA FRESH FULL COVERAGE' : 'OANDA FRESH PARTIAL COVERAGE';")
write(path, text)

# 6) Setup command-center lane cards also show the complete trade plan.
path = "frontend/src/pages/Setup.tsx"
text = read(path)
old = '''function Lane({ lane, executionReady }: { lane?: SignalLaneSnapshot; executionReady: boolean }) {
  if (!lane) return <div className="lane-command empty-state">DATI NON DISPONIBILI</div>;
  const selectedButBlocked = lane.selectedForExecution && !executionReady;
  const executionState = selectedButBlocked ? 'BLOCKED' : lane.executionState;
  const laneMode = selectedButBlocked ? 'OANDA EXECUTION BLOCKED' : lane.mode;
  const liveReceipt = executionReady && lane.selectedForExecution && lane.executionState === 'OPEN_VERIFIED';
  return (
    <article className={`lane-command ${lane.variant.toLowerCase()} ${lane.selectedForExecution ? 'selected' : ''}`}>
      <header><div><span>{lane.variant} LANE</span><strong className={variantClass(lane.action)}>{lane.action}</strong></div><b>{laneMode}</b></header>
      <div className="lane-kpis"><div><span>Setup score</span><strong>{setupScoreText(lane)}</strong></div><div><span>Execution</span><strong>{executionState}</strong></div></div>
      <dl>
        <dt>Setup</dt><dd>{lane.setupType || 'N/A'}</dd>
        <dt>Reason</dt><dd>{lane.executionReason || (liveReceipt ? 'VERIFIED BY OANDA' : 'N/A')}</dd>
        <dt>Order ID</dt><dd>{lane.oandaOrderId || 'N/A'}</dd>
        <dt>Trade ID</dt><dd>{lane.oandaTradeId || 'N/A'}</dd>
      </dl>
      <p>{lane.reasoning || 'N/A'}</p>
    </article>
  );
}
'''
new = '''function Lane({ lane, executionReady }: { lane?: SignalLaneSnapshot; executionReady: boolean }) {
  if (!lane) return <div className="lane-command empty-state">DATI NON DISPONIBILI</div>;
  const selectedButBlocked = lane.selectedForExecution && !executionReady;
  const executionState = selectedButBlocked ? 'BLOCKED' : lane.executionState;
  const laneMode = selectedButBlocked ? 'OANDA EXECUTION BLOCKED' : lane.mode;
  const liveReceipt = executionReady && lane.selectedForExecution && lane.executionState === 'OPEN_VERIFIED';
  const targets = Array.isArray(lane.structuralTargets) ? lane.structuralTargets : [];
  return (
    <article className={`lane-command ${lane.variant.toLowerCase()} ${lane.selectedForExecution ? 'selected' : ''}`}>
      <header><div><span>{lane.variant} LANE</span><strong className={variantClass(lane.action)}>{lane.action}</strong></div><b>{laneMode}</b></header>
      <div className="lane-kpis"><div><span>Setup score</span><strong>{setupScoreText(lane)}</strong></div><div><span>Execution</span><strong>{executionState}</strong></div></div>
      <div className="lane-level-grid">
        <div><span>ENTRY</span><strong>{price(lane.entryPrice)}</strong></div>
        <div><span>STOP LOSS</span><strong className="negative">{price(lane.stopLossPrice)}</strong></div>
        <div><span>TP1</span><strong className="positive">{price(targets[0] ?? lane.takeProfitPrice)}</strong></div>
        <div><span>TP2</span><strong className="positive">{price(targets[1])}</strong></div>
        <div><span>TP3</span><strong className="positive">{price(targets[2])}</strong></div>
        <div><span>R:R</span><strong>{Number.isFinite(Number(lane.riskRewardRatio)) ? `1:${Number(lane.riskRewardRatio).toFixed(2)}` : 'N/A'}</strong></div>
      </div>
      <dl>
        <dt>Setup</dt><dd>{lane.setupType || 'N/A'}</dd>
        <dt>Reason</dt><dd>{lane.executionReason || (liveReceipt ? 'VERIFIED BY OANDA' : 'N/A')}</dd>
        <dt>Order ID</dt><dd>{lane.oandaOrderId || 'N/A'}</dd>
        <dt>Trade ID</dt><dd>{lane.oandaTradeId || 'N/A'}</dd>
      </dl>
      <p>{lane.reasoning || 'N/A'}</p>
    </article>
  );
}
'''
text = replace_once(text, old, new, "setup lane levels")
write(path, text)

# 7) Styling: dense professional dashboard matching the chosen command-center image.
path = "frontend/src/setup-v2.css"
text = read(path)
append = '''

/* Final command-center refinement */
.signal-lane-levels,
.lane-level-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  margin: 12px 0;
}
.signal-lane-levels > div,
.lane-level-grid > div {
  min-width: 0;
  padding: 10px;
  border: 1px solid rgba(116, 143, 184, .2);
  border-radius: 8px;
  background: rgba(6, 15, 30, .72);
}
.signal-lane-levels span,
.lane-level-grid span {
  display: block;
  margin-bottom: 5px;
  color: #77859d;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: .1em;
}
.signal-lane-levels strong,
.lane-level-grid strong {
  display: block;
  overflow: hidden;
  color: #e8eef9;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 13px;
  text-overflow: ellipsis;
}
.dashboard-primary-grid {
  grid-template-columns: minmax(0, 1.45fr) minmax(300px, .8fr) minmax(280px, .72fr);
}
.dashboard-secondary-grid {
  grid-template-columns: minmax(0, 1.35fr) minmax(300px, .75fr) minmax(280px, .72fr);
}
@media (max-width: 1100px) {
  .dashboard-primary-grid,
  .dashboard-secondary-grid { grid-template-columns: 1fr 1fr; }
  .dashboard-market-card,
  .dashboard-history-card { grid-column: 1 / -1; }
}
@media (max-width: 700px) {
  .signal-lane-levels,
  .lane-level-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .dashboard-primary-grid,
  .dashboard-secondary-grid { grid-template-columns: 1fr; }
  .dashboard-market-card,
  .dashboard-history-card { grid-column: auto; }
  .signal-duel__body { gap: 10px; }
  .signal-versus { width: 34px; height: 34px; font-size: 10px; }
}
'''
if '/* Final command-center refinement */' not in text:
    text += append
write(path, text)

print("Runtime and command-center fixes applied successfully")
