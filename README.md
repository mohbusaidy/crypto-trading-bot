# Personal Crypto Trading Bot

Minimal Freqtrade milestone using the official stable Docker image and Docker Compose.

## Scope

- Exchange: Kraken
- Pair: `BTC/EUR`
- Trading mode: spot
- Runtime mode: dry-run / paper trading only
- Maximum open trades: `1`
- No real API keys
- No live trading
- No custom strategy or dashboard

This milestone runs Freqtrade's built-in web server for FreqUI. It does not start live trading and does not require a strategy yet.

## Commands

Run all commands from this directory.

Before starting the bot for the first time, create your local config from the safe example:

```bash
cp user_data/config.example.json user_data/config.json
```

### Validate Docker Compose

```bash
docker compose config
```

### Pull the official stable image

```bash
docker compose pull
```

### Start Freqtrade

```bash
docker compose up -d
```

### View logs

```bash
docker compose logs -f freqtrade
```

### Stop Freqtrade

```bash
docker compose down
```

### Open FreqUI

Open:

```text
http://localhost:8080
```

Use the local dry-run credentials from `user_data/config.json`. If you copied the example config, change the placeholder API-server password before exposing FreqUI beyond localhost.

```text
Username: freqtrade
Password: see user_data/config.json
```

## Safety Notes

This project is configured with `"dry_run": true`, empty Kraken API credentials, and Docker port binding limited to localhost. Do not add real API keys or switch dry-run off unless you intentionally move to a later live-trading milestone.
