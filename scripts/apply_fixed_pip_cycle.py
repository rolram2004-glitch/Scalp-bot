from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(path: Path, old: str, new: str) -> None:
    text = path.read_text(encoding="utf-8")
    if old not in text:
        raise RuntimeError(f"Expected block not found in {path}: {old[:120]!r}")
    path.write_text(text.replace(old, new, 1), encoding="utf-8")


# 1) Exact requested market universe: 15 forex pairs plus XAUUSD analysis.
config = ROOT / "src" / "config.js"
replace_once(config, '    "NZD_JPY",\n', '    "GBP_CAD",\n')
replace_once(
    config,
    '  MAX_NEW_TRADES_PER_CYCLE: boundedNumber(process.env.MAX_NEW_TRADES_PER_CYCLE, 6, 1, 16, true),',
    '  MAX_NEW_TRADES_PER_CYCLE: boundedNumber(process.env.MAX_NEW_TRADES_PER_CYCLE, 7, 1, 15, true),'
)
replace_once(
    config,
    '  MAX_DAILY_TRADES: boundedNumber(process.env.MAX_DAILY_TRADES, 1000, 1, 1000, true),\n\n  MIN_CONFIDENCE:',
    '  MAX_DAILY_TRADES: boundedNumber(process.env.MAX_DAILY_TRADES, 1000, 1, 1000, true),\n'
    '  NORMAL_STOP_LOSS_PIPS: boundedNumber(process.env.NORMAL_STOP_LOSS_PIPS, 10, 1, 100),\n'
    '  NORMAL_TAKE_PROFIT_PIPS: boundedNumber(process.env.NORMAL_TAKE_PROFIT_PIPS, 20, 1, 200),\n\n'
    '  MIN_CONFIDENCE:'
)

# 2) Railway cannot silently override the requested cadence/caps.
bootstrap = ROOT / "src" / "runtime-bootstrap.js"
replace_once(
    bootstrap,
    'process.env.MAX_DAILY_TRADES = "1000";\n',
    'process.env.MAX_DAILY_TRADES = "1000";\n'
    'process.env.MAX_NEW_TRADES_PER_CYCLE = "7";\n'
    'process.env.MAX_OPEN_POSITIONS = "15";\n'
    'process.env.SCAN_INTERVAL_MS = "60000";\n'
    'process.env.NORMAL_STOP_LOSS_PIPS = "10";\n'
    'process.env.NORMAL_TAKE_PROFIT_PIPS = "20";\n'
)
replace_once(
    bootstrap,
    '`orders=${process.env.OANDA_ORDER_EXECUTION_ENABLED === "true" ? "enabled" : "disabled"} maxDaily=1000`',
    '`orders=${process.env.OANDA_ORDER_EXECUTION_ENABLED === "true" ? "enabled" : "disabled"} ` +\n'
    '  `scan=60s maxNew=7 maxOpen=15 sl=10p tp=20p maxDaily=1000`'
)

# 3) Protective prices are defined by pips, not by a CHF cash target.
engine = ROOT / "src" / "execution-engine.ts"
engine_text = engine.read_text(encoding="utf-8")
if not engine_text.startswith('const config = require("./config");'):
    engine_text = 'const config = require("./config");\n\n' + engine_text
engine_text = engine_text.replace(
    '  const { oanda, symbol, side, riskAmount, rewardAmount } = request;',
    '  const { oanda, symbol, side } = request;',
    1
)
old_cash = '''    const risk = finitePositive(riskAmount);
    const reward = finitePositive(rewardAmount);
    if (!risk || !reward) {
      return { status: "REJECTED", reason: "INVALID_CASH_RISK_CONFIGURATION" };
    }

    const riskDistance = risk / (units * factors.loss);
    const rewardDistance = reward / (units * factors.gain);
    const direction = side === "BUY" ? 1 : -1;
    const stopLossNumber = entry - direction * riskDistance;
    const takeProfitNumber = entry + direction * rewardDistance;
    if (stopLossNumber <= 0 || takeProfitNumber <= 0) {
      return { status: "REJECTED", reason: "INVALID_PROTECTIVE_PRICE" };
    }
    const stopLoss = stopLossNumber.toFixed(displayPrecision);
    const takeProfit = takeProfitNumber.toFixed(displayPrecision);
'''
new_pips = '''    const pipLocation = Number(instrumentInfo.pipLocation);
    const pipSize = Number.isInteger(pipLocation) && pipLocation >= -12 && pipLocation <= 0
      ? 10 ** pipLocation
      : instrument.endsWith("_JPY") ? 0.01 : 0.0001;
    const stopLossPips = finitePositive(config.NORMAL_STOP_LOSS_PIPS) || 10;
    const takeProfitPips = finitePositive(config.NORMAL_TAKE_PROFIT_PIPS) || 20;
    const riskDistance = stopLossPips * pipSize;
    const rewardDistance = takeProfitPips * pipSize;
    const direction = side === "BUY" ? 1 : -1;
    const stopLossNumber = entry - direction * riskDistance;
    const takeProfitNumber = entry + direction * rewardDistance;
    if (stopLossNumber <= 0 || takeProfitNumber <= 0) {
      return { status: "REJECTED", reason: "INVALID_PROTECTIVE_PRICE" };
    }
    const stopLoss = stopLossNumber.toFixed(displayPrecision);
    const takeProfit = takeProfitNumber.toFixed(displayPrecision);
    // P&L is reported in the OANDA account currency, while the protective
    // distances remain exactly 10/20 pips for every forex instrument.
    const risk = units * riskDistance * factors.loss;
    const reward = units * rewardDistance * factors.gain;
'''
if old_cash not in engine_text:
    raise RuntimeError("Cash-based protective price block not found")
engine.write_text(engine_text.replace(old_cash, new_pips, 1), encoding="utf-8")

# 4) A later HOLD signal must not close a protected OANDA position early.
bot = ROOT / "src" / "autonomous-bot.ts"
bot_text = bot.read_text(encoding="utf-8")
old_exit = '''      const sameSymbolIndex = botState.openTrades.findIndex((trade) => trade.symbol === symbol);
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
new_exit = '''      // HOLD or a weaker later scan does not close an existing position.
      // OANDA remains authoritative and the verified SL/TP manage the exit.

'''
if old_exit not in bot_text:
    raise RuntimeError("Signal-exit block not found")
bot.write_text(bot_text.replace(old_exit, new_exit, 1), encoding="utf-8")

print("Applied: 15 forex pairs, 60s scan, up to 7 entries, exact 10/20-pip protection, no HOLD auto-close")
