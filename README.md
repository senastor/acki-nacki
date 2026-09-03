# Acki-Nacki Bot

Auto bot for the Acki-Nacki Telegram mini app. One account, one session. It authenticates from `datas.txt`, keeps tokens fresh via auto-refresh, and loops farming + task claims around the clock. Proven in production under systemd (`Restart=always`).

## Requirements

- Node.js 18+
- No npm dependencies — the bot uses only the Node standard library.

## Quick Start

```bash
# 1. Clone
git clone https://github.com/senastor/acki-nacki.git
cd acki-nacki

# 2. Configure
cp .env.example .env          # optional: Telegram bot token for notifications
echo "eyJzZX..." > datas.txt  # your session data (the base64 after startapp=)

# 3. Run
node bot.js
```

Or use the interactive setup: `./setup.sh` (Linux/macOS) or `setup.bat` (Windows).

## Getting Session Data

1. Open Telegram → Acki Nacki bot → `/start`
2. The bot gives a link like `https://t.ackinacki.com/?startapp=eyJ...`
3. Copy the base64 part after `startapp=` into `datas.txt` (one session, overwrite)

## Files

| File | Purpose | Tracked? |
|------|---------|----------|
| `bot.js` | The bot — auth flow, token refresh, farming/claim loop, TG notifications | yes |
| `.env` | Telegram bot token + chat id (optional) | **no** (see `.env.example`) |
| `datas.txt` | Account session data (base64, one session) | **no** |
| `tokens.json` | Cached access/refresh tokens (regenerated at runtime) | **no** |
| `proxies.txt` | Proxy list (optional) | **no** |
| `wallets.txt` | Wallet addresses (optional) | **no** |
| `.acki_trace` | Runtime trace state | **no** |

## Telegram Notifications (optional)

Set `tg_bot_token` and `tg_chat_id` in `.env` to get alerts on startup, claim success, and token-expiry warnings. Leave `.env` absent and the bot still runs — notifications just skip.

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

## How It Works

- **Auth:** `session_data` (base64) → `session_id` → `access_token` + `refresh_token`
- **Auto-refresh:** proactively renews the access token before it expires; force-refresh on 401
- **Loop:** checks farming status, claims when `claim_at` passes, starts the next farming cycle, sleeps ~1h between claims
- **Persistence:** tokens cached in `tokens.json` so restarts don't need fresh session data

## Disclaimer

Personal educational project, not affiliated with Acki-Nacki or its operators. Provided as-is, use at your own risk. Redistribution, resale, or commercial use is not permitted.
