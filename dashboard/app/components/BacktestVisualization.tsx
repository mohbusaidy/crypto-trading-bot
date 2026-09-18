"use client";

import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

type StrategyName = "BtcBaselineStrategy" | "BtcStrategyV2";

type Candle = {
  time: string;
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  ema50: number | null;
  ema200: number | null;
  rsi: number | null;
};

type Trade = {
  id: number;
  pair: string;
  entryTime: string;
  entryTimestamp: number;
  exitTime: string;
  exitTimestamp: number;
  entryPrice: number;
  exitPrice: number;
  amount: number;
  stakeAmount: number;
  entryTag: string;
  exitReason: string;
  durationLabel: string;
  grossProfit: number;
  grossReturnPct: number;
  fees: number;
  netProfit: number;
  netReturnPct: number;
  isWin: boolean;
  entryIndicators: {
    ema50: number | null;
    ema200: number | null;
    rsi: number | null;
  };
};

type EquityPoint = {
  time: string;
  timestamp: number;
  balance: number;
};

type VisualizationPayload = {
  strategy: StrategyName;
  availableStrategies: StrategyName[];
  dataset: {
    key: string;
    label: string;
    pair: string;
    start: string;
    end: string;
  };
  source: {
    candles: string;
    backtestResult: string;
    note: string;
  };
  backtest: {
    rangeStart: string;
    rangeEnd: string;
    startingBalance: number | null;
    finalBalance: number | null;
    tradeCount: number | null;
    netProfit: number | null;
    netReturnPct: number;
    profitFactor: number | null;
    maxDrawdown: number | null;
    maxDrawdownPct: number;
  };
  candles: Candle[];
  trades: Trade[];
  equity: {
    points: EquityPoint[];
    drawdownMarker: {
      time: string;
      timestamp: number;
      balance: number;
      amount: number | null;
      percent: number;
    } | null;
  };
  generatedAt: string;
};

type TooltipState = {
  x: number;
  y: number;
  title: string;
  rows: Array<[string, string]>;
} | null;

type RangeKey = "full" | "backtest" | "2021" | "2022" | "2023";

const WIDTH = 1100;
const PRICE_HEIGHT = 430;
const EQUITY_HEIGHT = 230;
const PRICE_MARGIN = { top: 20, right: 72, bottom: 44, left: 72 };
const EQUITY_MARGIN = { top: 20, right: 72, bottom: 42, left: 72 };

const formatMoney = (value: number | null | undefined, digits = 2) =>
  typeof value === "number" && Number.isFinite(value)
    ? new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "EUR",
        minimumFractionDigits: digits,
        maximumFractionDigits: digits
      }).format(value)
    : "Not available";

const formatNumber = (value: number | null | undefined, digits = 2) =>
  typeof value === "number" && Number.isFinite(value)
    ? new Intl.NumberFormat("en-US", {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits
      }).format(value)
    : "Not available";

const formatPercent = (value: number | null | undefined) =>
  typeof value === "number" && Number.isFinite(value)
    ? `${value.toFixed(2)}%`
    : "Not available";

const formatDate = (value: string | number) => {
  const date = typeof value === "number" ? new Date(value * 1000) : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);

  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC"
  }).format(date);
};

const rangeOptions: Array<{ value: RangeKey; label: string }> = [
  { value: "full", label: "Full Dataset A" },
  { value: "backtest", label: "Backtest window" },
  { value: "2021", label: "2021" },
  { value: "2022", label: "2022" },
  { value: "2023", label: "2023" }
];

const rangeBounds = (payload: VisualizationPayload, range: RangeKey) => {
  if (range === "backtest") {
    return [
      Math.floor(new Date(payload.backtest.rangeStart).getTime() / 1000),
      Math.floor(new Date(payload.backtest.rangeEnd).getTime() / 1000)
    ] as const;
  }

  if (range === "full") {
    return [
      Math.floor(new Date(payload.dataset.start).getTime() / 1000),
      Math.floor(new Date(payload.dataset.end).getTime() / 1000)
    ] as const;
  }

  const year = Number(range);
  return [
    Math.floor(Date.UTC(year, 0, 1, 0, 0, 0) / 1000),
    Math.floor(Date.UTC(year, 11, 31, 23, 59, 59) / 1000)
  ] as const;
};

