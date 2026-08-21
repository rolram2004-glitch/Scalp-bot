# SEL SCALP BOT — $Rohato$🤖111

Cockpit professionale White Glass di analisi e trading OANDA Practice. MAIN e MIRROR (INVERSE) nascono dallo stesso segnale. La MIRROR operativa usa la direzione opposta, TP nominale `+0,20 CHF` e SL nominale `-1,20 CHF`. Una sola corsia puo essere OANDA; l'altra resta PAPER SHADOW. Il confronto usa risultati in R e mantiene separate le valute originali.

## Confronto e diagnostica professionale

- `/vs` confronta MAIN e INVERSE soltanto sugli stessi Signal ID. La vista
  predefinita usa l'intera sessione del bot, mentre il filtro `OGGI` e
  disponibile per l'analisi intraday.
- Il verdetto distingue chiaramente una strategia positiva da quella soltanto
  meno negativa. Sono visibili curva cumulativa in R, expectancy, profit
  factor, max drawdown, win rate, confronto testa-a-testa e risultati per
  coppia.
- `/setup` spiega il gate operativo prima dei dati: broker, feed, ledger,
  esecuzione, AI e protezione XAUUSD. Durante il weekend mostra una pausa di
  mercato, senza farla sembrare una disconnessione del bot.
- Il Command Center include tutte le 15 coppie FX, pipeline decisionale,
  performance per setup, ricevute OANDA e grafico M5 con candele, volume,
  EMA 20/50/200 e linee Entry/SL/TP.

Queste viste sono diagnostiche: non cambiano la strategia, non abilitano
OANDA Live e non consentono a INVERSE o XAUUSD di inviare ordini.

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
- `LIVE_EXECUTION_VARIANT=MAIN|INVERSE`: selects exactly one OANDA execution lane. The other lane is an explicit paper shadow and never calls OANDA.
- `PRACTICE_EXECUTION_VARIANT=INVERSE`: seleziona la MIRROR operativa su OANDA Practice: direzione opposta, TP nominale `+0,20 CHF`, SL nominale `-1,20 CHF`. Non abilita `OANDA_LIVE`.

La regola della MIRROR operativa non dipende dai colori dell'interfaccia: usa lo stesso segnale MAIN nella direzione opposta, con TP nominale `+0,20 CHF` e SL nominale `-1,20 CHF`. Il P&L delle due corsie viene misurato separatamente con bid/ask reali, quindi spread e slippage non vengono nascosti.

Il profilo Practice `ROHATO_HYPER_100_PER_SYMBOL` scansiona 15 coppie ogni 10
secondi, può usare tutti i 15 ingressi validi di un ciclo, mantiene una sola
posizione contemporanea per simbolo e usa un cooldown di 1 minuto dopo la
chiusura. Riconosce trend, continuazioni rapide, impulsi iniziali e inversioni
confermate nei range. Il tetto è di 100 ingressi UTC per ciascun simbolo (1500
complessivi sui 15 FX), non un obiettivo forzato. Spread, prezzi reali, conferma
AI, riconciliazione, SL/TP e stop giornaliero restano obbligatori. PAPER resta a
100 complessivi; `OANDA_LIVE` resta hard-capped a 25 e richiede conferma separata.
La prontezza del feed operativo richiede le 15 coppie FX fresche e non dipende
dall'orario separato di XAUUSD, che resta `SIGNAL ONLY`. Posizioni Rohato
verificate della corsia precedente possono terminare ai propri SL/TP su simboli
gia occupati senza bloccare l'intero scanner MIRROR; esposizioni esterne o senza
tag verificabile continuano a bloccare fail-closed.

Gli identificatori OANDA storici conservano il prefisso tecnico `GEMMO` per
riconoscere in sicurezza le posizioni gia esistenti; il nome visibile del prodotto
e `SEL SCALP BOT — $Rohato$🤖111`.

XAUUSD usa il laboratorio dedicato `GOLD LIQUIDITY CONFLUENCE` ed e permanentemente `SIGNAL ONLY`: mostra segnali AI, livelli strutturali e risultati in R, ma non invia ordini OANDA, PAPER o PAPER SHADOW.

There is no synthetic market-data fallback. If OANDA data is unavailable, the scanner reports it and does not invent prices or trades. See `RAILWAY_DEPLOYMENT.md` before enabling OANDA Practice execution.
