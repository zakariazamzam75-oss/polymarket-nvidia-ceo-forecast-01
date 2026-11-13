import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
const LEVELS = [0.05, 0.25, 0.5, 0.75, 0.95];
const Z_GAUSSIAN = [-1.644853626951, -0.674489750196, 0, 0.674489750196, 1.644853626951];

type Market = { id: string; prices: number[] };
type CaseFile = { horizon_minutes: number; quantiles: number[]; markets: Market[] };

const clamp = (x: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));
const round6 = (x: number) => Math.round(clamp(x) * 1e6) / 1e6 + 0;

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const a = [...xs].sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m]! : (a[m - 1]! + a[m]!) / 2;
};

const empiricalQuantile = (sortedAsc: number[], tau: number) => {
  if (!sortedAsc.length) return 0;
  if (sortedAsc.length === 1) return sortedAsc[0]!;
  const idx = tau * (sortedAsc.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedAsc[lo]!;
  const w = idx - lo;
  return (1 - w) * sortedAsc[lo]! + w * sortedAsc[hi]!;
};

/**
 * Forecaster using empirical quantiles of recent 1-minute price innovations,
 * blended with a robust Gaussian/MAD dispersion floor, conservative drift,
 * boundary damping, and sqrt(h) horizon scaling.
 */
function forecast(m: Market, horizon: number): number[][] {
  if (!Array.isArray(m.prices) || m.prices.length === 0) throw new Error(`empty prices: ${m.id}`);
  const prices = m.prices.map(Number);
  if (prices.some((x) => !Number.isFinite(x) || x < 0 || x > 1)) throw new Error(`bad price: ${m.id}`);

  const x = prices[prices.length - 1]!;
  const n = Math.min(180, prices.length - 1);
  const changes: number[] = [];
  for (let i = prices.length - n; i < prices.length; i++) {
    changes.push(prices[i]! - prices[i - 1]!);
  }

  const sortedChanges = [...changes].sort((a, b) => a - b);
  const center = median(changes);
  const absDev = changes.map((d) => Math.abs(d - center));
  const madSigma = Math.max(0.00015, 1.4826 * median(absDev));

  // EWMA mean reaction
  let ewma = 0;
  for (let i = 0; i < changes.length; i++) {
    const alpha = 0.03 + 0.12 * (i + 1) / Math.max(1, changes.length);
    ewma = (1 - alpha) * ewma + alpha * changes[i]!;
  }

  // Boundary damping factor: volatility and drift compress near 0 and 1
  const boundaryFactor = Math.max(0.25, 4 * x * (1 - x));
  const drift = clamp((0.35 * ewma + 0.25 * center) * boundaryFactor, -0.0012, 0.0012);

  // Compute empirical quantile deviations from median (center)
  const empDevs = LEVELS.map((tau) => empiricalQuantile(sortedChanges, tau) - empiricalQuantile(sortedChanges, 0.5));
  
  // Gaussian fallback deviations
  const gaussDevs = Z_GAUSSIAN.map((z) => z * madSigma);

  // Blend empirical innovation quantiles with robust Gaussian/MAD floor (65% empirical, 35% Gaussian)
  const blendedDevs = empDevs.map((emp, i) => {
    const g = gaussDevs[i]!;
    return 0.65 * emp + 0.35 * g;
  });

  const rows: number[][] = [];
  for (let h = 1; h <= horizon; h++) {
    const sqrtH = Math.sqrt(h);
    const mean = clamp(x + drift * sqrtH * 0.6, 0.0001, 0.9999);

    const row = blendedDevs.map((dev) => {
      const val = mean + dev * sqrtH * (0.9 + 0.1 * boundaryFactor);
      return round6(val);
    });

    // Enforce monotonicity
    for (let j = 1; j < row.length; j++) {
      if (row[j]! < row[j - 1]!) row[j] = row[j - 1]!;
    }
    rows.push(row);
  }
  return rows;
}

mkdirSync(OUTPUT_DIR, { recursive: true });
const files = readdirSync(INPUT_DIR).filter((f) => f.endsWith('.in')).sort();
for (const file of files) {
  const id = file.slice(0, -3);
  const c = JSON.parse(readFileSync(join(INPUT_DIR, file), 'utf8')) as CaseFile;
  if (c.quantiles.length !== LEVELS.length || c.quantiles.some((q, i) => q !== LEVELS[i])) {
    throw new Error(`unexpected quantiles in ${file}`);
  }
  if (!Number.isInteger(c.horizon_minutes) || c.horizon_minutes < 1) {
    throw new Error(`bad horizon in ${file}`);
  }
  const forecasts = c.markets.map((m) => ({ id: m.id, q: forecast(m, c.horizon_minutes) }));
  writeFileSync(join(OUTPUT_DIR, `${id}.out`), `${JSON.stringify({ forecasts })}\n`);
}
