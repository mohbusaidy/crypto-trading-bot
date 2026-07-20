"use client";

import {
  AlertTriangle,
  CircleCheck,
  CircleX,
  RefreshCw,
  ShieldCheck
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  Availability,
  DashboardSummary,
  EventLogEntry,
  RecentTrade,
  OpenPosition
} from "@/app/lib/freqtrade-types";

const REFRESH_MS = 15_000;

const formatValue = <T,>(
  item: Availability<T>,
  formatter: (value: T) => string = String
) => (item.available && item.value !== null ? formatter(item.value) : "Not available");

const formatMoney = (value: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);

const formatNumber = (value: number) =>
  new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 6
  }).format(value);

const formatInteger = (value: number) =>
  new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0
  }).format(value);

const formatRsi = (value: number) =>
  new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);

const formatPercent = (value: number) => {
  const normalized = Math.abs(value) <= 1 ? value * 100 : value;
  return `${normalized.toFixed(2)}%`;
};

const timezoneLabel = (date: Date) => {
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absolute = Math.abs(offsetMinutes);
  const hours = Math.floor(absolute / 60);
  const minutes = absolute % 60;

  return minutes === 0
    ? `UTC${sign}${hours}`
    : `UTC${sign}${hours}:${String(minutes).padStart(2, "0")}`;
};

const formatDateTime = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  const formatted = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);

  return `${formatted} ${timezoneLabel(date)}`;
};

const valueTone = (item: Availability<number>) => {
  if (!item.available || item.value === null || item.value === 0) return "";
  return item.value > 0 ? "positive" : "negative";
};

const formatCondition = (item: Availability<boolean>) =>
  formatValue(item, (value) => (value ? "Met" : "Not met"));

const formatEntryCondition = (item: Availability<boolean>) =>
  formatValue(item, (value) =>
    value ? "Entry condition met" : "Entry condition not met"
  );

const formatExitCondition = (item: Availability<boolean>) =>
  formatValue(item, (value) =>
    value ? "Exit condition met" : "Exit condition not met"
  );

const formatEnabled = (item: Availability<boolean>) =>
  formatValue(item, (value) => (value ? "Enabled" : "Disabled"));

const formatStakeAmount = (value: number | string) =>
  typeof value === "number" ? formatMoney(value) : value;

const hasClosedTrades = (summary: DashboardSummary | null) =>
  (summary?.overview.totalClosedTrades.value ?? 0) > 0;

const decisionValue = (summary: DashboardSummary | null) =>
  summary ? formatValue(summary.strategyMonitor.currentDecision) : "Not available";

const exitActionValue = (summary: DashboardSummary | null) => {
  const monitor = summary?.strategyMonitor;
  if (!summary || !monitor || !monitor.exitSignal.available) return "Not available";

  const openPositionCount = summary.overview.openPositionCount.value ?? 0;
  if (monitor.exitSignal.value === true && openPositionCount === 0) {
    return "No position to exit";
  }

  if (monitor.exitSignal.value === true) return "Exit condition met";
  return "No exit condition";
};

function MetricCard({
  label,
  value,
  tone = ""
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div className="metric-card">
      <span>{label}</span>
      <strong className={tone}>{value}</strong>
    </div>
  );
}

