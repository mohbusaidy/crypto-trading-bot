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
- Baseline strategy: `BtcBaselineStrategy`
- Read-only local dashboard

This project runs Freqtrade in dry-run mode with FreqUI enabled on localhost. It uses a deliberately simple baseline strategy for paper-trading validation only.

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

The local dry-run wallet and stake settings are simulation assumptions, not recommendations:

- `dry_run_wallet`: currently `1000` EUR
- `stake_amount`: currently `100` EUR

Review and choose these values yourself before relying on any paper-trading result.

## Baseline Strategy

`BtcBaselineStrategy` uses `BTC/EUR` 1-hour candles and opens long positions only.

- EMA 50 is a medium-term moving average. It reacts faster to recent price changes.
- EMA 200 is a slower moving average. The strategy uses it as the broader trend reference.
- RSI is a momentum indicator. This baseline waits for RSI weakness, then a recovery above `35`.

Dashboard decisions mean:

- `ENTER`: the strategy's entry signal exists and the bot has room for a new position.
- `EXIT`: the strategy's exit signal exists while a position is open.
- `WAIT`: no actionable entry or exit decision is currently available.

These labels are observability signals for dry-run validation. They are not evidence that the strategy is profitable.

## Paper-Trading Protections

The strategy includes preliminary protections for paper-trading validation. These do not change EMA/RSI entry indicators.

- `CooldownPeriod`: waits `1` candle after a trade closes before allowing another entry.
- `StoplossGuard`: if `1` stop-loss happens within `24` one-hour candles, pauses entries for `12` one-hour candles.
- `MaxDrawdown`: if at least `3` trades within `168` one-hour candles exceed `8%` drawdown, pauses entries for `24` one-hour candles.

Treat these protection values as starting guardrails. They should be reviewed after enough paper-trading history exists.

## Read-Only Dashboard

The dashboard in `dashboard/` is a local Next.js app. It is read-only: it only calls server-side API routes that fetch current state from the local Freqtrade REST API. It does not place, close, or cancel trades.

The current historical Kraken dataset is preliminary until the long `download-data` command finishes. Any historical-performance values should be treated as incomplete.

The Strategy Monitor section reads Freqtrade's analyzed candle data and shows the latest completed 1-hour candle, EMA 50, EMA 200, RSI, entry/exit signal status, current decision, candle freshness, protection warnings, and a sanitized read-only event log.

Performance cannot be trusted until sufficient historical data is available and the strategy has been validated over a meaningful period.

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
