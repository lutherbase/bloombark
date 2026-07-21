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
// Backend origin. Override at runtime via `window.BLOOMBARK_API_ORIGIN` (e.g. an
// injected <script> in production). Defaults to localhost:3001 in dev, or the
// same origin the page is served from otherwise.
const _isLocal = ['localhost', '127.0.0.1'].includes(location.hostname);
//const API_ORIGIN = window.BLOOMBARK_API_ORIGIN || (_isLocal ? 'http://localhost:3001' : location.origin);
const PORT = 3000;
const API_ORIGIN = 'https://be-bloombark.onrender.com';
const API_BASE = API_ORIGIN + '/api';
const WS_URL   = API_ORIGIN.replace(/^http/, 'ws');

/* ─── State ───────────────────────────────────────────────────────────────── */
let selectedChain  = 'auto'; // 'auto' | 'ethereum' | 'base' | 'robinhood'
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
      'trade':        ['TRADE',           'Bloombark native swap — best route via KyberSwap (EVM)'],
      'wallet-tracker':['WALLET TRACKER', 'Track and monitor specific wallets in real-time'],
      'smart-money':  ['SMART MONEY',     'Follow smart money wallets and their moves'],
      'insider-scan': ['INSIDER SCAN',    'Detect insider wallets, team allocation, hidden connections & suspicious activity'],
      'narrative':    ['NARRATIVE',       'Track trending narratives and market sectors'],
      'community':    ['BLOOMBARK COMMUNITY', 'Chat, shill, and connect with other traders'],
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
    const _wip = ['smart-money','insider-scan','ai-trading','auto-research','alerts','portfolio','leaderboard'];
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
    if (page === 'narrative') loadNarrative();
    if (page === 'community') initCommunity();
    if (page === 'trade') initTradePage();
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
  auto:      { icon: '🌐', label: 'Auto' },
  ethereum:  { icon: '⟠',  label: 'Ethereum' },
  base:      { icon: '🔵', label: 'Base' },
  robinhood: { icon: '🟢', label: 'Robinhood' },
};

function detectChain(addr) {
  if (!addr) return 'unsupported';
  // Tron: starts with T, 34 chars, base58
  if (/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(addr)) return 'tron';
  // EVM (Ethereum, Base, Arbitrum, Robinhood): 0x + 40 hex chars
  if (/^0x[0-9a-fA-F]{40}$/.test(addr)) return 'ethereum';
  return 'unsupported'; // Solana-style base58 addresses are no longer supported
}


// Address format validators per chain group
const ADDR_VALIDATORS = {
  tron:     addr => /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(addr),
  evm:      addr => /^0x[0-9a-fA-F]{40}$/.test(addr),
};
const EVM_CHAINS = ['ethereum', 'base', 'arbitrum', 'robinhood'];

