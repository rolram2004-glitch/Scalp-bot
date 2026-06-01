const express = require("express");

const app = express();
app.use(express.json());

app.get("/", (req, res) => {
  res.json({
    status: "ONLINE",
    oandaAccount: process.env.OANDA_ACCOUNT_ID ? "OK" : "MANCANTE",
    oandaApi: process.env.OANDA_API_KEY ? "OK" : "MANCANTE"
  });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log("SCALP BOT ONLINE");
  console.log("OANDA_ACCOUNT_ID:", process.env.OANDA_ACCOUNT_ID ? "OK" : "NO");
  console.log("OANDA_API_KEY:", process.env.OANDA_API_KEY ? "OK" : "NO");
});
