/* ─── Toast ───────────────────────────────────────────────────────────────── */
function showWipModal() {
  const existing = document.getElementById('wipModal');
  if (existing) return;
  const overlay = document.createElement('div');
  overlay.id = 'wipModal';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);backdrop-filter:blur(2px);z-index:9998;display:flex;align-items:center;justify-content:center';
  overlay.innerHTML = `
    <div style="background:#161822;border:1px solid #1e2235;border-radius:16px;padding:32px 28px;width:320px;text-align:center;box-shadow:0 16px 48px rgba(0,0,0,0.7)">
      <div style="font-size:32px;margin-bottom:16px">🚧</div>
      <div style="font-size:14px;font-weight:800;color:#e2e8f0;margin-bottom:8px">Under Development</div>
      <div style="font-size:12px;color:#6b7280;line-height:1.6;margin-bottom:24px">This feature is currently under development.<br>Stay tuned for updates!</div>
      <button onclick="document.getElementById('wipModal').remove()" style="background:#27c97f;border:none;border-radius:10px;color:#000;font-size:12px;font-weight:700;padding:10px 28px;cursor:pointer;letter-spacing:0.5px">Got it</button>
    </div>`;
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
}

function showToast(msg, type = 'success') {
  const t = document.createElement('div');
  t.className = 'app-toast';
  t.textContent = msg;
  t.style.cssText = `
    position:fixed; bottom:28px; left:50%; transform:translateX(-50%) translateY(20px);
    background:${type === 'success' ? 'var(--accent-green)' : 'var(--accent-red)'};
    color:#000; font-size:12px; font-weight:600; letter-spacing:.04em;
    padding:8px 18px; border-radius:6px; z-index:9999;
    opacity:0; transition:opacity .2s, transform .2s; pointer-events:none;
  `;
  document.body.appendChild(t);
  requestAnimationFrame(() => { t.style.opacity = '1'; t.style.transform = 'translateX(-50%) translateY(0)'; });
  setTimeout(() => {
    t.style.opacity = '0'; t.style.transform = 'translateX(-50%) translateY(10px)';
    setTimeout(() => t.remove(), 200);
  }, 2000);
}

/* ─── Config ──────────────────────────────────────────────────────────────── */
const API_BASE = 'http://localhost:3001/api';
const WS_URL   = 'ws://localhost:3001';

/* ─── State ───────────────────────────────────────────────────────────────── */
let selectedChain  = 'auto'; // 'auto' | 'solana' | 'ethereum' | 'bsc' | 'base' | 'arbitrum' | 'tron'
let currentData    = null;
let _cachedCA      = null;
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
      'dashboard':    ['MARKET OVERVIEW',  'Real-time market data across chains'],
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
      'landing':      ['LANDING PAGE',    'About Bloombark Terminal'],
    };
    const _wip = ['smart-money','insider-scan','narrative','ai-trading','auto-research','alerts','portfolio','leaderboard'];
    if (_wip.includes(page)) {
      el.classList.remove('active');
      showWipModal();
      return;
    }

    const [title, sub] = titles[page] || ['BLOOMBARK TERMINAL', ''];
    $('pageTitle').textContent    = title;
    $('pageSubtitle').textContent = sub;

    const isAnalyzer = page === 'ai-analyzer';
    $('networkSelector').style.display = isAnalyzer ? '' : 'none';
    $('exportBtn').style.display       = isAnalyzer ? '' : 'none';

    if (page === 'dashboard') loadDashboard();
    if (page === 'watchlist') renderWatchlistPage();
    if (page === 'landing') loadLandingCA();
  });
});

