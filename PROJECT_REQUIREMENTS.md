# SCALP BOT — Requisiti vincolanti

Questo file deve essere letto integralmente prima di ogni modifica futura al progetto.

## Regola fondamentale

Una posizione mostrata come LIVE deve esistere realmente su OANDA con lo stesso simbolo, direzione, unità, trade ID e stato. Prezzo reale OANDA non significa ordine reale OANDA. Non inventare trade, P&L, statistiche, storico, calendario, grafici o stati di connessione.

## Sicurezza e modalità

- Non inviare ordini reali durante sviluppo o test.
- Modalità esplicite: `TRADING_MODE=PAPER` e `TRADING_MODE=LIVE`; default e primo deploy Railway: PAPER.
- PAPER usa prezzi/candele reali OANDA ma non invia ordini ed è marcato chiaramente PAPER.
- LIVE invia ordini solo quando esplicitamente attivato; senza connessione OANDA blocca nuove aperture.
- Nessun fallback simulato nascosto in LIVE.
- Segreti solo in `.env` locale o Railway Variables; mai codice, Git, dashboard, log o chat.

## Fonte della verità LIVE

OANDA è fonte della verità per posizioni, ordini, trade aperti/chiusi, prezzi di entrata/uscita, SL, TP, stato e P&L. Il flusso LIVE obbligatorio è: segnale → rischio → controllo posizione locale e OANDA → richiesta ordine → risposta OANDA → verifica order/trade ID → rilettura da OANDA → solo allora visualizzazione come aperto. Un rifiuto non crea trade locale; registra il vero motivo come `ORDER REJECTED` senza P&L inventato.

Ogni sync deve leggere posizioni e trade OANDA, riconciliare il locale e aggiornare la dashboard. Record locali assenti su OANDA: `LOCAL ORPHAN / NOT VERIFIED`, esclusi dal P&L live.

Ogni trade LIVE salva: OANDA order ID e trade ID, instrument, BUY/SELL, units, entry, SL, TP, open/close time, close reason, realized P&L, strategy/setup, confidence e reasoning. Il trade ID OANDA deve essere visibile.

## Dati e dashboard

- Se la fonte reale manca mostrare `DATI NON DISPONIBILI` o `N/A`, non zero inventati.
- Se OANDA non è connesso mostrare `OANDA DISCONNECTED` e non `OANDA LIVE`.
- `TP HIT` e P&L LIVE solo con chiusura verificabile OANDA.
- Storico separato con filtri `LIVE OANDA` e `PAPER`; eliminare storico falso.
- Calendario senza fonte reale: `ECONOMIC CALENDAR NOT CONFIGURED`.
- Grafici esclusivamente con candele reali; layer ordinati per entry, SL, TP1/2/3, trade, segnali, swing, BOS, CHoCH e FVG, con timestamp/ID e controlli di visibilità.
- Sezioni: Overview, Live OANDA, Open Positions, Closed Trades, Chart, XAUUSD, Strategy Log, Errors, Connection Status, Deployment Status.
- Overview: connessione, modalità, valuta conto, balance, NAV, unrealized P&L, posizioni, ultimo sync/prezzo/ordine/errore; solo valori reali.

## Rischio e posizioni

- Forex: rischio/stop economico 1.20 e target previsto 2.40, senza alterare la strategia salvo bug reale.
- Distinguere target previsto dal P&L reale OANDA. Non etichettare in USD dati registrati in CHF.
- Leggere valuta conto via API e gestire correttamente conversione, pip value, spread, slippage e unità.
- Massimo una posizione aperta per simbolo, verificata sia localmente sia su trade/posizioni OANDA. Se già presente: `SKIP <SYMBOL> — POSITION ALREADY OPEN`.

## XAUUSD dedicato

Modulo separato dalla strategia forex, originale e non derivato da codice proprietario. Considerare swing high/low, struttura, BOS, CHoCH, liquidity sweep/zones, equal highs/lows, FVG, breakout/retest, trend/EMA, volatilità, spread, sessione e momentum.

Prima dell’uso verificare supporto `XAU_USD` sul conto, precisione, size minima, units, spread, conversione P&L e partial close. Rischio massimo equivalente a 7.5 EUR; target complessivo fino a 15 USD secondo gestione reale. TP1/2/3 devono derivare dalla struttura reale e comparire solo se realmente gestiti da OANDA; partial close reale o ordini separati documentati.

## Railway

Verificare repository/branch, start command, `process.env.PORT`, health endpoint, variabili, persistenza e restart policy. Primo deploy sempre PAPER; verificare connessione, prezzi, dashboard, database, restart e sync prima di preparare LIVE.

## Ordine di lavoro

1. Audit completo repository e ricerca di paper/simulated/mock/fake/fallback/synthetic/random/demo/generated/seed/trade/P&L/history.
2. Backup Git non distruttivo.
3. Rimozione/disattivazione dati falsi.
4. Correzione esecuzione e sincronizzazione OANDA PAPER/LIVE.
5. Test obbligatori.
6. Dashboard.
7. Strategia XAUUSD separata.
8. Railway.

Fermarsi solo per credenziale indispensabile, conferma di sicurezza, rischio ordine reale, rischio cancellazione dati importanti o ambiguità con possibile perdita economica.

## Test obbligatori

1. Autenticazione OANDA reale; 2. account ID corretto; 3. valuta conto via API; 4. prezzo reale; 5. candele reali; 6. nessun `Math.random` nei dati finanziari; 7. nessun trade falso; 8. PAPER non appare LIVE; 9. funzione ordine LIVE con error handling; 10. rifiuto non crea trade locale; 11. unicità per simbolo anche OANDA; 12. trade ID salvato; 13. sync dopo riavvio; 14. dashboard legge posizioni OANDA; 15. XAUUSD separato; 16. TP strutturali non inventati; 17. Railway usa `process.env.PORT`; 18. nessun segreto nel repository.

## Report finale unico

Riportare: errori trovati, file modificati, dati falsi rimossi, stato OANDA, PAPER, LIVE, XAUUSD, grafici, Railway e azioni utente, con endpoint/test/dati verificati e conferma che nessun ordine reale è stato inviato.
