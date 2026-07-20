import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import type {
  ApiEndpointStatus,
  DashboardSummary,
  DashboardWarning,
  EventLogEntry,
  OpenPosition,
  RecentTrade,
  RiskProtection,
  RiskProtections,
  SignalDecision,
  StrategyMonitor
} from "@/app/lib/freqtrade-types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type JsonObject = Record<string, unknown>;

type FetchResult = {
  endpoint: string;
  status: number | "error";
  ok: boolean;
  data: unknown;
  message: string;
};

const MONITORED_PAIR_FALLBACK = "BTC/EUR";
const MONITORED_TIMEFRAME_FALLBACK = "1h";
const CANDLE_LIMIT = "260";
const ONE_HOUR_MS = 60 * 60 * 1000;
const CANDLE_STALE_AFTER_MS = 90 * 60 * 1000;
const RESTART_NOTICE_WINDOW_MS = 10 * 60 * 1000;
const MAX_EVENT_LOG_ENTRIES = 100;
const HISTORICAL_DATASET_WARNING =
  "Historical backtesting is preliminary because the Kraken dataset is incomplete. Paper-trading statistics shown here are separate.";
const EXPECTED_PROTECTIONS = ["CooldownPeriod", "StoplossGuard", "MaxDrawdown"];

let eventLogStore: EventLogEntry[] = [];
let lastEventSignature: string | null = null;

const READ_ONLY_ENDPOINTS = {
  ping: "/api/v1/ping",
  login: "/api/v1/token/login",
  showConfig: "/api/v1/show_config",
  status: "/api/v1/status",
  count: "/api/v1/count",
  profit: "/api/v1/profit",
  balance: "/api/v1/balance",
  performance: "/api/v1/performance",
  trades: "/api/v1/trades",
  whitelist: "/api/v1/whitelist",
  locks: "/api/v1/locks",
  sysInfo: "/api/v1/sysinfo",
  version: "/api/v1/version"
} as const;

const unavailable = (source?: string) => ({
  value: null,
  available: false,
  source
});

const available = <T,>(value: T, source?: string) => ({
  value,
  available: true,
  source
});

const isObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const asString = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value : null;

const asNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const asNumberLike = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const asBoolean = (value: unknown): boolean | null =>
  typeof value === "boolean" ? value : null;

const asSignalBoolean = (value: unknown): boolean | null => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes"].includes(normalized)) return true;
    if (["false", "0", "no"].includes(normalized)) return false;
  }
  return null;
};

const asDecision = (value: unknown): SignalDecision | null => {
  if (value === "ENTER" || value === "EXIT" || value === "WAIT") return value;
  return null;
};

const firstString = (source: JsonObject | null, keys: string[]): string | null => {
  if (!source) return null;
  for (const key of keys) {
    const value = asString(source[key]);
    if (value !== null) return value;
  }
  return null;
};

const firstNumber = (source: JsonObject | null, keys: string[]): number | null => {
  if (!source) return null;
  for (const key of keys) {
    const value = asNumber(source[key]);
    if (value !== null) return value;
  }
  return null;
};

const firstNumberLike = (source: JsonObject | null, keys: string[]): number | null => {
  if (!source) return null;
  for (const key of keys) {
    const value = asNumberLike(source[key]);
    if (value !== null) return value;
  }
  return null;
};

const firstBoolean = (source: JsonObject | null, keys: string[]): boolean | null => {
  if (!source) return null;
  for (const key of keys) {
    const value = asBoolean(source[key]);
    if (value !== null) return value;
  }
  return null;
};

const arrayFromPayload = (payload: unknown, keys: string[]): JsonObject[] => {
  if (Array.isArray(payload)) {
    return payload.filter(isObject);
  }

  if (!isObject(payload)) {
    return [];
  }

  for (const key of keys) {
    const value = payload[key];
    if (Array.isArray(value)) {
      return value.filter(isObject);
    }
  }

  return [];
};

const endpointStatus = (result: FetchResult): ApiEndpointStatus => ({
  endpoint: result.endpoint,
  status: result.status,
  ok: result.ok,
  message: result.message
});

const safeBaseUrl = () => {
  const raw = process.env.FREQTRADE_API_URL ?? "http://127.0.0.1:8080";
  return raw.replace(/\/+$/, "");
};

const repoRoot = () =>
  path.basename(process.cwd()) === "dashboard"
    ? path.dirname(process.cwd())
    : process.cwd();

