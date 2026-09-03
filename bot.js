/**
 * Acki-Nacki Auto Bot - Clean version with auto-login
 * 
 * Auth flow:
 *   1. session_data (base64) → session_id → access_token + refresh_token
 *   2. Auto-refresh on 401
 *   3. Token persistence via tokens.json
 * 
 * API: https://app-backend.ackinacki.org/api
 * Auth header: jwt-auth: <access_token>
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

// ── Load .env ──
function loadEnv() {
  try {
    const envFile = fs.readFileSync(path.join(__dirname, '.env'), 'utf-8');
    const env = {};
    envFile.split('\n').forEach(line => {
      line = line.trim();
      if (!line || line.startsWith('#')) return;
      const [key, ...rest] = line.split('=');
      env[key.trim()] = rest.join('=').trim().replace(/^["']|["']$/g, '');
    });
    return env;
  } catch { return {}; }
}

const ENV = loadEnv();
const BASE_URL = 'https://app-backend.ackinacki.org/api';
const ORIGIN = 'https://t.ackinacki.com';
const TG_APP_ID = 'org.telegram.messenger';

// ── Config ──
const CONFIG = {
  delayBetweenTasks: [5, 10],     // seconds
  delayBetweenAccounts: [1, 3],   // seconds  
  farmingInterval: 3600,          // 1 hour between claims
  maxRetries: 3,
  rotateProxy: false,
  proxyFile: path.join(__dirname, 'proxies.txt'),
  tokenFile: path.join(__dirname, 'tokens.json'),
  sessionFile: path.join(__dirname, 'datas.txt'),
};

// ── Logging ──
const log = {
  info: (msg) => console.log(`[INFO] ${timestamp()} ${msg}`),
  ok: (msg) => console.log(`[OK]   ${timestamp()} ${msg}`),
  err: (msg) => console.log(`[ERR]  ${timestamp()} ${msg}`),
  warn: (msg) => console.log(`[WARN] ${timestamp()} ${msg}`),
};

function timestamp() {
  return new Date().toISOString().slice(19, 23);
}

function randomDelay(min, max) {
  const sec = Math.random() * (max - min) + min;
  return new Promise(resolve => setTimeout(resolve, sec * 1000));
}

// ── Telegram Notification ──
let _tgLastSent = {};  // cooldown: avoid spam (same msg within 30 min)
async function tgNotify(text, key = 'default') {
  const token = ENV.tg_bot_token;
  const chatId = ENV.tg_chat_id;
  if (!token || !chatId) return; // not configured, skip

  // Cooldown: same key = 30 min
  const now = Date.now();
  if (_tgLastSent[key] && (now - _tgLastSent[key]) < 1800000) return;
  _tgLastSent[key] = now;

  const body = JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' });
  const url = new URL(`https://api.telegram.org/bot${token}/sendMessage`);

  return new Promise((resolve) => {
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
    }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        if (res.statusCode === 200) log.ok('TG notification sent');
        else log.warn(`TG notify failed: ${res.statusCode} ${d.slice(0, 100)}`);
        resolve();
      });
    });
    req.on('error', (e) => { log.warn(`TG notify error: ${e.message}`); resolve(); });
    req.write(body);
    req.end();
  });
}

// ── HTTP Client ──
function httpRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const isHttps = urlObj.protocol === 'https:';
    const mod = isHttps ? https : http;
    
    const reqOptions = {
      hostname: urlObj.hostname,
      port: urlObj.port || (isHttps ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: options.method || 'GET',
      headers: {
        'accept': 'application/json, text/plain, */*',
        'accept-language': 'en-US,en;q=0.9',
        'x-requested-with': TG_APP_ID,
        'origin': ORIGIN,
        'referer': ORIGIN + '/',
        'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
        ...options.headers,
      },
    };
    
    const req = mod.request(reqOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: data,
          json: () => { try { return JSON.parse(data); } catch { return null; } },
        });
      });
    });
    
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout')); });
    
    if (options.body) req.write(options.body);
    req.end();
  });
}

// ── Auth ──
function decodeBase64Url(str) {
  let s = str.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return Buffer.from(s, 'base64').toString('utf-8');
}