function validateChainAddress(chain, addr) {
  if (chain === 'auto') return null;
  if (EVM_CHAINS.includes(chain)) {
    if (!ADDR_VALIDATORS.evm(addr)) {
      const detected = detectChain(addr);
      if (detected === 'unsupported') {
        return `Invalid address format for ${CHAIN_META[chain].label}. EVM addresses must start with 0x followed by 40 hex characters. Solana is no longer supported.`;
      }
      const detectedLabel = CHAIN_META[detected]?.label || detected;
      return `Invalid address format for ${CHAIN_META[chain].label}. Detected as ${detectedLabel} — switch to the correct network or use Auto Detect.`;
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
let _defaultLoadingStepsHTML = null;

// customSteps: optional array of step labels (defaults to the AI Analyzer steps)
function runLoadingSteps(cb, customSteps) {
  const container = $('loadingSteps');
  if (_defaultLoadingStepsHTML === null) _defaultLoadingStepsHTML = container.innerHTML;
  container.innerHTML = customSteps
    ? customSteps.map((s, i) => `<div class="loading-step${i === 0 ? ' active' : ''}">${s}</div>`).join('')
    : _defaultLoadingStepsHTML;

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
  try { renderSocial(d); } catch(e) { console.warn('renderSocial:', e); }
  resetPrediction();
}

// Reset the AI Token Prediction card back to its idle state whenever a new
// token is scanned — otherwise the previous token's verdict stays on screen.
function resetPrediction() {
  const content = $('predictionContent');
  const btn     = $('predictionBtn');
  if (content) content.innerHTML = '<div style="text-align:center;color:var(--text-muted);font-size:12px;padding:40px 0">Click ANALYZE to generate AI prediction for this token</div>';
  if (btn) { btn.disabled = false; btn.textContent = '▶ ANALYZE'; btn.style.opacity = ''; btn.style.pointerEvents = ''; }
}

// Jump from AI Analyzer straight into the Trade page with the scanned token preloaded
function goToTrade() {
  const d = _currentTokenData;
  if (!d?.address) return showToast('Scan a token first');
  if (!/^0x[0-9a-fA-F]{40}$/.test(d.address)) return showToast('Trade only supports EVM tokens — Solana is not tradeable here');

  document.querySelector('.nav-item[data-page="trade"]')?.click();

  const inp = $('tradeTokenInput');
  if (inp) inp.value = d.address;
  tradeLoadToken();
}

/* ─── Token Header ────────────────────────────────────────────────────────── */
function renderTokenHeader(d) {
  $('tokenName').textContent   = d.name || 'Unknown Token';
  const chainLabel = d.network || 'Unknown';
  $('tokenSymbol').textContent = (d.symbol || '?') + (d.quoteSymbol ? ' / ' + d.quoteSymbol : '');
  $('tokenNetworkLabel').textContent = chainLabel;
  const _dotColor = { ethereum:'#A78BFA', base:'#0052FF', arbitrum:'#28A0F0', tron:'#FF0013', polygon:'#8247E5', robinhood:'#00C805' }[(d.chain||'').toLowerCase()] || '#A78BFA';
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
      const chain = d.chain || 'ethereum';
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
    const isValidAddr = /^0x[0-9a-fA-F]{40}$/.test(fullAddr);
    const walletHtml = a.wallet
      ? (isValidAddr
          ? `<a href="https://etherscan.io/address/${fullAddr}" target="_blank"
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

  const isSolana = (d.geckoNetwork || 'eth') === 'solana';

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
  const explorerBase = { ethereum:'https://etherscan.io/address/', eth:'https://etherscan.io/address/', base:'https://basescan.org/address/', arbitrum:'https://arbiscan.io/address/', robinhood:'https://robinhoodchain.blockscout.com/address/' }[sec.chain || 'ethereum'] || 'https://etherscan.io/address/';

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
    const _walletChain = _currentTokenData?.chain || _currentTokenData?.networkId || 'ethereum';
    const _explorerMap = { ethereum:'https://etherscan.io/address/', eth:'https://etherscan.io/address/', base:'https://basescan.org/address/', arbitrum:'https://arbiscan.io/address/', robinhood:'https://robinhoodchain.blockscout.com/address/' };
    const solscanUrl = validAddr ? (_explorerMap[_walletChain] || 'https://etherscan.io/address/') + fullAddr : null;
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

/* ─── AI Price Prediction ─────────────────────────────────────────────────── */
async function runPrediction() {
  const d = _currentTokenData;
  if (!d?.address) return showToast('Scan a token first');

  const btn = $('predictionBtn');
  const content = $('predictionContent');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Analyzing…'; }

  const steps = [
    { icon: '🔍', text: 'Fetching on-chain data…' },
    { icon: '📊', text: 'Analyzing price momentum…' },
    { icon: '🐋', text: 'Scanning whale activity…' },
    { icon: '🔒', text: 'Running security checks…' },
    { icon: '🤖', text: 'Generating prediction…' },
  ];
  let stepIdx = 0;
  content.innerHTML = `
    <div style="padding:32px 0;display:flex;flex-direction:column;align-items:center;gap:16px">
      <div id="predStepIcon" style="font-size:28px;transition:opacity .3s">${steps[0].icon}</div>
      <div id="predStepText" style="font-size:12px;color:var(--text-muted);font-weight:600;letter-spacing:.5px;transition:opacity .3s">${steps[0].text}</div>
      <div style="width:260px;height:4px;background:var(--border-light);border-radius:2px;overflow:hidden">
        <div id="predProgressBar" style="height:100%;width:0%;background:linear-gradient(90deg,#27c97f,#4a90e2);border-radius:2px;transition:width .4s ease"></div>
      </div>
      <div id="predPct" style="font-size:10px;color:var(--text-muted)">0%</div>
    </div>`;

  const _stepInterval = setInterval(() => {
    stepIdx = Math.min(stepIdx + 1, steps.length - 1);
    const pct = Math.round((stepIdx / (steps.length - 1)) * 85);
    const icon = $('predStepIcon'); const txt = $('predStepText'); const bar = $('predProgressBar'); const pctEl = $('predPct');
    if (icon) { icon.style.opacity = '0'; setTimeout(() => { if ($('predStepIcon')) { $('predStepIcon').textContent = steps[stepIdx].icon; $('predStepIcon').style.opacity = '1'; } }, 150); }
    if (txt)  { txt.style.opacity  = '0'; setTimeout(() => { if ($('predStepText'))  { $('predStepText').textContent  = steps[stepIdx].text;  $('predStepText').style.opacity  = '1'; } }, 150); }
    if (bar)  bar.style.width = pct + '%';
    if (pctEl) pctEl.textContent = pct + '%';
  }, 600);

  try {
    const [res] = await Promise.all([
      fetch(`${API_BASE}/predict`, {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ address: d.address, chain: d.chain || d.networkId || 'ethereum' }),
      }),
      new Promise(r => setTimeout(r, 3000)), // minimum 3s so all steps show
    ]);
    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    clearInterval(_stepInterval);
    // Complete progress bar briefly before showing result
    const bar = $('predProgressBar'); const pctEl = $('predPct'); const txt = $('predStepText'); const icon = $('predStepIcon');
    if (bar) bar.style.width = '100%';
    if (pctEl) pctEl.textContent = '100%';
    if (icon) icon.textContent = '✅';
    if (txt) txt.textContent = 'Prediction ready!';
    await new Promise(r => setTimeout(r, 500));

    const sigColor = { bullish:'#27c97f', bearish:'#F0484B', neutral:'#F5A623' };
    const sigIcon  = { bullish:'▲', bearish:'▼', neutral:'◆' };
    const sigLabel = { bullish:'BULLISH', bearish:'BEARISH', neutral:'NEUTRAL' };
    const c = sigColor[data.signal] || '#F5A623';

    content.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">
        <!-- Verdict -->
        <div style="background:${c}10;border:1px solid ${c}30;border-radius:10px;padding:16px;display:flex;flex-direction:column;gap:6px">
          <div style="font-size:10px;color:var(--text-muted);font-weight:700;letter-spacing:.5px">PREDICTION</div>
          <div style="font-size:28px;font-weight:800;color:${c}">${sigIcon[data.signal]} ${sigLabel[data.signal]}</div>
          <div style="font-size:11px;color:var(--text-muted)">${data.timeframe}</div>
        </div>
        <!-- Confidence -->
        <div style="background:var(--bg-card);border:1px solid var(--border-light);border-radius:10px;padding:16px;display:flex;flex-direction:column;gap:8px">
          <div style="font-size:10px;color:var(--text-muted);font-weight:700;letter-spacing:.5px">CONFIDENCE</div>
          <div style="font-size:28px;font-weight:800;color:var(--text-primary)">${data.confidence}%</div>
          <div style="height:6px;background:var(--border-light);border-radius:3px;overflow:hidden">
            <div style="height:100%;width:${data.confidence}%;background:${c};border-radius:3px;transition:width .6s ease"></div>
          </div>
        </div>
      </div>
      <!-- Bull/Bear score bar -->
      <div style="margin-bottom:16px">
        <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--text-muted);margin-bottom:4px">
          <span>🟢 Bull Score: ${data.bullScore}</span><span>Bear Score: ${data.bearScore} 🔴</span>
        </div>
        <div style="display:flex;height:8px;border-radius:4px;overflow:hidden">
          <div style="flex:${data.bullScore};background:#27c97f"></div>
          <div style="flex:${data.bearScore};background:#F0484B"></div>
        </div>
      </div>
      <!-- Summary -->
      <div style="background:var(--bg-card);border:1px solid var(--border-light);border-radius:8px;padding:12px;margin-bottom:14px;font-size:12px;color:var(--text-secondary);line-height:1.6">
        ${data.summary}
      </div>
      <!-- Signals -->
      <div style="font-size:10px;color:var(--text-muted);font-weight:700;letter-spacing:.5px;margin-bottom:8px">SIGNAL BREAKDOWN</div>
      <div style="display:flex;flex-direction:column;gap:6px">
        ${(data.signals || []).map(s => `
          <div style="display:grid;grid-template-columns:140px 70px 1fr;align-items:center;gap:8px;padding:8px 10px;background:var(--bg-card);border:1px solid var(--border-light);border-radius:8px;font-size:11px">
            <span style="font-weight:600;color:var(--text-primary)">${s.label}</span>
            <span style="color:${sigColor[s.verdict]||'#F5A623'};font-weight:700;font-size:10px">${sigIcon[s.verdict]||'◆'} ${(s.verdict||'').toUpperCase()}</span>
            <span style="color:var(--text-muted)">${s.detail}</span>
          </div>`).join('')}
      </div>
      <div style="margin-top:12px;font-size:9px;color:var(--text-muted);text-align:center;font-style:italic">
        ⚠ This is not financial advice. Generated ${new Date(data.generatedAt).toLocaleTimeString()} · Rule-based engine
      </div>`;
  } catch(e) {
    clearInterval(_stepInterval);
    content.innerHTML = `<div style="text-align:center;padding:30px;color:#F0484B;font-size:12px">⚠ ${e.message}</div>`;
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '▶ ANALYZE'; }
  }
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

/* ─── Social Sentiment ────────────────────────────────────────────────────── */
function renderSocial(d) {
  const socials  = d.socials  || [];
  const websites = d.websites || [];

  const buys  = d.txns?.buys24h  || d.buys24h  || 0;
  const sells = d.txns?.sells24h || d.sells24h || 0;
  const total = buys + sells;
  const bullPct = total > 0 ? Math.round((buys / total) * 100) : 50;
  const bearPct = 100 - bullPct;
  const sentLabel = bullPct >= 60 ? 'Bullish' : bullPct <= 40 ? 'Bearish' : 'Neutral';
  const sentColor = bullPct >= 60 ? '#27c97f' : bullPct <= 40 ? '#ef4444' : '#f59e0b';

  const iconMap = {
    twitter:  { svg: `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.746l7.73-8.835L1.254 2.25H8.08l4.253 5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>`, label: 'X' },
    telegram: { svg: `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/></svg>`, label: 'TG' },
    discord:  { svg: `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z"/></svg>`, label: 'DC' },
    website:  { svg: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`, label: 'Web' },
  };

  const links = [];
  for (const w of websites) links.push({ type: 'website', url: w });
  for (const s of socials)  links.push({ type: s.type?.toLowerCase() || 'website', url: s.url });

  // ── Render into token header ──
  const sentItem  = $('headerSocialItem');
  const linksItem = $('headerSocialLinks');
  if (sentItem) {
    $('headerSentimentLabel').textContent = sentLabel;
    $('headerSentimentLabel').style.color = sentColor;
    $('headerBullBar').style.width = bullPct + '%';
    $('headerBearBar').style.width = bearPct + '%';
    $('headerSentimentSub').textContent = `${bullPct}% buys · ${total.toLocaleString()} txns`;
    sentItem.style.display = 'flex';
  }
  if (linksItem && links.length) {
    $('headerLinksRow').innerHTML = links.map(l => {
      const ico = iconMap[l.type] || iconMap.website;
      return `<a href="${l.url}" target="_blank" rel="noopener"
        title="${l.url}"
        style="display:flex;align-items:center;gap:4px;padding:3px 8px;background:var(--bg-secondary);border:1px solid var(--border-light);border-radius:5px;color:var(--text-muted);text-decoration:none;font-size:10px;font-weight:600;transition:color .15s,border-color .15s"
        onmouseover="this.style.color='var(--text-primary)';this.style.borderColor='var(--accent)'"
        onmouseout="this.style.color='var(--text-muted)';this.style.borderColor='var(--border-light)'">
        ${ico.svg}${ico.label}
      </a>`;
    }).join('');
    linksItem.style.display = 'flex';
  }
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
Token     : ${d.name} (${d.symbol}) on ${d.network || 'EVM'}
DEX       : ${d.dexId || 'N/A'} | Pairs: ${d.allPairs || 1}
Source    : DexScreener + GeckoTerminal

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

HOLDER DATA  (ON-CHAIN)
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
Bloombark Terminal Apps  |  Data: DexScreener + GeckoTerminal
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
  const chainWrap  = () => $('wtChainSelectWrap');
  const detectEl   = () => $('wtChainDetect');
  const content    = () => $('wtContent');
  const empty      = () => $('wtEmpty');
  const loading    = () => $('wtLoading');
  const loadingMsg = () => $('wtLoadingMsg');

  function isEvm(addr)    { return /^0x[0-9a-fA-F]{40}$/.test(addr); }

  function onInput() {
    const val = (inp()?.value || '').trim();
    if (isEvm(val)) {
      detectEl().textContent = '⬡ EVM address detected — select chain below';
      detectEl().style.color = '#4a90d9';
      if (chainWrap()) chainWrap().style.display = 'flex';
    } else {
      detectEl().textContent = val.length > 5 ? '⚠ Unrecognized address format — EVM wallets only (0x…)' : '';
      detectEl().style.color = '#F5A623';
      if (chainWrap()) chainWrap().style.display = 'none';
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
    const chain = (data.evmChain||'EVM').charAt(0).toUpperCase()+(data.evmChain||'evm').slice(1);
    const chainColor = '#4a90d9';
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

    const explorerBase = { ethereum:'https://etherscan.io/token/', base:'https://basescan.org/token/', robinhood:'https://robinhoodchain.blockscout.com/token/' }[chain] || 'https://etherscan.io/token/';
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

  let _allTxs = [], _txChain = 'ethereum', _txNextCursor = null, _txAddress = '';

  function renderTxHistory(txs, chain, nextCursor = null, address = '') {
    _allTxs = txs; _txChain = chain; _txNextCursor = nextCursor; _txAddress = address;
    _renderTxRows();
  }

  function _txRow(tx) {
    const txBase = { ethereum:'https://etherscan.io/tx/', base:'https://basescan.org/tx/', arbitrum:'https://arbiscan.io/tx/', robinhood:'https://robinhoodchain.blockscout.com/tx/' };
    const explorer = txBase[_txChain] || txBase.ethereum;
    const TYPE_COLOR = { Send:'#F0484B', Receive:'#27C97F', Swap:'#F5A623', Transfer:'#4a90d9' };
    const hash   = tx.signature || tx.hash || '';
    const color  = TYPE_COLOR[tx.type] || '#8b92a8';
    const valStr = tx.value > 0 ? fmtUsd(tx.value * 3000) : (tx.amtOut > 0 ? fmtNum(tx.amtOut) : '—');
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
    if (loadingMsg()) loadingMsg().textContent = `Fetching ${evmChain} wallet data…`;

    try {
      const res  = await fetch(`${API_BASE}/wallet-tracker`, {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ address, evmChain }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Failed');

      show('wtContent');
      renderSummary(data);
      renderHoldings(data.tokens || [], evmChain);
      renderTxHistory(data.txs || [], evmChain, data.nextCursor || null, address);
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
  ethereum:'#627EEA', base:'#0052FF',
  arbitrum:'#28A0F0', tron:'#FF0013', polygon:'#8247E5', avalanche:'#E84142',
  optimism:'#FF0420', linea:'#61DFFF', scroll:'#FFDBB5', mantle:'#60CF8B',
  zksync:'#8C8DFC', robinhood:'#00C805',
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

function renderDashFilter() {
  const bar = $('dashFilterBar');
  const STATIC_CHAINS = [
    { id: 'ethereum',  label: 'Ethereum' },
    { id: 'base',      label: 'Base' },
    { id: 'robinhood', label: 'Robinhood' },
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
  ['dashVolumeGrid','dashTrendingList'].forEach(id => {
    const el = $(id);
    if (el) el.innerHTML = `<div class="dash-loading">Loading...</div>`;
  });
}

async function fetchDashboard(chain) {
  _dashChain = chain;
  const label = chain === 'all' ? 'All Chains' : ({ ethereum:'Ethereum', base:'Base', robinhood:'Robinhood' }[chain] || chain);
  $('dashVolSub').textContent   = `${label} · 24h`;
  $('dashTrendSub').textContent = label;
  _setDashLoading();
  try {
    const url  = chain === 'all' ? `${API_BASE}/dashboard` : `${API_BASE}/dashboard?chain=${chain}`;
    const res  = await fetch(url);
    const json = await res.json();
    if (!json.success) throw new Error(json.error);
    if (json.empty) {
      const msg = `<div class="dash-loading" style="color:var(--text-muted);text-align:center;padding:32px 0">🚧 ${label} data is coming soon — chain not yet indexed</div>`;
      ['dashVolumeGrid','dashTrendingList'].forEach(id => { const el = $(id); if (el) el.innerHTML = msg; });
      return;
    }
    _dashData = json.data;
    renderBestVolume(_dashData.bestVolume);
    renderDashList(_dashData.trending,  $('dashTrendingList'));
  } catch (e) {
    ['dashVolumeGrid','dashTrendingList'].forEach(id => {
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
    // Already connected — show profile (view only) + disconnect
    const addr = _privyUser._displayAddress || _privyUser.wallet?.address || _privyUser.linked_accounts?.find(a => a.type === 'wallet')?.address || _privyUser.email?.address || _privyUser.linked_accounts?.find(a => a.type === 'email')?.address || '';
    const displayName = _userProfile?.displayName || _chatName || '';
    const avatar = _userProfile?.avatar || '';
    const fallbackLetter = (displayName || addr || '?').charAt(0).toUpperCase();
    const avatarHtml = avatar
      ? `<div style="width:64px;height:64px;border-radius:50%;overflow:hidden;border:2px solid #27c97f55;margin:0 auto 10px"><img src="${avatar}" style="width:100%;height:100%;object-fit:cover"></div>`
      : `<div style="width:64px;height:64px;border-radius:50%;background:#27c97f22;border:2px solid #27c97f55;display:flex;align-items:center;justify-content:center;font-size:24px;font-weight:700;color:#27c97f;margin:0 auto 10px">${fallbackLetter}</div>`;
    const nameHtml = displayName
      ? `<div style="font-size:14px;font-weight:700;color:#e2e8f0;margin-bottom:6px">${displayName}</div>`
      : '';
    document.getElementById('walletModalBody').innerHTML = `
      <div style="text-align:center;padding:10px 0 16px">
        ${avatarHtml}
        ${nameHtml}
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
      <div style="text-align:center;font-size:10px;color:#4b5563">EVM wallets · MetaMask</div>`;
  } else {
    // Mobile browser with no injected wallet → offer the MetaMask app hand-off
    // instead of an extension button that can never find window.ethereum there.
    const needsAppHandoff = _isMobileDevice() && !window.ethereum;
    const subtitle = needsAppHandoff
      ? 'Open in the MetaMask app'
      : (_isInMetaMaskApp() ? 'Connected via MetaMask app browser' : 'Browser extension wallet');
    document.getElementById('walletModalBody').innerHTML = `
      <button id="mmBtn" onclick="privyConnectMM()" style="width:100%;display:flex;align-items:center;gap:12px;background:#13161d;border:1px solid #2d3144;border-radius:10px;padding:14px 16px;cursor:pointer;margin-bottom:10px;transition:border-color 0.15s">
        <img src="https://upload.wikimedia.org/wikipedia/commons/3/36/MetaMask_Fox.svg" width="28" height="28"/>
        <div style="text-align:left">
          <div style="font-size:12px;font-weight:700;color:#e2e8f0;font-family:monospace">MetaMask</div>
          <div style="font-size:10px;color:#8b92a8">${subtitle}</div>
        </div>
      </button>
      ${needsAppHandoff ? `<div style="text-align:center;font-size:10px;color:#6b7280;padding:0 4px 10px">Tap above to continue in the MetaMask app — it'll reopen this page inside its browser so you can connect.</div>` : ''}
      <div style="text-align:center;font-size:10px;color:#8b92a8;padding-top:10px">EVM wallets · MetaMask</div>`;
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
  // Expose wallet for chat (and clear it on disconnect — was previously left stale)
  if (user) {
    window._privyWallet = user._displayAddress || user.wallet?.address
      || user.linked_accounts?.find(a => a.type === 'wallet')?.address || null;
  } else {
    window._privyWallet = null;
  }
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
  // Sync trade panel wallet status
  if (typeof _tradeWalletStatus === 'function') {
    _tradeWalletStatus();
    if (_tradeToken) _loadPayBalance();
    _holdingsLoaded = false;
    if (document.getElementById('page-trade')?.classList.contains('active')) tradeLoadHoldings(true);
  }
  // Re-check community token-gates for the new/cleared wallet
  if (typeof checkChatGates === 'function') checkChatGates();
  // Hide/show the username section in the profile popup to match wallet state
  if (typeof _chatNameRenderState === 'function') _chatNameRenderState();
}

// ── Cached profile for current wallet ────────────────────────────────────────
let _userProfile = null; // { displayName, avatar }

function _setAvatarEl(el, avatar, fallbackLetter) {
  if (!el) return;
  if (avatar) {
    el.innerHTML = `<img src="${avatar}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
  } else {
    el.innerHTML = fallbackLetter || 'P';
  }
}

function _applyProfile(profile) {
  _userProfile = profile;
  const fallback = (window._privyWallet || '?').charAt(0).toUpperCase();
  // Profile popup avatar
  const popupAvatar = document.getElementById('popupAvatar');
  _setAvatarEl(popupAvatar, profile?.avatar, fallback);
  // Sidebar avatar
  const avatarEl = document.getElementById('sidebarAvatar');
  _setAvatarEl(avatarEl, profile?.avatar, fallback);
  // Wallet button top-right
  const walletBtnAvatar = document.getElementById('walletBtnAvatar');
  const walletBtnIcon   = document.getElementById('walletBtnIcon');
  const label = document.getElementById('connectWalletLabel');
  if (walletBtnAvatar && walletBtnIcon && label && window._privyWallet) {
    if (profile?.avatar || profile?.displayName) {
      _setAvatarEl(walletBtnAvatar, profile.avatar, fallback);
      walletBtnAvatar.style.display = 'flex';
      walletBtnIcon.style.display   = 'none';
      if (profile.displayName) label.textContent = profile.displayName;
    } else {
      walletBtnAvatar.style.display = 'none';
      walletBtnIcon.style.display   = '';
    }
  }
  // Pre-fill chat name input
  const inp = document.getElementById('chatNameInput');
  if (profile?.displayName && !_chatName) {
    _chatName = profile.displayName;
    localStorage.setItem('bloomChatName', _chatName);
  }
}

async function loadUserProfile(wallet) {
  if (!wallet) return;
  try {
    const r = await fetch(`${API_BASE}/profile/${encodeURIComponent(wallet)}`);
    const d = await r.json();
    if (d.found) _applyProfile({ displayName: d.displayName, avatar: d.avatar });
    else _applyProfile(null);
  } catch (_) {}
}

async function saveProfile() {
  const wallet = window._privyWallet;
  if (!wallet) return showToast('Connect wallet first');
  const name   = (document.getElementById('chatNameInput')?.value || '').trim();
  const avatar = _pendingProfileAvatar || _userProfile?.avatar || null;
  const body   = { wallet, displayName: name || _userProfile?.displayName || null, avatar };
  try {
    await fetch(`${API_BASE}/profile`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    _applyProfile({ displayName: body.displayName, avatar: body.avatar });
    _pendingProfileAvatar = null;
    _refreshMyMessages();
    const st = document.getElementById('profileAvatarStatus');
    if (st) st.textContent = 'Profile saved!';
    setTimeout(() => { if (st) st.textContent = 'Click photo to change'; }, 2500);
  } catch (_) { showToast('Failed to save profile'); }
}

let _pendingProfileAvatar = null;

window.profileAvatarClick = function() {
  if (!window._privyWallet) { showToast('Connect your wallet first'); return; }
  document.getElementById('profileAvatarInput')?.click();
};

window.profileAvatarPicked = function(input) {
  if (!window._privyWallet) { showToast('Connect your wallet first'); input.value = ''; return; }
  const file = input.files?.[0];
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) { showToast('Image too large (max 5MB)'); input.value = ''; return; }
  const st = document.getElementById('profileAvatarStatus');
  if (st) st.textContent = 'Processing…';
  const reader = new FileReader();
  reader.onload = e => {
    const img = new Image();
    img.onload = () => {
      const MAX = 256;
      const canvas = document.createElement('canvas');
      const ratio = Math.min(MAX / img.width, MAX / img.height, 1);
      canvas.width  = Math.round(img.width  * ratio);
      canvas.height = Math.round(img.height * ratio);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      const b64 = canvas.toDataURL('image/jpeg', 0.85);
      _pendingProfileAvatar = b64;
      const popupAvatar = document.getElementById('popupAvatar');
      _setAvatarEl(popupAvatar, b64, null);
      if (st) st.textContent = 'Saving…';
      saveProfile();
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
  input.value = '';
};

function _setAvatarEditEnabled(enabled) {
  const wrap = document.getElementById('profileAvatarWrap');
  const dot  = document.getElementById('profileAvatarEditDot');
  const st   = document.getElementById('profileAvatarStatus');
  if (wrap) { wrap.style.cursor = enabled ? 'pointer' : 'not-allowed'; wrap.style.opacity = enabled ? '1' : '0.5'; }
  if (dot)  dot.style.display = enabled ? 'flex' : 'none';
  if (st)   st.textContent = enabled ? 'Click photo to change' : 'Connect wallet to set a photo';
}

function _updateSidebarProfile(user) {
  const walletEl  = document.getElementById('sidebarWallet');
  const popupFull = document.getElementById('popupWalletFull');
  const statusDot  = document.getElementById('popupStatusDot');
  const statusText = document.getElementById('popupStatusText');
  const statusBadge = document.getElementById('popupStatusBadge');
  const walletBox   = document.getElementById('popupWalletBox');
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
    const fallback = display.charAt(0).toUpperCase() || 'P';
    const popupAvatar = document.getElementById('popupAvatar');
    _setAvatarEl(popupAvatar, _userProfile?.avatar, fallback);
    const avatarEl = document.getElementById('sidebarAvatar');
    _setAvatarEl(avatarEl, _userProfile?.avatar, fallback);
    if (popupFull) popupFull.textContent = display || '—';
    if (statusText)  statusText.textContent = 'CONNECTED';
    if (statusDot)   statusDot.style.background = '#27c97f';
    if (statusBadge) { statusBadge.style.background = '#27c97f15'; statusBadge.style.borderColor = '#27c97f30'; statusText.style.color = '#27c97f'; }
    if (walletBox)   walletBox.style.display = '';
    _setAvatarEditEnabled(true);
    // Load profile from server
    loadUserProfile(window._privyWallet);
  } else {
    walletEl.textContent = 'Not connected';
    const avatarEl = document.getElementById('sidebarAvatar');
    if (avatarEl) avatarEl.innerHTML = 'P';
    const popupAvatar = document.getElementById('popupAvatar');
    if (popupAvatar) popupAvatar.innerHTML = 'P';
    if (popupFull) popupFull.textContent = '—';
    if (statusText)  statusText.textContent = 'NOT CONNECTED';
    if (statusDot)   statusDot.style.background = '#6b7280';
    if (statusBadge) { statusBadge.style.background = '#6b728015'; statusBadge.style.borderColor = '#6b728030'; statusText.style.color = '#8b92a8'; }
    if (walletBox)   walletBox.style.display = 'none';
    _setAvatarEditEnabled(false);
    _userProfile = null;
    // Reset wallet button
    const walletBtnAvatar = document.getElementById('walletBtnAvatar');
    const walletBtnIcon   = document.getElementById('walletBtnIcon');
    if (walletBtnAvatar) walletBtnAvatar.style.display = 'none';
    if (walletBtnIcon)   walletBtnIcon.style.display   = '';
  }
}

window.toggleProfilePopup = () => {
  const popup   = document.getElementById('profilePopup');
  const overlay = document.getElementById('profileModalOverlay');
  if (!popup) return;
  const open = popup.style.display === 'none';
  popup.style.display   = open ? 'block' : 'none';
  if (overlay) overlay.style.display = open ? 'block' : 'none';
  if (open) {
    const inp = document.getElementById('chatNameInput');
    if (inp) { inp.value = ''; inp.placeholder = _chatName || 'Set your chat name…'; }
    _setAvatarEditEnabled(!!window._privyWallet);
    _chatNameRenderState();
  }
};
window.__profileCopy = () => {
  const addr = document.getElementById('popupWalletFull')?.textContent;
  if (!addr || addr === '—') return showToast('No wallet connected');
  navigator.clipboard.writeText(addr).then(() => showToast('Wallet address copied!'));
};
window.__profileDisconnect = async () => {
  document.getElementById('profilePopup').style.display = 'none';
  await privyLogout();
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

/* ─── Narrative Tracker ───────────────────────────────────────────────────── */
let _narrativeData = [];
let _narrativeSort = 'change';

async function loadNarrative() {
  const grid = $('narrativeGrid');
  if (!grid) return;
  grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:60px;color:var(--text-muted);font-size:13px">
    <div style="font-size:24px;margin-bottom:10px">📡</div>Fetching market narratives…</div>`;
  try {
    const res  = await fetch(`${API_BASE}/narrative`);
    const json = await res.json();
    if (!json.success) throw new Error(json.error);
    _narrativeData = json.data;
    renderNarrativeGrid();

    // wire sort buttons
    document.querySelectorAll('.narr-sort-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.narr-sort-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        _narrativeSort = btn.dataset.sort;
        renderNarrativeGrid();
      });
    });
  } catch(e) {
    grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:60px;color:#F0484B;font-size:13px">⚠ ${e.message}</div>`;
  }
}

function renderNarrativeGrid() {
  const grid = $('narrativeGrid');
  if (!grid || !_narrativeData.length) return;

  const sorted = [..._narrativeData].sort((a, b) => {
    if (_narrativeSort === 'change')  return b.change24h - a.change24h;
    if (_narrativeSort === 'losers')  return a.change24h - b.change24h;
    return b.marketCap - a.marketCap;
  });

  const fmtMcap = v => v >= 1e9 ? `$${(v/1e9).toFixed(2)}B` : v >= 1e6 ? `$${(v/1e6).toFixed(1)}M` : `$${Math.round(v).toLocaleString()}`;
  const fmtChg  = v => (v >= 0 ? '+' : '') + v.toFixed(2) + '%';

  grid.innerHTML = sorted.map(n => {
    const chg    = n.change24h || 0;
    const signal = chg > 2 ? 'bullish' : chg < -2 ? 'bearish' : 'neutral';
    const color  = signal === 'bullish' ? '#27c97f' : signal === 'bearish' ? '#F0484B' : '#6b7280';
    const coinImgs = (n.topCoins || []).map(url =>
      `<img src="${url}" style="width:20px;height:20px;border-radius:50%;border:2px solid var(--bg-card);margin-left:-6px;object-fit:cover" onerror="this.style.display='none'">`
    ).join('');

    return `
      <div class="narr-card ${signal}">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:12px">
          <div style="display:flex;align-items:center;gap:8px">
            <span style="font-size:22px">${n.icon}</span>
            <div>
              <div style="font-size:13px;font-weight:700;color:var(--text-primary)">${n.label}</div>
            </div>
          </div>
          <div style="text-align:right">
            <div style="font-size:15px;font-weight:800;color:${color}">${fmtChg(chg)}</div>
            <div style="font-size:9px;color:var(--text-muted);margin-top:1px">24h</div>
          </div>
        </div>
        <div style="display:flex;align-items:center;justify-content:space-between">
          <div>
            <div style="font-size:10px;color:var(--text-muted);margin-bottom:2px">MARKET CAP</div>
            <div style="font-size:13px;font-weight:700;color:var(--text-primary)">${fmtMcap(n.marketCap)}</div>
          </div>
          <div style="display:flex;margin-right:6px">${coinImgs}</div>
        </div>
        <div style="margin-top:10px;height:3px;background:var(--border-light);border-radius:2px;overflow:hidden">
          <div style="height:100%;width:${Math.min(100,Math.abs(chg)*3)}%;background:${color};border-radius:2px;transition:width .5s ease"></div>
        </div>
      </div>`;
  }).join('');
}

async function loadLandingCA() {
  // $BBRK contract not deployed yet — keep the static "Not Live Yet" label,
  // don't fetch or overwrite it with a real/masked address.
  const el = document.getElementById('landingCA');
  const copyBtn = document.getElementById('landingCACopy');
  if (!el) return;
  el.textContent = 'Not Live Yet';
  el.style.color = '#4b5563';
  el.title = 'Contract address will be revealed at launch';
  if (copyBtn) copyBtn.style.display = 'none';
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


// ── MetaMask mobile app support ──────────────────────────────────────────────
// On a phone with no injected provider (i.e. a normal mobile browser, not the
// MetaMask app's own in-app browser), there's nothing to connect to — MetaMask
// only injects window.ethereum inside its own in-app browser. The fix is to
// hand off to the MetaMask app via its official deep link, which reopens this
// exact page inside MetaMask's in-app browser, where window.ethereum then
// exists and the normal eth_requestAccounts flow below works unchanged.
function _isMobileDevice() {
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}
function _isInMetaMaskApp() {
  return !!(window.ethereum && window.ethereum.isMetaMask);
}
function metamaskDeepLink() {
  const noProtocol = location.host + location.pathname + location.search;
  return `https://metamask.app.link/dapp/${noProtocol}`;
}
window.connectMetaMaskMobile = function() {
  window.location.href = metamaskDeepLink();
};

// Direct MetaMask (EVM) connection — no Privy / SIWE signature required
async function privyConnectMM() {
  // Mobile browser with no injected wallet → hand off to the MetaMask app
  if (_isMobileDevice() && !window.ethereum) {
    connectMetaMaskMobile();
    return;
  }
  const btn = document.getElementById('mmBtn');
  if (btn) { btn.style.opacity = '0.6'; btn.style.pointerEvents = 'none'; btn.querySelector('div div').textContent = 'Connecting…'; }
  try {
    if (!window.ethereum) throw new Error('MetaMask extension not found — install it first');
    const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
    const wallet = accounts?.[0];
    if (!wallet) throw new Error('No account selected');
    const user = { wallet: { address: wallet }, _displayAddress: wallet };
    await _bbLogin(wallet, null, 'metamask');
    localStorage.removeItem('bb_wallet_disconnected'); // user explicitly (re)connected
    _setWalletConnected(user);
    closeWalletModal();
    showToast('Wallet connected');
  } catch(e) {
    const msg = e.code === 4001 ? 'Connection rejected in MetaMask' : (e.message || 'Unknown error');
    showToast('Connection failed: ' + msg);
    if (btn) { btn.style.opacity = ''; btn.style.pointerEvents = ''; btn.querySelector('div div').textContent = 'MetaMask'; }
  }
}

async function privyLogout() {
  await _bbLogout();
  localStorage.setItem('bb_wallet_disconnected', '1'); // remember: user explicitly disconnected
  _setWalletConnected(null);
  closeWalletModal();
  showToast('Wallet disconnected');
}

// React to account switch / disconnect in MetaMask
if (window.ethereum?.on) {
  window.ethereum.on('accountsChanged', (accounts) => {
    if (!accounts?.length) {
      localStorage.setItem('bb_wallet_disconnected', '1');
      _bbLogout(); _setWalletConnected(null); showToast('Wallet disconnected'); return;
    }
    localStorage.removeItem('bb_wallet_disconnected');
    const wallet = accounts[0];
    _bbLogin(wallet, null, 'metamask');
    _setWalletConnected({ wallet: { address: wallet }, _displayAddress: wallet });
    showToast('Switched to ' + wallet.slice(0,6) + '…' + wallet.slice(-4));
  });
}

// Init on page load — cookie/JWT auto-login, then silent MetaMask reconnect
(async function() {
  try {
    // 0. User explicitly disconnected last time — don't auto-reconnect,
    //    even though MetaMask itself still has this site "authorized".
    if (localStorage.getItem('bb_wallet_disconnected') === '1') { _setWalletConnected(null); return; }

    // 1. Check if backend session still valid (cookie auto-login)
    const bbUser = await _bbMe();
    if (bbUser) {
      const displayAddr = bbUser.generated_address || bbUser.wallet;
      _setWalletConnected({ _displayAddress: displayAddr, _fromDb: true, id: bbUser.id });
      return;
    }
    // 2. Silent reconnect if MetaMask is already authorized for this site
    if (!window.ethereum) { _setWalletConnected(null); return; }
    const accounts = await window.ethereum.request({ method: 'eth_accounts' });
    const wallet = accounts?.[0];
    if (wallet) {
      await _bbLogin(wallet, null, 'metamask');
      _setWalletConnected({ wallet: { address: wallet }, _displayAddress: wallet });
    } else {
      _setWalletConnected(null);
    }
  } catch(_) {
    _setWalletConnected(null);
  }
})();

/* ─── Community Chat ────────────────────────────────────────────────────────── */
const CHAT_ROOMS = {
  general:   { name: 'General',    icon: '💬', desc: 'General discussion' },
  trading:   { name: 'Trading',    icon: '📈', desc: 'Token analysis & calls' },
  alpha:     { name: 'Alpha',      icon: '🔥', desc: 'Early alpha & gems' },
  freeshill: { name: 'Free Shill', icon: '📣', desc: 'Shill your token here 🚀' },
  holders:   { name: 'Holders',    icon: '💎', desc: 'Token holders only', gated: true },
};

// Token-gate state: room -> { ok, balance, minAmount, symbol, network, token }
let _chatGates = {};
function _roomLocked(room) {
  return !!CHAT_ROOMS[room]?.gated && !_chatGates[room]?.ok;
}

// Update a gated room's sidebar description from its live gate config
function _applyGateDesc(room) {
  const g = _chatGates[room];
  if (g && CHAT_ROOMS[room]) {
    CHAT_ROOMS[room].desc = `Hold ≥ ${g.minAmount} ${g.symbol} to unlock`;
  }
}

// Fetch gate status for the connected wallet, then refresh room UI
async function checkChatGates() {
  const wallet = window._privyWallet || 'none';
  try {
    const res = await fetch(`${API_BASE}/community/gate/${wallet}`);
    const j = await res.json();
    _chatGates = j.gates || {};
  } catch (_) { _chatGates = {}; }
  Object.keys(_chatGates).forEach(_applyGateDesc);
  renderChatRooms();
  if (CHAT_ROOMS[_chatRoom]?.gated) switchChatRoom(_chatRoom); // refresh lock screen if viewing a gated room
}

let _chatWs        = null;
let _chatRoom      = 'general';
let _chatMessages  = {};   // room -> [{...}]
let _chatUnread    = {};   // room -> count
let _chatConnected = false;
let _chatName      = localStorage.getItem('bloomChatName') || null;
let _chatNameEdits = parseInt(localStorage.getItem('bloomChatNameEdits') || '0', 10);

const AVATAR_COLORS = ['#f59e0b','#3b82f6','#8b5cf6','#ec4899','#10b981','#ef4444','#06b6d4','#f97316'];
function avatarColor(str) {
  let h = 0; for (const c of (str||'?')) h = (h * 31 + c.charCodeAt(0)) & 0xffff;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}
function avatarLetter(name) { return (name||'?')[0].toUpperCase(); }

function fmtChatTime(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function initCommunity() {
  checkChatGates();
  if (_chatWs && _chatWs.readyState === WebSocket.OPEN) {
    renderChatRooms();
    switchChatRoom(_chatRoom);
    return;
  }
  renderChatRooms();
  connectChat();
}

function connectChat() {
  const wsUrl = API_BASE.replace('http', 'ws').replace('/api', '') || `ws://${location.host}`;
  _chatWs = new WebSocket(wsUrl);

  _chatWs.onopen = () => {
    _chatConnected = true;
    // Get wallet from Privy or generate anon name
    const wallet = window._privyWallet || null;
    _chatName = _chatName || (wallet ? wallet.slice(0,4)+'...'+wallet.slice(-4) : 'Anon#'+Math.floor(Math.random()*9999));
    _chatWs.send(JSON.stringify({ type: 'chat_join', wallet, displayName: _chatName, avatar: _userProfile?.avatar || null }));
    if ($('chatNameInput') && !$('chatNameInput').value) $('chatNameInput').placeholder = _chatName;
    appendChatSystem('general', '🟢 Connected to Bloombark Community');
  };

  _chatWs.onmessage = (e) => {
    try {
      const d = JSON.parse(e.data);
      if (d.type === 'chat_history') {
        _chatMessages = {};
        for (const [room, msgs] of Object.entries(d.history || {})) _chatMessages[room] = msgs;
        if (d.gates) { _chatGates = { ..._chatGates, ...d.gates }; Object.keys(_chatGates).forEach(_applyGateDesc); renderChatRooms(); }
        updateOnlineCount(d.online || 0);
        if (CHAT_ROOMS[_chatRoom]?.gated) switchChatRoom(_chatRoom); else renderChatMessages();
      } else if (d.type === 'chat_gate_denied') {
        showToast(`🔒 ${CHAT_ROOMS[d.room]?.name || 'Channel'} locked — need ≥ ${d.minAmount} ${d.symbol} (you have ${(+d.balance).toFixed(4)})`);
      } else if (d.type === 'chat_msg') {
        const msg = d.msg;
        if (!_chatMessages[msg.room]) _chatMessages[msg.room] = [];
        _chatMessages[msg.room].push(msg);
        updateOnlineCount(d.online || 0);
        if (msg.room === _chatRoom) {
          appendChatMessage(msg);
          scrollChatBottom();
        } else {
          _chatUnread[msg.room] = (_chatUnread[msg.room] || 0) + 1;
          updateRoomUnread(msg.room);
        }
      } else if (d.type === 'chat_online') {
        updateOnlineCount(d.online || 0);
      } else if (d.type === 'chat_nameok') {
        _chatName = d.displayName;
        if ($('chatNameInput')) $('chatNameInput').placeholder = _chatName;
        appendChatSystem(_chatRoom, `✏️ Name changed to "${_chatName}"`);
      }
    } catch(_) {}
  };

  _chatWs.onclose = () => {
    _chatConnected = false;
    appendChatSystem('general', '🔴 Disconnected. Reconnecting in 3s…');
    setTimeout(connectChat, 3000);
  };

  _chatWs.onerror = () => _chatWs.close();
}

function renderChatRooms() {
  const el = $('chatRoomList');
  if (!el) return;
  el.innerHTML = Object.entries(CHAT_ROOMS).map(([id, r]) => {
    const locked = _roomLocked(id);
    return `
    <button class="chat-room-btn ${id === _chatRoom ? 'active' : ''}" onclick="switchChatRoom('${id}')" ${locked ? 'title="Locked — holders only"' : ''}>
      <span>${r.icon}</span><span style="${locked ? 'opacity:.55' : ''}">${r.name}</span>
      ${locked ? '<span style="margin-left:auto;font-size:11px">🔒</span>' : `<span class="room-unread" id="unread-${id}">${_chatUnread[id]||''}</span>`}
    </button>`;
  }).join('');
}

function switchChatRoom(room) {
  _chatRoom = room;
  _chatUnread[room] = 0;
  const r = CHAT_ROOMS[room];
  if ($('chatRoomIcon'))  $('chatRoomIcon').textContent  = r.icon;
  if ($('chatRoomName'))  $('chatRoomName').textContent  = r.name;
  if ($('chatRoomDesc'))  $('chatRoomDesc').textContent  = r.desc;
  if ($('chatInput'))     $('chatInput').placeholder     = `Message #${r.name.toLowerCase()}…`;
  renderChatRooms();

  const locked = _roomLocked(room);
  const inputBar = $('chatInputBar');
  if (inputBar) inputBar.style.display = locked ? 'none' : 'flex';
  if (locked) { renderChatLockScreen(room); return; }

  renderChatMessages();
  scrollChatBottom();
}

function renderChatLockScreen(room) {
  const el = $('chatMessages');
  if (!el) return;
  const g = _chatGates[room] || {};
  const min     = g.minAmount ?? 0;
  const symbol  = g.symbol || 'TOKEN';
  const network = g.network || '';
  const token   = g.token || '';
  const connected = !!window._privyWallet;
  const bal = connected
    ? `You have <b style="color:#e2e8f0">${(+g.balance || 0).toLocaleString('en-US',{maximumFractionDigits:4})} ${symbol}</b>`
    : 'Connect your wallet to check eligibility';
  const tokenLine = token
    ? `<div style="font-size:10px;color:#4b5563;font-family:monospace;margin-top:2px">${symbol}${network ? ' · ' + network : ''} · ${token.slice(0,10)}…${token.slice(-8)}</div>`
    : '';
  el.innerHTML = `
    <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:40px 20px;gap:14px">
      <div style="font-size:52px;line-height:1">🔒</div>
      <div style="font-size:17px;font-weight:800;color:var(--text-primary)">Holders Only</div>
      <div style="font-size:13px;color:var(--text-muted);line-height:1.6;max-width:360px">
        This channel is locked. You need to hold at least <b style="color:#27c97f">${min} ${symbol}</b>${network ? ` on <b style="color:#27c97f">${network}</b>` : ''} to unlock it.<br>${bal}
      </div>
      ${tokenLine}
      <div style="display:flex;gap:10px;margin-top:6px">
        ${connected
          ? `<button onclick="checkChatGates()" style="background:#27c97f15;border:1px solid #27c97f40;color:#27c97f;font-size:12px;font-weight:700;padding:9px 20px;border-radius:8px;cursor:pointer">↻ Re-check balance</button>`
          : `<button onclick="openWalletModal()" style="background:#27c97f;border:none;color:#000;font-size:12px;font-weight:800;padding:9px 22px;border-radius:8px;cursor:pointer">Connect Wallet</button>`}
      </div>
    </div>`;
}

function renderChatMessages() {
  const el = $('chatMessages');
  if (!el) return;
  const msgs = _chatMessages[_chatRoom] || [];
  if (!msgs.length) {
    el.innerHTML = `<div class="chat-system">No messages yet. Say hi! 👋</div>`;
    return;
  }
  el.innerHTML = msgs.map(m => buildMsgHtml(m)).join('');
}

function _refreshMyMessages() {
  // Update displayName + avatar on all cached messages that belong to me, then re-render
  const wallet = window._privyWallet;
  for (const msgs of Object.values(_chatMessages)) {
    for (const m of msgs) {
      if (wallet && m.wallet === wallet) {
        if (_chatName)            m.displayName = _chatName;
        if (_userProfile?.avatar !== undefined) m.avatar = _userProfile?.avatar || null;
      }
    }
  }
  renderChatMessages();
}

function isMine(m) {
  if (_chatName && m.displayName === _chatName) return true;
  if (window._privyWallet && m.wallet === window._privyWallet) return true;
  return false;
}

function _chatAvatarHtml(m, size = 30) {
  const color  = avatarColor(m.wallet || m.displayName);
  const letter = avatarLetter(m.displayName);
  if (m.avatar) {
    return `<div style="width:${size}px;height:${size}px;border-radius:50%;overflow:hidden;flex-shrink:0"><img src="${m.avatar}" style="width:100%;height:100%;object-fit:cover"></div>`;
  }
  return `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};display:flex;align-items:center;justify-content:center;font-size:${Math.round(size*0.4)}px;font-weight:800;color:#000;flex-shrink:0">${letter}</div>`;
}

function buildMsgHtml(m) {
  const mine    = isMine(m);
  const safe    = (m.text||'').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const avatarHtml = _chatAvatarHtml(m, 30);

  const textHtml = safe.replace(/(https?:\/\/[^\s]+)/g, (url) => {
    if (/\.(jpg|jpeg|png|gif|webp)(\?|$)/i.test(url))
      return `<br><img src="${url}" style="max-width:260px;max-height:200px;border-radius:8px;margin-top:6px;cursor:pointer;display:block" onclick="chatZoomImg('${url}')" onerror="this.style.display='none'">`;
    return `<a href="${url}" target="_blank" rel="noopener" style="color:${mine?'#a7f3d0':'var(--accent-blue)'}">${url}</a>`;
  });
  const imgHtml = m.imgData
    ? `<div style="margin-top:6px"><img src="${m.imgData}" style="max-width:260px;max-height:200px;border-radius:8px;cursor:pointer;display:block" onclick="chatZoomImg(this.src)"></div>`
    : '';

  if (mine) {
    return `<div style="display:flex;justify-content:flex-end;padding:3px 0;gap:8px;align-items:flex-end">
      <div style="max-width:72%;display:flex;flex-direction:column;align-items:flex-end">
        <span style="font-size:10px;color:var(--text-muted);margin-bottom:3px">${fmtChatTime(m.ts)}</span>
        <div style="background:#27c97f;color:#000;padding:9px 13px;border-radius:16px 16px 4px 16px;font-size:13px;line-height:1.5;word-break:break-word;max-width:100%">
          ${textHtml}${imgHtml}
        </div>
      </div>
      ${avatarHtml}
    </div>`;
  }

  return `<div style="display:flex;padding:3px 0;gap:8px;align-items:flex-end">
    ${avatarHtml}
    <div style="max-width:72%;display:flex;flex-direction:column;align-items:flex-start">
      <span style="font-size:10px;color:var(--text-muted);margin-bottom:3px">${m.displayName} · ${fmtChatTime(m.ts)}</span>
      <div style="background:var(--bg-card);border:1px solid var(--border-light);color:var(--text-primary);padding:9px 13px;border-radius:16px 16px 16px 4px;font-size:13px;line-height:1.5;word-break:break-word;max-width:100%">
        ${textHtml}${imgHtml}
      </div>
    </div>
  </div>`;
}

function appendChatMessage(m) {
  const el = $('chatMessages');
  if (!el) return;
  // Remove "no messages" placeholder
  if (el.querySelector('.chat-system')) el.innerHTML = '';
  const div = document.createElement('div');
  div.innerHTML = buildMsgHtml(m);
  el.appendChild(div.firstElementChild);
}

function appendChatSystem(room, text) {
  if (room !== _chatRoom) return;
  const el = $('chatMessages');
  if (!el) return;
  const div = document.createElement('div');
  div.className = 'chat-system';
  div.textContent = text;
  el.appendChild(div);
  scrollChatBottom();
}

function scrollChatBottom() {
  const el = $('chatMessages');
  if (el) el.scrollTop = el.scrollHeight;
}

function updateOnlineCount(n) {
  if ($('chatOnlineCount'))   $('chatOnlineCount').textContent  = n;
  if ($('chatOnlineHeader'))  $('chatOnlineHeader').textContent = `${n} online`;
  if ($('chatOnlineBadge')) {
    $('chatOnlineBadge').textContent = n;
    $('chatOnlineBadge').style.display = n > 0 ? 'inline' : 'none';
  }
}

function updateRoomUnread(room) {
  const el = $(`unread-${room}`);
  if (!el) return;
  const n = _chatUnread[room] || 0;
  el.textContent = n || '';
  el.style.display = n > 0 ? 'inline' : 'none';
}

let _chatPendingImg = null;

function chatSend() {
  const inp = $('chatInput');
  if (!inp || !_chatConnected || !_chatWs) return;
  if (_roomLocked(_chatRoom)) { showToast('🔒 This channel is locked'); return; }
  const text = inp.value.trim();
  if (!text && !_chatPendingImg) return;
  _chatWs.send(JSON.stringify({ type: 'chat_msg', room: _chatRoom, text, imgData: _chatPendingImg || null }));
  inp.value = '';
  chatClearImg();
  closeEmojiPicker();
}

function chatLoadImg(input) {
  const file = input.files[0];
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) { alert('Image too large (max 2MB)'); input.value=''; return; }
  const reader = new FileReader();
  reader.onload = (e) => {
    // Compress via canvas
    const img = new Image();
    img.onload = () => {
      const MAX = 800;
      let w = img.width, h = img.height;
      if (w > MAX || h > MAX) { if (w > h) { h = h/w*MAX; w = MAX; } else { w = w/h*MAX; h = MAX; } }
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      _chatPendingImg = canvas.toDataURL('image/jpeg', 0.75);
      const preview = $('chatImgPreview');
      const thumb = $('chatImgThumb');
      if (preview && thumb) { thumb.src = _chatPendingImg; preview.style.display = 'flex'; }
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
  input.value = '';
}

function chatClearImg() {
  _chatPendingImg = null;
  const preview = $('chatImgPreview');
  if (preview) preview.style.display = 'none';
  const inp = $('chatImgInput');
  if (inp) inp.value = '';
}

function chatZoomImg(src) {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:#000b;z-index:9999;display:flex;align-items:center;justify-content:center;cursor:zoom-out';
  overlay.innerHTML = `<img src="${src}" style="max-width:90vw;max-height:90vh;border-radius:10px;box-shadow:0 0 40px #0008">`;
  overlay.onclick = () => overlay.remove();
  document.body.appendChild(overlay);
}

// ── Emoji Picker ──
const EMOJIS = [
  '😀','😂','🤣','😍','🥰','😎','🤩','🥳','😤','🤔','🫡','🤫','😱','🫣',
  '🔥','💎','🚀','🌙','💰','📈','📉','💸','🤑','💯','✅','❌','⚡','👀','🫀',
  '👍','👎','👏','🙏','💪','🫶','✌️','🤝','💀','👻','🎯','🎰','🎲','🏆',
  '🐋','🦈','🐂','🐸','🦍','🐉','🦁','🐺','🦊','🐻','🐼','🐨','🦄',
  '💬','📣','🔔','⚠️','❓','❗','💡','🔑','🛡️','⚔️','🎪','🎭','🎨',
];

let _emojiOpen = false;

function toggleEmojiPicker() {
  const el = $('emojiPicker');
  if (!el) return;
  _emojiOpen = !_emojiOpen;
  if (_emojiOpen) {
    el.style.display = 'flex';
    el.innerHTML = EMOJIS.map(e =>
      `<span onclick="insertEmoji('${e}')" style="font-size:20px;cursor:pointer;padding:4px;border-radius:4px;line-height:1;transition:transform .1s"
        onmouseover="this.style.transform='scale(1.3)'" onmouseout="this.style.transform=''">${e}</span>`
    ).join('');
  } else {
    el.style.display = 'none';
  }
}

function closeEmojiPicker() {
  _emojiOpen = false;
  const el = $('emojiPicker');
  if (el) el.style.display = 'none';
}

function insertEmoji(e) {
  const inp = $('chatInput');
  if (!inp) return;
  const pos = inp.selectionStart || inp.value.length;
  inp.value = inp.value.slice(0, pos) + e + inp.value.slice(pos);
  inp.focus();
  inp.setSelectionRange(pos + e.length, pos + e.length);
}

const MAX_NAME_EDITS = 2;

function _chatNameRenderState() {
  const section = $('usernameSection');
  const view    = $('chatNameView');
  const edit    = $('chatNameEdit');
  const display = $('chatNameDisplay');
  const editBtn = $('chatNameEditBtn');
  const counter = $('chatNameEditsLeft');
  if (!view || !edit) return;

  // No wallet connected → hide the username section entirely
  if (!window._privyWallet) {
    if (section) section.style.display = 'none';
    return;
  }
  if (section) section.style.display = '';

  const remaining = MAX_NAME_EDITS - _chatNameEdits;

  if (_chatName) {
    // Show view state
    view.style.display = 'flex';
    edit.style.display = 'none';
    if (display) display.textContent = _chatName;
    if (editBtn) {
      if (remaining <= 0) {
        editBtn.style.display = 'none';
      } else {
        editBtn.style.display = '';
        editBtn.disabled = false;
      }
    }
    if (counter) counter.textContent = remaining > 0 ? `${remaining} edit${remaining === 1 ? '' : 's'} left` : 'no edits left';
  } else {
    // No name yet — show edit state
    view.style.display = 'none';
    edit.style.display = 'flex';
    if (counter) counter.textContent = `${remaining} edit${remaining === 1 ? '' : 's'} left`;
  }
}

window.chatNameStartEdit = function() {
  const remaining = MAX_NAME_EDITS - _chatNameEdits;
  if (remaining <= 0) return;
  const view = $('chatNameView');
  const edit = $('chatNameEdit');
  const cancelBtn = $('chatNameCancelBtn');
  if (view) view.style.display = 'none';
  if (edit) {
    edit.style.display = 'flex';
    const inp = $('chatNameInput');
    if (inp) { inp.value = _chatName || ''; inp.focus(); inp.select(); }
  }
  // Show cancel only if name already exists (editing, not first set)
  if (cancelBtn) cancelBtn.style.display = _chatName ? '' : 'none';
};

window.chatNameCancel = function() {
  const view = $('chatNameView');
  const edit = $('chatNameEdit');
  const inp  = $('chatNameInput');
  if (edit) edit.style.display = 'none';
  if (inp)  inp.value = '';
  if (view && _chatName) view.style.display = 'flex';
};

function chatSetName() {
  const inp = $('chatNameInput');
  if (!inp) return;
  const name = inp.value.trim();
  if (!name) return;

  const isFirstSet = !_chatName;
  if (!isFirstSet) {
    // Counts as an edit only if name already existed
    if (_chatNameEdits >= MAX_NAME_EDITS) return;
    _chatNameEdits++;
    localStorage.setItem('bloomChatNameEdits', String(_chatNameEdits));
  }

  localStorage.setItem('bloomChatName', name);
  _chatName = name;
  if (_chatWs && _chatConnected) {
    _chatWs.send(JSON.stringify({ type: 'chat_setname', name }));
  }
  inp.value = '';
  const st = $('chatNameStatus');
  if (st) { st.style.display = 'block'; setTimeout(() => st.style.display = 'none', 2500); }
  _chatNameRenderState();
  _refreshMyMessages();
  saveProfile();
}

// ─────────────────────────────────────────────────────────────────────────────
// BLOOMBARK TRADE — custom EVM swap via KyberSwap Aggregator
// ─────────────────────────────────────────────────────────────────────────────

// Fallback (mainnet) values — overwritten in-place by _loadNetworkConfig() once
// the backend's active NETWORK_ENV (testnet/mainnet) config is fetched.
const TRADE_CHAINS = {
  ethereum: { id: 1,     hex: '0x1',     native: 'ETH',   explorer: 'https://etherscan.io/tx/' },
  base:     { id: 8453,  hex: '0x2105',  native: 'ETH',   explorer: 'https://basescan.org/tx/' },
  arbitrum: { id: 42161, hex: '0xa4b1',  native: 'ETH',   explorer: 'https://arbiscan.io/tx/' },
  polygon:  { id: 137,   hex: '0x89',    native: 'MATIC', explorer: 'https://polygonscan.com/tx/' },
  optimism: { id: 10,    hex: '0xa',     native: 'ETH',   explorer: 'https://optimistic.etherscan.io/tx/' },
  robinhood:{ id: 4663,  hex: '0x1237',  native: 'ETH',   explorer: 'https://robinhoodchain.blockscout.com/tx/',
              rpc: 'https://rpc.mainnet.chain.robinhood.com', name: 'Robinhood Chain' },
};
const NATIVE_ADDR = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';
// DexScreener chainId → our chain key (mainnet slugs only — DexScreener/Kyber/
// GeckoTerminal don't index testnet liquidity, so price/trade data is unaffected
// by NETWORK_ENV; only wallet network-switching (TRADE_CHAINS below) is)
const DEXSCREENER_CHAIN_MAP = { ethereum:'ethereum', base:'base', arbitrum:'arbitrum', polygon:'polygon', optimism:'optimism', robinhood:'robinhood' };

let NETWORK_ENV  = 'mainnet';
let IS_TESTNET   = false;
const NATIVE_SYMBOL_BY_CHAIN = { ethereum:'ETH', base:'ETH', arbitrum:'ETH', polygon:'MATIC', optimism:'ETH', robinhood:'ETH' };

// Pulls the backend's active network config (testnet/mainnet) and patches
// TRADE_CHAINS in place so MetaMask network-switching targets the right chain.
async function _loadNetworkConfig() {
  try {
    const res = await fetch(`${API_BASE}/config/public`);
    const cfg = await res.json();
    NETWORK_ENV = cfg.networkEnv || 'mainnet';
    IS_TESTNET  = !!cfg.isTestnet;
    for (const [key, c] of Object.entries(cfg.chains || {})) {
      if (!TRADE_CHAINS[key] || !c) continue;
      TRADE_CHAINS[key] = {
        id: c.chainId, hex: c.hex, native: NATIVE_SYMBOL_BY_CHAIN[key] || 'ETH',
        explorer: c.explorer + '/tx/', rpc: c.rpc, name: c.name || key,
      };
    }
    _updateTestnetBadge();
  } catch (_) { /* keep mainnet fallback defaults */ }
}
_loadNetworkConfig();

function _updateTestnetBadge() {
  const badge = $('testnetBadge');
  if (badge) badge.style.display = IS_TESTNET ? '' : 'none';
}

let _tradeToken    = null;  // { address, symbol, name, chain, price, decimals }
let _tradeSide     = 'buy';
let _tradeSlippage = 1;
let _tradeQuote    = null;  // last routeSummary
let _tradeTimer    = null;
let _tradeBalance  = null;  // balance of the "pay" asset (float)

function initTradePage() {
  _tradeWalletStatus();
  tradeLoadHoldings();
}

// ── RPC helpers (via backend proxy to public nodes) ──────────────────────────
async function _rpc(chain, method, params) {
  const r = await fetch(`${API_BASE}/trade/rpc/${chain}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message || 'RPC error');
  return j.result;
}

async function _erc20Decimals(chain, token) {
  const hex = await _rpc(chain, 'eth_call', [{ to: token, data: '0x313ce567' }, 'latest']);
  return parseInt(hex, 16);
}
async function _erc20Balance(chain, token, owner) {
  const data = '0x70a08231' + owner.toLowerCase().replace('0x','').padStart(64, '0');
  const hex = await _rpc(chain, 'eth_call', [{ to: token, data }, 'latest']);
  return BigInt(hex === '0x' ? '0' : hex);
}
async function _nativeBalance(chain, owner) {
  const hex = await _rpc(chain, 'eth_getBalance', [owner, 'latest']);
  return BigInt(hex);
}
async function _erc20Allowance(chain, token, owner, spender) {
  const data = '0xdd62ed3e'
    + owner.toLowerCase().replace('0x','').padStart(64, '0')
    + spender.toLowerCase().replace('0x','').padStart(64, '0');
  const hex = await _rpc(chain, 'eth_call', [{ to: token, data }, 'latest']);
  return BigInt(hex === '0x' ? '0' : hex);
}

// Decimal string → BigInt raw units (no float precision loss)
function _toRaw(amountStr, decimals) {
  const [whole, frac = ''] = String(amountStr).split('.');
  const fracPadded = (frac + '0'.repeat(decimals)).slice(0, decimals);
  return BigInt(whole || '0') * (10n ** BigInt(decimals)) + BigInt(fracPadded || '0');
}
function _fromRaw(raw, decimals) {
  return Number(raw) / Math.pow(10, decimals);
}
function _fmtAmt(n) {
  if (!isFinite(n)) return '—';
  if (n === 0) return '0';
  if (n < 0.0001) {
    const leadZeros = (n.toFixed(20).match(/^0\.(0*)/) || [,''])[1].length;
    return n.toFixed(Math.min(leadZeros + 4, 18));
  }
  if (n >= 1e9) return (n/1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n/1e6).toFixed(2) + 'M';
  if (n >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
  return n.toLocaleString('en-US', { maximumFractionDigits: 6 });
}

// ── Load token ───────────────────────────────────────────────────────────────
const TRADE_LOADING_STEPS = [
  'Resolving token pair…',
  'Fetching on-chain decimals…',
  'Loading price & liquidity…',
  'Preparing swap panel…',
];

async function tradeLoadToken() {
  const addr = $('tradeTokenInput')?.value?.trim();
  if (!addr) return showToast('Paste a token address first');
  if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) return showToast('Invalid EVM address — must start with 0x');

  runLoadingSteps(async () => {
    try {
      const r = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${addr}`);
      const j = await r.json();
      const pairs = (j.pairs || [])
        .filter(p => DEXSCREENER_CHAIN_MAP[p.chainId])
        .sort((a,b) => (b.liquidity?.usd||0) - (a.liquidity?.usd||0));
      if (!pairs.length) throw new Error('Token not found on a supported EVM chain (Ethereum, Base, Arbitrum, Polygon, Optimism, Robinhood)');
      const p = pairs[0];
      const chain = DEXSCREENER_CHAIN_MAP[p.chainId];

      const decimals = await _erc20Decimals(chain, p.baseToken.address);

      _tradeToken = {
        address:  p.baseToken.address,
        symbol:   p.baseToken.symbol,
        name:     p.baseToken.name,
        chain,
        price:    parseFloat(p.priceUsd || 0),
        decimals,
      };
      _tradePairAddr  = p.pairAddress || null;
      _tradeCreatedAt = p.pairCreatedAt || null;

      // Token bar
      $('tradeTokenBar').style.display = 'flex';
      $('tradeTokenSymbol').textContent = _tradeToken.symbol;
      $('tradeTokenName').textContent   = _tradeToken.name;
      $('tradeChainBadge').textContent  = chain.toUpperCase();
      $('tradeTokenAddr').textContent   = addr.slice(0,10) + '…' + addr.slice(-8);
      $('tradeTokenPrice').textContent  = fmt.price(_tradeToken.price);
      const chg = parseFloat(p.priceChange?.h24 ?? 0);
      const chgEl = $('tradeTokenChange');
      chgEl.textContent = (chg >= 0 ? '+' : '') + chg.toFixed(2) + '% (24h)';
      chgEl.style.color = chg >= 0 ? '#27c97f' : '#ff4d4d';
      const logo = $('tradeTokenLogo');
      if (p.info?.imageUrl) { logo.src = p.info.imageUrl; logo.style.display = ''; } else logo.style.display = 'none';

      $('tradeEmptyState').style.display = 'none';
      $('swapPanel').style.display = '';
      swapSetSide('buy');
      _tradeWalletStatus();

      // Chart + transactions (live) — chart is built from the transaction history
      $('tradeChartCard').style.display = '';
      $('tradeTxCard').style.display = '';
      $('tradeChart').innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-muted);font-size:11px">Loading chart from transactions…</div>';
      _tradeTrades = [];
      tradeLoadTxs(true);
      tradeStartLive();

      $('loadingOverlay').style.display = 'none';
      showToast(`${_tradeToken.symbol} ready to trade on ${chain}`);
    } catch (e) {
      $('loadingOverlay').style.display = 'none';
      showToast('Failed: ' + (e.message || 'unknown error'));
    }
  }, TRADE_LOADING_STEPS);
}

// ── UI state ─────────────────────────────────────────────────────────────────
function swapSetSide(side) {
  _tradeSide = side;
  const t = _tradeToken;
  if (!t) return;
  const native = TRADE_CHAINS[t.chain].native;

  $('swapTabBuy').style.cssText  = 'flex:1;padding:8px;border-radius:8px;font-size:11px;font-weight:800;cursor:pointer;letter-spacing:0.5px;transition:background .15s;border:none;' +
    (side==='buy'  ? 'background:#27c97f;color:#000' : 'background:transparent;color:var(--text-muted)');
  $('swapTabSell').style.cssText = 'flex:1;padding:8px;border-radius:8px;font-size:11px;font-weight:800;cursor:pointer;letter-spacing:0.5px;transition:background .15s;border:none;' +
    (side==='sell' ? 'background:#ff4d4d;color:#fff' : 'background:transparent;color:var(--text-muted)');

  $('swapFromLabel').textContent = side === 'buy' ? native : t.symbol;
  $('swapToLabel').textContent   = side === 'buy' ? t.symbol : native;
  $('swapExecBtn').textContent   = (side === 'buy' ? 'BUY ' : 'SELL ') + t.symbol;
  $('swapExecBtn').style.background = side === 'buy' ? '#27c97f' : '#ff4d4d';
  $('swapExecBtn').style.color      = side === 'buy' ? '#000' : '#fff';
  $('swapAmountIn').value = '';
  _clearQuote();
  _loadPayBalance();
}

function swapSetSlippage(v) {
  _tradeSlippage = v;
  const ids = { 0.5:'slipBtn05', 1:'slipBtn1', 3:'slipBtn3', 5:'slipBtn5' };
  for (const [val, id] of Object.entries(ids)) {
    const b = $(id); if (!b) continue;
    const on = parseFloat(val) === v;
    b.style.background  = on ? '#27c97f20' : 'var(--bg-secondary)';
    b.style.borderColor = on ? '#27c97f60' : 'var(--border-light)';
    b.style.color       = on ? '#27c97f' : 'var(--text-muted)';
  }
  if ($('swapAmountIn')?.value) swapScheduleQuote();
}

function _tradeWalletStatus() {
  const st = $('swapWalletStatus');
  if (!st) return;
  const w = window._privyWallet;
  st.textContent = w ? '🟢 ' + w.slice(0,6) + '…' + w.slice(-4) : 'Wallet not connected — connect via top-right button';
}

async function _loadPayBalance() {
  _tradeBalance = null;
  const lbl = $('swapBalanceLabel');
  if (lbl) lbl.textContent = '';
  const w = window._privyWallet, t = _tradeToken;
  if (!w || !t) return;
  try {
    if (_tradeSide === 'buy') {
      const raw = await _nativeBalance(t.chain, w);
      _tradeBalance = _fromRaw(raw, 18);
      if (lbl) lbl.textContent = 'Balance: ' + _fmtAmt(_tradeBalance) + ' ' + TRADE_CHAINS[t.chain].native;
    } else {
      const raw = await _erc20Balance(t.chain, t.address, w);
      _tradeBalance = _fromRaw(raw, t.decimals);
      if (lbl) lbl.textContent = 'Balance: ' + _fmtAmt(_tradeBalance) + ' ' + t.symbol;
    }
  } catch (_) {}
}

function swapPresetPct(pct) {
  if (_tradeBalance == null) { showToast('Connect wallet to use balance presets'); return; }
  let amt = _tradeBalance * pct / 100;
  // Leave dust for gas when maxing native
  if (_tradeSide === 'buy' && pct === 100) amt = Math.max(0, amt - 0.005);
  $('swapAmountIn').value = amt > 0 ? amt.toFixed(6) : '';
  swapScheduleQuote();
}

// ── Quote (KyberSwap route) ──────────────────────────────────────────────────
function swapScheduleQuote() {
  clearTimeout(_tradeTimer);
  const st = $('swapQuoteStatus');
  if (st) st.textContent = 'Fetching quote…';
  _tradeTimer = setTimeout(_fetchQuote, 500);
}

function _clearQuote() {
  _tradeQuote = null;
  clearTimeout(_tradeTimer);
  ['swapImpact','swapMinOut','swapRate','swapGas','swapRoute'].forEach(id => { const el=$(id); if (el) el.textContent='—'; });
  const out = $('swapAmountOut'); if (out) { out.textContent = '—'; out.style.color = 'var(--text-muted)'; }
  const st = $('swapQuoteStatus'); if (st) st.textContent = 'Enter amount to get quote';
}

async function _fetchQuote() {
  const t = _tradeToken;
  const amtStr = $('swapAmountIn')?.value?.trim();
  const amt = parseFloat(amtStr);
  if (!t || !amt || amt <= 0) { _clearQuote(); return; }

  const isBuy = _tradeSide === 'buy';
  const tokenIn  = isBuy ? NATIVE_ADDR : t.address;
  const tokenOut = isBuy ? t.address : NATIVE_ADDR;
  const inDecimals  = isBuy ? 18 : t.decimals;
  const outDecimals = isBuy ? t.decimals : 18;
  const amountIn = _toRaw(amtStr, inDecimals).toString();

  try {
    const r = await fetch(`${API_BASE}/trade/kyber/route?chain=${t.chain}&tokenIn=${tokenIn}&tokenOut=${tokenOut}&amountIn=${amountIn}`);
    const j = await r.json();
    if (!r.ok || !j.data?.routeSummary) throw new Error(j.error || j.message || 'No route found');
    const rs = j.data.routeSummary;
    _tradeQuote = { routeSummary: rs, routerAddress: j.data.routerAddress, tokenIn, outDecimals, inAmountRaw: amountIn };

    const outAmt = _fromRaw(BigInt(rs.amountOut), outDecimals);
    const minOut = outAmt * (1 - _tradeSlippage / 100);
    const inUsd  = parseFloat(rs.amountInUsd || 0);
    const outUsd = parseFloat(rs.amountOutUsd || 0);
    const impact = inUsd > 0 ? Math.max(0, (1 - outUsd / inUsd) * 100) : 0;
    const gasUsd = parseFloat(rs.gasUsd || 0);
    const outSym = isBuy ? t.symbol : TRADE_CHAINS[t.chain].native;
    const inSym  = isBuy ? TRADE_CHAINS[t.chain].native : t.symbol;
    // Route DEX names
    const dexes = [...new Set((rs.route || []).flat().map(h => h.exchange).filter(Boolean))].slice(0,3).join(', ');

    const out = $('swapAmountOut');
    out.textContent = _fmtAmt(outAmt) + ' ' + outSym;
    out.style.color = 'var(--text-primary)';
    $('swapMinOut').textContent = _fmtAmt(minOut) + ' ' + outSym;
    $('swapImpact').textContent = impact.toFixed(2) + '%';
    $('swapImpact').style.color = impact > 5 ? '#ff4d4d' : impact > 2 ? '#f59e0b' : '#27c97f';
    $('swapRate').textContent   = '1 ' + inSym + ' = ' + _fmtAmt(outAmt / amt) + ' ' + outSym;
    $('swapGas').textContent    = gasUsd ? '$' + gasUsd.toFixed(2) : '—';
    $('swapRoute').textContent  = dexes || 'KyberSwap';
    $('swapRoute').title        = dexes;
    $('swapQuoteStatus').textContent = '✓ Live quote — auto-refresh 10s';

    clearTimeout(_tradeTimer);
    _tradeTimer = setTimeout(_fetchQuote, 10000);
  } catch (e) {
    _clearQuote();
    const st = $('swapQuoteStatus');
    if (st) st.textContent = '⚠ ' + (e.message || 'Quote failed');
  }
}

// ── Execute ──────────────────────────────────────────────────────────────────
async function _ensureChain(chain) {
  const target = TRADE_CHAINS[chain];
  const current = await window.ethereum.request({ method: 'eth_chainId' });
  if (current === target.hex) return;
  try {
    await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: target.hex }] });
  } catch (e) {
    // 4902 = chain not added to MetaMask yet — add it automatically if we know its RPC
    if (e.code === 4902 && target.rpc) {
      await window.ethereum.request({
        method: 'wallet_addEthereumChain',
        params: [{
          chainId: target.hex,
          chainName: target.name || chain,
          nativeCurrency: { name: target.native, symbol: target.native, decimals: 18 },
          rpcUrls: [target.rpc],
          blockExplorerUrls: [target.explorer.replace(/\/tx\/$/, '')],
        }],
      });
      return;
    }
    if (e.code === 4902) throw new Error(`Please add the ${chain} network to MetaMask first`);
    throw new Error('Network switch rejected');
  }
}