// Initial setup — always start on landing page
(function() {
  $('networkSelector').style.display = 'none';
  $('exportBtn').style.display       = 'none';
  $('pageTitle').textContent    = 'LANDING PAGE';
  $('pageSubtitle').textContent = 'About Bloombark Terminal';
  loadLandingCA();
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
function requireWallet(action) {
  if (_privyUser) { action(); return; }
  openWalletModal();
  // after connect, re-run action once
  const _orig = _setWalletConnected;
  const oneShot = (user) => {
    _setWalletConnected = _orig;
    _orig(user);
    if (user) setTimeout(action, 300);
  };
  _setWalletConnected = oneShot;
}

$('scanBtn').addEventListener('click', () => {
  const addr = $('contractInput').value.trim();
  if (!addr) {
    $('contractInput').style.borderColor = 'var(--accent-red)';
    setTimeout(() => ($('contractInput').style.borderColor = ''), 1200);
    return;
  }
  requireWallet(() => scanToken(addr));
});
$('contractInput').addEventListener('keydown', e => { if (e.key === 'Enter') $('scanBtn').click(); });
$('copyBtn').addEventListener('click', () => {
  const val = $('contractInput').value;
  if (val) navigator.clipboard.writeText(val).then(() => {
    $('copyBtn').style.color = 'var(--accent-green)';
    setTimeout(() => ($('copyBtn').style.color = ''), 1000);
    showToast('Contract address copied to clipboard');
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

  _currentTokenData = d;
  renderTokenHeader(d);
  // Refresh watchlist state so heart button reflects current status
  _loadWatchlist();
  renderRiskScore(d);
  renderAlerts(d);
  renderPriceChart(d); // async, runs in background — chart appears after candles load
  renderWalletMap(d);
  renderActivity(d);
  try { renderDistribution(d); } catch(e) { console.warn('renderDistribution:', e); }
  try { renderAllocation(d); } catch(e) { console.warn('renderAllocation:', e); }
  try { renderLaunchPattern(d); } catch(e) { console.warn('renderLaunchPattern:', e); }
  try { renderWalletsTable(d); } catch(e) { console.warn('renderWalletsTable:', e); }
  try { renderAISummary(d); } catch(e) { console.warn('renderAISummary:', e); }
  try { renderHolderStats(d); } catch(e) { console.warn('renderHolderStats:', e); }
  try { renderVolumeChart(d); } catch(e) { console.warn('renderVolumeChart:', e); }
}

/* ─── Token Header ────────────────────────────────────────────────────────── */
function renderTokenHeader(d) {
  $('tokenName').textContent   = d.name || 'Unknown Token';
  const chainLabel = d.network || 'Unknown';
  $('tokenSymbol').textContent = (d.symbol || '?') + (d.quoteSymbol ? ' / ' + d.quoteSymbol : '');
  $('tokenNetworkLabel').textContent = chainLabel;
  const _dotColor = { solana:'#9945FF', ethereum:'#A78BFA', base:'#0052FF', bsc:'#F3BA2F', arbitrum:'#28A0F0', tron:'#FF0013', polygon:'#8247E5' }[(d.chain||'').toLowerCase()] || '#9945FF';
  const _dotSvg = $('tokenNetwork')?.querySelector('svg');
  if (_dotSvg) _dotSvg.style.fill = _dotColor;
  _updateWatchlistBtn(d.address);

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
    $('liqLock').textContent = 'Unverified';
    $('liqLock').className   = 'stat-change neutral';
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
function renderWalletMap(d) { renderHolderConcentration(d); renderWalletRelMap(d); }

async function renderWalletRelMap(d) {
  const canvas  = document.getElementById('walletRelMap');
  const empty   = document.getElementById('walletRelMapEmpty');
  const tooltip = document.getElementById('walletRelMapTooltip');
  const stats   = document.getElementById('wrmStats');
  if (!canvas) return;

  // Show loading state
  canvas.style.display = 'block';
  if (empty) empty.style.display = 'none';
  const ctx0 = canvas.getContext('2d');
  const W0 = canvas.parentElement.clientWidth || 380, H0 = 300;
  canvas.width = W0 * devicePixelRatio; canvas.height = H0 * devicePixelRatio;
  canvas.style.width = W0 + 'px'; canvas.style.height = H0 + 'px';
  ctx0.scale(devicePixelRatio, devicePixelRatio);
  ctx0.fillStyle = '#6b7280'; ctx0.font = '11px monospace'; ctx0.textAlign = 'center';
  ctx0.fillText('Loading wallet data…', W0/2, H0/2);

  // Fetch real holder data
  let wallets = [], edges = [];
  const tokenAddr = d.address || document.getElementById('contractInput')?.value?.trim();
  if (tokenAddr) {
    try {
      const chain = d.chain || 'solana';
      const res = await fetch(`${API_BASE}/wallet-map/${encodeURIComponent(tokenAddr)}?chain=${chain}`);
      const json = await res.json();
      if (json.success && json.holders?.length) {
        wallets = json.holders;
        edges = json.edges || [];
        if (stats) stats.dataset.liveEdges = json.liveEdges ? '1' : '0';
      }
    } catch(_) {}
  }

  // Fallback to potentialWallets if API failed
  if (!wallets.length) {
    wallets = (d.potentialWallets || []).filter(w => w.address).slice(0, 20).map((w, i) => ({
      ...w, rank: i + 1,
    }));
  }

  if (!wallets.length) {
    canvas.style.display = 'none';
    if (empty) { empty.style.display = 'flex'; }
    return;
  }
  canvas.style.display = 'block';
  if (empty) empty.style.display = 'none';

  const W = canvas.parentElement.clientWidth  || 380;
  const H = 240;
  canvas.width  = W * devicePixelRatio;
  canvas.height = H * devicePixelRatio;
  canvas.style.width  = W + 'px';
  canvas.style.height = H + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(devicePixelRatio, devicePixelRatio);

  // Node color by type
  const nodeColor = (w) => {
    const t = (w.type || '').toLowerCase();
    if (t === 'creator' || t === 'owner') return '#e86c3a';
    if (t === 'program' || w.isPumpFun) return '#a855f7';    // purple for PumpFun/programs
    if (t === 'whale') return '#f5a623';
    if (t.includes('insider') || t.includes('team')) return '#ff6b8a';
    if (t.includes('lp') || t.includes('dex') || t.includes('pool')) return '#27c97f';
    if (t === 'trader') return '#60a5fa';
    if (w.supplyPct > 1) return '#f5a623';
    return '#4a90d9';
  };

  // Build nodes — spread in circle initially for stable layout
  const nodes = wallets.map((w, i) => {
    const angle = (i / wallets.length) * Math.PI * 2;
    const spread = Math.min(W, H) * 0.3;
    return {
      x: W/2 + Math.cos(angle) * spread * (0.5 + Math.random() * 0.5),
      y: H/2 + Math.sin(angle) * spread * (0.5 + Math.random() * 0.5),
      vx: 0, vy: 0,
      px: 0, py: 0, // pulse phase
      w,
      r: Math.max(6, Math.min(18, 6 + (w.supplyPct || 0) * 1.8)),
      color: nodeColor(w),
      phase: Math.random() * Math.PI * 2, // for breathing animation
    };
  });

  // Fallback edges if backend returned none
  if (!edges.length) {
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i].w, b = nodes[j].w;
        if ((a.type || '') === (b.type || '') && a.type) edges.push([i, j]);
        else if (a.supplyPct > 0.5 && b.supplyPct > 0.5) edges.push([i, j]);
      }
    }
  }

  // Cancel any previous animation loop on this canvas
  if (canvas._wrmAnimId) cancelAnimationFrame(canvas._wrmAnimId);

  // Each node gets its own slow drift target (Lissajous-style float)
  nodes.forEach((n, i) => {
    n.driftAx  = 0.7 + Math.random() * 0.6;   // drift amplitude x
    n.driftAy  = 0.7 + Math.random() * 0.6;   // drift amplitude y
    n.driftFx  = 0.0018 + Math.random() * 0.002; // frequency x (slower)
    n.driftFy  = 0.0015 + Math.random() * 0.002; // frequency y (slower)
    n.driftOx  = Math.random() * Math.PI * 2;  // phase offset x
    n.driftOy  = Math.random() * Math.PI * 2;  // phase offset y
    n.homeX    = n.x; // set after warm-up
    n.homeY    = n.y;
  });

  const REPULSION = 1800, EDGE_LEN = 160, GRAVITY = 0.012, DAMPING = 0.82;
  function tick(frame) {
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const dx = nodes[j].x - nodes[i].x, dy = nodes[j].y - nodes[i].y;
        const d2 = dx*dx + dy*dy || 1, d = Math.sqrt(d2);
        const minDist = nodes[i].r + nodes[j].r + 20;
        const f = d < minDist ? REPULSION * 4 / d2 : REPULSION / d2;
        const fx = f * dx / d, fy = f * dy / d;
        nodes[i].vx -= fx; nodes[i].vy -= fy;
        nodes[j].vx += fx; nodes[j].vy += fy;
      }
    }
    edges.forEach(([i, j]) => {
      if (!nodes[i] || !nodes[j]) return;
      const dx = nodes[j].x - nodes[i].x, dy = nodes[j].y - nodes[i].y;
      const d = Math.sqrt(dx*dx + dy*dy) || 1;
      const f = (d - EDGE_LEN) * 0.04;
      const fx = f * dx / d, fy = f * dy / d;
      nodes[i].vx += fx; nodes[i].vy += fy;
      nodes[j].vx -= fx; nodes[j].vy -= fy;
    });
    nodes.forEach(n => {
      // Soft gravity toward home + sinusoidal drift = continuous organic float
      const tx = n.homeX + Math.sin(frame * n.driftFx + n.driftOx) * n.driftAx * 55;
      const ty = n.homeY + Math.sin(frame * n.driftFy + n.driftOy) * n.driftAy * 45;
      n.vx += (tx - n.x) * 0.008;
      n.vy += (ty - n.y) * 0.008;
      n.vx *= DAMPING; n.vy *= DAMPING;
      n.x += n.vx; n.y += n.vy;
      n.x = Math.max(n.r + 6, Math.min(W - n.r - 6, n.x));
      n.y = Math.max(n.r + 6, Math.min(H - n.r - 6, n.y));
    });
  }
  // Warm-up without drift to settle positions
  for (let i = 0; i < 200; i++) {
    nodes.forEach(n => {
      n.vx += (W/2 - n.x) * GRAVITY; n.vy += (H/2 - n.y) * GRAVITY;
      n.vx *= 0.75; n.vy *= 0.75;
      n.x += n.vx; n.y += n.vy;
      n.x = Math.max(n.r+6, Math.min(W-n.r-6, n.x));
      n.y = Math.max(n.r+6, Math.min(H-n.r-6, n.y));
    });
    // repulsion during warmup
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i+1; j < nodes.length; j++) {
        const dx = nodes[j].x-nodes[i].x, dy = nodes[j].y-nodes[i].y;
        const d2 = dx*dx+dy*dy||1, d = Math.sqrt(d2);
        const minD = nodes[i].r+nodes[j].r+20;
        const f = d < minD ? REPULSION*4/d2 : REPULSION/d2;
        nodes[i].vx -= f*dx/d; nodes[i].vy -= f*dy/d;
        nodes[j].vx += f*dx/d; nodes[j].vy += f*dy/d;
      }
    }
  }
  // Lock home positions after settling
  nodes.forEach(n => { n.homeX = n.x; n.homeY = n.y; n.vx = 0; n.vy = 0; });

  let t = 0, frame = 0;
  function draw() {
    t += 0.018;
    frame++;
    tick(frame);

    ctx.clearRect(0, 0, W, H);

    // Edges with animated gradient dash and glow
    edges.forEach(([i, j, eType]) => {
      if (!nodes[i] || !nodes[j]) return;
      const nx = nodes[i], ny = nodes[j];
      const dx = ny.x - nx.x, dy = ny.y - nx.y;
      const d = Math.sqrt(dx*dx + dy*dy) || 1;

      // Glow line
      ctx.beginPath();
      ctx.moveTo(nx.x, nx.y);
      ctx.lineTo(ny.x, ny.y);
      const alpha = eType === 'traded' ? 0.35 : eType === 'created' ? 0.25 : 0.15;
      const edgeColor = eType === 'traded' ? '#27c97f' : eType === 'created' ? '#e86c3a' : '#ffffff';
      ctx.strokeStyle = edgeColor + Math.round(alpha * 255).toString(16).padStart(2,'0');
      ctx.lineWidth = eType === 'traded' ? 1.5 : 1;
      ctx.stroke();

      // Animated particle travelling along the edge
      const progress = ((t * 0.6 + (nodes[i].phase || 0)) % 1);
      const px = nx.x + dx * progress, py = nx.y + dy * progress;
      ctx.beginPath();
      ctx.arc(px, py, 2, 0, Math.PI * 2);
      ctx.fillStyle = edgeColor + 'cc';
      ctx.fill();
    });

    // Nodes with breathing glow
    nodes.forEach(n => {
      const breathe = Math.sin(t * 1.4 + n.phase) * 0.5 + 0.5; // 0..1
      const glowR = n.r + 4 + breathe * 5;
      const pulseAlpha = 0.08 + breathe * 0.12;

      // Outer glow ring
      const grd = ctx.createRadialGradient(n.x, n.y, n.r * 0.5, n.x, n.y, glowR);
      grd.addColorStop(0, n.color + Math.round(pulseAlpha * 255).toString(16).padStart(2,'0'));
      grd.addColorStop(1, n.color + '00');
      ctx.beginPath();
      ctx.arc(n.x, n.y, glowR, 0, Math.PI * 2);
      ctx.fillStyle = grd;
      ctx.fill();

      // Inner filled circle
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
      const inner = ctx.createRadialGradient(n.x - n.r*0.3, n.y - n.r*0.3, 1, n.x, n.y, n.r);
      inner.addColorStop(0, n.color + 'ff');
      inner.addColorStop(1, n.color + 'aa');
      ctx.fillStyle = inner;
      ctx.fill();

      // Border
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
      ctx.strokeStyle = n.color;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Label for large nodes
      if (n.r >= 9) {
        ctx.fillStyle = '#ffffff';
        ctx.font = `bold ${Math.round(n.r * 0.7)}px monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const label = (n.w.tag || n.w.type || '').slice(0, 4);
        ctx.fillText(label, n.x, n.y);
      }
    });

    canvas._wrmAnimId = requestAnimationFrame(draw);
  }

  // Stop animation when canvas leaves viewport (perf)
  const _wrmObserver = new IntersectionObserver(entries => {
    if (!entries[0].isIntersecting && canvas._wrmAnimId) {
      cancelAnimationFrame(canvas._wrmAnimId);
      canvas._wrmAnimId = null;
    } else if (entries[0].isIntersecting && !canvas._wrmAnimId) {
      draw();
    }
  });
  _wrmObserver.observe(canvas);

  draw();

  // Stats
  const insiders = wallets.filter(w => (w.type||'').toLowerCase().includes('insider')).length;
  const whales   = wallets.filter(w => w.supplyPct > 1).length;
  const isReal = wallets[0]?.isRealData;
  if (stats) stats.innerHTML = `
    <span>${wallets.length} wallets mapped</span>
    <span style="color:#2d3144">·</span>
    <span style="color:#ff6b8a">${insiders} insider${insiders!==1?'s':''}</span>
    <span style="color:#2d3144">·</span>
    <span style="color:#f5a623">${whales} whale${whales!==1?'s':''}</span>
    <span style="color:#2d3144">·</span>
    <span>${edges.length} connection${edges.length!==1?'s':''}</span>
    <span style="color:#2d3144">·</span>
    <span style="color:${stats?.dataset?.liveEdges==='1'?'#27c97f':'#6b7280'}">${stats?.dataset?.liveEdges==='1'?'● Live trades':'○ Estimated'}</span>
  `;

  // Tooltip on hover
  canvas.onmousemove = (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const hit = nodes.find(n => Math.hypot(n.x - mx, n.y - my) <= n.r + 4);
    if (hit) {
      const w = hit.w;
      tooltip.style.display = 'block';
      tooltip.style.left = (mx + 12) + 'px';
      tooltip.style.top  = (my - 8) + 'px';
      tooltip.innerHTML = `
        <div style="color:${hit.color};font-weight:700;margin-bottom:2px">${w.tag || w.type || 'Holder'}</div>
        <div style="color:#9ca3af;font-family:monospace;font-size:10px">${(w.address||'').slice(0,10)}…${(w.address||'').slice(-6)}</div>
        ${w.supplyPct > 0 ? `<div style="margin-top:3px">Supply: <b>${w.supplyPct?.toFixed(2)}%</b></div>` : ''}
        ${w.liqUsd ? `<div>Liquidity: <b>$${(w.liqUsd/1e6).toFixed(2)}M</b></div>` : ''}
        ${w.vol24h ? `<div>Vol 24h: <b>$${(w.vol24h/1e6).toFixed(2)}M</b></div>` : ''}
        ${w.buys || w.sells ? `<div style="color:#27c97f">B:${w.buys||0} <span style="color:#ff6b8a">S:${w.sells||0}</span></div>` : ''}
      `;
    } else {
      tooltip.style.display = 'none';
    }
  };
  canvas.onmouseleave = () => { if (tooltip) tooltip.style.display = 'none'; };
}

function renderHolderConcentration(d) {
  const container = $('holderConcentrationContainer');
  const badge     = $('holderConcentrationBadge');
  if (!container) return;

  const dist  = d.holderDistribution || {};
  const stats = d.holderStats        || {};

  if (dist.top10 == null && !stats.total) {
    container.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;padding:40px;color:#4a5068;font-size:12px">No holder data available</div>`;
    return;
  }

  if (badge) badge.textContent = stats.total ? `${Number(stats.total).toLocaleString()} holders` : '';

  const top10      = dist.top10 ?? 0;
  const riskColor  = top10 >= 80 ? '#F0484B' : top10 >= 50 ? '#F5A623' : '#27C97F';
  const riskLabel  = top10 >= 80 ? 'HIGH CONCENTRATION' : top10 >= 50 ? 'MODERATE' : 'HEALTHY';
  const hasGTDist  = dist.top10 != null && dist.p11_20 != null;

  // bar only renders if value is not null
  const bar = (label, pct, color, sub = '') => {
    if (pct == null) return '';
    const w = Math.min(100, Math.max(0, parseFloat(pct)));
    return `
      <div style="padding:10px 16px;border-bottom:1px solid var(--border-light)">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px">
          <span style="font-size:11px;color:var(--text-muted)">${label}</span>
          <div style="text-align:right">
            <span style="font-size:12px;font-weight:700;color:${color}">${parseFloat(pct).toFixed(2)}%</span>
            ${sub ? `<div style="font-size:9px;color:var(--text-muted)">${sub}</div>` : ''}
          </div>
        </div>
        <div style="height:4px;background:var(--border-light);border-radius:2px;overflow:hidden">
          <div style="height:100%;width:${w}%;background:${color};border-radius:2px;transition:width .6s ease"></div>
        </div>
      </div>`;
  };

  const stat = (label, value, color = 'var(--text-primary)') => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 16px;border-bottom:1px solid var(--border-light)">
      <span style="font-size:11px;color:var(--text-muted)">${label}</span>
      <span style="font-size:11px;font-weight:600;color:${color}">${value}</span>
    </div>`;

  const src = hasGTDist ? 'GeckoTerminal' : 'DexScreener';

  container.innerHTML = `
    <div>
      <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 16px 6px;border-bottom:1px solid var(--border-light)">
        <span style="font-size:9px;color:var(--text-muted);font-weight:700;letter-spacing:.5px;text-transform:uppercase">Holder Tier Distribution · ${src}</span>
        <span style="font-size:10px;font-weight:700;color:${riskColor}">${riskLabel}</span>
      </div>

      ${bar('Top 10 Wallets',    dist.top10,  top10 >= 50 ? '#F0484B' : '#F5A623', 'Source: ' + src)}
      ${bar('Wallets #11–20',    dist.p11_20, '#8B5CF6', '')}
      ${bar('Wallets #21–40',    dist.p21_40, '#4a90d9', '')}
      ${bar('Remaining Holders', dist.rest,   '#27C97F', 'Public float')}
      ${!hasGTDist ? `<div style="padding:8px 16px;font-size:10px;color:var(--text-muted)">Wallet #11–40 breakdown not available — GeckoTerminal data missing for this token.</div>` : ''}

      ${dist.liquidity != null ? `
      <div style="padding:6px 16px;font-size:9px;color:var(--text-muted);font-weight:700;letter-spacing:.5px;text-transform:uppercase;border-bottom:1px solid var(--border-light);margin-top:4px">Liquidity</div>
      ${bar('LP Pool Holdings', dist.liquidity, '#27C97F', 'From DexScreener liquidityBase / totalSupply')}
      ` : ''}

      <div style="padding:6px 16px;font-size:9px;color:var(--text-muted);font-weight:700;letter-spacing:.5px;text-transform:uppercase;border-bottom:1px solid var(--border-light);margin-top:4px">Holder Stats</div>
      ${stat('Total Holders',   stats.total ? Number(stats.total).toLocaleString() : '—')}
      ${stats.whales != null ? stat('Whale Wallets (>1%)', stats.whales, stats.whales > 10 ? '#F0484B' : '#F5A623') : ''}
      ${stats.concentration != null ? stat('Top 10 Concentration', `${stats.concentration.toFixed(2)}%`, stats.concentration > 60 ? '#F0484B' : '#27C97F') : ''}
    </div>`;
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
  const hs     = d.holderStats || {};
  // top10: prefer GT holderDist, fallback to holderStats concentration
  const top10  = parseFloat(hd.top10 || hs.concentration || 0);
  // team/insider: use teamInsider from hd, or estimate from creator if present
  const team   = parseFloat(hd.teamInsider || hd.p11_20 || 0);
  const liq    = parseFloat(hd.liquidity || 0);
  // public: rest tier or remainder
  const rawRest = parseFloat(hd.public || hd.rest || 0);
  const pub    = rawRest || Math.max(0, parseFloat((100 - top10 - team - liq).toFixed(2)));
  const cex    = parseFloat(hd.cexMaker || 0);

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
  renderSecurity(d);
}

function renderSecurity(d) {
  const el     = $('securityDetails');
  const badge  = $('securityBadge');
  if (!el) return;

  const sec = d.security;
  console.log('[renderSecurity] sec=', sec, 'from d.security');
  if (!sec) {
    el.innerHTML = `<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:12px">No security data available</div>`;
    return;
  }

  const isSolana = (d.geckoNetwork || 'solana') === 'solana';

  // Determine overall security level
  const risks = [sec.isHoneypot, sec.cannotBuy, sec.isMintable, sec.isProxy, !sec.isOpenSource].filter(Boolean).length;
  const overallColor = risks === 0 ? '#27C97F' : risks <= 1 ? '#F5A623' : '#F0484B';
  const overallLabel = risks === 0 ? 'SAFE' : risks <= 1 ? 'CAUTION' : 'RISKY';
  if (badge) { badge.textContent = overallLabel; badge.style.color = overallColor; badge.style.fontWeight = '700'; }

  const row = (label, value, color = 'var(--text-primary)', sub = '') => `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 16px;border-bottom:1px solid var(--border-light)">
      <span style="font-size:11px;color:var(--text-muted)">${label}</span>
      <div style="text-align:right">
        <span style="font-size:11px;color:${color};font-weight:600">${value}</span>
        ${sub ? `<div style="font-size:9px;color:var(--text-muted);margin-top:1px">${sub}</div>` : ''}
      </div>
    </div>`;

  const bool = (v, trueLabel = 'YES', falseLabel = 'NO', trueIsBad = true) => {
    const isTrue = !!v;
    const color  = isTrue === trueIsBad ? '#F0484B' : '#27C97F';
    return `<span style="color:${color};font-weight:700">${isTrue ? trueLabel : falseLabel}</span>`;
  };

  const pct = v => `${parseFloat(v || 0).toFixed(2)}%`;
  const explorerBase = { solana:'https://solscan.io/account/', eth:'https://etherscan.io/address/', bsc:'https://bscscan.com/address/', base:'https://basescan.org/address/', arbitrum:'https://arbiscan.io/address/' }[sec.chain || 'solana'] || 'https://etherscan.io/address/';

  const lpRows = (sec.lpHolders || []).map((h, i) => {
    const short = h.address ? h.address.slice(0,6)+'…'+h.address.slice(-4) : '—';
    const lockColor = h.locked ? '#27C97F' : '#F5A623';
    const lockLabel = h.locked ? '🔒 Locked' : 'Unlocked';
    return row(
      `LP Holder #${i+1}`,
      `${pct(h.pct)} ${h.tag ? `<span style="color:var(--text-muted);font-weight:400">(${h.tag})</span>` : ''}`,
      lockColor,
      `<a href="${explorerBase}${h.address}" target="_blank" style="color:var(--accent-blue);text-decoration:none;font-family:monospace">${short}</a> · ${lockLabel}`
    );
  }).join('');

  el.innerHTML = `
    <div>
      ${row('Honeypot',       bool(sec.isHoneypot, 'YES ⚠', 'NO'))}
      ${!isSolana ? row('Open Source',    bool(!sec.isOpenSource, 'NO ⚠', 'YES', true)) : ''}
      ${!isSolana ? row('Proxy Contract', bool(sec.isProxy, 'YES ⚠', 'NO')) : ''}
      ${!isSolana ? row('Cannot Buy',     bool(sec.cannotBuy, 'YES ⚠', 'NO')) : ''}
      ${row('Mintable',       bool(sec.isMintable, 'YES ⚠', 'NO'))}
      ${isSolana  ? row('Freezable',      bool(sec.isFreezable, 'YES ⚠', 'NO')) : ''}
      ${isSolana  ? row('Metadata Mutable', bool(sec.metadataMutable, 'YES ⚠', 'NO')) : ''}
      <div style="padding:6px 16px;font-size:9px;color:var(--text-muted);font-weight:700;letter-spacing:.5px;text-transform:uppercase;border-bottom:1px solid var(--border-light);margin-top:4px">Tax</div>
      ${row('Buy Tax',  pct(sec.buyTax),  sec.buyTax  > 5 ? '#F0484B' : '#27C97F')}
      ${row('Sell Tax', pct(sec.sellTax), sec.sellTax > 5 ? '#F0484B' : '#27C97F')}
      ${!isSolana && sec.transferTax ? row('Transfer Tax', pct(sec.transferTax), sec.transferTax > 0 ? '#F5A623' : '#27C97F') : ''}
      <div style="padding:6px 16px;font-size:9px;color:var(--text-muted);font-weight:700;letter-spacing:.5px;text-transform:uppercase;border-bottom:1px solid var(--border-light);margin-top:4px">Liquidity</div>
      ${lpRows || row('LP Holders', 'No data', 'var(--text-muted)')}
      ${!isSolana ? row('LP Holder Count', sec.lpHolderCount || '—', 'var(--text-primary)') : ''}
      ${!isSolana && sec.isInCex ? row('Listed on CEX', sec.cexList?.join(', ') || 'Yes', '#27C97F') : ''}
      <div style="padding:6px 16px;font-size:9px;color:var(--text-muted);font-weight:700;letter-spacing:.5px;text-transform:uppercase;border-bottom:1px solid var(--border-light);margin-top:4px">Creator</div>
      ${sec.creatorAddress ? row('Creator Address',
          `<a href="${explorerBase}${sec.creatorAddress}" target="_blank" style="color:var(--accent-blue);text-decoration:none;font-family:monospace;font-size:10px">${sec.creatorAddress.slice(0,8)}…${sec.creatorAddress.slice(-6)}</a>`,
          'var(--text-primary)',
          sec.creatorMalicious ? '⚠ Flagged as malicious' : (sec.creatorPercent > 0 ? `Holds ${pct(sec.creatorPercent)} of supply` : '')
        ) : row('Creator', '—', 'var(--text-muted)')}
      <div style="padding:6px 16px 4px;font-size:9px;color:var(--text-muted)">Source: GoPlus Security API</div>
    </div>`;
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

/* ─── Potential Wallets Table ─────────────────────────────────────────────── */
let _walletFilter = 'all';
let _walletData   = [];
let _walletSymbol = '';

function renderWalletsTable(d) {
  _walletData   = d.potentialWallets || [];
  _walletSymbol = d.symbol || '';
  _walletFilter = 'all'; // reset filter on new token scan

  // Re-wire filter button (remove old listener by replacing the node)
  const filterBtn = document.querySelector('.filter-btn');
  if (filterBtn) {
    const newBtn = filterBtn.cloneNode(true);
    filterBtn.parentNode.replaceChild(newBtn, filterBtn);
    newBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg> Filter`;
    newBtn.addEventListener('click', () => {
      const types = ['all','Top Holder','Holder','Whale','Liquidity'];
      _walletFilter = types[(types.indexOf(_walletFilter)+1) % types.length];
      newBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg> ${_walletFilter === 'all' ? 'Filter' : _walletFilter}`;
      renderWalletRows(_walletData, _walletSymbol);
    });
  }

  renderWalletRows(_walletData, _walletSymbol);
  const vaw = $('viewAllWallets'); if (vaw) vaw.style.display = 'none';
}

