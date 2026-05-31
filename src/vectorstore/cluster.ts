export interface ClusterResult {
  clusterId: number;
  documents: {
    path: string;
    text: string;
  }[];
}

/**
 * A lightweight K-Means clustering implementation.
 */
export function kmeans(vectors: number[][], k: number, maxIterations: number = 20): number[] {
  if (vectors.length === 0) return [];
  if (k >= vectors.length) return vectors.map((_, i) => i);

  // Initialize centroids by randomly picking k vectors
  const centroids: number[][] = [];
  const chosenIndices = new Set<number>();
  while (centroids.length < k) {
    const idx = Math.floor(Math.random() * vectors.length);
    if (!chosenIndices.has(idx)) {
      chosenIndices.add(idx);
      centroids.push([...vectors[idx]]);
    }
  }

  const assignments = new Array(vectors.length).fill(0);

  for (let iter = 0; iter < maxIterations; iter++) {
    let changed = false;

    // Assign vectors to nearest centroid
    for (let i = 0; i < vectors.length; i++) {
      let minDist = Infinity;
      let bestCluster = 0;

      for (let c = 0; c < k; c++) {
        const dist = euclideanDistance(vectors[i], centroids[c]);
        if (dist < minDist) {
          minDist = dist;
          bestCluster = c;
        }
      }

      if (assignments[i] !== bestCluster) {
        assignments[i] = bestCluster;
        changed = true;
      }
    }

    if (!changed) break;

    // Update centroids
    const newCentroids = Array.from({ length: k }, () => new Array(vectors[0].length).fill(0));
    const counts = new Array(k).fill(0);

    for (let i = 0; i < vectors.length; i++) {
      const c = assignments[i];
      counts[c]++;
      for (let d = 0; d < vectors[i].length; d++) {
        newCentroids[c][d] += vectors[i][d];
      }
    }

    for (let c = 0; c < k; c++) {
      if (counts[c] > 0) {
        for (let d = 0; d < centroids[c].length; d++) {
          centroids[c][d] = newCentroids[c][d] / counts[c];
        }
      }
    }
  }

  return assignments;
}

function euclideanDistance(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const diff = a[i] - b[i];
    sum += diff * diff;
  }
  return sum;
}