async function swapExecute() {
  const t = _tradeToken, q = _tradeQuote, w = window._privyWallet;
  if (!t || !q) return showToast('Get a quote first');
  if (!w) return showToast('Connect wallet first (top-right button)');
  if (!window.ethereum) return showToast('MetaMask not found');

  const btn = $('swapExecBtn');
  const txSt = $('swapTxStatus');
  const resetBtn = () => { btn.disabled = false; swapSetSide(_tradeSide); };
  btn.disabled = true;
  if (txSt) { txSt.style.display = 'none'; }

  try {
    btn.textContent = 'Switching network…';
    await _ensureChain(t.chain);

    // Build the swap transaction
    btn.textContent = 'Building route…';
    const buildRes = await fetch(`${API_BASE}/trade/kyber/build`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chain: t.chain,
        routeSummary: q.routeSummary,
        sender: w,
        slippageBps: Math.round(_tradeSlippage * 100),
      }),
    });
    const build = await buildRes.json();
    if (!buildRes.ok || !build.data?.data) throw new Error(build.error || 'Failed to build transaction');
    const router = build.data.routerAddress;

    // Approve ERC20 when selling
    if (_tradeSide === 'sell') {
      const allowance = await _erc20Allowance(t.chain, t.address, w, router);
      const needed = BigInt(q.inAmountRaw);
      if (allowance < needed) {
        btn.textContent = 'Approve in MetaMask…';
        const maxUint = 'f'.repeat(64);
        const approveData = '0x095ea7b3' + router.toLowerCase().replace('0x','').padStart(64,'0') + maxUint;
        const approveTx = await window.ethereum.request({
          method: 'eth_sendTransaction',
          params: [{ from: w, to: t.address, data: approveData }],
        });
        btn.textContent = 'Waiting for approval…';
        await _waitForTx(t.chain, approveTx);
      }
    }

    // Send the swap
    btn.textContent = 'Confirm in MetaMask…';
    const txParams = { from: w, to: router, data: build.data.data };
    if (_tradeSide === 'buy') txParams.value = '0x' + BigInt(q.inAmountRaw).toString(16);
    if (build.data.gas) txParams.gas = '0x' + Math.ceil(parseInt(build.data.gas) * 1.25).toString(16);
    const txHash = await window.ethereum.request({ method: 'eth_sendTransaction', params: [txParams] });

    btn.textContent = 'Confirming…';
    const ok = await _waitForTx(t.chain, txHash);

    const link = TRADE_CHAINS[t.chain].explorer + txHash;
    if (txSt) {
      txSt.innerHTML = ok
        ? `✅ Swap confirmed! <a href="${link}" target="_blank" rel="noopener" style="color:#27c97f">View on explorer ↗</a>`
        : `⚠ Tx reverted. <a href="${link}" target="_blank" rel="noopener" style="color:#f59e0b">View on explorer ↗</a>`;
      txSt.style.color = ok ? '#27c97f' : '#f59e0b';
      txSt.style.display = 'block';
    }
    showToast(ok ? 'Swap executed! 🎉' : 'Transaction reverted');
    $('swapAmountIn').value = '';
    _clearQuote();
    _loadPayBalance();
    resetBtn();
  } catch (e) {
    const msg = e.code === 4001 ? 'Rejected in MetaMask' : (e.message || 'Swap failed');
    showToast(msg);
    if (txSt) { txSt.textContent = '⚠ ' + msg; txSt.style.color = '#ff4d4d'; txSt.style.display = 'block'; }
    resetBtn();
  }
}