function StrategyMonitorPanel({ summary }: { summary: DashboardSummary | null }) {
  const monitor = summary?.strategyMonitor;

  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <h2>Strategy Monitor</h2>
        </div>
        <span className="read-only-badge compact">READ-ONLY</span>
      </div>

      <div className="grid strategy-grid">
        <MetricCard label="Current decision" value={decisionValue(summary)} />
        <MetricCard
          label="Latest BTC/EUR price"
          value={monitor ? formatValue(monitor.latestPrice, formatMoney) : "Not available"}
        />
        <MetricCard
          label="Latest completed candle"
          value={
            monitor
              ? formatValue(monitor.latestCompletedCandleTimestamp, formatDateTime)
              : "Not available"
          }
        />
        <MetricCard
          label="Candle data freshness"
          value={monitor ? formatValue(monitor.candleDataFreshness) : "Not available"}
        />
        <MetricCard
          label="EMA 50"
          value={monitor ? formatValue(monitor.ema50, formatMoney) : "Not available"}
        />
        <MetricCard
          label="EMA 200"
          value={monitor ? formatValue(monitor.ema200, formatMoney) : "Not available"}
        />
        <MetricCard
          label="RSI"
          value={monitor ? formatValue(monitor.rsi, formatRsi) : "Not available"}
        />
        <MetricCard
          label="Current 1h candle closes in"
          value={
            monitor
              ? formatValue(monitor.timeUntilCurrentCandleClose)
              : "Not available"
          }
        />
        <MetricCard
          label="Trend condition"
          value={monitor ? formatCondition(monitor.trendCondition) : "Not available"}
        />
        <MetricCard
          label="RSI pullback condition"
          value={monitor ? formatCondition(monitor.pullbackCondition) : "Not available"}
        />
        <MetricCard
          label="RSI recovery condition"
          value={monitor ? formatCondition(monitor.recoveryCondition) : "Not available"}
        />
        <MetricCard
          label="Entry condition"
          value={monitor ? formatEntryCondition(monitor.entrySignal) : "Not available"}
        />
        <MetricCard
          label="Exit condition"
          value={monitor ? formatExitCondition(monitor.exitSignal) : "Not available"}
        />
        <MetricCard
          label="Exit action"
          value={exitActionValue(summary)}
        />
      </div>

      <div className="reason-box">
        <span>Human-readable reason</span>
        <strong>{monitor ? formatValue(monitor.reason) : "Not available"}</strong>
      </div>
    </section>
  );
}

