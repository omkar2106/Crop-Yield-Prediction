import type {
  CropRecord,
  EnvironmentalFeatures,
  FeatureImportanceItem,
  ModelAlgorithm,
  ModelMetrics,
  SingleYieldPrediction,
  TestPredictionPoint,
} from '../shared/agronomyTypes.ts';
import { CROP_PROFILES, FEATURE_META } from './agronomyDataset.ts';

const ENV_KEYS: Array<keyof EnvironmentalFeatures> = [
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
];

interface TreeNode {
  isLeaf: boolean;
  value: number;
  featureIndex?: number;
  threshold?: number;
  left?: TreeNode;
  right?: TreeNode;
}

export interface TrainedModel {
  algorithm: ModelAlgorithm;
  label: string;
  crops: string[];
  featureNames: string[];
  means: number[];
  stds: number[];
  metrics: ModelMetrics;
  predictVector: (x: number[]) => { mean: number; std: number };
}

function createSeededRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function encodeRecord(record: CropRecord, crops: string[]): number[] {
  const base = ENV_KEYS.map((k) => record[k]);
  const oneHot = crops.map((c) => (record.crop === c ? 1 : 0));
  return [...base, ...oneHot];
}

function encodeQuery(
  crop: string,
  env: EnvironmentalFeatures,
  crops: string[]
): number[] {
  const base = ENV_KEYS.map((k) => env[k]);
  const oneHot = crops.map((c) => (crop === c ? 1 : 0));
  return [...base, ...oneHot];
}

function computeStats(X: number[][]): { means: number[]; stds: number[] } {
  const n = X.length;
  const d = X[0].length;
  const means = new Array<number>(d).fill(0);
  const stds = new Array<number>(d).fill(1);

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < d; j++) {
      means[j] += X[i][j];
    }
  }
  for (let j = 0; j < d; j++) {
    means[j] /= n;
  }

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < d; j++) {
      const diff = X[i][j] - means[j];
      stds[j] += diff * diff;
    }
  }
  for (let j = 0; j < d; j++) {
    const variance = stds[j] / Math.max(1, n - 1);
    stds[j] = variance > 1e-8 ? Math.sqrt(variance) : 1;
  }
  return { means, stds };
}

function standardizeRow(row: number[], means: number[], stds: number[]): number[] {
  return row.map((v, j) => (v - means[j]) / stds[j]);
}

function varianceOf(values: number[]): number {
  if (values.length <= 1) return 0;
  let sum = 0;
  for (let i = 0; i < values.length; i++) sum += values[i];
  const mean = sum / values.length;
  let sq = 0;
  for (let i = 0; i < values.length; i++) {
    const d = values[i] - mean;
    sq += d * d;
  }
  return sq / values.length;
}

