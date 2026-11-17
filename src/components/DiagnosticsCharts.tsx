import React, { useState } from 'react';
import type {
  DailyTelemetryPoint,
  FeatureImportanceItem,
  TestPredictionPoint,
} from '../shared/agronomyTypes.ts';

export const ActualVsPredictedChart: React.FC<{
  points: TestPredictionPoint[];
  modelLabel: string;
}> = ({ points, modelLabel }) => {
  const [hovered, setHovered] = useState<TestPredictionPoint | null>(null);
  const width = 460;
  const height = 280;
  const pad = { top: 20, right: 20, bottom: 38, left: 48 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  const maxVal = Math.max(
    10,
    ...points.flatMap((p) => [p.actual, p.predicted])
  ) * 1.06;

  const xScale = (v: number) => pad.left + (v / maxVal) * plotW;
  const yScale = (v: number) => pad.top + plotH - (v / maxVal) * plotH;

  return (
    <div className="flex flex-col">
      <div className="flex items-baseline justify-between mb-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">
            Test Set Parity: Actual vs. Predicted Yield
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Held-out 20% validation split ({points.length} samples) · {modelLabel}
          </p>
        </div>
        <span className="text-xs font-mono text-slate-500">Dashed = y = x</span>
      </div>

      <div className="relative bg-slate-50/70 border border-slate-200 rounded-md p-2">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-auto"
          onMouseLeave={() => setHovered(null)}
          role="img"
          aria-label="Scatter plot of actual versus predicted crop yield on test split"
        >
          {[0, 0.25, 0.5, 0.75, 1].map((t) => {
            const val = maxVal * t;
            const xPos = xScale(val);
            const yPos = yScale(val);
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
                <line
                  x1={xPos}
                  y1={pad.top}
                  x2={xPos}
                  y2={pad.top + plotH}
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
                  {val.toFixed(0)}
                </text>
                <text
                  x={xPos}
                  y={pad.top + plotH + 15}
                  textAnchor="middle"
                  className="fill-slate-500 text-[10px] font-mono tabular-nums"
                >
                  {val.toFixed(0)}
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
            Actual Yield (t/ha)
          </text>
          <text
            x={12}
            y={pad.top + plotH / 2}
            textAnchor="middle"
            transform={`rotate(-90 12 ${pad.top + plotH / 2})`}
            className="fill-slate-500 text-[10px] font-mono"
          >
            Predicted (t/ha)
          </text>

          {/* Identity line y = x */}
          <line
            x1={xScale(0)}
            y1={yScale(0)}
            x2={xScale(maxVal)}
            y2={yScale(maxVal)}
            stroke="#64748b"
            strokeWidth={1.25}
            strokeDasharray="4 3"
          />

          {points.map((pt, i) => {
            const cx = xScale(pt.actual);
            const cy = yScale(pt.predicted);
            const isActive = hovered === pt;
            return (
              <circle
                key={i}
                cx={cx}
                cy={cy}
                r={isActive ? 5.5 : 3.8}
                fill={isActive ? '#d97706' : 'rgba(15, 118, 110, 0.72)'}
                stroke="#ffffff"
                strokeWidth={1}
                className="cursor-pointer transition-transform duration-150"
                onMouseEnter={() => setHovered(pt)}
              />
            );
          })}
        </svg>

        {hovered && (
          <div className="absolute top-3 right-3 bg-white/95 border border-slate-200 rounded px-2.5 py-1.5 text-[11px] font-mono text-slate-800 shadow-xs pointer-events-none tabular-nums">
            <div className="font-semibold text-slate-900">{hovered.crop} · {hovered.region}</div>
            <div>Actual: {hovered.actual} t/ha</div>
            <div>Predicted: {hovered.predicted} t/ha</div>
            <div className={Math.abs(hovered.residual) > 2 ? 'text-amber-700' : 'text-teal-700'}>
              Error: {hovered.residual >= 0 ? '+' : ''}{hovered.residual} t/ha
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export const FeatureImportanceChart: React.FC<{
  items: FeatureImportanceItem[];
}> = ({ items }) => {
  const maxPct = Math.max(15, ...items.map((i) => i.importancePct));

  return (
    <div className="flex flex-col">
      <div className="flex items-baseline justify-between mb-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">
            Learned Feature Importance
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Relative contribution of soil, weather &amp; crop variables
          </p>
        </div>
        <span className="text-xs font-mono text-slate-500">% salience</span>
      </div>

      <div className="bg-slate-50/70 border border-slate-200 rounded-md p-3.5 space-y-2.5">
        {items.map((item) => {
          const widthPct = Math.max(2, (item.importancePct / maxPct) * 100);
          return (
            <div key={item.feature} className="grid grid-cols-12 items-center gap-2 text-xs">
              <div className="col-span-5 truncate text-slate-700 font-medium" title={item.label}>
                {item.label}
              </div>
              <div className="col-span-5 h-2.5 bg-slate-200/80 rounded-xs overflow-hidden">
                <div
                  className="h-full bg-teal-700 transition-all duration-200"
                  style={{ width: `${widthPct}%` }}
                />
              </div>
              <div className="col-span-2 text-right font-mono tabular-nums text-slate-800">
                {item.importancePct.toFixed(1)}%
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export const WeatherTelemetryChart: React.FC<{
  series: DailyTelemetryPoint[];
}> = ({ series }) => {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  if (series.length === 0) return null;

  const width = 760;
  const height = 240;
  const pad = { top: 22, right: 48, bottom: 36, left: 44 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  const minTemp = Math.floor(Math.min(...series.map((s) => s.tempMin)) - 2);
  const maxTemp = Math.ceil(Math.max(...series.map((s) => s.tempMax)) + 2);
  const maxRain = Math.max(20, Math.ceil(Math.max(...series.map((s) => s.precipitationMm)) * 1.25));

  const xPos = (i: number) =>
    pad.left + (i / Math.max(1, series.length - 1)) * plotW;
  const yTemp = (t: number) =>
    pad.top + plotH - ((t - minTemp) / Math.max(1, maxTemp - minTemp)) * plotH;
  const yMoist = (m: number) =>
    pad.top + plotH - (Math.min(65, Math.max(0, m)) / 65) * plotH;
  const yRainH = (r: number) => (r / maxRain) * (plotH * 0.65);

  const maxLine = series
    .map((s, i) => `${i === 0 ? 'M' : 'L'} ${xPos(i).toFixed(1)} ${yTemp(s.tempMax).toFixed(1)}`)
    .join(' ');
  const minLine = series
    .map((s, i) => `${i === 0 ? 'M' : 'L'} ${xPos(i).toFixed(1)} ${yTemp(s.tempMin).toFixed(1)}`)
    .join(' ');
  const moistLine = series
    .map((s, i) => `${i === 0 ? 'M' : 'L'} ${xPos(i).toFixed(1)} ${yMoist(s.soilMoisturePct).toFixed(1)}`)
    .join(' ');

  const active = hoverIdx !== null ? series[hoverIdx] : null;

  return (
    <div className="relative bg-slate-50/70 border border-slate-200 rounded-md p-3">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <span className="text-xs font-medium text-slate-700">
          14-Day Observed &amp; Forecast Window (Past 7d + Next 7d)
        </span>
        <div className="flex items-center gap-4 text-[11px] font-mono text-slate-600">
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-0.5 bg-amber-600" />
            Max/Min Temp (°C)
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-0.5 bg-teal-700" />
            Soil Moisture (%)
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 bg-sky-500/35 border border-sky-600/50" />
            Rain (mm)
          </span>
        </div>
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-auto cursor-crosshair"
        onMouseLeave={() => setHoverIdx(null)}
        role="img"
        aria-label="14-day weather and root-zone soil moisture telemetry chart"
      >
        {[0, 0.33, 0.66, 1].map((t) => {
          const tempTick = minTemp + (maxTemp - minTemp) * t;
          const moistTick = 65 * t;
          const y = pad.top + plotH - t * plotH;
          return (
            <g key={t}>
              <line
                x1={pad.left}
                y1={y}
                x2={width - pad.right}
                y2={y}
                stroke="#e2e8f0"
                strokeWidth={1}
              />
              <text
                x={pad.left - 8}
                y={y}
                textAnchor="end"
                dominantBaseline="central"
                className="fill-slate-500 text-[10px] font-mono tabular-nums"
              >
                {tempTick.toFixed(0)}°
              </text>
              <text
                x={width - pad.right + 8}
                y={y}
                textAnchor="start"
                dominantBaseline="central"
                className="fill-teal-700 text-[10px] font-mono tabular-nums"
              >
                {moistTick.toFixed(0)}%
              </text>
            </g>
          );
        })}

        {/* Precipitation bars */}
        {series.map((s, i) => {
          const barH = yRainH(s.precipitationMm);
          const barW = Math.max(8, plotW / series.length - 8);
          return (
            <rect
              key={`rain-${s.date}`}
              x={xPos(i) - barW / 2}
              y={pad.top + plotH - barH}
              width={barW}
              height={barH}
              fill="rgba(14, 165, 233, 0.28)"
              stroke="rgba(2, 132, 199, 0.45)"
              strokeWidth={0.75}
            />
          );
        })}

        {/* Temperature & Soil moisture curves */}
        <path d={maxLine} fill="none" stroke="#d97706" strokeWidth={2} />
        <path d={minLine} fill="none" stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="3 2" />
        <path d={moistLine} fill="none" stroke="#0f766e" strokeWidth={2} />

        {/* X axis date labels */}
        {series.map((s, i) => {
          const showLabel = i === 0 || i === 7 || i === series.length - 1 || i % 3 === 0;
          const sliceW = plotW / series.length;
          return (
            <g key={s.date}>
              {showLabel && (
                <text
                  x={xPos(i)}
                  y={pad.top + plotH + 16}
                  textAnchor="middle"
                  className="fill-slate-500 text-[10px] font-mono tabular-nums"
                >
                  {s.date.slice(5)}
                </text>
              )}
              <rect
                x={xPos(i) - sliceW / 2}
                y={pad.top}
                width={sliceW}
                height={plotH}
                fill="transparent"
                onMouseEnter={() => setHoverIdx(i)}
              />
              {hoverIdx === i && (
                <line
                  x1={xPos(i)}
                  y1={pad.top}
                  x2={xPos(i)}
                  y2={pad.top + plotH}
                  stroke="#475569"
                  strokeWidth={1}
                />
              )}
            </g>
          );
        })}
      </svg>

      {active && (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-4 border-t border-slate-200 pt-2 text-xs font-mono tabular-nums text-slate-700">
          <span>Date: <strong>{active.date}</strong></span>
          <span>Temp: <strong>{active.tempMin}°C – {active.tempMax}°C</strong></span>
          <span>Rain: <strong>{active.precipitationMm} mm</strong></span>
          <span>Root Moisture: <strong className="text-teal-700">{active.soilMoisturePct}%</strong></span>
          <span>Solar: <strong>{active.solarRadiationMj} MJ/m²</strong></span>
          <span>ET₀: <strong>{active.et0Mm} mm/d</strong></span>
        </div>
      )}
    </div>
  );
};