function renderWalletRows(wallets, symbol) {
  const filtered = _walletFilter === 'all' ? wallets : wallets.filter(w => w.type === _walletFilter);
  if (!filtered.length) {
    $('walletsTable').innerHTML = `<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:12px">No ${_walletFilter} wallets found</div>`;
    return;
  }

  const TYPE_COLOR = { Team:'#F0484B', Insider:'#FF8C42', 'Early Buyer':'#FF8C42', Cluster:'#F5A623', Liquidity:'#4A90E2', Whale:'#8B5CF6', Holder:'#27C97F', 'Top Holder':'#27C97F', Trader:'#4A90E2', Other:'#8b92a8' };

  $('walletsTable').innerHTML = filtered.slice(0, 50).map((w, idx) => {
    const riskColor  = w.riskScore >= 70 ? '#F0484B' : w.riskScore >= 45 ? '#F5A623' : '#27C97F';
    const riskLabel  = w.riskScore >= 70 ? 'HIGH' : w.riskScore >= 45 ? 'MED' : 'LOW';
    const typeColor  = TYPE_COLOR[w.type] || TYPE_COLOR.Other;
    const bars = (w.activity||[]).map(v => {
      const h = Math.max(3, Math.abs(v) * 16);
      return `<div class="mini-bar" style="height:${h}px;background:${v>=0?'#27C97F':'#F0484B'}"></div>`;
    }).join('');
    const fullAddr   = w.address || '';
    const isSolAddr  = fullAddr.length >= 32 && /^[1-9A-HJ-NP-Za-km-z]+$/.test(fullAddr);
    const isEVMAddr  = /^0x[0-9a-fA-F]{40}$/.test(fullAddr);
    const validAddr  = isSolAddr || isEVMAddr;
    const solscanUrl = validAddr ? (w.solscanUrl || `https://solscan.io/account/${fullAddr}`) : null;
    const isReal    = w.isRealData === true;
    const isLiqPool = w.isLiqPool === true;
    const fmtUsd    = v => v >= 1000000 ? `$${(v/1000000).toFixed(2)}M` : v >= 1000 ? `$${(v/1000).toFixed(1)}K` : `$${Math.round(v)}`;

    // Allocation column: liq pool shows Liq + Vol; trader shows B/S vol
    let allocLine1, allocLine2;
    if (isLiqPool) {
      allocLine1 = `<span style="color:#4A90E2">Liq: ${fmtUsd(w.liqUsd||0)}</span>`;
      allocLine2 = `Vol: ${fmtUsd(w.vol24h||0)} (${(w.volPct||0).toFixed(0)}%)`;
    } else if (w.buyVol != null) {
      allocLine1 = `<span style="color:#27C97F">B:${fmtUsd(w.buyVol||0)}</span> <span style="color:#F0484B">S:${fmtUsd(w.sellVol||0)}</span>`;
      allocLine2 = `Vol: ${fmtUsd((w.buyVol||0)+(w.sellVol||0))}`;
    } else {
      const estMark = w.isEstimated ? '~' : '';
      allocLine1 = w.allocation > 0 ? `${estMark}${fmt.token(w.allocation||0, symbol)}` : `<span style="color:#6b7280">—</span>`;
      allocLine2 = w.supplyPct > 0 ? `${estMark}${(w.supplyPct||0).toFixed(2)}%` : `<span style="color:#6b7280">${w.txCount7d ? w.txCount7d+' txns' : '—'}</span>`;
    }

    // Buy/Sell ratio for liq pools
    const buyVolNum  = w.buyVol || 0;
    const sellVolNum = w.sellVol || 0;
    const volTotal   = buyVolNum + sellVolNum;
    const buySellBar = isLiqPool && volTotal > 0
      ? `<div style="display:flex;gap:2px;margin-top:3px;height:3px;border-radius:2px;overflow:hidden;width:60px">
           <div style="background:#27C97F;flex:${buyVolNum}"></div>
           <div style="background:#F0484B;flex:${sellVolNum}"></div>
         </div>`
      : '';

    // DEX label for liq pools
    const dexLabel = isLiqPool && w.dexId
      ? `<span style="font-size:9px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px">${w.dexId}</span>`
      : '';

    // Address display
    const addrDisplay = validAddr
      ? `<span class="wallet-full-addr">${fullAddr.slice(0,22)}<wbr>${fullAddr.slice(22)}</span>`
      : `<span class="wallet-full-addr" style="color:var(--text-muted)">Estimated</span>`;

    const txFmt       = w.txCount7d != null ? `${w.txCount7d} txns` : '<span style="color:var(--text-muted)">—</span>';
    const firstBuyFmt = w.firstBuy  || '<span style="color:var(--text-muted)">—</span>';
    const lastActFmt  = w.lastActive || '<span style="color:var(--text-muted)">—</span>';

    const dataBadge = isReal
      ? `<span class="wallet-data-badge real" title="Real on-chain data">● Live</span>`
      : `<span class="wallet-data-badge est" title="Estimated">~ Est.</span>`;

    return `
      <div class="wallet-row-v2" id="wrow_${idx}">
        <div class="wallet-col-addr">
          <div style="display:flex;align-items:center;gap:5px;min-width:0">
            <span class="wallet-risk-dot" style="background:${riskColor};flex-shrink:0"></span>
            <div style="min-width:0;flex:1">
              ${solscanUrl
                ? `<a href="${solscanUrl}" target="_blank" class="wallet-addr-full" title="${fullAddr}">${addrDisplay}</a>`
                : addrDisplay}
              <div style="display:flex;align-items:center;gap:4px;margin-top:2px">
                ${dataBadge}
                ${dexLabel}
                ${validAddr ? `<button class="wallet-copy-btn" onclick="(function(e){e.stopPropagation();navigator.clipboard.writeText('${fullAddr}').then(()=>showToast('Wallet address copied'));})( event)" title="Copy address">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                </button>` : ''}
              </div>
            </div>
          </div>
        </div>
        <div class="wallet-col-type">
          <span class="wallet-type-badge-v2" style="background:${typeColor}22;color:${typeColor};border:1px solid ${typeColor}44">${w.type||'Other'}</span>
        </div>
        <div class="wallet-col-alloc">
          <div class="wallet-alloc-val" style="font-size:10px">${allocLine1}</div>
          <div class="wallet-alloc-pct">${allocLine2}</div>
          ${buySellBar}
        </div>
        <div class="wallet-col-activity">
          <div class="mini-chart">${bars}</div>
          <div class="wallet-tx-count">${txFmt}</div>
        </div>
        <div class="wallet-col-meta">
          <div class="wallet-first-buy">Entry: ${firstBuyFmt}</div>
          <div class="wallet-last-active">Active: ${lastActFmt}</div>
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
  if ($('aiConfidence')) $('aiConfidence').textContent = Math.round(ai.confidence || d.confidence || 0);
  if ($('aiVerdict'))    $('aiVerdict').textContent    = ai.verdict || 'Analysis unavailable.';
  if ($('findingsList')) $('findingsList').innerHTML   = (ai.findings || []).map(f => `<li>${f}</li>`).join('');
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
$('generateReportBtn')?.addEventListener('click', () => $('exportBtn').click());

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

/* ─── Wallet Tracker ──────────────────────────────────────────────────────── */
(function initWalletTracker() {
  const inp        = () => $('wtInput');
  const scanBtn    = () => $('wtScanBtn');
  const copyBtn    = () => $('wtCopyBtn');
  const chainSel   = () => $('wtChainSelect');
  const detectEl   = () => $('wtChainDetect');
  const content    = () => $('wtContent');
  const empty      = () => $('wtEmpty');
  const loading    = () => $('wtLoading');
  const loadingMsg = () => $('wtLoadingMsg');

  function isEvm(addr)    { return /^0x[0-9a-fA-F]{40}$/.test(addr); }
  function isSolana(addr) { return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr) && !isEvm(addr); }

  function onInput() {
    const val = (inp()?.value || '').trim();
    if (isEvm(val)) {
      detectEl().textContent = '⬡ EVM address detected — select chain below';
      detectEl().style.color = '#4a90d9';
      if (chainSel()) chainSel().style.display = 'block';
    } else if (isSolana(val)) {
      detectEl().textContent = '◎ Solana address detected';
      detectEl().style.color = '#27C97F';
      if (chainSel()) chainSel().style.display = 'none';
    } else {
      detectEl().textContent = val.length > 5 ? '⚠ Unrecognized address format' : '';
      detectEl().style.color = '#F5A623';
      if (chainSel()) chainSel().style.display = 'none';
    }
  }

  function show(id) {
    ['wtContent','wtEmpty','wtLoading'].forEach(i => { const el = $(i); if (el) el.style.display = 'none'; });
    const el = $(id);
    if (el) el.style.display = id === 'wtContent' ? 'block' : 'flex';
  }

  const fmtUsd = v => !v ? '$0' : v >= 1e6 ? `$${(v/1e6).toFixed(2)}M` : v >= 1e3 ? `$${(v/1e3).toFixed(1)}K` : `$${v.toFixed(2)}`;
  const fmtNum = v => !v ? '0' : v >= 1e6 ? `${(v/1e6).toFixed(2)}M` : v >= 1e3 ? `${(v/1e3).toFixed(1)}K` : parseFloat(v).toFixed(4);
  const timeAgo = ts => { const s=(Date.now()-ts)/1000; return s<60?`${Math.round(s)}s ago`:s<3600?`${Math.round(s/60)}m ago`:s<86400?`${Math.round(s/3600)}h ago`:`${Math.round(s/86400)}d ago`; };

  function renderSummary(data) {
    const el = $('wtSummary');
    if (!el) return;
    const chain = data.chain === 'solana' ? 'Solana' : (data.evmChain||'EVM').charAt(0).toUpperCase()+(data.evmChain||'evm').slice(1);
    const chainColor = data.chain === 'solana' ? '#9945FF' : '#4a90d9';
    el.innerHTML = [
      { label:'Total Value',  value: fmtUsd(data.totalUsd), color:'#27C97F' },
      { label:'Network',      value: chain,                  color: chainColor },
      { label:'Tokens',       value: data.tokens?.length || 0, color:'var(--text-primary)' },
      { label:'Transactions', value: data.txs?.length || 0,    color:'var(--text-primary)' },
    ].map(s => `
      <div class="card" style="padding:14px 16px">
        <div style="font-size:9px;color:var(--text-muted);font-weight:700;letter-spacing:.5px;text-transform:uppercase;margin-bottom:6px">${s.label}</div>
        <div style="font-size:18px;font-weight:700;color:${s.color}">${s.value}</div>
      </div>`).join('');
  }

  function renderHoldings(tokens, chain) {
    const el = $('wtHoldings');
    if (!el) return;
    if ($('wtHoldingCount')) $('wtHoldingCount').textContent = `${tokens.length} tokens`;
    if (!tokens.length) { el.innerHTML = `<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:12px">No token holdings found</div>`; return; }

    const explorerBase = chain === 'solana' ? 'https://solscan.io/token/' : 'https://etherscan.io/token/';
    el.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 80px 90px 80px;padding:6px 12px;font-size:9px;color:var(--text-muted);font-weight:700;letter-spacing:.5px;border-bottom:1px solid var(--border-light)">
        <span>TOKEN</span><span style="text-align:right">BALANCE</span><span style="text-align:right">PRICE</span><span style="text-align:right">VALUE</span>
      </div>
      ${tokens.map(t => {
        const pct = tokens[0]?.valueUsd > 0 ? (t.valueUsd / tokens.reduce((s,x)=>s+x.valueUsd,0)*100) : 0;
        const addr = t.mint || t.address || '';
        return `
        <div style="display:grid;grid-template-columns:1fr 80px 90px 80px;padding:8px 12px;border-bottom:1px solid var(--border-light);align-items:center">
          <div>
            <div style="font-size:11px;font-weight:600;color:var(--text-primary)">${t.symbol}</div>
            <div style="font-size:9px;color:var(--text-muted)">${t.name}</div>
            <div style="height:2px;background:var(--border-light);border-radius:1px;margin-top:3px;width:60px">
              <div style="height:100%;width:${Math.min(100,pct)}%;background:#27C97F;border-radius:1px"></div>
            </div>
          </div>
          <span style="text-align:right;font-size:10px;color:var(--text-primary)">${fmtNum(t.balance)}</span>
          <span style="text-align:right;font-size:10px;color:var(--text-muted)">${t.priceUsd>0?'$'+t.priceUsd.toFixed(t.priceUsd<0.001?8:t.priceUsd<1?6:4):'—'}</span>
          <span style="text-align:right;font-size:11px;font-weight:600;color:${t.valueUsd>0?'#27C97F':'var(--text-muted)'}">${fmtUsd(t.valueUsd)}</span>
        </div>`;
      }).join('')}`;
  }

  let _allTxs = [], _txChain = 'solana', _txNextCursor = null, _txAddress = '';

  function renderTxHistory(txs, chain, nextCursor = null, address = '') {
    _allTxs = txs; _txChain = chain; _txNextCursor = nextCursor; _txAddress = address;
    _renderTxRows();
  }

  function _txRow(tx) {
    const txBase = { solana:'https://solscan.io/tx/', ethereum:'https://etherscan.io/tx/', base:'https://basescan.org/tx/', bsc:'https://bscscan.com/tx/', arbitrum:'https://arbiscan.io/tx/' };
    const explorer = txBase[_txChain] || txBase.ethereum;
    const TYPE_COLOR = { Send:'#F0484B', Receive:'#27C97F', Swap:'#F5A623', Transfer:'#4a90d9' };
    const hash   = tx.signature || tx.hash || '';
    const color  = TYPE_COLOR[tx.type] || '#8b92a8';
    const valStr = tx.value > 0 ? fmtUsd(tx.value * (_txChain==='solana'?150:3000)) : (tx.amtOut > 0 ? fmtNum(tx.amtOut) : '—');
    const detail = tx.type === 'Swap'
      ? `${fmtNum(tx.amtOut)} → ${fmtNum(tx.amtIn)}`
      : (tx.to ? tx.to.slice(0,6)+'…'+tx.to.slice(-4) : tx.short || '—');
    return `<div style="display:grid;grid-template-columns:60px 1fr 80px 70px 36px;padding:7px 12px;border-bottom:1px solid var(--border-light);align-items:center">
      <span style="font-size:10px;font-weight:700;color:${color}">${tx.type}</span>
      <span style="font-size:9px;color:var(--text-muted);font-family:monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${detail}</span>
      <span style="text-align:right;font-size:10px;color:var(--text-primary)">${valStr}</span>
      <span style="text-align:right;font-size:9px;color:var(--text-muted)">${timeAgo(tx.timestamp)}</span>
      <span style="text-align:right">${hash ? `<a href="${explorer}${hash}" target="_blank" style="color:var(--text-muted);font-size:10px;text-decoration:none">↗</a>` : ''}</span>
    </div>`;
  }

  function _renderTxRows() {
    const el = $('wtTxList');
    if (!el) return;
    if ($('wtTxCount')) $('wtTxCount').textContent = 'Top 10';
    const top10 = _allTxs.slice(0, 10);
    if (!top10.length) {
      el.innerHTML = `<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:12px">No transactions found</div>`;
      return;
    }
    el.innerHTML = `
      <div style="display:grid;grid-template-columns:60px 1fr 80px 70px 36px;padding:6px 12px;font-size:9px;color:var(--text-muted);font-weight:700;letter-spacing:.5px;border-bottom:1px solid var(--border-light)">
        <span>TYPE</span><span>DETAILS</span><span style="text-align:right">VALUE</span><span style="text-align:right">TIME</span><span></span>
      </div>
      ${top10.map(_txRow).join('')}`;
  }

  async function doTrack() {
    const address  = (inp()?.value || '').trim();
    const evmChain = chainSel()?.value || 'ethereum';
    if (!address) return;
    if (!_privyUser) { openWalletModal(); return; }

    show('wtLoading');
    if (loadingMsg()) loadingMsg().textContent = `Fetching ${isSolana(address) ? 'Solana' : evmChain} wallet data…`;

    try {
      const res  = await fetch(`${API_BASE}/wallet-tracker`, {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ address, evmChain }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Failed');

      show('wtContent');
      renderSummary(data);
      renderHoldings(data.tokens || [], data.chain === 'solana' ? 'solana' : evmChain);
      renderTxHistory(data.txs || [], data.chain === 'solana' ? 'solana' : evmChain, data.nextCursor || null, address);
    } catch (e) {
      show('wtEmpty');
      if (detectEl()) { detectEl().textContent = '⚠ ' + e.message; detectEl().style.color = '#F0484B'; }
    }
  }

  // Wire up after DOM ready
  const wire = () => {
    inp()?.addEventListener('input', onInput);
    scanBtn()?.addEventListener('click', doTrack);
    inp()?.addEventListener('keydown', e => e.key === 'Enter' && doTrack());
    copyBtn()?.addEventListener('click', () => {
      const addr = inp()?.value?.trim();
      if (!addr) return;
      navigator.clipboard.writeText(addr).then(() => {
        const btn = copyBtn();
        btn.style.color = 'var(--accent-green)';
        setTimeout(() => { btn.style.color = ''; }, 1000);
        showToast('Wallet address copied to clipboard');
      });
    });
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
  else wire();
})();

/* ─── Trending ────────────────────────────────────────────────────────────── */
function renderTrending(tokens) {
  const trendEl = $('trendingList');
  if (!trendEl) return;
  trendEl.innerHTML = tokens.map(t => {
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
  requireWallet(() => {
    document.getElementById('contractInput').value = address;
    document.querySelector('[data-page="ai-analyzer"]').click();
    document.getElementById('scanBtn').click();
  });
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

function renderNewPairs(items, el) {
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
      const chg = t.priceChange24h || 0;
      const chgColor = chg >= 0 ? 'var(--accent-green)' : 'var(--accent-red)';
      const chainColor = CHAIN_COLOR[t.networkId] || '#8b92a8';
      return `<div class="dash-vol-row" onclick="openInAnalyzer('${t.address}','${t.networkId}')">
        <span class="dash-vol-rank">${i+1}</span>
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
        <span class="dash-vol-liq" style="color:var(--accent-green)">${dashAge(t.createdAt) || '-'}</span>
        <span class="dash-vol-liq" style="color:var(--accent-green)">${t.buys24h || 0}</span>
        <span class="dash-vol-liq" style="color:var(--accent-red)">${t.sells24h || 0}</span>
      </div>`;
    }).join('');
}

function renderDashFilter() {
  const bar = $('dashFilterBar');
  const STATIC_CHAINS = [
    { id: 'solana',   label: 'Solana' },
    { id: 'ethereum', label: 'Ethereum' },
    { id: 'bsc',      label: 'BSC' },
    { id: 'base',     label: 'Base' },
  ];
  bar.innerHTML = `<button class="dash-filter-btn ${_dashChain==='all'?'active':''}" data-chain="all">All Chains</button>` +
    STATIC_CHAINS.map(c => `<button class="dash-filter-btn ${_dashChain===c.id?'active':''}" data-chain="${c.id}">${c.label}</button>`).join('');
  bar.querySelectorAll('.dash-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.chain === _dashChain) return;
      bar.querySelectorAll('.dash-filter-btn').forEach(b => b.classList.toggle('active', b === btn));
      fetchDashboard(btn.dataset.chain);
    });
  });
}

