# GEMMO REMONDATA BOT - REQUISITI VINCOLANTI

Questo file deve essere letto integralmente prima di ogni modifica futura al progetto.

## Regola fondamentale

Una posizione mostrata come LIVE deve esistere realmente su OANDA con lo stesso simbolo, direzione, unita, trade ID e stato. Prezzo reale OANDA non significa ordine reale OANDA. Non inventare trade, P&L, statistiche, storico, calendario, grafici, livelli o stati di connessione.

## Sicurezza e modalita

- Non inviare ordini reali durante sviluppo o test.
- Modalita esplicite ammesse: `TRADING_MODE=PAPER`, `TRADING_MODE=OANDA_DEMO` e `TRADING_MODE=OANDA_LIVE`; default e primo deploy Railway: PAPER.
- PAPER usa prezzi e candele reali OANDA, non invia ordini ed e marcato chiaramente PAPER.
- OANDA_DEMO invia ordini reali soltanto al conto OANDA Practice, dopo attivazione esplicita e verifica di tutti i gate.
- OANDA_LIVE usa l'endpoint reale e non puo essere attivato senza conferma finale esplicita dell'utente.
- Se account, feed, strumento, size, protezioni o sincronizzazione non sono verificati, bloccare l'esecuzione.
- Nessun fallback simulato nascosto.
- Segreti solo in `.env` locale o Railway Variables; mai codice, Git, dashboard, log o chat.
- Un token incollato in chat deve essere considerato esposto, revocato e sostituito direttamente dal proprietario.

## Fonte della verita OANDA

In OANDA_DEMO e OANDA_LIVE, OANDA e fonte della verita per posizioni, ordini, trade aperti e chiusi, prezzi di entrata e uscita, SL, TP, stato e P&L. Flusso obbligatorio:

`segnale -> controlli rischio -> controllo locale e OANDA -> richiesta ordine -> risposta OANDA -> verifica order/trade ID -> rilettura OPEN da OANDA -> visualizzazione`.

Un rifiuto non crea un trade locale. Ogni sincronizzazione legge trade e posizioni OANDA e riconcilia il locale. Record locali assenti su OANDA sono `LOCAL ORPHAN / NOT VERIFIED` ed esclusi dal P&L LIVE.

Ogni trade OANDA conserva OANDA order ID e trade ID, strumento, direzione, unita, entry, SL, TP, orari, motivo chiusura, P&L realizzato, setup, setup score e reasoning. Il trade ID deve essere visibile in dashboard.

Un test ordine OANDA_DEMO deve essere una funzione amministrativa separata, mostrare prima ambiente, account mascherato, simbolo, side, unita, SL e TP, e richiedere conferma manuale. Non deve mai partire dal ciclo normale o dai test automatici. Dopo l'invio mostra la ricevuta reale e la rilettura OANDA; un rifiuto non crea stato locale.

## Dati e dashboard

- Dato reale assente: `DATI NON DISPONIBILI` oppure `N/A`, mai zero inventato.
- OANDA scollegato: `OANDA DISCONNECTED`, nuovi ordini bloccati.
- `TP HIT` e P&L LIVE solo dopo verifica OANDA.
- Storici LIVE OANDA, PAPER e PAPER SHADOW sempre separati.
- Calendario senza fonte configurata: `ECONOMIC CALENDAR NOT CONFIGURED`.
- Grafici solo con candele OANDA e timestamp originali; nessun marker riposizionato.
- Il cockpit deve separare chiaramente autenticazione account, feed prezzi, esecuzione e sincronizzazione.
- Il Setup deve mostrare safety gate, copertura scansione, matrice dei 16 strumenti, confronto MAIN/INVERSE sullo stesso snapshot, ricevute OANDA verificate, orfani, shadow ledger, errori e diagnostica.
- Ogni badge deve degradare a warning/error quando i dati sono vecchi o assenti; nessun verde basato su supposizioni.
- Il riferimento visivo definitivo unisce le due immagini fornite: il contenuto dashboard denso con sidebar diventa la pagina principale; il contenuto chart/control-room diventa Grafico/Setup. Griglia dark navy coerente, proporzioni uniformi, nessuna sovrapposizione, responsive desktop/tablet/telefono e target touch ampi. Se un pannello non entra deve andare in una pagina o sezione distinta, non essere schiacciato.
- La dashboard principale include soltanto metriche derivabili da dati reali: P&L, win rate, trade oggi, posizioni, balance, equity/NAV, profit factor, drawdown, rischio, ultimo segnale e timestamp; quando non calcolabili mostra N/A.
- Grafico/Setup include Market Scanner, grafico OANDA, layer attivabili, scenari speculari BUY/SELL dallo stesso snapshot e decisione finale BUY/SELL/HOLD motivata.

## Strategia e qualita segnali