function buildDecisionTree(
  X: number[][],
  y: number[],
  indices: number[],
  depth: number,
  maxDepth: number,
  minSamplesLeaf: number,
  mtry: number,
  rand: () => number,
  importanceAccumulator: number[]
): TreeNode {
  let sum = 0;
  for (let i = 0; i < indices.length; i++) {
    sum += y[indices[i]];
  }
  const mean = sum / indices.length;

  if (depth >= maxDepth || indices.length < minSamplesLeaf * 2) {
    return { isLeaf: true, value: mean };
  }

  const numFeatures = X[0].length;
  // Subsample candidate features without replacement
  const candidateFeatures: number[] = [];
  if (mtry >= numFeatures) {
    for (let f = 0; f < numFeatures; f++) candidateFeatures.push(f);
  } else {
    const pool = Array.from({ length: numFeatures }, (_, i) => i);
    for (let k = 0; k < mtry; k++) {
      const pick = Math.floor(rand() * (pool.length - k)) + k;
      const tmp = pool[k];
      pool[k] = pool[pick];
      pool[pick] = tmp;
      candidateFeatures.push(pool[k]);
    }
  }

  const parentSse = (() => {
    let sse = 0;
    for (let i = 0; i < indices.length; i++) {
      const d = y[indices[i]] - mean;
      sse += d * d;
    }
    return sse;
  })();

  if (parentSse <= 1e-9) {
    return { isLeaf: true, value: mean };
  }

  let bestFeature = -1;
  let bestThreshold = 0;
  let bestGain = 0;
  let bestLeft: number[] = [];
  let bestRight: number[] = [];

  for (const f of candidateFeatures) {
    // Sort indices by feature value
    const sorted = [...indices].sort((a, b) => X[a][f] - X[b][f]);
    const totalSum = sum;
    let leftSum = 0;
    let leftSqSum = 0;
    let totalSqSum = 0;
    for (let i = 0; i < sorted.length; i++) {
      const val = y[sorted[i]];
      totalSqSum += val * val;
    }

    for (let i = 0; i < sorted.length - 1; i++) {
      const idx = sorted[i];
      const val = y[idx];
      leftSum += val;
      leftSqSum += val * val;

      const leftCount = i + 1;
      const rightCount = sorted.length - leftCount;
      if (leftCount < minSamplesLeaf || rightCount < minSamplesLeaf) continue;

      const currVal = X[idx][f];
      const nextVal = X[sorted[i + 1]][f];
      if (currVal === nextVal) continue;

      const rightSum = totalSum - leftSum;
      const rightSqSum = totalSqSum - leftSqSum;

      const leftSse = leftSqSum - (leftSum * leftSum) / leftCount;
      const rightSse = rightSqSum - (rightSum * rightSum) / rightCount;
      const gain = parentSse - (leftSse + rightSse);

      if (gain > bestGain) {
        bestGain = gain;
        bestFeature = f;
        bestThreshold = (currVal + nextVal) / 2;
      }
    }
  }

  if (bestFeature === -1 || bestGain <= 1e-7) {
    return { isLeaf: true, value: mean };
  }

  importanceAccumulator[bestFeature] += bestGain;

  bestLeft = [];
  bestRight = [];
  for (let i = 0; i < indices.length; i++) {
    const idx = indices[i];
    if (X[idx][bestFeature] <= bestThreshold) {
      bestLeft.push(idx);
    } else {
      bestRight.push(idx);
    }
  }

  return {
    isLeaf: false,
    value: mean,
    featureIndex: bestFeature,
    threshold: bestThreshold,
    left: buildDecisionTree(
      X,
      y,
      bestLeft,
      depth + 1,
      maxDepth,
      minSamplesLeaf,
      mtry,
      rand,
      importanceAccumulator
    ),
    right: buildDecisionTree(
      X,
      y,
      bestRight,
      depth + 1,
      maxDepth,
      minSamplesLeaf,
      mtry,
      rand,
      importanceAccumulator
    ),
  };
}

function predictTree(node: TreeNode, x: number[]): number {
  let curr = node;
  while (!curr.isLeaf) {
    if (
      curr.featureIndex !== undefined &&
      curr.threshold !== undefined &&
      curr.left &&
      curr.right
    ) {
      curr = x[curr.featureIndex] <= curr.threshold ? curr.left : curr.right;
    } else {
      break;
    }
  }
  return curr.value;
}

function solveLinearSystem(A: number[][], b: number[]): number[] {
  const n = A.length;
  const M = A.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col++) {
    let pivotRow = col;
    let maxVal = Math.abs(M[col][col]);
    for (let r = col + 1; r < n; r++) {
      const val = Math.abs(M[r][col]);
      if (val > maxVal) {
        maxVal = val;
        pivotRow = r;
      }
    }

    if (pivotRow !== col) {
      const tmp = M[col];
      M[col] = M[pivotRow];
      M[pivotRow] = tmp;
    }

    const pivot = M[col][col];
    if (Math.abs(pivot) < 1e-10) continue;

    for (let c = col; c <= n; c++) {
      M[col][c] /= pivot;
    }

    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = M[r][col];
      if (factor === 0) continue;
      for (let c = col; c <= n; c++) {
        M[r][c] -= factor * M[col][c];
      }
    }
  }

  return M.map((row) => row[n]);
}

