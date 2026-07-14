# Railway — deploy sicuro di SCALP BOT

## Collegamento rapido

1. Aprire https://railway.com/new.
2. Scegliere **Deploy from GitHub repo** e autorizzare GitHub se richiesto.
3. Selezionare il repository `Scalp-bot` e il branch `main`.
4. Railway rileva `package.json`; il comando di avvio è `npm start` (`node server.js`).
5. In **Variables** aggiungere manualmente:
   - `OANDA_API_KEY` — usare un token nuovo, mai quello esposto in chat.
   - `OANDA_ACCOUNT_ID`
   - `TRADING_MODE=PAPER`
   - `LIVE_TRADING_ENABLED=false`
   - le altre variabili documentate in `.env.example`, solo se necessarie.
6. Non impostare `PORT`: Railway la fornisce automaticamente e il server usa `process.env.PORT`.
7. Impostare l'health check su `/health`.
8. Fare il primo deploy e verificare `/health`, `/api/oanda/status` e `/api/candles?symbol=XAUUSD&timeframe=M1&count=2`.

## Regole di sicurezza

- Primo deploy sempre PAPER.
- Non copiare `.env` nel repository e non caricarlo su Railway come file.
- Prima del deploy revocare il token scritto in chat e generarne uno nuovo.
- Non impostare LIVE finché sincronizzazione, persistenza, riconciliazione OANDA e checklist LIVE non sono complete.
- `LIVE_TRADING_ENABLED=true` non deve essere usato sul primo deploy.

## Persistenza

Lo stato paper attuale vive in memoria e si azzera al riavvio. Prima di usare storico persistente occorre aggiungere un Railway Volume o un database e mantenere separati PAPER e LIVE OANDA.
