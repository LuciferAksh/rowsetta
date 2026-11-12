import {
  loadTabular,
  type Cell,
  type LoadTabularOptions,
} from 'forecast-web/tabular';

// Bound prediction shapes: the large WebGPU batch fails parity (ADR 0003).
export const PREDICT_BATCH_ROWS = 500;

export async function loadTeacher(
  weights: string,
  nEstimators: number,
  options: Pick<LoadTabularOptions, 'wasmPaths' | 'onProgress'> = {},
) {
  const model = await loadTabular({
    task: 'classification',
    weights,
    nEstimators,
    randomState: 7,
    dtype: 'fp16',
    device: 'webgpu',
    worker: false,
    cache: true,
    ...options,
  });
  return {
    backend: model.backend,
    dispose: () => model.dispose(),
    fit(train: Cell[][], labels: (string | number)[]) {
      const fitted = model.fit(train, labels);
      return {
        classes: fitted.classes,
        async predictProba(rows: Cell[][]): Promise<number[][]> {
          const probabilities: number[][] = [];
          for (
            let start = 0;
            start < rows.length;
            start += PREDICT_BATCH_ROWS
          ) {
            probabilities.push(
              ...(await fitted.predictProba(
                rows.slice(start, start + PREDICT_BATCH_ROWS),
              )),
            );
          }
          return probabilities;
        },
      };
    },
  };
}
