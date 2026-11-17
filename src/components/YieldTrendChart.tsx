import React, { useMemo, useState } from 'react';
import type { CropRecord, EnvironmentalFeatures } from '../shared/agronomyTypes.ts';
import { CROP_PROFILES, FEATURE_META } from '../ml/agronomyDataset.ts';
import { computeSensitivityCurve, type TrainedModel } from '../ml/mlEngine.ts';

interface YieldTrendChartProps {
  model: TrainedModel;
  crop: string;
  env: EnvironmentalFeatures;
  dataset: CropRecord[];
}

type TrendVariable = 'nitrogen' | 'soilMoisture';

interface BinnedHistoricalPoint {
  x: number;
  meanYield: number;
  count: number;
}

export const YieldTrendChart: React.FC<YieldTrendChartProps> = ({
  model,
  crop,
  env,
  dataset,
}) => {
  const [trendKey, setTrendKey] = useState<TrendVariable>('nitrogen');
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const meta = useMemo(
    () => FEATURE_META.find((m) => m.key === trendKey) ?? FEATURE_META[0],
    [trendKey]
  );

  // 1. ML model predicted yield curve across varying Nitrogen or Soil Moisture
  const predictedSeries = useMemo(
    () => computeSensitivityCurve(model, crop, env, trendKey, 24),
    [model, crop, env, trendKey]
  );

  // 2. Historical dataset observations for the selected crop + binned historical trend line
  const { historicalDots, historicalTrend } = useMemo(() => {
    const cropRows = dataset
      .filter((r) => r.crop === crop && Number.isFinite(r[trendKey]) && Number.isFinite(r.yieldTonsPerHa))
      .sort((a, b) => a[trendKey] - b[trendKey]);

    const dots = cropRows.map((r) => ({
      id: r.id,
      x: r[trendKey],
      y: r.yieldTonsPerHa,
      region: r.region,
    }));

    // Build smooth historical binned averages across 6 equal intervals within observed range
    const bins: BinnedHistoricalPoint[] = [];
    if (cropRows.length >= 2) {
      const minObs = cropRows[0][trendKey];
      const maxObs = cropRows[cropRows.length - 1][trendKey];
      const numBins = Math.min(7, Math.max(3, Math.floor(cropRows.length / 3)));
      const span = Math.max(1e-6, maxObs - minObs);

      for (let b = 0; b < numBins; b++) {
        const lo = minObs + (span * b) / numBins;
        const hi = minObs + (span * (b + 1)) / numBins;
        const inBin = cropRows.filter((r) =>
          b === numBins - 1
            ? r[trendKey] >= lo && r[trendKey] <= hi
            : r[trendKey] >= lo && r[trendKey] < hi
        );
        if (inBin.length > 0) {
          const avgX = inBin.reduce((s, r) => s + r[trendKey], 0) / inBin.length;
          const avgY = inBin.reduce((s, r) => s + r.yieldTonsPerHa, 0) / inBin.length;
          bins.push({
            x: Number(avgX.toFixed(1)),
            meanYield: Number(avgY.toFixed(2)),
            count: inBin.length,
          });
        }
      }
    }

    return { historicalDots: dots, historicalTrend: bins };
  }, [dataset, crop, trendKey]);

  const optimalRange = CROP_PROFILES[crop]?.optimal[trendKey] ?? null;

  const width = 760;
  const height = 275;
  const pad = { top: 24, right: 24, bottom: 40, left: 52 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  const allY = [
    ...predictedSeries.flatMap((p) => [p.lower, p.upper]),
    ...historicalDots.map((d) => d.y),
  ];
  const minY = Math.max(0, Math.floor((allY.length ? Math.min(...allY) : 0) * 0.85));
  const maxY = Math.max(minY + 1, Math.ceil((allY.length ? Math.max(...allY) : 10) * 1.08));

  const xScale = (val: number) => {
    const clamped = Math.min(meta.max, Math.max(meta.min, val));
    return pad.left + ((clamped - meta.min) / Math.max(1e-6, meta.max - meta.min)) * plotW;
  };
  const yScale = (val: number) =>
    pad.top + plotH - ((val - minY) / Math.max(1e-6, maxY - minY)) * plotH;

  const predictedLinePath = predictedSeries
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${xScale(p.x).toFixed(1)} ${yScale(p.yield).toFixed(1)}`)
    .join(' ');

  const predictedBandPath =
    predictedSeries
      .map((p, i) => `${i === 0 ? 'M' : 'L'} ${xScale(p.x).toFixed(1)} ${yScale(p.upper).toFixed(1)}`)
      .join(' ') +
    ' ' +
    [...predictedSeries]
      .reverse()
      .map((p) => `L ${xScale(p.x).toFixed(1)} ${yScale(p.lower).toFixed(1)}`)
      .join(' ') +
    ' Z';

  const historicalTrendPath = historicalTrend
    .map(
      (p, i) =>
        `${i === 0 ? 'M' : 'L'} ${xScale(p.x).toFixed(1)} ${yScale(p.meanYield).toFixed(1)}`
    )
    .join(' ');

  const currentX = xScale(env[trendKey]);
  const activePoint = hoverIdx !== null ? predictedSeries[hoverIdx] : null;

  const nearestHistoricalAvg = useMemo(() => {
    if (!activePoint || historicalDots.length === 0) return null;
    const windowRadius = (meta.max - meta.min) * 0.12;
    const nearby = historicalDots.filter(
      (d) => Math.abs(d.x - activePoint.x) <= windowRadius
    );
    if (nearby.length === 0) return null;
    const avg = nearby.reduce((s, d) => s + d.y, 0) / nearby.length;
    return { avg: Number(avg.toFixed(2)), n: nearby.length };
  }, [activePoint, historicalDots, meta.max, meta.min]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">
            Historical &amp; Predicted Yield Trend ({crop})
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Compares ML predicted yield trajectory against {historicalDots.length} historical {crop.toLowerCase()} field trials across varying{' '}
            {trendKey === 'nitrogen' ? 'nitrogen application' : 'root-zone soil moisture'}.
          </p>
        </div>

        <div
          role="group"
          aria-label="Trend variable selector"
          className="inline-flex rounded-md border border-slate-300 bg-slate-100 p-0.5"
        >
          <button
            type="button"
            onClick={() => {
              setTrendKey('nitrogen');
              setHoverIdx(null);
            }}
            className={`px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap cursor-pointer ${
              trendKey === 'nitrogen'
                ? 'bg-white text-slate-900 shadow-xs font-semibold'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Nitrogen (kg/ha)
          </button>
          <button
            type="button"
            onClick={() => {
              setTrendKey('soilMoisture');
              setHoverIdx(null);
            }}
            className={`px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap cursor-pointer ${
              trendKey === 'soilMoisture'
                ? 'bg-white text-slate-900 shadow-xs font-semibold'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Soil Moisture (%)
          </button>
        </div>
      </div>

      {/* Legend strip */}
      <div className="flex flex-wrap items-center gap-5 text-[11px] text-slate-600">
        <span className="inline-flex items-center gap-1.5">
          <span className="w-4 h-0.5 bg-teal-700 inline-block" />
          <span>ML Predicted Trend ({model.label})</span>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-4 h-0 border-t-2 border-dashed border-indigo-600 inline-block" />
          <span>Historical Trial Mean Trend</span>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-indigo-500/70 inline-block" />
          <span>Historical Observations ({historicalDots.length})</span>
        </span>
        {optimalRange && (
          <span className="inline-flex items-center gap-1.5">
            <span className="w-3 h-2.5 bg-emerald-500/15 border border-emerald-500/30 inline-block" />
            <span>
              Optimal Window ({optimalRange[0]}–{optimalRange[1]} {meta.unit})
            </span>
          </span>
        )}
      </div>

      <div className="relative bg-slate-50/70 border border-slate-200 rounded-md p-2.5">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-auto cursor-crosshair"
          onMouseLeave={() => setHoverIdx(null)}
          role="img"
          aria-label={`Historical and predicted yield trend for ${crop} across ${meta.label}`}
        >
          {/* Optimal agronomic window shading */}
          {optimalRange && (
            <rect
              x={xScale(optimalRange[0])}
              y={pad.top}
              width={Math.max(2, xScale(optimalRange[1]) - xScale(optimalRange[0]))}
              height={plotH}
              fill="rgba(16, 185, 129, 0.08)"
            />
          )}

          {/* Horizontal Y gridlines */}
          {[0, 0.25, 0.5, 0.75, 1].map((t) => {
            const yVal = minY + (maxY - minY) * t;
            const yPos = yScale(yVal);
            return (
              <g key={t}>
                <line
                  x1={pad.left}
                  y1={yPos}
                  x2={width - pad.right}
                  y2={yPos}
                  stroke="#e2e8f0"
                  strokeWidth={1}
                />
                <text
                  x={pad.left - 8}
                  y={yPos}
                  textAnchor="end"
                  dominantBaseline="central"
                  className="fill-slate-500 text-[10px] font-mono tabular-nums"
                >
                  {yVal.toFixed(1)}
                </text>
              </g>
            );
          })}

          {/* Y axis unit */}
          <text
            x={14}
            y={pad.top + plotH / 2}
            textAnchor="middle"
            transform={`rotate(-90 14 ${pad.top + plotH / 2})`}
            className="fill-slate-400 text-[10px] font-mono uppercase"
          >
            Yield (t/ha)
          </text>

          {/* X axis ticks */}
          {[0, 0.25, 0.5, 0.75, 1].map((t) => {
            const xVal = meta.min + (meta.max - meta.min) * t;
            const xPos = xScale(xVal);
            return (
              <g key={t}>
                <line
                  x1={xPos}
                  y1={pad.top + plotH}
                  x2={xPos}
                  y2={pad.top + plotH + 4}
                  stroke="#94a3b8"
                  strokeWidth={1}
                />
                <text
                  x={xPos}
                  y={pad.top + plotH + 16}
                  textAnchor="middle"
                  className="fill-slate-500 text-[10px] font-mono tabular-nums"
                >
                  {Math.round(xVal)}
                </text>
              </g>
            );
          })}

          <text
            x={pad.left + plotW / 2}
            y={height - 5}
            textAnchor="middle"
            className="fill-slate-500 text-[10px] font-mono"
          >
            {meta.label} ({meta.unit})
          </text>

          {/* ML prediction confidence envelope */}
          <path d={predictedBandPath} fill="rgba(15, 118, 110, 0.11)" />

          {/* Historical field trial scatter observations */}
          {historicalDots.map((dot) => (
            <circle
              key={dot.id}
              cx={xScale(dot.x)}
              cy={yScale(dot.y)}
              r={3}
              fill="rgba(99, 102, 241, 0.45)"
              stroke="#4f46e5"
              strokeWidth={0.75}
            />
          ))}

          {/* Historical binned mean trend line */}
          {historicalTrend.length >= 2 && (
            <path
              d={historicalTrendPath}
              fill="none"
              stroke="#4f46e5"
              strokeWidth={2}
              strokeDasharray="5 4"
            />
          )}

          {/* ML Predicted yield trend line */}
          <path
            d={predictedLinePath}
            fill="none"
            stroke="#0f766e"
            strokeWidth={2.5}
          />

          {/* Current field marker line */}
          <line
            x1={currentX}
            y1={pad.top}
            x2={currentX}
            y2={pad.top + plotH}
            stroke="#d97706"
            strokeWidth={1.25}
            strokeDasharray="3 3"
          />
          <text
            x={Math.min(width - pad.right - 48, Math.max(pad.left + 48, currentX))}
            y={pad.top - 7}
            textAnchor="middle"
            className="fill-amber-700 text-[10px] font-mono font-semibold tabular-nums"
          >
            Current: {env[trendKey]} {meta.unit}
          </text>

          {/* Hover capture strips */}
          {predictedSeries.map((pt, idx) => {
            const px = xScale(pt.x);
            const py = yScale(pt.yield);
            const sliceW = plotW / predictedSeries.length;
            return (
              <g key={idx}>
                <rect
                  x={px - sliceW / 2}
                  y={pad.top}
                  width={sliceW}
                  height={plotH}
                  fill="transparent"
                  onMouseEnter={() => setHoverIdx(idx)}
                />
                {hoverIdx === idx && (
                  <>
                    <line
                      x1={px}
                      y1={pad.top}
                      x2={px}
                      y2={pad.top + plotH}
                      stroke="#64748b"
                      strokeWidth={0.75}
                    />
                    <circle
                      cx={px}
                      cy={py}
                      r={4.5}
                      fill="#0f766e"
                      stroke="#ffffff"
                      strokeWidth={1.5}
                    />
                  </>
                )}
              </g>
            );
          })}
        </svg>

        {activePoint && (
          <div className="absolute top-3 right-3 bg-white/95 border border-slate-200 rounded px-3 py-2 text-[11px] font-mono text-slate-800 shadow-xs pointer-events-none tabular-nums space-y-0.5">
            <div>
              {meta.shortLabel}: <span className="font-semibold">{activePoint.x} {meta.unit}</span>
            </div>
            <div>
              ML Pred: <span className="font-semibold text-teal-700">{activePoint.yield} t/ha</span>
            </div>
            <div className="text-slate-500">
              90% Band: {activePoint.lower}–{activePoint.upper}
            </div>
            {nearestHistoricalAvg && (
              <div className="text-indigo-700 pt-0.5 border-t border-slate-100">
                Hist. Mean (n={nearestHistoricalAvg.n}): {nearestHistoricalAvg.avg} t/ha
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
