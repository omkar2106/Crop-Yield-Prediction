export type CropName =
  | 'Rice'
  | 'Wheat'
  | 'Maize'
  | 'Soybean'
  | 'Cotton'
  | 'Sugarcane'
  | 'Potato'
  | 'Sorghum';

export type ModelAlgorithm =
  | 'random_forest'
  | 'gradient_boosting'
  | 'ridge_regression'
  | 'knn';

export interface EnvironmentalFeatures {
  nitrogen: number;
  phosphorus: number;
  potassium: number;
  ph: number;
  organicCarbon: number;
  soilMoisture: number;
  temperature: number;
  humidity: number;
  rainfall: number;
  solarRadiation: number;
}

export interface CropRecord extends EnvironmentalFeatures {
  id: string;
  crop: string;
  region: string;
  yieldTonsPerHa: number;
}

export interface FeatureImportanceItem {
  feature: keyof EnvironmentalFeatures | 'crop';
  label: string;
  importancePct: number;
  unit: string;
}

export interface TestPredictionPoint {
  actual: number;
  predicted: number;
  crop: string;
  region: string;
  residual: number;
}

export interface ModelMetrics {
  algorithm: ModelAlgorithm;
  label: string;
  r2: number;
  rmse: number;
  mae: number;
  mape: number;
  trainSamples: number;
  testSamples: number;
  trainingTimeMs: number;
  featureImportances: FeatureImportanceItem[];
  testPredictions: TestPredictionPoint[];
  lossHistory?: number[];
}

export interface SingleYieldPrediction {
  crop: string;
  predictedYield: number;
  lowerBound: number;
  upperBound: number;
  totalProductionTons: number;
  suitabilityScore: number;
  suitabilityLabel: 'Optimal' | 'Moderate' | 'Marginal' | 'Stress Risk';
  limitingFactors: Array<{
    parameter: keyof EnvironmentalFeatures;
    label: string;
    current: number;
    optimalRange: [number, number];
    unit: string;
    status: 'Deficit' | 'Optimal' | 'Excess';
    deltaText: string;
  }>;
}

export interface GeoLocationResult {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  elevation?: number;
  country: string;
  admin1?: string;
  timezone?: string;
}

export interface DailyTelemetryPoint {
  date: string;
  tempMax: number;
  tempMin: number;
  precipitationMm: number;
  solarRadiationMj: number;
  et0Mm: number;
  soilMoisturePct: number;
}

export interface LiveEnvironmentBundle {
  location: {
    name: string;
    latitude: number;
    longitude: number;
    elevationM: number;
    country: string;
    admin1?: string;
    timezone: string;
  };
  fetchedAt: string;
  weatherSource: string;
  soilSource: string;
  soilFallbackReason?: string;
  current: {
    temperatureC: number;
    humidityPct: number;
    precipitationMm: number;
    windSpeedKmh: number;
    soilTemp0cmC: number;
    soilMoistureRootPct: number;
  };
  seasonalSummary: {
    meanTempC: number;
    meanHumidityPct: number;
    seasonalRainfallMm: number;
    meanSolarRadiationMj: number;
    meanEt0Mm: number;
  };
  soilProfile: {
    ph: number;
    organicCarbonGKg: number;
    clayPct: number;
    sandPct: number;
    siltPct: number;
    textureClass: string;
    cecCmolKg: number;
    estimatedNitrogenKgHa: number;
    estimatedPhosphorusKgHa: number;
    estimatedPotassiumKgHa: number;
  };
  dailySeries: DailyTelemetryPoint[];
}

export interface GroundedSourceLink {
  title: string;
  uri: string;
}

export interface AgronomyResearchResponse {
  summaryMarkdown: string;
  sources: GroundedSourceLink[];
  modelUsed: string;
  queriedAt: string;
}

export interface MapsPlaceGroundingItem {
  title: string;
  uri: string;
  snippets: string[];
}

export interface MapsGroundingResponse {
  answerMarkdown: string;
  places: MapsPlaceGroundingItem[];
  queriedAt: string;
}

export interface SavedSqlPrediction {
  id: number;
  locationName: string;
  country: string;
  latitude: number;
  longitude: number;
  crop: string;
  algorithm: string;
  predictedYield: number;
  suitabilityScore: number;
  areaHa: number;
  totalProductionTons: number;
  soilTexture: string;
  nitrogen: number;
  phosphorus: number;
  potassium: number;
  ph: number;
  organicCarbon: number;
  soilMoisture: number;
  temperature: number;
  humidity: number;
  rainfall: number;
  solarRadiation: number;
  notes: string;
  createdAt: string;
}

export interface SavedSqlVoiceNote {
  id: number;
  locationName: string;
  crop: string;
  transcript: string;
  createdAt: string;
}

export interface FirestoreSavedField {
  id: string;
  ownerId: string;
  name: string;
  country: string;
  latitude: number;
  longitude: number;
  recommendedCrop: string;
  predictedYield: number;
}
