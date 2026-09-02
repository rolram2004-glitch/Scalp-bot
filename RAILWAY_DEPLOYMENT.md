# Railway - deploy sicuro di SEL SCALP BOT — $Rohato$🤖111

Dashboard corrente: https://scalp-bot-production-761a.up.railway.app/
Confronto MAIN/INVERSE: https://scalp-bot-production-761a.up.railway.app/vs
Setup operativo: https://scalp-bot-production-761a.up.railway.app/setup

## Collegamento rapido

1. Aprire https://railway.com/new.
2. Scegliere **Deploy from GitHub repo** e usare la sessione GitHub gia autenticata.
3. Selezionare `rolram2004-glitch/Scalp-bot`, branch `main`.
4. Railway usa `npm start` (`node server.js`) e la porta dinamica `process.env.PORT`.
5. In **Variables** impostare:
   - `OANDA_API_KEY` (mai nel repository o nei log);
   - `OANDA_ACCOUNT_ID`;
   - `TRADING_MODE=PAPER`;
   - `OANDA_ENVIRONMENT=PRACTICE`;
   - `OANDA_ORDER_EXECUTION_ENABLED=false`;
   - `LIVE_TRADING_ENABLED=false`;
   - `LIVE_EXECUTION_VARIANT=INVERSE` (selettore esplicito usato da `OANDA_LIVE`; unico valore alternativo valido: `MAIN`);
   - `PRACTICE_EXECUTION_VARIANT=INVERSE` per la MIRROR operativa su OANDA Practice: tutti i segnali forex vengono invertiti una sola volta (`BUY→SELL`, `SELL→BUY`), TP nominale `+0,20 CHF`, SL nominale `-2,00 CHF`;
   - `SCAN_INTERVAL_MS=30000`;
   - `MAX_NEW_TRADES_PER_CYCLE=7`;
   - `MAX_OPEN_POSITIONS=15`;
   - `MAX_DAILY_TRADES=100` per PAPER/OANDA Practice (`OANDA_LIVE` viene comunque bloccato a 25 dal server);
   - `SYMBOL_REENTRY_COOLDOWN_MS=600000`;
   - `MIN_SIGNAL_CONFIDENCE=55`;
   - `FOREX_SIGNAL_PROFILE=ROHATO_AGGRESSIVE_100`;
   - `DEFAULT_UNITS=1000` come massimo; OANDA Practice riduce automaticamente la size quando serve per tenere lo SL fuori dallo spread;
   - `ACCOUNT_TARGET_CURRENCY=CHF`;
   - `CONTROL_PANEL_TOKEN` con un valore segreto lungo e unico;
   - `ENABLE_OANDA_DEMO_TEST=false`;
   - `AI_PROVIDER=DISABLED`, `AI_CONFIRMATION_REQUIRED=false` e `GEMINI_MODEL=gemini-3.5-flash-lite` finche Gemini non e configurato.
6. Health check: `/health`.
7. Verificare `/api/oanda/status`, `/api/status`, `/api/candles?symbol=EURUSD&timeframe=M5&count=2` e `/api/intelligence?symbol=EURUSD`.

La pagina `/setup` e il centro di controllo. Account autenticato, feed prezzi,
copertura candele ed esecuzione sono gate distinti: un processo Railway sano non
implica automaticamente che OANDA sia connesso.

## Verifica dopo ogni redeploy

Non considerare concluso un deploy finche `/api/status` non espone
`signalProfile=ROHATO_AGGRESSIVE_100`, `maxDailyTrades=100`,
`scanIntervalMs=30000`, `symbolReentryCooldownMs=600000`,
`maxOpenPositions=15`, `entryGateStatus` valorizzato e
`xauSignalLab.orderCount=0`. Il conteggio giornaliero deve includere soltanto
trade con `openTime` nel giorno UTC corrente, non posizioni vecchie chiuse oggi.
La copertura che abilita gli ordini deve essere `15/15` sulle coppie FX: XAUUSD
ha orari diversi ed e `SIGNAL ONLY`, quindi la sua chiusura non deve bloccare il
motore forex.

Controllare inoltre che:

- `/vs` usi per impostazione iniziale l'intera sessione del bot e confronti
  esclusivamente record MAIN/INVERSE con lo stesso Signal ID;
- campione, totale R, expectancy, profit factor, max drawdown, curva equity e
  tabella per simbolo siano calcolati sul medesimo insieme di trade abbinati;
- se entrambe le corsie sono negative, il verdetto dica `MENO NEGATIVA` e non
  presenti una corsia come vincente o profittevole;
- la corsia selezionata mostri OANDA Practice e la corsia non selezionata `PAPER SHADOW`; mai due corsie OANDA sullo stesso segnale;
- `/setup` mostri separatamente broker, feed, ledger ed execution gate; durante
  la chiusura del mercato FX deve indicare `PAUSA WEEKEND`, non una falsa
  disconnessione;
- lo scanner elenchi tutte le 15 coppie FX e il grafico M5 esponga volume,
  EMA 20/50/200 e livelli Entry/SL/TP quando presenti;
- `/xauusd` e `/api/status` continuino a dichiarare XAUUSD `SIGNAL ONLY` con
  `orderCount=0`.

