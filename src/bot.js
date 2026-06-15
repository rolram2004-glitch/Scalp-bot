const config = require(”./config”);
const oanda = require(”./oanda”);
const { analyzeMarket } = require(”./strategy”);

class ScalpingBot {
constructor() {
this.running = false;
}

async scanSymbol(symbol) {
try {
console.log(📊 Analisi ${symbol});

  const candles = await oanda.getCandles(symbol, 250);
  if (!candles || candles.length < 200) {
    return;
  }
  const priceData = await oanda.getPrice(symbol);
  if (!priceData) {
    return;
  }
  const spread =
    Math.abs(
      parseFloat(priceData.closeoutAsk) -
      parseFloat(priceData.closeoutBid)
    ) * 10000;
  const signal = analyzeMarket(
    candles,
    spread
  );
  console.log(`

═══════════════════════════════
📊 ${symbol}

🎯 ACTION: ${signal.action}
📌 SETUP: ${signal.setup}

📈 TREND: ${signal.trend}
📊 RSI: ${signal.rsi.toFixed(2)}

🔥 CONFIDENCE: ${signal.confidence}%

🛑 SL: ${signal.stopLoss.toFixed(5)}
🎯 TP: ${signal.takeProfit.toFixed(5)}

📝 REASON:
${signal.reason}

═══════════════════════════════
`);

  if (
    signal.action !== "HOLD" &&
    signal.confidence >= 65
  ) {
    console.log(`

🚀 NUOVO SEGNALE

PAIR: ${symbol}
SETUP: ${signal.setup}
ACTION: ${signal.action}

ENTRY: ${candles[candles.length - 1].mid.c}
SL: ${signal.stopLoss.toFixed(5)}
TP: ${signal.takeProfit.toFixed(5)}

CONFIDENCE: ${signal.confidence}%

REASON:
${signal.reason}
`);
}

} catch (err) {
  console.error(
    `${symbol} Error:`,
    err.message
  );
}

}

async scanAll() {
for (const symbol of config.SYMBOLS) {
await this.scanSymbol(symbol);
}
}

start() {
if (this.running) return;

this.running = true;
console.log(`

╔════════════════════════════╗
║      SCALP BOT LIVE        ║
╚════════════════════════════╝
`);

this.scanAll();
setInterval(() => {
  this.scanAll();
}, config.SCAN_INTERVAL);

}
}

module.exports = ScalpingBot;