async function _waitForTx(chain, hash) {
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 3000));
    try {
      const receipt = await _rpc(chain, 'eth_getTransactionReceipt', [hash]);
      if (receipt) return receipt.status === '0x1';
    } catch (_) {}
  }
  throw new Error('Transaction confirmation timeout — check explorer');
}

// ── Wallet holdings on Trade page ────────────────────────────────────────────
let _holdingsLoaded = false;

async function tradeLoadHoldings(force = false) {
  const w = window._privyWallet;
  const card  = $('tradeHoldingsCard');
  const empty = $('tradeHoldingsEmpty');
  const list  = $('tradeHoldingsList');
  if (!card || !list) return;
  if (!w) { card.style.display = 'none'; if (empty) empty.style.display = ''; _holdingsLoaded = false; return; }
  if (_holdingsLoaded && !force) return;

  card.style.display = '';
  if (empty) empty.style.display = 'none';
  list.innerHTML = '<div style="padding:24px 16px;text-align:center;font-size:11px;color:var(--text-muted)">Loading holdings…</div>';
  try {
    const r = await fetch(`${API_BASE}/trade/holdings/${w}`);
    const j = await r.json();
    const hs = j.holdings || [];
    _holdingsLoaded = true;

    if (!hs.length) {
      list.innerHTML = '<div style="padding:24px 16px;text-align:center;font-size:11px;color:var(--text-muted)">No tokens found in this wallet</div>';
      $('tradeHoldingsTotal').textContent = '$0.00';
      return;
    }

    const total = hs.reduce((s, h) => s + (h.usd || 0), 0);
    $('tradeHoldingsTotal').textContent = '$' + total.toLocaleString('en-US', { maximumFractionDigits: 2 });

    list.innerHTML = hs.map(h => {
      const iconHtml = h.icon
        ? `<img src="${h.icon}" style="width:30px;height:30px;border-radius:50%;flex-shrink:0" onerror="this.outerHTML='<div style=\\'width:30px;height:30px;border-radius:50%;background:#27c97f1f;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;color:#27c97f;flex-shrink:0\\'>${(h.symbol||'?')[0]}</div>'">`
        : `<div style="width:30px;height:30px;border-radius:50%;background:#27c97f1f;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;color:#27c97f;flex-shrink:0">${(h.symbol||'?')[0]}</div>`;
      const clickable = !h.native;
      return `<div ${clickable ? `onclick="tradeSelectHolding('${h.address}')" ` : ''}style="display:flex;align-items:center;gap:10px;padding:10px 16px;border-bottom:1px solid var(--border-light);${clickable ? 'cursor:pointer' : ''}"
        ${clickable ? `onmouseover="this.style.background='var(--bg-secondary)'" onmouseout="this.style.background=''" title="Click to trade ${h.symbol}"` : ''}>
        ${iconHtml}
        <div style="min-width:0">
          <div style="display:flex;align-items:center;gap:6px">
            <span style="font-size:12px;font-weight:700;color:var(--text-primary)">${h.symbol}</span>
            <span style="font-size:8px;padding:1px 6px;border-radius:10px;font-weight:700;background:var(--bg-secondary);color:var(--text-muted);border:1px solid var(--border-light);white-space:nowrap">${h.chain.toUpperCase()}</span>
          </div>
          <div style="font-size:9px;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:110px">${h.name || ''}</div>
        </div>
        <div style="margin-left:auto;text-align:right;flex-shrink:0">
          <div style="font-size:11px;font-weight:700;color:var(--text-primary);font-family:monospace">${_fmtAmt(h.balance)}</div>
          <div style="font-size:9px;color:${h.usd != null ? '#27c97f' : 'var(--text-muted)'}">${h.usd != null ? '$' + h.usd.toLocaleString('en-US',{maximumFractionDigits:2}) : '—'}</div>
        </div>
      </div>`;
    }).join('');
  } catch (e) {
    list.innerHTML = '<div style="padding:20px;text-align:center;font-size:11px;color:var(--text-muted)">Failed to load holdings</div>';
  }
}

