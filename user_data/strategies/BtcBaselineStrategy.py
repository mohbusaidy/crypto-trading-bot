from pandas import DataFrame

from freqtrade.strategy import IStrategy


class BtcBaselineStrategy(IStrategy):
    """
    A deliberately simple BTC/EUR baseline strategy for learning and backtesting.

    This strategy is not optimized and is not a prediction machine. It is meant to
    provide a readable first benchmark that can be tested honestly before any
    tuning or feature additions happen.
    """

    # This strategy only looks at 1-hour candles. Each candle summarizes one hour
    # of BTC/EUR trading activity: open, high, low, close, and volume.
    timeframe = "1h"

    # Spot-only, long-only behavior. Freqtrade will not open short positions when
    # this is False, and this project config also uses spot trading mode.
    can_short = False

    # Freqtrade needs enough warm-up candles before indicators are reliable.
    # EMA 200 needs roughly 200 candles before it becomes meaningful.
    startup_candle_count = 200

    # Stop-loss: if a trade falls 8% from its entry price, close it.
    # This is a simple risk limit, not a guarantee. Real markets can gap or move
    # quickly, and dry-run/backtest fills are simplified compared with live fills.
    stoploss = -0.08

    # Minimal ROI is intentionally permissive here. The strategy's explicit exit
    # rule below decides when to leave most trades, while this keeps a fallback
    # profit-taking route available if price moves strongly in our favor.
    minimal_roi = {
        "0": 0.10
    }

    # Use regular candles only. We are not using leverage, margin, futures,
    # short-selling, or any advanced order behavior in this baseline.
    process_only_new_candles = True
    use_exit_signal = True
    exit_profit_only = False
    ignore_roi_if_entry_signal = False

    @property
    def protections(self):
        """
        Preliminary paper-trading guardrails.

        These protections do not change the EMA/RSI entry indicators. They only
        tell Freqtrade to pause new entries after certain risk events so dry-run
        testing is less likely to keep taking signals during obviously poor
        conditions.
        """
        return [
            # CooldownPeriod:
            # After any trade closes, wait one full 1-hour candle before taking
            # another entry. This slows the bot down after exits.
            {
                "method": "CooldownPeriod",
                "stop_duration_candles": 1,
            },
            # StoplossGuard:
            # If one stop-loss occurs within the last 24 one-hour candles,
            # pause new entries for 12 one-hour candles.
            {
                "method": "StoplossGuard",
                "lookback_period_candles": 24,
                "trade_limit": 1,
                "stop_duration_candles": 12,
                "required_profit": 0.0,
                "only_per_pair": False,
            },
            # MaxDrawdown:
            # If at least three trades inside a 168-candle window produce more
            # than 8% drawdown, pause new entries for 24 one-hour candles.
            {
                "method": "MaxDrawdown",
                "lookback_period_candles": 168,
                "trade_limit": 3,
                "stop_duration_candles": 24,
                "max_allowed_drawdown": 0.08,
            },
        ]

    ENTRY_TAG = "ema_trend_rsi_pullback_recovery"
    EXIT_TAG_PRICE_BELOW_EMA50 = "price_below_ema50"
    EXIT_TAG_RSI_OVERBOUGHT = "rsi_overbought"
    EXIT_TAG_PRICE_AND_RSI = "price_below_ema50_and_rsi_overbought"

    def _add_observability_columns(self, dataframe: DataFrame) -> DataFrame:
        """
        Turn the strategy's actual rule pieces into named columns.

        Freqtrade can expose these analyzed dataframe columns through its local
        REST API. The dashboard can then read the strategy's own view of the
        latest candle instead of re-creating the trading rules in TypeScript.
        """
        if "date" in dataframe.columns:
            dataframe["observed_candle_timestamp"] = dataframe["date"].astype(str)

        # Broad trend condition:
        # EMA 50 must be above EMA 200, and price must also be above EMA 200.
        # This matches the trend filter already used by the entry rule.
        dataframe["trend_condition"] = (
            (dataframe["ema_50"] > dataframe["ema_200"])
            & (dataframe["close"] > dataframe["ema_200"])
        ).fillna(False)

        # Pullback condition:
        # The previous candle's RSI was weak enough to count as a pullback.
        dataframe["rsi_pullback_condition"] = (
            dataframe["rsi"].shift(1) <= 35
        ).fillna(False)

        # Recovery condition:
        # The current candle's RSI has recovered back above the pullback line.
        dataframe["rsi_recovery_condition"] = (dataframe["rsi"] > 35).fillna(False)

        # Volume condition:
        # Ignore candles with no trading activity.
        dataframe["volume_condition"] = (dataframe["volume"] > 0).fillna(False)

        # Entry signal:
        # This is the same condition used to set enter_long below.
        dataframe["entry_signal"] = (
            dataframe["trend_condition"]
            & dataframe["rsi_pullback_condition"]
            & dataframe["rsi_recovery_condition"]
            & dataframe["volume_condition"]
        ).fillna(False)

        # Exit signal:
        # These are the same exit branches used to set exit_long below.
        dataframe["exit_price_below_ema50"] = (
            dataframe["close"] < dataframe["ema_50"]
        ).fillna(False)
        dataframe["exit_rsi_overbought"] = (dataframe["rsi"] >= 70).fillna(False)
        dataframe["exit_signal"] = (
            (
                dataframe["exit_price_below_ema50"]
                | dataframe["exit_rsi_overbought"]
            )
            & dataframe["volume_condition"]
        ).fillna(False)

        # Human-readable status for the latest candle. If both entry and exit
        # are true on the same candle, EXIT gets display priority because it is
        # the safer interpretation for a monitor.
        dataframe["signal_decision"] = "WAIT"
        dataframe["signal_reason"] = (
            "WAIT: no complete baseline entry or exit signal exists on this candle."
        )

        dataframe.loc[
            ~dataframe["volume_condition"],
            "signal_reason",
        ] = "WAIT: candle volume is zero, so the strategy ignores this candle."

        dataframe.loc[
            dataframe["volume_condition"] & ~dataframe["trend_condition"],
            "signal_reason",
        ] = (
            "WAIT: the broad trend filter is not met because EMA 50 is not above "
            "EMA 200 or price is not above EMA 200."
        )

        dataframe.loc[
            dataframe["trend_condition"] & ~dataframe["rsi_pullback_condition"],
            "signal_reason",
        ] = "WAIT: the trend is acceptable, but the previous candle did not show an RSI pullback."

        dataframe.loc[
            (
                dataframe["trend_condition"]
                & dataframe["rsi_pullback_condition"]
                & ~dataframe["rsi_recovery_condition"]
            ),
            "signal_reason",
        ] = "WAIT: RSI pulled back, but it has not recovered above 35 yet."

        dataframe.loc[
            dataframe["entry_signal"],
            ["signal_decision", "signal_reason"],
        ] = [
            "ENTER",
            "ENTER: EMA trend is positive and RSI recovered above 35 after a pullback.",
        ]

        dataframe.loc[
            dataframe["exit_price_below_ema50"] & dataframe["volume_condition"],
            ["signal_decision", "signal_reason"],
        ] = ["EXIT", "EXIT: price closed below EMA 50, so recent trend weakened."]

        dataframe.loc[
            dataframe["exit_rsi_overbought"] & dataframe["volume_condition"],
            ["signal_decision", "signal_reason"],
        ] = ["EXIT", "EXIT: RSI is 70 or higher, so momentum is stretched."]

        dataframe.loc[
            (
                dataframe["exit_price_below_ema50"]
                & dataframe["exit_rsi_overbought"]
                & dataframe["volume_condition"]
            ),
            ["signal_decision", "signal_reason"],
        ] = [
            "EXIT",
            "EXIT: price closed below EMA 50 and RSI is 70 or higher.",
        ]

        return dataframe

    @staticmethod
    def _rsi(dataframe: DataFrame, period: int = 14) -> DataFrame:
        """
        Calculate RSI in plain pandas so the formula is easy to inspect.

        RSI means Relative Strength Index. It compares recent upward movement
        with recent downward movement. Lower values often mean price has pulled
        back; rising from a low value can mean the pullback is recovering.
        """
        change = dataframe["close"].diff()

        # Separate upward and downward candle changes.
        gains = change.clip(lower=0)
        losses = -change.clip(upper=0)

        # Smooth the average gain/loss using an exponential moving average.
        average_gain = gains.ewm(alpha=1 / period, adjust=False, min_periods=period).mean()
        average_loss = losses.ewm(alpha=1 / period, adjust=False, min_periods=period).mean()

        relative_strength = average_gain / average_loss
        dataframe["rsi"] = 100 - (100 / (1 + relative_strength))

        return dataframe

    def populate_indicators(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        """
        Add the indicators used by the entry and exit rules.

        EMA 50:
            A medium-term moving average. It reacts faster than EMA 200 and helps
            show whether recent price action is above or below the broader trend.

        EMA 200:
            A slower moving average. This is used as the broad trend filter. If
            EMA 50 is above EMA 200, the market is treated as being in an upward
            trend for this baseline.

        RSI 14:
            A momentum indicator. Here it is used to wait for a pullback and then
            a recovery, instead of buying just because price is already high.
        """
        dataframe["ema_50"] = dataframe["close"].ewm(span=50, adjust=False).mean()
        dataframe["ema_200"] = dataframe["close"].ewm(span=200, adjust=False).mean()

        dataframe = self._rsi(dataframe, period=14)
        dataframe = self._add_observability_columns(dataframe)

        return dataframe

    def populate_entry_trend(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        """
        Entry rule, in beginner-friendly terms:

        1. EMA 50 must be above EMA 200.
           This means the medium-term trend is stronger than the long-term trend.

        2. The current close must be above EMA 200.
           This avoids buying while price is still below the broad trend line.

        3. RSI must cross back above 35.
           This means RSI was weak/pulled back, but has started recovering.

        4. Volume must be above zero.
           This avoids candles with no trading activity.
        """
        dataframe["enter_long"] = 0
        dataframe["enter_tag"] = ""

        dataframe.loc[dataframe["entry_signal"], "enter_long"] = 1
        dataframe.loc[dataframe["entry_signal"], "enter_tag"] = self.ENTRY_TAG

        return dataframe

    def populate_exit_trend(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        """
        Exit rule, in beginner-friendly terms:

        Exit when either:

        1. Price closes below EMA 50.
           This says the recent trend has weakened.

        2. RSI is 70 or higher.
           This says momentum is stretched, so the baseline takes the exit signal
           rather than assuming the move will continue forever.
        """
        dataframe["exit_long"] = 0
        dataframe["exit_tag"] = ""

        price_exit = dataframe["exit_price_below_ema50"] & dataframe["volume_condition"]
        rsi_exit = dataframe["exit_rsi_overbought"] & dataframe["volume_condition"]
        combined_exit = price_exit & rsi_exit

        dataframe.loc[dataframe["exit_signal"], "exit_long"] = 1
        dataframe.loc[price_exit, "exit_tag"] = self.EXIT_TAG_PRICE_BELOW_EMA50
        dataframe.loc[rsi_exit, "exit_tag"] = self.EXIT_TAG_RSI_OVERBOUGHT
        dataframe.loc[combined_exit, "exit_tag"] = self.EXIT_TAG_PRICE_AND_RSI

        return dataframe