function formatImportanceList(
  rawImportances: number[],
  numEnv: number
): FeatureImportanceItem[] {
  const envScores = rawImportances.slice(0, numEnv);
  const cropScore = rawImportances.slice(numEnv).reduce((acc, v) => acc + v, 0);
  const total = envScores.reduce((acc, v) => acc + v, 0) + cropScore;
  const safeTotal = total > 1e-9 ? total : 1;

  const items: FeatureImportanceItem[] = FEATURE_META.map((meta, idx) => ({
    feature: meta.key,
    label: meta.label,
    importancePct: Number(((envScores[idx] / safeTotal) * 100).toFixed(1)),
    unit: meta.unit,
  }));

  items.push({
    feature: 'crop',
    label: 'Crop Genotype',
    importancePct: Number(((cropScore / safeTotal) * 100).toFixed(1)),
    unit: 'species',
  });

  return items.sort((a, b) => b.importancePct - a.importancePct);
}

function evaluatePredictions(
  actuals: number[],
  preds: number[],
  testRecords: CropRecord[]
): {
  r2: number;
  rmse: number;
  mae: number;
  mape: number;
  points: TestPredictionPoint[];
} {
  const n = actuals.length;
  let meanY = 0;
  for (let i = 0; i < n; i++) meanY += actuals[i];
  meanY /= Math.max(1, n);

  let ssRes = 0;
  let ssTot = 0;
  let absErr = 0;
  let pctErr = 0;
  const points: TestPredictionPoint[] = [];

  for (let i = 0; i < n; i++) {
    const a = actuals[i];
    const p = Math.max(0.1, preds[i]);
    const err = a - p;
    ssRes += err * err;
    ssTot += (a - meanY) * (a - meanY);
    absErr += Math.abs(err);
    pctErr += Math.abs(err) / Math.max(0.2, a);
    points.push({
      actual: Number(a.toFixed(2)),
      predicted: Number(p.toFixed(2)),
      crop: testRecords[i].crop,
      region: testRecords[i].region,
      residual: Number((p - a).toFixed(2)),
    });
  }

  const r2 = ssTot > 1e-9 ? 1 - ssRes / ssTot : 0;
  const rmse = Math.sqrt(ssRes / Math.max(1, n));
  const mae = absErr / Math.max(1, n);
  const mape = (pctErr / Math.max(1, n)) * 100;

  return {
    r2: Number(Math.max(-1, Math.min(0.999, r2)).toFixed(4)),
    rmse: Number(rmse.toFixed(3)),
    mae: Number(mae.toFixed(3)),
    mape: Number(mape.toFixed(2)),
    points,
  };
}

