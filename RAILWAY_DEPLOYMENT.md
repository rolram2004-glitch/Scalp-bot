# Railway - deploy sicuro di Gemmo Remondata Bot

Dashboard corrente: https://scalp-bot-production-1bc7.up.railway.app/

## Collegamento rapido

1. Aprire https://railway.com/new.
2. Scegliere **Deploy from GitHub repo** e usare la sessione GitHub gia autenticata.
3. Selezionare `rolram2004-glitch/Scalp-bot`, branch `main`.
4. Railway usa `npm start` (`node server.js`) e la porta dinamica `process.env.PORT`.
5. In **Variables** impostare:
   - `OANDA_API_KEY` (mai nel repository o nei log);
   - `OANDA_ACCOUNT_ID`;
   - `TRADING_MODE=PAPER`;
   - `LIVE_TRADING_ENABLED=false`;
   - `LIVE_EXECUTION_VARIANT=MAIN` (unico valore alternativo valido: `INVERSE`);
   - `MAX_NEW_TRADES_PER_CYCLE=6`;
   - `DEFAULT_UNITS=1000` o il valore approvato dall'utente.
6. Health check: `/health`.
7. Verificare `/api/oanda/status`, `/api/status` e `/api/candles?symbol=EURUSD&timeframe=M5&count=2`.

## Attivazione OANDA Practice

Il wrapper usa esclusivamente `https://api-fxpractice.oanda.com/v3`. La modalita di esecuzione invia quindi ordini reali all'account **Practice**, non a un conto finanziato.

Prima dell'attivazione devono essere tutti veri:

- OANDA Practice connesso e account/currency verificati;
- 15 coppie FX scansionate ogni 2 minuti;
- size, precisione, minimum trade size e conversione verso la valuta conto disponibili;
- massimo 6 nuovi ingressi validi per ciclo (mai una quota obbligatoria);
- nessuna posizione gia aperta sul simbolo, verificata su trade e posizioni OANDA;
- ordine considerato aperto soltanto dopo order ID, trade ID e rilettura `OPEN` coerente;
- XAUUSD escluso dall'esecuzione OANDA finche la strategia dedicata non e validata;
- test automatici superati e conferma esplicita dell'utente.

La dashboard calcola MAIN e INVERSE dallo stesso snapshot OANDA e dallo stesso
segnale. La corsia non selezionata resta sempre `PAPER SHADOW` e non invia
ordini. Il suo ledger e il suo P&L restano separati dai trade OANDA e usano
solo bid/ask reali ricevuti dopo l'avvio. Non configurare mai entrambe le
corsie: `BOTH`, valori vuoti o valori
non riconosciuti bloccano l'esecuzione. Due ordini opposti sullo stesso conto
possono ridurre o chiudere l'esposizione invece di creare due test indipendenti.

Ogni ordine GEMMO salva la corsia e il signal ID nelle client extensions
OANDA. Una posizione senza tag verificabile viene mostrata come OANDA esterna,
ma il bot non puo chiuderla automaticamente e non apre nuovi ordini finche
l'origine resta sconosciuta. Prima di cambiare da MAIN a
INVERSE (o viceversa) chiudere tutte le posizioni GEMMO della corsia precedente;
in caso contrario ogni nuovo ordine resta bloccato.

Solo dopo la conferma impostare entrambe le variabili e fare un nuovo deploy:

```text
TRADING_MODE=LIVE
LIVE_TRADING_ENABLED=true
LIVE_EXECUTION_VARIANT=MAIN
```

Per eseguire esclusivamente la lettura contraria usare invece
`LIVE_EXECUTION_VARIANT=INVERSE`. La strategia MAIN non viene modificata:
l'azione inversa e derivata una sola volta (`BUY` diventa `SELL`, `SELL`
diventa `BUY`, `HOLD` resta `HOLD`) dallo stesso timestamp e dalla stessa
quotazione. XAUUSD continua a essere bloccato in LIVE finche il suo modulo
dedicato non e validato.

Se una sola delle due manca, ogni ordine resta bloccato.

## Persistenza

Le posizioni OANDA aperte vengono riconciliate dall'API dopo il riavvio. Lo storico PAPER resta in memoria e si azzera al riavvio; non viene presentato come storico OANDA.

## Segreti

Un token incollato in chat deve essere revocato e sostituito. Inserire il nuovo
token direttamente nelle Railway Variables o nel `.env` locale: mai in chat,
nel codice, nei log o in Git.