- Non forzare un numero di trade. Se manca un setup completo, usare `HOLD`.
- Forex: mantenere la logica esistente salvo bug reali; rischio economico previsto 1.20 e target previsto 2.40 nella valuta correttamente dichiarata.
- Distinguere sempre target previsto da P&L reale OANDA. Non etichettare USD se il conto e in CHF.
- Massimo una posizione per simbolo, verificata localmente, nei trade OANDA e nelle posizioni OANDA.
- Gli scenari BUY e SELL derivano dallo stesso identico snapshot OANDA e dallo stesso timestamp; non effettuano due richieste e non aprono automaticamente trade opposti.
- Una sola decisione finale puo essere selezionata per l'esecuzione OANDA; lo scenario scartato resta analisi e non invia ordini.
- Non presentare il punteggio euristico come probabilita: usare `SETUP SCORE`, derivato in modo ripetibile da trend, momentum, struttura, liquidita, volatilita, spread, sessione, rischio e conferma AI.

## XAUUSD dedicato

XAUUSD usa un modulo distinto e originale basato su candele OANDA: swing, struttura, BOS, CHoCH, liquidity sweep, equal high/low, FVG, trend/EMA, volatilita, spread, sessione e momentum.

Prima dell'esecuzione verificare supporto `XAU_USD`, precisione, size minima, unita, spread, conversione P&L e partial close. Rischio massimo equivalente a 7.5 EUR e target complessivo fino a 15 USD solo con conversione reale. TP1/TP2/TP3 devono essere livelli strutturali reali e non possono essere mostrati come gestiti se OANDA non li gestisce. Fino alla verifica completa XAUUSD resta `ANALYSIS ONLY` per l'esecuzione.

## Railway

Verificare repository e branch, `npm start`, `process.env.PORT`, health endpoint, variabili, persistenza e restart policy `ALWAYS`. Primo deploy sempre PAPER. Non passare a OANDA_DEMO finche connessione, account, valuta, prezzi, candele, dashboard, riconciliazione e protezioni non sono verificati; non passare mai a OANDA_LIVE senza conferma finale esplicita.

Documentare: `TRADING_MODE`, `OANDA_API_KEY`, `OANDA_ACCOUNT_ID`, `OANDA_ENVIRONMENT`, `GEMINI_API_KEY`, `AI_PROVIDER`, `AI_CONFIRMATION_REQUIRED`, `AI_MIN_CONFIDENCE`, `ACCOUNT_TARGET_CURRENCY`, `MAX_OPEN_POSITIONS`, `MAX_DAILY_TRADES`. Segreti esclusivamente in Railway Variables o `.env` locale non tracciato.

## Control panel e AI

Il Control Panel mostra e valida modalita, bot ON/OFF, simboli, sessioni, limiti giornalieri, massimo posizioni, unicita per simbolo, setup score minimo, rischio, target, timeframe e XAUUSD. Le modifiche pericolose richiedono conferma e OANDA_LIVE non puo essere attivato dalla sola interfaccia senza un gate server-side esplicito.

Gemini, se configurato, puo soltanto APPROVE/REJECT dopo analisi tecnica e rischio. Deve restituire JSON validato; non puo creare prezzi, cambiare rischio, rimuovere SL, inviare ordini, cambiare modalita o aggirare gate. Se `AI_CONFIRMATION_REQUIRED=true` e Gemini fallisce, l'esito e SKIP TRADE.

## Ordine di lavoro

1. Audit completo e ricerca di dati simulati/falsi.
2. Backup Git non distruttivo.
3. Rimozione dei dati falsi.
4. Correzione PAPER/LIVE e sincronizzazione OANDA.
5. Test obbligatori.
6. Dashboard e Setup professionale.
7. Strategia XAUUSD separata.
8. Railway in PAPER.

## Test obbligatori

1. Autenticazione OANDA reale.
2. Account ID corretto senza esporlo.
3. Valuta conto letta via API.
4. Prezzo reale ricevuto.
5. Candele reali ricevute.
6. Nessun `Math.random` nei dati finanziari.
7. Nessun trade falso.
8. PAPER non appare LIVE.
9. Funzione ordine LIVE con error handling.
10. Rifiuto non crea trade locale.
11. Unicita per simbolo verificata anche su OANDA.
12. Trade ID OANDA salvato.
13. Riavvio e riconciliazione.
14. Dashboard legge posizioni OANDA.
15. XAUUSD separato.
16. TP strutturali non inventati.
17. Railway usa `process.env.PORT`.
18. Nessun segreto nel repository o nella cronologia aggiunta dal progetto.

## Report finale unico

Riportare errori trovati, file modificati, dati falsi rimossi, stato OANDA, PAPER, LIVE, XAUUSD, grafici, Railway e azioni utente. Includere endpoint e test verificati e confermare che durante sviluppo e test non e stato inviato alcun ordine reale.
