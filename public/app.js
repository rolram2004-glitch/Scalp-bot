async function fetchJSON(url){ const res = await fetch(url); return res.json(); }

function formatPips(pips){ return pips==null? '—' : (Number(pips)).toFixed(1); }

function renderTerminal(data){
  const plEl = document.getElementById('plToday'); if(plEl) plEl.textContent = (data.analytics?.pnlToday!=null? data.analytics.pnlToday.toFixed(2): 'N/A');
  const winEl = document.getElementById('winRate'); if(winEl) winEl.textContent = (data.analytics?.totalTrades ? data.analytics.winRate + '%' : 'N/A');
  const tradeEl = document.getElementById('tradeToday'); if(tradeEl) tradeEl.textContent = (data.dailyTradeCount ?? 0);
  const posEl = document.getElementById('positionsOpen'); if(posEl) posEl.textContent = ((data.openTrades||[]).length);
  const lastEl = document.getElementById('lastSignal'); if(lastEl) lastEl.textContent = ((data.currentAction||'—') + ' ' + (data.currentConfidence? data.currentConfidence+'%':''));

  const feed = document.getElementById('liveFeed');
  feed.innerHTML = '';
  (data.openTrades||[]).forEach(t=>{
    const div = document.createElement('div'); div.className='feed-item';
    div.innerHTML = `<div><strong>${t.symbol}</strong> <span style="color:${t.side==='BUY'?'#5efc8d':'#ff6b6b'}">${t.side}</span> <small>${t.setupType||''}</small></div><div>${t.entryPrice?Number(t.entryPrice).toFixed(5):'—'} <small>${t.lotSize||''}</small></div>`;
    feed.appendChild(div);
  });
}