export function trainModel(
  dataset: CropRecord[],
  algorithm: ModelAlgorithm,
  seed = 42
): TrainedModel {
  const start = performance.now();
  const rand = createSeededRng(seed);
  const crops = Array.from(new Set(dataset.map((d) => d.crop))).sort();
  const featureNames = [...ENV_KEYS, ...crops.map((c) => `crop_${c}`)];

  // Stratified-like seeded shuffle for reproducible 80/20 split
  const shuffled = [...dataset];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = shuffled[i];
    shuffled[i] = shuffled[j];
    shuffled[j] = tmp;
  }

  const splitIdx = Math.max(8, Math.floor(shuffled.length * 0.8));
  const trainRecords = shuffled.slice(0, splitIdx);
  const testRecords = shuffled.slice(splitIdx);

  const XTrain = trainRecords.map((r) => encodeRecord(r, crops));
  const yTrain = trainRecords.map((r) => r.yieldTonsPerHa);
  const XTest = testRecords.map((r) => encodeRecord(r, crops));
  const yTest = testRecords.map((r) => r.yieldTonsPerHa);

  const { means, stds } = computeStats(XTrain);
  const rawImportances = new Array<number>(featureNames.length).fill(0);

  let label = 'Random Forest Regressor';
  let predictVector: (x: number[]) => { mean: number; std: number };
  let lossHistory: number[] | undefined;

  if (algorithm === 'random_forest') {
    label = 'Random Forest Regressor';
    const numTrees = 32;
    const maxDepth = 8;
    const minSamplesLeaf = 2;
    const mtry = Math.max(4, Math.floor(featureNames.length * 0.55));
    const trees: TreeNode[] = [];

    for (let t = 0; t < numTrees; t++) {
      const bagIndices: number[] = [];
      for (let i = 0; i < XTrain.length; i++) {
        bagIndices.push(Math.floor(rand() * XTrain.length));
      }
      trees.push(
        buildDecisionTree(
          XTrain,
          yTrain,
          bagIndices,
          0,
          maxDepth,
          minSamplesLeaf,
          mtry,
          rand,
          rawImportances
        )
      );
    }

    predictVector = (x: number[]) => {
      const preds = trees.map((tree) => predictTree(tree, x));
      let s = 0;
      for (let i = 0; i < preds.length; i++) s += preds[i];
      const mean = s / preds.length;
      const sd = Math.sqrt(varianceOf(preds));
      return { mean: Math.max(0.1, mean), std: sd };
    };
  } else if (algorithm === 'gradient_boosting') {
    label = 'Gradient Boosted Trees (GBDT)';
    const numEstimators = 40;
    const learningRate = 0.14;
    const maxDepth = 4;
    const minSamplesLeaf = 2;
    const basePred = yTrain.reduce((a, b) => a + b, 0) / yTrain.length;
    const residuals = yTrain.map((y) => y - basePred);
    const trees: TreeNode[] = [];
    const allIndices = Array.from({ length: XTrain.length }, (_, i) => i);
    lossHistory = [];

    const runningPreds = new Array<number>(XTrain.length).fill(basePred);

    for (let m = 0; m < numEstimators; m++) {
      const tree = buildDecisionTree(
        XTrain,
        residuals,
        allIndices,
        0,
        maxDepth,
        minSamplesLeaf,
        featureNames.length,
        rand,
        rawImportances
      );
      trees.push(tree);

      let sqErr = 0;
      for (let i = 0; i < XTrain.length; i++) {
        const update = learningRate * predictTree(tree, XTrain[i]);
        runningPreds[i] += update;
        residuals[i] = yTrain[i] - runningPreds[i];
        sqErr += residuals[i] * residuals[i];
      }
      lossHistory.push(Number(Math.sqrt(sqErr / XTrain.length).toFixed(3)));
    }

    const residualRmse = lossHistory[lossHistory.length - 1] ?? 1.0;

    predictVector = (x: number[]) => {
      let pred = basePred;
      for (let m = 0; m < trees.length; m++) {
        pred += learningRate * predictTree(trees[m], x);
      }
      return { mean: Math.max(0.1, pred), std: Math.max(0.25, residualRmse * 1.15) };
    };
  } else if (algorithm === 'ridge_regression') {
    label = 'Ridge Linear Regression';
    const d = featureNames.length;
    const ZTrain = XTrain.map((row) => [1, ...standardizeRow(row, means, stds)]);
    const dim = d + 1;
    const XtX: number[][] = Array.from({ length: dim }, () => new Array<number>(dim).fill(0));
    const Xty = new Array<number>(dim).fill(0);

    for (let i = 0; i < ZTrain.length; i++) {
      const row = ZTrain[i];
      const target = yTrain[i];
      for (let r = 0; r < dim; r++) {
        Xty[r] += row[r] * target;
        for (let c = 0; c < dim; c++) {
          XtX[r][c] += row[r] * row[c];
        }
      }
    }

    const lambda = 2.5;
    for (let j = 1; j < dim; j++) {
      XtX[j][j] += lambda;
    }

    const weights = solveLinearSystem(XtX, Xty);
    for (let j = 0; j < d; j++) {
      rawImportances[j] = Math.abs(weights[j + 1]);
    }

    // Estimate residual std on train
    let sse = 0;
    for (let i = 0; i < ZTrain.length; i++) {
      let p = 0;
      for (let j = 0; j < dim; j++) p += ZTrain[i][j] * weights[j];
      const err = yTrain[i] - p;
      sse += err * err;
    }
    const trainRmse = Math.sqrt(sse / Math.max(1, ZTrain.length - dim));

    predictVector = (x: number[]) => {
      const z = [1, ...standardizeRow(x, means, stds)];
      let pred = 0;
      for (let j = 0; j < dim; j++) pred += z[j] * weights[j];
      return { mean: Math.max(0.1, pred), std: trainRmse };
    };
  } else {
    label = 'K-Nearest Neighbors (KNN, k=5)';
    const ZTrain = XTrain.map((row) => standardizeRow(row, means, stds));
    const kNeighbors = Math.min(5, ZTrain.length);

    // Compute correlation magnitude as proxy feature salience for KNN
    const meanY = yTrain.reduce((a, b) => a + b, 0) / yTrain.length;
    for (let j = 0; j < featureNames.length; j++) {
      let num = 0;
      let denomX = 0;
      let denomY = 0;
      for (let i = 0; i < ZTrain.length; i++) {
        const dx = ZTrain[i][j];
        const dy = yTrain[i] - meanY;
        num += dx * dy;
        denomX += dx * dx;
        denomY += dy * dy;
      }
      const corr = denomX > 0 && denomY > 0 ? Math.abs(num / Math.sqrt(denomX * denomY)) : 0;
      rawImportances[j] = corr;
    }

    predictVector = (x: number[]) => {
      const zx = standardizeRow(x, means, stds);
      const dists = ZTrain.map((row, idx) => {
        let sq = 0;
        for (let j = 0; j < zx.length; j++) {
          const weight = j >= ENV_KEYS.length ? 3.0 : 1.0; // prioritize matching crop species
          const d = (zx[j] - row[j]) * weight;
          sq += d * d;
        }
        return { dist: Math.sqrt(sq), y: yTrain[idx] };
      });
      dists.sort((a, b) => a.dist - b.dist);
      const top = dists.slice(0, kNeighbors);

      let wSum = 0;
      let yWeighted = 0;
      for (const item of top) {
        const w = 1 / (item.dist + 0.05);
        wSum += w;
        yWeighted += w * item.y;
      }
      const mean = yWeighted / Math.max(1e-6, wSum);
      const sd = Math.sqrt(varianceOf(top.map((t) => t.y)));
      return { mean: Math.max(0.1, mean), std: Math.max(0.2, sd) };
    };
  }

  const testPreds = XTest.map((x) => predictVector(x).mean);
  const evalResult = evaluatePredictions(yTest, testPreds, testRecords);
  const trainingTimeMs = Number((performance.now() - start).toFixed(1));

  return {
    algorithm,
    label,
    crops,
    featureNames,
    means,
    stds,
    metrics: {
      algorithm,
      label,
      r2: evalResult.r2,
      rmse: evalResult.rmse,
      mae: evalResult.mae,
      mape: evalResult.mape,
      trainSamples: trainRecords.length,
      testSamples: testRecords.length,
      trainingTimeMs,
      featureImportances: formatImportanceList(rawImportances, ENV_KEYS.length),
      testPredictions: evalResult.points,
      lossHistory,
    },
    predictVector,
  };
}

