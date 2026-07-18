import { NextResponse } from "next/server";
import type {
  ApiEndpointStatus,
  DashboardSummary,
  OpenPosition,
  RecentTrade
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

const asBoolean = (value: unknown): boolean | null =>
  typeof value === "boolean" ? value : null;

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

const timeoutMs = () => {
  const parsed = Number(process.env.FREQTRADE_TIMEOUT_MS ?? "5000");
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 5000;
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
        ? available(firstNumber(trade, ["open_rate", "entry_rate", "entry_price"]) as number, "status")
        : unavailable("status"),
    currentPrice:
      firstNumber(trade, ["current_rate", "close_rate", "current_price"]) !== null
        ? available(firstNumber(trade, ["current_rate", "close_rate", "current_price"]) as number, "status")
        : unavailable("status"),
    positionSize:
      firstNumber(trade, ["amount", "stake_amount"]) !== null
        ? available(firstNumber(trade, ["amount", "stake_amount"]) as number, "status")
        : unavailable("status"),
    unrealizedProfit:
      firstNumber(trade, ["profit_abs", "profit_ratio", "profit_pct"]) !== null
        ? available(firstNumber(trade, ["profit_abs", "profit_ratio", "profit_pct"]) as number, "status")
        : unavailable("status"),
    entryTime:
      firstString(trade, ["open_date", "open_date_hum", "entry_date"]) !== null
        ? available(firstString(trade, ["open_date", "open_date_hum", "entry_date"]) as string, "status")
        : unavailable("status"),
    stopLoss:
      firstNumber(trade, ["stop_loss_abs", "stop_loss", "stoploss_current_dist"]) !== null
        ? available(firstNumber(trade, ["stop_loss_abs", "stop_loss", "stoploss_current_dist"]) as number, "status")
        : unavailable("status")
  }));