const readLocalConfig = async (): Promise<JsonObject | null> => {
  try {
    const file = await readFile(path.join(repoRoot(), "user_data", "config.json"), "utf8");
    const parsed = JSON.parse(file) as unknown;
    return isObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const sanitizeStrategyName = (strategyName: string | null) =>
  (strategyName ?? "BtcBaselineStrategy").replace(/[^A-Za-z0-9_]/g, "");

const extractProtectionBlocks = (source: string) => {
  const methodStart = source.indexOf("def protections");
  if (methodStart === -1) return [];

  const returnStart = source.indexOf("return [", methodStart);
  if (returnStart === -1) return [];

  const listStart = source.indexOf("[", returnStart);
  let bracketDepth = 0;
  let listEnd = -1;

  for (let index = listStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === "[") bracketDepth += 1;
    if (char === "]") bracketDepth -= 1;
    if (bracketDepth === 0) {
      listEnd = index;
      break;
    }
  }

  if (listEnd === -1) return [];

  const listBody = source.slice(listStart + 1, listEnd);
  const blocks: string[] = [];
  let braceDepth = 0;
  let blockStart = -1;

  for (let index = 0; index < listBody.length; index += 1) {
    const char = listBody[index];
    if (char === "{") {
      if (braceDepth === 0) blockStart = index;
      braceDepth += 1;
    }
    if (char === "}") {
      braceDepth -= 1;
      if (braceDepth === 0 && blockStart !== -1) {
        blocks.push(listBody.slice(blockStart, index + 1));
        blockStart = -1;
      }
    }
  }

  return blocks;
};

const parsePythonDict = (block: string): JsonObject | null => {
  const jsonish = block
    .replace(/\bTrue\b/g, "true")
    .replace(/\bFalse\b/g, "false")
    .replace(/\bNone\b/g, "null")
    .replace(/,\s*([}\]])/g, "$1");

  try {
    const parsed = JSON.parse(jsonish) as unknown;
    return isObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const readStrategyProtections = async (
  strategyName: string | null
): Promise<JsonObject[] | null> => {
  try {
    const safeName = sanitizeStrategyName(strategyName);
    const file = await readFile(
      path.join(repoRoot(), "user_data", "strategies", `${safeName}.py`),
      "utf8"
    );
    return extractProtectionBlocks(file)
      .map(parsePythonDict)
      .filter((protection): protection is JsonObject => protection !== null);
  } catch {
    return null;
  }
};

const timeoutMs = () => {
  const parsed = Number(process.env.FREQTRADE_TIMEOUT_MS ?? "5000");
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 5000;
};

const pairCandlesEndpoint = (pair: string, timeframe: string) => {
  const query = new URLSearchParams({
    pair,
    timeframe,
    limit: CANDLE_LIMIT
  });

  return `/api/v1/pair_candles?${query.toString()}`;
};

const ratioPercent = (value: number) => `${(value * 100).toFixed(2)}%`;

const formatConfigValue = (value: unknown): string => {
  if (typeof value === "boolean") return value ? "Enabled" : "Disabled";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string" && value.trim().length > 0) return value;
  if (value === null || value === undefined) return "Not configured";
  if (Array.isArray(value)) return value.map(formatConfigValue).join(", ");
  if (isObject(value)) {
    return Object.entries(value)
      .map(([key, item]) => `${key}: ${formatConfigValue(item)}`)
      .join("; ");
  }
  return "Not available";
};

const formatMinimalRoi = (value: unknown): string | null => {
  if (!isObject(value)) return null;

  const entries = Object.entries(value);
  if (entries.length === 0) return "Not configured";

  return entries
    .map(([minute, roi]) => {
      const roiNumber = asNumberLike(roi);
      return `${minute} min: ${roiNumber !== null ? ratioPercent(roiNumber) : formatConfigValue(roi)}`;
    })
    .join("; ");
};

const formatOrderTypes = (value: unknown): string | null => {
  if (!isObject(value)) return null;

  const entries = Object.entries(value);
  if (entries.length === 0) return "Not configured";

  return entries.map(([key, item]) => `${key}: ${formatConfigValue(item)}`).join("; ");
};

const formatProtectionDetails = (protection: JsonObject) =>
  Object.entries(protection)
    .filter(([key]) => key !== "method")
    .map(([key, value]) => `${key.replace(/_/g, " ")}: ${formatConfigValue(value)}`);

const buildProtectionSettings = (
  protections: JsonObject[] | null
): RiskProtection[] => {
  if (protections === null) {
    return EXPECTED_PROTECTIONS.map((method) => ({
      method,
      status: "unavailable",
      preliminary: true,
      source: "strategy",
      details: ["Protection settings could not be read from the strategy file."]
    }));
  }

  return EXPECTED_PROTECTIONS.map((method) => {
    const found = protections.find((protection) => protection.method === method);

    if (!found) {
      return {
        method,
        status: "not_configured",
        preliminary: true,
        source: "strategy",
        details: ["Not configured"]
      };
    }

    return {
      method,
      status: "configured",
      preliminary: true,
      source: "strategy",
      details: formatProtectionDetails(found)
    };
  });
};

const buildRiskProtections = ({
  showConfig,
  localConfig,
  strategyProtections
}: {
  showConfig: JsonObject | null;
  localConfig: JsonObject | null;
  strategyProtections: JsonObject[] | null;
}): RiskProtections => {
  const dryRunWallet = firstNumberLike(localConfig, ["dry_run_wallet"]);
  const stakeAmount =
    firstNumberLike(showConfig, ["stake_amount"]) ??
    firstNumberLike(localConfig, ["stake_amount"]);
  const stakeAmountString =
    stakeAmount === null
      ? firstString(showConfig, ["stake_amount"]) ?? firstString(localConfig, ["stake_amount"])
      : null;
  const minimalRoi = formatMinimalRoi(showConfig?.minimal_roi ?? localConfig?.minimal_roi);
  const orderTypes = formatOrderTypes(showConfig?.order_types ?? localConfig?.order_types);
  const trailingStop = firstBoolean(showConfig, ["trailing_stop"]);

  return {
    dryRunWallet:
      dryRunWallet !== null ? available(dryRunWallet, "local_config") : unavailable("local_config"),
    stakeAmount:
      stakeAmount !== null
        ? available(stakeAmount, "show_config")
        : stakeAmountString !== null
          ? available(stakeAmountString, "show_config")
          : unavailable("show_config"),
    maxOpenTrades:
      firstNumberLike(showConfig, ["max_open_trades"]) !== null
        ? available(firstNumberLike(showConfig, ["max_open_trades"]) as number, "show_config")
        : unavailable("show_config"),
    stoploss:
      firstNumberLike(showConfig, ["stoploss"]) !== null
        ? available(firstNumberLike(showConfig, ["stoploss"]) as number, "show_config")
        : unavailable("show_config"),
    minimalRoi:
      minimalRoi !== null ? available(minimalRoi, "show_config") : unavailable("show_config"),
    trailingStop:
      trailingStop !== null ? available(trailingStop, "show_config") : unavailable("show_config"),
    orderTypes:
      orderTypes !== null ? available(orderTypes, "show_config") : unavailable("show_config"),
    protections: buildProtectionSettings(strategyProtections)
  };
};

const readJson = async (
  baseUrl: string,
  endpoint: string,
  options: RequestInit = {}
): Promise<FetchResult> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs());

  try {
    const response = await fetch(`${baseUrl}${endpoint}`, {
      ...options,
      cache: "no-store",
      signal: controller.signal
    });
    const text = await response.text();
    let data: unknown = null;

    if (text.trim().length > 0) {
      try {
        data = JSON.parse(text);
      } catch {
        data = { message: "Non-JSON response" };
      }
    }

    const detail = isObject(data) ? asString(data.detail) : null;

    return {
      endpoint,
      status: response.status,
      ok: response.ok,
      data,
      message: detail ?? response.statusText ?? "Response received"
    };
  } catch (error) {
    const message =
      error instanceof Error && error.name === "AbortError"
        ? "Request timed out"
        : "Request failed";

    return {
      endpoint,
      status: "error",
      ok: false,
      data: null,
      message
    };
  } finally {
    clearTimeout(timeout);
  }
};

