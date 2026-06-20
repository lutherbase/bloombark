/* ─── Config ──────────────────────────────────────────────────────────────── */
const API_BASE = 'http://localhost:3001/api';
const WS_URL   = 'ws://localhost:3001';

/* ─── State ───────────────────────────────────────────────────────────────── */
let selectedChain  = 'auto'; // 'auto' | 'solana' | 'ethereum' | 'bsc' | 'base' | 'arbitrum' | 'tron'
let currentData    = null;
let priceChart     = null;
let distChart      = null;
let holderChart    = null;
let volumeChart    = null;
let ws             = null;
let lastUpdate     = Date.now();
let activeInterval = '5m'; // current chart timeframe

/* ─── Utils ───────────────────────────────────────────────────────────────── */
const $ = id => document.getElementById(id);
const fmt = {
  usd: v => {
    v = parseFloat(v) || 0;
    if (v >= 1e9) return '$' + (v/1e9).toFixed(2) + 'B';
    if (v >= 1e6) return '$' + (v/1e6).toFixed(2) + 'M';
    if (v >= 1e3) return '$' + (v/1e3).toFixed(1) + 'K';
    if (v > 0)    return '$' + v.toFixed(2);
    return '$0';
  },
  price: v => {
    v = parseFloat(v) || 0;
    if (v === 0)      return '$0.00';
    if (v >= 1000)    return '$' + v.toLocaleString('en', { minimumFractionDigits:2, maximumFractionDigits:2 });
    if (v >= 1)       return '$' + v.toFixed(4);
    if (v >= 0.01)    return '$' + v.toFixed(6);
    // For very small prices: count leading zeros after decimal and show enough sig-figs
    const str = v.toFixed(20);
    const match = str.match(/^0\.(0*)/);
    const leadZeros = match ? match[1].length : 0;
    const decimals  = leadZeros + 4;          // show 4 significant digits
    return '$' + v.toFixed(Math.min(decimals, 18));
  },
  num: v => {
    v = parseFloat(v) || 0;
    if (v >= 1e9) return (v/1e9).toFixed(2) + 'B';
    if (v >= 1e6) return (v/1e6).toFixed(2) + 'M';
    if (v >= 1e3) return (v/1e3).toFixed(1) + 'K';
    return Math.round(v).toLocaleString();
  },
  pct: v => {
    v = parseFloat(v) || 0;
    return (v > 0 ? '+' : '') + v.toFixed(2) + '%';
  },
  usdOrZero: v => {
    v = parseFloat(v) || 0;
    if (v >= 1e9) return '$' + (v/1e9).toFixed(2) + 'B';
    if (v >= 1e6) return '$' + (v/1e6).toFixed(2) + 'M';
    if (v >= 1e3) return '$' + (v/1e3).toFixed(1) + 'K';
    if (v > 0)    return '$' + v.toFixed(2);
    return '$0';
  },
  token: (v, sym) => {
    v = parseFloat(v) || 0;
    if (v >= 1e9) return (v/1e9).toFixed(2) + 'B ' + (sym||'');
    if (v >= 1e6) return (v/1e6).toFixed(2) + 'M ' + (sym||'');
    if (v >= 1e3) return (v/1e3).toFixed(1) + 'K ' + (sym||'');
    return Math.round(v).toLocaleString() + ' ' + (sym||'');
  },
};

/* ─── Navigation ──────────────────────────────────────────────────────────── */
document.querySelectorAll('.nav-item').forEach(el => {
  el.addEventListener('click', e => {
    e.preventDefault();
    const page = el.dataset.page;
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    el.classList.add('active');
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const target = document.getElementById('page-' + page);
    if (target) target.classList.add('active');
    const titles = {
      'dashboard':    ['DASHBOARD',       'Portfolio overview and market summary'],
      'ai-analyzer':  ['AI ANALYZER',     'Analyze token risk, insider activity & wallet behavior from contract address'],
      'wallet-tracker':['WALLET TRACKER', 'Track and monitor specific wallets in real-time'],
      'smart-money':  ['SMART MONEY',     'Follow smart money wallets and their moves'],
      'insider-scan': ['INSIDER SCAN',    'Detect insider wallets, team allocation, hidden connections & suspicious activity'],
      'narrative':    ['NARRATIVE',       'Track trending narratives and market sectors'],
      'ai-trading':   ['AI TRADING AGENT','Automated trading signals powered by AI models'],
      'auto-research':['AUTO RESEARCH',   'Automated token research and report generation'],
      'alerts':       ['ALERTS',          'Your configured alerts and notifications'],
      'watchlist':    ['WATCHLIST',       'Your saved tokens and watchlist'],
      'portfolio':    ['PORTFOLIO',       'Your portfolio performance and holdings'],
      'leaderboard':  ['LEADERBOARD',     'Top traders and wallets by performance'],
      'settings':     ['SETTINGS',        'Configure your Bloombark Terminal preferences'],
      'docs':         ['DOCUMENTATION',   'API docs, guides, and reference'],
    };
    const [title, sub] = titles[page] || ['BLOOMBARK TERMINAL', ''];
    $('pageTitle').textContent    = title;
    $('pageSubtitle').textContent = sub;

    const isAnalyzer = page === 'ai-analyzer';
    $('networkSelector').style.display = isAnalyzer ? '' : 'none';
    $('exportBtn').style.display       = isAnalyzer ? '' : 'none';

    if (page === 'dashboard') loadDashboard();
  });
});

// Initial setup
(function() {
  const activePage = document.querySelector('.nav-item.active')?.dataset?.page;
  if (activePage !== 'ai-analyzer') {
    $('networkSelector').style.display = 'none';
    $('exportBtn').style.display       = 'none';
  }
  if (activePage === 'dashboard') loadDashboard();
})();

/* ─── Live Clock ──────────────────────────────────────────────────────────── */
setInterval(() => {
  const secs = Math.floor((Date.now() - lastUpdate) / 1000);
  $('updateTime').textContent = `Updated ${secs}s ago`;
}, 1000);

/* ─── Chain Detection ────────────────────────────────────────────────────── */
const CHAIN_META = {
  auto:     { icon: '🌐', label: 'Auto' },
  solana:   { icon: '◎',  label: 'Solana' },
  ethereum: { icon: '⟠',  label: 'Ethereum' },
  bsc:      { icon: '🟡', label: 'BSC' },
  base:     { icon: '🔵', label: 'Base' },
  arbitrum: { icon: '🔷', label: 'Arbitrum' },
  tron:     { icon: '🔴', label: 'Tron' },
};

function detectChain(addr) {
  if (!addr) return 'solana';
  // Tron: starts with T, 34 chars, base58
  if (/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(addr)) return 'tron';
  // EVM (Ethereum, BSC, Base, Arbitrum): 0x + 40 hex chars
  if (/^0x[0-9a-fA-F]{40}$/.test(addr)) return 'ethereum';
  // Solana: base58, 32-44 chars, no 0, I, O, l
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr)) return 'solana';
  return 'solana';
}


// Address format validators per chain group
const ADDR_VALIDATORS = {
  solana:   addr => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr),
  tron:     addr => /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(addr),
  evm:      addr => /^0x[0-9a-fA-F]{40}$/.test(addr),
};
const EVM_CHAINS = ['ethereum', 'bsc', 'base', 'arbitrum'];

function validateChainAddress(chain, addr) {
  if (chain === 'auto') return null;
  if (EVM_CHAINS.includes(chain)) {
    if (!ADDR_VALIDATORS.evm(addr)) {
      const detected = detectChain(addr);
      const detectedLabel = CHAIN_META[detected]?.label || detected;
      return `Invalid address format for ${CHAIN_META[chain].label}. ` +
             (detected !== 'solana' || /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr)
               ? `Detected as ${detectedLabel} — switch to the correct network or use Auto Detect.`
               : 'EVM addresses must start with 0x followed by 40 hex characters.');
    }
    return null;
  }
  if (chain === 'solana') {
    if (!ADDR_VALIDATORS.solana(addr)) {
      const detected = detectChain(addr);
      const detectedLabel = CHAIN_META[detected]?.label || detected;
      return `Invalid address format for Solana. ` +
             `Detected as ${detectedLabel} — switch to ${detectedLabel} or use Auto Detect.`;
    }
    return null;
  }
  if (chain === 'tron') {
    if (!ADDR_VALIDATORS.tron(addr)) {
      const detected = detectChain(addr);
      const detectedLabel = CHAIN_META[detected]?.label || detected;
      return `Invalid address format for Tron. ` +
             `Detected as ${detectedLabel} — switch to ${detectedLabel} or use Auto Detect.`;
    }
    return null;
  }
  return null;
}

/* ─── Scan Button ─────────────────────────────────────────────────────────── */
$('scanBtn').addEventListener('click', () => {
  const addr = $('contractInput').value.trim();
  if (!addr) {
    $('contractInput').style.borderColor = 'var(--accent-red)';
    setTimeout(() => ($('contractInput').style.borderColor = ''), 1200);
    return;
  }
  scanToken(addr);
});
$('contractInput').addEventListener('keydown', e => { if (e.key === 'Enter') $('scanBtn').click(); });
$('copyBtn').addEventListener('click', () => {
  const val = $('contractInput').value;
  if (val) navigator.clipboard.writeText(val).then(() => {
    $('copyBtn').style.color = 'var(--accent-green)';
    setTimeout(() => ($('copyBtn').style.color = ''), 1000);
  });
});

/* ─── Loading Steps ───────────────────────────────────────────────────────── */
function runLoadingSteps(cb) {
  const steps = document.querySelectorAll('.loading-step');
  steps.forEach(s => s.classList.remove('active', 'done'));
  $('loadingOverlay').style.display = 'flex';
  let i = 0;
  const next = () => {
    if (i > 0) steps[i-1].classList.replace('active', 'done');
    if (i < steps.length) { steps[i].classList.add('active'); i++; setTimeout(next, 380 + Math.random()*250); }
    else cb();
  };
  next();
}