// Click a holding → load it into the trade panel (SELL side, since they own it)
function tradeSelectHolding(address) {
  const inp = $('tradeTokenInput');
  if (inp) inp.value = address;
  tradeLoadToken().then(() => { if (_tradeToken) swapSetSide('sell'); });
}

// ── Trade page: live chart + recent transactions ─────────────────────────────
const TRADE_GECKO_NET = { ethereum:'eth', base:'base', arbitrum:'arbitrum', polygon:'polygon_pos', optimism:'optimism', robinhood:'robinhood' };

let _tradeChart      = null;
let _tradeSeries     = null;
let _tradeInterval   = '1m';
let _tradeChartTimer = null;
let _tradeTxTimer    = null;
let _tradePairAddr   = null;
let _tradeCreatedAt  = null;

function _tradePageActive() {
  return document.getElementById('page-trade')?.classList.contains('active');
}

function _tradeStopLive() {
  clearInterval(_tradeChartTimer); _tradeChartTimer = null;
  clearInterval(_tradeTxTimer);    _tradeTxTimer = null;
}

function tradeStartLive() {
  _tradeStopLive();
  // Single 12s cycle: transactions feed both the tx list AND the chart candles
  _tradeTxTimer = setInterval(() => { if (_tradePageActive() && _tradePairAddr) tradeLoadTxs(false); }, 12000);
}