const scaleFactory = (
  domainMin: number,
  domainMax: number,
  rangeMin: number,
  rangeMax: number
) => {
  const domain = domainMax - domainMin || 1;
  return (value: number) =>
    rangeMin + ((value - domainMin) / domain) * (rangeMax - rangeMin);
};

const linePath = <T,>(
  points: T[],
  xValue: (point: T) => number,
  yValue: (point: T) => number | null,
  xScale: (value: number) => number,
  yScale: (value: number) => number
) => {
  let path = "";
  let open = false;

  for (const point of points) {
    const yRaw = yValue(point);
    if (yRaw === null || !Number.isFinite(yRaw)) {
      open = false;
      continue;
    }

    const command = open ? "L" : "M";
    path += `${command}${xScale(xValue(point)).toFixed(2)},${yScale(yRaw).toFixed(2)} `;
    open = true;
  }

  return path.trim();
};

const stepPath = (
  points: EquityPoint[],
  xScale: (value: number) => number,
  yScale: (value: number) => number
) => {
  if (points.length === 0) return "";

  let path = `M${xScale(points[0].timestamp).toFixed(2)},${yScale(points[0].balance).toFixed(2)} `;

  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    path += `H${xScale(current.timestamp).toFixed(2)} `;
    path += `V${yScale(current.balance).toFixed(2)} `;
    if (previous.timestamp === current.timestamp) {
      path += `L${xScale(current.timestamp).toFixed(2)},${yScale(current.balance).toFixed(2)} `;
    }
  }

  return path.trim();
};

const tickValues = (min: number, max: number, count: number) => {
  if (count <= 1) return [min];
  return Array.from({ length: count }, (_, index) => min + ((max - min) * index) / (count - 1));
};

function Tooltip({ tooltip }: { tooltip: TooltipState }) {
  if (!tooltip) return null;

  return (
    <div
      className="chart-tooltip"
      style={{
        left: `${Math.min(tooltip.x + 14, WIDTH - 310)}px`,
        top: `${Math.max(tooltip.y - 24, 10)}px`
      }}
    >
      <strong>{tooltip.title}</strong>
      {tooltip.rows.map(([label, value]) => (
        <div key={label}>
          <span>{label}</span>
          <b>{value}</b>
        </div>
      ))}
    </div>
  );
}

function BacktestMetric({
  label,
  value,
  tone = ""
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div className="metric-card compact-card">
      <span>{label}</span>
      <strong className={tone}>{value}</strong>
    </div>
  );
}

