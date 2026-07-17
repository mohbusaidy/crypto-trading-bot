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
        dataframe.loc[
            (
                (dataframe["ema_50"] > dataframe["ema_200"])
                & (dataframe["close"] > dataframe["ema_200"])
                & (dataframe["rsi"].shift(1) <= 35)
                & (dataframe["rsi"] > 35)
                & (dataframe["volume"] > 0)
            ),
            "enter_long",
        ] = 1

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
        dataframe.loc[
            (
                (
                    (dataframe["close"] < dataframe["ema_50"])
                    | (dataframe["rsi"] >= 70)
                )
                & (dataframe["volume"] > 0)
            ),
            "exit_long",
        ] = 1

        return dataframe
