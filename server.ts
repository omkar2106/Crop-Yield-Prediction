import 'dotenv/config';
import http from 'node:http';
import express, { type Request, type Response } from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import { GoogleGenAI, Modality, type LiveServerMessage } from '@google/genai';
import type {
  AgronomyResearchResponse,
  DailyTelemetryPoint,
  GeoLocationResult,
  GroundedSourceLink,
  LiveEnvironmentBundle,
  MapsGroundingResponse,
  MapsPlaceGroundingItem,
} from './src/shared/agronomyTypes.ts';
import { requireAuth, type AuthRequest } from './src/middleware/auth.ts';
import { adminAuth } from './src/lib/firebase-admin.ts';
import {
  deletePredictionRecord,
  listUserPredictions,
  listUserVoiceNotes,
  savePredictionRecord,
  saveVoiceNote,
  type SavePredictionInput,
} from './src/db/repository.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;

function createAiClient(apiKey: string): GoogleGenAI {
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function classifyUsdaTexture(clay: number, sand: number, silt: number): string {
  if (clay >= 40) {
    if (silt >= 40) return 'Silty Clay';
    if (sand >= 45) return 'Sandy Clay';
    return 'Clay';
  }
  if (clay >= 27) {
    if (sand >= 20 && sand <= 45) return 'Clay Loam';
    if (sand < 20) return 'Silty Clay Loam';
    return 'Sandy Clay Loam';
  }
  if (sand >= 85) return 'Sand';
  if (sand >= 70) return 'Loamy Sand';
  if (silt >= 50 && clay < 27) {
    return clay < 12 && silt >= 80 ? 'Silt' : 'Silt Loam';
  }
  if (sand >= 43 && clay < 20) return 'Sandy Loam';
  return 'Loam';
}

function estimateNpkFromSoil(
  socGKg: number,
  totalNGKg: number | null,
  cecCmolKg: number,
  clayPct: number,
  ph: number
): { n: number; p: number; k: number } {
  // Topsoil 0-15cm bulk weight ~ 2,000,000 kg/ha; plant-available mineralized N ~ 1.8% of total N
  const availableN =
    totalNGKg !== null && totalNGKg > 0
      ? Math.round(Math.min(190, Math.max(22, totalNGKg * 2000 * 0.018 + socGKg * 1.1)))
      : Math.round(Math.min(180, Math.max(25, socGKg * 4.5 + 32)));

  // Phosphorus availability peaks around pH 6.2 - 7.0 and scales with organic matter mineralization
  const phFactor = Math.exp(-0.45 * Math.pow(ph - 6.5, 2));
  const availableP = Math.round(
    Math.min(110, Math.max(16, (22 + socGKg * 1.45) * (0.65 + 0.45 * phFactor)))
  );

  // Exchangeable potassium correlates strongly with CEC and illite/clay fraction
  const availableK = Math.round(
    Math.min(195, Math.max(24, cecCmolKg * 2.4 + clayPct * 1.15 + socGKg * 0.9))
  );

  return { n: availableN, p: availableP, k: availableK };
}

function getSoilGridsMean(
  layers: Array<{
    name: string;
    depths?: Array<{ label: string; values?: { mean?: number | null } }>;
  }>,
  propName: string
): number | null {
  const layer = layers.find((l) => l.name === propName);
  if (!layer || !layer.depths || layer.depths.length === 0) return null;
  const vals = layer.depths
    .map((d) => d.values?.mean)
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  if (vals.length === 0) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function formatDateIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

async function createServer() {
  const app = express();
  app.use(express.json({ limit: '10mb' }));

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  app.get('/api/config/maps', (_req: Request, res: Response) => {
    const apiKey =
      process.env.VITE_GOOGLE_MAPS_API_KEY ||
      process.env.GOOGLE_MAPS_API_KEY ||
      '';
    res.json({ apiKey });
  });

  // 1. Live Internet Geocoding via Open-Meteo
  app.get('/api/env/search', async (req: Request, res: Response) => {
    try {
      const q = String(req.query.q ?? '').trim();
      if (q.length < 2) {
        res.status(400).json({ error: 'Search query must be at least 2 characters.' });
        return;
      }

      const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(
        q
      )}&count=6&language=en&format=json`;
      const upstream = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!upstream.ok) {
        throw new Error(`Geocoding service returned HTTP ${upstream.status}`);
      }
      const data = (await upstream.json()) as {
        results?: Array<{
          id: number;
          name: string;
          latitude: number;
          longitude: number;
          elevation?: number;
          country?: string;
          admin1?: string;
          timezone?: string;
        }>;
      };

      const results: GeoLocationResult[] = (data.results ?? []).map((r) => ({
        id: r.id,
        name: r.name,
        latitude: Number(r.latitude.toFixed(4)),
        longitude: Number(r.longitude.toFixed(4)),
        elevation: r.elevation,
        country: r.country ?? 'Unknown',
        admin1: r.admin1,
        timezone: r.timezone,
      }));

      res.json({ results });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to search locations.';
      res.status(502).json({ error: message });
    }
  });

  // 2. Live Internet Weather, Seasonal Climate, Soil Moisture & ISRIC SoilGrids Profile
  app.get('/api/env/fetch', async (req: Request, res: Response) => {
    try {
      const lat = Number(req.query.lat);
      const lon = Number(req.query.lon);
      const name = String(req.query.name ?? 'Selected Field').trim();
      const country = String(req.query.country ?? '').trim();
      const admin1 = req.query.admin1 ? String(req.query.admin1).trim() : undefined;

      if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
        res.status(400).json({ error: 'Valid latitude and longitude coordinates are required.' });
        return;
      }

      const endArchive = new Date();
      endArchive.setDate(endArchive.getDate() - 5);
      const startArchive = new Date(endArchive);
      startArchive.setDate(startArchive.getDate() - 90);

      const forecastUrl =
        `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
        `&current=temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m,soil_temperature_0cm,soil_moisture_0_to_1cm` +
        `&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,et0_fao_evapotranspiration,shortwave_radiation_sum` +
        `&hourly=soil_moisture_3_to_9cm,soil_moisture_9_to_27cm` +
        `&past_days=7&forecast_days=7&timezone=auto`;

      const archiveUrl =
        `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}` +
        `&start_date=${formatDateIso(startArchive)}&end_date=${formatDateIso(endArchive)}` +
        `&daily=temperature_2m_mean,precipitation_sum,shortwave_radiation_sum,et0_fao_evapotranspiration,relative_humidity_2m_mean` +
        `&timezone=auto`;

      const soilGridsUrl =
        `https://rest.isric.org/soilgrids/v2.0/properties/query?lon=${lon}&lat=${lat}` +
        `&property=phh2o&property=soc&property=nitrogen&property=clay&property=sand&property=silt&property=cec` +
        `&depth=0-5cm&depth=5-15cm&value=mean`;

      const [forecastResp, archiveResp, soilResp] = await Promise.allSettled([
        fetch(forecastUrl, { signal: AbortSignal.timeout(9000) }),
        fetch(archiveUrl, { signal: AbortSignal.timeout(9000) }),
        fetch(soilGridsUrl, { signal: AbortSignal.timeout(8000) }),
      ]);

      if (forecastResp.status !== 'fulfilled' || !forecastResp.value.ok) {
        throw new Error('Open-Meteo weather telemetry request failed.');
      }

      const forecastJson = (await forecastResp.value.json()) as {
        elevation?: number;
        timezone?: string;
        current?: {
          temperature_2m?: number;
          relative_humidity_2m?: number;
          precipitation?: number;
          wind_speed_10m?: number;
          soil_temperature_0cm?: number;
          soil_moisture_0_to_1cm?: number;
        };
        daily?: {
          time: string[];
          temperature_2m_max: Array<number | null>;
          temperature_2m_min: Array<number | null>;
          precipitation_sum: Array<number | null>;
          et0_fao_evapotranspiration: Array<number | null>;
          shortwave_radiation_sum: Array<number | null>;
        };
        hourly?: {
          time: string[];
          soil_moisture_3_to_9cm?: Array<number | null>;
          soil_moisture_9_to_27cm?: Array<number | null>;
        };
      };

      // Parse 14-day daily series + root-zone soil moisture average per day
      const daily = forecastJson.daily;
      const hourlyMoist = forecastJson.hourly?.soil_moisture_9_to_27cm ?? forecastJson.hourly?.soil_moisture_3_to_9cm ?? [];
      const dailySeries: DailyTelemetryPoint[] = (daily?.time ?? []).map((date, dIdx) => {
        const startH = dIdx * 24;
        const slice = hourlyMoist
          .slice(startH, startH + 24)
          .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
        const dayMoist =
          slice.length > 0
            ? (slice.reduce((a, b) => a + b, 0) / slice.length) * 100
            : (forecastJson.current?.soil_moisture_0_to_1cm ?? 0.26) * 100;

        return {
          date,
          tempMax: Number((daily?.temperature_2m_max[dIdx] ?? 26).toFixed(1)),
          tempMin: Number((daily?.temperature_2m_min[dIdx] ?? 16).toFixed(1)),
          precipitationMm: Number((daily?.precipitation_sum[dIdx] ?? 0).toFixed(1)),
          solarRadiationMj: Number((daily?.shortwave_radiation_sum[dIdx] ?? 18).toFixed(1)),
          et0Mm: Number((daily?.et0_fao_evapotranspiration[dIdx] ?? 3.8).toFixed(2)),
          soilMoisturePct: Number(Math.max(5, Math.min(65, dayMoist)).toFixed(1)),
        };
      });

      // Compute 90-day archive seasonal averages (extrapolating 90d rainfall to 120d crop-season scale)
      let meanTempC = forecastJson.current?.temperature_2m ?? 24;
      let meanHumidityPct = forecastJson.current?.relative_humidity_2m ?? 65;
      let seasonalRainfallMm = 650;
      let meanSolarRadiationMj = 18.5;
      let meanEt0Mm = 3.9;

      if (archiveResp.status === 'fulfilled' && archiveResp.value.ok) {
        const archiveJson = (await archiveResp.value.json()) as {
          daily?: {
            temperature_2m_mean?: Array<number | null>;
            precipitation_sum?: Array<number | null>;
            shortwave_radiation_sum?: Array<number | null>;
            et0_fao_evapotranspiration?: Array<number | null>;
            relative_humidity_2m_mean?: Array<number | null>;
          };
        };

        const avgOf = (arr?: Array<number | null>): number | null => {
          const valid = (arr ?? []).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
          if (valid.length === 0) return null;
          return valid.reduce((a, b) => a + b, 0) / valid.length;
        };
        const sumOf = (arr?: Array<number | null>): number | null => {
          const valid = (arr ?? []).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
          if (valid.length === 0) return null;
          return valid.reduce((a, b) => a + b, 0);
        };

        const tAvg = avgOf(archiveJson.daily?.temperature_2m_mean);
        const rhAvg = avgOf(archiveJson.daily?.relative_humidity_2m_mean);
        const rain90 = sumOf(archiveJson.daily?.precipitation_sum);
        const sradAvg = avgOf(archiveJson.daily?.shortwave_radiation_sum);
        const et0Avg = avgOf(archiveJson.daily?.et0_fao_evapotranspiration);

        if (tAvg !== null) meanTempC = Number(tAvg.toFixed(1));
        if (rhAvg !== null) meanHumidityPct = Math.round(rhAvg);
        if (rain90 !== null) {
          // Extrapolate 90-day observed accumulation to 120-day standard crop cycle (floor 140mm for irrigated/arid)
          seasonalRainfallMm = Math.round(Math.max(120, Math.min(2500, rain90 * (125 / 90))));
        }
        if (sradAvg !== null) meanSolarRadiationMj = Number(sradAvg.toFixed(1));
        if (et0Avg !== null) meanEt0Mm = Number(et0Avg.toFixed(2));
      } else if (dailySeries.length > 0) {
        const avgDailyRain =
          dailySeries.reduce((a, b) => a + b.precipitationMm, 0) / dailySeries.length;
        seasonalRainfallMm = Math.round(Math.max(150, Math.min(2400, avgDailyRain * 115)));
        meanSolarRadiationMj = Number(
          (dailySeries.reduce((a, b) => a + b.solarRadiationMj, 0) / dailySeries.length).toFixed(1)
        );
      }

      // Root-zone soil moisture from Open-Meteo (m³/m³ -> %)
      const validRootMoist = hourlyMoist.filter(
        (v): v is number => typeof v === 'number' && Number.isFinite(v)
      );
      const soilMoistureRootPct =
        validRootMoist.length > 0
          ? Number(
              Math.max(
                6,
                Math.min(62, (validRootMoist.reduce((a, b) => a + b, 0) / validRootMoist.length) * 100)
              ).toFixed(1)
            )
          : Number(
              Math.max(8, Math.min(60, (forecastJson.current?.soil_moisture_0_to_1cm ?? 0.27) * 100)).toFixed(1)
            );

      // Parse ISRIC SoilGrids v2.0 live response
      let soilSource = 'ISRIC SoilGrids v2.0 (Live)';
      let soilFallbackReason: string | undefined;

      let ph = 6.5;
      let socGKg = 14.5;
      let totalNGKg: number | null = 1.35;
      let clayPct = 26;
      let sandPct = 40;
      let siltPct = 34;
      let cecCmolKg = 16.5;

      let soilLoaded = false;
      if (soilResp.status === 'fulfilled' && soilResp.value.ok) {
        try {
          const sg = (await soilResp.value.json()) as {
            properties?: {
              layers?: Array<{
                name: string;
                depths?: Array<{ label: string; values?: { mean?: number | null } }>;
              }>;
            };
          };
          const layers = sg.properties?.layers ?? [];
          const rawPh = getSoilGridsMean(layers, 'phh2o');
          const rawSoc = getSoilGridsMean(layers, 'soc');
          const rawN = getSoilGridsMean(layers, 'nitrogen');
          const rawClay = getSoilGridsMean(layers, 'clay');
          const rawSand = getSoilGridsMean(layers, 'sand');
          const rawSilt = getSoilGridsMean(layers, 'silt');
          const rawCec = getSoilGridsMean(layers, 'cec');

          if (rawPh !== null && rawClay !== null) {
            soilLoaded = true;
            ph = Number((rawPh / 10).toFixed(2));
            socGKg = rawSoc !== null ? Number((rawSoc / 10).toFixed(1)) : 14.0;
            totalNGKg = rawN !== null ? Number((rawN / 100).toFixed(2)) : null;
            clayPct = Number((rawClay / 10).toFixed(1));
            sandPct = rawSand !== null ? Number((rawSand / 10).toFixed(1)) : 40;
            siltPct = rawSilt !== null ? Number((rawSilt / 10).toFixed(1)) : Math.max(5, 100 - clayPct - sandPct);
            cecCmolKg = rawCec !== null ? Number((rawCec / 10).toFixed(1)) : 15.0;
          } else {
            soilFallbackReason = 'SoilGrids returned masked/urban pixel at this exact coordinate; using climate-adjusted agronomic baseline.';
          }
        } catch {
          soilFallbackReason = 'SoilGrids response parse error; using climate-adjusted agronomic baseline.';
        }
      } else {
        soilFallbackReason = 'ISRIC SoilGrids upstream request timed out or unavailable; using climate-adjusted agronomic baseline.';
      }

      if (!soilLoaded) {
        soilSource = 'Climate-Adjusted Agronomic Baseline';
        // Adjust fallback pH & SOC reasonably by rainfall leaching & temperature
        ph = Number(Math.max(5.1, Math.min(8.1, 7.3 - (seasonalRainfallMm / 2400) * 1.7)).toFixed(2));
        socGKg = Number(Math.max(6.5, Math.min(28, 18.5 - Math.max(0, meanTempC - 18) * 0.45 + (seasonalRainfallMm / 1800) * 4)).toFixed(1));
        totalNGKg = null;
      }

      const npk = estimateNpkFromSoil(socGKg, totalNGKg, cecCmolKg, clayPct, ph);
      const textureClass = classifyUsdaTexture(clayPct, sandPct, siltPct);

      const bundle: LiveEnvironmentBundle = {
        location: {
          name,
          latitude: lat,
          longitude: lon,
          elevationM: Math.round(forecastJson.elevation ?? 0),
          country: country || 'Global',
          admin1,
          timezone: forecastJson.timezone ?? 'UTC',
        },
        fetchedAt: new Date().toISOString(),
        weatherSource: 'Open-Meteo Forecast & ERA5 Climate Archive (Live)',
        soilSource,
        soilFallbackReason,
        current: {
          temperatureC: Number((forecastJson.current?.temperature_2m ?? meanTempC).toFixed(1)),
          humidityPct: Math.round(forecastJson.current?.relative_humidity_2m ?? meanHumidityPct),
          precipitationMm: Number((forecastJson.current?.precipitation ?? 0).toFixed(1)),
          windSpeedKmh: Number((forecastJson.current?.wind_speed_10m ?? 8).toFixed(1)),
          soilTemp0cmC: Number((forecastJson.current?.soil_temperature_0cm ?? meanTempC).toFixed(1)),
          soilMoistureRootPct,
        },
        seasonalSummary: {
          meanTempC,
          meanHumidityPct,
          seasonalRainfallMm,
          meanSolarRadiationMj,
          meanEt0Mm,
        },
        soilProfile: {
          ph,
          organicCarbonGKg: socGKg,
          clayPct,
          sandPct,
          siltPct,
          textureClass,
          cecCmolKg,
          estimatedNitrogenKgHa: npk.n,
          estimatedPhosphorusKgHa: npk.p,
          estimatedPotassiumKgHa: npk.k,
        },
        dailySeries,
      };

      res.json(bundle);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch environmental telemetry.';
      res.status(502).json({ error: message });
    }
  });

  // 3. Internet-Grounded Agronomic Research & Advisory via Gemini + Google Search Grounding
  app.post('/api/agronomy/research', async (req: Request, res: Response) => {
    try {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        res.status(503).json({
          error: 'GEMINI_API_KEY is not configured in environment secrets. Live internet search advisory requires a valid Gemini API key.',
        });
        return;
      }

      const body = req.body as {
        locationName?: string;
        country?: string;
        crop?: string;
        predictedYield?: number;
        suitabilityScore?: number;
        soilTexture?: string;
        ph?: number;
        rainfall?: number;
        temperature?: number;
        nitrogen?: number;
        phosphorus?: number;
        potassium?: number;
      };

      const locationLabel = [body.locationName, body.country].filter(Boolean).join(', ') || 'selected region';
      const crop = body.crop || 'Maize';

      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      });

      const prompt = `Search agricultural extension and soil/weather references for ${crop} cultivation in ${locationLabel}.
Current ML workbench telemetry:
- Predicted Yield: ${body.predictedYield ?? 'N/A'} tons/ha (Suitability: ${body.suitabilityScore ?? 'N/A'}/100)
- Soil Texture: ${body.soilTexture ?? 'Loam'}, Soil pH: ${body.ph ?? 6.5}
- Available NPK: N=${body.nitrogen ?? 90} kg/ha, P=${body.phosphorus ?? 45} kg/ha, K=${body.potassium ?? 55} kg/ha
- Seasonal Mean Temp: ${body.temperature ?? 24}°C, Seasonal Rainfall: ${body.rainfall ?? 750} mm

Provide a concise, evidence-based agronomic brief (under 240 words) with 4 short sections:
1. Regional Soil & Cropping Season Context (local planting window and typical district yield range in t/ha)
2. Nutrient & pH Calibration (specific N-P-K / liming or organic matter advice vs current telemetry)
3. Weather & Moisture Risk Management (irrigation, drainage, or heat-stress mitigation)
4. ML Yield Benchmark Assessment (how the predicted ${body.predictedYield} t/ha compares with real-world regional averages).`;

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: prompt,
        config: {
          tools: [{ googleSearch: {} }],
        },
      });

      const rawChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
      const seenUris = new Set<string>();
      const sources: GroundedSourceLink[] = [];
      for (const chunk of rawChunks) {
        const uri = chunk.web?.uri;
        const title = chunk.web?.title;
        if (uri && !seenUris.has(uri)) {
          seenUris.add(uri);
          sources.push({
            title: title || uri,
            uri,
          });
        }
      }

      const payload: AgronomyResearchResponse = {
        summaryMarkdown: response.text ?? 'No agronomic summary returned.',
        sources,
        modelUsed: 'gemini-4-hydrogen (Google Search Grounded)',
        queriedAt: new Date().toISOString(),
      };

      res.json(payload);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to query Gemini agronomic search.';
      res.status(502).json({ error: message });
    }
  });

  // 4. Cloud SQL Persistence Endpoints (Protected by Firebase ID Token)
  app.get('/api/sql/predictions', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
      const uid = req.user?.uid;
      if (!uid) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      const predictions = await listUserPredictions(uid);
      res.json({ predictions });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch saved predictions.';
      res.status(500).json({ error: message });
    }
  });

  app.post('/api/sql/predictions', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
      const user = req.user;
      if (!user?.uid) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      const b = req.body as Partial<SavePredictionInput>;
      const requiredNums = [
        b.latitude,
        b.longitude,
        b.predictedYield,
        b.suitabilityScore,
        b.areaHa,
        b.totalProductionTons,
        b.nitrogen,
        b.phosphorus,
        b.potassium,
        b.ph,
        b.organicCarbon,
        b.soilMoisture,
        b.temperature,
        b.humidity,
        b.rainfall,
        b.solarRadiation,
      ];
      if (
        !b.locationName ||
        !b.crop ||
        !b.algorithm ||
        requiredNums.some((v) => typeof v !== 'number' || !Number.isFinite(v))
      ) {
        res.status(400).json({ error: 'Invalid or incomplete prediction payload.' });
        return;
      }

      const input: SavePredictionInput = {
        locationName: String(b.locationName),
        country: String(b.country ?? 'Global'),
        latitude: Number(b.latitude),
        longitude: Number(b.longitude),
        crop: String(b.crop),
        algorithm: String(b.algorithm),
        predictedYield: Number(b.predictedYield),
        suitabilityScore: Number(b.suitabilityScore),
        areaHa: Number(b.areaHa),
        totalProductionTons: Number(b.totalProductionTons),
        soilTexture: String(b.soilTexture ?? 'Loam'),
        nitrogen: Number(b.nitrogen),
        phosphorus: Number(b.phosphorus),
        potassium: Number(b.potassium),
        ph: Number(b.ph),
        organicCarbon: Number(b.organicCarbon),
        soilMoisture: Number(b.soilMoisture),
        temperature: Number(b.temperature),
        humidity: Number(b.humidity),
        rainfall: Number(b.rainfall),
        solarRadiation: Number(b.solarRadiation),
        notes: typeof b.notes === 'string' ? b.notes : '',
      };

      const prediction = await savePredictionRecord(
        user.uid,
        user.email ?? '',
        user.name ?? '',
        input
      );
      res.status(201).json({ prediction });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save prediction.';
      res.status(500).json({ error: message });
    }
  });

  app.delete('/api/sql/predictions/:id', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
      const uid = req.user?.uid;
      if (!uid) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      const id = Number.parseInt(String(req.params.id ?? ''), 10);
      if (!Number.isFinite(id) || id <= 0) {
        res.status(400).json({ error: 'Invalid prediction ID.' });
        return;
      }
      const deleted = await deletePredictionRecord(uid, id);
      if (!deleted) {
        res.status(404).json({ error: 'Prediction record not found.' });
        return;
      }
      res.json({ ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete prediction.';
      res.status(500).json({ error: message });
    }
  });

  app.get('/api/sql/voice-notes', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
      const uid = req.user?.uid;
      if (!uid) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      const notes = await listUserVoiceNotes(uid);
      res.json({ notes });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load voice notes.';
      res.status(500).json({ error: message });
    }
  });

  // 5. Google Maps Grounding via Gemini (gemini-4-hydrogen + googleMaps)
  app.post('/api/agronomy/maps-grounding', async (req: Request, res: Response) => {
    try {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        res.status(503).json({
          error: 'GEMINI_API_KEY is not configured in environment secrets.',
        });
        return;
      }

      const body = req.body as {
        query?: string;
        latitude?: number;
        longitude?: number;
        locationName?: string;
        crop?: string;
      };

      const lat = typeof body.latitude === 'number' && Number.isFinite(body.latitude) ? body.latitude : 30.901;
      const lng = typeof body.longitude === 'number' && Number.isFinite(body.longitude) ? body.longitude : 75.8573;
      const queryText =
        String(body.query ?? '').trim() ||
        'soil testing laboratories and agricultural extension centers nearby';
      const cropName = String(body.crop ?? 'crops').trim();
      const locLabel = String(body.locationName ?? 'this location').trim();

      const ai = createAiClient(apiKey);
      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: `Find ${queryText} near ${locLabel} supporting ${cropName} farmers. Summarize practical options concisely.`,
        config: {
          tools: [{ googleMaps: {} }],
          toolConfig: {
            retrievalConfig: {
              latLng: {
                latitude: lat,
                longitude: lng,
              },
            },
          },
        },
      });

      const rawChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
      const seenUris = new Set<string>();
      const places: MapsPlaceGroundingItem[] = [];

      for (const chunk of rawChunks) {
        const mapsData = chunk.maps as
          | {
              uri?: string;
              title?: string;
              placeAnswerSources?: {
                reviewSnippets?: Array<string | { review?: string; text?: string }>;
              };
            }
          | undefined;
        if (mapsData?.uri && !seenUris.has(mapsData.uri)) {
          seenUris.add(mapsData.uri);
          const rawSnippets = mapsData.placeAnswerSources?.reviewSnippets ?? [];
          const snippets = rawSnippets
            .map((s) => {
              if (typeof s === 'string') return s;
              if (s && typeof s === 'object') {
                return s.text || s.review || '';
              }
              return '';
            })
            .filter((s) => s.length > 0);
          places.push({
            title: mapsData.title || 'Google Maps Place',
            uri: mapsData.uri,
            snippets,
          });
        }
      }

      const payload: MapsGroundingResponse = {
        answerMarkdown: response.text ?? 'No nearby agricultural places returned.',
        places,
        queriedAt: new Date().toISOString(),
      };
      res.json(payload);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Google Maps Grounding request failed.';
      res.status(502).json({ error: message });
    }
  });

  // 6. Multi-Turn Agronomy Chatbot (gemini-4-hydrogen / gemini-3.1-flash-lite)
  app.post('/api/chat', async (req: Request, res: Response) => {
    try {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        res.status(503).json({
          error: 'GEMINI_API_KEY is not configured in environment secrets.',
        });
        return;
      }

      const body = req.body as {
        modelChoice?: string;
        rolePreset?: string;
        contextSummary?: string;
        messages?: Array<{ role?: string; text?: string }>;
      };

      const model =
        body.modelChoice === 'gemini-3.1-flash-lite'
          ? 'gemini-3.1-flash-lite'
          : 'gemini-4-hydrogen';

      const roleInstructions: Record<string, string> = {
        agronomist:
          'You are AgriYield ML’s Field Agronomist. Focus on practical planting windows, crop suitability trade-offs, irrigation timing, and yield risk mitigation.',
        soil_chemist:
          'You are AgriYield ML’s Soil & Nutrient Specialist. Focus on N-P-K calibration, soil pH buffering, organic carbon management, and moisture retention.',
        ml_analyst:
          'You are AgriYield ML’s Machine Learning Crop Analyst. Explain model feature importance, prediction uncertainty bands, sensitivity curves, and data-driven yield drivers.',
      };
      const roleDirective =
        roleInstructions[body.rolePreset ?? 'agronomist'] ?? roleInstructions.agronomist;

      const cleanMessages = (body.messages ?? [])
        .filter((m) => (m.role === 'user' || m.role === 'model') && typeof m.text === 'string' && m.text.trim().length > 0)
        .map((m) => ({
          role: m.role as 'user' | 'model',
          text: m.text!.trim(),
        }));

      if (cleanMessages.length === 0 || cleanMessages[cleanMessages.length - 1].role !== 'user') {
        res.status(400).json({ error: 'At least one user message is required.' });
        return;
      }

      const ai = createAiClient(apiKey);
      const systemInstruction = `${roleDirective}
Keep answers concise, quantitative, and grounded in the active soil/weather/ML telemetry provided below:
${body.contextSummary || 'No live field telemetry attached.'}`;

      const priorHistory = cleanMessages.slice(0, -1).map((m) => ({
        role: m.role,
        parts: [{ text: m.text }],
      }));
      const latestPrompt = cleanMessages[cleanMessages.length - 1].text;

      const chat = ai.chats.create({
        model,
        config: { systemInstruction },
        history: priorHistory,
      });

      const response = await chat.sendMessage({ message: latestPrompt });
      res.json({ reply: response.text ?? 'No response generated.' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Agronomy chat failed.';
      res.status(502).json({ error: message });
    }
  });

  // 7. Field Audio Note Transcription (gemini-3.5-transcribe) + Optional Cloud SQL Archive
  app.post('/api/audio/transcribe', async (req: Request, res: Response) => {
    try {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        res.status(503).json({
          error: 'GEMINI_API_KEY is not configured in environment secrets.',
        });
        return;
      }

      const body = req.body as {
        audioBase64?: string;
        mimeType?: string;
        locationName?: string;
        crop?: string;
      };

      if (!body.audioBase64 || typeof body.audioBase64 !== 'string') {
        res.status(400).json({ error: 'Audio payload (base64) is required.' });
        return;
      }

      const mimeType =
        typeof body.mimeType === 'string' && body.mimeType.startsWith('audio/')
          ? body.mimeType
          : 'audio/webm';

      const ai = createAiClient(apiKey);
      const response = await ai.models.generateContent({
        model: 'gemini-3.5-transcribe',
        contents: {
          parts: [
            {
              inlineData: {
                mimeType,
                data: body.audioBase64,
              },
            },
            {
              text: 'Transcribe this agricultural field note accurately. Preserve crop, soil, pH, N-P-K, and weather terms clearly.',
            },
          ],
        },
      });

      const transcript = (response.text ?? '').trim();
      let savedToSql = false;

      const authHeader = req.headers.authorization;
      if (transcript && authHeader && authHeader.startsWith('Bearer ')) {
        try {
          const decoded = await adminAuth.verifyIdToken(authHeader.split('Bearer ')[1]);
          await saveVoiceNote(decoded.uid, decoded.email ?? '', decoded.name ?? '', {
            locationName: String(body.locationName ?? 'Selected Field'),
            crop: String(body.crop ?? 'General'),
            transcript,
          });
          savedToSql = true;
        } catch (archiveErr) {
          console.warn('Voice note SQL archive skipped:', archiveErr);
        }
      }

      res.json({ transcript, savedToSql });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Audio transcription failed.';
      res.status(502).json({ error: message });
    }
  });

  // Vite dev middleware or static dist serving
  const isProd = process.env.NODE_ENV === 'production' && fs.existsSync(path.join(__dirname, 'dist'));
  if (isProd) {
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get('*all', (_req: Request, res: Response) => {
      res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  const httpServer = http.createServer(app);

  // 8. Real-Time Gemini Live API Voice Bridge (gemini-3.8-live)
  const wss = new WebSocketServer({ server: httpServer, path: '/live' });

  wss.on('connection', (clientWs: WebSocket) => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      clientWs.send(JSON.stringify({ error: 'GEMINI_API_KEY is not configured in environment secrets.' }));
      clientWs.close();
      return;
    }

    const ai = createAiClient(apiKey);
    const sessionPromise = ai.live.connect({
      model: 'gemini-3.8-live',
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } },
        },
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        systemInstruction:
          'You are AgriYield ML, a concise, practical agronomist and crop-yield specialist. Give actionable soil, irrigation, and fertilization guidance tailored to the field telemetry provided.',
      },
      callbacks: {
        onmessage: (message: LiveServerMessage) => {
          if (clientWs.readyState !== clientWs.OPEN) return;
          const content = message.serverContent;
          if (content?.inputTranscription?.text) {
            clientWs.send(
              JSON.stringify({ inputTranscript: content.inputTranscription.text })
            );
          }
          if (content?.outputTranscription?.text) {
            clientWs.send(
              JSON.stringify({ outputTranscript: content.outputTranscription.text })
            );
          }
          for (const part of content?.modelTurn?.parts ?? []) {
            if (part.inlineData?.data) {
              clientWs.send(JSON.stringify({ audio: part.inlineData.data }));
            }
          }
          if (content?.interrupted) {
            clientWs.send(JSON.stringify({ interrupted: true }));
          }
        },
        onerror: (errEvent) => {
          if (clientWs.readyState === clientWs.OPEN) {
            clientWs.send(
              JSON.stringify({
                error: errEvent instanceof Error ? errEvent.message : 'Live session error occurred.',
              })
            );
          }
        },
      },
    });

    sessionPromise.catch((err) => {
      if (clientWs.readyState === clientWs.OPEN) {
        clientWs.send(
          JSON.stringify({
            error: err instanceof Error ? err.message : 'Failed to establish Gemini Live session.',
          })
        );
        clientWs.close();
      }
    });

    clientWs.on('message', (rawData) => {
      let parsed: { audio?: string; context?: string };
      try {
        parsed = JSON.parse(rawData.toString()) as { audio?: string; context?: string };
      } catch {
        return;
      }

      void sessionPromise.then((session) => {
        if (parsed.context) {
          session.sendRealtimeInput({
            text: `Active field telemetry context:\n${parsed.context}`,
          });
        }
        if (parsed.audio) {
          session.sendRealtimeInput({
            audio: { data: parsed.audio, mimeType: 'audio/pcm;rate=16000' },
          });
        }
      }).catch(() => {
        // Handled by sessionPromise.catch above
      });
    });

    clientWs.on('close', () => {
      void sessionPromise
        .then((session) => {
          session.close();
        })
        .catch(() => {
          // Ignore close failure if connection failed
        });
    });
  });

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`AgriYield ML server listening on http://0.0.0.0:${PORT}`);
  });
}

createServer().catch((err) => {
  console.error('Server failed to start:', err);
  process.exit(1);
});