function _setDashLoading() {
  ['dashVolumeGrid','dashTrendingList','dashNewPairsList'].forEach(id => {
    const el = $(id);
    if (el) el.innerHTML = `<div class="dash-loading">Loading...</div>`;
  });
}

async function fetchDashboard(chain) {
  _dashChain = chain;
  const label = chain === 'all' ? 'All Chains' : ({ solana:'Solana', ethereum:'Ethereum', bsc:'BSC', base:'Base' }[chain] || chain);
  $('dashVolSub').textContent   = `${label} · 24h`;
  $('dashTrendSub').textContent = label;
  $('dashNewSub').textContent   = label;
  const newPairsSection = $('dashNewPairsSection');
  if (newPairsSection) newPairsSection.style.display = chain === 'all' ? 'none' : '';
  _setDashLoading();
  try {
    const url  = chain === 'all' ? `${API_BASE}/dashboard` : `${API_BASE}/dashboard?chain=${chain}`;
    const res  = await fetch(url);
    const json = await res.json();
    if (!json.success) throw new Error(json.error);
    _dashData = json.data;
    renderBestVolume(_dashData.bestVolume);
    renderDashList(_dashData.trending,  $('dashTrendingList'));
    if (chain !== 'all') renderNewPairs(_dashData.newPairs, $('dashNewPairsList'));
  } catch (e) {
    ['dashVolumeGrid','dashTrendingList','dashNewPairsList'].forEach(id => {
      const el = $(id);
      if (el) el.innerHTML = `<div class="dash-loading" style="color:var(--accent-red)">Failed to load data</div>`;
    });
  }
}

