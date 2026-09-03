# Acki-Nacki Bot

Auto bot for the Acki-Nacki Telegram mini app. Runs in a loop: refreshes sessions from `datas.txt`, renews tokens, and executes daily tasks for all accounts. Proven working in production (systemd, `Restart=always`).

## Requirements

- Node.js 18+
- Node standard library only (the bundle is self-contained; `npm install` is optional and only needed if you rebuild from the `meo-forkcy-*` sources)

## Quick Start

```bash
# 1. Clone
git clone https://github.com/senastor/acki-nacki.git
cd acki-nacki

# 2. Create your config files
cp .env.example .env
# edit .env with your Telegram bot token (optional, for notifications)

# 3. Fill in account data
echo "eyJzZX...base64-session-data" > datas.txt   # one session per line
# optional: wallets.txt (one address per line)
# optional: proxies.txt (one proxy per line, http/https/socks4/socks5)

# 4. Run
node bot.js
```

## Files

| File | Purpose | Tracked? |
|------|---------|----------|
| `bot.js` | Main entry — auth flow, token refresh, task loop, TG notifications | yes |
| `meomundep.js` | Self-contained webpack bundle with core task logic | yes |
| `configs.json` | Bot behavior config (proxy rotation, delays, batch size) | yes |
| `.env` | Telegram bot token + chat id | **no** (see `.env.example`) |
| `datas.txt` | Account session data (base64, one per line) | **no** |
| `tokens.json` | Cached access/refresh tokens (regenerated at runtime) | **no** |
| `wallets.txt` | Wallet addresses | **no** |
| `proxies.txt` | Proxy list | **no** |
| `.acki_trace` | Runtime trace state | **no** |

## Config (`configs.json`)

```json
{
  "rotateProxy": false,
  "upgradeMamaboard": true,
  "skipInvalidProxy": true,
  "proxyRotationInterval": 2,
  "delayEachAccount": [1, 1],
  "timeToRestartAllAccounts": 300,
  "howManyAccountsRunInOneTime": 10,
  "doTasks": true
}
```

- `delayEachAccount` — min/max seconds between accounts
- `howManyAccountsRunInOneTime` — batch size before a full restart cycle
- `timeToRestartAllAccounts` — seconds between restart cycles

## Systemd (optional)

```ini
[Unit]
Description=Acki-Nacki Auto Bot
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/path/to/acki-nacki
ExecStart=/usr/bin/node bot.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

## Disclaimer

Personal educational project, not affiliated with Acki-Nacki or its operators. Use at your own risk.