export function predictYieldForCrop(
  model: TrainedModel,
  crop: string,
  env: EnvironmentalFeatures,
  areaHa: number
): SingleYieldPrediction {
  const vec = encodeQuery(crop, env, model.crops);
  const { mean, std } = model.predictVector(vec);
  const profile = CROP_PROFILES[crop] ?? CROP_PROFILES.Maize;

  const predictedYield = Number(Math.max(0.15, mean).toFixed(2));
  const margin = Math.max(predictedYield * 0.06, std * 1.15);
  const lowerBound = Number(Math.max(0.1, predictedYield - margin).toFixed(2));
  const upperBound = Number((predictedYield + margin).toFixed(2));
  const totalProductionTons = Number((predictedYield * areaHa).toFixed(2));

  const ratio = predictedYield / profile.maxPotentialYield;
  const suitabilityScore = Math.max(5, Math.min(99, Math.round(ratio * 100)));

  let suitabilityLabel: SingleYieldPrediction['suitabilityLabel'] = 'Moderate';
  if (suitabilityScore >= 76) suitabilityLabel = 'Optimal';
  else if (suitabilityScore >= 54) suitabilityLabel = 'Moderate';
  else if (suitabilityScore >= 36) suitabilityLabel = 'Marginal';
  else suitabilityLabel = 'Stress Risk';

  const limitingFactors = FEATURE_META.map((meta) => {
    const [optMin, optMax] = profile.optimal[meta.key];
    const current = env[meta.key];
    let status: 'Deficit' | 'Optimal' | 'Excess' = 'Optimal';
    let deltaText = 'Within optimal envelope';
    if (current < optMin) {
      status = 'Deficit';
      const diff = (optMin - current).toFixed(meta.key === 'ph' ? 1 : 0);
      deltaText = `-${diff} ${meta.unit} below min`;
    } else if (current > optMax) {
      status = 'Excess';
      const diff = (current - optMax).toFixed(meta.key === 'ph' ? 1 : 0);
      deltaText = `+${diff} ${meta.unit} above max`;
    }
    return {
      parameter: meta.key,
      label: meta.label,
      current,
      optimalRange: [optMin, optMax] as [number, number],
      unit: meta.unit,
      status,
      deltaText,
    };
  }).sort((a, b) => {
    if (a.status === 'Optimal' && b.status !== 'Optimal') return 1;
    if (a.status !== 'Optimal' && b.status === 'Optimal') return -1;
    return 0;
  });

  return {
    crop,
    predictedYield,
    lowerBound,
    upperBound,
    totalProductionTons,
    suitabilityScore,
    suitabilityLabel,
    limitingFactors,
  };
}

