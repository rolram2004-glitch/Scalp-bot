const config = require("./config");
const oanda = require("./oanda");
const { analyzeMarket } = require("./strategy");

class ScalpingBot {
  constructor() {
    this.running = false;
  }

  async scanSymbol(symbol) {
    try {
      console.log("Analisi " + symbol);

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

      const signal = analyzeMarket(candles, spread);

      console.log(
        symbol +
          " | " +
          signal.action +
          " | Setup: " +
          signal.setup +
          " | Confidence: " +
          signal.confidence +
          " | RSI: " +
          signal.rsi.toFixed(2)
      );

      if (
        signal.action !== "HOLD" &&
        signal.confidence >= 65
      ) {
        console.log("SIGNAL " + signal.action + " " + symbol);
        console.log("SETUP: " + signal.setup);
        console.log("REASON: " + signal.reason);
      }
    } catch (err) {
      console.error(symbol + " Error:", err.message);
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

    console.log("Scalping Bot Started");

    this.scanAll();

    setInterval(() => {
      this.scanAll();
    }, config.SCAN_INTERVAL);
  }
}

module.exports = ScalpingBot;