function RiskProtectionsPanel({ summary }: { summary: DashboardSummary | null }) {
  const risk = summary?.riskProtections;

  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <h2>Risk & Protections</h2>
        </div>
        <span className="paper-badge inline">PRELIMINARY PAPER-TRADING</span>
      </div>

      <div className="grid risk-grid">
        <MetricCard
          label="Dry-run wallet balance"
          value={risk ? formatValue(risk.dryRunWallet, formatMoney) : "Not available"}
        />
        <MetricCard
          label="Stake amount"
          value={risk ? formatValue(risk.stakeAmount, formatStakeAmount) : "Not available"}
        />
        <MetricCard
          label="Maximum open trades"
          value={risk ? formatValue(risk.maxOpenTrades, formatInteger) : "Not available"}
        />
        <MetricCard
          label="Strategy stop-loss"
          value={risk ? formatValue(risk.stoploss, formatPercent) : "Not available"}
        />
        <MetricCard
          label="Minimal ROI"
          value={risk ? formatValue(risk.minimalRoi) : "Not available"}
        />
        <MetricCard
          label="Trailing-stop"
          value={risk ? formatEnabled(risk.trailingStop) : "Not available"}
        />
        <MetricCard
          label="Order types"
          value={risk ? formatValue(risk.orderTypes) : "Not available"}
        />
      </div>

      <div className="table-wrap">
        <table className="protection-table">
          <thead>
            <tr>
              <th>Protection</th>
              <th>Status</th>
              <th>Settings</th>
            </tr>
          </thead>
          <tbody>
            {(risk?.protections ?? []).map((protection) => (
              <tr key={protection.method}>
                <td>{protection.method}</td>
                <td>
                  {protection.status === "configured"
                    ? "Configured, preliminary"
                    : protection.status === "not_configured"
                      ? "Not configured"
                      : "Not available"}
                </td>
                <td>{protection.details.join("; ") || "Not available"}</td>
              </tr>
            ))}
            {!risk ? (
              <EmptyRow columns={3} message="Risk and protection data is not available." />
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function StatusPill({
  ok,
  label
}: {
  ok: boolean;
  label: string;
}) {
  return (
    <span className={`status-pill ${ok ? "ok" : "bad"}`}>
      {ok ? <CircleCheck size={16} /> : <CircleX size={16} />}
      {label}
    </span>
  );
}

function EventLogTable({ events }: { events: EventLogEntry[] }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Timestamp</th>
            <th>Event type</th>
            <th>Pair</th>
            <th>Bot state</th>
            <th>Decision</th>
            <th>Reason</th>
            <th>Details</th>
          </tr>
        </thead>
        <tbody>
          {events.length === 0 ? (
            <EmptyRow columns={7} message="No read-only events available." />
          ) : (
            events.map((event, index) => (
              <tr key={`${event.timestamp}-${event.eventType}-${index}`}>
                <td>{formatDateTime(event.timestamp)}</td>
                <td>{event.eventType}</td>
                <td>{event.pair}</td>
                <td>{event.botState}</td>
                <td>{event.signalDecision}</td>
                <td>{event.signalReason}</td>
                <td>{event.details}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function EmptyRow({ columns, message }: { columns: number; message: string }) {
  return (
    <tr>
      <td colSpan={columns} className="empty-cell">
        {message}
      </td>
    </tr>
  );
}

function OpenPositionsTable({
  positions,
  unavailable
}: {
  positions: OpenPosition[];
  unavailable: boolean;
}) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Pair</th>
            <th>Entry price</th>
            <th>Current price</th>
            <th>Size</th>
            <th>Unrealized P/L</th>
            <th>Entry time</th>
            <th>Stop-loss</th>
          </tr>
        </thead>
        <tbody>
          {positions.length === 0 ? (
            <EmptyRow
              columns={7}
              message={
                unavailable
                  ? "Open position data is not available."
                  : "No open positions reported."
              }
            />
          ) : (
            positions.map((position, index) => (
              <tr key={`${formatValue(position.pair)}-${index}`}>
                <td>{formatValue(position.pair)}</td>
                <td>{formatValue(position.entryPrice, formatMoney)}</td>
                <td>{formatValue(position.currentPrice, formatMoney)}</td>
                <td>{formatValue(position.positionSize, formatNumber)}</td>
                <td className={valueTone(position.unrealizedProfit)}>
                  {formatValue(position.unrealizedProfit, formatMoney)}
                </td>
                <td>{formatValue(position.entryTime, formatDateTime)}</td>
                <td>{formatValue(position.stopLoss, formatMoney)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function RecentTradesTable({
  trades,
  unavailable
}: {
  trades: RecentTrade[];
  unavailable: boolean;
}) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Entry time</th>
            <th>Exit time</th>
            <th>Entry price</th>
            <th>Exit price</th>
            <th>Net P/L</th>
            <th>Exit reason</th>
            <th>Duration</th>
          </tr>
        </thead>
        <tbody>
          {trades.length === 0 ? (
            <EmptyRow
              columns={7}
              message={
                unavailable
                  ? "Recent trade data is not available."
                  : "No recent trades available."
              }
            />
          ) : (
            trades.map((trade, index) => (
              <tr key={`${formatValue(trade.entryTime)}-${index}`}>
                <td>{formatValue(trade.entryTime, formatDateTime)}</td>
                <td>{formatValue(trade.exitTime, formatDateTime)}</td>
                <td>{formatValue(trade.entryPrice, formatMoney)}</td>
                <td>{formatValue(trade.exitPrice, formatMoney)}</td>
                <td className={valueTone(trade.netProfit)}>
                  {formatValue(trade.netProfit, formatMoney)}
                </td>
                <td>{formatValue(trade.exitReason)}</td>
                <td>{formatValue(trade.duration)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

export default function Home() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [manualLoading, setManualLoading] = useState(false);

  const loadSummary = useCallback(async (manual = false) => {
    if (manual) setManualLoading(true);

    try {
      const response = await fetch("/api/freqtrade/summary", {
        cache: "no-store"
      });

      if (!response.ok) {
        throw new Error(`Dashboard API returned ${response.status}`);
      }

      const payload = (await response.json()) as DashboardSummary;
      setSummary(payload);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to refresh dashboard");
    } finally {
      setLoading(false);
      setManualLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSummary();
    const timer = window.setInterval(() => void loadSummary(), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [loadSummary]);

  const dryRunLabel = useMemo(() => {
    if (!summary) return "Checking paper-trading mode";
    return summary.systemHealth.dryRunConfirmed
      ? "Paper trading confirmed"
      : "Paper trading not confirmed";
  }, [summary]);

  const statusEndpointOk =
    summary?.api.endpoints.find((endpoint) => endpoint.endpoint === "/api/v1/status")
      ?.ok ?? false;
  const tradesEndpointOk =
    summary?.api.endpoints.find((endpoint) => endpoint.endpoint === "/api/v1/trades")
      ?.ok ?? false;
  const closedTradeHistoryAvailable = hasClosedTrades(summary);

  return (
    <main className="dashboard-shell">
      <header className="topbar">
        <div>
          <div className="eyebrow">Local control center</div>
          <h1>Crypto Trading Bot</h1>
        </div>
        <div className="top-actions">
          <span className="read-only-badge">
            <ShieldCheck size={16} />
            READ-ONLY
          </span>
          <button
            className="refresh-button"
            type="button"
            onClick={() => void loadSummary(true)}
            disabled={manualLoading}
          >
            <RefreshCw size={16} />
            {manualLoading ? "Refreshing" : "Refresh"}
          </button>
        </div>
      </header>

      <section className="status-row">
        <StatusPill ok={summary?.api.reachable ?? false} label="Freqtrade API" />
        <StatusPill ok={summary?.api.authenticated ?? false} label="Server-side auth" />
        <StatusPill ok={summary?.systemHealth.dryRunConfirmed ?? false} label={dryRunLabel} />
      </section>

      {loading ? <div className="notice">Loading current bot state...</div> : null}
      {error ? <div className="notice error">{error}</div> : null}

      <section className="panel hero-panel">
        <div>
          <span className="paper-badge">DRY-RUN / PAPER TRADING</span>
          <h2>Overview</h2>
        </div>
        <div className="grid metrics-grid">
          <MetricCard
            label="Bot status"
            value={summary ? formatValue(summary.overview.botStatus) : "Not available"}
          />
          <MetricCard
            label="Exchange"
            value={summary ? formatValue(summary.overview.exchange) : "Not available"}
          />
          <MetricCard
            label="Trading pair"
            value={summary ? formatValue(summary.overview.tradingPair) : "Not available"}
          />
          <MetricCard
            label="Strategy"
            value={summary ? formatValue(summary.overview.strategyName) : "Not available"}
          />
          <MetricCard
            label="Account value"
            value={summary ? formatValue(summary.overview.accountValue, formatMoney) : "Not available"}
          />
          <MetricCard
            label="Open positions"
            value={
              summary
                ? formatValue(summary.overview.openPositionCount, formatInteger)
                : "Not available"
            }
          />
          <MetricCard
            label="Closed trades"
            value={
              summary
                ? formatValue(summary.overview.totalClosedTrades, formatInteger)
                : "Not available"
            }
          />
          <MetricCard
            label="Total P/L"
            value={
              summary
                ? formatValue(summary.overview.totalProfitLoss, formatMoney)
                : "Not available"
            }
            tone={summary ? valueTone(summary.overview.totalProfitLoss) : ""}
          />
          <MetricCard
            label="API connection"
            value={summary?.api.connectionStatus ?? "Not available"}
          />
          <MetricCard
            label="Last refresh"
            value={
              summary?.api.lastSuccessfulRefreshTime
                ? formatDateTime(summary.api.lastSuccessfulRefreshTime)
                : "Not available"
            }
          />
        </div>
      </section>

      <StrategyMonitorPanel summary={summary} />

      <RiskProtectionsPanel summary={summary} />

      <section className="panel">
        <h2>Open Positions</h2>
        <OpenPositionsTable
          positions={summary?.openPositions ?? []}
          unavailable={!statusEndpointOk}
        />
      </section>

      <section className="panel">
        <h2>Recent Trades</h2>
        <RecentTradesTable
          trades={summary?.recentTrades ?? []}
          unavailable={!tradesEndpointOk}
        />
      </section>

      <section className="panel">
        <h2>Performance</h2>
        <div className="grid metrics-grid">
          <MetricCard
            label="Total net P/L"
            value={
              summary
                ? formatValue(summary.performance.totalNetProfitLoss, formatMoney)
                : "Not available"
            }
            tone={summary ? valueTone(summary.performance.totalNetProfitLoss) : ""}
          />
          <MetricCard
            label="Win rate"
            value={
              summary
                ? closedTradeHistoryAvailable
                  ? formatValue(summary.performance.winRate, formatPercent)
                  : "No trades yet"
                : "Not available"
            }
          />
          <MetricCard
            label="Winning trades"
            value={
              summary
                ? formatValue(summary.performance.winningTrades, formatInteger)
                : "Not available"
            }
          />
          <MetricCard
            label="Losing trades"
            value={
              summary
                ? formatValue(summary.performance.losingTrades, formatInteger)
                : "Not available"
            }
          />
          <MetricCard
            label="Average profit"
            value={
              summary
                ? closedTradeHistoryAvailable
                  ? formatValue(summary.performance.averageProfitPerTrade, formatMoney)
                  : "Not available"
                : "Not available"
            }
            tone={summary ? valueTone(summary.performance.averageProfitPerTrade) : ""}
          />
          <MetricCard
            label="Best trade"
            value={
              summary && closedTradeHistoryAvailable
                ? formatValue(summary.performance.bestTrade, formatMoney)
                : "Not available"
            }
            tone={summary ? valueTone(summary.performance.bestTrade) : ""}
          />
          <MetricCard
            label="Worst trade"
            value={
              summary && closedTradeHistoryAvailable
                ? formatValue(summary.performance.worstTrade, formatMoney)
                : "Not available"
            }
            tone={summary ? valueTone(summary.performance.worstTrade) : ""}
          />
          <MetricCard
            label="Profit factor"
            value={
              summary
                ? closedTradeHistoryAvailable
                  ? formatValue(summary.performance.profitFactor, formatNumber)
                  : "Not available"
                : "Not available"
            }
          />
          <MetricCard
            label="Maximum drawdown"
            value={
              summary
                ? closedTradeHistoryAvailable
                  ? formatValue(summary.performance.maximumDrawdown, formatMoney)
                  : "Not available"
                : "Not available"
            }
            tone={summary ? valueTone(summary.performance.maximumDrawdown) : ""}
          />
          <MetricCard
            label="Total fees"
            value={summary ? formatValue(summary.performance.totalFees, formatMoney) : "Not available"}
          />
        </div>
      </section>

      <section className="panel">
        <h2>System Health</h2>
        <div className="health-grid">
          <MetricCard
            label="API reachable"
            value={summary?.systemHealth.apiReachable ? "Reachable" : "Unreachable"}
          />
          <MetricCard
            label="Authentication status"
            value={summary?.api.authenticated ? "Authenticated" : "Not authenticated"}
          />
          <MetricCard
            label="Bot running state"
            value={summary ? formatValue(summary.systemHealth.botRunningState) : "Not available"}
          />
          <MetricCard
            label="Dry-run confirmation"
            value={summary?.systemHealth.dryRunConfirmed ? "Confirmed" : "Not confirmed"}
          />
          <MetricCard
            label="Last successful response"
            value={summary?.api.lastApiResponse ?? "Not available"}
          />
          <MetricCard
            label="Last refresh"
            value={
              summary?.api.lastSuccessfulRefreshTime
                ? formatDateTime(summary.api.lastSuccessfulRefreshTime)
                : "Not available"
            }
          />
          <MetricCard
            label="Candle freshness"
            value={
              summary
                ? formatValue(summary.strategyMonitor.candleDataFreshness)
                : "Not available"
            }
          />
          <MetricCard
            label="Active warnings"
            value={formatInteger(summary?.systemHealth.warnings.length ?? 0)}
          />
        </div>

        <div className="warnings">
          {(summary?.systemHealth.warnings ?? []).map((warning, index) => (
            <div className={`warning ${warning.level}`} key={`${warning.message}-${index}`}>
              <AlertTriangle size={16} />
              {warning.message}
            </div>
          ))}
        </div>

        <details className="diagnostics">
          <summary>Developer Diagnostics</summary>
          <div className="diagnostic-meta">
            <span>API base: {summary?.api.baseUrl ?? "Not available"}</span>
            <span>
              Raw refresh timestamp: {summary?.generatedAt ?? "Not available"}
            </span>
          </div>
          <div className="endpoint-list">
            {(summary?.api.endpoints ?? []).map((endpoint) => (
              <div className="endpoint-row" key={endpoint.endpoint}>
                <span>{endpoint.endpoint}</span>
                <strong className={endpoint.ok ? "positive" : ""}>
                  {endpoint.status} {endpoint.message}
                </strong>
              </div>
            ))}
          </div>
        </details>
      </section>

      <section className="panel">
        <h2>Read-Only Event Log</h2>
        <EventLogTable events={summary?.eventLog ?? []} />
      </section>
    </main>
  );
}
