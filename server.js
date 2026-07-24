const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
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
const { loadMultiTimeframeIntelligence } = require("./src/multi-timeframe");
const { executeVerifiedMarketOrder } = require("./src/execution-engine");

const intelligenceCache = new Map();

function maskedAccountId(value) {
  const accountId = String(value || "");
  return accountId ? `***${accountId.slice(-4)}` : undefined;
}

function safeTokenMatch(actual, expected) {
  const actualBuffer = Buffer.from(String(actual || ""));
  const expectedBuffer = Buffer.from(String(expected || ""));
  return actualBuffer.length === expectedBuffer.length &&
    actualBuffer.length > 0 &&
    crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

function requireControlAccess(req, res, next) {
  const expected = String(process.env.CONTROL_PANEL_TOKEN || "");
  if (!expected) {
    if (config.TRADING_MODE === "PAPER") return next();
    return res.status(503).json({
      error: "control_panel_token_not_configured",
      message: "Mutating OANDA controls are disabled until CONTROL_PANEL_TOKEN is configured."
    });
  }
  const bearer = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const provided = req.headers["x-control-token"] || bearer;
  if (!safeTokenMatch(provided, expected)) {
    return res.status(401).json({ error: "control_panel_authorization_required" });
  }
  next();
}

function createApp() {
  const app = express();
  const frontendDist = path.join(__dirname, "frontend", "dist");
  const hasFrontend = fs.existsSync(frontendDist);

  app.use(express.json());
  app.use("/api", (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  if (hasFrontend) {
    app.use(express.static(frontendDist));
  }

  app.get("/", (req, res) => {
    if (hasFrontend) {
      return res.sendFile(path.join(frontendDist, "index.html"));
    }
    return res.status(503).type("text/plain").send("Dashboard non disponibile: eseguire la build del frontend.");
  });

  app.get("/health", (req, res) => {
    res.json({
      status: "ok",
      service: "gemmo-remondata-bot",
      tradingMode: config.TRADING_MODE,
      oandaEnvironment: config.OANDA_ENVIRONMENT,
      timestamp: new Date().toISOString(),
      uptime: process.uptime()
    });
  });

  app.get("/api/status", (req, res) => {
    res.json(getBotSnapshot());
  });

  app.get("/api/oanda/status", async (req, res) => {
    try {
      const status = await oanda.getConnectionStatus();
      res.json({
        ...status,
        accountId: maskedAccountId(status?.accountId),
        checkedAt: new Date().toISOString()
      });
    } catch (err) {
      res.json({
        connected: false,
        reason: "status_error",
        mode: config.OANDA_ENVIRONMENT === "LIVE" ? "live" : "practice",
        tradingMode: config.TRADING_MODE,
        checkedAt: new Date().toISOString()
      });
    }
  });

  app.get("/api/news", (req, res) => {
    res.json({
      source: "not_configured",
      events: [],
      message: "Calendario news reale non configurato. Nessun evento viene inventato."
    });
  });

  app.post("/api/bot/start", requireControlAccess, (req, res) => {
    startAutonomousBot();
    res.json(getBotSnapshot());
  });

  app.post("/api/bot/stop", requireControlAccess, (req, res) => {
    stopAutonomousBot();
    res.json(getBotSnapshot());
  });

  app.post("/api/admin/test-oanda-demo", requireControlAccess, async (req, res) => {
    if (process.env.ENABLE_OANDA_DEMO_TEST !== "true") {
      return res.status(403).json({ error: "oanda_demo_test_disabled" });
    }
    if (config.TRADING_MODE !== "OANDA_DEMO" || config.OANDA_ENVIRONMENT !== "PRACTICE") {
      return res.status(409).json({ error: "oanda_demo_mode_required" });
    }
    if (req.body?.confirmation !== "CONFIRM OANDA DEMO TEST") {
      return res.status(400).json({ error: "manual_confirmation_required" });
    }
    const symbol = normalizeOandaSymbol(req.body?.symbol || "EUR_USD");
    const configured = new Set((config.SYMBOLS || []).map(normalizeOandaSymbol));
    const side = String(req.body?.side || "BUY").toUpperCase();
    const units = Number(req.body?.units || 1);
    if (!configured.has(symbol) || symbol === "XAU_USD" || !["BUY", "SELL"].includes(side) ||
        !Number.isFinite(units) || units <= 0 || units > Number(process.env.DEMO_TEST_MAX_UNITS || 1)) {
      return res.status(400).json({ error: "invalid_demo_test_order" });
    }
    const signalAt = new Date().toISOString();
    const result = await executeVerifiedMarketOrder({
      oanda,
      symbol,
      side,
      units,
      riskAmount: Number(config.NORMAL_STOP_LOSS_ACCOUNT),
      rewardAmount: Number(config.NORMAL_TAKE_PROFIT_ACCOUNT),
      strategyVariant: config.LIVE_EXECUTION_VARIANT,
      signalId: `SIG-DEMO-TEST-${signalAt.replace(/[^0-9]/g, "")}`,
      signalAt
    });
    return res.status(result.status === "OPENED" ? 201 : 409).json({
      environment: "PRACTICE",
      accountId: maskedAccountId(config.OANDA_ACCOUNT_ID),
      result
    });
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

  app.get("/api/intelligence", async (req, res) => {
    const symbol = normalizeOandaSymbol(req.query.symbol || "");
    const configured = new Set((config.SYMBOLS || []).map(normalizeOandaSymbol));
    if (!symbol || !configured.has(symbol)) {
      return res.status(400).json({ error: "unsupported_symbol" });
    }

    const cached = intelligenceCache.get(symbol);
    if (cached && Date.now() - cached.savedAt < 30000) {
      return res.json(cached.data);
    }

    try {
      const data = await loadMultiTimeframeIntelligence(oanda, symbol);
      intelligenceCache.set(symbol, { savedAt: Date.now(), data });
      return res.status(data.availableFrames > 0 ? 200 : 503).json(data);
    } catch (_error) {
      return res.status(503).json({
        symbol: symbol.replace("_", ""),
        source: "OANDA",
        availableFrames: 0,
        consensus: "HOLD",
        reasoning: "Dati multi-timeframe OANDA non disponibili.",
        frames: []
      });
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
    return res.status(503).type('text/plain').send('Dashboard non disponibile: eseguire la build del frontend.');
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
