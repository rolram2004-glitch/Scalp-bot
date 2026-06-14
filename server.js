const express = require("express");
require("dotenv").config();

const ScalpingBot = require("./src/bot");

const app = express();

app.use(express.json());

const bot = new ScalpingBot();

app.get("/", (req, res) => {
  res.json({
    bot: "Scalp Bot",
    status: "online"
  });
});

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    time: new Date().toISOString()
  });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server avviato sulla porta ${PORT}`);
  bot.start();
});