const mapRecentTrades = (payload: unknown): RecentTrade[] =>
  arrayFromPayload(payload, ["trades", "result"])
    .slice(0, 10)
    .map((trade) => ({
      entryTime:
        firstString(trade, ["open_date", "open_date_hum", "entry_date"]) !== null
          ? available(firstString(trade, ["open_date", "open_date_hum", "entry_date"]) as string, "trades")
          : unavailable("trades"),
      exitTime:
        firstString(trade, ["close_date", "close_date_hum", "exit_date"]) !== null
          ? available(firstString(trade, ["close_date", "close_date_hum", "exit_date"]) as string, "trades")
          : unavailable("trades"),
      entryPrice:
        firstNumber(trade, ["open_rate", "entry_rate", "entry_price"]) !== null
          ? available(firstNumber(trade, ["open_rate", "entry_rate", "entry_price"]) as number, "trades")
          : unavailable("trades"),
      exitPrice:
        firstNumber(trade, ["close_rate", "exit_rate", "exit_price"]) !== null
          ? available(firstNumber(trade, ["close_rate", "exit_rate", "exit_price"]) as number, "trades")
          : unavailable("trades"),
      netProfit:
        firstNumber(trade, ["close_profit_abs", "profit_abs", "profit_ratio"]) !== null
          ? available(firstNumber(trade, ["close_profit_abs", "profit_abs", "profit_ratio"]) as number, "trades")
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

export async function GET() {
  const generatedAt = new Date().toISOString();
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
    sysInfoResult,
    versionResult
  );

  const showConfig = pickShowConfig(showConfigResult.data);
  const profit = isObject(profitResult.data) ? profitResult.data : null;
  const balance = isObject(balanceResult.data) ? balanceResult.data : null;
  const count = isObject(countResult.data) ? countResult.data : null;
  const whitelist = isObject(whitelistResult.data) ? whitelistResult.data : null;
  const tradeList = mapRecentTrades(tradesResult.data);
  const openPositions = mapOpenPositions(statusResult.data);

  const pairsFromApi = Array.isArray(whitelist?.whitelist)
    ? whitelist.whitelist.filter((pair): pair is string => typeof pair === "string")
    : [];
  const pairList = showConfig?.pairlists;
  const configuredPair =
    pairsFromApi[0] ??
    (Array.isArray(showConfig?.exchange_pair_whitelist) &&
    typeof showConfig.exchange_pair_whitelist[0] === "string"
      ? showConfig.exchange_pair_whitelist[0]
      : Array.isArray(pairList) && typeof pairList[0] === "string"
        ? pairList[0]
        : null);

  const dryRun = firstBoolean(showConfig, ["dry_run"]);
  const runningState = firstString(showConfig, ["state", "runmode"]);
  const shortAllowed = firstBoolean(showConfig, ["short_allowed"]);
  const tradingMode = firstString(showConfig, ["trading_mode"]);

  const warnings = [
    {
      level: "warning" as const,
      message:
        "Historical performance is based on an incomplete preliminary Kraken dataset until the long download finishes."
    },
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
    ...results
      .filter((result) => !result.ok && result.status === 503)
      .map((result) => ({
        level: "info" as const,
        message: `${result.endpoint}: Bot stopped or trading engine unavailable`
      }))
  ];

  const api = endpointSummary(results);

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
          ? available(firstString(showConfig, ["strategy", "strategy_name"]) as string, "show_config")
          : unavailable("show_config"),
      accountValue:
        firstNumber(balance, ["total", "total_balance", "starting_capital"]) !== null
          ? available(firstNumber(balance, ["total", "total_balance", "starting_capital"]) as number, "balance")
          : unavailable("balance"),
      openPositionCount:
        firstNumber(count, ["current", "open_trade_count", "count"]) !== null
          ? available(firstNumber(count, ["current", "open_trade_count", "count"]) as number, "count")
          : statusResult.ok
            ? available(openPositions.length, "status")
            : unavailable("count"),
      totalClosedTrades:
        firstNumber(profit, ["closed_trade_count", "trade_count", "total_trades"]) !== null
          ? available(firstNumber(profit, ["closed_trade_count", "trade_count", "total_trades"]) as number, "profit")
          : unavailable("profit"),
      totalProfitLoss:
        firstNumber(profit, ["profit_closed_coin", "profit_all_coin", "profit_total_abs"]) !== null
          ? available(firstNumber(profit, ["profit_closed_coin", "profit_all_coin", "profit_total_abs"]) as number, "profit")
          : unavailable("profit")
    },
    openPositions,
    recentTrades: tradeList,
    performance: {
      totalNetProfitLoss:
        firstNumber(profit, ["profit_closed_coin", "profit_all_coin", "profit_total_abs"]) !== null
          ? available(firstNumber(profit, ["profit_closed_coin", "profit_all_coin", "profit_total_abs"]) as number, "profit")
          : unavailable("profit"),
      winRate:
        firstNumber(profit, ["winrate", "winning_percent"]) !== null
          ? available(firstNumber(profit, ["winrate", "winning_percent"]) as number, "profit")
          : unavailable("profit"),
      winningTrades:
        firstNumber(profit, ["winning_trades", "wins"]) !== null
          ? available(firstNumber(profit, ["winning_trades", "wins"]) as number, "profit")
          : unavailable("profit"),
      losingTrades:
        firstNumber(profit, ["losing_trades", "losses"]) !== null
          ? available(firstNumber(profit, ["losing_trades", "losses"]) as number, "profit")
          : unavailable("profit"),
      averageProfitPerTrade:
        firstNumber(profit, ["avg_profit", "profit_mean"]) !== null
          ? available(firstNumber(profit, ["avg_profit", "profit_mean"]) as number, "profit")
          : unavailable("profit"),
      bestTrade:
        firstNumber(profit, ["best_pair_profit_abs", "best_trade_profit_abs"]) !== null
          ? available(firstNumber(profit, ["best_pair_profit_abs", "best_trade_profit_abs"]) as number, "profit")
          : unavailable("profit"),
      worstTrade:
        firstNumber(profit, ["worst_pair_profit_abs", "worst_trade_profit_abs"]) !== null
          ? available(firstNumber(profit, ["worst_pair_profit_abs", "worst_trade_profit_abs"]) as number, "profit")
          : unavailable("profit"),
      profitFactor:
        firstNumber(profit, ["profit_factor"]) !== null
          ? available(firstNumber(profit, ["profit_factor"]) as number, "profit")
          : unavailable("profit"),
      maximumDrawdown:
        firstNumber(profit, ["max_drawdown", "max_drawdown_abs", "max_drawdown_account"]) !== null
          ? available(firstNumber(profit, ["max_drawdown", "max_drawdown_abs", "max_drawdown_account"]) as number, "profit")
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
    }
  };

  return NextResponse.json(summary, {
    headers: {
      "Cache-Control": "no-store"
    }
  });
}
