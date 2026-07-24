# GEMMO REMONDATA BOT

Cockpit di analisi e trading OANDA Practice con due corsie esclusive, MAIN e INVERSE. La dashboard distingue account, feed, analisi, shadow trading ed esecuzione verificata: un prezzo OANDA non viene mai presentato come un ordine OANDA.

## Run locally

1. Install dependencies:
   - `npm install`
   - `cd frontend && npm install`
2. Build the frontend:
   - `npm run build`
3. Start the server:
   - `npm start`
4. Open `http://localhost:3000/`

## Always-on execution with PM2

PM2 keeps the bot running and restarts it automatically if it crashes.

- `npm run pm2:start`
- `npm run pm2:stop`
- `npm run pm2:restart`

## Docker deployment

1. Build the image:
   - `docker build -t scalp-bot .`
2. Run the container:
   - `docker run -d -p 3000:3000 --name scalp-bot scalp-bot`

Il processo resta online e viene riavviato automaticamente. Lo stato `RUNNING` indica soltanto che il processo di scansione e attivo: la disponibilita di account, prezzi ed esecuzione e mostrata separatamente.

## Execution modes

- `TRADING_MODE=PAPER`: real OANDA market data, no OANDA orders.
- `TRADING_MODE=OANDA_DEMO`, `OANDA_ENVIRONMENT=PRACTICE` and both execution enable gates: verified orders on OANDA Practice only.
- `TRADING_MODE=OANDA_LIVE`: real-money mode; blocked unless endpoint, enable flags and explicit real-money confirmation all match. Never enable it during development or automatic tests.
- `LIVE_EXECUTION_VARIANT=MAIN|INVERSE`: selects exactly one real execution lane. The other lane is an explicit paper shadow and never calls OANDA.

XAUUSD usa analisi strutturale dedicata ed e `ANALYSIS ONLY` finche size, conversione conto, protezioni e gestione delle uscite non sono verificate integralmente.

There is no synthetic market-data fallback. If OANDA data is unavailable, the scanner reports it and does not invent prices or trades. See `RAILWAY_DEPLOYMENT.md` before enabling OANDA Practice execution.
