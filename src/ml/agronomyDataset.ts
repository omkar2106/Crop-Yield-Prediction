import type { CropRecord, EnvironmentalFeatures } from '../shared/agronomyTypes.ts';

export interface CropOptimalEnvelope {
  crop: string;
  maxPotentialYield: number; // tons/ha under ideal field conditions
  baseYield: number; // baseline yield under average conditions
  harvestUnitNote: string;
  optimal: {
    [K in keyof EnvironmentalFeatures]: [number, number];
  };
  weights: {
    [K in keyof EnvironmentalFeatures]: number;
  };
}

export const FEATURE_META: Array<{
  key: keyof EnvironmentalFeatures;
  label: string;
  shortLabel: string;
  unit: string;
  min: number;
  max: number;
  step: number;
}> = [
  { key: 'nitrogen', label: 'Nitrogen (N)', shortLabel: 'N', unit: 'kg/ha', min: 0, max: 220, step: 1 },
  { key: 'phosphorus', label: 'Phosphorus (P₂O₅)', shortLabel: 'P', unit: 'kg/ha', min: 0, max: 140, step: 1 },
  { key: 'potassium', label: 'Potassium (K₂O)', shortLabel: 'K', unit: 'kg/ha', min: 0, max: 220, step: 1 },
  { key: 'ph', label: 'Soil pH (H₂O)', shortLabel: 'pH', unit: 'pH', min: 4.0, max: 9.0, step: 0.1 },
  { key: 'organicCarbon', label: 'Organic Carbon', shortLabel: 'SOC', unit: 'g/kg', min: 2, max: 45, step: 0.5 },
  { key: 'soilMoisture', label: 'Soil Moisture', shortLabel: 'Moist', unit: '%', min: 5, max: 65, step: 0.5 },
  { key: 'temperature', label: 'Mean Temperature', shortLabel: 'Temp', unit: '°C', min: 6, max: 42, step: 0.5 },
  { key: 'humidity', label: 'Relative Humidity', shortLabel: 'RH', unit: '%', min: 15, max: 98, step: 1 },
  { key: 'rainfall', label: 'Seasonal Rainfall', shortLabel: 'Rain', unit: 'mm', min: 80, max: 2600, step: 10 },
  { key: 'solarRadiation', label: 'Solar Radiation', shortLabel: 'Solar', unit: 'MJ/m²/d', min: 8, max: 28, step: 0.5 },
];