function readSessionData() {
  try {
    const raw = fs.readFileSync(CONFIG.sessionFile, 'utf-8').trim();
    if (!raw) return null;

    // Format 1: session_data base64 → {"session_id": "...", "locale": "..."}
    try {
      const decoded = decodeBase64Url(raw);
      const data = JSON.parse(decoded);
      if (data.session_id) {
        log.ok('Detected session_data format (base64 JSON)');
        return data;
      }
    } catch (e) { /* not session_data format, try next */ }

    // Format 2: start URL https://t.ackinacki.com/?startapp=<base64>
    if (raw.startsWith('http')) {
      try {
        const b64 = raw.split('startapp=')[1];
        const decoded = decodeBase64Url(b64);
        const data = JSON.parse(decoded);
        if (data.session_id) {
          log.ok('Detected start URL format');
          return data;
        }
      } catch (e) { /* not start URL format */ }
    }

    // Format 3: raw JWT token (access_token) — NOT a session_id, but check
    if (raw.startsWith('eyJ')) {
      try {
        const parts = raw.split('.');
        const payload = JSON.parse(Buffer.from(parts[1] + '==', 'base64').toString());
        if (payload.sub && payload.exp) {
          const expired = Date.now() / 1000 > payload.exp;
          if (expired) {
            log.err(`Token EXPIRED (user: ${payload.username || payload.sub})`);
            log.err('Expired: ' + new Date(payload.exp * 1000).toISOString());
          } else {
            log.ok('Token is valid but not a session_data. Using sub as fallback...');
            return { session_id: payload.sub, locale: 'en' };
          }
          return null;
        }
      } catch (e) { /* not JWT */ }
    }

    log.err('Unrecognized format in datas.txt');
    return null;
  } catch (e) {
    log.err(`Failed to read session data: ${e.message}`);
    return null;
  }
}

async function exchangeSession(sessionId, locale = 'en') {
  const url = `${BASE_URL}/v1/auth/session?session_id=${sessionId}&locale=${locale}`;
  
  const res = await httpRequest(url, {
    method: 'GET',
    headers: {
      'accept': 'application/json',
    },
  });
  
  if (res.status === 200) {
    const data = res.json();
    if (data && data.access_token && data.refresh_token) {
      return {
        status: 'success',
        access_token: data.access_token,
        refresh_token: data.refresh_token,
      };
    }
    log.err(`Auth response missing tokens: ${JSON.stringify(data).slice(0, 200)}`);
    return { status: 'error' };
  }
  
  log.err(`Auth failed: ${res.status} ${res.body.slice(0, 200)}`);
  return { status: 'error' };
}

async function refreshAccessToken(refreshToken) {
  const url = `${BASE_URL}/v1/auth/refresh`;
  const body = JSON.stringify({ refresh_token: refreshToken });
  
  const res = await httpRequest(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(body),
    },
    body,
  });
  
  if (res.status === 200) {
    const data = res.json();
    if (data && data.access_token) {
      log.ok('Token refreshed successfully!');
      return {
        status: 'success',
        access_token: data.access_token,
        refresh_token: data.refresh_token || refreshToken,
      };
    }
  }
  
  log.err(`Token refresh failed: ${res.status} ${res.body.slice(0, 200)}`);
  return { status: 'error' };
}

function saveTokens(accessToken, refreshToken) {
  try {
    fs.writeFileSync(CONFIG.tokenFile, JSON.stringify({
      access_token: accessToken,
      refresh_token: refreshToken,
    }, null, 2));
    log.ok('Tokens saved to tokens.json');
  } catch (e) {
    log.warn(`Failed to save tokens: ${e.message}`);
  }
}

function loadTokens() {
  try {
    const data = JSON.parse(fs.readFileSync(CONFIG.tokenFile, 'utf-8'));
    return {
      access_token: data.access_token || null,
      refresh_token: data.refresh_token || null,
    };
  } catch {
    return { access_token: null, refresh_token: null };
  }
}

// ── JWT Helpers ──
function decodeJwtPayload(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const padded = parts[1] + '==';
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf-8'));
  } catch { return null; }
}

function getTokenExpiry(token) {
  const payload = decodeJwtPayload(token);
  if (!payload || !payload.exp) return null;
  return { expiresAt: payload.exp * 1000, username: payload.username, sub: payload.sub };
}

function isTokenExpired(token, bufferMs = 60000) {
  const info = getTokenExpiry(token);
  if (!info) return true; // can't parse = treat as expired
  return Date.now() >= (info.expiresAt - bufferMs);
}

