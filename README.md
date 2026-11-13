# Conservative adaptive NVIDIA CEO market forecaster

An offline, deterministic quantile forecaster for Make.fun's `polymarket-nvidia-ceo-forecast-01` competition.

For each market, `main.ts` estimates the next four hours from up to 180 recent one-minute price changes. It blends empirical innovation quantiles with a Gaussian fallback scaled by median absolute deviation, applies conservative drift shrinkage and dampens both drift and volatility near the 0 and 1 price boundaries. Forecast uncertainty grows with the square root of the horizon, and outputs are clamped to valid probabilities and ordered by quantile.

The entry reads every `*.in` file in `MAKEFUN_INPUT_DIR` (default `/input`) and writes one matching `<id>.out` file to `MAKEFUN_OUTPUT_DIR` (default `/output`). It uses no network calls or future market data.