export const CROP_PROFILES: Record<string, CropOptimalEnvelope> = {
  Rice: {
    crop: 'Rice',
    maxPotentialYield: 8.6,
    baseYield: 5.2,
    harvestUnitNote: 'Paddy grain dry weight',
    optimal: {
      nitrogen: [90, 150],
      phosphorus: [40, 75],
      potassium: [40, 80],
      ph: [5.4, 6.9],
      organicCarbon: [12, 28],
      soilMoisture: [34, 56],
      temperature: [22, 31],
      humidity: [68, 90],
      rainfall: [1050, 1950],
      solarRadiation: [16, 23],
    },
    weights: {
      nitrogen: 0.22,
      phosphorus: 0.08,
      potassium: 0.08,
      ph: 0.1,
      organicCarbon: 0.08,
      soilMoisture: 0.14,
      temperature: 0.12,
      humidity: 0.05,
      rainfall: 0.09,
      solarRadiation: 0.04,
    },
  },
  Wheat: {
    crop: 'Wheat',
    maxPotentialYield: 7.4,
    baseYield: 4.5,
    harvestUnitNote: 'Harvested grain at 13% moisture',
    optimal: {
      nitrogen: [85, 145],
      phosphorus: [45, 80],
      potassium: [35, 70],
      ph: [6.0, 7.6],
      organicCarbon: [10, 26],
      soilMoisture: [22, 38],
      temperature: [13, 22],
      humidity: [45, 72],
      rainfall: [420, 850],
      solarRadiation: [15, 24],
    },
    weights: {
      nitrogen: 0.23,
      phosphorus: 0.1,
      potassium: 0.07,
      ph: 0.11,
      organicCarbon: 0.08,
      soilMoisture: 0.12,
      temperature: 0.15,
      humidity: 0.03,
      rainfall: 0.07,
      solarRadiation: 0.04,
    },
  },
  Maize: {
    crop: 'Maize',
    maxPotentialYield: 10.8,
    baseYield: 6.4,
    harvestUnitNote: 'Shelled grain at 15% moisture',
    optimal: {
      nitrogen: [105, 175],
      phosphorus: [45, 85],
      potassium: [50, 100],
      ph: [5.8, 7.2],
      organicCarbon: [12, 30],
      soilMoisture: [24, 42],
      temperature: [20, 29],
      humidity: [52, 78],
      rainfall: [550, 1100],
      solarRadiation: [18, 26],
    },
    weights: {
      nitrogen: 0.24,
      phosphorus: 0.09,
      potassium: 0.09,
      ph: 0.09,
      organicCarbon: 0.08,
      soilMoisture: 0.11,
      temperature: 0.11,
      humidity: 0.03,
      rainfall: 0.08,
      solarRadiation: 0.08,
    },
  },
  Soybean: {
    crop: 'Soybean',
    maxPotentialYield: 4.4,
    baseYield: 2.7,
    harvestUnitNote: 'Dry seed yield',
    optimal: {
      nitrogen: [25, 65],
      phosphorus: [45, 85],
      potassium: [50, 95],
      ph: [6.0, 7.0],
      organicCarbon: [12, 28],
      soilMoisture: [23, 39],
      temperature: [20, 28],
      humidity: [55, 78],
      rainfall: [520, 950],
      solarRadiation: [17, 25],
    },
    weights: {
      nitrogen: 0.07,
      phosphorus: 0.18,
      potassium: 0.16,
      ph: 0.14,
      organicCarbon: 0.09,
      soilMoisture: 0.12,
      temperature: 0.11,
      humidity: 0.03,
      rainfall: 0.06,
      solarRadiation: 0.04,
    },
  },
  Cotton: {
    crop: 'Cotton',
    maxPotentialYield: 4.8,
    baseYield: 2.6,
    harvestUnitNote: 'Seed cotton lint + seed yield',
    optimal: {
      nitrogen: [75, 130],
      phosphorus: [35, 70],
      potassium: [55, 105],
      ph: [6.0, 8.0],
      organicCarbon: [8, 22],
      soilMoisture: [18, 34],
      temperature: [24, 33],
      humidity: [40, 68],
      rainfall: [500, 950],
      solarRadiation: [20, 27],
    },
    weights: {
      nitrogen: 0.18,
      phosphorus: 0.08,
      potassium: 0.14,
      ph: 0.1,
      organicCarbon: 0.06,
      soilMoisture: 0.11,
      temperature: 0.14,
      humidity: 0.04,
      rainfall: 0.07,
      solarRadiation: 0.08,
    },
  },
  Sugarcane: {
    crop: 'Sugarcane',
    maxPotentialYield: 102.0,
    baseYield: 68.0,
    harvestUnitNote: 'Millable fresh cane biomass',
    optimal: {
      nitrogen: [120, 195],
      phosphorus: [50, 90],
      potassium: [90, 165],
      ph: [5.8, 7.6],
      organicCarbon: [14, 34],
      soilMoisture: [30, 50],
      temperature: [24, 33],
      humidity: [60, 85],
      rainfall: [1100, 2100],
      solarRadiation: [18, 26],
    },
    weights: {
      nitrogen: 0.2,
      phosphorus: 0.08,
      potassium: 0.16,
      ph: 0.08,
      organicCarbon: 0.07,
      soilMoisture: 0.14,
      temperature: 0.11,
      humidity: 0.04,
      rainfall: 0.08,
      solarRadiation: 0.04,
    },
  },
  Potato: {
    crop: 'Potato',
    maxPotentialYield: 42.0,
    baseYield: 25.0,
    harvestUnitNote: 'Fresh tuber weight',
    optimal: {
      nitrogen: [95, 160],
      phosphorus: [60, 105],
      potassium: [110, 185],
      ph: [5.2, 6.4],
      organicCarbon: [16, 36],
      soilMoisture: [26, 42],
      temperature: [14, 22],
      humidity: [55, 80],
      rainfall: [480, 850],
      solarRadiation: [15, 23],
    },
    weights: {
      nitrogen: 0.17,
      phosphorus: 0.13,
      potassium: 0.2,
      ph: 0.11,
      organicCarbon: 0.08,
      soilMoisture: 0.11,
      temperature: 0.12,
      humidity: 0.02,
      rainfall: 0.04,
      solarRadiation: 0.02,
    },
  },
  Sorghum: {
    crop: 'Sorghum',
    maxPotentialYield: 6.2,
    baseYield: 3.4,
    harvestUnitNote: 'Dry grain yield',
    optimal: {
      nitrogen: [60, 115],
      phosphorus: [30, 65],
      potassium: [35, 75],
      ph: [5.8, 8.2],
      organicCarbon: [7, 20],
      soilMoisture: [14, 30],
      temperature: [24, 34],
      humidity: [32, 65],
      rainfall: [340, 720],
      solarRadiation: [19, 27],
    },
    weights: {
      nitrogen: 0.21,
      phosphorus: 0.09,
      potassium: 0.08,
      ph: 0.09,
      organicCarbon: 0.07,
      soilMoisture: 0.14,
      temperature: 0.12,
      humidity: 0.03,
      rainfall: 0.11,
      solarRadiation: 0.06,
    },
  },
};

