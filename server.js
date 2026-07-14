const path = require("path");
const fs = require("fs");
const express = require("express");
require("dotenv").config();
require("ts-node/register/transpile-only");

const {
  startAutonomousBot,
  stopAutonomousBot,
  getBotSnapshot,
  subscribeToBotUpdates,
  getAnalytics
} = require("./src/autonomous-bot");
const oanda = require("./src/oanda");
const config = require("./src/config");

function pipSizeForSymbol(symbol) {
  if (/XAU/i.test(String(symbol))) return 0.1;
  return /JPY$/i.test(String(symbol).replace(/[^A-Z]/gi, "")) ? 0.01 : 0.0001;
}

function createApp() {
  const app = express();
  const frontendDist = path.join(__dirname, "frontend", "dist");
  const hasFrontend = fs.existsSync(frontendDist);

  app.use(express.json());
  if (hasFrontend) {
    app.use(express.static(frontendDist));
  }
  app.use(express.static(path.join(__dirname, "public")));

  app.get("/", (req, res) => {
    if (hasFrontend) {
      return res.sendFile(path.join(frontendDist, "index.html"));
    }
    return res.sendFile(path.join(__dirname, "public", "dashboard.html"));
  });

  app.get("/health", (req, res) => {
    res.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      uptime: process.uptime()
    });
  });

  app.get("/api/status", (req, res) => {
    res.json(getBotSnapshot());
  });

  app.get("/api/oanda/status", async (req, res) => {
    try {
      res.json(await oanda.getConnectionStatus());
    } catch (err) {
      res.json({ connected: false, reason: "status_error", mode: "practice" });
    }
  });

  app.get("/api/news", (req, res) => {
    res.json({
      source: "not_configured",
      events: [],
      message: "Calendario news reale non configurato. Nessun evento viene inventato."
    });
  });

  app.post("/api/bot/start", (req, res) => {
    startAutonomousBot();
    res.json(getBotSnapshot());
  });

  app.post("/api/bot/stop", (req, res) => {
    stopAutonomousBot();
    res.json(getBotSnapshot());
  });

  app.get("/api/analytics", (req, res) => {
    try {
      res.json(getAnalytics());
    } catch (err) {
      res.status(500).json({ error: "analytics_error" });
    }
  });

  const normalizeOandaSymbol = (symbol) => {
    let normalized = String(symbol).toUpperCase().replace(/[^A-Z0-9]/g, "_").replace(/__+/g, "_").trim();
    if (!normalized.includes("_") && normalized.length === 6) {
      normalized = `${normalized.slice(0, 3)}_${normalized.slice(3)}`;
    }
    return normalized;
  };

  app.get("/api/candles", async (req, res) => {
    const symbol = req.query.symbol;
    const count = parseInt(req.query.count) || 200;
    const timeframe = String(req.query.timeframe || config.TIMEFRAME).toUpperCase();

    if (!symbol) return res.status(400).json({ error: "missing_symbol" });

    try {
      const normalized = normalizeOandaSymbol(symbol);
      const candles = await oanda.getCandles(normalized, count, timeframe);
      if (Array.isArray(candles) && candles.length > 0) {
        return res.json(candles);
      }
      return res.status(503).json({ error: "oanda_candles_unavailable", dataSource: "OANDA_UNAVAILABLE" });
    } catch (err) {
      return res.status(503).json({ error: "oanda_candles_unavailable", dataSource: "OANDA_UNAVAILABLE" });
    }
  });

  app.get("/api/marketdata", async (req, res) => {
    const symbol = req.query.symbol;
    const all = req.query.all === 'true' || req.query.all === '1';

    try {
      const snapshot = getBotSnapshot();

      if (all) {
        return res.json(snapshot.marketData || {});
      }

      if (!symbol) return res.status(400).json({ error: "missing_symbol" });

      const sym = String(symbol).toUpperCase();

      if (snapshot.marketData && snapshot.marketData[sym]) {
        return res.json(snapshot.marketData[sym]);
      }

      try {
        const { generateMarketData } = require("./src/market-engine");
        const md = await generateMarketData(sym);
        return res.json(md);
      } catch (err) {
        return res.status(503).json({ error: "oanda_marketdata_unavailable", dataSource: "OANDA_UNAVAILABLE" });
      }
    } catch (err) {
      return res.status(500).json({ error: "internal_error" });
    }
  });

  app.get("/events", (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    const sendSnapshot = (snapshot) => {
      res.write(`data: ${JSON.stringify(snapshot)}\n\n`);
    };

    sendSnapshot(getBotSnapshot());

    const unsubscribe = subscribeToBotUpdates(sendSnapshot);
    req.on("close", () => {
      unsubscribe();
    });
  });

  app.get('*', (req, res) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/events')) {
      return res.status(404).json({ error: 'not_found' });
    }
    if (hasFrontend) {
      return res.sendFile(path.join(frontendDist, 'index.html'));
    }
    return res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
  });

  return app;
}

function startServer() {
  const app = createApp();
  const PORT = Number(process.env.PORT || 3000);
  const HOST = process.env.HOST || "0.0.0.0";

  const server = app.listen(PORT, HOST, () => {
    console.log("================================");
    console.log("SCALP BOT STARTED");
    console.log("HOST:", HOST);
    console.log("PORT:", PORT);
    console.log("DASHBOARD: http://localhost:" + PORT + "/");
    console.log("================================");

    startAutonomousBot();
  });

  return server;
}

if (require.main === module) {
  startServer();
}

module.exports = {
  createApp,
  startServer
};