function _tradeBuildChart(samplePrice) {
  const container = $('tradeChart');
  if (!container || !window.LightweightCharts) return;
  container.innerHTML = '';
  if (_tradeChart) { try { _tradeChart.remove(); } catch(_){} _tradeChart = null; }

  const chart = LightweightCharts.createChart(container, {
    width:  container.clientWidth || 500,
    height: 260,
    layout: { background:{ color:'transparent' }, textColor:'#8b92a8', fontSize: 10 },
    grid:   { vertLines:{ visible:false }, horzLines:{ color:'#1e223055' } },
    crosshair: { mode: 1 },
    rightPriceScale: { borderColor:'#1e2230' },
    timeScale: { borderColor:'#1e2230', timeVisible:true, secondsVisible:true },
  });

  let minMove = 0.01;
  if (samplePrice < 0.000001)    minMove = 0.0000000001;
  else if (samplePrice < 0.0001) minMove = 0.00000001;
  else if (samplePrice < 0.01)   minMove = 0.000001;
  else if (samplePrice < 1)      minMove = 0.0001;

  _tradeSeries = chart.addCandlestickSeries({
    upColor:'#27C97F', downColor:'#F0484B',
    borderUpColor:'#27C97F', borderDownColor:'#F0484B',
    wickUpColor:'#27C97F', wickDownColor:'#F0484B',
    priceFormat: { type:'custom', formatter: p => (typeof fmt !== 'undefined' && fmt.price) ? fmt.price(p) : p.toPrecision(4), minMove },
  });
  _tradeChart = chart;
}

