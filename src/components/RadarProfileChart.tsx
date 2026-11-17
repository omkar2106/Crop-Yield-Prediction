import React from 'react';
import type { EnvironmentalFeatures } from '../shared/agronomyTypes.ts';
import { CROP_PROFILES, FEATURE_META } from '../ml/agronomyDataset.ts';

interface RadarProfileChartProps {
  crop: string;
  env: EnvironmentalFeatures;
}

const AXES_KEYS: Array<keyof EnvironmentalFeatures> = [
  'nitrogen',
  'phosphorus',
  'potassium',
  'ph',
  'soilMoisture',
  'temperature',
  'rainfall',
  'solarRadiation',
];

export const RadarProfileChart: React.FC<RadarProfileChartProps> = ({ crop, env }) => {
  const profile = CROP_PROFILES[crop] ?? CROP_PROFILES.Maize;
  const size = 320;
  const cx = size / 2;
  const cy = size / 2;
  const radius = 104;
  const rings = [0.25, 0.5, 0.75, 1.0];

  const getPoint = (axisIdx: number, normVal: number): [number, number] => {
    const angle = (Math.PI * 2 * axisIdx) / AXES_KEYS.length - Math.PI / 2;
    const r = Math.max(0.06, Math.min(1.05, normVal)) * radius;
    return [cx + Math.cos(angle) * r, cy + Math.sin(angle) * r];
  };

  const currentPoints: Array<[number, number]> = [];
  const optMinPoints: Array<[number, number]> = [];
  const optMaxPoints: Array<[number, number]> = [];

  AXES_KEYS.forEach((key, idx) => {
    const meta = FEATURE_META.find((m) => m.key === key)!;
    const span = meta.max - meta.min;
    const normCurrent = (env[key] - meta.min) / span;
    const [optLow, optHigh] = profile.optimal[key];
    const normLow = (optLow - meta.min) / span;
    const normHigh = (optHigh - meta.min) / span;

    currentPoints.push(getPoint(idx, normCurrent));
    optMinPoints.push(getPoint(idx, normLow));
    optMaxPoints.push(getPoint(idx, normHigh));
  });

  const toPath = (pts: Array<[number, number]>) =>
    pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ') + ' Z';

  // Annular ring between optMax and optMin using evenodd fill rule
  const bandPath = `${toPath(optMaxPoints)} ${toPath([...optMinPoints].reverse())}`;

  return (
    <div className="flex flex-col">
      <div className="flex items-baseline justify-between mb-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">
            Soil &amp; Climate Calibration Radar
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Normalized field vector vs. {crop} optimal envelope
          </p>
        </div>
        <div className="flex items-center gap-4 text-xs text-slate-600 font-mono">
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 bg-teal-600/20 border border-teal-700" />
            Field
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 bg-amber-500/20 border border-amber-500 border-dashed" />
            Optimal
          </span>
        </div>
      </div>

      <div className="flex items-center justify-center bg-slate-50/70 border border-slate-200 rounded-md py-3">
        <svg
          viewBox={`0 0 ${size} ${size}`}
          className="w-full max-w-[300px] h-auto"
          role="img"
          aria-label={`Radar chart comparing field telemetry against ${crop} optimal envelope`}
        >
          {/* Concentric octagonal grids */}
          {rings.map((rVal) => {
            const pts = AXES_KEYS.map((_, idx) => getPoint(idx, rVal));
            return (
              <path
                key={rVal}
                d={toPath(pts)}
                fill="none"
                stroke="#cbd5e1"
                strokeWidth={0.75}
                strokeDasharray={rVal < 1 ? '2 2' : undefined}
              />
            );
          })}

          {/* Radial axes */}
          {AXES_KEYS.map((key, idx) => {
            const [x2, y2] = getPoint(idx, 1.0);
            const [lx, ly] = getPoint(idx, 1.22);
            const meta = FEATURE_META.find((m) => m.key === key)!;
            return (
              <g key={key}>
                <line
                  x1={cx}
                  y1={cy}
                  x2={x2}
                  y2={y2}
                  stroke="#cbd5e1"
                  strokeWidth={0.75}
                />
                <text
                  x={lx}
                  y={ly}
                  textAnchor="middle"
                  dominantBaseline="central"
                  className="fill-slate-600 text-[10px] font-mono uppercase"
                >
                  {meta.shortLabel}
                </text>
              </g>
            );
          })}

          {/* Optimal envelope band */}
          <path
            d={bandPath}
            fill="rgba(245, 158, 11, 0.14)"
            fillRule="evenodd"
            stroke="#d97706"
            strokeWidth={1}
            strokeDasharray="3 2"
          />

          {/* Current field profile */}
          <path
            d={toPath(currentPoints)}
            fill="rgba(13, 148, 136, 0.18)"
            stroke="#0f766e"
            strokeWidth={2}
          />

          {currentPoints.map(([px, py], idx) => (
            <circle
              key={AXES_KEYS[idx]}
              cx={px}
              cy={py}
              r={3}
              fill="#0f766e"
              stroke="#ffffff"
              strokeWidth={1.25}
            />
          ))}
        </svg>
      </div>
    </div>
  );
};
