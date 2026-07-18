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

## Read-Only Dashboard

The dashboard in `dashboard/` is a local Next.js app. It is read-only: it only calls server-side API routes that fetch current state from the local Freqtrade REST API. It does not place, close, or cancel trades.

The current historical Kraken dataset is preliminary until the long `download-data` command finishes. Any historical-performance values should be treated as incomplete.

Install dashboard dependencies:

```bash
cd dashboard
npm install
```

Create a local environment file from the placeholder example:

```bash
cp .env.example .env.local
```

Then edit `dashboard/.env.local` with your local Freqtrade API credentials. Keep the API URL bound to localhost:

```text
FREQTRADE_API_URL=http://127.0.0.1:8080
FREQTRADE_USERNAME=<local freqtrade username>
FREQTRADE_PASSWORD=<local freqtrade password>
FREQTRADE_TIMEOUT_MS=5000
```

Start the dashboard:

```bash
npm run dev
```

Open:

```text
http://localhost:3000
```

Stop the dashboard with `Ctrl+C` in the terminal running `npm run dev`.