// Cached transaction history — the single source of truth for the chart
let _tradeTrades = [];

// Bucket transaction prices into OHLC candles for the selected interval
function _buildCandlesFromTrades(trades) {
  const secs = TRADE_INTERVAL_SECS[_tradeInterval] || 60;
  const valid = trades
    .filter(tr => tr.priceUsd > 0 && tr.timestamp > 0)
    .sort((a, b) => a.timestamp - b.timestamp); // oldest → newest
  const buckets = new Map();
  for (const tr of valid) {
    const bucket = Math.floor(tr.timestamp / 1000 / secs) * secs;
    const p = tr.priceUsd;
    if (!buckets.has(bucket)) {
      buckets.set(bucket, { time: bucket, open: p, high: p, low: p, close: p });
    } else {
      const c = buckets.get(bucket);
      c.high  = Math.max(c.high, p);
      c.low   = Math.min(c.low,  p);
      c.close = p;
    }
  }
  return [...buckets.values()].sort((a, b) => a.time - b.time);
}

// Render chart entirely from transaction-history prices
function _tradeRenderChartFromTrades(rebuild = true) {
  const t = _tradeToken;
  if (!t) return;
  const candles = _buildCandlesFromTrades(_tradeTrades);
  if (!candles.length) {
    if (rebuild) $('tradeChart').innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-muted);font-size:11px">No transaction data to chart yet</div>';
    return;
  }
  if (rebuild || !_tradeSeries) _tradeBuildChart(candles[candles.length - 1].close);
  if (!_tradeSeries) return;
  _tradeSeries.setData(candles);
  if (rebuild) _tradeChart.timeScale().fitContent();
  // Track the last candle so live trade prices can extend it in realtime
  _tradeLastCandle = { ...candles[candles.length - 1] };
}