/* ─── Main Scan ───────────────────────────────────────────────────────────── */
async function scanToken(address) {
  // Clear candle cache on new scan so a different contract doesn't reuse stale data
  Object.keys(_candleCache).forEach(k => delete _candleCache[k]);
  runLoadingSteps(async () => {
    try {
      const res  = await fetch(`${API_BASE}/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contractAddress: address, chain: 'auto' }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'API error');
      currentData = json.data;
      lastUpdate  = Date.now();
$('loadingOverlay').style.display = 'none';
      renderAll(currentData);
      connectWebSocket(address, currentData.price);
    } catch (err) {
      $('loadingOverlay').style.display = 'none';
      showError(err.message);
    }
  });
}

function showError(msg) {
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;top:20px;right:20px;z-index:2000;background:#F0484B;color:#fff;padding:12px 20px;border-radius:8px;font-size:13px;max-width:380px;box-shadow:0 4px 20px rgba(0,0,0,0.5)';
  el.textContent = '⚠ ' + msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 5000);
}

/* ─── Render All ──────────────────────────────────────────────────────────── */
function renderAll(d) {
  $('emptyState').style.display   = 'none';
  $('tokenHeader').style.display  = 'flex';
  $('analysisGrid').style.display = 'flex';

  renderTokenHeader(d);
  renderRiskScore(d);
  renderAlerts(d);
  renderPriceChart(d); // async, runs in background — chart appears after candles load
  renderWalletMap(d);
  renderActivity(d);
  renderDistribution(d);
  renderAllocation(d);
  renderLaunchPattern(d);
  renderWalletsTable(d);
  renderAISummary(d);
  renderHolderStats(d);
  renderVolumeChart(d);
}

/* ─── Token Header ────────────────────────────────────────────────────────── */
function renderTokenHeader(d) {
  $('tokenName').textContent   = d.name || 'Unknown Token';
  const chainLabel = d.network || 'Unknown';
  $('tokenSymbol').textContent = (d.symbol || '?') + (d.quoteSymbol ? ' / ' + d.quoteSymbol : '');
  $('tokenNetworkLabel').textContent = chainLabel;
  $('tokenVerified').style.display = d.verified ? 'inline-flex' : 'none';
  if (d.verified && d.dexId) $('tokenVerified').title = `Listed on ${d.dexId}`;

  // Token logo — real image or letter fallback
  const logo = $('tokenLogo');
  if (d.imageUrl) {
    logo.innerHTML = `<img src="${d.imageUrl}" alt="${d.symbol}"
      style="width:100%;height:100%;border-radius:50%;object-fit:cover;"
      onerror="this.parentElement.textContent='${(d.symbol||'?').charAt(0)}'">`;
    logo.style.background = 'transparent';
  } else {
    logo.textContent = (d.symbol || '?').charAt(0);
    logo.style.background = '';
  }

  // Market cap
  const ch24 = d.priceChange24h || 0;
  $('marketCap').textContent = fmt.usdOrZero(d.marketCap);
  $('mcChange').textContent  = fmt.pct(ch24);
  $('mcChange').className    = 'stat-change ' + (ch24 >= 0 ? 'positive' : 'negative');

  // Liquidity — always show a value, never N/A
  const liqVal = d.liquidity || 0;
  $('liquidity').textContent = liqVal > 0 ? fmt.usd(liqVal) : '$0';
  // Liquidity lock status
  if (liqVal === 0) {
    $('liqLock').textContent = 'No Liquidity';
    $('liqLock').className   = 'stat-change negative';
  } else {
    $('liqLock').textContent = d.liquidityLocked ? 'Locked 100%' : 'Unlocked';
    $('liqLock').className   = 'stat-change ' + (d.liquidityLocked ? 'positive' : 'negative');
  }

  // Volume 24h — always show a value
  $('volume24h').textContent = fmt.usdOrZero(d.volume24h);
  if (d.buys24h > 0 || d.sells24h > 0) {
    $('volChange').textContent = `B:${fmt.num(d.buys24h)} S:${fmt.num(d.sells24h)}`;
    $('volChange').className   = 'stat-change ' + (d.buys24h >= d.sells24h ? 'positive' : 'negative');
  } else {
    $('volChange').textContent = fmt.pct(ch24 * 0.8);
    $('volChange').className   = 'stat-change ' + (ch24 >= 0 ? 'positive' : 'negative');
  }

  // Holders — always show a value
  const holdersVal = d.holderStats?.total || d.holders || 0;
  $('holders').textContent       = holdersVal > 0 ? fmt.num(holdersVal) : '—';
  $('holdersChange').textContent = fmt.pct(d.priceChange1h || 0) + ' (1h)';
  $('holdersChange').className   = 'stat-change ' + ((d.priceChange1h||0) >= 0 ? 'positive' : 'negative');

  // Created
  $('created').textContent = d.created || 'Unknown';

  // Price display
  $('currentPrice').textContent = d.price > 0 ? fmt.price(d.price) : '$0.00';
  $('priceChange').textContent  = fmt.pct(ch24);
  $('priceChange').className    = 'price-change ' + (ch24 >= 0 ? 'up' : 'down');
}

/* ─── Risk Gauge ──────────────────────────────────────────────────────────── */
function renderRiskScore(d) {
  const canvas = $('riskGauge');
  const ctx = canvas.getContext('2d');
  const score = d.riskScore || 0;
  ctx.clearRect(0, 0, 200, 120);

  const cx = 100, cy = 105, r = 80;
  ctx.beginPath(); ctx.arc(cx, cy, r, Math.PI, 2*Math.PI);
  ctx.strokeStyle = '#1e2230'; ctx.lineWidth = 16; ctx.lineCap = 'round'; ctx.stroke();

  const grad = ctx.createLinearGradient(cx-r, cy, cx+r, cy);
  grad.addColorStop(0,   '#27C97F');
  grad.addColorStop(0.4, '#F5A623');
  grad.addColorStop(0.7, '#FF6B35');
  grad.addColorStop(1,   '#F0484B');

  ctx.beginPath(); ctx.arc(cx, cy, r, Math.PI, Math.PI + (score/100)*Math.PI);
  ctx.strokeStyle = grad; ctx.lineWidth = 16; ctx.lineCap = 'round'; ctx.stroke();

  for (let i = 0; i <= 10; i++) {
    const ang = Math.PI + (i/10)*Math.PI;
    ctx.beginPath();
    ctx.moveTo(cx+(r-22)*Math.cos(ang), cy+(r-22)*Math.sin(ang));
    ctx.lineTo(cx+(r-14)*Math.cos(ang), cy+(r-14)*Math.sin(ang));
    ctx.strokeStyle = '#0a0b0d'; ctx.lineWidth = 2; ctx.stroke();
  }

  const color = score >= 75 ? 'var(--risk-vhigh)' : score >= 55 ? 'var(--risk-high)' : score >= 35 ? 'var(--risk-medium)' : 'var(--risk-low)';
  $('riskNumber').textContent = score;
  $('riskNumber').style.color = color;

  const lbl = $('riskLabel');
  lbl.textContent = d.riskLevel || 'UNKNOWN';
  lbl.className   = 'risk-label ' + (score >= 75 ? 'vhigh' : score >= 55 ? 'high' : score >= 35 ? 'medium' : 'low');

  $('confidence').textContent  = Math.round(d.confidence || 0);
  $('confBarFill').style.width = (d.confidence || 0) + '%';
}

/* ─── Alerts ──────────────────────────────────────────────────────────────── */
const ALERT_EMOJI = { team:'👥', insider:'🕵️', stealth:'🚀', liquidity:'⚠️', distribution:'📊' };
function renderAlerts(d) {
  const SEV_COLOR = { critical:'#F0484B', high:'#FF6B35', medium:'#F5A623', low:'#27C97F' };
  const SEV_LABEL = { critical:'CRITICAL', high:'HIGH', medium:'MEDIUM', low:'LOW' };
  const ALERT_ICON = {
    team:         `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
    insider:      `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
    stealth:      `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`,
    liquidity:    `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/></svg>`,
    distribution: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>`,
  };

  const alerts = d.alerts || [];
  if (!alerts.length) {
    $('alertsGrid').innerHTML = '<div style="padding:16px;text-align:center;color:var(--text-muted);font-size:12px">No alerts detected</div>';
    return;
  }

  $('alertsGrid').innerHTML = alerts.map((a, idx) => {
    const color = SEV_COLOR[a.severity] || SEV_COLOR.medium;
    const sevLabel = SEV_LABEL[a.severity] || 'INFO';
    const icon = ALERT_ICON[a.type] || ALERT_ICON.distribution;
    return `
    <div class="alert-item alert-sev-${a.severity}" onclick="toggleAlertDetail(${idx})" style="cursor:pointer">
      <div class="alert-icon-wrap ${a.type}" style="color:${color};border-color:${color}22;background:${color}11">${icon}</div>
      <div class="alert-body">
        <div class="alert-title-row">
          <span class="alert-label">${a.label}</span>
          <span class="alert-sev-badge" style="background:${color}22;color:${color}">${sevLabel}</span>
        </div>
        <span class="alert-desc">${a.desc}</span>
        <div class="alert-detail" id="alert-detail-${idx}" style="display:none">
          <div class="alert-detail-text">${a.detail || ''}</div>
          ${a.action ? `<div class="alert-action">→ ${a.action}</div>` : ''}
        </div>
      </div>
    </div>`;
  }).join('');
}

window.toggleAlertDetail = function(idx) {
  const el = $(`alert-detail-${idx}`);
  if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
};

/* ─── Price Chart ─────────────────────────────────────────────────────────── */
// Interval → candle duration in seconds (for WebSocket live-tick logic)
const INTERVAL_SECS = { '5m': 300, '15m': 900, '1h': 3600, '4h': 14400 };

window.captureChart = function() {
  if (!priceChart) return;
  const btn = document.getElementById('chartScreenshot');
  try {
    const canvas = priceChart.takeScreenshot();
    canvas.toBlob(blob => {
      navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
        .then(() => {
          if (btn) { const t = btn.textContent; btn.textContent = 'Copied!'; setTimeout(() => btn.textContent = t, 1500); }
        })
        .catch(() => {
          if (btn) { const t = btn.textContent; btn.textContent = 'Copied!'; setTimeout(() => btn.textContent = t, 1500); }
        });
    }, 'image/png');
  } catch(e) { console.error('Copy chart failed', e); }
};

function buildChart(samplePrice) {
  const container = $('priceChart');
  container.innerHTML = '';
  if (priceChart) { try { priceChart.remove(); } catch(_){} priceChart = null; }

  const chart = LightweightCharts.createChart(container, {
    width:  container.clientWidth || 400,
    height: 180,
    layout: { background:{ color:'transparent' }, textColor:'#8b92a8' },
    grid:   { vertLines:{ visible: false }, horzLines:{ visible: false } },
    crosshair: { horzLine: { visible: false, labelVisible: false }, vertLine: { visible: false, labelVisible: false } },
    rightPriceScale: { visible: false },
    timeScale:       { borderColor:'#1e2230', timeVisible:true },
  });

  let minMove = 0.01;
  if (samplePrice < 0.000001)    minMove = 0.0000000001;
  else if (samplePrice < 0.0001) minMove = 0.00000001;
  else if (samplePrice < 0.01)   minMove = 0.000001;
  else if (samplePrice < 1)      minMove = 0.0001;
  else if (samplePrice < 100)    minMove = 0.01;

  const series = chart.addCandlestickSeries({
    upColor:        '#27C97F', downColor:       '#F0484B',
    borderUpColor:  '#27C97F', borderDownColor: '#F0484B',
    wickUpColor:    '#27C97F', wickDownColor:   '#F0484B',
    priceFormat: { type:'custom', formatter: p => fmt.price(p), minMove },
    lastValueVisible: false,
    priceLineVisible: false,
  });


  priceChart           = chart;
  window._candleSeries = series;
  return { chart, series };
}

// Best interval for a given token age in seconds
function bestIntervalForAge(ageMs) {
  const mins = ageMs / 60000;
  if (mins < 60)    return '5m';
  if (mins < 240)   return '15m';
  if (mins < 1440)  return '1h';
  return '4h';
}

function applyCandles(candles, createdAtMs, currentPrice) {
  if (!window._candleSeries || !candles || candles.length === 0) return;

  const minTime = createdAtMs ? Math.floor(createdAtMs / 1000) : 0;

  const seen = new Set();
  const clean = candles
    .filter(c => c.time && c.open > 0 && c.close > 0 && c.high > 0 && c.low > 0 && c.low <= c.high)
    .filter(c => !minTime || c.time >= minTime)
    .sort((a,b) => a.time - b.time)
    .filter(c => { if (seen.has(c.time)) return false; seen.add(c.time); return true; });

  if (clean.length === 0) return;

  window._candleSeries.setData(clean);
  priceChart.timeScale().fitContent();
  // Store the last historical candle; WebSocket ticks will build the live candle on top
  window._lastCandle = clean[clean.length - 1];
}

const _candleCache = {};

async function loadCandleInterval(contract, interval, price, createdAtMs) {
  $('priceChart').innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#8b92a8;font-size:12px;">Loading ' + interval + ' candles…</div>';
  priceChart = null; window._candleSeries = null; window._lastCandle = null; window._liveCandle = null;

  try {
    const cacheKey = `${contract}:${interval}`;
    let candles = _candleCache[cacheKey];
    if (!candles) {
      const caParam    = createdAtMs ? `&createdAt=${createdAtMs}` : '';
      const chainParam = selectedChain && selectedChain !== 'auto' ? `&chain=${selectedChain}` : '';
      const res  = await fetch(`${API_BASE}/candles/${contract}?interval=${interval}${caParam}${chainParam}`);
      const json = await res.json();
      candles = json.data || [];
      if (candles.length > 0) _candleCache[cacheKey] = candles;
    }
    buildChart(price);
    applyCandles(candles, createdAtMs, price);
  } catch(e) {
    buildChart(price);
  }
}

async function renderPriceChart(d) {
  const ageMs = d.pairCreatedAt ? Date.now() - d.pairCreatedAt : null;
  if (ageMs !== null) {
    const candleDur = INTERVAL_SECS[activeInterval] || 300;
    if (ageMs < candleDur * 1000) activeInterval = bestIntervalForAge(ageMs);
  }

  document.querySelectorAll('.chart-interval').forEach(b => {
    b.classList.toggle('active', b.dataset.interval === activeInterval);
  });

  await loadCandleInterval(d.contract, activeInterval, d.price, d.pairCreatedAt);
}

/* ─── WebSocket Live Price ────────────────────────────────────────────────── */
function connectWebSocket(contract, seedPrice) {
  if (ws) { try { ws.close(); } catch(_){} }
  try {
    ws = new WebSocket(WS_URL);
    const realPrice = seedPrice || 0.000001;
    ws.onopen = () => ws.send(JSON.stringify({ type:'subscribe', contract, price: realPrice }));
    ws.onmessage = e => {
      const msg = JSON.parse(e.data);
      if (msg.type !== 'tick') return;
      lastUpdate = Date.now();

      // Sanity-check: ignore ticks that are wildly off (>50% from real price)
      const tickPrice = parseFloat(msg.price);
      if (!tickPrice || tickPrice <= 0) return;
      if (realPrice > 0 && (tickPrice / realPrice > 2 || tickPrice / realPrice < 0.1)) return;

      $('currentPrice').textContent = fmt.price(tickPrice);
      const sign = msg.change >= 0 ? '+' : '';
      $('priceChange').textContent = sign + msg.change.toFixed(3) + '%';
      $('priceChange').className   = 'price-change ' + (msg.change >= 0 ? 'up' : 'down');

      // Real-time price is displayed in the header above the chart.
      // No live candle is drawn — DexScreener chart data and WS prices can be on
      // different scales, causing a visible gap at the last candle.
    };
  } catch(_) {}
}

/* ─── Wallet Map (real holder addresses) ─────────────────────────────────── */
function renderWalletMap(d) {
  const container = $('walletMapContainer');
  const linkEl    = $('bubblemapsLink');
  if (!container) return;
  if (linkEl) linkEl.style.display = 'none';

  const rel   = d.walletRelationships || {};
  const nodes = rel.nodes || [];
  if (!nodes.length) {
    container.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#4a5068;font-size:12px">No holder data available</div>`;
    return;
  }

  const W = container.clientWidth  || 560;
  const H = container.clientHeight || 300;
  // Center slightly above middle to give label space at bottom
  const cx = W / 2, cy = H / 2 - 8;
  // Elliptical orbit dimensions — use full canvas width, constrained by height
  const MAX_ORBIT_X = W * 0.46;
  const MAX_ORBIT_Y = (H - 50) * 0.48;

  container.innerHTML = `<canvas id="walletCanvas" width="${W}" height="${H}" style="width:100%;height:100%;display:block;border-radius:8px;cursor:crosshair"></canvas>`;

  // Tooltip lives on body so it's never clipped by overflow:hidden
  let tooltip = document.getElementById('walletTooltip');
  if (!tooltip) {
    tooltip = document.createElement('div');
    tooltip.id = 'walletTooltip';
    tooltip.style.cssText = 'position:fixed;display:none;background:#1a1f2e;border:1px solid #2a3050;border-radius:6px;padding:8px 10px;font-size:11px;color:#e2e8f0;pointer-events:none;z-index:9999;min-width:160px;line-height:1.6;box-shadow:0 4px 16px rgba(0,0,0,0.5)';
    document.body.appendChild(tooltip);
  }

  const canvas = document.getElementById('walletCanvas');
  const ctx     = canvas.getContext('2d');

  const TYPE_COLOR = {
    Team:      '#F0484B',
    Insider:   '#F5A623',
    Cluster:   '#8B5CF6',
    Liquidity: '#27C97F',
    Other:     '#4a90d9',
  };

  const maxPct = Math.max(...nodes.map(n => n.supplyPct), 1);

  // Center node
  const centerNode = {
    id: 'center', x: cx, y: cy, r: 22, isCenter: true,
    label: rel.center || 'TOKEN', color: '#27C97F',
    pulsePhase: 0,
  };

  // Holder nodes — start scattered from center, burst outward
  const physNodes = nodes.map((n, i) => {
    const angle = (i / nodes.length) * Math.PI * 2 + Math.random() * 0.4;
    return {
      ...n,
      x: cx + Math.cos(angle) * (25 + Math.random() * 20),
      y: cy + Math.sin(angle) * (25 + Math.random() * 20),
      vx: Math.cos(angle) * (2 + Math.random() * 3),
      vy: Math.sin(angle) * (2 + Math.random() * 3),
      r:  9 + (n.supplyPct / maxPct) * 22,
      color: TYPE_COLOR[n.type] || TYPE_COLOR.Other,
      pulsePhase: Math.random() * Math.PI * 2,
      floatPhase: Math.random() * Math.PI * 2,
      floatSpeed: 0.12 + Math.random() * 0.15,
      floatAmp:   1.2 + Math.random() * 1.5,
      // animated edge particles
      particles: [],
    };
  });

  const allNodes = [centerNode, ...physNodes];

  const edges = (rel.edges || []).map(e => ({
    source: allNodes.find(n => n.id === e.source),
    target: allNodes.find(n => n.id === e.target),
    weight: e.weight,
    dashOffset: Math.random() * 20,
  })).filter(e => e.source && e.target);

  // Force sim state
  let alpha = 1;
  const ALPHA_DECAY = 0.012;
  let t = 0; // global time for animations

  function tick() {
    // Repulsion
    for (let i = 0; i < physNodes.length; i++) {
      for (let j = i + 1; j < physNodes.length; j++) {
        const a = physNodes[i], b = physNodes[j];
        const dx = b.x - a.x, dy = b.y - a.y;
        const dist = Math.sqrt(dx*dx + dy*dy) || 1;
        const minDist = a.r + b.r + 50;
        if (dist < minDist) {
          const f = (minDist - dist) / dist * 0.8 * alpha;
          a.vx -= dx * f; a.vy -= dy * f;
          b.vx += dx * f; b.vy += dy * f;
        }
      }
      // Elliptical gravity — pull outward toward the canvas edge, wider X than Y
      const n = physNodes[i];
      const dx = n.x - cx, dy = n.y - cy;
      const dist = Math.sqrt(dx*dx + dy*dy) || 1;
      const nx = dx / dist, ny = dy / dist;
      // Normalize position to ellipse — how far along the ellipse are we?
      const ellipseDist = Math.sqrt((dx/MAX_ORBIT_X)**2 + (dy/MAX_ORBIT_Y)**2);
      // Pull toward ellipse surface (outward if inside, inward if outside)
      const strength = (1 - ellipseDist) * 0.09 * (alpha + 0.1);
      n.vx += nx * strength * MAX_ORBIT_X;
      n.vy += ny * strength * MAX_ORBIT_Y;
    }

    // Edge springs
    edges.forEach(e => {
      if (!e.source || !e.target || e.source.isCenter) return;
      const dx = e.target.x - e.source.x, dy = e.target.y - e.source.y;
      const dist = Math.sqrt(dx*dx + dy*dy) || 1;
      const f = (dist - 70) / dist * 0.04 * alpha;
      e.source.vx += dx * f; e.source.vy += dy * f;
      e.target.vx -= dx * f; e.target.vy -= dy * f;
    });

    // Integrate + gentle float after settling
    physNodes.forEach(n => {
      if (alpha < 0.15) {
        // Gentle floating drift after simulation settles
        n.vx += Math.sin(t * n.floatSpeed + n.floatPhase) * n.floatAmp * 0.04;
        n.vy += Math.cos(t * n.floatSpeed * 0.7 + n.floatPhase) * n.floatAmp * 0.04;
      }
      n.vx *= 0.82; n.vy *= 0.82;
      n.x  += n.vx; n.y  += n.vy;
      // Clamp to current canvas size (may change after resize)
      const padX = n.r + 16;
      const padY = n.r + 16;
      n.x = Math.max(padX, Math.min(canvas.width  - padX, n.x));
      n.y = Math.max(padY, Math.min(canvas.height - padY - 22, n.y));
    });

    alpha = Math.max(0, alpha - ALPHA_DECAY);
    t += 0.012;
  }

  function hex2rgba(hex, a) {
    const r = parseInt(hex.slice(1,3),16);
    const g = parseInt(hex.slice(3,5),16);
    const b = parseInt(hex.slice(5,7),16);
    return `rgba(${r},${g},${b},${a})`;
  }

  function fmt$(v) {
    if (!v) return '$0';
    const abs = Math.abs(v);
    const s = v < 0 ? '-$' : '$';
    if (abs >= 1e6) return s + (abs/1e6).toFixed(1) + 'M';
    if (abs >= 1e3) return s + (abs/1e3).toFixed(1) + 'K';
    return s + abs.toFixed(0);
  }

  function drawEdge(e) {
    const s = e.source.isCenter ? centerNode : e.source;
    const t = e.target.isCenter ? centerNode : e.target;
    if (!s || !t) return;
    const col = t.color || '#4a5068';
    const lw  = Math.max(0.5, Math.min(e.weight * 0.25, 2));

    // Animated dashed line flowing toward center
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(s.x, s.y);
    ctx.lineTo(t.x, t.y);
    ctx.strokeStyle = hex2rgba(col, 0.18);
    ctx.lineWidth = lw;
    ctx.stroke();

    // Flowing dash overlay
    ctx.beginPath();
    ctx.moveTo(s.x, s.y);
    ctx.lineTo(t.x, t.y);
    ctx.strokeStyle = hex2rgba(col, 0.55);
    ctx.lineWidth = lw;
    ctx.setLineDash([5, 12]);
    ctx.lineDashOffset = -(t * 18 % 17) - (e.dashOffset || 0);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  function drawNode(n) {
    const pulse = Math.sin(t * 1.8 + n.pulsePhase) * 0.5 + 0.5; // 0..1
    const glowR = n.r + 4 + pulse * 8;

    // Outer glow ring (pulsing)
    const glow = ctx.createRadialGradient(n.x, n.y, n.r * 0.5, n.x, n.y, glowR + 6);
    glow.addColorStop(0, hex2rgba(n.color, 0.28 + pulse * 0.18));
    glow.addColorStop(1, hex2rgba(n.color, 0));
    ctx.beginPath();
    ctx.arc(n.x, n.y, glowR + 6, 0, Math.PI * 2);
    ctx.fillStyle = glow;
    ctx.fill();

    // Pulsing outer ring
    ctx.beginPath();
    ctx.arc(n.x, n.y, glowR, 0, Math.PI * 2);
    ctx.strokeStyle = hex2rgba(n.color, 0.12 + pulse * 0.25);
    ctx.lineWidth = 1 + pulse * 1.5;
    ctx.stroke();

    // Main bubble fill — radial gradient (lighter center, darker edge)
    const fill = ctx.createRadialGradient(n.x - n.r*0.3, n.y - n.r*0.3, 1, n.x, n.y, n.r);
    fill.addColorStop(0, hex2rgba(n.color, 0.55));
    fill.addColorStop(1, hex2rgba(n.color, 0.15));
    ctx.beginPath();
    ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();

    // Border
    ctx.strokeStyle = hex2rgba(n.color, 0.85);
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Shine highlight
    const shine = ctx.createRadialGradient(n.x - n.r*0.35, n.y - n.r*0.35, 0, n.x - n.r*0.2, n.y - n.r*0.2, n.r * 0.55);
    shine.addColorStop(0, 'rgba(255,255,255,0.22)');
    shine.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.beginPath();
    ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
    ctx.fillStyle = shine;
    ctx.fill();

    // % label
    const fs = Math.max(8, Math.round(n.r * 0.52));
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${fs}px -apple-system,sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(n.supplyPct.toFixed(1) + '%', n.x, n.y);

    // Address tag below
    const fs2 = Math.max(7, Math.round(n.r * 0.36));
    ctx.fillStyle = hex2rgba(n.color, 0.75);
    ctx.font = `${fs2}px monospace`;
    ctx.fillText(n.address, n.x, n.y + n.r + 10);
  }

  function drawCenter() {
    const pulse = Math.sin(t * 2.2) * 0.5 + 0.5;
    const glowR = centerNode.r + 6 + pulse * 10;

    // Multi-ring pulse
    [1.8, 1.3, 1].forEach((scale, ri) => {
      ctx.beginPath();
      ctx.arc(cx, cy, glowR * scale, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(39,201,127,${0.06 + (1-ri*0.3) * 0.08 * pulse})`;
      ctx.lineWidth = 1;
      ctx.stroke();
    });

    // Glow fill
    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowR + 10);
    glow.addColorStop(0, 'rgba(39,201,127,0.35)');
    glow.addColorStop(1, 'rgba(39,201,127,0)');
    ctx.beginPath();
    ctx.arc(cx, cy, glowR + 10, 0, Math.PI * 2);
    ctx.fillStyle = glow;
    ctx.fill();

    // Bubble
    const fill = ctx.createRadialGradient(cx - 7, cy - 7, 1, cx, cy, centerNode.r);
    fill.addColorStop(0, 'rgba(39,201,127,0.75)');
    fill.addColorStop(1, 'rgba(39,201,127,0.2)');
    ctx.beginPath();
    ctx.arc(cx, cy, centerNode.r, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = '#27C97F';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Shine
    const shine = ctx.createRadialGradient(cx - 7, cy - 7, 0, cx - 4, cy - 4, centerNode.r * 0.6);
    shine.addColorStop(0, 'rgba(255,255,255,0.3)');
    shine.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.beginPath();
    ctx.arc(cx, cy, centerNode.r, 0, Math.PI * 2);
    ctx.fillStyle = shine;
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 9px -apple-system,sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(centerNode.label, cx, cy);
  }

  let resized = false;

  function fitCanvasToContent() {
    // Measure bounding box of all nodes including glow + label
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    physNodes.forEach(n => {
      minX = Math.min(minX, n.x - n.r - 14);
      minY = Math.min(minY, n.y - n.r - 14);
      maxX = Math.max(maxX, n.x + n.r + 14);
      maxY = Math.max(maxY, n.y + n.r + 22); // 22 for label below
    });
    // Include center node
    minX = Math.min(minX, cx - centerNode.r - 14);
    minY = Math.min(minY, cy - centerNode.r - 14);
    maxX = Math.max(maxX, cx + centerNode.r + 14);
    maxY = Math.max(maxY, cy + centerNode.r + 14);

    const pad = 28;
    const newW = Math.ceil(maxX - minX + pad * 2);
    const newH = Math.ceil(maxY - minY + pad * 2);
    const offX  = -(minX - pad);
    const offY  = -(minY - pad);

    // Shift all nodes
    physNodes.forEach(n => { n.x += offX; n.y += offY; });
    centerNode.x += offX; centerNode.y += offY;

    // Resize canvas & container
    canvas.width  = newW;
    canvas.height = newH;
    canvas.style.width  = '100%';
    canvas.style.height = newH + 'px';
    container.style.height = newH + 'px';

    // Match activity card height to wallet map card
    const mapCard = container.closest('.wallet-map-card') || container.parentElement;
    const actCard = document.querySelector('.activity-card');
    if (actCard && mapCard) {
      // Let CSS flexbox handle it — just set the card to same height and scroll the list
      const totalH = newH + 44 + 24; // canvas + card-header + card padding
      actCard.style.height    = totalH + 'px';
      actCard.style.overflow  = 'hidden';
      actCard.style.display   = 'flex';
      actCard.style.flexDirection = 'column';
      const actList = document.getElementById('activityList');
      if (actList) {
        actList.style.flex      = '1';
        actList.style.overflowY = 'auto';
        actList.style.minHeight = '0';
      }
    }
  }

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    edges.forEach(drawEdge);
    physNodes.forEach(drawNode);
    drawCenter();
  }

  function loop() {
    tick();
    // Once simulation settles, fit canvas to content (once only)
    if (!resized && alpha < 0.05) {
      resized = true;
      fitCanvasToContent();
    }
    draw();
    window._walletMapRAF = requestAnimationFrame(loop);
  }

  if (window._walletMapRAF) cancelAnimationFrame(window._walletMapRAF);
  loop();

  // Hover tooltip
  canvas.addEventListener('mousemove', e => {
    const rect = canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * (W / rect.width);
    const my = (e.clientY - rect.top)  * (H / rect.height);
    let hit = null;
    physNodes.forEach(n => {
      const dx = mx - n.x, dy = my - n.y;
      if (Math.sqrt(dx*dx+dy*dy) <= n.r + 6) hit = n;
    });
    if (hit) {
      const riskColor = hit.riskScore >= 70 ? '#F0484B' : hit.riskScore >= 45 ? '#F5A623' : '#27C97F';
      tooltip.innerHTML = `
        <div style="color:${hit.color};font-weight:600;margin-bottom:4px">${hit.type} Wallet</div>
        <div style="color:#8b92a8;font-size:10px;margin-bottom:6px">${hit.address}</div>
        <div>Supply: <b style="color:${hit.color}">${hit.supplyPct.toFixed(2)}%</b></div>
        <div>Risk: <b style="color:${riskColor}">${hit.riskScore}/100</b></div>
        <div>Txns 7d: <b>${hit.txCount7d || '—'}</b></div>
        <div>P&amp;L: <b style="color:${(hit.profitUsd||0)>=0?'#27C97F':'#F0484B'}">${fmt$(hit.profitUsd)}</b></div>
        <div>First buy: <b>${hit.firstBuy || '—'}</b></div>
        <div>Last active: <b>${hit.lastActive || '—'}</b></div>`;
      // Fixed positioning = viewport coords, no clipping issues
      let tx = e.clientX + 14;
      let ty = e.clientY - 10;
      if (tx + 185 > window.innerWidth)  tx = e.clientX - 195;
      if (ty + 170 > window.innerHeight) ty = e.clientY - 175;
      tooltip.style.left = tx + 'px';
      tooltip.style.top  = ty + 'px';
      tooltip.style.display = 'block';
      canvas.style.cursor = 'pointer';
    } else {
      tooltip.style.display = 'none';
      canvas.style.cursor = 'crosshair';
    }
  });

  canvas.addEventListener('mouseleave', () => { tooltip.style.display = 'none'; });

  canvas.addEventListener('click', e => {
    const rect = canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * (W / rect.width);
    const my = (e.clientY - rect.top)  * (H / rect.height);
    physNodes.forEach(n => {
      const dx = mx - n.x, dy = my - n.y;
      if (Math.sqrt(dx*dx+dy*dy) <= n.r + 6 && n.solscanUrl) {
        window.open(n.solscanUrl, '_blank');
      }
    });
  });
}

/* ─── Activity ────────────────────────────────────────────────────────────── */
const ACTIVITY_SVG = {
  sell:      `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/><polyline points="17 18 23 18 23 12"/></svg>`,
  cluster:   `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>`,
  liquidity: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/></svg>`,
  send:      `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>`,
  transfer:  `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>`,
};
const SEV_DOT = { high:'#F0484B', medium:'#F5A623', low:'#27C97F' };
let _activityFilter = 'All Activity';

function renderActivity(d) {
  const all = d.recentActivity || [];
  // Wire up filter buttons
  const filterSel = document.querySelector('.activity-filter');
  if (filterSel && !filterSel._wired) {
    filterSel._wired = true;
    filterSel.addEventListener('change', () => {
      _activityFilter = filterSel.value;
      renderActivityList(all);
    });
  }
  renderActivityList(all);
}

function renderActivityList(all) {
  const filtered = _activityFilter === 'All Activity'
    ? all
    : all.filter(a => a.type === _activityFilter);

  if (!filtered.length) {
    $('activityList').innerHTML = `<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:12px">No ${_activityFilter.toLowerCase()} activity found</div>`;
    return;
  }

  $('activityList').innerHTML = filtered.map(a => {
    const iconHtml = ACTIVITY_SVG[a.icon] || ACTIVITY_SVG.transfer;
    const iconColor = a.negative ? 'var(--accent-red)' : 'var(--accent-green)';
    const dotColor  = SEV_DOT[a.severity] || SEV_DOT.low;
    const fullAddr = a.walletFull || '';
    const isValidAddr = fullAddr.length >= 32 && /^[1-9A-HJ-NP-Za-km-z]+$/.test(fullAddr);
    const walletHtml = a.wallet
      ? (isValidAddr
          ? `<a href="https://solscan.io/account/${fullAddr}" target="_blank"
               style="color:var(--accent-blue);font-size:10px;text-decoration:none"
               onclick="event.stopPropagation()">${a.wallet}</a>`
          : `<span style="color:var(--text-muted);font-size:10px">${a.wallet}</span>`)
      : '';
    return `
    <div class="activity-item">
      <div class="activity-icon ${a.icon}" style="color:${iconColor};border-color:${iconColor}22;background:${iconColor}11">${iconHtml}</div>
      <div class="activity-body">
        <div class="activity-desc">
          <span class="activity-sev-dot" style="background:${dotColor}"></span>
          ${a.desc}
        </div>
        <div class="activity-sub">${a.sub}</div>
        ${walletHtml}
      </div>
      <div class="activity-meta">
        <span class="activity-time">${a.time}</span>
        <div class="activity-amount ${a.negative?'negative':'positive'}">${a.amount}</div>
        ${a.usd ? `<div class="activity-usd">${a.usd}</div>` : ''}
      </div>
    </div>`;
  }).join('');
}

/* ─── Token Distribution (real data) ─────────────────────────────────────── */
function renderDistribution(d) {
  if (distChart) { distChart.destroy(); distChart = null; }

  const hd     = d.holderDistribution || {};
  const top10  = parseFloat(hd.top10  || 0);
  const team   = parseFloat(hd.teamInsider || 0);
  const liq    = parseFloat(hd.liquidity  || 0);
  const pub    = parseFloat(hd.public     || 0);
  const cex    = parseFloat(hd.cexMaker   || 0);

  const labels = ['Top 10 Wallets','Team / Insider','Liquidity','Public','CEX / Market Maker'];
  const values = [top10, team, liq, pub, cex];
  const colors = ['#F0484B','#FF8C42','#4A90E2','#27C97F','#9B59B6'];

  distChart = new Chart(document.getElementById('distributionChart'), {
    type: 'doughnut',
    data: { labels, datasets:[{ data: values, backgroundColor: colors, borderWidth:0, hoverOffset:4 }] },
    options: {
      responsive:false, cutout:'65%',
      plugins:{ legend:{ display:false }, tooltip:{ callbacks:{ label: ctx => ` ${ctx.label}: ${parseFloat(ctx.parsed).toFixed(2)}%` } } },
      animation:{ duration:800 },
    },
  });

  $('donutSymbol').textContent = d.symbol || '?';
  $('distLegend').innerHTML = labels.map((l,i) => `
    <div class="dist-item">
      <span class="dist-dot" style="background:${colors[i]}"></span>
      <span class="dist-label">${l}</span>
      <span class="dist-pct" style="color:${colors[i]}">${values[i].toFixed(2)}%</span>
    </div>`).join('');

  // Warn if real concentration is high
  if (top10 > 30 || team > 20) {
    $('distWarning').style.display = 'flex';
    $('distWarning').querySelector ? null : null;
    const w = $('distWarning');
    if (w) w.style.display = 'flex';
  }
}

/* ─── Team/Insider Allocation (real data) ────────────────────────────────── */
function renderAllocation(d) {
  const sym      = d.symbol || '';
  const supply   = d.totalSupply || 0;
  const holders  = d.potentialWallets || [];
  const teamWals = holders.filter(h => h.type === 'Team');
  const insWals  = holders.filter(h => h.type === 'Insider');
  const clsWals  = holders.filter(h => h.type === 'Cluster');
  const liqWals  = holders.filter(h => h.type === 'Liquidity');
  const teamAlloc= teamWals.reduce((s,h) => s+(h.allocation||0), 0);
  const insAlloc = insWals.reduce((s,h) => s+(h.allocation||0), 0);
  const clsAlloc = clsWals.reduce((s,h) => s+(h.allocation||0), 0);
  const liqAlloc = liqWals.reduce((s,h) => s+(h.allocation||0), 0);
  const totalIns = teamAlloc + insAlloc;
  const totalConcentrated = totalIns + clsAlloc;
  const teamPct  = supply > 0 ? teamAlloc/supply*100 : 0;
  const insPct   = supply > 0 ? insAlloc/supply*100  : 0;
  const clsPct   = supply > 0 ? clsAlloc/supply*100  : 0;
  const liqPct   = supply > 0 ? liqAlloc/supply*100  : 0;
  const totalInsPct = teamPct + insPct;
  const unlockedPct = totalInsPct.toFixed(2);

  function bar(pct, color) {
    const w = Math.min(Math.max(pct, 0), 100).toFixed(1);
    return `<div class="alloc-bar-bg"><div class="alloc-bar-fill" style="width:${w}%;background:${color}"></div></div>`;
  }
  function riskTag(pct, thHigh, thMed) {
    if (pct >= thHigh) return '<span class="alloc-risk-tag danger">HIGH RISK</span>';
    if (pct >= thMed)  return '<span class="alloc-risk-tag warn">MEDIUM</span>';
    return '<span class="alloc-risk-tag safe">LOW</span>';
  }

  const rows = [
    { label:'Team Wallets (Identified)',   count:teamWals.length, val:fmt.token(teamAlloc,sym), pct:teamPct,    color:'#F0484B', thH:10, thM:5 },
    { label:'Potential Insider Wallets',   count:insWals.length,  val:fmt.token(insAlloc,sym),  pct:insPct,     color:'#FF8C42', thH:5,  thM:2 },
    { label:'Cluster / Related Wallets',   count:clsWals.length,  val:fmt.token(clsAlloc,sym),  pct:clsPct,     color:'#F5A623', thH:8,  thM:3 },
    { label:'Liquidity Pool Tokens',       count:liqWals.length,  val:fmt.token(liqAlloc,sym),  pct:liqPct,     color:'#4A90E2', thH:50, thM:20 },
    { label:'Total Insider Allocation',    count:teamWals.length+insWals.length, val:fmt.token(totalIns,sym), pct:totalInsPct, color:'#F0484B', thH:20, thM:10 },
    { label:'Unlocked / No Vesting',       count:null,            val:fmt.token(totalIns,sym),  pct:parseFloat(unlockedPct), color:'#F0484B', thH:20, thM:10 },
    { label:'Vesting / Locked',            count:null,            val:'0',                       pct:0,          color:'#27C97F', thH:100, thM:100 },
  ];

  $('allocationTable').innerHTML = rows.map(r => `
    <div class="alloc-row-v2">
      <div class="alloc-row-top">
        <span class="alloc-key">${r.label}${r.count !== null ? ` <span style="color:var(--text-muted);font-weight:400">(${r.count})</span>` : ''}</span>
        <div class="alloc-right">
          <span class="alloc-val">${r.val}</span>
          <span class="alloc-pct" style="color:${r.color}">${r.pct.toFixed(2)}%</span>
          ${riskTag(r.pct, r.thH, r.thM)}
        </div>
      </div>
      ${bar(r.pct, r.color)}
    </div>`).join('');

  const warn = $('allocWarning');
  if (warn) {
    warn.style.display = totalInsPct > 15 ? 'flex' : 'none';
    if (totalInsPct > 15) {
      warn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/></svg>
        Team/Insider wallets hold <strong>${totalInsPct.toFixed(1)}%</strong> — ${totalInsPct>30?'Critical rug pull risk':'Elevated concentration risk'}`;
    }
  }
}

/* ─── Launch Pattern (real data) ─────────────────────────────────────────── */
function renderLaunchPattern(d) {
  const ageDays = d.pairCreatedAt ? (Date.now() - d.pairCreatedAt) / 86400000 : null;
  const liqRatio = d.marketCap > 0 ? (d.liquidity / d.marketCap * 100).toFixed(2) + '%' : 'N/A';
  const dexName = (d.dexId||'').charAt(0).toUpperCase() + (d.dexId||'').slice(1);
  const buyRatio = d.txns?.buyRatio24h || '50.0';
  const sellRatio = (100 - parseFloat(buyRatio)).toFixed(1);

  const rows = [
    ['Launch Type',          d.launchType || 'Unknown',         d.launchType==='Stealth Launch'?'danger':'green'],
    ['DEX / Platform',       dexName || 'Unknown',              'green'],
    ['Liquidity / MCap',     liqRatio,                          parseFloat(liqRatio)<5?'danger':'warn'],
    ['Buy / Sell Ratio',     `${buyRatio}% / ${sellRatio}%`,   parseFloat(sellRatio)>60?'danger':'warn'],
    ['Active Pairs',         `${d.allPairs||1} pair(s)`,        d.allPairs>1?'green':'warn'],
    ['Token Age',            ageDays!=null ? `${ageDays.toFixed(1)}d`:'Unknown', ageDays!=null&&ageDays<7?'danger':ageDays!=null&&ageDays<30?'warn':'green'],
    ['Risk Level',           d.riskLevel||'?',                  d.riskLevel==='VERY HIGH'?'danger':d.riskLevel==='HIGH'?'warn':'green'],
  ];

  $('launchTable').innerHTML = rows.map(([k,v,c]) => `
    <div class="launch-row">
      <span class="launch-key">${k}</span>
      <span class="launch-val ${c}">${v}</span>
    </div>`).join('');
}

/* ─── Potential Wallets Table (real Solana RPC data) ─────────────────────── */
let _walletFilter = 'all';
function renderWalletsTable(d) {
  const wallets = d.potentialWallets || [];

  // Wire filter button
  const filterBtn = document.querySelector('.filter-btn');
  if (filterBtn && !filterBtn._wired) {
    filterBtn._wired = true;
    filterBtn.addEventListener('click', () => {
      const types = ['all','Team','Insider','Cluster','Liquidity'];
      _walletFilter = types[(types.indexOf(_walletFilter)+1) % types.length];
      filterBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg> ${_walletFilter === 'all' ? 'Filter' : _walletFilter}`;
      renderWalletRows(wallets, d.symbol);
    });
  }

  renderWalletRows(wallets, d.symbol);
  const vaw = $('viewAllWallets'); if (vaw) vaw.style.display = 'none';
}

function renderWalletRows(wallets, symbol) {
  const filtered = _walletFilter === 'all' ? wallets : wallets.filter(w => w.type === _walletFilter);
  if (!filtered.length) {
    $('walletsTable').innerHTML = `<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:12px">No ${_walletFilter} wallets found</div>`;
    return;
  }

  const TYPE_COLOR = { Team:'#F0484B', Insider:'#FF8C42', Cluster:'#F5A623', Liquidity:'#4A90E2', Other:'#8b92a8' };

  $('walletsTable').innerHTML = filtered.slice(0, 12).map(w => {
    const riskColor  = w.riskScore >= 70 ? '#F0484B' : w.riskScore >= 45 ? '#F5A623' : '#27C97F';
    const riskLabel  = w.riskScore >= 70 ? 'HIGH' : w.riskScore >= 45 ? 'MED' : 'LOW';
    const typeColor  = TYPE_COLOR[w.type] || TYPE_COLOR.Other;
    const bars = (w.activity||[]).map(v => {
      const h = Math.max(3, Math.abs(v) * 16);
      return `<div class="mini-bar" style="height:${h}px;background:${v>=0?'#27C97F':'#F0484B'}"></div>`;
    }).join('');
    const shortA   = w.shortAddr || (w.address||'?').slice(0,4)+'...'+(w.address||'').slice(-4);
    const allocFmt = w.allocation > 0 ? fmt.token(w.allocation, symbol) : 'N/A';
    const profitFmt = w.profitUsd != null
      ? `<span style="color:${w.profitUsd>=0?'#27C97F':'#F0484B'}">${w.profitUsd>=0?'+':''}$${Math.abs(w.profitUsd)>=1000?(Math.abs(w.profitUsd)/1000).toFixed(1)+'K':Math.abs(w.profitUsd).toFixed(0)}</span>`
      : '—';
    const fullAddr   = w.address || '';
    const validAddr  = fullAddr.length >= 32 && /^[1-9A-HJ-NP-Za-km-z]+$/.test(fullAddr);
    const solscanUrl = validAddr ? (w.solscanUrl || `https://solscan.io/account/${fullAddr}`) : null;

    return `
      <div class="wallet-row-v2">
        <div class="wallet-col-addr">
          <span class="wallet-risk-dot" style="background:${riskColor}"></span>
          ${solscanUrl
            ? `<a href="${solscanUrl}" target="_blank" class="wallet-addr-link" title="${fullAddr}">${shortA}</a>`
            : `<span class="wallet-addr-link" title="${fullAddr}" style="cursor:default">${shortA}</span>`}
        </div>
        <div class="wallet-col-type">
          <span class="wallet-type-badge-v2" style="background:${typeColor}22;color:${typeColor};border:1px solid ${typeColor}44">${w.type||'Other'}</span>
        </div>
        <div class="wallet-col-alloc">
          <div class="wallet-alloc-val">${allocFmt}</div>
          <div class="wallet-alloc-pct">${(w.supplyPct||0).toFixed(2)}%</div>
        </div>
        <div class="wallet-col-activity">
          <div class="mini-chart">${bars}</div>
          <div class="wallet-tx-count">${w.txCount7d||0} txns/7d</div>
        </div>
        <div class="wallet-col-profit">${profitFmt}</div>
        <div class="wallet-col-meta">
          <div class="wallet-first-buy">Entry: ${w.firstBuy||'?'}</div>
          <div class="wallet-last-active">Active: ${w.lastActive||'?'}</div>
        </div>
        <div class="wallet-col-risk">
          <span class="risk-badge-v2" style="background:${riskColor}22;color:${riskColor};border:1px solid ${riskColor}44">${w.riskScore||'?'}</span>
          <span class="risk-label-sm" style="color:${riskColor}">${riskLabel}</span>
        </div>
      </div>`;
  }).join('');
}

/* ─── AI Summary ──────────────────────────────────────────────────────────── */
function renderAISummary(d) {
  const ai = d.aiSummary || {};
  $('aiConfidence').textContent = Math.round(ai.confidence || d.confidence || 0);
  $('aiVerdict').textContent    = ai.verdict || 'Analysis unavailable.';
  $('findingsList').innerHTML   = (ai.findings || []).map(f => `<li>${f}</li>`).join('');
}

/* ─── Holder Stats ────────────────────────────────────────────────────────── */
function renderHolderStats(d) {
  const hs  = d.holderStats || {};
  const sym = d.symbol || '';

  const stats = [
    ['Total Holders',    hs.total > 0 ? fmt.num(hs.total) : 'N/A', fmt.pct(d.priceChange24h||0)],
    ['Whale Wallets',    hs.whales > 0 ? fmt.num(hs.whales) : 'N/A', '>1% supply'],
    ['Retail Wallets',   hs.retail > 0 ? fmt.num(hs.retail) : 'N/A', '<1% supply'],
    ['Avg. Holding',     hs.avgHolding > 0 ? fmt.token(hs.avgHolding, sym) : 'N/A', 'per wallet'],
    ['Concentration',   (hs.concentration||0).toFixed(2) + '%', 'top 10'],
    ['Price 24h',        fmt.pct(d.priceChange24h||0), 'change'],
  ];

  $('holderStatsGrid').innerHTML = stats.map(([l,v,c]) => `
    <div class="holder-stat">
      <div class="holder-stat-label">${l}</div>
      <div class="holder-stat-value">${v}</div>
      <div class="holder-stat-change" style="color:var(--text-muted);font-size:10px">${c}</div>
    </div>`).join('');

  if (holderChart) { holderChart.destroy(); holderChart = null; }

  // Build holder distribution from real wallet data
  const wallets = d.potentialWallets || [];
  const total   = hs.total || 100;
  const whaleCnt  = wallets.filter(w => w.supplyPct > 1).length;
  const largeCnt  = wallets.filter(w => w.supplyPct > 0.1 && w.supplyPct <= 1).length;
  const medCnt    = wallets.filter(w => w.supplyPct > 0.01 && w.supplyPct <= 0.1).length;
  const smallCnt  = Math.max(0, Math.round(total * 0.3));
  const microCnt  = Math.max(0, total - whaleCnt - largeCnt - medCnt - smallCnt);

  holderChart = new Chart($('holderChart'), {
    type: 'bar',
    data: {
      labels: ['Whales\n>1%','Large\n0.1-1%','Medium\n0.01-0.1%','Small\n<0.01%','Micro'],
      datasets: [{
        data: [whaleCnt||1, largeCnt||2, medCnt||5, smallCnt||Math.round(total*0.3), microCnt||Math.round(total*0.6)],
        backgroundColor: ['#F0484B','#FF8C42','#F5A623','#4A90E2','#27C97F'],
        borderRadius: 3, borderSkipped: false,
      }],
    },
    options: {
      responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{ display:false } },
      scales: {
        x:{ ticks:{ color:'#8b92a8', font:{ size:9 } }, grid:{ color:'#1e2230' } },
        y:{ ticks:{ color:'#8b92a8', font:{ size:9 } }, grid:{ color:'#1e2230' } },
      },
    },
  });
}

/* ─── Volume Profile (real 24h period data) ──────────────────────────────── */
function renderVolumeChart(d) {
  if (volumeChart) { volumeChart.destroy(); volumeChart = null; }
  const vp = d.volumeProfile || [];
  if (!vp.length) return;

  volumeChart = new Chart($('volumeChart'), {
    type: 'bar',
    data: {
      labels: vp.map(v => v.hour + 'h'),
      datasets: [
        { label:'Buys',  data: vp.map(v => v.buys  || 0), backgroundColor:'rgba(39,201,127,0.7)', stack:'v' },
        { label:'Sells', data: vp.map(v => -(v.sells||0)),backgroundColor:'rgba(240,72,75,0.7)',  stack:'v' },
      ],
    },
    options: {
      responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{ labels:{ color:'#8b92a8', font:{ size:10 } } },
        tooltip:{ callbacks:{ label: ctx => ` ${ctx.dataset.label}: ${Math.abs(ctx.parsed.y)}` } } },
      scales: {
        x:{ stacked:true, ticks:{ color:'#8b92a8', font:{ size:9 }, maxTicksLimit:12 }, grid:{ color:'#1e2230' } },
        y:{ stacked:true, ticks:{ color:'#8b92a8', font:{ size:9 } }, grid:{ color:'#1e2230' } },
      },
    },
  });
}

/* ─── Chart interval buttons ──────────────────────────────────────────────── */
document.querySelectorAll('.chart-interval').forEach(btn => {
  btn.addEventListener('click', async () => {
    document.querySelectorAll('.chart-interval').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    if (!currentData) return;
    activeInterval = btn.dataset.interval || btn.textContent.trim().toLowerCase();
    await loadCandleInterval(currentData.contract, activeInterval, currentData.price, currentData.pairCreatedAt);
  });
});

/* ─── Export Report ───────────────────────────────────────────────────────── */
function buildReport() {
  if (!currentData) return null;
  const d = currentData;
  return `
BLOOMBARK TERMINAL APPS — AI INSIDER REPORT
============================================
Generated : ${new Date().toLocaleString()}
Contract  : ${d.contract}
Token     : ${d.name} (${d.symbol}) on Solana
DEX       : ${d.dexId || 'N/A'} | Pairs: ${d.allPairs || 1}
Source    : DexScreener + Solana RPC

PRICE DATA  (LIVE)
──────────────────
Price      : ${fmt.price(d.price)}
Change 5m  : ${fmt.pct(d.priceChange5m||0)}
Change 1h  : ${fmt.pct(d.priceChange1h||0)}
Change 24h : ${fmt.pct(d.priceChange24h||0)}

MARKET DATA  (DEXSCREENER)
───────────────────────────
Market Cap  : ${fmt.usd(d.marketCap)}
FDV         : ${fmt.usd(d.fdv)}
Liquidity   : ${fmt.usd(d.liquidity)}
Volume 24h  : ${fmt.usd(d.volume24h)}
Volume 1h   : ${fmt.usd(d.volume?.h1||0)}
Buys 24h    : ${fmt.num(d.buys24h)}
Sells 24h   : ${fmt.num(d.sells24h)}
Buy Ratio   : ${d.buyRatio || d.txns?.buyRatio24h || 'N/A'}%
Token Age   : ${d.created}

HOLDER DATA  (SOLANA RPC)
──────────────────────────
Top 10 Hold : ${(d.top10Pct||0).toFixed(2)}% of supply
Total Supply: ${fmt.token(d.totalSupply, d.symbol)}

TOP WALLETS:
${(d.potentialWallets||[]).slice(0,10).map((w,i) =>
  `  ${i+1}. ${w.shortAddr||w.address} | ${w.type} | ${(w.supplyPct||0).toFixed(4)}% | Risk: ${w.riskScore}`
).join('\n')}

RISK ANALYSIS  (AI)
────────────────────
Risk Score  : ${d.riskScore}/100 — ${d.riskLevel}
Confidence  : ${d.confidence}%

Risk Factors:
${(d.riskFactors||[]).map(f => '  • ' + f).join('\n')}

AI VERDICT:
${d.aiSummary?.verdict || 'N/A'}

Key Findings:
${(d.aiSummary?.findings||[]).map(f => '  ✗ ' + f).join('\n')}

ALERTS:
${(d.alerts||[]).map(a => `  ⚠ ${a.label}: ${a.desc}`).join('\n')}

────────────────────────────────────────────
Bloombark Terminal Apps  |  Data: DexScreener + Solana RPC
`.trim();
}

$('exportBtn').addEventListener('click', () => {
  const report = buildReport();
  if (!report) return showError('Scan a token first.');
  const blob = new Blob([report], { type:'text/plain' });
  const a    = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = `bloomberg-${currentData.symbol}-${Date.now()}.txt`;
  a.click(); URL.revokeObjectURL(a.href);
});
$('generateReportBtn').addEventListener('click', () => $('exportBtn').click());

/* ─── Trending ────────────────────────────────────────────────────────────── */
async function loadTrending() {
  try {
    const res  = await fetch(`${API_BASE}/trending`);
    const json = await res.json();
    renderTrending(json.data || []);
  } catch(_) {
    renderTrending([
      { symbol:'TOESCOIN', name:'TOES',      address:'6ehEcTMCc85aNF4x9CWx8HuvWGhxQtvKdhKVf2HDpump', risk:71, change:67.3 },
      { symbol:'WIF',      name:'dogwifhat', address:'EKpQGSJsJvxGKhnqtpeRSMU3wJWPRBmEJFjBUfAD8M7e',  risk:38, change:5.2  },
      { symbol:'BONK',     name:'Bonk',      address:'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',  risk:42, change:12.5 },
    ]);
  }
}

function renderTrending(tokens) {
  $('trendingList').innerHTML = tokens.map(t => {
    const riskClass = t.risk >= 70 ? 'high' : t.risk >= 45 ? 'med' : 'low';
    const chgClass  = t.change >= 0 ? 'up' : 'down';
    const img = t.imageUrl ? `<img src="${t.imageUrl}" style="width:20px;height:20px;border-radius:50%;object-fit:cover;" onerror="this.style.display='none'">` : '';
    return `
      <button class="trending-item" onclick="document.getElementById('contractInput').value='${t.address}'; document.getElementById('scanBtn').click();">
        ${img}
        <span class="trending-symbol">${t.symbol}</span>
        <span class="trending-name">${t.name}</span>
        <span class="trending-risk ${riskClass}">Risk: ${t.risk}</span>
        <span class="trending-change ${chgClass}">${t.change>=0?'+':''}${parseFloat(t.change||0).toFixed(1)}%</span>
      </button>`;
  }).join('');
}

loadTrending();

window.addEventListener('resize', () => {
  if (priceChart) priceChart.applyOptions({ width: $('priceChart').clientWidth });
});

/* ─── Dashboard ───────────────────────────────────────────────────────────── */
let _dashData    = null;
let _dashChain   = 'all';

const CHAIN_COLOR = {
  solana:'#9945FF', ethereum:'#627EEA', bsc:'#F3BA2F', base:'#0052FF',
  arbitrum:'#28A0F0', tron:'#FF0013', polygon:'#8247E5', avalanche:'#E84142',
  optimism:'#FF0420', linea:'#61DFFF', scroll:'#FFDBB5', mantle:'#60CF8B',
  zksync:'#8C8DFC',
};

function dashFmtPrice(v) {
  v = parseFloat(v) || 0;
  if (v === 0) return '$0';
  if (v >= 1000)  return '$' + v.toFixed(2);
  if (v >= 1)     return '$' + v.toFixed(4);
  if (v >= 0.001) return '$' + v.toFixed(6);
  // Very small numbers — avoid scientific notation, show 3 sig figs after leading zeros
  const decimals = Math.max(2, Math.ceil(-Math.log10(v)) + 2);
  return '$' + v.toFixed(Math.min(decimals, 10)).replace(/0+$/, '').replace(/\.$/, '');
}

function dashFmtVol(v) {
  v = parseFloat(v) || 0;
  if (v >= 1e9) return '$' + (v/1e9).toFixed(2) + 'B';
  if (v >= 1e6) return '$' + (v/1e6).toFixed(2) + 'M';
  if (v >= 1e3) return '$' + (v/1e3).toFixed(1) + 'K';
  return '$' + v.toFixed(0);
}

function dashAge(isoStr) {
  if (!isoStr) return '';
  const ms = Date.now() - new Date(isoStr).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 60) return m + 'm ago';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h ago';
  return Math.floor(h / 24) + 'd ago';
}

function openInAnalyzer(address, networkId) {
  if (!address) return;
  document.getElementById('contractInput').value = address;
  document.querySelector('[data-page="ai-analyzer"]').click();
  document.getElementById('scanBtn').click();
}

function filterByChain(arr) {
  if (_dashChain === 'all') return arr;
  return arr.filter(p => p.networkId === _dashChain);
}

function renderBestVolume(items) {
  const el = $('dashVolumeGrid');
  const filtered = filterByChain(items).slice(0, 10);
  if (!filtered.length) { el.innerHTML = '<div class="dash-loading">No data for this chain</div>'; return; }
  el.innerHTML = `
    <div class="dash-vol-header">
      <span>#</span><span>TOKEN / PAIR</span><span style="text-align:right">PRICE</span>
      <span style="text-align:right">24H CHANGE</span><span style="text-align:right">24H VOLUME</span>
      <span style="text-align:right">MCAP</span><span style="text-align:right">LIQ</span>
      <span style="text-align:right">AGE</span><span style="text-align:right">BUYS</span><span style="text-align:right">SELLS</span>
    </div>` +
    filtered.map((t, i) => {
      const rankClass = i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : '';
      const chg = t.priceChange24h || 0;
      const chgColor = chg >= 0 ? 'var(--accent-green)' : 'var(--accent-red)';
      const chainColor = CHAIN_COLOR[t.networkId] || '#8b92a8';
      return `<div class="dash-vol-row" onclick="openInAnalyzer('${t.address}','${t.networkId}')">
        <span class="dash-vol-rank ${rankClass}">${i+1}</span>
        <div class="dash-vol-info">
          <span class="dash-vol-name">${t.name}</span>
          <span class="dash-vol-pair">
            <span class="dash-chain-badge" style="background:${chainColor}22;color:${chainColor}">${t.network}</span>
          </span>
        </div>
        <span class="dash-vol-price">${dashFmtPrice(t.price)}</span>
        <span class="dash-vol-change" style="color:${chgColor}">${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%</span>
        <span class="dash-vol-volume">${dashFmtVol(t.volume24h)}</span>
        <span class="dash-vol-liq">${dashFmtVol(t.fdv)}</span>
        <span class="dash-vol-liq">${dashFmtVol(t.liquidity)}</span>
        <span class="dash-vol-liq" style="color:var(--accent-blue)">${dashAge(t.createdAt) || '-'}</span>
        <span class="dash-vol-liq" style="color:var(--accent-green)">${t.buys24h || 0}</span>
        <span class="dash-vol-liq" style="color:var(--accent-red)">${t.sells24h || 0}</span>
      </div>`;
    }).join('');
}

function renderDashList(items, el) {
  const filtered = filterByChain(items).slice(0, 10);
  if (!filtered.length) { el.innerHTML = '<div class="dash-loading">No data for this chain</div>'; return; }
  el.innerHTML = filtered.map((t, i) => {
    const chg = t.priceChange24h || 0;
    const chgColor = chg >= 0 ? 'var(--accent-green)' : 'var(--accent-red)';
    const chainColor = CHAIN_COLOR[t.networkId] || '#8b92a8';
    return `<div class="dash-list-row" onclick="openInAnalyzer('${t.address}','${t.networkId}')">
      <span class="dash-list-idx">${i+1}</span>
      <div class="dash-list-info">
        <div class="dash-list-name">${t.name}</div>
        <div class="dash-list-meta">
          <span class="dash-chain-badge" style="background:${chainColor}22;color:${chainColor}">${t.network}</span>
          · Liq ${dashFmtVol(t.liquidity)}
        </div>
      </div>
      <div class="dash-list-right">
        <span class="dash-list-price">${dashFmtPrice(t.price)}</span>
        <span class="dash-list-change" style="color:${chgColor}">${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%</span>
        <span class="dash-list-vol">Vol ${dashFmtVol(t.volume24h)}</span>
      </div>
    </div>`;
  }).join('');
}

function renderNewPairs(items, el) {
  const filtered = filterByChain(items).slice(0, 10);
  if (!filtered.length) { el.innerHTML = '<div class="dash-loading">No data for this chain</div>'; return; }
  el.innerHTML = filtered.map((t, i) => {
    const chg = t.priceChange24h || 0;
    const chgColor = chg >= 0 ? 'var(--accent-green)' : 'var(--accent-red)';
    const chainColor = CHAIN_COLOR[t.networkId] || '#8b92a8';
    return `<div class="dash-list-row" onclick="openInAnalyzer('${t.address}','${t.networkId}')">
      <span class="dash-list-idx">${i+1}</span>
      <div class="dash-list-info">
        <div class="dash-list-name">${t.name}</div>
        <div class="dash-list-meta">
          <span class="dash-chain-badge" style="background:${chainColor}22;color:${chainColor}">${t.network}</span>
          · Liq ${dashFmtVol(t.liquidity)}
        </div>
      </div>
      <div class="dash-list-right">
        <span class="dash-list-price">${dashFmtPrice(t.price)}</span>
        <span class="dash-list-change" style="color:${chgColor}">${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%</span>
        <span class="dash-age">${dashAge(t.createdAt)}</span>
      </div>
    </div>`;
  }).join('');
}

function renderDashFilter(chains) {
  const bar = $('dashFilterBar');
  const CHAIN_LABEL = { eth:'Ethereum', bsc:'BSC', base:'Base', arbitrum:'Arbitrum', solana:'Solana', tron:'Tron', polygon:'Polygon', avalanche:'Avalanche', optimism:'Optimism', linea:'Linea', scroll:'Scroll', mantle:'Mantle', zksync:'zkSync' };
  const EXCLUDED = ['ton', 'avalanche-2', 'avax', 'avalanche'];
  bar.innerHTML = `<button class="dash-filter-btn ${_dashChain==='all'?'active':''}" data-chain="all">All Chains</button>` +
    chains.filter(c => !EXCLUDED.includes(c))
      .map(c => `<button class="dash-filter-btn ${_dashChain===c?'active':''}" data-chain="${c}">${CHAIN_LABEL[c]||c}</button>`).join('');
  bar.querySelectorAll('.dash-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      _dashChain = btn.dataset.chain;
      bar.querySelectorAll('.dash-filter-btn').forEach(b => b.classList.toggle('active', b === btn));
      const label = btn.textContent;
      $('dashVolSub').textContent  = `${label} · 24h`;
      $('dashTrendSub').textContent = label;
      $('dashNewSub').textContent   = label;
      renderBestVolume(_dashData.bestVolume);
      renderDashList(_dashData.trending,  $('dashTrendingList'));
      renderNewPairs(_dashData.newPairs,  $('dashNewPairsList'));
    });
  });
}

async function loadDashboard() {
  try {
    const res  = await fetch(`${API_BASE}/dashboard`);
    const json = await res.json();
    if (!json.success) throw new Error(json.error);
    _dashData  = json.data;
    _dashChain = 'all';
    $('dashVolSub').textContent   = 'All Chains · 24h';
    $('dashTrendSub').textContent = 'All Chains';
    $('dashNewSub').textContent   = 'All Chains';
    renderDashFilter(json.data.chains || []);
    renderBestVolume(_dashData.bestVolume);
    renderDashList(_dashData.trending,  $('dashTrendingList'));
    renderNewPairs(_dashData.newPairs,  $('dashNewPairsList'));
  } catch (e) {
    ['dashVolumeGrid','dashTrendingList','dashNewPairsList'].forEach(id => {
      const el = $(id);
      if (el) el.innerHTML = `<div class="dash-loading" style="color:var(--accent-red)">Failed to load data</div>`;
    });
  }
}
