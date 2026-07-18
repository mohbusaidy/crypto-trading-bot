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
    maximumFractionDigits: 2
  }).format(value);

const formatNumber = (value: number) =>
  new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 6
  }).format(value);

const formatPercent = (value: number) => {
  const normalized = Math.abs(value) <= 1 ? value * 100 : value;
  return `${normalized.toFixed(2)}%`;
};

const valueTone = (item: Availability<number>) => {
  if (!item.available || item.value === null || item.value === 0) return "";
  return item.value > 0 ? "positive" : "negative";
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
                <td>{formatValue(position.entryTime)}</td>
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
                <td>{formatValue(trade.entryTime)}</td>
                <td>{formatValue(trade.exitTime)}</td>
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
                ? formatValue(summary.overview.openPositionCount, formatNumber)
                : "Not available"
            }
          />
          <MetricCard
            label="Closed trades"
            value={
              summary
                ? formatValue(summary.overview.totalClosedTrades, formatNumber)
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
            value={summary?.api.lastSuccessfulRefreshTime ?? "Not available"}
          />
        </div>
      </section>

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
            value={summary ? formatValue(summary.performance.winRate, formatPercent) : "Not available"}
          />
          <MetricCard
            label="Winning trades"
            value={
              summary
                ? formatValue(summary.performance.winningTrades, formatNumber)
                : "Not available"
            }
          />
          <MetricCard
            label="Losing trades"
            value={
              summary
                ? formatValue(summary.performance.losingTrades, formatNumber)
                : "Not available"
            }
          />
          <MetricCard
            label="Average profit"
            value={
              summary
                ? formatValue(summary.performance.averageProfitPerTrade, formatMoney)
                : "Not available"
            }
            tone={summary ? valueTone(summary.performance.averageProfitPerTrade) : ""}
          />
          <MetricCard
            label="Best trade"
            value={summary ? formatValue(summary.performance.bestTrade, formatMoney) : "Not available"}
            tone={summary ? valueTone(summary.performance.bestTrade) : ""}
          />
          <MetricCard
            label="Worst trade"
            value={summary ? formatValue(summary.performance.worstTrade, formatMoney) : "Not available"}
            tone={summary ? valueTone(summary.performance.worstTrade) : ""}
          />
          <MetricCard
            label="Profit factor"
            value={
              summary
                ? formatValue(summary.performance.profitFactor, formatNumber)
                : "Not available"
            }
          />
          <MetricCard
            label="Maximum drawdown"
            value={
              summary
                ? formatValue(summary.performance.maximumDrawdown, formatMoney)
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
            label="Last API response"
            value={summary?.api.lastApiResponse ?? "Not available"}
          />
          <MetricCard
            label="Bot running state"
            value={summary ? formatValue(summary.systemHealth.botRunningState) : "Not available"}
          />
          <MetricCard
            label="Dry-run confirmation"
            value={summary?.systemHealth.dryRunConfirmed ? "Confirmed" : "Not confirmed"}
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
      </section>
    </main>
  );
}