const REGIONS = [
  'Indo-Gangetic Plain',
  'Mekong Delta',
  'US Midwest Corn Belt',
  'Deccan Plateau',
  'Pampas Humid',
  'Nile Delta',
  'North China Plain',
  'Murray-Darling Basin',
  'Cerrado Savanna',
  'Po Valley',
];

function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function responseCurve(value: number, optMin: number, optMax: number, spanScale = 0.65): number {
  if (value >= optMin && value <= optMax) {
    return 1.0;
  }
  const width = Math.max(1e-3, optMax - optMin);
  const dist = value < optMin ? optMin - value : value - optMax;
  const norm = dist / (width * spanScale + optMin * 0.15);
  return Math.exp(-0.85 * norm * norm);
}

export function computeAgronomicPotential(
  crop: string,
  features: EnvironmentalFeatures
): number {
  const profile = CROP_PROFILES[crop] ?? CROP_PROFILES.Maize;
  let weightedSum = 0;
  let minFactor = 1.0;
  const keys = Object.keys(profile.weights) as Array<keyof EnvironmentalFeatures>;

  for (const key of keys) {
    const [optMin, optMax] = profile.optimal[key];
    const score = responseCurve(features[key], optMin, optMax);
    weightedSum += score * profile.weights[key];
    if (score < minFactor) {
      minFactor = score;
    }
  }

  // Liebig's Law of the Minimum blended with multiplicative stress interaction
  const liebigPenalty = 0.68 + 0.32 * minFactor;
  const raw = profile.maxPotentialYield * (0.28 + 0.72 * weightedSum) * liebigPenalty;
  return Math.max(0.25, raw);
}

function generateBuiltInDataset(): CropRecord[] {
  const rand = createRng(20261116);
  const crops = Object.keys(CROP_PROFILES);
  const records: CropRecord[] = [];
  let idx = 1;

  for (const crop of crops) {
    const profile = CROP_PROFILES[crop];
    // 26 varied samples per crop = 208 records spanning optimal, moderate, and stress conditions
    for (let i = 0; i < 26; i++) {
      const regime = i < 10 ? 'optimal' : i < 19 ? 'moderate' : 'stress';
      const spread = regime === 'optimal' ? 0.15 : regime === 'moderate' ? 0.45 : 0.9;

      const sampleVal = (key: keyof EnvironmentalFeatures, absMin: number, absMax: number): number => {
        const [optMin, optMax] = profile.optimal[key];
        const center = (optMin + optMax) / 2;
        const halfWidth = (optMax - optMin) / 2;
        const jitter = (rand() * 2 - 1) * halfWidth * (1 + spread * 1.4);
        return Number(clamp(center + jitter, absMin, absMax).toFixed(key === 'ph' ? 2 : 1));
      };

      const env: EnvironmentalFeatures = {
        nitrogen: sampleVal('nitrogen', 12, 215),
        phosphorus: sampleVal('phosphorus', 8, 135),
        potassium: sampleVal('potassium', 15, 215),
        ph: sampleVal('ph', 4.3, 8.7),
        organicCarbon: sampleVal('organicCarbon', 3, 42),
        soilMoisture: sampleVal('soilMoisture', 8, 62),
        temperature: sampleVal('temperature', 8, 40),
        humidity: sampleVal('humidity', 20, 96),
        rainfall: sampleVal('rainfall', 140, 2500),
        solarRadiation: sampleVal('solarRadiation', 9, 27),
      };

      const baseYield = computeAgronomicPotential(crop, env);
      const noise = 1 + (rand() * 2 - 1) * 0.045; // ±4.5% real-world field variance
      const yieldTonsPerHa = Number(Math.max(0.2, baseYield * noise).toFixed(2));
      const region = REGIONS[(idx + i) % REGIONS.length];

      records.push({
        id: `REC-${String(idx).padStart(3, '0')}`,
        crop,
        region,
        ...env,
        yieldTonsPerHa,
      });
      idx++;
    }
  }
  return records;
}

export const BUILT_IN_DATASET: CropRecord[] = generateBuiltInDataset();

