// Dependency-free 1-D Gaussian Hidden Markov Model.
// Trains with Baum-Welch (EM) in log space; decodes with Viterbi.
// Kept import-free so it can be unit-tested in isolation.

export type HmmModel = {
  states: number[]; // most-likely state per observation (Viterbi)
  posteriors: number[][]; // gamma[t][k] = P(state k | all obs)
  means: number[];
  variances: number[];
  startProb: number[];
  transmat: number[][];
  logLikelihood: number;
};

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function logsumexp(arr: number[]): number {
  let max = -Infinity;
  for (const v of arr) if (v > max) max = v;
  if (max === -Infinity) return -Infinity;
  let sum = 0;
  for (const v of arr) sum += Math.exp(v - max);
  return max + Math.log(sum);
}

function gaussianLogPdf(x: number, mean: number, variance: number): number {
  return -0.5 * Math.log(2 * Math.PI * variance) - ((x - mean) * (x - mean)) / (2 * variance);
}

function kmeans1d(x: number[], k: number, rand: () => number): number[] {
  // k-means++ style seeding on 1-D data, then a few Lloyd iterations.
  const centers: number[] = [x[Math.floor(rand() * x.length)]];
  while (centers.length < k) {
    const d2 = x.map((v) => Math.min(...centers.map((c) => (v - c) * (v - c))));
    const total = d2.reduce((a, b) => a + b, 0) || 1;
    let r = rand() * total;
    let idx = 0;
    for (let i = 0; i < x.length; i++) {
      r -= d2[i];
      if (r <= 0) {
        idx = i;
        break;
      }
    }
    centers.push(x[idx]);
  }
  for (let iter = 0; iter < 20; iter++) {
    const sums = new Array(k).fill(0);
    const counts = new Array(k).fill(0);
    for (const v of x) {
      let best = 0;
      let bestD = Infinity;
      for (let c = 0; c < k; c++) {
        const d = (v - centers[c]) * (v - centers[c]);
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      sums[best] += v;
      counts[best] += 1;
    }
    for (let c = 0; c < k; c++) if (counts[c] > 0) centers[c] = sums[c] / counts[c];
  }
  return centers;
}

function fitOnce(x: number[], k: number, seed: number, maxIter: number, varFloor: number): HmmModel {
  const T = x.length;
  const rand = mulberry32(seed);

  // --- Initialization from k-means ---
  const centers = kmeans1d(x, k, rand);
  const order = centers.map((c, i) => [c, i]).sort((a, b) => a[0] - b[0]).map((p) => p[1]);
  const means = order.map((i) => centers[i]);
  const variances = new Array(k).fill(0);
  const counts = new Array(k).fill(0);
  const assign = x.map((v) => {
    let best = 0;
    let bestD = Infinity;
    for (let c = 0; c < k; c++) {
      const d = (v - means[c]) * (v - means[c]);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return best;
  });
  for (let t = 0; t < T; t++) {
    const c = assign[t];
    variances[c] += (x[t] - means[c]) * (x[t] - means[c]);
    counts[c] += 1;
  }
  for (let c = 0; c < k; c++) variances[c] = Math.max(varFloor, counts[c] > 1 ? variances[c] / counts[c] : 1);

  let startProb = new Array(k).fill(1 / k);
  let transmat = Array.from({ length: k }, () => new Array(k).fill(1 / k));

  let prevLL = -Infinity;
  let gamma: number[][] = [];
  for (let iter = 0; iter < maxIter; iter++) {
    // --- E-step: log forward-backward ---
    const logStart = startProb.map((p) => Math.log(p + 1e-12));
    const logT = transmat.map((row) => row.map((p) => Math.log(p + 1e-12)));
    const logB = x.map((v) => means.map((m, i) => gaussianLogPdf(v, m, variances[i])));

    const alpha = Array.from({ length: T }, () => new Array(k).fill(0));
    for (let i = 0; i < k; i++) alpha[0][i] = logStart[i] + logB[0][i];
    for (let t = 1; t < T; t++) {
      for (let j = 0; j < k; j++) {
        const terms = new Array(k);
        for (let i = 0; i < k; i++) terms[i] = alpha[t - 1][i] + logT[i][j];
        alpha[t][j] = logsumexp(terms) + logB[t][j];
      }
    }
    const logLik = logsumexp(alpha[T - 1]);

    const beta = Array.from({ length: T }, () => new Array(k).fill(0));
    for (let t = T - 2; t >= 0; t--) {
      for (let i = 0; i < k; i++) {
        const terms = new Array(k);
        for (let j = 0; j < k; j++) terms[j] = logT[i][j] + logB[t + 1][j] + beta[t + 1][j];
        beta[t][i] = logsumexp(terms);
      }
    }

    gamma = Array.from({ length: T }, () => new Array(k).fill(0));
    for (let t = 0; t < T; t++) {
      for (let i = 0; i < k; i++) gamma[t][i] = Math.exp(alpha[t][i] + beta[t][i] - logLik);
    }

    // --- M-step ---
    const newStart = gamma[0].slice();
    const newTrans = Array.from({ length: k }, () => new Array(k).fill(0));
    const gammaSum = new Array(k).fill(0);
    for (let t = 0; t < T - 1; t++) {
      for (let i = 0; i < k; i++) {
        gammaSum[i] += gamma[t][i];
        for (let j = 0; j < k; j++) {
          newTrans[i][j] += Math.exp(alpha[t][i] + logT[i][j] + logB[t + 1][j] + beta[t + 1][j] - logLik);
        }
      }
    }
    for (let i = 0; i < k; i++) {
      const denom = gammaSum[i] || 1e-12;
      for (let j = 0; j < k; j++) newTrans[i][j] /= denom;
      const rowSum = newTrans[i].reduce((a, b) => a + b, 0) || 1;
      for (let j = 0; j < k; j++) newTrans[i][j] /= rowSum;
    }
    for (let i = 0; i < k; i++) {
      let wsum = 0;
      let msum = 0;
      for (let t = 0; t < T; t++) {
        wsum += gamma[t][i];
        msum += gamma[t][i] * x[t];
      }
      const mean = wsum > 0 ? msum / wsum : means[i];
      let vsum = 0;
      for (let t = 0; t < T; t++) vsum += gamma[t][i] * (x[t] - mean) * (x[t] - mean);
      means[i] = mean;
      variances[i] = Math.max(varFloor, wsum > 0 ? vsum / wsum : variances[i]);
    }
    startProb = newStart;
    transmat = newTrans;

    if (Math.abs(logLik - prevLL) < 1e-6) {
      prevLL = logLik;
      break;
    }
    prevLL = logLik;
  }

  const states = viterbi(x, startProb, transmat, means, variances);
  return { states, posteriors: gamma, means, variances, startProb, transmat, logLikelihood: prevLL };
}

function viterbi(x: number[], startProb: number[], transmat: number[][], means: number[], variances: number[]): number[] {
  const T = x.length;
  const k = means.length;
  const logStart = startProb.map((p) => Math.log(p + 1e-12));
  const logT = transmat.map((row) => row.map((p) => Math.log(p + 1e-12)));
  const delta = Array.from({ length: T }, () => new Array(k).fill(-Infinity));
  const psi = Array.from({ length: T }, () => new Array(k).fill(0));
  for (let i = 0; i < k; i++) delta[0][i] = logStart[i] + gaussianLogPdf(x[0], means[i], variances[i]);
  for (let t = 1; t < T; t++) {
    for (let j = 0; j < k; j++) {
      let best = -Infinity;
      let arg = 0;
      for (let i = 0; i < k; i++) {
        const v = delta[t - 1][i] + logT[i][j];
        if (v > best) {
          best = v;
          arg = i;
        }
      }
      delta[t][j] = best + gaussianLogPdf(x[t], means[j], variances[j]);
      psi[t][j] = arg;
    }
  }
  let last = 0;
  let bestVal = -Infinity;
  for (let i = 0; i < k; i++) if (delta[T - 1][i] > bestVal) {
    bestVal = delta[T - 1][i];
    last = i;
  }
  const path = new Array(T).fill(0);
  path[T - 1] = last;
  for (let t = T - 2; t >= 0; t--) path[t] = psi[t + 1][path[t + 1]];
  return path;
}

export function fitGaussianHMM(
  x: number[],
  k = 4,
  opts: { restarts?: number; maxIter?: number; varFloor?: number; seed?: number } = {},
): HmmModel {
  const { restarts = 10, maxIter = 100, varFloor = 1e-3, seed = 42 } = opts;
  let best: HmmModel | null = null;
  for (let r = 0; r < restarts; r++) {
    const model = fitOnce(x, k, seed + r * 7919, maxIter, varFloor);
    if (!best || model.logLikelihood > best.logLikelihood) best = model;
  }
  return best!;
}
