import { loadTabular } from 'forecast-web/tabular';

export async function loadTeacher(weights: string, nEstimators: number) {
  return loadTabular({
    task: 'classification',
    weights,
    nEstimators,
    dtype: 'fp16',
    device: 'webgpu',
    worker: false,
    cache: false,
  });
}