## Attivazione OANDA_DEMO Practice

Con `OANDA_ENVIRONMENT=PRACTICE` il wrapper usa `https://api-fxpractice.oanda.com/v3`. `OANDA_DEMO` invia quindi ordini al conto **Practice**, non a un conto finanziato. `OANDA_LIVE` richiede invece endpoint live, enable flag e una conferma server-side separata; non deve essere configurato durante il collaudo.

Prima dell'attivazione devono essere tutti veri:

- OANDA Practice connesso e account/currency verificati;
- 15 coppie FX scansionate ogni 30 secondi, senza sovrapporre due cicli;
- size, precisione, minimum trade size e conversione verso la valuta conto disponibili;
- massimo 7 nuovi ingressi validi per ciclo (mai una quota obbligatoria);
- massimo 100 ingressi totali al giorno UTC sul conto Practice; non sono una
  quota obbligatoria e i setup non validi restano HOLD. In `OANDA_LIVE` il
  limite server-side resta 25 anche se Railway contiene un valore piu alto;
- cooldown di 10 minuti dopo la chiusura della stessa coppia;
- nessuna posizione gia aperta sul simbolo, verificata su trade e posizioni OANDA;
- ordine considerato aperto soltanto dopo order ID, trade ID e rilettura `OPEN` coerente;
- XAUUSD escluso dall'esecuzione OANDA finche la strategia dedicata non e validata;
- test automatici superati e conferma esplicita dell'utente.

La dashboard calcola MAIN e MIRROR (INVERSE) dallo stesso snapshot OANDA e dallo stesso
segnale. MIRROR/INVERSE e la corsia operativa e usa TP nominale `+0,20 CHF` e
SL nominale `-2,00 CHF`; il segnale BUY apre SELL e il segnale SELL apre BUY. La corsia MAIN non selezionata resta
sempre `PAPER SHADOW`, non invia ordini e viene aperta soltanto dopo l'ingresso
verificato della corsia operativa corrispondente. Il confronto usa R; il P&L
originale resta separato per valuta. Non configurare mai entrambe le
corsie: `BOTH`, valori vuoti o valori
non riconosciuti bloccano l'esecuzione. Due ordini opposti sullo stesso conto
possono ridurre o chiudere l'esposizione invece di creare due test indipendenti.

Ogni ordine GEMMO salva la corsia e il signal ID nelle client extensions
OANDA. Una posizione senza tag verificabile viene mostrata come OANDA esterna,
il bot non puo chiuderla automaticamente e non apre nuovi ordini finche
l'origine resta sconosciuta. Le posizioni GEMMO verificate della corsia
precedente possono invece arrivare ai propri SL/TP broker mentre la nuova corsia
lavora su simboli diversi. Sullo stesso simbolo resta sempre vietato un secondo
ordine: si attende la chiusura verificata e il cooldown, evitando compensazioni
o riduzioni involontarie dell'esposizione OANDA.

Solo dopo la conferma impostare entrambe le variabili e fare un nuovo deploy:

```text
TRADING_MODE=OANDA_DEMO
OANDA_ENVIRONMENT=PRACTICE
OANDA_ORDER_EXECUTION_ENABLED=true
LIVE_TRADING_ENABLED=true
LIVE_EXECUTION_VARIANT=INVERSE
PRACTICE_EXECUTION_VARIANT=INVERSE
```

La configurazione esegue esclusivamente la corsia MIRROR. La strategia MAIN non viene modificata:
l'azione inversa e derivata una sola volta (`BUY` diventa `SELL`, `SELL`
diventa `BUY`, `HOLD` resta `HOLD`) dallo stesso timestamp e dalla stessa
quotazione. La corsia operativa usa TP nominale `+0,20 CHF` e SL nominale
`-2,00 CHF`. Tutti i risultati BUY/SELL degli indicatori forex vengono invertiti una sola volta; il ritmo di scansione resta invariato. XAUUSD continua a essere bloccato nell'esecuzione OANDA finche il suo modulo
dedicato non e validato.

Se uno solo dei gate manca, ogni ordine resta bloccato. `OANDA_LIVE` richiede inoltre `OANDA_ENVIRONMENT=LIVE` e `OANDA_LIVE_CONFIRMATION=I_CONFIRM_REAL_MONEY`; questa conferma non deve essere impostata senza un'autorizzazione finale esplicita.

## Persistenza

Le posizioni OANDA aperte vengono riconciliate dall'API dopo il riavvio. Lo storico PAPER resta in memoria e si azzera al riavvio; non viene presentato come storico OANDA. Per conservare ricevute locali e order ID tra redeploy occorre montare un Railway Volume: senza volume la persistenza resta non configurata e OANDA_LIVE non va attivato.

Dopo un redeploy `/vs` deve quindi escludere esplicitamente i record OANDA che
non hanno piu il gemello PAPER con lo stesso Signal ID e mostrare il motivo del
reset. Non ricostruire o stimare retroattivamente risultati INVERSE mancanti.

## Segreti

Un token incollato in chat deve essere revocato e sostituito. Inserire il nuovo
token direttamente nelle Railway Variables o nel `.env` locale: mai in chat,
nel codice, nei log o in Git.
