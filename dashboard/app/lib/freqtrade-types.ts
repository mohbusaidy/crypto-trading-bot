export type Availability<T> = {
  value: T | null;
  available: boolean;
  source?: string;
};

export type ApiEndpointStatus = {
  endpoint: string;
  status: number | "error";
  ok: boolean;
  message: string;
};

export type DashboardWarning = {
  level: "info" | "warning" | "error";
  message: string;
};

export type OpenPosition = {
  pair: Availability<string>;
  entryPrice: Availability<number>;
  currentPrice: Availability<number>;
  positionSize: Availability<number>;
  unrealizedProfit: Availability<number>;
  entryTime: Availability<string>;
  stopLoss: Availability<number>;
};

export type RecentTrade = {
  entryTime: Availability<string>;
  exitTime: Availability<string>;
  entryPrice: Availability<number>;
  exitPrice: Availability<number>;
  netProfit: Availability<number>;
  exitReason: Availability<string>;
  duration: Availability<string>;
};

export type DashboardSummary = {
  generatedAt: string;
  api: {
    baseUrl: string;
    reachable: boolean;
    authenticated: boolean;
    connectionStatus: "connected" | "degraded" | "unavailable";
    lastSuccessfulRefreshTime: string | null;
    lastApiResponse: string;
    endpoints: ApiEndpointStatus[];
  };
  overview: {
    botStatus: Availability<string>;
    dryRun: Availability<boolean>;
    exchange: Availability<string>;
    tradingPair: Availability<string>;
    strategyName: Availability<string>;
    accountValue: Availability<number>;
    openPositionCount: Availability<number>;
    totalClosedTrades: Availability<number>;
    totalProfitLoss: Availability<number>;
  };
  openPositions: OpenPosition[];
  recentTrades: RecentTrade[];
  performance: {
    totalNetProfitLoss: Availability<number>;
    winRate: Availability<number>;
    winningTrades: Availability<number>;
    losingTrades: Availability<number>;
    averageProfitPerTrade: Availability<number>;
    bestTrade: Availability<number>;
    worstTrade: Availability<number>;
    profitFactor: Availability<number>;
    maximumDrawdown: Availability<number>;
    totalFees: Availability<number>;
  };
  systemHealth: {
    apiReachable: boolean;
    botRunningState: Availability<string>;
    dryRunConfirmed: boolean;
    preliminaryDatasetWarning: boolean;
    warnings: DashboardWarning[];
  };
};