function renderHistory(data){
  const tbody = document.getElementById('historyBody');
  tbody.innerHTML = '';
  (data.closedTrades||[]).slice(0,50).forEach(t=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${t.openedAt? new Date(t.openedAt).toLocaleString():'—'}</td><td>${t.symbol}</td><td>${t.side}</td><td>${t.lotSize||'—'}</td><td>${t.setupType||'—'}</td><td>${t.entryPrice?Number(t.entryPrice).toFixed(5):'—'}</td><td>${t.exitPrice?Number(t.exitPrice).toFixed(5):'—'}</td><td>${t.pnl? t.pnl.toFixed(2):'—'}</td><td>${t.pnlPips? t.pnlPips:'—'}</td><td>${t.reasoning||'—'}</td>`;
    tbody.appendChild(tr);
  });
}

async function renderAnalytics(){
  const a = await fetchJSON('/api/analytics');
  const el = document.getElementById('analyticsDist');
  el.innerHTML = JSON.stringify(a.distribution || {});
  const perDay = document.getElementById('analyticsPerDay');
  perDay.innerHTML = JSON.stringify(a.tradesPerDay || {});
}

async function renderChart(symbol='EURUSD', timeframe='M5'){
  // fetch candles
  const candles = await fetchJSON(`/api/candles?symbol=${symbol}&count=200`).catch(()=>[]);
  const chartEl = document.getElementById('chart');
  chartEl.innerHTML = '';
  // basic text fallback
  if(!candles || candles.length===0){ chartEl.textContent = 'DATI NON DISPONIBILI — OANDA DISCONNECTED'; return; }
  // show list
  const ul = document.createElement('div'); ul.style.maxHeight='320px'; ul.style.overflow='auto';
  candles.slice(-50).reverse().forEach(c=>{
    const d = new Date(c.time||c.complete);
    const line = document.createElement('div'); line.style.padding='4px 0'; line.textContent = `${d.toLocaleString()} O:${c.mid?.o || c.o} H:${c.mid?.h||c.h} L:${c.mid?.l||c.l} C:${c.mid?.c||c.c}`;
    ul.appendChild(line);
  });
  chartEl.appendChild(ul);
}

function renderScanner(allMarketData){
  const tbody = document.querySelector('#scannerTable tbody');
  if(!tbody) return;
  tbody.innerHTML = '';
  const symbols = Object.keys(allMarketData||{});
  symbols.forEach(s=>{
    const md = allMarketData[s];
    const tr = document.createElement('tr');
    const price = (md.closePrice||md.bid||'—');
    const trend = md.trend || '—';
    const signal = md.currentSignal || '—';
    const conf = md.confidence || '—';
    const setup = md.nearOrderBlock ? 'OB' : (md.fairValueGap || '—');
    const spread = md.spread!=null? md.spread.toFixed(1): '—';
    const session = md.session || '—';
    const reason = md.reasoning || '—';
    tr.innerHTML = `<td>${s}</td><td>${Number(price).toFixed(5)}</td><td>${trend}</td><td>${signal}</td><td>${conf}</td><td>${setup}</td><td>${spread}</td><td>${session}</td><td>${reason}</td>`;
    tbody.appendChild(tr);
  });
}

function renderActiveTrades(openTrades){
  const container = document.getElementById('tradesList');
  if(!container) return;
  container.innerHTML = '';
  (openTrades||[]).forEach(t=>{
    const div = document.createElement('div'); div.className='trade-card';
    const sideColor = t.side==='BUY'? 'var(--accent)': 'var(--danger)';
    const pnl = t.pnl!=null? t.pnl.toFixed(2): '0.00';
    const pips = t.pnlPips!=null? t.pnlPips: '—';
    const duration = t.openedAt? Math.floor((Date.now()-new Date(t.openedAt))/1000):0;
    const sl = t.stopLoss||'—'; const tp = t.takeProfit||'—';
    div.innerHTML = `<div class="trade-top"><div class="trade-meta"><strong>${t.symbol}</strong><div style="color:${sideColor};margin-left:8px">${t.side}</div><div style="margin-left:8px">Lot: ${t.lotSize||'—'}</div><div style="margin-left:8px">Entry: ${t.entryPrice?Number(t.entryPrice).toFixed(5):'—'}</div></div><div><div>P&L: ${pnl}</div><div>Pips: ${pips}</div></div></div><div class="progress-bar"><div class="progress-fill" style="width:40%"></div></div><div style="font-size:12px;color:var(--muted);margin-top:6px">SL: ${sl} • TP: ${tp} • Durata: ${duration}s • Conf: ${t.confidence||'—'}</div>`;
    container.appendChild(div);
  });
}

function renderActivityLog(logs){
  const el = document.getElementById('logs');
  if(!el) return;
  el.innerHTML = '';
  (logs||[]).slice(0,200).reverse().forEach(l=>{
    const d = document.createElement('div'); d.textContent = l; el.appendChild(d);
  });
}

async function refreshAll(){
  const status = await fetchJSON('/api/status');
  const analytics = await fetchJSON('/api/analytics');
  status.analytics = analytics;
  renderTerminal(status);
  renderHistory(status);
}

window.addEventListener('load', async ()=>{
  document.getElementById('navTerminal').addEventListener('click', ()=>show('terminal'));
  document.getElementById('navChart').addEventListener('click', ()=>show('chart'));
  document.getElementById('navHistory').addEventListener('click', ()=>show('history'));
  document.getElementById('navAnalytics').addEventListener('click', ()=>show('analytics'));

  const symbolSelect = document.getElementById('symbolSelect'); if(symbolSelect) symbolSelect.addEventListener('change',(e)=>{ renderChart(e.target.value); });
  const tfSelect = document.getElementById('tfSelect'); if(tfSelect) tfSelect.addEventListener('change',(e)=>{ renderChart(document.getElementById('symbolSelect').value,e.target.value); });

  // initial
  const symbols = (await fetchJSON('/api/status')).symbols || ['EURUSD'];
  const sel = document.getElementById('symbolSelect');
  if(sel) sel.innerHTML = symbols.map(s=>`<option>${s}</option>`).join('');

  await refreshAll();
  if(sel) await renderChart(sel.value);

  // header buttons
  const startBtn = document.getElementById('startBtn'); if(startBtn) startBtn.addEventListener('click', ()=>{ startBtn.classList.add('active'); if(document.getElementById('stopBtn')) document.getElementById('stopBtn').classList.remove('active'); console.log('Start clicked'); });
  const stopBtn = document.getElementById('stopBtn'); if(stopBtn) stopBtn.addEventListener('click', ()=>{ stopBtn.classList.add('active'); if(document.getElementById('startBtn')) document.getElementById('startBtn').classList.remove('active'); console.log('Stop clicked'); });
  const modeToggle = document.getElementById('modeToggle'); if(modeToggle) modeToggle.disabled = true;
  const refreshBtn = document.getElementById('refreshBtn'); if(refreshBtn) refreshBtn.addEventListener('click', async ()=>{ await refreshAll(); const sel2 = document.getElementById('symbolSelect'); if(sel2) await renderChart(sel2.value); });
  const exportBtn = document.getElementById('exportBtn'); if(exportBtn) exportBtn.addEventListener('click', ()=>{ const data = {status: 'export', time: Date.now()}; const blob = new Blob([JSON.stringify(data,null,2)], {type:'application/json'}); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'scalp-export.json'; a.click(); URL.revokeObjectURL(url); });

  // live updates
  const es = new EventSource('/events');
  es.onmessage = (ev)=>{
    const data = JSON.parse(ev.data);
    fetchJSON('/api/analytics').then(a=>{ data.analytics = a; renderTerminal(data); renderHistory(data); renderActivityLog(data.logs); renderActiveTrades(data.openTrades); }).catch(()=>{ renderTerminal(data); renderHistory(data); renderActivityLog(data.logs); renderActiveTrades(data.openTrades); });
  };

  setInterval(refreshAll, 15000);
  // scanner polling
  setInterval(async ()=>{ const md = await fetchJSON('/api/marketdata?all=true').catch(()=>({})); renderScanner(md); }, 5000);
  // initial load of scanner
  fetchJSON('/api/marketdata?all=true').then(md=>renderScanner(md)).catch(()=>{});
});

function show(section){
  document.querySelectorAll('.section').forEach(s=>s.classList.remove('active'));
  document.getElementById(section).classList.add('active');
  document.querySelectorAll('.nav-btn').forEach(b=>b.classList.remove('active'));
  document.getElementById('nav'+capitalize(section)).classList.add('active');
}
function capitalize(s){return s.charAt(0).toUpperCase()+s.slice(1);}