export function BacktestVisualization() {
  const [strategy, setStrategy] = useState<StrategyName>("BtcStrategyV2");
  const [range, setRange] = useState<RangeKey>("full");
  const [showEma50, setShowEma50] = useState(true);
  const [showEma200, setShowEma200] = useState(true);
  const [showTrades, setShowTrades] = useState(true);
  const [payload, setPayload] = useState<VisualizationPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<TooltipState>(null);

  const loadVisualization = useCallback(async () => {
    setLoading(true);

    try {
      const response = await fetch(`/api/backtest-visualization?strategy=${strategy}`, {
        cache: "no-store"
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `Visualization API returned ${response.status}`);
      }

      setPayload((await response.json()) as VisualizationPayload);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load visualization data");
    } finally {
      setLoading(false);
    }
  }, [strategy]);

  useEffect(() => {
    void loadVisualization();
  }, [loadVisualization]);

  const visible = useMemo(() => {
    if (!payload) {
      return {
        candles: [] as Candle[],
        trades: [] as Trade[],
        equity: [] as EquityPoint[],
        bounds: [0, 1] as const
      };
    }

    const bounds = rangeBounds(payload, range);
    const candles = payload.candles.filter(
      (candle) => candle.timestamp >= bounds[0] && candle.timestamp <= bounds[1]
    );
    const trades = payload.trades.filter(
      (trade) => trade.exitTimestamp >= bounds[0] && trade.entryTimestamp <= bounds[1]
    );
    const equity = payload.equity.points.filter(
      (point) => point.timestamp >= bounds[0] && point.timestamp <= bounds[1]
    );

    if (equity.length === 0 && payload.equity.points.length > 0) {
      const prior = [...payload.equity.points]
        .reverse()
        .find((point) => point.timestamp <= bounds[0]);
      if (prior) equity.push({ ...prior, timestamp: bounds[0], time: new Date(bounds[0] * 1000).toISOString() });
    }

    return { candles, trades, equity, bounds };
  }, [payload, range]);

  const priceChart = useMemo(() => {
    const candles = visible.candles;
    const plotLeft = PRICE_MARGIN.left;
    const plotRight = WIDTH - PRICE_MARGIN.right;
    const plotTop = PRICE_MARGIN.top;
    const plotBottom = PRICE_HEIGHT - PRICE_MARGIN.bottom;

    if (candles.length === 0) return null;

    const priceValues = candles.flatMap((candle) => [
      candle.close,
      showEma50 && candle.ema50 !== null ? candle.ema50 : candle.close,
      showEma200 && candle.ema200 !== null ? candle.ema200 : candle.close
    ]);
    for (const trade of visible.trades) {
      priceValues.push(trade.entryPrice, trade.exitPrice);
    }

    const minPrice = Math.min(...priceValues);
    const maxPrice = Math.max(...priceValues);
    const padding = Math.max((maxPrice - minPrice) * 0.08, 1);
    const yMin = minPrice - padding;
    const yMax = maxPrice + padding;
    const xMin = candles[0].timestamp;
    const xMax = candles[candles.length - 1].timestamp;
    const xScale = scaleFactory(xMin, xMax, plotLeft, plotRight);
    const yScale = scaleFactory(yMin, yMax, plotBottom, plotTop);
    const closePath = linePath(candles, (candle) => candle.timestamp, (candle) => candle.close, xScale, yScale);
    const ema50Path = linePath(candles, (candle) => candle.timestamp, (candle) => candle.ema50, xScale, yScale);
    const ema200Path = linePath(candles, (candle) => candle.timestamp, (candle) => candle.ema200, xScale, yScale);

    return {
      xScale,
      yScale,
      xTicks: tickValues(xMin, xMax, 5),
      yTicks: tickValues(yMin, yMax, 5),
      closePath,
      ema50Path,
      ema200Path,
      plotLeft,
      plotRight,
      plotTop,
      plotBottom
    };
  }, [showEma50, showEma200, visible.candles, visible.trades]);

  const equityChart = useMemo(() => {
    if (!payload || visible.equity.length === 0) return null;

    const plotLeft = EQUITY_MARGIN.left;
    const plotRight = WIDTH - EQUITY_MARGIN.right;
    const plotTop = EQUITY_MARGIN.top;
    const plotBottom = EQUITY_HEIGHT - EQUITY_MARGIN.bottom;
    const xMin = visible.bounds[0];
    const xMax = visible.bounds[1];
    const balances = visible.equity.map((point) => point.balance);
    if (payload.equity.drawdownMarker) balances.push(payload.equity.drawdownMarker.balance);
    const minBalance = Math.min(...balances);
    const maxBalance = Math.max(...balances);
    const padding = Math.max((maxBalance - minBalance) * 0.14, 1);
    const yMin = minBalance - padding;
    const yMax = maxBalance + padding;
    const xScale = scaleFactory(xMin, xMax, plotLeft, plotRight);
    const yScale = scaleFactory(yMin, yMax, plotBottom, plotTop);

    return {
      xScale,
      yScale,
      xTicks: tickValues(xMin, xMax, 5),
      yTicks: tickValues(yMin, yMax, 4),
      path: stepPath(visible.equity, xScale, yScale),
      plotLeft,
      plotRight,
      plotTop,
      plotBottom
    };
  }, [payload, visible.bounds, visible.equity]);

  return (
    <section className="panel backtest-panel">
      <div className="section-heading">
        <div>
          <h2>Backtest Visualization</h2>
          <p>Historical backtest — simulated results</p>
        </div>
        <span className="read-only-badge compact">READ-ONLY</span>
      </div>

      <div className="visualization-controls">
        <label>
          Strategy
          <select
            value={strategy}
            onChange={(event) => setStrategy(event.target.value as StrategyName)}
          >
            <option value="BtcStrategyV2">BtcStrategyV2</option>
            <option value="BtcBaselineStrategy">BtcBaselineStrategy</option>
          </select>
        </label>
        <label>
          Time range
          <select value={range} onChange={(event) => setRange(event.target.value as RangeKey)}>
            {rangeOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="toggle-control">
          <input
            type="checkbox"
            checked={showEma50}
            onChange={(event) => setShowEma50(event.target.checked)}
          />
          EMA50
        </label>
        <label className="toggle-control">
          <input
            type="checkbox"
            checked={showEma200}
            onChange={(event) => setShowEma200(event.target.checked)}
          />
          EMA200
        </label>
        <label className="toggle-control">
          <input
            type="checkbox"
            checked={showTrades}
            onChange={(event) => setShowTrades(event.target.checked)}
          />
          Trade markers
        </label>
        <button className="refresh-button compact-button" type="button" onClick={() => void loadVisualization()}>
          <RefreshCw size={14} />
          Reload
        </button>
      </div>

      {loading ? <div className="notice">Loading historical backtest visualization...</div> : null}
      {error ? <div className="notice error">{error}</div> : null}

      {payload ? (
        <>
          <div className="grid metrics-grid backtest-summary-grid">
            <BacktestMetric label="Strategy" value={payload.strategy} />
            <BacktestMetric label="Dataset" value={`${payload.dataset.label} BTC/EUR`} />
            <BacktestMetric
              label="Backtest range"
              value={`${formatDate(payload.backtest.rangeStart)} to ${formatDate(payload.backtest.rangeEnd)}`}
            />
            <BacktestMetric label="Trades" value={formatNumber(payload.backtest.tradeCount, 0)} />
            <BacktestMetric
              label="Net return"
              value={formatPercent(payload.backtest.netReturnPct)}
              tone={payload.backtest.netReturnPct >= 0 ? "positive" : "negative"}
            />
            <BacktestMetric label="Profit factor" value={formatNumber(payload.backtest.profitFactor, 2)} />
            <BacktestMetric
              label="Maximum drawdown"
              value={`${formatMoney(payload.backtest.maxDrawdown)} / ${formatPercent(payload.backtest.maxDrawdownPct)}`}
              tone="negative"
            />
          </div>

          <div className="chart-card">
            <div className="chart-card-heading">
              <div>
                <h3>BTC/EUR Trade Chart</h3>
                <p>Close-price line with EMA overlays and paired entry/exit markers.</p>
              </div>
              <div className="chart-legend">
                <span><i className="legend-line close-line" /> Close</span>
                {showEma50 ? <span><i className="legend-line ema50-line" /> EMA50</span> : null}
                {showEma200 ? <span><i className="legend-line ema200-line" /> EMA200</span> : null}
                {showTrades ? <span><i className="legend-marker entry-marker" /> Entry</span> : null}
                {showTrades ? <span><i className="legend-marker exit-marker" /> Exit</span> : null}
              </div>
            </div>

            <div className="chart-shell" onMouseLeave={() => setTooltip(null)}>
              {priceChart ? (
                <svg viewBox={`0 0 ${WIDTH} ${PRICE_HEIGHT}`} role="img" aria-label="BTC/EUR backtest trade chart">
                  <rect
                    x={priceChart.plotLeft}
                    y={priceChart.plotTop}
                    width={priceChart.plotRight - priceChart.plotLeft}
                    height={priceChart.plotBottom - priceChart.plotTop}
                    className="chart-plot"
                  />
                  {priceChart.yTicks.map((tick) => (
                    <g key={`price-y-${tick}`}>
                      <line
                        x1={priceChart.plotLeft}
                        x2={priceChart.plotRight}
                        y1={priceChart.yScale(tick)}
                        y2={priceChart.yScale(tick)}
                        className="chart-grid-line"
                      />
                      <text x={priceChart.plotLeft - 12} y={priceChart.yScale(tick) + 4} className="chart-axis-label" textAnchor="end">
                        {formatMoney(tick, 0)}
                      </text>
                    </g>
                  ))}
                  {priceChart.xTicks.map((tick) => (
                    <g key={`price-x-${tick}`}>
                      <line
                        x1={priceChart.xScale(tick)}
                        x2={priceChart.xScale(tick)}
                        y1={priceChart.plotTop}
                        y2={priceChart.plotBottom}
                        className="chart-grid-line subtle"
                      />
                      <text x={priceChart.xScale(tick)} y={PRICE_HEIGHT - 14} className="chart-axis-label" textAnchor="middle">
                        {formatDate(tick)}
                      </text>
                    </g>
                  ))}
                  <path d={priceChart.closePath} className="price-line" />
                  {showEma50 ? <path d={priceChart.ema50Path} className="ema50-path" /> : null}
                  {showEma200 ? <path d={priceChart.ema200Path} className="ema200-path" /> : null}

                  {showTrades
                    ? visible.trades.map((trade) => {
                        const entryX = priceChart.xScale(trade.entryTimestamp);
                        const entryY = priceChart.yScale(trade.entryPrice);
                        const exitX = priceChart.xScale(trade.exitTimestamp);
                        const exitY = priceChart.yScale(trade.exitPrice);
                        const connectorClass = trade.isWin ? "trade-connector win" : "trade-connector loss";

                        return (
                          <g key={trade.id}>
                            <line
                              x1={entryX}
                              y1={entryY}
                              x2={exitX}
                              y2={exitY}
                              className={connectorClass}
                            />
                            <path
                              d={`M${entryX},${entryY - 7} L${entryX - 7},${entryY + 7} L${entryX + 7},${entryY + 7} Z`}
                              className="trade-entry-shape"
                              tabIndex={0}
                              onMouseEnter={() =>
                                setTooltip({
                                  x: entryX,
                                  y: entryY,
                                  title: `Entry trade #${trade.id}`,
                                  rows: [
                                    ["Entry timestamp", formatDate(trade.entryTime)],
                                    ["Entry price", formatMoney(trade.entryPrice)],
                                    ["Strategy", payload.strategy],
                                    ["Entry tag", trade.entryTag],
                                    ["RSI", formatNumber(trade.entryIndicators.rsi, 2)],
                                    ["EMA50", formatMoney(trade.entryIndicators.ema50)],
                                    ["EMA200", formatMoney(trade.entryIndicators.ema200)],
                                    ["Stake amount", formatMoney(trade.stakeAmount)]
                                  ]
                                })
                              }
                              onFocus={() =>
                                setTooltip({
                                  x: entryX,
                                  y: entryY,
                                  title: `Entry trade #${trade.id}`,
                                  rows: [
                                    ["Entry timestamp", formatDate(trade.entryTime)],
                                    ["Entry price", formatMoney(trade.entryPrice)],
                                    ["Strategy", payload.strategy],
                                    ["Entry tag", trade.entryTag],
                                    ["RSI", formatNumber(trade.entryIndicators.rsi, 2)],
                                    ["EMA50", formatMoney(trade.entryIndicators.ema50)],
                                    ["EMA200", formatMoney(trade.entryIndicators.ema200)],
                                    ["Stake amount", formatMoney(trade.stakeAmount)]
                                  ]
                                })
                              }
                            />
                            <path
                              d={`M${exitX},${exitY - 8} L${exitX + 8},${exitY} L${exitX},${exitY + 8} L${exitX - 8},${exitY} Z`}
                              className="trade-exit-shape"
                              tabIndex={0}
                              onMouseEnter={() =>
                                setTooltip({
                                  x: exitX,
                                  y: exitY,
                                  title: `Exit trade #${trade.id}`,
                                  rows: [
                                    ["Exit timestamp", formatDate(trade.exitTime)],
                                    ["Exit price", formatMoney(trade.exitPrice)],
                                    ["Exit reason", trade.exitReason],
                                    ["Trade duration", trade.durationLabel],
                                    ["Gross P/L", `${formatMoney(trade.grossProfit)} (${formatPercent(trade.grossReturnPct)})`],
                                    ["Fees", formatMoney(trade.fees)],
                                    ["Net P/L", formatMoney(trade.netProfit)],
                                    ["Net return", formatPercent(trade.netReturnPct)]
                                  ]
                                })
                              }
                              onFocus={() =>
                                setTooltip({
                                  x: exitX,
                                  y: exitY,
                                  title: `Exit trade #${trade.id}`,
                                  rows: [
                                    ["Exit timestamp", formatDate(trade.exitTime)],
                                    ["Exit price", formatMoney(trade.exitPrice)],
                                    ["Exit reason", trade.exitReason],
                                    ["Trade duration", trade.durationLabel],
                                    ["Gross P/L", `${formatMoney(trade.grossProfit)} (${formatPercent(trade.grossReturnPct)})`],
                                    ["Fees", formatMoney(trade.fees)],
                                    ["Net P/L", formatMoney(trade.netProfit)],
                                    ["Net return", formatPercent(trade.netReturnPct)]
                                  ]
                                })
                              }
                            />
                          </g>
                        );
                      })
                    : null}
                </svg>
              ) : (
                <div className="empty-chart">No candle data available for this range.</div>
              )}
              <Tooltip tooltip={tooltip} />
            </div>
          </div>

          <div className="chart-card">
            <div className="chart-card-heading">
              <div>
                <h3>Equity Curve</h3>
                <p>Realized account value changes only when exported trades close.</p>
              </div>
              <strong className={payload.backtest.finalBalance && payload.backtest.finalBalance >= 1000 ? "positive" : "negative"}>
                Final {formatMoney(payload.backtest.finalBalance)}
              </strong>
            </div>

            <div className="chart-shell equity-shell">
              {equityChart ? (
                <svg viewBox={`0 0 ${WIDTH} ${EQUITY_HEIGHT}`} role="img" aria-label="Backtest equity curve">
                  <rect
                    x={equityChart.plotLeft}
                    y={equityChart.plotTop}
                    width={equityChart.plotRight - equityChart.plotLeft}
                    height={equityChart.plotBottom - equityChart.plotTop}
                    className="chart-plot"
                  />
                  {equityChart.yTicks.map((tick) => (
                    <g key={`equity-y-${tick}`}>
                      <line
                        x1={equityChart.plotLeft}
                        x2={equityChart.plotRight}
                        y1={equityChart.yScale(tick)}
                        y2={equityChart.yScale(tick)}
                        className="chart-grid-line"
                      />
                      <text x={equityChart.plotLeft - 12} y={equityChart.yScale(tick) + 4} className="chart-axis-label" textAnchor="end">
                        {formatMoney(tick, 0)}
                      </text>
                    </g>
                  ))}
                  {equityChart.xTicks.map((tick) => (
                    <g key={`equity-x-${tick}`}>
                      <text x={equityChart.xScale(tick)} y={EQUITY_HEIGHT - 12} className="chart-axis-label" textAnchor="middle">
                        {formatDate(tick)}
                      </text>
                    </g>
                  ))}
                  <path d={equityChart.path} className="equity-line" />
                  {payload.equity.drawdownMarker &&
                  payload.equity.drawdownMarker.timestamp >= visible.bounds[0] &&
                  payload.equity.drawdownMarker.timestamp <= visible.bounds[1] ? (
                    <g>
                      <circle
                        cx={equityChart.xScale(payload.equity.drawdownMarker.timestamp)}
                        cy={equityChart.yScale(payload.equity.drawdownMarker.balance)}
                        r="7"
                        className="drawdown-marker"
                      />
                      <text
                        x={equityChart.xScale(payload.equity.drawdownMarker.timestamp) + 10}
                        y={equityChart.yScale(payload.equity.drawdownMarker.balance) - 8}
                        className="drawdown-label"
                      >
                        Max drawdown {formatMoney(payload.equity.drawdownMarker.amount)}
                      </text>
                    </g>
                  ) : null}
                </svg>
              ) : (
                <div className="empty-chart">No equity data available for this range.</div>
              )}
            </div>
          </div>

          <div className="source-note">
            <strong>Data sources:</strong> candles from {payload.source.candles}; trades from{" "}
            {payload.source.backtestResult}. {payload.source.note}
          </div>
        </>
      ) : null}
    </section>
  );
}
