import React, { useMemo, useState } from 'react';
import type { EnvironmentalFeatures } from '../shared/agronomyTypes.ts';
import { FEATURE_META } from '../ml/agronomyDataset.ts';
import { computeSensitivityCurve, type TrainedModel } from '../ml/mlEngine.ts';

interface SensitivityChartProps {
  model: TrainedModel;
  crop: string;
  env: EnvironmentalFeatures;
}

const SWEEP_OPTIONS: Array<keyof EnvironmentalFeatures> = [
  'rainfall',
  'nitrogen',
  'temperature',
  'ph',
  'soilMoisture',
  'potassium',
  'phosphorus',
  'solarRadiation',
];

export const SensitivityChart: React.FC<SensitivityChartProps> = ({
  model,
  crop,
  env,
}) => {
  const [sweepKey, setSweepKey] = useState<keyof EnvironmentalFeatures>('rainfall');
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const meta = FEATURE_META.find((m) => m.key === sweepKey) ?? FEATURE_META[0];

  const series = useMemo(
    () => computeSensitivityCurve(model, crop, env, sweepKey, 24),
    [model, crop, env, sweepKey]
  );

  const width = 520;
  const height = 248;
  const pad = { top: 20, right: 20, bottom: 38, left: 48 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  const yValues = series.flatMap((p) => [p.lower, p.upper]);
  const minY = Math.max(0, Math.floor(Math.min(...yValues) * 0.88));
  const maxY = Math.max(minY + 1, Math.ceil(Math.max(...yValues) * 1.08));

  const xScale = (val: number) =>
    pad.left + ((val - meta.min) / Math.max(1e-6, meta.max - meta.min)) * plotW;
  const yScale = (val: number) =>
    pad.top + plotH - ((val - minY) / Math.max(1e-6, maxY - minY)) * plotH;

  const linePath = series
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${xScale(p.x).toFixed(1)} ${yScale(p.yield).toFixed(1)}`)
    .join(' ');

  const bandPath =
    series
      .map((p, i) => `${i === 0 ? 'M' : 'L'} ${xScale(p.x).toFixed(1)} ${yScale(p.upper).toFixed(1)}`)
      .join(' ') +
    ' ' +
    [...series]
      .reverse()
      .map((p) => `L ${xScale(p.x).toFixed(1)} ${yScale(p.lower).toFixed(1)}`)
      .join(' ') +
    ' Z';

  const currentX = xScale(env[sweepKey]);
  const activePoint = hoverIdx !== null ? series[hoverIdx] : null;

  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">
            ML Yield Response Sensitivity
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Simulated {crop} yield trajectory across {meta.label.toLowerCase()}
          </p>
        </div>

        <label className="flex items-center gap-2 text-xs text-slate-600">
          <span className="whitespace-nowrap">Sweep variable:</span>
          <select
            value={sweepKey}
            onChange={(e) => setSweepKey(e.target.value as keyof EnvironmentalFeatures)}
            className="bg-white border border-slate-300 rounded px-2 py-1 text-xs font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-teal-600"
          >
            {SWEEP_OPTIONS.map((k) => {
              const m = FEATURE_META.find((item) => item.key === k)!;
              return (
                <option key={k} value={k}>
                  {m.label} ({m.unit})
                </option>
              );
            })}
          </select>
        </label>
      </div>

      <div className="relative bg-slate-50/70 border border-slate-200 rounded-md p-2">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-auto cursor-crosshair"
          onMouseLeave={() => setHoverIdx(null)}
          role="img"
          aria-label={`Yield sensitivity curve for ${crop} varying ${meta.label}`}
        >
          {/* Horizontal gridlines */}
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
            x={12}
            y={pad.top + plotH / 2}
            textAnchor="middle"
            transform={`rotate(-90 12 ${pad.top + plotH / 2})`}
            className="fill-slate-400 text-[10px] font-mono uppercase"
          >
            t/ha
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
                  {meta.key === 'ph' ? xVal.toFixed(1) : Math.round(xVal)}
                </text>
              </g>
            );
          })}

          <text
            x={pad.left + plotW / 2}
            y={height - 4}
            textAnchor="middle"
            className="fill-slate-500 text-[10px] font-mono"
          >
            {meta.label} ({meta.unit})
          </text>

          {/* Confidence interval envelope */}
          <path d={bandPath} fill="rgba(13, 148, 136, 0.12)" />

          {/* Main ML prediction line */}
          <path
            d={linePath}
            fill="none"
            stroke="#0f766e"
            strokeWidth={2.25}
          />

          {/* Current field marker line */}
          <line
            x1={currentX}
            y1={pad.top}
            x2={currentX}
            y2={pad.top + plotH}
            stroke="#d97706"
            strokeWidth={1.25}
            strokeDasharray="4 3"
          />
          <text
            x={Math.min(width - pad.right - 32, Math.max(pad.left + 32, currentX))}
            y={pad.top - 5}
            textAnchor="middle"
            className="fill-amber-700 text-[10px] font-mono font-medium"
          >
            Current: {env[sweepKey]} {meta.unit}
          </text>

          {/* Hover targets */}
          {series.map((pt, idx) => {
            const px = xScale(pt.x);
            const py = yScale(pt.yield);
            const sliceW = plotW / series.length;
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
                      r={4}
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
          <div className="absolute top-3 right-3 bg-white/95 border border-slate-200 rounded px-2.5 py-1.5 text-[11px] font-mono text-slate-800 shadow-xs pointer-events-none tabular-nums">
            <div>
              {meta.shortLabel}: <span className="font-semibold">{activePoint.x} {meta.unit}</span>
            </div>
            <div>
              Pred: <span className="font-semibold text-teal-700">{activePoint.yield} t/ha</span>
            </div>
            <div className="text-slate-500">
              Band: {activePoint.lower}–{activePoint.upper}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