// ── Live price from latest transaction ───────────────────────────────────────
let _tradeLastCandle = null;
const TRADE_INTERVAL_SECS = { '1s': 1, '30s': 30, '1m': 60, '5m': 300 };

function _applyTradePrice(p) {
  const t = _tradeToken;
  if (!t || !p || p <= 0) return;

  // 1. Token bar: show latest execution price, tinted by direction vs previous
  const el = $('tradeTokenPrice');
  if (el) {
    const prev = t.price || 0;
    el.textContent = fmt.price(p);
    if (prev > 0 && p !== prev) {
      el.style.color = p > prev ? '#27c97f' : '#ff4d4d';
      el.style.transition = 'color 0.2s';
    }
  }
  t.price = p;

  // 2. Live candle: extend/replace the current in-progress candle on the chart
  if (_tradeSeries && _tradeLastCandle) {
    const secs   = TRADE_INTERVAL_SECS[_tradeInterval] || 60;
    const bucket = Math.floor(Date.now() / 1000 / secs) * secs;
    if (bucket <= _tradeLastCandle.time) {
      // Same (or older) bucket — update the existing candle
      _tradeLastCandle.close = p;
      _tradeLastCandle.high  = Math.max(_tradeLastCandle.high, p);
      _tradeLastCandle.low   = Math.min(_tradeLastCandle.low,  p);
    } else {
      // New interval started — open a fresh live candle from the previous close
      const open = _tradeLastCandle.close;
      _tradeLastCandle = { time: bucket, open, high: Math.max(open, p), low: Math.min(open, p), close: p };
    }
    try { _tradeSeries.update(_tradeLastCandle); } catch (_) {}
  }
}

function tradeSetInterval(intv) {
  _tradeInterval = intv;
  document.querySelectorAll('.trade-chart-int').forEach(b => {
    const on = b.dataset.int === intv;
    b.style.background   = on ? '#27c97f20' : 'var(--bg-secondary)';
    b.style.borderColor  = on ? '#27c97f60' : 'var(--border-light)';
    b.style.color        = on ? '#27c97f' : 'var(--text-muted)';
    b.style.fontWeight   = on ? '700' : '600';
  });
  // Rebuild candles from the cached transaction history with the new bucket size
  _tradeRenderChartFromTrades(true);
}

async function tradeLoadTxs(showLoading = true) {
  const t = _tradeToken;
  const list = $('tradeTxList');
  if (!t || !_tradePairAddr || !list) return;
  if (showLoading) list.innerHTML = '<div style="padding:20px;text-align:center;font-size:11px;color:var(--text-muted)">Loading transactions…</div>';
  try {
    const net = TRADE_GECKO_NET[t.chain] || t.chain;
    // Fetch up to 300 trades: top 30 shown in the list, all of them feed the chart
    const r = await fetch(`${API_BASE}/recent-trades`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ poolAddress: _tradePairAddr, network: net, limit: 300 }),
    });
    const j = await r.json();
    const allTrades = j.trades || [];
    if (!allTrades.length) {
      list.innerHTML = '<div style="padding:20px;text-align:center;font-size:11px;color:var(--text-muted)">No recent trades data for this pool</div>';
      return;
    }

    // Chart = transaction history (rebuild only on first load / new data)
    const firstBuild = _tradeTrades.length === 0;
    _tradeTrades = allTrades;
    _tradeRenderChartFromTrades(firstBuild);

    const trades = allTrades.slice(0, 30);
    const explorer = TRADE_CHAINS[t.chain]?.explorer || '';
    const fmtTxPrice = p => !p ? '—' : fmt.price(p);
    list.innerHTML = trades.map(tr => `
      <div style="display:grid;grid-template-columns:56px 1fr 1fr 1fr 62px 34px;gap:8px;padding:8px 16px;border-bottom:1px solid var(--border-light);font-size:11px;align-items:center">
        <span style="font-weight:800;color:${tr.isBuy ? '#27c97f' : '#ff4d4d'}">${tr.isBuy ? '▲ BUY' : '▼ SELL'}</span>
        <span style="text-align:right;font-family:monospace;font-weight:700;color:${tr.isBuy ? '#27c97f' : '#ff4d4d'};font-size:10px" title="Execution price">${fmtTxPrice(tr.priceUsd)}</span>
        <span style="text-align:right;font-family:monospace;font-weight:700;color:var(--text-primary)">$${tr.volUsd >= 1000 ? (tr.volUsd/1000).toFixed(1)+'K' : tr.volUsd.toFixed(2)}</span>
        <span style="font-family:monospace;color:var(--text-muted);font-size:10px">${tr.wallet}</span>
        <span style="text-align:right;color:var(--text-muted);font-size:10px">${tr.time}</span>
        <span style="text-align:right">${tr.txHash && explorer ? `<a href="${explorer}${tr.txHash}" target="_blank" rel="noopener" style="color:#27c97f;font-size:10px;text-decoration:none">↗</a>` : '—'}</span>
      </div>`).join('');
    const upd = $('tradeTxUpdated');
    if (upd) upd.textContent = 'Updated ' + new Date().toLocaleTimeString();

    // Latest transaction drives the live price (token bar + current candle)
    const newest = trades[0];
    if (newest?.priceUsd > 0) _applyTradePrice(newest.priceUsd);
  } catch (_) {
    if (showLoading) list.innerHTML = '<div style="padding:20px;text-align:center;font-size:11px;color:var(--text-muted)">Failed to load transactions</div>';
  }
}