export function detectAllCropsSuitability(
  model: TrainedModel,
  env: EnvironmentalFeatures,
  areaHa: number
): SingleYieldPrediction[] {
  const results = model.crops.map((crop) =>
    predictYieldForCrop(model, crop, env, areaHa)
  );
  return results.sort((a, b) => b.suitabilityScore - a.suitabilityScore);
}

export function computeSensitivityCurve(
  model: TrainedModel,
  crop: string,
  env: EnvironmentalFeatures,
  sweepKey: keyof EnvironmentalFeatures,
  steps = 22
): Array<{ x: number; yield: number; lower: number; upper: number }> {
  const meta = FEATURE_META.find((m) => m.key === sweepKey) ?? FEATURE_META[0];
  const points: Array<{ x: number; yield: number; lower: number; upper: number }> = [];

  for (let i = 0; i <= steps; i++) {
    const val = meta.min + ((meta.max - meta.min) * i) / steps;
    const xVal = Number(val.toFixed(meta.key === 'ph' ? 2 : 1));
    const queryEnv: EnvironmentalFeatures = { ...env, [sweepKey]: xVal };
    const vec = encodeQuery(crop, queryEnv, model.crops);
    const { mean, std } = model.predictVector(vec);
    const y = Number(Math.max(0.1, mean).toFixed(2));
    const margin = Math.max(y * 0.05, std);
    points.push({
      x: xVal,
      yield: y,
      lower: Number(Math.max(0.05, y - margin).toFixed(2)),
      upper: Number((y + margin).toFixed(2)),
    });
  }
  return points;
}
