import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpDown,
  Bookmark,
  CheckCircle2,
  CloudRain,
  Database,
  Download,
  ExternalLink,
  Globe,
  Loader2,
  LogIn,
  LogOut,
  MapPin,
  RefreshCw,
  Save,
  Search,
  Sliders,
  Sprout,
  Trash2,
  Upload,
} from 'lucide-react';
import type {
  AgronomyResearchResponse,
  CropRecord,
  EnvironmentalFeatures,
  GeoLocationResult,
  LiveEnvironmentBundle,
  ModelAlgorithm,
  SavedSqlPrediction,
} from './shared/agronomyTypes.ts';
import {
  BUILT_IN_DATASET,
  CROP_PROFILES,
  FEATURE_META,
  datasetToCsv,
  parseUploadedCsv,
} from './ml/agronomyDataset.ts';
import {
  detectAllCropsSuitability,
  predictYieldForCrop,
  trainModel,
  type TrainedModel,
} from './ml/mlEngine.ts';
import { RadarProfileChart } from './components/RadarProfileChart.tsx';
import { SensitivityChart } from './components/SensitivityChart.tsx';
import { YieldTrendChart } from './components/YieldTrendChart.tsx';
import {
  ActualVsPredictedChart,
  FeatureImportanceChart,
  WeatherTelemetryChart,
} from './components/DiagnosticsCharts.tsx';
import { FieldGoogleMap } from './components/FieldGoogleMap.tsx';
import { AgronomyAssistantPanel } from './components/AgronomyAssistantPanel.tsx';
import { useFirebase } from './context/FirebaseContext.tsx';

type WorkspaceTab = 'predict' | 'telemetry' | 'diagnostics' | 'dataset' | 'advisor';

const PRESET_LOCATIONS: Array<{
  label: string;
  name: string;
  lat: number;
  lon: number;
  country: string;
  admin1: string;
}> = [
  {
    label: 'Ludhiana, IN',
    name: 'Ludhiana',
    lat: 30.901,
    lon: 75.8573,
    country: 'India',
    admin1: 'Punjab',
  },
  {
    label: 'Ames, US',
    name: 'Ames',
    lat: 42.0308,
    lon: -93.6319,
    country: 'United States',
    admin1: 'Iowa',
  },
  {
    label: 'Can Tho, VN',
    name: 'Can Tho',
    lat: 10.0452,
    lon: 105.7469,
    country: 'Vietnam',
    admin1: 'Mekong Delta',
  },
  {
    label: 'Nakuru, KE',
    name: 'Nakuru',
    lat: -0.3031,
    lon: 36.08,
    country: 'Kenya',
    admin1: 'Rift Valley',
  },
];

const INITIAL_ENV: EnvironmentalFeatures = {
  nitrogen: 108,
  phosphorus: 52,
  potassium: 64,
  ph: 6.7,
  organicCarbon: 14.5,
  soilMoisture: 31.0,
  temperature: 24.5,
  humidity: 66,
  rainfall: 780,
  solarRadiation: 19.2,
};

const ALGORITHMS: Array<{ id: ModelAlgorithm; shortName: string }> = [
  { id: 'random_forest', shortName: 'Random Forest' },
  { id: 'gradient_boosting', shortName: 'Gradient Boosting' },
  { id: 'ridge_regression', shortName: 'Ridge Regression' },
  { id: 'knn', shortName: 'KNN (k=5)' },
];