const login = async (baseUrl: string) => {
  const username = process.env.FREQTRADE_USERNAME;
  const password = process.env.FREQTRADE_PASSWORD;

  if (!username || !password) {
    return {
      result: {
        endpoint: READ_ONLY_ENDPOINTS.login,
        status: "error",
        ok: false,
        data: null,
        message: "Server-side Freqtrade credentials are not configured"
      } satisfies FetchResult,
      token: null
    };
  }

  const basicAuth = Buffer.from(`${username}:${password}`).toString("base64");
  const result = await readJson(baseUrl, READ_ONLY_ENDPOINTS.login, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth}`
    }
  });

  const token =
    result.ok && isObject(result.data) ? asString(result.data.access_token) : null;

  return { result, token };
};

const bearerHeaders = (token: string) => ({
  Authorization: `Bearer ${token}`
});

const pickShowConfig = (payload: unknown) => (isObject(payload) ? payload : null);

const mapOpenPositions = (payload: unknown): OpenPosition[] =>
  arrayFromPayload(payload, ["trades", "open_trades", "result"]).map((trade) => ({
    pair:
      asString(trade.pair) !== null
        ? available(asString(trade.pair) as string, "status")
        : unavailable("status"),
    entryPrice:
      firstNumber(trade, ["open_rate", "entry_rate", "entry_price"]) !== null
        ? available(
            firstNumber(trade, ["open_rate", "entry_rate", "entry_price"]) as number,
            "status"
          )
        : unavailable("status"),
    currentPrice:
      firstNumber(trade, ["current_rate", "close_rate", "current_price"]) !== null
        ? available(
            firstNumber(trade, ["current_rate", "close_rate", "current_price"]) as number,
            "status"
          )
        : unavailable("status"),
    positionSize:
      firstNumber(trade, ["amount", "stake_amount"]) !== null
        ? available(firstNumber(trade, ["amount", "stake_amount"]) as number, "status")
        : unavailable("status"),
    unrealizedProfit:
      firstNumber(trade, ["profit_abs", "profit_ratio", "profit_pct"]) !== null
        ? available(
            firstNumber(trade, ["profit_abs", "profit_ratio", "profit_pct"]) as number,
            "status"
          )
        : unavailable("status"),
    entryTime:
      firstString(trade, ["open_date", "open_date_hum", "entry_date"]) !== null
        ? available(
            firstString(trade, ["open_date", "open_date_hum", "entry_date"]) as string,
            "status"
          )
        : unavailable("status"),
    stopLoss:
      firstNumber(trade, ["stop_loss_abs", "stop_loss", "stoploss_current_dist"]) !== null
        ? available(
            firstNumber(trade, [
              "stop_loss_abs",
              "stop_loss",
              "stoploss_current_dist"
            ]) as number,
            "status"
          )
        : unavailable("status")
  }));

const mapRecentTrades = (payload: unknown): RecentTrade[] =>
  arrayFromPayload(payload, ["trades", "result"])
    .slice(0, 10)
    .map((trade) => ({
      entryTime:
        firstString(trade, ["open_date", "open_date_hum", "entry_date"]) !== null
          ? available(
              firstString(trade, ["open_date", "open_date_hum", "entry_date"]) as string,
              "trades"
            )
          : unavailable("trades"),
      exitTime:
        firstString(trade, ["close_date", "close_date_hum", "exit_date"]) !== null
          ? available(
              firstString(trade, ["close_date", "close_date_hum", "exit_date"]) as string,
              "trades"
            )
          : unavailable("trades"),
      entryPrice:
        firstNumber(trade, ["open_rate", "entry_rate", "entry_price"]) !== null
          ? available(
              firstNumber(trade, ["open_rate", "entry_rate", "entry_price"]) as number,
              "trades"
            )
          : unavailable("trades"),
      exitPrice:
        firstNumber(trade, ["close_rate", "exit_rate", "exit_price"]) !== null
          ? available(
              firstNumber(trade, ["close_rate", "exit_rate", "exit_price"]) as number,
              "trades"
            )
          : unavailable("trades"),
      netProfit:
        firstNumber(trade, ["close_profit_abs", "profit_abs", "profit_ratio"]) !== null
          ? available(
              firstNumber(trade, ["close_profit_abs", "profit_abs", "profit_ratio"]) as number,
              "trades"
            )
          : unavailable("trades"),
      exitReason:
        firstString(trade, ["exit_reason", "sell_reason"]) !== null
          ? available(firstString(trade, ["exit_reason", "sell_reason"]) as string, "trades")
          : unavailable("trades"),
      duration:
        firstString(trade, ["duration", "trade_duration"]) !== null
          ? available(firstString(trade, ["duration", "trade_duration"]) as string, "trades")
          : unavailable("trades")
    }));

const rowsFromPairCandles = (payload: unknown): JsonObject[] => {
  if (!isObject(payload)) return [];

  const columns = Array.isArray(payload.columns)
    ? payload.columns.filter((column): column is string => typeof column === "string")
    : [];
  const rows = Array.isArray(payload.data) ? payload.data : [];

  return rows
    .filter((row): row is unknown[] => Array.isArray(row))
    .map((row) =>
      columns.reduce<JsonObject>((mapped, column, index) => {
        mapped[column] = row[index];
        return mapped;
      }, {})
    );
};

const timestampMsFromRow = (row: JsonObject | null) => {
  if (!row) return null;
  const value = firstString(row, ["date", "observed_candle_timestamp"]);
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
};

const formatDuration = (ms: number) => {
  const absMs = Math.max(0, Math.abs(ms));
  const hours = Math.floor(absMs / ONE_HOUR_MS);
  const minutes = Math.floor((absMs % ONE_HOUR_MS) / 60_000);

  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
};

const timeframeMsFromConfig = (showConfig: JsonObject | null, candlePayload: JsonObject | null) =>
  firstNumber(candlePayload, ["timeframe_ms"]) ??
  firstNumber(showConfig, ["timeframe_ms"]) ??
  ONE_HOUR_MS;

const latestCompletedRow = (rows: JsonObject[], timeframeMs: number, nowMs: number) => {
  for (const row of [...rows].reverse()) {
    const timestamp = timestampMsFromRow(row);
    if (timestamp !== null && timestamp + timeframeMs <= nowMs) {
      return row;
    }
  }

  return null;
};

const nextCandleClose = (nowMs: number, timeframeMs: number) =>
  Math.floor(nowMs / timeframeMs) * timeframeMs + timeframeMs;

const strategyIndicatorsAvailable = (monitor: StrategyMonitor) =>
  monitor.latestCompletedCandleTimestamp.available &&
  monitor.ema50.available &&
  monitor.ema200.available &&
  monitor.rsi.available &&
  monitor.entrySignal.available &&
  monitor.exitSignal.available;

const buildStrategyMonitor = ({
  candlePayload,
  count,
  openPositions,
  generatedAt,
  showConfig
}: {
  candlePayload: JsonObject | null;
  count: JsonObject | null;
  openPositions: OpenPosition[];
  generatedAt: string;
  showConfig: JsonObject | null;
}): StrategyMonitor => {
  const nowMs = Date.parse(generatedAt);
  const timeframeMs = timeframeMsFromConfig(showConfig, candlePayload);
  const rows = rowsFromPairCandles(candlePayload);
  const row = latestCompletedRow(rows, timeframeMs, nowMs);
  const rowTimestampMs = timestampMsFromRow(row);
  const openPositionCount =
    firstNumber(count, ["current", "open_trade_count", "count"]) ?? openPositions.length;

  const entrySignal = row ? asSignalBoolean(row.entry_signal) : null;
  const exitSignal = row ? asSignalBoolean(row.exit_signal) : null;
  const rawDecision = row ? asDecision(row.signal_decision) : null;

  let decision: SignalDecision | null = rawDecision;
  if (entrySignal !== null || exitSignal !== null) {
    if (exitSignal === true && openPositionCount > 0) {
      decision = "EXIT";
    } else if (entrySignal === true && openPositionCount === 0) {
      decision = "ENTER";
    } else {
      decision = "WAIT";
    }
  }

  const strategyReason = row ? firstString(row, ["signal_reason"]) : null;
  const reason =
    exitSignal === true && openPositionCount === 0
      ? "WAIT: the exit condition is currently met, but there is no open position to close."
      : entrySignal === true && openPositionCount > 0
        ? "WAIT: an entry signal exists, but max_open_trades is already in use."
        : strategyReason;

  const candleCloseMs = rowTimestampMs !== null ? rowTimestampMs + timeframeMs : null;
  const ageMs = candleCloseMs !== null ? nowMs - candleCloseMs : null;
  const candleIsFuture = ageMs !== null && ageMs < -5 * 60_000;
  const candleIsStale =
    ageMs !== null && !candleIsFuture ? ageMs > CANDLE_STALE_AFTER_MS : candleIsFuture;
  const freshness =
    ageMs === null
      ? unavailable("pair_candles")
      : candleIsFuture
        ? available("Clock mismatch: latest completed candle appears to be in the future.", "pair_candles")
        : candleIsStale
          ? available(
              `Stale: latest completed candle closed ${formatDuration(ageMs)} ago.`,
              "pair_candles"
            )
          : available(
              `Fresh: latest completed candle closed ${formatDuration(ageMs)} ago.`,
              "pair_candles"
            );

  const timeUntilClose =
    Number.isFinite(nowMs) && Number.isFinite(timeframeMs) && timeframeMs > 0
      ? available(
          formatDuration(nextCandleClose(nowMs, timeframeMs) - nowMs),
          "local_clock"
        )
      : unavailable("local_clock");

  return {
    currentDecision: decision !== null ? available(decision, "strategy") : unavailable("strategy"),
    latestPrice:
      row && firstNumber(row, ["close"]) !== null
        ? available(firstNumber(row, ["close"]) as number, "pair_candles")
        : unavailable("pair_candles"),
    latestCompletedCandleTimestamp:
      row && firstString(row, ["date", "observed_candle_timestamp"]) !== null
        ? available(
            firstString(row, ["date", "observed_candle_timestamp"]) as string,
            "pair_candles"
          )
        : unavailable("pair_candles"),
    candleDataFreshness: freshness,
    candleIsStale,
    timeUntilCurrentCandleClose: timeUntilClose,
    ema50:
      row && firstNumber(row, ["ema_50"]) !== null
        ? available(firstNumber(row, ["ema_50"]) as number, "strategy")
        : unavailable("strategy"),
    ema200:
      row && firstNumber(row, ["ema_200"]) !== null
        ? available(firstNumber(row, ["ema_200"]) as number, "strategy")
        : unavailable("strategy"),
    rsi:
      row && firstNumber(row, ["rsi"]) !== null
        ? available(firstNumber(row, ["rsi"]) as number, "strategy")
        : unavailable("strategy"),
    trendCondition:
      row && asSignalBoolean(row.trend_condition) !== null
        ? available(asSignalBoolean(row.trend_condition) as boolean, "strategy")
        : unavailable("strategy"),
    pullbackCondition:
      row && asSignalBoolean(row.rsi_pullback_condition) !== null
        ? available(asSignalBoolean(row.rsi_pullback_condition) as boolean, "strategy")
        : unavailable("strategy"),
    recoveryCondition:
      row && asSignalBoolean(row.rsi_recovery_condition) !== null
        ? available(asSignalBoolean(row.rsi_recovery_condition) as boolean, "strategy")
        : unavailable("strategy"),
    entrySignal:
      entrySignal !== null ? available(entrySignal, "strategy") : unavailable("strategy"),
    exitSignal: exitSignal !== null ? available(exitSignal, "strategy") : unavailable("strategy"),
    reason: reason !== null ? available(reason, "strategy") : unavailable("strategy")
  };
};

const endpointSummary = (results: FetchResult[]) => {
  const last = results.at(-1);
  const okCount = results.filter((result) => result.ok).length;

  return {
    reachable: results.some((result) => result.ok),
    connectionStatus:
      okCount === 0 ? "unavailable" : okCount === results.length ? "connected" : "degraded",
    lastApiResponse: last
      ? `${last.endpoint}: ${last.status} ${last.message}`
      : "No API response"
  } as const;
};

const lockText = (lock: JsonObject) =>
  [
    firstString(lock, ["pair"]) ?? "global",
    firstString(lock, ["reason"]),
    firstString(lock, ["lock_end_time", "until", "end_time"])
  ]
    .filter(Boolean)
    .join(" | ");

const warningMessagesForLocks = (locks: JsonObject[]): DashboardWarning[] =>
  locks.map((lock) => {
    const text = lockText(lock);
    const normalized = text.toLowerCase();

    if (normalized.includes("drawdown")) {
      return {
        level: "warning",
        message: `Daily or rolling drawdown protection activated: ${text}`
      };
    }

    if (normalized.includes("stoploss")) {
      return {
        level: "warning",
        message: `Stoploss protection activated: ${text}`
      };
    }

    return {
      level: "info",
      message: `Protection lock active: ${text}`
    };
  });

const orderWarningsFromStatus = (payload: unknown): DashboardWarning[] =>
  arrayFromPayload(payload, ["trades", "open_trades", "result"]).flatMap((trade) => {
    const pair = asString(trade.pair) ?? MONITORED_PAIR_FALLBACK;
    const orders = Array.isArray(trade.orders) ? trade.orders.filter(isObject) : [];

    return orders
      .filter((order) => {
        const status = firstString(order, ["status", "ft_order_side", "safe_order_status"]);
        return status !== null && /(reject|expire|cancel|fail|error)/i.test(status);
      })
      .map((order) => ({
        level: "warning" as const,
        message: `Order warning for ${pair}: ${firstString(order, ["status"]) ?? "unknown status"}`
      }));
  });

const warningState = (warnings: DashboardWarning[]) =>
  warnings.map((warning) => `${warning.level}:${warning.message}`).sort();

const eventSignatureFromSnapshot = ({
  botState,
  monitor,
  openPositionCount,
  apiConnectionState,
  historicalWarningActive,
  locks,
  endpointFailures
}: {
  botState: string;
  monitor: StrategyMonitor;
  openPositionCount: number | null;
  apiConnectionState: string;
  historicalWarningActive: boolean;
  locks: JsonObject[];
  endpointFailures: FetchResult[];
}) =>
  JSON.stringify({
    botState,
    currentDecision: monitor.currentDecision.value,
    entryCondition: monitor.entrySignal.value,
    exitCondition: monitor.exitSignal.value,
    openPositionCount,
    apiConnectionState,
    candleFreshnessState: monitor.candleIsStale
      ? "stale"
      : monitor.candleDataFreshness.available
        ? "fresh"
        : "unavailable",
    historicalWarningActive,
    protectionState: locks.map(lockText).sort(),
    errors: endpointFailures
      .map((failure) => `${failure.endpoint}:${failure.status}:${failure.message}`)
      .sort()
  });

const eventTypeForSnapshot = ({
  endpointFailures,
  warnings,
  locks
}: {
  endpointFailures: FetchResult[];
  warnings: DashboardWarning[];
  locks: JsonObject[];
}) => {
  if (endpointFailures.length > 0) return "api_error";
  if (locks.length > 0) return "protection_state";
  if (warnings.some((warning) => warning.level === "error")) return "error";
  if (warnings.length > 0) return "warning";
  return "state_change";
};

const eventDetailsForSnapshot = ({
  openPositionCount,
  apiConnectionState,
  monitor,
  warnings,
  locks,
  endpointFailures
}: {
  openPositionCount: number | null;
  apiConnectionState: string;
  monitor: StrategyMonitor;
  warnings: DashboardWarning[];
  locks: JsonObject[];
  endpointFailures: FetchResult[];
}) => {
  const details = [
    `API: ${apiConnectionState}`,
    `Open positions: ${openPositionCount ?? "Not available"}`,
    `Entry condition: ${monitor.entrySignal.value === true ? "met" : monitor.entrySignal.value === false ? "not met" : "not available"}`,
    `Exit condition: ${monitor.exitSignal.value === true ? "met" : monitor.exitSignal.value === false ? "not met" : "not available"}`,
    `Candle freshness: ${monitor.candleIsStale ? "stale" : monitor.candleDataFreshness.available ? "fresh" : "not available"}`
  ];

  if (locks.length > 0) {
    details.push(`Protections: ${locks.map(lockText).join(" || ")}`);
  }

  if (endpointFailures.length > 0) {
    details.push(
      `Errors: ${endpointFailures
        .map((failure) => `${failure.endpoint} ${failure.status} ${failure.message}`)
        .join(" || ")}`
    );
  }

  if (warnings.length > 0) {
    details.push(`Warnings: ${warningState(warnings).join(" || ")}`);
  }

  return details.join(" | ");
};

const updateEventLogFromSnapshot = ({
  generatedAt,
  pair,
  botState,
  monitor,
  warnings,
  locks,
  endpointFailures,
  openPositionCount,
  apiConnectionState,
  historicalWarningActive
}: {
  generatedAt: string;
  pair: string;
  botState: string;
  monitor: StrategyMonitor;
  warnings: DashboardWarning[];
  locks: JsonObject[];
  endpointFailures: FetchResult[];
  openPositionCount: number | null;
  apiConnectionState: string;
  historicalWarningActive: boolean;
}): EventLogEntry[] => {
  const signature = eventSignatureFromSnapshot({
    botState,
    monitor,
    openPositionCount,
    apiConnectionState,
    historicalWarningActive,
    locks,
    endpointFailures
  });

  if (signature === lastEventSignature) {
    return eventLogStore;
  }

  const decision = monitor.currentDecision.value ?? "Not available";
  const reason = monitor.reason.value ?? "Not available";
  const event: EventLogEntry = {
    timestamp: generatedAt,
    eventType: eventTypeForSnapshot({ endpointFailures, warnings, locks }),
    pair,
    botState,
    signalDecision: decision,
    signalReason: reason,
    details: eventDetailsForSnapshot({
      openPositionCount,
      apiConnectionState,
      monitor,
      warnings,
      locks,
      endpointFailures
    })
  };

  eventLogStore = [event, ...eventLogStore].slice(0, MAX_EVENT_LOG_ENTRIES);
  lastEventSignature = signature;

  return eventLogStore;
};

export async function GET() {
  const generatedAt = new Date().toISOString();
  const nowMs = Date.parse(generatedAt);
  const baseUrl = safeBaseUrl();
  const results: FetchResult[] = [];

  const ping = await readJson(baseUrl, READ_ONLY_ENDPOINTS.ping);
  results.push(ping);

  const { result: loginResult, token } = await login(baseUrl);
  results.push({
    ...loginResult,
    message: loginResult.ok ? "Authenticated" : loginResult.message
  });

  const authed = token !== null;
  const headers = token ? bearerHeaders(token) : undefined;

  const [
    showConfigResult,
    statusResult,
    countResult,
    profitResult,
    balanceResult,
    performanceResult,
    tradesResult,
    whitelistResult,
    locksResult,
    sysInfoResult,
    versionResult
  ] = authed
    ? await Promise.all([
        readJson(baseUrl, READ_ONLY_ENDPOINTS.showConfig, { headers }),
        readJson(baseUrl, READ_ONLY_ENDPOINTS.status, { headers }),
        readJson(baseUrl, READ_ONLY_ENDPOINTS.count, { headers }),
        readJson(baseUrl, READ_ONLY_ENDPOINTS.profit, { headers }),
        readJson(baseUrl, READ_ONLY_ENDPOINTS.balance, { headers }),
        readJson(baseUrl, READ_ONLY_ENDPOINTS.performance, { headers }),
        readJson(baseUrl, READ_ONLY_ENDPOINTS.trades, { headers }),
        readJson(baseUrl, READ_ONLY_ENDPOINTS.whitelist, { headers }),
        readJson(baseUrl, READ_ONLY_ENDPOINTS.locks, { headers }),
        readJson(baseUrl, READ_ONLY_ENDPOINTS.sysInfo, { headers }),
        readJson(baseUrl, READ_ONLY_ENDPOINTS.version, { headers })
      ])
    : [
        READ_ONLY_ENDPOINTS.showConfig,
        READ_ONLY_ENDPOINTS.status,
        READ_ONLY_ENDPOINTS.count,
        READ_ONLY_ENDPOINTS.profit,
        READ_ONLY_ENDPOINTS.balance,
        READ_ONLY_ENDPOINTS.performance,
        READ_ONLY_ENDPOINTS.trades,
        READ_ONLY_ENDPOINTS.whitelist,
        READ_ONLY_ENDPOINTS.locks,
        READ_ONLY_ENDPOINTS.sysInfo,
        READ_ONLY_ENDPOINTS.version
      ].map(
        (endpoint) =>
          ({
            endpoint,
            status: "error",
            ok: false,
            data: null,
            message: "Skipped because authentication failed"
          }) satisfies FetchResult
      );

  results.push(
    showConfigResult,
    statusResult,
    countResult,
    profitResult,
    balanceResult,
    performanceResult,
    tradesResult,
    whitelistResult,
    locksResult,
    sysInfoResult,
    versionResult
  );

  const showConfig = pickShowConfig(showConfigResult.data);
  const profit = isObject(profitResult.data) ? profitResult.data : null;
  const balance = isObject(balanceResult.data) ? balanceResult.data : null;
  const count = isObject(countResult.data) ? countResult.data : null;
  const whitelist = isObject(whitelistResult.data) ? whitelistResult.data : null;
  const locks = arrayFromPayload(locksResult.data, ["locks"]);
  const tradeList = mapRecentTrades(tradesResult.data);
  const openPositions = mapOpenPositions(statusResult.data);
  const localConfig = await readLocalConfig();
  const strategyName = firstString(showConfig, ["strategy", "strategy_name"]);
  const strategyProtections = await readStrategyProtections(strategyName);

  const pairsFromApi = Array.isArray(whitelist?.whitelist)
    ? whitelist.whitelist.filter((pair): pair is string => typeof pair === "string")
    : [];
  const configuredPair = pairsFromApi[0] ?? MONITORED_PAIR_FALLBACK;
  const configuredTimeframe =
    firstString(showConfig, ["timeframe"]) ?? MONITORED_TIMEFRAME_FALLBACK;

  const pairCandlesResult =
    authed && headers
      ? await readJson(baseUrl, pairCandlesEndpoint(configuredPair, configuredTimeframe), {
          headers
        })
      : ({
          endpoint: pairCandlesEndpoint(configuredPair, configuredTimeframe),
          status: "error",
          ok: false,
          data: null,
          message: "Skipped because authentication failed"
        } satisfies FetchResult);

  results.push(pairCandlesResult);

  const candlePayload = isObject(pairCandlesResult.data) ? pairCandlesResult.data : null;
  const strategyMonitor = buildStrategyMonitor({
    candlePayload,
    count,
    openPositions,
    generatedAt,
    showConfig
  });
  const riskProtections = buildRiskProtections({
    showConfig,
    localConfig,
    strategyProtections
  });

  const dryRun = firstBoolean(showConfig, ["dry_run"]);
  const runningState = firstString(showConfig, ["state", "runmode"]);
  const shortAllowed = firstBoolean(showConfig, ["short_allowed"]);
  const tradingMode = firstString(showConfig, ["trading_mode"]);
  const botStartTimestamp = firstNumber(profit, ["bot_start_timestamp"]);
  const openPositionCount =
    firstNumberLike(count, ["current", "open_trade_count", "count"]) ??
    (statusResult.ok ? openPositions.length : null);
  const closedTradeCount =
    firstNumberLike(profit, ["closed_trade_count", "trade_count", "total_trades"]) ?? null;
  const hasClosedTrades = closedTradeCount !== null && closedTradeCount > 0;

  const api = endpointSummary(results);
  const botStateLabel = runningState ?? "Not available";
  const endpointFailures = results.filter((result) => !result.ok);
  const orderWarnings = orderWarningsFromStatus(statusResult.data);

  const warnings: DashboardWarning[] = [
    {
      level: "warning",
      message: HISTORICAL_DATASET_WARNING
    },
    ...(!api.reachable
      ? [
          {
            level: "error" as const,
            message: "Freqtrade API unreachable."
          }
        ]
      : []),
    ...(runningState !== null && runningState.toLowerCase() !== "running"
      ? [
          {
            level: "error" as const,
            message: `Bot stopped: current state is ${runningState}.`
          }
        ]
      : []),
    ...(dryRun === true
      ? []
      : [
          {
            level: "error" as const,
            message: "Dry-run mode could not be confirmed from the Freqtrade API."
          }
        ]),
    ...(tradingMode === "spot" && shortAllowed === false
      ? []
      : [
          {
            level: "warning" as const,
            message: "Spot-only long-only status could not be fully confirmed from the API."
          }
        ]),
    ...(strategyMonitor.candleIsStale
      ? [
          {
            level: "warning" as const,
            message: `Market data stale: ${
              strategyMonitor.candleDataFreshness.value ?? "freshness unavailable"
            }`
          }
        ]
      : []),
    ...(!strategyIndicatorsAvailable(strategyMonitor)
      ? [
          {
            level: "warning" as const,
            message: "Strategy indicators unavailable for the latest completed 1-hour candle."
          }
        ]
      : []),
    ...(botStartTimestamp !== null && nowMs - botStartTimestamp < RESTART_NOTICE_WINDOW_MS
      ? [
          {
            level: "warning" as const,
            message: "Bot restarted recently; confirm this restart was expected."
          }
        ]
      : []),
    ...warningMessagesForLocks(locks),
    ...orderWarnings,
    ...endpointFailures.map((result) => ({
      level: result.status === 503 ? ("info" as const) : ("warning" as const),
      message:
        result.status === 503
          ? `${result.endpoint}: Bot stopped or trading engine unavailable`
          : `API warning: ${result.endpoint} returned ${result.status} ${result.message}`
    }))
  ];

  const summary: DashboardSummary = {
    generatedAt,
    api: {
      baseUrl,
      reachable: api.reachable,
      authenticated: authed,
      connectionStatus: api.connectionStatus,
      lastSuccessfulRefreshTime: api.reachable ? generatedAt : null,
      lastApiResponse: api.lastApiResponse,
      endpoints: results.map(endpointStatus)
    },
    overview: {
      botStatus:
        runningState !== null
          ? available(runningState, "show_config")
          : unavailable("show_config"),
      dryRun:
        dryRun !== null ? available(dryRun, "show_config") : unavailable("show_config"),
      exchange:
        firstString(showConfig, ["exchange"]) !== null
          ? available(firstString(showConfig, ["exchange"]) as string, "show_config")
          : unavailable("show_config"),
      tradingPair:
        configuredPair !== null
          ? available(configuredPair, "whitelist")
          : unavailable("whitelist"),
      strategyName:
        firstString(showConfig, ["strategy", "strategy_name"]) !== null
          ? available(
              firstString(showConfig, ["strategy", "strategy_name"]) as string,
              "show_config"
            )
          : unavailable("show_config"),
      accountValue:
        firstNumber(balance, ["total", "total_balance", "starting_capital"]) !== null
          ? available(
              firstNumber(balance, ["total", "total_balance", "starting_capital"]) as number,
              "balance"
            )
          : unavailable("balance"),
      openPositionCount:
        openPositionCount !== null
          ? available(openPositionCount, openPositionCount === openPositions.length ? "status" : "count")
          : unavailable("count"),
      totalClosedTrades:
        closedTradeCount !== null
          ? available(closedTradeCount, "profit")
          : unavailable("profit"),
      totalProfitLoss:
        firstNumber(profit, ["profit_closed_coin", "profit_all_coin", "profit_total_abs"]) !== null
          ? available(
              firstNumber(profit, [
                "profit_closed_coin",
                "profit_all_coin",
                "profit_total_abs"
              ]) as number,
              "profit"
            )
          : unavailable("profit")
    },
    openPositions,
    recentTrades: tradeList,
    strategyMonitor,
    riskProtections,
    performance: {
      totalNetProfitLoss:
        firstNumber(profit, ["profit_closed_coin", "profit_all_coin", "profit_total_abs"]) !== null
          ? available(
              firstNumber(profit, [
                "profit_closed_coin",
                "profit_all_coin",
                "profit_total_abs"
              ]) as number,
              "profit"
            )
          : unavailable("profit"),
      winRate:
        hasClosedTrades && firstNumber(profit, ["winrate", "winning_percent"]) !== null
          ? available(firstNumber(profit, ["winrate", "winning_percent"]) as number, "profit")
          : unavailable("profit"),
      winningTrades:
        firstNumber(profit, ["winning_trades", "wins"]) !== null
          ? available(firstNumber(profit, ["winning_trades", "wins"]) as number, "profit")
          : closedTradeCount === 0
            ? available(0, "profit")
          : unavailable("profit"),
      losingTrades:
        firstNumber(profit, ["losing_trades", "losses"]) !== null
          ? available(firstNumber(profit, ["losing_trades", "losses"]) as number, "profit")
          : closedTradeCount === 0
            ? available(0, "profit")
          : unavailable("profit"),
      averageProfitPerTrade:
        hasClosedTrades && firstNumber(profit, ["avg_profit", "profit_mean"]) !== null
          ? available(firstNumber(profit, ["avg_profit", "profit_mean"]) as number, "profit")
          : unavailable("profit"),
      bestTrade:
        hasClosedTrades &&
        firstNumber(profit, ["best_pair_profit_abs", "best_trade_profit_abs"]) !== null
          ? available(
              firstNumber(profit, ["best_pair_profit_abs", "best_trade_profit_abs"]) as number,
              "profit"
            )
          : unavailable("profit"),
      worstTrade:
        hasClosedTrades &&
        firstNumber(profit, ["worst_pair_profit_abs", "worst_trade_profit_abs"]) !== null
          ? available(
              firstNumber(profit, ["worst_pair_profit_abs", "worst_trade_profit_abs"]) as number,
              "profit"
            )
          : unavailable("profit"),
      profitFactor:
        hasClosedTrades && firstNumber(profit, ["profit_factor"]) !== null
          ? available(firstNumber(profit, ["profit_factor"]) as number, "profit")
          : unavailable("profit"),
      maximumDrawdown:
        hasClosedTrades &&
        firstNumber(profit, ["max_drawdown", "max_drawdown_abs", "max_drawdown_account"]) !== null
          ? available(
              firstNumber(profit, [
                "max_drawdown",
                "max_drawdown_abs",
                "max_drawdown_account"
              ]) as number,
              "profit"
            )
          : unavailable("profit"),
      totalFees:
        firstNumber(profit, ["total_fee", "total_fees", "fee_total"]) !== null
          ? available(firstNumber(profit, ["total_fee", "total_fees", "fee_total"]) as number, "profit")
          : unavailable("profit")
    },
    systemHealth: {
      apiReachable: api.reachable,
      botRunningState:
        runningState !== null
          ? available(runningState, "show_config")
          : unavailable("show_config"),
      dryRunConfirmed: dryRun === true,
      preliminaryDatasetWarning: true,
      warnings
    },
    eventLog: updateEventLogFromSnapshot({
      generatedAt,
      pair: configuredPair,
      botState: botStateLabel,
      monitor: strategyMonitor,
      warnings,
      locks,
      endpointFailures,
      openPositionCount,
      apiConnectionState: api.connectionStatus,
      historicalWarningActive: true
    })
  };

  return NextResponse.json(summary, {
    headers: {
      "Cache-Control": "no-store"
    }
  });
}
