import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { inflateRawSync } from "node:zlib";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type JsonObject = Record<string, unknown>;

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

type BacktestTrade = {
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
  durationMinutes: number;
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

const DATASET_A = {
  key: "dataset-a",
  label: "Dataset A",
  pair: "BTC/EUR",
  start: "2021-07-23T14:00:00.000Z",
  end: "2023-05-07T19:00:00.000Z"
};

const STRATEGY_RESULTS = {
  BtcBaselineStrategy: "milestone5_longest_complete",
  BtcStrategyV2: "milestone7_v2_dataset_a"
} as const;

type StrategyName = keyof typeof STRATEGY_RESULTS;

const repoRoot = () =>
  path.basename(process.cwd()) === "dashboard"
    ? path.dirname(process.cwd())
    : process.cwd();

const isObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const asNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const asString = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

const normalizeDate = (value: string) => {
  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  const date = new Date(normalized.endsWith("Z") || /[+-]\d\d:\d\d$/.test(normalized)
    ? normalized
    : `${normalized}Z`);

  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid date in backtest data: ${value}`);
  }

  return date;
};

const toTimestampSeconds = (date: Date) => Math.floor(date.getTime() / 1000);

const durationLabel = (minutes: number) => {
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const remainingMinutes = minutes % 60;

  if (days > 0) return `${days}d ${hours}h ${remainingMinutes}m`;
  if (hours > 0) return `${hours}h ${remainingMinutes}m`;
  return `${remainingMinutes}m`;
};

const findEndOfCentralDirectory = (buffer: Buffer) => {
  for (let index = buffer.length - 22; index >= 0; index -= 1) {
    if (buffer.readUInt32LE(index) === 0x06054b50) return index;
  }

  throw new Error("Unable to locate zip central directory.");
};

const readZipText = (buffer: Buffer, matcher: (fileName: string) => boolean) => {
  const endRecord = findEndOfCentralDirectory(buffer);
  const entryCount = buffer.readUInt16LE(endRecord + 10);
  let cursor = buffer.readUInt32LE(endRecord + 16);

  for (let entryIndex = 0; entryIndex < entryCount; entryIndex += 1) {
    if (buffer.readUInt32LE(cursor) !== 0x02014b50) {
      throw new Error("Invalid zip central directory entry.");
    }

    const compressionMethod = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const fileNameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localHeaderOffset = buffer.readUInt32LE(cursor + 42);
    const fileName = buffer
      .subarray(cursor + 46, cursor + 46 + fileNameLength)
      .toString("utf8");

    if (matcher(fileName)) {
      if (buffer.readUInt32LE(localHeaderOffset) !== 0x04034b50) {
        throw new Error("Invalid zip local file header.");
      }

      const localFileNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
      const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
      const dataStart = localHeaderOffset + 30 + localFileNameLength + localExtraLength;
      const compressed = buffer.subarray(dataStart, dataStart + compressedSize);

      if (compressionMethod === 0) return compressed.toString("utf8");
      if (compressionMethod === 8) return inflateRawSync(compressed).toString("utf8");

      throw new Error(`Unsupported zip compression method: ${compressionMethod}`);
    }

    cursor += 46 + fileNameLength + extraLength + commentLength;
  }

  throw new Error("Requested file not found inside zip.");
};

const latestBacktestZip = async (strategyName: StrategyName) => {
  const resultDirectory = path.join(
    repoRoot(),
    "user_data",
    "backtest_results",
    STRATEGY_RESULTS[strategyName]
  );
  const files = await readdir(resultDirectory);
  const zips = files
    .filter((file) => file.startsWith("backtest-result-") && file.endsWith(".zip"))
    .sort();

  if (zips.length === 0) {
    throw new Error(`No backtest result zip found for ${strategyName}.`);
  }

  return path.join(resultDirectory, zips[zips.length - 1]);
};

const readBacktestResult = async (strategyName: StrategyName) => {
  const zipPath = await latestBacktestZip(strategyName);
  const zip = await readFile(zipPath);
  const jsonText = readZipText(
    zip,
    (fileName) => fileName.endsWith(".json") && !fileName.endsWith("_config.json")
  );
  const parsed = JSON.parse(jsonText) as unknown;

  if (!isObject(parsed) || !isObject(parsed.strategy)) {
    throw new Error(`Unexpected backtest result shape for ${strategyName}.`);
  }

  const strategyResult = parsed.strategy[strategyName];
  if (!isObject(strategyResult)) {
    throw new Error(`Strategy ${strategyName} not found in backtest result.`);
  }

  return {
    zipPath,
    result: strategyResult
  };
};

const calculateEma = (values: number[], period: number) => {
  const multiplier = 2 / (period + 1);
  const output: number[] = [];
  let previous: number | null = null;

  for (const value of values) {
    previous = previous === null ? value : value * multiplier + previous * (1 - multiplier);
    output.push(previous);
  }

  return output;
};

const calculateRsi = (values: number[], period = 14) => {
  const output: Array<number | null> = new Array(values.length).fill(null);
  const alpha = 1 / period;
  let averageGain: number | null = null;
  let averageLoss: number | null = null;
  let observedChanges = 0;

  for (let index = 1; index < values.length; index += 1) {
    const change = values[index] - values[index - 1];
    const gain = Math.max(change, 0);
    const loss = Math.max(-change, 0);

    averageGain = averageGain === null ? gain : averageGain * (1 - alpha) + gain * alpha;
    averageLoss = averageLoss === null ? loss : averageLoss * (1 - alpha) + loss * alpha;
    observedChanges += 1;

    if (observedChanges >= period) {
      output[index] =
        averageLoss === 0
          ? 100
          : 100 - 100 / (1 + (averageGain ?? 0) / averageLoss);
    }
  }

  return output;
};

const readDatasetACandles = async (): Promise<Candle[]> => {
  const file = await readFile(
    path.join(repoRoot(), "user_data", "kraken_ohlcvt_import", "XBTEUR_60.csv"),
    "utf8"
  );
  const startMs = new Date(DATASET_A.start).getTime();
  const endMs = new Date(DATASET_A.end).getTime();

  const rows = file
    .trim()
    .split(/\r?\n/)
    .map((line) => line.split(","))
    .map((row) => ({
      timestamp: Number(row[0]),
      open: Number(row[1]),
      high: Number(row[2]),
      low: Number(row[3]),
      close: Number(row[4]),
      volume: Number(row[5])
    }))
    .filter((row) => {
      const timeMs = row.timestamp * 1000;
      return (
        Number.isFinite(row.timestamp) &&
        Number.isFinite(row.close) &&
        timeMs >= startMs &&
        timeMs <= endMs
      );
    })
    .sort((left, right) => left.timestamp - right.timestamp);

  const closes = rows.map((row) => row.close);
  const ema50 = calculateEma(closes, 50);
  const ema200 = calculateEma(closes, 200);
  const rsi = calculateRsi(closes);

  return rows.map((row, index) => ({
    ...row,
    time: new Date(row.timestamp * 1000).toISOString(),
    ema50: ema50[index] ?? null,
    ema200: ema200[index] ?? null,
    rsi: rsi[index] ?? null
  }));
};

const buildCandleMap = (candles: Candle[]) =>
  new Map(candles.map((candle) => [candle.timestamp, candle]));

const tradeList = (result: JsonObject): JsonObject[] => {
  const trades = result.trades;
  return Array.isArray(trades) ? trades.filter(isObject) : [];
};

const buildTrades = (result: JsonObject, candles: Candle[]): BacktestTrade[] => {
  const candleMap = buildCandleMap(candles);

  return tradeList(result).map((trade, index) => {
    const entryDate = normalizeDate(asString(trade.open_date) ?? "");
    const exitDate = normalizeDate(asString(trade.close_date) ?? "");
    const entryTimestamp = toTimestampSeconds(entryDate);
    const exitTimestamp = toTimestampSeconds(exitDate);
    const entryPrice = asNumber(trade.open_rate) ?? 0;
    const exitPrice = asNumber(trade.close_rate) ?? 0;
    const amount = asNumber(trade.amount) ?? 0;
    const stakeAmount = asNumber(trade.stake_amount) ?? 0;
    const feeOpen = asNumber(trade.fee_open) ?? 0;
    const feeClose = asNumber(trade.fee_close) ?? 0;
    const entryCandle = candleMap.get(entryTimestamp) ?? null;
    const fees = amount * entryPrice * feeOpen + amount * exitPrice * feeClose;
    const grossProfit = amount * (exitPrice - entryPrice);
    const netProfit = asNumber(trade.profit_abs) ?? 0;
    const durationMinutes = asNumber(trade.trade_duration) ?? 0;

    return {
      id: index + 1,
      pair: asString(trade.pair) ?? DATASET_A.pair,
      entryTime: entryDate.toISOString(),
      entryTimestamp,
      exitTime: exitDate.toISOString(),
      exitTimestamp,
      entryPrice,
      exitPrice,
      amount,
      stakeAmount,
      entryTag: asString(trade.enter_tag) ?? "Not available",
      exitReason: asString(trade.exit_reason) ?? "Not available",
      durationMinutes,
      durationLabel: durationLabel(durationMinutes),
      grossProfit,
      grossReturnPct: entryPrice === 0 ? 0 : (exitPrice / entryPrice - 1) * 100,
      fees,
      netProfit,
      netReturnPct: (asNumber(trade.profit_ratio) ?? 0) * 100,
      isWin: netProfit > 0,
      entryIndicators: {
        ema50: entryCandle?.ema50 ?? null,
        ema200: entryCandle?.ema200 ?? null,
        rsi: entryCandle?.rsi ?? null
      }
    };
  });
};

const buildEquityCurve = (result: JsonObject, trades: BacktestTrade[]) => {
  const startingBalance = asNumber(result.starting_balance) ?? 1000;
  let balance = startingBalance;
  const backtestStart = normalizeDate(asString(result.backtest_start) ?? DATASET_A.start);
  const points: EquityPoint[] = [
    {
      time: backtestStart.toISOString(),
      timestamp: toTimestampSeconds(backtestStart),
      balance
    }
  ];

  for (const trade of [...trades].sort((left, right) => left.exitTimestamp - right.exitTimestamp)) {
    balance += trade.netProfit;
    points.push({
      time: trade.exitTime,
      timestamp: trade.exitTimestamp,
      balance
    });
  }

  const drawdownEnd = asString(result.drawdown_end);
  const drawdownLow = asNumber(result.max_drawdown_low);
  const markerDate = drawdownEnd ? normalizeDate(drawdownEnd) : null;

  return {
    points,
    drawdownMarker:
      markerDate && drawdownLow !== null
        ? {
            time: markerDate.toISOString(),
            timestamp: toTimestampSeconds(markerDate),
            balance: startingBalance + drawdownLow,
            amount: asNumber(result.max_drawdown_abs),
            percent: (asNumber(result.max_drawdown_account) ?? 0) * 100
          }
        : null
  };
};

export async function GET(request: NextRequest) {
  const requestedStrategy = request.nextUrl.searchParams.get("strategy");
  const strategyName: StrategyName =
    requestedStrategy === "BtcBaselineStrategy" || requestedStrategy === "BtcStrategyV2"
      ? requestedStrategy
      : "BtcStrategyV2";

  try {
    const candles = await readDatasetACandles();
    const { zipPath, result } = await readBacktestResult(strategyName);
    const trades = buildTrades(result, candles);
    const equity = buildEquityCurve(result, trades);

    return NextResponse.json({
      strategy: strategyName,
      availableStrategies: Object.keys(STRATEGY_RESULTS),
      dataset: DATASET_A,
      source: {
        candles: "user_data/kraken_ohlcvt_import/XBTEUR_60.csv",
        backtestResult: path.relative(repoRoot(), zipPath),
        note: "Dataset B is intentionally not used by this visualization."
      },
      backtest: {
        rangeStart: normalizeDate(asString(result.backtest_start) ?? DATASET_A.start).toISOString(),
        rangeEnd: normalizeDate(asString(result.backtest_end) ?? DATASET_A.end).toISOString(),
        startingBalance: asNumber(result.starting_balance),
        finalBalance: asNumber(result.final_balance),
        tradeCount: asNumber(result.total_trades),
        netProfit: asNumber(result.profit_total_abs),
        netReturnPct: (asNumber(result.profit_total) ?? 0) * 100,
        profitFactor: asNumber(result.profit_factor),
        maxDrawdown: asNumber(result.max_drawdown_abs),
        maxDrawdownPct: (asNumber(result.max_drawdown_account) ?? 0) * 100
      },
      candles,
      trades,
      equity,
      generatedAt: new Date().toISOString()
    });
  } catch (caught) {
    const message =
      caught instanceof Error ? caught.message : "Unable to load backtest visualization data.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