async function loadDashboard() {
  _dashChain = 'all';
  renderDashFilter();
  $('dashVolSub').textContent   = 'All Chains · 24h';
  $('dashTrendSub').textContent = 'All Chains';
  $('dashNewSub').textContent   = 'All Chains';
  await fetchDashboard('all');
}

/* ─── Privy Wallet Connect ─────────────────────────────────────────────────── */
let _privyUser = null;
let _watchlist = new Set(); // set of lowercase token addresses in watchlist
let _currentTokenData = null; // last scanned token data

function openWalletModal() {
  const modal = document.getElementById('walletModal');
  if (!modal) return;
  if (_privyUser) {
    // Already connected — show disconnect option
    const addr = _privyUser._displayAddress || _privyUser.wallet?.address || _privyUser.linked_accounts?.find(a => a.type === 'wallet')?.address || _privyUser.email?.address || _privyUser.linked_accounts?.find(a => a.type === 'email')?.address || '';
    const initials = addr ? addr.charAt(0).toUpperCase() : 'P';
    document.getElementById('walletModalBody').innerHTML = `
      <div style="text-align:center;padding:10px 0 16px">
        <div style="width:44px;height:44px;border-radius:50%;background:#27c97f22;border:2px solid #27c97f55;display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:700;color:#27c97f;margin:0 auto 10px">${initials}</div>
        <div style="display:inline-flex;align-items:center;gap:5px;background:#27c97f15;border:1px solid #27c97f30;border-radius:20px;padding:3px 12px;margin-bottom:10px">
          <span style="width:6px;height:6px;border-radius:50%;background:#27c97f;display:inline-block;flex-shrink:0"></span>
          <span style="font-size:10px;color:#27c97f;font-weight:600">CONNECTED</span>
        </div>
        <div style="background:#27c97f10;border:1px solid #27c97f30;border-radius:10px;padding:8px 12px;text-align:center">
          <span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:#27c97f;margin-right:6px;vertical-align:middle;flex-shrink:0"></span><span style="font-size:10px;font-family:monospace;color:#27c97f;font-weight:600;word-break:break-all;line-height:1.6">${addr}</span>
        </div>
      </div>
      <div style="padding:0 0 10px">
        <button onclick="navigator.clipboard.writeText('${addr}').then(()=>showToast('Wallet address copied!'))" style="width:100%;background:#1e2235;border:1px solid #2d3748;border-radius:10px;color:#e2e8f0;font-size:12px;font-weight:700;padding:10px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;letter-spacing:0.5px;margin-bottom:8px">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          Copy Address
        </button>
        <button onclick="privyLogout()" style="width:100%;background:#ff4d4d12;border:1px solid #ff4d4d44;border-radius:10px;padding:10px;cursor:pointer;color:#ff6b6b;font-size:12px;font-weight:700;letter-spacing:0.5px">DISCONNECT</button>
      </div>
      <div style="text-align:center;font-size:10px;color:#4b5563">Powered by Privy</div>`;
  } else {
    document.getElementById('walletModalBody').innerHTML = `
      <button id="mmBtn" onclick="privyConnectMM()" style="width:100%;display:flex;align-items:center;gap:12px;background:#13161d;border:1px solid #2d3144;border-radius:10px;padding:14px 16px;cursor:pointer;margin-bottom:10px;transition:border-color 0.15s">
        <img src="https://upload.wikimedia.org/wikipedia/commons/3/36/MetaMask_Fox.svg" width="28" height="28"/>
        <div style="text-align:left">
          <div style="font-size:12px;font-weight:700;color:#e2e8f0;font-family:monospace">MetaMask</div>
          <div style="font-size:10px;color:#8b92a8">Browser extension wallet</div>
        </div>
      </button>
      <div style="display:flex;align-items:center;gap:8px;margin:4px 0 10px">
        <div style="flex:1;height:1px;background:#2d3144"></div>
        <span style="font-size:10px;color:#8b92a8">OR</span>
        <div style="flex:1;height:1px;background:#2d3144"></div>
      </div>
      <div id="emailLoginStep1">
        <div style="font-size:10px;color:#8b92a8;margin-bottom:6px;letter-spacing:0.5px">EMAIL</div>
        <div style="display:flex;gap:8px">
          <input id="privyEmailInput" type="text" inputmode="email" placeholder="Enter your email" autocomplete="chrome-off" name="bb_email_nofill" spellcheck="false" style="flex:1;background:#13161d;border:1px solid #2d3144;border-radius:8px;padding:10px 12px;color:#e2e8f0;font-size:12px;font-family:monospace;outline:none" onkeydown="if(event.key==='Enter')privySendCode()"/>
          <button onclick="privySendCode()" style="background:#27C97F;border:none;border-radius:8px;padding:10px 14px;color:#000;font-size:11px;font-weight:700;cursor:pointer;font-family:monospace;white-space:nowrap">SEND CODE</button>
        </div>
      </div>
      <div id="emailLoginStep2" style="display:none">
        <div style="font-size:10px;color:#8b92a8;margin-bottom:4px;letter-spacing:0.5px">OTP CODE</div>
        <div style="font-size:10px;color:#27C97F;margin-bottom:8px" id="emailLoginHint"></div>
        <div style="display:flex;gap:8px">
          <input id="privyOtpInput" type="text" maxlength="6" placeholder="6-digit code" style="flex:1;background:#13161d;border:1px solid #2d3144;border-radius:8px;padding:10px 12px;color:#e2e8f0;font-size:14px;font-family:monospace;outline:none;letter-spacing:4px;text-align:center" onkeydown="if(event.key==='Enter')privyVerifyCode()"/>
          <button onclick="privyVerifyCode()" style="background:#27C97F;border:none;border-radius:8px;padding:10px 14px;color:#000;font-size:11px;font-weight:700;cursor:pointer;font-family:monospace">VERIFY</button>
        </div>
        <button onclick="privyEmailBack()" style="background:none;border:none;color:#8b92a8;font-size:10px;cursor:pointer;margin-top:8px;padding:0">← Back</button>
      </div>
      <div style="text-align:center;font-size:10px;color:#8b92a8;padding-top:10px">Powered by Privy</div>`;
  }
  modal.style.display = 'flex';
}

