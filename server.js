const express = require("express");
require("dotenv").config();

const { startAutonomousBot } = require("./src/autonomous-bot");

const app = express();

app.use(express.json());

app.get("/", (req, res) => {
  res.json({
    name: "Scalp Bot",
    status: "running",
    version: "2.0"
  });
});

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("================================");
  console.log("SCALP BOT STARTED");
  console.log("PORT:", PORT);
  console.log("================================");

  startAutonomousBot();
});