export function datasetToCsv(records: CropRecord[]): string {
  const headers = [
    'id',
    'crop',
    'region',
    'nitrogen',
    'phosphorus',
    'potassium',
    'ph',
    'organicCarbon',
    'soilMoisture',
    'temperature',
    'humidity',
    'rainfall',
    'solarRadiation',
    'yieldTonsPerHa',
  ];
  const lines = [headers.join(',')];
  for (const r of records) {
    lines.push(
      [
        r.id,
        `"${r.crop}"`,
        `"${r.region}"`,
        r.nitrogen,
        r.phosphorus,
        r.potassium,
        r.ph,
        r.organicCarbon,
        r.soilMoisture,
        r.temperature,
        r.humidity,
        r.rainfall,
        r.solarRadiation,
        r.yieldTonsPerHa,
      ].join(',')
    );
  }
  return lines.join('\n');
}

function splitCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

export function parseUploadedCsv(csvText: string): {
  records: CropRecord[];
  warnings: string[];
} {
  const rawLines = csvText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (rawLines.length < 12) {
    throw new Error('CSV must include a header row and at least 11 data rows for train/test splitting.');
  }

  const headerCells = splitCsvLine(rawLines[0]).map((h) => h.toLowerCase().replace(/[^a-z0-9]/g, ''));
  const findCol = (aliases: string[]): number => {
    for (const alias of aliases) {
      const idx = headerCells.indexOf(alias);
      if (idx !== -1) return idx;
    }
    return -1;
  };

  const colCrop = findCol(['crop', 'croptype', 'label', 'species']);
  const colRegion = findCol(['region', 'area', 'location', 'state', 'country']);
  const colN = findCol(['nitrogen', 'n', 'soiln']);
  const colP = findCol(['phosphorus', 'p', 'p2o5', 'soilp']);
  const colK = findCol(['potassium', 'k', 'k2o', 'soilk']);
  const colPh = findCol(['ph', 'soilph', 'phh2o']);
  const colSoc = findCol(['organiccarbon', 'soc', 'carbon', 'oc']);
  const colMoist = findCol(['soilmoisture', 'moisture', 'sm']);
  const colTemp = findCol(['temperature', 'temp', 'meantemp', 'tavg']);
  const colHum = findCol(['humidity', 'rh', 'relativehumidity']);
  const colRain = findCol(['rainfall', 'precipitation', 'rain', 'precip']);
  const colSolar = findCol(['solarradiation', 'solar', 'radiation', 'srad']);
  const colYield = findCol(['yieldtonsperha', 'yield', 'production', 'cropyield', 'target']);

  if (colYield === -1) {
    throw new Error('CSV must include a yield target column (e.g., "yield", "yieldTonsPerHa", or "cropYield").');
  }

  const warnings: string[] = [];
  if (colSoc === -1) warnings.push('Organic carbon column not found; defaulted to 14 g/kg.');
  if (colMoist === -1) warnings.push('Soil moisture column not found; defaulted to 28%.');
  if (colSolar === -1) warnings.push('Solar radiation column not found; defaulted to 19 MJ/m²/day.');

  const numAt = (cells: string[], idx: number, fallback: number): number => {
    if (idx === -1 || idx >= cells.length) return fallback;
    const val = Number.parseFloat(cells[idx]);
    return Number.isFinite(val) ? val : fallback;
  };

  const records: CropRecord[] = [];
  for (let i = 1; i < rawLines.length; i++) {
    const cells = splitCsvLine(rawLines[i]);
    const y = numAt(cells, colYield, NaN);
    if (!Number.isFinite(y) || y <= 0) continue;

    records.push({
      id: `CSV-${String(records.length + 1).padStart(3, '0')}`,
      crop: colCrop !== -1 && cells[colCrop] ? cells[colCrop] : 'Maize',
      region: colRegion !== -1 && cells[colRegion] ? cells[colRegion] : 'Uploaded Dataset',
      nitrogen: numAt(cells, colN, 85),
      phosphorus: numAt(cells, colP, 45),
      potassium: numAt(cells, colK, 55),
      ph: numAt(cells, colPh, 6.5),
      organicCarbon: numAt(cells, colSoc, 14),
      soilMoisture: numAt(cells, colMoist, 28),
      temperature: numAt(cells, colTemp, 24),
      humidity: numAt(cells, colHum, 65),
      rainfall: numAt(cells, colRain, 780),
      solarRadiation: numAt(cells, colSolar, 19),
      yieldTonsPerHa: Number(y.toFixed(3)),
    });
  }

  if (records.length < 10) {
    throw new Error('Fewer than 10 valid numeric yield rows found in CSV.');
  }

  return { records, warnings };
}