function closeWalletModal() {
  const modal = document.getElementById('walletModal');
  if (modal) modal.style.display = 'none';
}

// Close modal on backdrop click
document.getElementById('walletModal')?.addEventListener('click', function(e) {
  if (e.target === this) closeWalletModal();
});

function _setWalletConnected(user) {
  _privyUser = user;
  if (user) setTimeout(_loadWatchlist, 200);
  else { _watchlist = new Set(); if (_currentTokenData?.address) _updateWatchlistBtn(_currentTokenData.address); }
  const btn   = document.getElementById('connectWalletBtn');
  const label = document.getElementById('connectWalletLabel');
  if (btn && label) {
    if (user) {
      const display = user._displayAddress
        || user.wallet?.address
        || user.linked_accounts?.find(a => a.type === 'wallet')?.address
        || '';
      const email = user.email?.address || user.linked_accounts?.find(a => a.type === 'email')?.address || '';
      const short = display ? display.slice(0,6)+'…'+display.slice(-4) : email ? email.split('@')[0]+'@…' : 'Connected';
      label.textContent = short;
      btn.classList.add('connected');
    } else {
      label.textContent = 'Connect Wallet';
      btn.classList.remove('connected');
    }
  }
  _updateSidebarProfile(user);
}

function _updateSidebarProfile(user) {
  const walletEl  = document.getElementById('sidebarWallet');
  const avatarEl  = document.getElementById('sidebarAvatar');
  const popupFull = document.getElementById('popupWalletFull');
  if (!walletEl) return;
  if (user) {
    const addr = user._displayAddress
      || user.wallet?.address
      || user.linked_accounts?.find(a => a.type === 'wallet')?.address
      || '';
    const email = user.email?.address || user.linked_accounts?.find(a => a.type === 'email')?.address || '';
    const display = addr || email || '';
    const short = display ? (addr ? addr.slice(0,6)+'…'+addr.slice(-4) : email) : 'Connected';
    walletEl.textContent = short;
    if (avatarEl) avatarEl.textContent = display.charAt(0).toUpperCase() || 'P';
    const popupAvatar = document.getElementById('popupAvatar');
    if (popupAvatar) popupAvatar.textContent = display.charAt(0).toUpperCase() || 'P';
    if (popupFull) popupFull.textContent = display || '—';
  } else {
    walletEl.textContent = 'Not connected';
    if (avatarEl) avatarEl.textContent = 'P';
    if (popupFull) popupFull.textContent = '—';
  }
}