export default function App() {
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('predict');

  // Dataset & Trained ML Models State
  const [dataset, setDataset] = useState<CropRecord[]>(BUILT_IN_DATASET);
  const [datasetSourceLabel, setDatasetSourceLabel] = useState<string>(
    'Built-in Multi-Region Agronomic Corpus (208 trials · 8 crops)'
  );
  const [csvNotice, setCsvNotice] = useState<string | null>(null);
  const [csvError, setCsvError] = useState<string | null>(null);
  const [selectedAlgorithm, setSelectedAlgorithm] = useState<ModelAlgorithm>('random_forest');

  // Train all 4 ML models whenever dataset changes (takes ~60ms total)
  const trainedModels = useMemo(() => {
    const map: Record<ModelAlgorithm, TrainedModel> = {
      random_forest: trainModel(dataset, 'random_forest', 42),
      gradient_boosting: trainModel(dataset, 'gradient_boosting', 42),
      ridge_regression: trainModel(dataset, 'ridge_regression', 42),
      knn: trainModel(dataset, 'knn', 42),
    };
    return map;
  }, [dataset]);

  const activeModel = trainedModels[selectedAlgorithm];

  // Crop & Field Parameters
  const [selectedCrop, setSelectedCrop] = useState<string>('Wheat');
  const [areaHa, setAreaHa] = useState<number>(4.5);
  const [env, setEnv] = useState<EnvironmentalFeatures>(INITIAL_ENV);
  const [isManuallyEdited, setIsManuallyEdited] = useState<boolean>(false);

  // Live Internet Fetch State
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [searchResults, setSearchResults] = useState<GeoLocationResult[]>([]);
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [liveBundle, setLiveBundle] = useState<LiveEnvironmentBundle | null>(null);
  const [isFetchingEnv, setIsFetchingEnv] = useState<boolean>(false);
  const [envError, setEnvError] = useState<string | null>(null);

  // Internet-Grounded Agronomic Research State
  const [researchData, setResearchData] = useState<AgronomyResearchResponse | null>(null);
  const [isResearching, setIsResearching] = useState<boolean>(false);
  const [researchError, setResearchError] = useState<string | null>(null);

  // Dataset Explorer Filter/Sort State
  const [tableCropFilter, setTableCropFilter] = useState<string>('ALL');
  const [tableSearch, setTableSearch] = useState<string>('');
  const [tableSortDesc, setTableSortDesc] = useState<boolean>(true);

  // Google Maps Demo-Key Quota Defense State
  const [mapsQuotaExceeded, setMapsQuotaExceeded] = useState<boolean>(false);

  // Cloud Account & Persistence State (Firebase Auth + Firestore + Cloud SQL)
  const {
    user,
    authReady,
    authError,
    signInWithGoogle,
    signOutUser,
    savedFields,
    bookmarkField,
    removeBookmarkedField,
    sqlPredictions,
    sqlVoiceNotes,
    sqlLoading,
    sqlError,
    refreshSqlHistory,
    savePredictionToSql,
    deletePredictionFromSql,
  } = useFirebase();
  const [cloudNotice, setCloudNotice] = useState<string | null>(null);
  const [isSavingCloud, setIsSavingCloud] = useState<boolean>(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const onQuotaExceeded = () => setMapsQuotaExceeded(true);
    window.addEventListener('gmp-quota-exceeded', onQuotaExceeded);
    return () => window.removeEventListener('gmp-quota-exceeded', onQuotaExceeded);
  }, []);

  const syncEnvFromBundle = useCallback((bundle: LiveEnvironmentBundle) => {
    setEnv({
      nitrogen: bundle.soilProfile.estimatedNitrogenKgHa,
      phosphorus: bundle.soilProfile.estimatedPhosphorusKgHa,
      potassium: bundle.soilProfile.estimatedPotassiumKgHa,
      ph: bundle.soilProfile.ph,
      organicCarbon: bundle.soilProfile.organicCarbonGKg,
      soilMoisture: bundle.current.soilMoistureRootPct,
      temperature: bundle.seasonalSummary.meanTempC,
      humidity: bundle.seasonalSummary.meanHumidityPct,
      rainfall: bundle.seasonalSummary.seasonalRainfallMm,
      solarRadiation: bundle.seasonalSummary.meanSolarRadiationMj,
    });
    setIsManuallyEdited(false);
  }, []);

  const fetchLocationTelemetry = useCallback(
    async (loc: {
      name: string;
      latitude: number;
      longitude: number;
      country: string;
      admin1?: string;
    }) => {
      setIsFetchingEnv(true);
      setEnvError(null);
      setResearchData(null);
      setResearchError(null);
      try {
        const params = new URLSearchParams({
          lat: String(loc.latitude),
          lon: String(loc.longitude),
          name: loc.name,
          country: loc.country,
        });
        if (loc.admin1) params.set('admin1', loc.admin1);

        const resp = await fetch(`/api/env/fetch?${params.toString()}`);
        const data = await resp.json();
        if (!resp.ok) {
          throw new Error(data.error || 'Failed to fetch live environmental data.');
        }
        const bundle = data as LiveEnvironmentBundle;
        setLiveBundle(bundle);
        syncEnvFromBundle(bundle);
      } catch (err) {
        setEnvError(
          err instanceof Error
            ? err.message
            : 'Unable to fetch live weather and soil telemetry.'
        );
      } finally {
        setIsFetchingEnv(false);
      }
    },
    [syncEnvFromBundle]
  );

  // Fetch initial real internet telemetry on first load
  useEffect(() => {
    const first = PRESET_LOCATIONS[0];
    void fetchLocationTelemetry({
      name: first.name,
      latitude: first.lat,
      longitude: first.lon,
      country: first.country,
      admin1: first.admin1,
    });
  }, [fetchLocationTelemetry]);

  // Keep selectedCrop valid if user uploads a custom CSV with different crops
  useEffect(() => {
    if (!activeModel.crops.includes(selectedCrop) && activeModel.crops.length > 0) {
      setSelectedCrop(activeModel.crops[0]);
    }
  }, [activeModel.crops, selectedCrop]);

  const handleLocationSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = searchQuery.trim();
    if (q.length < 2) return;
    setIsSearching(true);
    setEnvError(null);
    try {
      const resp = await fetch(`/api/env/search?q=${encodeURIComponent(q)}`);
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Geocoding lookup failed.');
      setSearchResults((data.results ?? []) as GeoLocationResult[]);
    } catch (err) {
      setEnvError(err instanceof Error ? err.message : 'Location search failed.');
    } finally {
      setIsSearching(false);
    }
  };

  // Real-time ML Prediction & Multi-Crop Detection
  const prediction = useMemo(
    () => predictYieldForCrop(activeModel, selectedCrop, env, areaHa),
    [activeModel, selectedCrop, env, areaHa]
  );

  const allCropsRanked = useMemo(
    () => detectAllCropsSuitability(activeModel, env, areaHa),
    [activeModel, env, areaHa]
  );

  const handleParamChange = (key: keyof EnvironmentalFeatures, value: number) => {
    setEnv((prev) => ({ ...prev, [key]: value }));
    setIsManuallyEdited(true);
  };

  const handleRunGroundedResearch = async () => {
    setIsResearching(true);
    setResearchError(null);
    try {
      const resp = await fetch('/api/agronomy/research', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locationName: liveBundle?.location.name ?? 'Selected Field',
          country: liveBundle?.location.country ?? '',
          crop: selectedCrop,
          predictedYield: prediction.predictedYield,
          suitabilityScore: prediction.suitabilityScore,
          soilTexture: liveBundle?.soilProfile.textureClass ?? 'Loam',
          ph: env.ph,
          rainfall: env.rainfall,
          temperature: env.temperature,
          nitrogen: env.nitrogen,
          phosphorus: env.phosphorus,
          potassium: env.potassium,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data.error || 'Web-grounded agronomic search failed.');
      }
      setResearchData(data as AgronomyResearchResponse);
    } catch (err) {
      setResearchError(
        err instanceof Error ? err.message : 'Unable to fetch grounded web research.'
      );
    } finally {
      setIsResearching(false);
    }
  };

  const handleCsvUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCsvError(null);
    setCsvNotice(null);
    try {
      const text = await file.text();
      const parsed = parseUploadedCsv(text);
      setDataset(parsed.records);
      setDatasetSourceLabel(`Custom CSV: ${file.name} (${parsed.records.length} rows)`);
      const warnText =
        parsed.warnings.length > 0 ? ` Notes: ${parsed.warnings.join(' ')}` : '';
      setCsvNotice(
        `Retrained all 4 ML models on ${parsed.records.length} records from ${file.name}.${warnText}`
      );
    } catch (err) {
      setCsvError(err instanceof Error ? err.message : 'Failed to parse CSV file.');
    } finally {
      e.target.value = '';
    }
  };

  const handleDownloadCsv = () => {
    const csv = datasetToCsv(dataset);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'agriyield_training_dataset.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportReport = () => {
    const report = {
      generatedAt: new Date().toISOString(),
      location: liveBundle?.location ?? { name: 'Custom Parameters' },
      dataSources: {
        weather: liveBundle?.weatherSource ?? 'Manual Parameters',
        soil: liveBundle?.soilSource ?? 'Manual Parameters',
        dataset: datasetSourceLabel,
      },
      activeModel: {
        algorithm: activeModel.label,
        r2: activeModel.metrics.r2,
        rmseTonsPerHa: activeModel.metrics.rmse,
        maeTonsPerHa: activeModel.metrics.mae,
        mapePct: activeModel.metrics.mape,
      },
      inputParameters: env,
      fieldAreaHa: areaHa,
      selectedCropPrediction: prediction,
      allCropsSuitabilityRanking: allCropsRanked.map((c) => ({
        crop: c.crop,
        predictedYieldTonsPerHa: c.predictedYield,
        suitabilityScore: c.suitabilityScore,
        suitabilityLabel: c.suitabilityLabel,
      })),
      modelBenchmarks: ALGORITHMS.map((a) => ({
        algorithm: trainedModels[a.id].label,
        r2: trainedModels[a.id].metrics.r2,
        rmse: trainedModels[a.id].metrics.rmse,
        mae: trainedModels[a.id].metrics.mae,
        mapePct: trainedModels[a.id].metrics.mape,
      })),
      groundedWebAdvisory: researchData ?? null,
    };

    const blob = new Blob([JSON.stringify(report, null, 2)], {
      type: 'application/json;charset=utf-8;',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `agriyield_ml_report_${selectedCrop.toLowerCase()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const filteredDataset = useMemo(() => {
    const q = tableSearch.trim().toLowerCase();
    return dataset
      .filter((r) => (tableCropFilter === 'ALL' ? true : r.crop === tableCropFilter))
      .filter((r) =>
        q === ''
          ? true
          : r.crop.toLowerCase().includes(q) ||
            r.region.toLowerCase().includes(q) ||
            r.id.toLowerCase().includes(q)
      )
      .sort((a, b) =>
        tableSortDesc
          ? b.yieldTonsPerHa - a.yieldTonsPerHa
          : a.yieldTonsPerHa - b.yieldTonsPerHa
      );
  }, [dataset, tableCropFilter, tableSearch, tableSortDesc]);

  const handleBookmarkField = async () => {
    if (!user) return;
    setCloudNotice(null);
    setIsSavingCloud(true);
    try {
      await bookmarkField({
        name: liveBundle?.location.name ?? 'Custom Field',
        country: liveBundle?.location.country ?? 'Global',
        latitude: liveBundle?.location.latitude ?? PRESET_LOCATIONS[0].lat,
        longitude: liveBundle?.location.longitude ?? PRESET_LOCATIONS[0].lon,
        recommendedCrop: selectedCrop,
        predictedYield: prediction.predictedYield,
      });
      setCloudNotice(`Bookmarked ${liveBundle?.location.name ?? 'field'} to Firestore.`);
    } catch (err) {
      setCloudNotice(err instanceof Error ? err.message : 'Unable to bookmark field.');
    } finally {
      setIsSavingCloud(false);
    }
  };

  const handleSaveRunToSql = async () => {
    if (!user) return;
    setCloudNotice(null);
    setIsSavingCloud(true);
    try {
      await savePredictionToSql({
        locationName: liveBundle?.location.name ?? 'Custom Parameters',
        country: liveBundle?.location.country ?? 'Global',
        latitude: liveBundle?.location.latitude ?? PRESET_LOCATIONS[0].lat,
        longitude: liveBundle?.location.longitude ?? PRESET_LOCATIONS[0].lon,
        crop: selectedCrop,
        algorithm: activeModel.label,
        predictedYield: prediction.predictedYield,
        suitabilityScore: prediction.suitabilityScore,
        areaHa,
        totalProductionTons: prediction.totalProductionTons,
        soilTexture: liveBundle?.soilProfile.textureClass ?? 'Loam',
        nitrogen: env.nitrogen,
        phosphorus: env.phosphorus,
        potassium: env.potassium,
        ph: env.ph,
        organicCarbon: env.organicCarbon,
        soilMoisture: env.soilMoisture,
        temperature: env.temperature,
        humidity: env.humidity,
        rainfall: env.rainfall,
        solarRadiation: env.solarRadiation,
        notes: isManuallyEdited ? 'Manual parameter override' : 'Live internet telemetry',
      });
      setCloudNotice(`Saved ${selectedCrop} yield run (${prediction.predictedYield.toFixed(2)} t/ha) to history.`);
    } catch (err) {
      setCloudNotice(err instanceof Error ? err.message : 'Unable to save prediction run.');
    } finally {
      setIsSavingCloud(false);
    }
  };

  const handleLoadSqlPrediction = (rec: SavedSqlPrediction) => {
    if (activeModel.crops.includes(rec.crop)) {
      setSelectedCrop(rec.crop);
    }
    setAreaHa(rec.areaHa);
    setEnv({
      nitrogen: rec.nitrogen,
      phosphorus: rec.phosphorus,
      potassium: rec.potassium,
      ph: rec.ph,
      organicCarbon: rec.organicCarbon,
      soilMoisture: rec.soilMoisture,
      temperature: rec.temperature,
      humidity: rec.humidity,
      rainfall: rec.rainfall,
      solarRadiation: rec.solarRadiation,
    });
    setIsManuallyEdited(true);
    setActiveTab('predict');
    setCloudNotice(`Loaded ${rec.crop} parameters from ${rec.locationName}.`);
  };

  const statusToneClass = (label: string) => {
    if (label === 'Optimal') return 'text-emerald-700';
    if (label === 'Moderate') return 'text-teal-700';
    if (label === 'Marginal') return 'text-amber-700';
    return 'text-rose-700';
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      {mapsQuotaExceeded && (
        <div className="bg-amber-50 border-b border-amber-200 text-amber-900 px-4 py-2.5 text-xs md:text-sm text-center sticky top-0 z-50 shadow-sm">
          <span>
            Google Maps Platform quota reached. If you are the app owner, visit{' '}
            <a
              href="https://developers.google.com/maps/ai/ai-studio?utm_campaign=gmp_mcp_codeassist_v1_aistudio#quota_exceeded_errors"
              target="_blank"
              rel="noopener noreferrer"
              className="underline font-semibold text-amber-950 hover:text-amber-800"
            >
              maps developer site
            </a>{' '}
            for instructions to update your account.
          </span>
        </div>
      )}

      {/* Strict 3-Zone Top Bar Contract */}
      <header className="sticky top-0 z-30 bg-white border-b border-slate-200 px-6 py-3.5">
        <div className="max-w-[1440px] mx-auto flex items-center justify-between gap-8">
          {/* Zone 1: Single text element wordmark */}
          <button
            type="button"
            onClick={() => setActiveTab('predict')}
            className="text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 rounded"
          >
            AgriYield ML
          </button>

          {/* Zone 2: 5 single-line navigation links */}
          <nav
            aria-label="Primary Workspace"
            className="flex items-center gap-6 overflow-x-auto text-sm font-medium"
          >
            {(
              [
                { id: 'predict', label: 'Predict & Detect' },
                { id: 'telemetry', label: 'Live Telemetry' },
                { id: 'diagnostics', label: 'ML Diagnostics' },
                { id: 'dataset', label: 'Dataset & CSV' },
                { id: 'advisor', label: 'Advisor & Voice' },
              ] as Array<{ id: WorkspaceTab; label: string }>
            ).map((tab) => {
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`py-1 border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 ${
                    active
                      ? 'border-teal-700 text-slate-900 font-semibold'
                      : 'border-transparent text-slate-600 hover:text-slate-900 hover:border-slate-300'
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </nav>

          {/* Zone 3: 1 Primary Action */}
          <div className="shrink-0">
            <button
              type="button"
              onClick={handleExportReport}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2"
            >
              <Download className="w-3.5 h-3.5" aria-hidden="true" />
              Export Report
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Container */}
      <main className="flex-1 max-w-[1440px] w-full mx-auto px-6 py-6">
        {activeTab === 'predict' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Left Control & Internet Fetch Column */}
            <aside className="lg:col-span-4 xl:col-span-3 bg-white border border-slate-200 rounded-lg p-5 space-y-6">
              {/* Section 1: Internet Data Acquisition */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                    <Globe className="w-4 h-4 text-teal-700" aria-hidden="true" />
                    Internet Telemetry Fetch
                  </h2>
                  {isFetchingEnv && (
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-teal-700" aria-label="Fetching live data" />
                  )}
                </div>
                <p className="text-xs text-slate-500 mb-3">
                  Fetch real-time weather, seasonal climate, and SoilGrids chemistry for any global coordinate.
                </p>

                <form onSubmit={handleLocationSearch} className="flex gap-2 mb-2.5">
                  <div className="relative flex-1">
                    <Search
                      className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
                      aria-hidden="true"
                    />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="City, district, or region..."
                      aria-label="Search agricultural location"
                      className="w-full pl-8 pr-2.5 py-2 text-xs bg-slate-50 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-600 focus:bg-white"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={isSearching || searchQuery.trim().length < 2}
                    className="px-3 py-2 text-xs font-medium bg-slate-900 text-white rounded-md hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    {isSearching ? 'Searching' : 'Find'}
                  </button>
                </form>

                {searchResults.length > 0 && (
                  <div className="mb-3 border border-slate-200 rounded-md bg-white divide-y divide-slate-100 max-h-44 overflow-y-auto">
                    {searchResults.map((res) => (
                      <button
                        key={res.id}
                        type="button"
                        onClick={() => {
                          setSearchResults([]);
                          setSearchQuery(`${res.name}, ${res.country}`);
                          void fetchLocationTelemetry(res);
                        }}
                        className="w-full text-left px-3 py-2 text-xs hover:bg-slate-50 flex items-center justify-between gap-2 cursor-pointer"
                      >
                        <span className="font-medium text-slate-800 truncate">
                          {res.name}
                          {res.admin1 ? `, ${res.admin1}` : ''} · {res.country}
                        </span>
                        <span className="font-mono text-[11px] text-slate-500 shrink-0 tabular-nums">
                          {res.latitude.toFixed(2)}, {res.longitude.toFixed(2)}
                        </span>
                      </button>
                    ))}
                  </div>
                )}

                <div className="grid grid-cols-2 gap-1.5">
                  {PRESET_LOCATIONS.map((preset) => {
                    const isActive = liveBundle?.location.name === preset.name;
                    return (
                      <button
                        key={preset.label}
                        type="button"
                        onClick={() =>
                          void fetchLocationTelemetry({
                            name: preset.name,
                            latitude: preset.lat,
                            longitude: preset.lon,
                            country: preset.country,
                            admin1: preset.admin1,
                          })
                        }
                        className={`px-2.5 py-1.5 text-xs font-medium rounded border text-left truncate transition-colors cursor-pointer ${
                          isActive
                            ? 'bg-teal-50 border-teal-600 text-teal-900'
                            : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
                        }`}
                      >
                        {preset.label}
                      </button>
                    );
                  })}
                </div>

                {envError && (
                  <div className="mt-2.5 p-2.5 text-xs text-rose-800 bg-rose-50 border border-rose-200 rounded-md flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                    <span>{envError}</span>
                  </div>
                )}
              </div>

              <hr className="border-slate-200" />

              {/* Section 2: ML Model & Crop Configuration */}
              <div className="space-y-3">
                <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                  <Sprout className="w-4 h-4 text-teal-700" aria-hidden="true" />
                  Model &amp; Crop Configuration
                </h2>

                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Active ML Algorithm
                  </label>
                  <select
                    value={selectedAlgorithm}
                    onChange={(e) => setSelectedAlgorithm(e.target.value as ModelAlgorithm)}
                    className="w-full px-2.5 py-2 text-xs font-medium bg-white border border-slate-300 rounded-md text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-600"
                  >
                    {ALGORITHMS.map((alg) => (
                      <option key={alg.id} value={alg.id}>
                        {trainedModels[alg.id].label} (R² {trainedModels[alg.id].metrics.r2})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">
                      Target Crop
                    </label>
                    <select
                      value={selectedCrop}
                      onChange={(e) => setSelectedCrop(e.target.value)}
                      className="w-full px-2.5 py-2 text-xs font-medium bg-white border border-slate-300 rounded-md text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-600"
                    >
                      {activeModel.crops.map((crop) => (
                        <option key={crop} value={crop}>
                          {crop}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">
                      Field Area (ha)
                    </label>
                    <input
                      type="number"
                      min={0.1}
                      max={10000}
                      step={0.5}
                      value={areaHa}
                      onChange={(e) =>
                        setAreaHa(Math.max(0.1, Number.parseFloat(e.target.value) || 1))
                      }
                      className="w-full px-2.5 py-2 text-xs font-mono tabular-nums bg-white border border-slate-300 rounded-md text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-600"
                    />
                  </div>
                </div>
              </div>

              <hr className="border-slate-200" />

              {/* Section 3: Environmental & Soil Sliders */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                    <Sliders className="w-4 h-4 text-teal-700" aria-hidden="true" />
                    Soil &amp; Weather Inputs
                  </h2>
                  {liveBundle && isManuallyEdited && (
                    <button
                      type="button"
                      onClick={() => syncEnvFromBundle(liveBundle)}
                      className="inline-flex items-center gap-1 text-xs font-medium text-teal-700 hover:text-teal-900 cursor-pointer"
                    >
                      <RefreshCw className="w-3 h-3" aria-hidden="true" />
                      Reset to Live
                    </button>
                  )}
                </div>

                <div className="space-y-3.5">
                  {FEATURE_META.map((meta) => (
                    <div key={meta.key} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <label
                          htmlFor={`input-${meta.key}`}
                          className="font-medium text-slate-700"
                        >
                          {meta.label}
                        </label>
                        <div className="flex items-center gap-1 font-mono tabular-nums">
                          <input
                            id={`input-${meta.key}`}
                            type="number"
                            min={meta.min}
                            max={meta.max}
                            step={meta.step}
                            value={env[meta.key]}
                            onChange={(e) => {
                              const parsed = Number.parseFloat(e.target.value);
                              if (Number.isFinite(parsed)) {
                                handleParamChange(meta.key, parsed);
                              }
                            }}
                            className="w-16 text-right px-1.5 py-0.5 text-xs bg-slate-50 border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-teal-600"
                          />
                          <span className="text-[11px] text-slate-400 w-12">
                            {meta.unit}
                          </span>
                        </div>
                      </div>
                      <input
                        type="range"
                        min={meta.min}
                        max={meta.max}
                        step={meta.step}
                        value={Math.min(meta.max, Math.max(meta.min, env[meta.key]))}
                        onChange={(e) =>
                          handleParamChange(meta.key, Number.parseFloat(e.target.value))
                        }
                        aria-label={`${meta.label} slider`}
                        className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-teal-700"
                      />
                    </div>
                  ))}
                </div>
              </div>

              <hr className="border-slate-200" />

              {/* Section 4: Account & Cloud Workspace */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-slate-900">
                    Saved Workspace
                  </h2>
                  {user && (
                    <button
                      type="button"
                      onClick={() => void signOutUser()}
                      className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-900 cursor-pointer"
                    >
                      <LogOut className="w-3 h-3" aria-hidden="true" />
                      Sign out
                    </button>
                  )}
                </div>

                {!authReady ? (
                  <div className="text-xs text-slate-500">Checking account session...</div>
                ) : !user ? (
                  <div className="space-y-2">
                    <p className="text-xs text-slate-500">
                      Sign in with Google to bookmark plots and archive ML yield runs across sessions.
                    </p>
                    <button
                      type="button"
                      onClick={() => void signInWithGoogle()}
                      className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-md cursor-pointer"
                    >
                      <LogIn className="w-3.5 h-3.5" aria-hidden="true" />
                      Sign in with Google
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    <div className="text-xs text-slate-600 truncate">
                      Signed in as{' '}
                      <span className="font-semibold text-slate-900">
                        {user.displayName || user.email}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => void handleBookmarkField()}
                        disabled={isSavingCloud}
                        className="inline-flex items-center justify-center gap-1.5 px-2.5 py-2 text-xs font-medium text-slate-800 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded-md disabled:opacity-60 cursor-pointer"
                      >
                        <Bookmark className="w-3.5 h-3.5 text-teal-700" aria-hidden="true" />
                        Bookmark
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleSaveRunToSql()}
                        disabled={isSavingCloud}
                        className="inline-flex items-center justify-center gap-1.5 px-2.5 py-2 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-md disabled:opacity-60 cursor-pointer"
                      >
                        <Save className="w-3.5 h-3.5" aria-hidden="true" />
                        Save Run
                      </button>
                    </div>
                  </div>
                )}

                {authError && (
                  <div className="p-2 text-xs text-rose-800 bg-rose-50 border border-rose-200 rounded">
                    {authError}
                  </div>
                )}
                {cloudNotice && (
                  <div className="p-2 text-xs text-teal-900 bg-teal-50 border border-teal-200 rounded">
                    {cloudNotice}
                  </div>
                )}
              </div>
            </aside>

            {/* Main Analytical Viewport */}
            <div className="lg:col-span-8 xl:col-span-9 space-y-6">
              {/* Primary Focal Anchor: Live Location Context + Yield Readout */}
              <section className="bg-white border border-slate-200 rounded-lg p-6">
                <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-200">
                  <div>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      <span className="inline-flex items-center gap-1 text-slate-800 font-medium">
                        <MapPin className="w-3.5 h-3.5 text-teal-700" aria-hidden="true" />
                        {liveBundle
                          ? `${liveBundle.location.name}${
                              liveBundle.location.admin1 ? `, ${liveBundle.location.admin1}` : ''
                            }, ${liveBundle.location.country}`
                          : 'Loading location telemetry...'}
                      </span>
                      {liveBundle && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono tabular-nums">
                            {liveBundle.location.latitude.toFixed(3)}°,{' '}
                            {liveBundle.location.longitude.toFixed(3)}° (Elev.{' '}
                            {liveBundle.location.elevationM} m)
                          </span>
                          <span aria-hidden="true">·</span>
                          <span>{liveBundle.soilProfile.textureClass}</span>
                        </>
                      )}
                    </div>
                    <h1 className="text-2xl font-bold text-slate-900 mt-1 text-balance">
                      {selectedCrop} Yield Prediction &amp; Environmental Detection
                    </h1>
                  </div>

                  <div className="text-right text-xs text-slate-500">
                    <div className="font-medium text-slate-700">{activeModel.label}</div>
                    <div className="font-mono tabular-nums mt-0.5">
                      Test R² {activeModel.metrics.r2} · RMSE {activeModel.metrics.rmse} t/ha
                    </div>
                  </div>
                </div>

                {/* 4-Column Quantitative Telemetry Strip */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-6 pt-5">
                  <div>
                    <div className="text-xs font-medium text-slate-500">
                      Predicted Yield
                    </div>
                    <div className="mt-1 flex items-baseline">
                      <span className="text-3xl font-bold font-mono tabular-nums text-slate-900">
                        {prediction.predictedYield.toFixed(2)}
                      </span>
                      <span className="text-xs font-mono uppercase text-slate-400 ml-1.5">
                        t/ha
                      </span>
                    </div>
                    <div className="text-xs font-mono tabular-nums text-slate-500 mt-1">
                      90% Band: {prediction.lowerBound}–{prediction.upperBound} t/ha
                    </div>
                  </div>

                  <div>
                    <div className="text-xs font-medium text-slate-500">
                      Estimated Total Harvest
                    </div>
                    <div className="mt-1 flex items-baseline">
                      <span className="text-3xl font-bold font-mono tabular-nums text-slate-900">
                        {prediction.totalProductionTons.toFixed(1)}
                      </span>
                      <span className="text-xs font-mono uppercase text-slate-400 ml-1.5">
                        tons
                      </span>
                    </div>
                    <div className="text-xs font-mono tabular-nums text-slate-500 mt-1">
                      Across {areaHa.toFixed(1)} ha cultivated
                    </div>
                  </div>

                  <div>
                    <div className="text-xs font-medium text-slate-500">
                      Crop Suitability Index
                    </div>
                    <div className="mt-1 flex items-baseline">
                      <span className="text-3xl font-bold font-mono tabular-nums text-slate-900">
                        {prediction.suitabilityScore}
                      </span>
                      <span className="text-xs font-mono uppercase text-slate-400 ml-1.5">
                        / 100
                      </span>
                    </div>
                    <div
                      className={`text-xs font-semibold mt-1 ${statusToneClass(
                        prediction.suitabilityLabel
                      )}`}
                    >
                      Status: {prediction.suitabilityLabel}
                    </div>
                  </div>

                  <div>
                    <div className="text-xs font-medium text-slate-500">
                      Telemetry Attribution
                    </div>
                    <div className="mt-1 text-xs text-slate-700 leading-relaxed">
                      {isManuallyEdited ? (
                        <span className="font-medium text-amber-700">
                          Manual override active (modified from live data)
                        </span>
                      ) : (
                        <span>
                          {liveBundle?.soilSource ?? 'Fetching SoilGrids...'}
                        </span>
                      )}
                    </div>
                    {liveBundle?.soilFallbackReason && (
                      <div className="text-[11px] text-amber-700 mt-1 leading-snug">
                        {liveBundle.soilFallbackReason}
                      </div>
                    )}
                  </div>
                </div>
              </section>

              {/* Interactive Google Maps Field Sampler */}
              <section className="bg-white border border-slate-200 rounded-lg p-6">
                <FieldGoogleMap
                  centerLat={liveBundle?.location.latitude ?? PRESET_LOCATIONS[0].lat}
                  centerLng={liveBundle?.location.longitude ?? PRESET_LOCATIONS[0].lon}
                  locationName={liveBundle?.location.name ?? PRESET_LOCATIONS[0].name}
                  selectedCrop={selectedCrop}
                  predictedYield={prediction.predictedYield}
                  savedFields={savedFields}
                  onPickCoordinate={(lat, lng, label) =>
                    void fetchLocationTelemetry({
                      name: label || `Plot (${lat.toFixed(2)}, ${lng.toFixed(2)})`,
                      latitude: lat,
                      longitude: lng,
                      country: liveBundle?.location.country ?? 'Global',
                    })
                  }
                />
              </section>

              {/* Multi-Crop Yield & Suitability Detector */}
              <section className="bg-white border border-slate-200 rounded-lg p-6">
                <div className="flex flex-wrap items-baseline justify-between gap-2 mb-4">
                  <div>
                    <h2 className="text-base font-semibold text-slate-900">
                      Multi-Crop Yield Detector
                    </h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Evaluates all {allCropsRanked.length} trained crops against current soil and weather telemetry; click any crop to inspect.
                    </p>
                  </div>
                  <span className="text-xs font-mono text-slate-500">
                    Top match: {allCropsRanked[0]?.crop} ({allCropsRanked[0]?.suitabilityScore}%)
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {allCropsRanked.map((item) => {
                    const isSelected = item.crop === selectedCrop;
                    return (
                      <button
                        key={item.crop}
                        type="button"
                        onClick={() => setSelectedCrop(item.crop)}
                        className={`text-left p-3.5 rounded-md border transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 ${
                          isSelected
                            ? 'bg-teal-50/70 border-teal-700'
                            : 'bg-slate-50/60 border-slate-200 hover:bg-slate-100/70'
                        }`}
                      >
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="text-sm font-semibold text-slate-900 truncate">
                            {item.crop}
                          </span>
                          <span
                            className={`text-[11px] font-mono font-semibold tabular-nums ${statusToneClass(
                              item.suitabilityLabel
                            )}`}
                          >
                            {item.suitabilityScore}%
                          </span>
                        </div>
                        <div className="mt-1.5 flex items-baseline">
                          <span className="text-lg font-bold font-mono tabular-nums text-slate-900">
                            {item.predictedYield.toFixed(2)}
                          </span>
                          <span className="text-[11px] font-mono text-slate-500 ml-1">
                            t/ha
                          </span>
                        </div>
                        <div className="mt-1 text-[11px] text-slate-500">
                          {item.suitabilityLabel} · {item.totalProductionTons.toFixed(1)}t total
                        </div>
                      </button>
                    );
                  })}
                </div>
              </section>

              {/* Scientific Visualization Pair: Radar + Sensitivity Curve */}
              <section className="bg-white border border-slate-200 rounded-lg p-6">
                <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
                  <div className="xl:col-span-5">
                    <RadarProfileChart crop={selectedCrop} env={env} />
                  </div>
                  <div className="xl:col-span-7">
                    <SensitivityChart
                      model={activeModel}
                      crop={selectedCrop}
                      env={env}
                    />
                  </div>
                </div>
              </section>

              {/* Historical & Predicted Yield Trend (Nitrogen / Soil Moisture) */}
              <section className="bg-white border border-slate-200 rounded-lg p-6">
                <YieldTrendChart
                  model={activeModel}
                  crop={selectedCrop}
                  env={env}
                  dataset={dataset}
                />
              </section>

              {/* Limiting Factors Diagnostic Table */}
              <section className="bg-white border border-slate-200 rounded-lg p-6">
                <div className="flex items-baseline justify-between mb-4">
                  <div>
                    <h2 className="text-base font-semibold text-slate-900">
                      Limiting Factor &amp; Envelope Diagnostics ({selectedCrop})
                    </h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {CROP_PROFILES[selectedCrop]?.harvestUnitNote ?? 'Standard crop yield benchmark'}
                    </p>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 text-left text-slate-500 font-medium">
                        <th className="py-2 pr-4">Parameter</th>
                        <th className="py-2 px-3 text-right">Current</th>
                        <th className="py-2 px-3 text-right">Optimal Window</th>
                        <th className="py-2 px-3">State</th>
                        <th className="py-2 pl-3">Calibration Delta</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {prediction.limitingFactors.map((row) => (
                        <tr key={row.parameter} className="hover:bg-slate-50/70">
                          <td className="py-2.5 pr-4 font-medium text-slate-800">
                            {row.label}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-900">
                            {row.current} {row.unit}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-600">
                            {row.optimalRange[0]}–{row.optimalRange[1]} {row.unit}
                          </td>
                          <td className="py-2.5 px-3">
                            {row.status === 'Optimal' ? (
                              <span className="inline-flex items-center gap-1 font-medium text-emerald-700">
                                <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                                Optimal
                              </span>
                            ) : row.status === 'Deficit' ? (
                              <span className="inline-flex items-center gap-1 font-medium text-amber-700">
                                <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" />
                                Deficit
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 font-medium text-rose-700">
                                <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" />
                                Excess
                              </span>
                            )}
                          </td>
                          <td className="py-2.5 pl-3 font-mono text-slate-600 tabular-nums">
                            {row.deltaText}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              {/* Internet-Grounded Agronomic Advisory (Google Search) */}
              <section className="bg-white border border-slate-200 rounded-lg p-6">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <h2 className="text-base font-semibold text-slate-900">
                      Web-Grounded Regional Agronomy Brief
                    </h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Queries live internet extension reports &amp; regional soil benchmarks for{' '}
                      {liveBundle?.location.name ?? 'this field'} ({selectedCrop}).
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleRunGroundedResearch}
                    disabled={isResearching}
                    className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-slate-900 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60"
                  >
                    {isResearching ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                    ) : (
                      <Globe className="w-3.5 h-3.5 text-teal-700" aria-hidden="true" />
                    )}
                    {isResearching ? 'Searching Web Sources...' : 'Fetch Web Agronomy Brief'}
                  </button>
                </div>

                {researchError && (
                  <div className="mt-4 p-3 text-xs text-rose-800 bg-rose-50 border border-rose-200 rounded-md flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                    <span>{researchError}</span>
                  </div>
                )}

                {researchData && (
                  <div className="mt-4 pt-4 border-t border-slate-200 space-y-4">
                    <div className="text-sm text-slate-800 leading-relaxed whitespace-pre-line">
                      {researchData.summaryMarkdown}
                    </div>

                    {researchData.sources.length > 0 && (
                      <div className="pt-3 border-t border-slate-100">
                        <div className="text-xs font-semibold text-slate-600 mb-2">
                          Verified Web Citations ({researchData.sources.length})
                        </div>
                        <ul className="grid grid-cols-1 md:grid-cols-2 gap-2">
                          {researchData.sources.map((src) => (
                            <li key={src.uri}>
                              <a
                                href={src.uri}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center justify-between gap-2 px-3 py-2 text-xs bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded text-teal-800 truncate"
                              >
                                <span className="truncate font-medium">{src.title}</span>
                                <ExternalLink className="w-3 h-3 shrink-0" aria-hidden="true" />
                              </a>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </section>

              {/* Saved Plots (Firestore) & Prediction Run History (Cloud SQL) */}
              {user && (
                <section className="bg-white border border-slate-200 rounded-lg p-6 space-y-6">
                  <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-200">
                    <div>
                      <h2 className="text-base font-semibold text-slate-900">
                        Saved Plots &amp; Prediction Archive
                      </h2>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Synced across sessions for {user.displayName || user.email}.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void refreshSqlHistory()}
                      disabled={sqlLoading}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded-md cursor-pointer"
                    >
                      <RefreshCw
                        className={`w-3.5 h-3.5 ${sqlLoading ? 'animate-spin' : ''}`}
                        aria-hidden="true"
                      />
                      Refresh
                    </button>
                  </div>

                  {sqlError && (
                    <div className="p-2.5 text-xs text-rose-800 bg-rose-50 border border-rose-200 rounded">
                      {sqlError}
                    </div>
                  )}

                  {/* Bookmarked Fields */}
                  <div>
                    <h3 className="text-xs font-semibold text-slate-700 mb-2">
                      Bookmarked Fields ({savedFields.length})
                    </h3>
                    {savedFields.length === 0 ? (
                      <p className="text-xs text-slate-500">
                        No bookmarked fields yet. Use Bookmark in the left sidebar to pin coordinates onto the map.
                      </p>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                        {savedFields.map((fld) => (
                          <div
                            key={fld.id}
                            className="p-3 bg-slate-50 border border-slate-200 rounded-md flex items-start justify-between gap-2"
                          >
                            <button
                              type="button"
                              onClick={() =>
                                void fetchLocationTelemetry({
                                  name: fld.name,
                                  latitude: fld.latitude,
                                  longitude: fld.longitude,
                                  country: fld.country,
                                })
                              }
                              className="text-left flex-1 min-w-0 cursor-pointer"
                            >
                              <div className="text-xs font-semibold text-slate-900 truncate hover:text-teal-800">
                                {fld.name}
                              </div>
                              <div className="text-[11px] font-mono tabular-nums text-slate-500 mt-0.5">
                                {fld.latitude.toFixed(3)}, {fld.longitude.toFixed(3)}
                              </div>
                              <div className="text-[11px] text-teal-800 font-medium mt-1">
                                {fld.recommendedCrop} · {fld.predictedYield} t/ha
                              </div>
                            </button>
                            <button
                              type="button"
                              onClick={() => void removeBookmarkedField(fld.id)}
                              aria-label={`Remove bookmark ${fld.name}`}
                              className="p-1 text-slate-400 hover:text-rose-700 cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Cloud SQL Yield Run History */}
                  <div>
                    <h3 className="text-xs font-semibold text-slate-700 mb-2">
                      Saved Yield Prediction Runs ({sqlPredictions.length})
                    </h3>
                    {sqlPredictions.length === 0 ? (
                      <p className="text-xs text-slate-500">
                        No saved prediction runs yet. Click Save Run in the left sidebar to archive soil, weather, and yield metrics.
                      </p>
                    ) : (
                      <div className="overflow-x-auto border border-slate-200 rounded-md">
                        <table className="w-full text-xs border-collapse">
                          <thead className="bg-slate-100 border-b border-slate-200 text-slate-600 font-medium">
                            <tr>
                              <th className="py-2 px-3 text-left">Location</th>
                              <th className="py-2 px-3 text-left">Crop</th>
                              <th className="py-2 px-3 text-left">Model</th>
                              <th className="py-2 px-3 text-right">Yield</th>
                              <th className="py-2 px-3 text-right">Suitability</th>
                              <th className="py-2 px-3 text-right">Actions</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {sqlPredictions.map((rec) => (
                              <tr key={rec.id} className="hover:bg-slate-50">
                                <td className="py-2 px-3 font-medium text-slate-900">
                                  {rec.locationName}
                                </td>
                                <td className="py-2 px-3 text-slate-700">{rec.crop}</td>
                                <td className="py-2 px-3 text-slate-600">{rec.algorithm}</td>
                                <td className="py-2 px-3 text-right font-mono tabular-nums font-semibold text-teal-800">
                                  {rec.predictedYield.toFixed(2)} t/ha
                                </td>
                                <td className="py-2 px-3 text-right font-mono tabular-nums">
                                  {rec.suitabilityScore}%
                                </td>
                                <td className="py-2 px-3 text-right space-x-2 whitespace-nowrap">
                                  <button
                                    type="button"
                                    onClick={() => handleLoadSqlPrediction(rec)}
                                    className="text-teal-700 hover:underline font-medium cursor-pointer"
                                  >
                                    Load
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void deletePredictionFromSql(rec.id)}
                                    className="text-rose-700 hover:underline font-medium cursor-pointer"
                                  >
                                    Delete
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </section>
              )}
            </div>
          </div>
        )}

        {/* TAB 2: LIVE INTERNET WEATHER & SOIL TELEMETRY */}
        {activeTab === 'telemetry' && (
          <div className="space-y-6">
            <section className="bg-white border border-slate-200 rounded-lg p-6">
              <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-200">
                <div>
                  <div className="text-xs text-slate-500">
                    Open-Meteo Forecast &amp; ERA5 Archive · ISRIC SoilGrids v2.0
                  </div>
                  <h1 className="text-xl font-bold text-slate-900 mt-1">
                    Live Atmospheric &amp; Soil Station:{' '}
                    {liveBundle
                      ? `${liveBundle.location.name}, ${liveBundle.location.country}`
                      : 'Loading...'}
                  </h1>
                </div>
                {liveBundle && (
                  <button
                    type="button"
                    onClick={() =>
                      void fetchLocationTelemetry({
                        name: liveBundle.location.name,
                        latitude: liveBundle.location.latitude,
                        longitude: liveBundle.location.longitude,
                        country: liveBundle.location.country,
                        admin1: liveBundle.location.admin1,
                      })
                    }
                    disabled={isFetchingEnv}
                    className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded-md cursor-pointer"
                  >
                    <RefreshCw
                      className={`w-3.5 h-3.5 ${isFetchingEnv ? 'animate-spin' : ''}`}
                      aria-hidden="true"
                    />
                    Refresh Live Feed
                  </button>
                )}
              </div>

              {liveBundle ? (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-5 py-5 border-b border-slate-200">
                    <div>
                      <div className="text-xs text-slate-500">Air Temp (Now)</div>
                      <div className="text-2xl font-bold font-mono tabular-nums mt-1">
                        {liveBundle.current.temperatureC}
                        <span className="text-xs text-slate-400 ml-1">°C</span>
                      </div>
                      <div className="text-xs text-slate-500 font-mono tabular-nums mt-0.5">
                        90d Mean: {liveBundle.seasonalSummary.meanTempC}°C
                      </div>
                    </div>

                    <div>
                      <div className="text-xs text-slate-500">Soil Temp (0 cm)</div>
                      <div className="text-2xl font-bold font-mono tabular-nums mt-1">
                        {liveBundle.current.soilTemp0cmC}
                        <span className="text-xs text-slate-400 ml-1">°C</span>
                      </div>
                      <div className="text-xs text-slate-500 font-mono tabular-nums mt-0.5">
                        Wind: {liveBundle.current.windSpeedKmh} km/h
                      </div>
                    </div>

                    <div>
                      <div className="text-xs text-slate-500">Root Soil Moisture</div>
                      <div className="text-2xl font-bold font-mono tabular-nums text-teal-700 mt-1">
                        {liveBundle.current.soilMoistureRootPct}
                        <span className="text-xs text-slate-400 ml-1">%</span>
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5">3–27 cm depth</div>
                    </div>

                    <div>
                      <div className="text-xs text-slate-500">Seasonal Rainfall</div>
                      <div className="text-2xl font-bold font-mono tabular-nums mt-1">
                        {liveBundle.seasonalSummary.seasonalRainfallMm}
                        <span className="text-xs text-slate-400 ml-1">mm</span>
                      </div>
                      <div className="text-xs text-slate-500 font-mono tabular-nums mt-0.5">
                        ET₀: {liveBundle.seasonalSummary.meanEt0Mm} mm/d
                      </div>
                    </div>

                    <div>
                      <div className="text-xs text-slate-500">Solar Irradiance</div>
                      <div className="text-2xl font-bold font-mono tabular-nums mt-1">
                        {liveBundle.seasonalSummary.meanSolarRadiationMj}
                        <span className="text-xs text-slate-400 ml-1">MJ/m²</span>
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5">Daily mean</div>
                    </div>

                    <div>
                      <div className="text-xs text-slate-500">Relative Humidity</div>
                      <div className="text-2xl font-bold font-mono tabular-nums mt-1">
                        {liveBundle.current.humidityPct}
                        <span className="text-xs text-slate-400 ml-1">%</span>
                      </div>
                      <div className="text-xs text-slate-500 font-mono tabular-nums mt-0.5">
                        90d Mean: {liveBundle.seasonalSummary.meanHumidityPct}%
                      </div>
                    </div>
                  </div>

                  <div className="pt-5">
                    <WeatherTelemetryChart series={liveBundle.dailySeries} />
                  </div>
                </>
              ) : (
                <div className="py-12 text-center text-sm text-slate-500">
                  Fetching live atmospheric telemetry...
                </div>
              )}
            </section>

            {/* Soil Physics & Chemistry Profile */}
            {liveBundle && (
              <section className="bg-white border border-slate-200 rounded-lg p-6">
                <div className="flex flex-wrap items-baseline justify-between gap-2 mb-4">
                  <div>
                    <h2 className="text-base font-semibold text-slate-900">
                      Topsoil Physical &amp; Chemical Profile (0–15 cm)
                    </h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Source: {liveBundle.soilSource}
                    </p>
                  </div>
                  <span className="text-sm font-semibold font-mono text-teal-800">
                    USDA Class: {liveBundle.soilProfile.textureClass}
                  </span>
                </div>

                {/* Particle Size Distribution Bar */}
                <div className="mb-6">
                  <div className="flex justify-between text-xs font-mono tabular-nums text-slate-700 mb-1.5">
                    <span>Clay: {liveBundle.soilProfile.clayPct}%</span>
                    <span>Silt: {liveBundle.soilProfile.siltPct}%</span>
                    <span>Sand: {liveBundle.soilProfile.sandPct}%</span>
                  </div>
                  <div className="h-3 w-full rounded-sm overflow-hidden flex border border-slate-200">
                    <div
                      style={{ width: `${liveBundle.soilProfile.clayPct}%` }}
                      className="bg-amber-700"
                      title={`Clay ${liveBundle.soilProfile.clayPct}%`}
                    />
                    <div
                      style={{ width: `${liveBundle.soilProfile.siltPct}%` }}
                      className="bg-teal-600"
                      title={`Silt ${liveBundle.soilProfile.siltPct}%`}
                    />
                    <div
                      style={{ width: `${liveBundle.soilProfile.sandPct}%` }}
                      className="bg-amber-300"
                      title={`Sand ${liveBundle.soilProfile.sandPct}%`}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 text-xs">
                  <div className="p-3 bg-slate-50 border border-slate-200 rounded">
                    <div className="text-slate-500">Soil pH (H₂O)</div>
                    <div className="text-lg font-bold font-mono tabular-nums mt-1">
                      {liveBundle.soilProfile.ph}
                    </div>
                  </div>
                  <div className="p-3 bg-slate-50 border border-slate-200 rounded">
                    <div className="text-slate-500">Organic Carbon</div>
                    <div className="text-lg font-bold font-mono tabular-nums mt-1">
                      {liveBundle.soilProfile.organicCarbonGKg} g/kg
                    </div>
                  </div>
                  <div className="p-3 bg-slate-50 border border-slate-200 rounded">
                    <div className="text-slate-500">CEC</div>
                    <div className="text-lg font-bold font-mono tabular-nums mt-1">
                      {liveBundle.soilProfile.cecCmolKg} cmol/kg
                    </div>
                  </div>
                  <div className="p-3 bg-slate-50 border border-slate-200 rounded">
                    <div className="text-slate-500">Available N (est.)</div>
                    <div className="text-lg font-bold font-mono tabular-nums mt-1">
                      {liveBundle.soilProfile.estimatedNitrogenKgHa} kg/ha
                    </div>
                  </div>
                  <div className="p-3 bg-slate-50 border border-slate-200 rounded">
                    <div className="text-slate-500">Available P (est.)</div>
                    <div className="text-lg font-bold font-mono tabular-nums mt-1">
                      {liveBundle.soilProfile.estimatedPhosphorusKgHa} kg/ha
                    </div>
                  </div>
                  <div className="p-3 bg-slate-50 border border-slate-200 rounded">
                    <div className="text-slate-500">Available K (est.)</div>
                    <div className="text-lg font-bold font-mono tabular-nums mt-1">
                      {liveBundle.soilProfile.estimatedPotassiumKgHa} kg/ha
                    </div>
                  </div>
                </div>
              </section>
            )}
          </div>
        )}

        {/* TAB 3: MACHINE LEARNING BENCHMARKS & DIAGNOSTICS */}
        {activeTab === 'diagnostics' && (
          <div className="space-y-6">
            <section className="bg-white border border-slate-200 rounded-lg p-6">
              <div className="flex flex-wrap items-baseline justify-between gap-2 mb-4">
                <div>
                  <h1 className="text-xl font-bold text-slate-900">
                    Multi-Algorithm Training &amp; Validation Benchmarks
                  </h1>
                  <p className="text-xs text-slate-500 mt-1">
                    Active corpus: {datasetSourceLabel} · Reproducible 80/20 Train/Test Split ({activeModel.metrics.trainSamples} train / {activeModel.metrics.testSamples} test). Click any row to activate that model.
                  </p>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-slate-500 font-medium">
                      <th className="py-2.5 pr-4">Algorithm</th>
                      <th className="py-2.5 px-3 text-right">R² Score</th>
                      <th className="py-2.5 px-3 text-right">RMSE (t/ha)</th>
                      <th className="py-2.5 px-3 text-right">MAE (t/ha)</th>
                      <th className="py-2.5 px-3 text-right">MAPE (%)</th>
                      <th className="py-2.5 px-3 text-right">Train Time</th>
                      <th className="py-2.5 pl-3 text-right">State</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {ALGORITHMS.map((alg) => {
                      const m = trainedModels[alg.id].metrics;
                      const isActive = selectedAlgorithm === alg.id;
                      return (
                        <tr
                          key={alg.id}
                          onClick={() => setSelectedAlgorithm(alg.id)}
                          className={`cursor-pointer transition-colors ${
                            isActive ? 'bg-teal-50/70' : 'hover:bg-slate-50'
                          }`}
                        >
                          <td className="py-3 pr-4 font-semibold text-slate-900">
                            {m.label}
                          </td>
                          <td className="py-3 px-3 text-right font-mono tabular-nums font-semibold text-teal-800">
                            {m.r2.toFixed(4)}
                          </td>
                          <td className="py-3 px-3 text-right font-mono tabular-nums">
                            {m.rmse.toFixed(3)}
                          </td>
                          <td className="py-3 px-3 text-right font-mono tabular-nums">
                            {m.mae.toFixed(3)}
                          </td>
                          <td className="py-3 px-3 text-right font-mono tabular-nums">
                            {m.mape.toFixed(2)}%
                          </td>
                          <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-500">
                            {m.trainingTimeMs} ms
                          </td>
                          <td className="py-3 pl-3 text-right font-medium">
                            {isActive ? (
                              <span className="text-teal-700">Active Model</span>
                            ) : (
                              <span className="text-slate-400">Select</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="bg-white border border-slate-200 rounded-lg p-6">
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                <div className="lg:col-span-6">
                  <ActualVsPredictedChart
                    points={activeModel.metrics.testPredictions}
                    modelLabel={activeModel.label}
                  />
                </div>
                <div className="lg:col-span-6">
                  <FeatureImportanceChart
                    items={activeModel.metrics.featureImportances}
                  />
                </div>
              </div>
            </section>
          </div>
        )}

        {/* TAB 4: DATASET EXPLORER & CUSTOM CSV TRAINING */}
        {activeTab === 'dataset' && (
          <div className="space-y-6">
            <section className="bg-white border border-slate-200 rounded-lg p-6">
              <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-200">
                <div>
                  <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                    <Database className="w-5 h-5 text-teal-700" aria-hidden="true" />
                    Training Dataset &amp; Custom CSV Pipeline
                  </h1>
                  <p className="text-xs text-slate-500 mt-1">
                    Active source: {datasetSourceLabel}. Upload your own CSV (columns: crop, nitrogen, phosphorus, potassium, ph, temperature, humidity, rainfall, yield) to retrain all ML models immediately.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2.5">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv,text/csv"
                    onChange={handleCsvUpload}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-md cursor-pointer"
                  >
                    <Upload className="w-3.5 h-3.5" aria-hidden="true" />
                    Upload CSV &amp; Retrain
                  </button>
                  <button
                    type="button"
                    onClick={handleDownloadCsv}
                    className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium text-slate-800 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded-md cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" aria-hidden="true" />
                    Download CSV
                  </button>
                  {dataset !== BUILT_IN_DATASET && (
                    <button
                      type="button"
                      onClick={() => {
                        setDataset(BUILT_IN_DATASET);
                        setDatasetSourceLabel(
                          'Built-in Multi-Region Agronomic Corpus (208 trials · 8 crops)'
                        );
                        setCsvNotice('Restored built-in 208-record agronomic training dataset.');
                        setCsvError(null);
                      }}
                      className="px-3.5 py-2 text-xs font-medium text-slate-700 hover:text-slate-900 border border-slate-300 rounded-md cursor-pointer"
                    >
                      Restore Default
                    </button>
                  )}
                </div>
              </div>

              {csvNotice && (
                <div className="mt-4 p-3 text-xs text-emerald-900 bg-emerald-50 border border-emerald-200 rounded-md">
                  {csvNotice}
                </div>
              )}
              {csvError && (
                <div className="mt-4 p-3 text-xs text-rose-800 bg-rose-50 border border-rose-200 rounded-md">
                  {csvError}
                </div>
              )}

              {/* Search & Filter Controls */}
              <div className="flex flex-wrap items-center justify-between gap-3 py-4">
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={tableCropFilter}
                    onChange={(e) => setTableCropFilter(e.target.value)}
                    aria-label="Filter dataset by crop"
                    className="px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-md"
                  >
                    <option value="ALL">All Crops ({dataset.length})</option>
                    {activeModel.crops.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>

                  <input
                    type="text"
                    value={tableSearch}
                    onChange={(e) => setTableSearch(e.target.value)}
                    placeholder="Filter by region or ID..."
                    className="px-3 py-1.5 text-xs bg-slate-50 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-600"
                  />
                </div>

                <button
                  type="button"
                  onClick={() => setTableSortDesc((prev) => !prev)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 border border-slate-200 rounded-md cursor-pointer"
                >
                  <ArrowUpDown className="w-3.5 h-3.5" aria-hidden="true" />
                  Yield: {tableSortDesc ? 'High → Low' : 'Low → High'}
                </button>
              </div>

              {/* Compact Tabular Data Grid */}
              <div className="overflow-x-auto max-h-[520px] border border-slate-200 rounded-md">
                <table className="w-full text-xs border-collapse">
                  <thead className="sticky top-0 bg-slate-100 border-b border-slate-200 text-slate-600 font-medium">
                    <tr>
                      <th className="py-2 px-3 text-left">ID</th>
                      <th className="py-2 px-3 text-left">Crop</th>
                      <th className="py-2 px-3 text-left">Region</th>
                      <th className="py-2 px-2 text-right">N</th>
                      <th className="py-2 px-2 text-right">P</th>
                      <th className="py-2 px-2 text-right">K</th>
                      <th className="py-2 px-2 text-right">pH</th>
                      <th className="py-2 px-2 text-right">Moist%</th>
                      <th className="py-2 px-2 text-right">Temp°C</th>
                      <th className="py-2 px-2 text-right">Rain mm</th>
                      <th className="py-2 px-3 text-right">Yield (t/ha)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-mono tabular-nums">
                    {filteredDataset.slice(0, 150).map((row) => (
                      <tr key={row.id} className="hover:bg-slate-50">
                        <td className="py-2 px-3 text-slate-500">{row.id}</td>
                        <td className="py-2 px-3 font-sans font-medium text-slate-900">
                          {row.crop}
                        </td>
                        <td className="py-2 px-3 font-sans text-slate-600">{row.region}</td>
                        <td className="py-2 px-2 text-right">{row.nitrogen}</td>
                        <td className="py-2 px-2 text-right">{row.phosphorus}</td>
                        <td className="py-2 px-2 text-right">{row.potassium}</td>
                        <td className="py-2 px-2 text-right">{row.ph}</td>
                        <td className="py-2 px-2 text-right">{row.soilMoisture}</td>
                        <td className="py-2 px-2 text-right">{row.temperature}</td>
                        <td className="py-2 px-2 text-right">{row.rainfall}</td>
                        <td className="py-2 px-3 text-right font-semibold text-teal-800">
                          {row.yieldTonsPerHa.toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {filteredDataset.length > 150 && (
                <div className="mt-2 text-xs text-slate-500">
                  Showing first 150 of {filteredDataset.length} matching records.
                </div>
              )}
            </section>
          </div>
        )}

        {/* TAB 5: AI ADVISOR, MAPS GROUNDING & LIVE VOICE */}
        {activeTab === 'advisor' && (
          <div className="space-y-6">
            <AgronomyAssistantPanel
              locationName={liveBundle?.location.name ?? PRESET_LOCATIONS[0].name}
              country={liveBundle?.location.country ?? PRESET_LOCATIONS[0].country}
              latitude={liveBundle?.location.latitude ?? PRESET_LOCATIONS[0].lat}
              longitude={liveBundle?.location.longitude ?? PRESET_LOCATIONS[0].lon}
              selectedCrop={selectedCrop}
              predictedYield={prediction.predictedYield}
              suitabilityScore={prediction.suitabilityScore}
              soilTexture={liveBundle?.soilProfile.textureClass ?? 'Loam'}
              ph={env.ph}
              nitrogen={env.nitrogen}
              phosphorus={env.phosphorus}
              potassium={env.potassium}
              temperature={env.temperature}
              rainfall={env.rainfall}
              onVoiceNoteSaved={() => void refreshSqlHistory()}
            />

            {user && sqlVoiceNotes.length > 0 && (
              <section className="bg-white border border-slate-200 rounded-lg p-6">
                <h2 className="text-base font-semibold text-slate-900 mb-3">
                  Archived Field Voice Notes ({sqlVoiceNotes.length})
                </h2>
                <div className="divide-y divide-slate-100">
                  {sqlVoiceNotes.map((note) => (
                    <div key={note.id} className="py-3 text-xs space-y-1">
                      <div className="flex items-center justify-between text-slate-500">
                        <span className="font-semibold text-slate-800">
                          {note.locationName} · {note.crop}
                        </span>
                        <span className="font-mono tabular-nums">
                          {new Date(note.createdAt).toLocaleString()}
                        </span>
                      </div>
                      <p className="text-slate-700 leading-relaxed">{note.transcript}</p>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </main>

      {/* Quiet Clean Footer */}
      <footer className="border-t border-slate-200 bg-white py-4 px-6 mt-8">
        <div className="max-w-[1440px] mx-auto flex flex-wrap items-center justify-between gap-4 text-xs text-slate-500">
          <div className="flex items-center gap-2">
            <CloudRain className="w-3.5 h-3.5 text-teal-700" aria-hidden="true" />
            <span>
              AgriYield ML · Live data via Open-Meteo Forecast/ERA5 &amp; ISRIC SoilGrids v2.0
            </span>
          </div>
          <div className="font-mono tabular-nums">
            Active Model: {activeModel.label} · {dataset.length} training records
          </div>
        </div>
      </footer>
    </div>
  );
}
