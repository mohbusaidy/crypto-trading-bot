from pandas import DataFrame

from BtcBaselineStrategy import BtcBaselineStrategy


class BtcStrategyV2(BtcBaselineStrategy):
    """
    Version 2 of the BTC/EUR baseline strategy.

    BtcBaselineStrategy is preserved as the permanent reference baseline. This
    V2 strategy keeps the baseline entry logic unchanged and addresses the
    structural entry/exit signal collision identified in milestone 6.

    The collision came from entering after an RSI pullback while also exiting
    whenever price was below EMA 50. During a valid pullback, price may still be
    below EMA 50, so V2 uses EMA 200 for the trend-loss exit instead. EMA 200 is
    also the broad bullish regime required by the entry rule.
    """

    # Keep the same 1-hour BTC/EUR structure and indicators as the baseline.
    timeframe = "1h"
    can_short = False

    # Prior recursive analysis showed EMA 200 was more stable at 499 startup
    # candles than at 200 candles. EMA periods themselves are unchanged.
    startup_candle_count = 499

    EXIT_TAG_PRICE_BELOW_EMA200 = "price_below_ema200"
    EXIT_TAG_RSI_OVERBOUGHT = "rsi_overbought"
    EXIT_TAG_PRICE_AND_RSI = "price_below_ema200_and_rsi_overbought"

    def _add_observability_columns(self, dataframe: DataFrame) -> DataFrame:
        """
        Expose the strategy rule pieces as dataframe columns.

        The entry-side columns intentionally match BtcBaselineStrategy. Only the
        structural exit rule changes from close < EMA 50 to close < EMA 200.
        """
        if "date" in dataframe.columns:
            dataframe["observed_candle_timestamp"] = dataframe["date"].astype(str)

        dataframe["trend_condition"] = (
            (dataframe["ema_50"] > dataframe["ema_200"])
            & (dataframe["close"] > dataframe["ema_200"])
        ).fillna(False)

        dataframe["rsi_pullback_condition"] = (
            dataframe["rsi"].shift(1) <= 35
        ).fillna(False)

        dataframe["rsi_recovery_condition"] = (dataframe["rsi"] > 35).fillna(False)
        dataframe["volume_condition"] = (dataframe["volume"] > 0).fillna(False)

        dataframe["entry_signal"] = (
            dataframe["trend_condition"]
            & dataframe["rsi_pullback_condition"]
            & dataframe["rsi_recovery_condition"]
            & dataframe["volume_condition"]
        ).fillna(False)

        # V2 structural correction:
        # Exit on a loss of the broad EMA 200 regime, not on an EMA 50 pullback.
        dataframe["exit_price_below_ema200"] = (
            dataframe["close"] < dataframe["ema_200"]
        ).fillna(False)
        dataframe["exit_rsi_overbought"] = (dataframe["rsi"] >= 70).fillna(False)
        dataframe["exit_signal"] = (
            (
                dataframe["exit_price_below_ema200"]
                | dataframe["exit_rsi_overbought"]
            )
            & dataframe["volume_condition"]
        ).fillna(False)

        dataframe["signal_decision"] = "WAIT"
        dataframe["signal_reason"] = (
            "WAIT: no complete V2 entry or exit signal exists on this candle."
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
            dataframe["exit_price_below_ema200"] & dataframe["volume_condition"],
            ["signal_decision", "signal_reason"],
        ] = ["EXIT", "EXIT: price closed below EMA 200, so the broad trend regime is lost."]

        dataframe.loc[
            dataframe["exit_rsi_overbought"] & dataframe["volume_condition"],
            ["signal_decision", "signal_reason"],
        ] = ["EXIT", "EXIT: RSI is 70 or higher, so momentum is stretched."]

        dataframe.loc[
            (
                dataframe["exit_price_below_ema200"]
                & dataframe["exit_rsi_overbought"]
                & dataframe["volume_condition"]
            ),
            ["signal_decision", "signal_reason"],
        ] = [
            "EXIT",
            "EXIT: price closed below EMA 200 and RSI is 70 or higher.",
        ]

        return dataframe

    def populate_exit_trend(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        """
        V2 exit rule, in beginner-friendly terms:

        Exit when either:

        1. Price closes below EMA 200.
           This means price lost the broad trend line required by the entry rule.

        2. RSI is 70 or higher.
           This keeps the baseline overbought exit behavior unchanged.
        """
        dataframe["exit_long"] = 0
        dataframe["exit_tag"] = ""

        price_exit = dataframe["exit_price_below_ema200"] & dataframe["volume_condition"]
        rsi_exit = dataframe["exit_rsi_overbought"] & dataframe["volume_condition"]
        combined_exit = price_exit & rsi_exit

        dataframe.loc[dataframe["exit_signal"], "exit_long"] = 1
        dataframe.loc[price_exit, "exit_tag"] = self.EXIT_TAG_PRICE_BELOW_EMA200
        dataframe.loc[rsi_exit, "exit_tag"] = self.EXIT_TAG_RSI_OVERBOUGHT
        dataframe.loc[combined_exit, "exit_tag"] = self.EXIT_TAG_PRICE_AND_RSI

        return dataframe