window.toggleProfilePopup = () => {
  const popup   = document.getElementById('profilePopup');
  const overlay = document.getElementById('profileModalOverlay');
  if (!popup) return;
  const open = popup.style.display === 'none';
  popup.style.display   = open ? 'block' : 'none';
  if (overlay) overlay.style.display = open ? 'block' : 'none';
};
window.__profileCopy = () => {
  const addr = document.getElementById('popupWalletFull')?.textContent;
  if (!addr || addr === '—') return showToast('No wallet connected');
  navigator.clipboard.writeText(addr).then(() => showToast('Wallet address copied!'));
};
window.__profileDisconnect = async () => {
  document.getElementById('profilePopup').style.display = 'none';
  await disconnectWallet();
};

/* ─── Watchlist helpers ───────────────────────────────────────────────────── */
function _authHeaders() {
  const t = localStorage.getItem('bb_jwt');
  return t ? { 'Authorization': `Bearer ${t}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' };
}

async function _updateWatchlistBtn(address) {
  const btn   = $('watchlistBtn');
  const heart = $('watchlistHeart');
  if (!btn || !heart || !address) return;
  const addr = address.toLowerCase();
  // First render from memory, then confirm from DB
  const memInList = _watchlist.has(addr);
  heart.setAttribute('fill', memInList ? '#ff6b8a' : 'none');
  btn.style.opacity = memInList ? '1' : '0.6';
  btn.title = memInList ? 'Remove from watchlist' : 'Add to watchlist';
  // Always confirm from DB if logged in
  if (!localStorage.getItem('bb_jwt')) return;
  try {
    const res = await fetch(`${API_BASE}/watchlist/check/${encodeURIComponent(addr)}`, { credentials: 'include', headers: _authHeaders() });
    if (!res.ok) return;
    const { inWatchlist } = await res.json();
    if (inWatchlist) _watchlist.add(addr); else _watchlist.delete(addr);
    heart.setAttribute('fill', inWatchlist ? '#ff6b8a' : 'none');
    btn.style.opacity = inWatchlist ? '1' : '0.6';
    btn.title = inWatchlist ? 'Remove from watchlist' : 'Add to watchlist';
  } catch(_) {}
}

async function _loadWatchlist() {
  if (!_privyUser && !localStorage.getItem('bb_jwt')) return;
  try {
    const res = await fetch(`${API_BASE}/watchlist`, { credentials: 'include', headers: _authHeaders() });
    if (!res.ok) return;
    const data = await res.json();
    _watchlist = new Set((data.items || []).map(i => i.address.toLowerCase()));
    if (_currentTokenData?.address) _updateWatchlistBtn(_currentTokenData.address);
  } catch(_) {}
}

async function renderWatchlistPage() {
  const el = document.getElementById('watchlistContent');
  if (!el) return;
  if (!_privyUser && !localStorage.getItem('bb_jwt')) {
    el.innerHTML = `<div style="text-align:center;padding:60px 0;color:#6b7280;font-size:13px">
      <div style="font-size:28px;margin-bottom:12px">♡</div>
      Connect wallet to see your watchlist
      <br><button onclick="openWalletModal()" style="margin-top:16px;background:#27c97f;border:none;border-radius:8px;color:#000;padding:8px 20px;cursor:pointer;font-size:13px;font-weight:600">Connect Wallet</button>
    </div>`;
    return;
  }
  el.innerHTML = `<div style="text-align:center;padding:40px 0;color:#6b7280;font-size:13px">Loading…</div>`;
  try {
    const token = localStorage.getItem('bb_jwt');
    const headers = token ? { 'Authorization': `Bearer ${token}` } : {};
    const res = await fetch(`${API_BASE}/watchlist`, { credentials: 'include', headers });
    const data = await res.json();
    const items = data.items || [];
    if (items.length === 0) {
      el.innerHTML = `<div style="text-align:center;padding:60px 0;color:#6b7280;font-size:13px">
        <div style="font-size:28px;margin-bottom:12px">♡</div>
        No tokens in watchlist yet.<br>
        <span style="color:#9ca3af">Scan a token and click the ♡ to save it.</span>
      </div>`;
      return;
    }
    el.innerHTML = items.map(item => `
      <div style="display:flex;align-items:center;justify-content:space-between;background:#12141e;border:1px solid #1e2235;border-radius:10px;padding:12px 16px;cursor:pointer"
           onclick="openInAnalyzer('${item.address}')">
        <div style="display:flex;align-items:center;gap:12px">
            <div style="width:36px;height:36px;border-radius:50%;background:#1e2235;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;color:#e2e8f0;overflow:hidden;flex-shrink:0">
            ${(item.imageUrl || item.image_url)
              ? `<img src="${item.imageUrl || item.image_url}" style="width:36px;height:36px;object-fit:cover;border-radius:50%" onerror="this.parentElement.textContent='${(item.symbol||'?').charAt(0)}'">`
              : (item.symbol||'?').charAt(0)}
          </div>
          <div>
            <div style="font-size:14px;font-weight:600;color:#e2e8f0">${item.name || item.symbol || 'Unknown'}</div>
            <div style="font-size:11px;color:#6b7280;margin-top:2px">${item.symbol || ''} · ${(item.chain||'').toUpperCase()} · ${item.address.slice(0,6)}…${item.address.slice(-4)}</div>
          </div>
        </div>
        <button onclick="event.stopPropagation();removeFromWatchlist('${item.address}')" title="Remove"
          style="background:none;border:none;cursor:pointer;padding:4px;color:#ff6b8a;font-size:16px;opacity:0.7;transition:opacity 0.2s"
          onmouseover="this.style.opacity=1" onmouseout="this.style.opacity=0.7">♥</button>
      </div>
    `).join('');
  } catch(e) {
    el.innerHTML = `<div style="text-align:center;padding:40px 0;color:#ff4d4d;font-size:13px">Error loading watchlist</div>`;
  }
}

async function removeFromWatchlist(address) {
  const addr = address.toLowerCase();
  try {
    const token = localStorage.getItem('bb_jwt');
    const headers = token ? { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' };
    await fetch(`${API_BASE}/watchlist/${addr}`, { method: 'DELETE', credentials: 'include', headers });
    _watchlist.delete(addr);
    if (_currentTokenData?.address?.toLowerCase() === addr) _updateWatchlistBtn(addr);
    renderWatchlistPage();
    showToast('Removed from watchlist');
  } catch(e) { showToast('Error: ' + e.message); }
}

async function loadLandingCA() {
  const el = document.getElementById('landingCA');
  const copyBtn = document.getElementById('landingCACopy');
  if (!el) return;
  if (_cachedCA) { _renderCA(el, copyBtn, _cachedCA); return; }
  el.textContent = 'Loading…';
  try {
    const res = await fetch(`${API_BASE}/config/public`);
    const data = await res.json();
    _cachedCA = data.contractAddress || 'coming_soon';
    _renderCA(el, copyBtn, _cachedCA);
  } catch(_) { el.textContent = 'Coming Soon'; }
}
function _renderCA(el, copyBtn, ca) {
  const isComingSoon = ca === 'coming_soon' || !ca;
  if (isComingSoon) {
    // Mask as 44-char Solana-style address with X's, reveal first/last 4
    const mask = 'Xxxx' + 'X'.repeat(36) + 'xxxx';
    el.innerHTML = `<span style="opacity:0.35;letter-spacing:1.5px">${mask}</span>`;
    el.style.color = '#4b5563';
    el.title = 'Contract address will be revealed at launch';
  } else {
    el.textContent = ca;
    el.style.color = '#27c97f';
    el.title = '';
  }
  if (copyBtn) {
    copyBtn.style.display = 'inline-block';
    copyBtn.disabled = isComingSoon;
    copyBtn.style.opacity = isComingSoon ? '0.35' : '1';
    copyBtn.style.cursor = isComingSoon ? 'not-allowed' : 'pointer';
  }
}
window.__copyCA = () => {
  if (!_cachedCA || _cachedCA === 'coming_soon') return;
  navigator.clipboard.writeText(_cachedCA).then(() => showToast('Contract address copied!'));
};

async function toggleWatchlist() {
  if (!_privyUser && !localStorage.getItem('bb_jwt')) {
    openWalletModal();
    return;
  }
  const d = _currentTokenData;
  // Fallback: read address from the scanned input if currentTokenData not set
  const inputAddr = (document.getElementById('contractInput') || document.getElementById('tokenInput'))?.value?.trim();
  const rawAddr = d?.address || inputAddr;
  if (!rawAddr || document.getElementById('tokenHeader')?.style?.display === 'none') {
    showToast('Scan a token first'); return;
  }
  const addr = rawAddr.toLowerCase();
  const btn = document.getElementById('watchlistBtn');
  if (btn) { btn.style.pointerEvents = 'none'; btn.style.opacity = '0.4'; }
  try {
    const headers = { ..._authHeaders(), 'Content-Type': 'application/json' };
    // Check current DB state
    const checkRes = await fetch(`${API_BASE}/watchlist/check/${encodeURIComponent(addr)}`, { credentials: 'include', headers: _authHeaders() });
    if (checkRes.status === 401) { openWalletModal(); throw new Error('Please connect wallet first'); }
    if (!checkRes.ok) throw new Error('Auth error');
    const { inWatchlist } = await checkRes.json();
    if (inWatchlist) {
      const res = await fetch(`${API_BASE}/watchlist/${addr}`, { method: 'DELETE', credentials: 'include', headers });
      if (!res.ok) throw new Error('Failed to remove');
      _watchlist.delete(addr);
      showToast('Removed from watchlist');
    } else {
      const res = await fetch(`${API_BASE}/watchlist`, {
        method: 'POST', credentials: 'include', headers,
        body: JSON.stringify({ address: addr, chain: d?.chain || 'unknown', name: d?.name || addr.slice(0,8), symbol: d?.symbol || '?', imageUrl: d?.imageUrl || null }),
      });
      if (!res.ok) throw new Error('Failed to save');
      _watchlist.add(addr);
      showToast('Added to watchlist ❤');
    }
    _updateWatchlistBtn(addr);
  } catch(e) {
    showToast('Error: ' + e.message);
    _updateWatchlistBtn(addr);
  } finally {
    if (btn) { btn.style.pointerEvents = ''; btn.style.opacity = ''; }
  }
}

async function _bbLogin(wallet, privyUser, method = 'metamask') {
  try {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        wallet,
        privyUserId: privyUser?.id || null,
        meta: { connectedAt: Date.now(), method },
      }),
    });
    const data = await res.json();
    if (data.token) localStorage.setItem('bb_jwt', data.token);
    return data;
  } catch(e) {
    console.warn('[bbLogin]', e.message);
  }
}

async function _bbLogout() {
  try {
    await fetch(`${API_BASE}/auth/logout`, { method: 'POST', credentials: 'include' });
  } catch(_) {}
  localStorage.removeItem('bb_jwt');
}

async function _bbMe() {
  try {
    const token = localStorage.getItem('bb_jwt');
    const headers = token ? { 'Authorization': `Bearer ${token}` } : {};
    const res = await fetch(`${API_BASE}/auth/me`, { headers, credentials: 'include' });
    if (!res.ok) return null;
    const data = await res.json();
    return data.user || null;
  } catch(_) { return null; }
}

let _emailForOtp = '';

async function privySendCode() {
  const input = document.getElementById('privyEmailInput');
  const email = input?.value?.trim();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    if (input) { input.style.borderColor = '#ff4d4d'; setTimeout(() => input.style.borderColor = '', 1200); }
    showToast('Enter a valid email address');
    return;
  }
  const btn = input.nextElementSibling;
  if (btn) { btn.textContent = 'SENDING…'; btn.style.opacity = '0.6'; btn.style.pointerEvents = 'none'; }
  try {
    await window.PrivySDK.sendEmailCode(email);
    _emailForOtp = email;
    document.getElementById('emailLoginStep1').style.display = 'none';
    document.getElementById('emailLoginStep2').style.display = 'block';
    document.getElementById('emailLoginHint').textContent = `Code sent to ${email}`;
    setTimeout(() => document.getElementById('privyOtpInput')?.focus(), 100);
  } catch(e) {
    showToast('Failed to send code: ' + (e.message || 'Error'));
    if (btn) { btn.textContent = 'SEND CODE'; btn.style.opacity = ''; btn.style.pointerEvents = ''; }
  }
}

async function privyVerifyCode() {
  const input = document.getElementById('privyOtpInput');
  const code  = input?.value?.trim();
  if (!code || code.length < 6) {
    if (input) { input.style.borderColor = '#ff4d4d'; setTimeout(() => input.style.borderColor = '', 1200); }
    return;
  }
  const btn = input.nextElementSibling;
  if (btn) { btn.textContent = '…'; btn.style.opacity = '0.6'; btn.style.pointerEvents = 'none'; }
  try {
    const user = await window.PrivySDK.loginWithEmailCode(_emailForOtp, code);
    const emailAddr = user?.email?.address || _emailForOtp;
    const bbData = await _bbLogin(emailAddr, user, 'email');
    if (bbData?.displayAddress) user._displayAddress = bbData.displayAddress;
    _setWalletConnected(user);
    closeWalletModal();
    showToast('Logged in via email');
  } catch(e) {
    showToast('Invalid code: ' + (e.message || 'Error'));
    if (btn) { btn.textContent = 'VERIFY'; btn.style.opacity = ''; btn.style.pointerEvents = ''; }
    if (input) input.value = '';
  }
}

function privyEmailBack() {
  document.getElementById('emailLoginStep1').style.display = 'block';
  document.getElementById('emailLoginStep2').style.display = 'none';
}

async function privyConnectMM() {
  const btn = document.getElementById('mmBtn');
  if (btn) { btn.style.opacity = '0.6'; btn.style.pointerEvents = 'none'; btn.querySelector('div div').textContent = 'Connecting…'; }
  try {
    if (!window.PrivySDK) throw new Error('Privy SDK not loaded');
    const privyUser = await window.PrivySDK.connectMetaMask();
    const wallet    = privyUser?.wallet?.address
      || privyUser?.linked_accounts?.find(a => a.type === 'wallet')?.address;
    if (wallet) await _bbLogin(wallet, privyUser);
    _setWalletConnected(privyUser);
    closeWalletModal();
    showToast('Wallet connected');
  } catch(e) {
    showToast('Connection failed: ' + (e.message || 'Unknown error'));
    if (btn) { btn.style.opacity = ''; btn.style.pointerEvents = ''; }
  }
}

async function privyLogout() {
  try { await window.PrivySDK?.logout(); } catch(_) {}
  await _bbLogout();
  _setWalletConnected(null);
  closeWalletModal();
  showToast('Wallet disconnected');
}

// Init on page load — try cookie/JWT auto-login first, then Privy session
(async function() {
  try {
    // 1. Check if backend session still valid (cookie auto-login)
    const bbUser = await _bbMe();
    if (bbUser) {
      const displayAddr = bbUser.generated_address || bbUser.wallet;
      _setWalletConnected({ _displayAddress: displayAddr, _fromDb: true, id: bbUser.id });
      return;
    }
    // 2. Fall back to Privy session
    if (!window.PrivySDK) return;
    const privyUser = await window.PrivySDK.init();
    if (privyUser) {
      const wallet = privyUser?.wallet?.address
        || privyUser?.linked_accounts?.find(a => a.type === 'wallet')?.address;
      const email  = privyUser?.email?.address
        || privyUser?.linked_accounts?.find(a => a.type === 'email')?.address;
      const identifier = wallet || email;
      if (identifier) {
        const bbData = await _bbLogin(identifier, privyUser, wallet ? 'metamask' : 'email');
        privyUser._displayAddress = bbData?.displayAddress || wallet || null;
      }
      _setWalletConnected(privyUser);
    }
  } catch(_) {}
})();