function tokenTimeLeft(token) {
  const info = getTokenExpiry(token);
  if (!info) return 'unknown';
  const ms = info.expiresAt - Date.now();
  if (ms <= 0) return 'EXPIRED';
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// ── API Client ──
class AckiNackiAPI {
  constructor(accessToken, refreshToken) {
    this.accessToken = accessToken;
    this.refreshToken = refreshToken;
    this.requestCount = 0;
    this.lastRefresh = 0;
  }

  async ensureValidToken() {
    if (isTokenExpired(this.accessToken, 120000)) {
      log.warn(`Access token expiring in ${tokenTimeLeft(this.accessToken)}, proactive refresh...`);
      return await this.refreshTokens();
    }
    return true;
  }

  async refreshTokens() {
    if (!this.refreshToken) {
      log.err('No refresh token available — need fresh session_data');
      return false;
    }
    const result = await refreshAccessToken(this.refreshToken);
    if (result.status === 'success') {
      this.accessToken = result.access_token;
      this.refreshToken = result.refresh_token;
      this.lastRefresh = Date.now();
      saveTokens(this.accessToken, this.refreshToken);
      log.ok(`Token refreshed! Access: ${tokenTimeLeft(this.accessToken)} | Refresh: ${tokenTimeLeft(this.refreshToken)}`);
      return true;
    }
    return false;
  }
  
  async request(method, apiPath, body = null) {
    // Proactive: refresh before 401
    await this.ensureValidToken();

    const url = `${BASE_URL}${apiPath}`;
    const options = {
      method,
      headers: { 'jwt-auth': this.accessToken, 'x-requested-with': TG_APP_ID },
    };
    
    if (body) {
      const bodyStr = JSON.stringify(body);
      options.headers['content-type'] = 'application/json';
      options.headers['content-length'] = Buffer.byteLength(bodyStr);
      options.body = bodyStr;
    }
    
    this.requestCount++;
    const res = await httpRequest(url, options);
    
    if (res.status === 401) {
      log.warn('Got 401, force refreshing token...');
      if (await this.refreshTokens()) {
        options.headers['jwt-auth'] = this.accessToken;
        return await httpRequest(url, options);
      }
      log.err('Token refresh failed. Need new session_data!');
      await tgNotify(
        `🚨 <b>Acki-Nacki</b>\nRefresh token EXPIRED!\nBot stopped. Need fresh session data.\nOpen Telegram → Acki Nacki → /start → paste session data`,
        'rt_expired'
      );
      return { status: 401, body: 'Token refresh failed', json: () => null };
    }
    
    return res;
  }
  
  async getUserData() {
    const res = await this.request('GET', '/users/me');
    return res.json();
  }
  
  async getFarmingStatus() {
    const res = await this.request('GET', '/users/tasks/farm/v2');
    return res.json();
  }
  
  async startFarming() {
    const res = await this.request('POST', '/users/tasks/farm/v2');
    return { status: res.status, ok: res.status === 200 };
  }
  
  async claimFarming(taskId) {
    const res = await this.request('POST', '/users/tasks/claim', { task_id: taskId });
    return { status: res.status, ok: res.status === 200, data: res.json() };
  }
  
  async getPopitsMe() {
    const res = await this.request('GET', '/popits/me');
    return res.json();
  }
  
  async getPopits(cursor = 0, limit = 20) {
    const res = await this.request('GET', `/popits?cursor=${cursor}&limit=${limit}&popcoin_only=false`);
    return res.json();
  }
  
  async watchPopit(popitId) {
    const res = await this.request('POST', `/popits/${popitId}/watch`);
    return { status: res.status, ok: [200, 204].includes(res.status) };
  }
}

// ── Bot Logic ──
async function runBot() {
  log.info('=== Acki-Nacki Auto Bot ===');
  
  // 1. Try load saved tokens
  let { access_token, refresh_token } = loadTokens();
  
  // 2. If no tokens, authenticate with session data
  if (!access_token || !refresh_token) {
    log.info('No saved tokens, authenticating...');
    const sessionData = readSessionData();
    if (!sessionData || !sessionData.session_id) {
      log.err('═══════════════════════════════════════════════════');
      log.err('  NEED FRESH SESSION DATA!');
      log.err('═══════════════════════════════════════════════════');
      log.err('  1. Open Telegram → Acki Nacki bot');
      log.err('  2. Send /start → bot gives a link');
      log.err('  3. Copy the base64 part after startapp=');
      log.err('  4. Paste it in datas.txt (overwrite)');
      log.err('');
      log.err('  Link format: https://t.ackinacki.com/?startapp=eyJ...');
      log.err('  You ONLY need the eyJ... part');
      log.err('═══════════════════════════════════════════════════');
      return;
    }
    
    const auth = await exchangeSession(sessionData.session_id, sessionData.locale || 'en');
    if (auth.status !== 'success') {
      log.err('Authentication failed!');
      return;
    }
    
    access_token = auth.access_token;
    refresh_token = auth.refresh_token;
    saveTokens(access_token, refresh_token);
  } else {
    log.ok('Using saved tokens');
  }
  
  // 3. Create API client (handles auto-refresh)
  const api = new AckiNackiAPI(access_token, refresh_token);
  
  // Show token health
  log.ok(`Access token:  ${tokenTimeLeft(api.accessToken)} left`);
  log.ok(`Refresh token: ${tokenTimeLeft(api.refreshToken)} left`);
  
  // Warn if refresh_token is close to expiry
  const rtInfo = getTokenExpiry(api.refreshToken);
  if (rtInfo) {
    const rtMsLeft = rtInfo.expiresAt - Date.now();
    const rtDaysLeft = rtMsLeft / 86400000;
    if (rtDaysLeft < 7) {
      log.warn(`⚠ Refresh token expires in ${Math.floor(rtDaysLeft)} days!`);
      log.warn('  You\'ll need fresh session_data from Telegram soon.');
      await tgNotify(
        `⚠️ <b>Acki-Nacki</b>\nRefresh token expires in <b>${Math.floor(rtDaysLeft)} days</b>!\nOpen Telegram → Acki Nacki → /start → paste session data to datas.txt`,
        'rt_expiring'
      );
    } else {
      log.ok(`Refresh token OK (~${Math.floor(rtDaysLeft)} days remaining)`);
    }
  }
  
  // 4. Get user info
  log.info('Fetching user data...');
  const userData = await api.getUserData();
  if (!userData || !userData.user) {
    log.err('Failed to get user data. Token may be invalid.');
    log.err('Delete tokens.json and put fresh session data in datas.txt');
    return;
  }
  
  const user = userData.user;
  log.ok(`Logged in as: ${user.username || user.firstName || 'Unknown'}`);
  log.ok(`Balance: ${user.balance || user.coins || 'N/A'} coins`);
  
  // Startup notification
  await tgNotify(
    `✅ <b>Acki-Nacki Bot Started</b>\nUser: ${user.username || 'Unknown'}\nAccess: ${tokenTimeLeft(api.accessToken)}\nRefresh: ${tokenTimeLeft(api.refreshToken)}`,
    'startup'
  );
  
  // 5. Main loop
  let tokenCheckCounter = 0;
  log.info('Starting farming loop...');
  
  while (true) {
    try {
      // Periodic token health check every ~5 min
      tokenCheckCounter++;
      if (tokenCheckCounter >= 5) {
        tokenCheckCounter = 0;
        log.info(`Token health — Access: ${tokenTimeLeft(api.accessToken)} | Refresh: ${tokenTimeLeft(api.refreshToken)}`);
        // Proactive refresh if access token < 5 min left
        await api.ensureValidToken();
      }

      // Get farming status
      const farmStatus = await api.getFarmingStatus();
      
      if (farmStatus && farmStatus.reward) {
        const reward = farmStatus.reward;
        const meta = reward.metadata || {};
        const taskId = farmStatus.id;
        
        if (reward.claimed === true) {
          // Already claimed — start new farming
          log.info('Starting new farming session...');
          const start = await api.startFarming();
          if (start.ok) {
            log.ok('Farming started!');
          } else {
            log.warn(`Start farming failed: ${start.status}`);
          }
          await randomDelay(CONFIG.farmingInterval, CONFIG.farmingInterval + 60);
          continue;
        }
        
        // Not claimed yet — check if claim_at has passed
        if (reward.claim_at) {
          const claimAt = new Date(reward.claim_at);
          const now = new Date();
          const remaining = Math.max(0, Math.floor((claimAt - now) / 1000));
          
          if (now >= claimAt) {
            // Claimable now!
            log.info('Claiming farming reward...');
            const claim = await api.claimFarming(taskId);
            if (claim.ok) {
              const rewardAmount = reward.reward || 'unknown';
              log.ok(`Claimed ${rewardAmount} coins! Starting next farming...`);
              await tgNotify(
                `💰 <b>Acki-Nacki</b>\nClaimed <b>${rewardAmount}</b> coins!\nStarting next farming cycle...`,
                'claim'
              );
              // Start new farming immediately
              await randomDelay(2, 5);
              const start = await api.startFarming();
              if (start.ok) log.ok('Next farming started!');
              await randomDelay(CONFIG.farmingInterval, CONFIG.farmingInterval + 60);
              continue;
            } else {
              log.warn(`Claim failed: ${claim.status}`);
            }
          } else {
            // Not ready yet — wait
            const mins = Math.floor(remaining / 60);
            const secs = remaining % 60;
            log.info(`Farming in progress... ready in ${mins}m ${secs}s`);
            // Sleep until claimable (check every 60s)
            await randomDelay(Math.min(remaining, 60), Math.min(remaining, 120));
            continue;
          }
        }
      }
      
      // Default: wait before next check
      await randomDelay(30, 60);
      
    } catch (e) {
      log.err(`Error in farming loop: ${e.message}`);
      await randomDelay(30, 60);
    }
  }
}

// ── Entry Point ──
runBot().catch(e => {
  log.err(`Fatal: ${e.message}`);
  process.exit(1);
});
