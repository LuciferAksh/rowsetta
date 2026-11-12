import { expect, test, vi } from 'vitest';
import { loadTeacher } from '../src/browser/teacher';

const mocks = vi.hoisted(() => ({
  predict: vi.fn((rows: unknown[][]) =>
    Promise.resolve(rows.map(() => [0.25, 0.75])),
  ),
  load: vi.fn(),
}));
vi.mock('forecast-web/tabular', () => ({ loadTabular: mocks.load }));

test('uses the native seed and bounds each WebGPU prediction batch', async () => {
  const fit = vi.fn(() => ({
    classes: ['a', 'b'],
    predictProba: mocks.predict,
  }));
  mocks.load.mockResolvedValue({ backend: 'webgpu', fit, dispose: vi.fn() });
  const teacher = await loadTeacher('/weights', 4);
  const fitted = teacher.fit([[1], [2]], ['a', 'b']);
  const rows = Array.from({ length: 2000 }, (_, i) => [i]);
  const probabilities = await fitted.predictProba(rows);
  expect(mocks.load).toHaveBeenCalledWith(
    expect.objectContaining({ randomState: 7 }),
  );
  expect(mocks.predict.mock.calls.map(([batch]) => batch.length)).toEqual([
    500, 500, 500, 500,
  ]);
  expect(mocks.predict.mock.calls.flatMap(([batch]) => batch)).toEqual(rows);
  expect(probabilities).toEqual(rows.map(() => [0.25, 0.75]));
  expect(fitted.classes).toEqual(['a', 'b']);
});

test('keeps unsupported WebGPU implementations on the lite fallback', async () => {
  const { supportsBrowserTeacher } = await import('../src/browser/config');
  expect(
    supportsBrowserTeacher('Mozilla/5.0 Chrome/142.0.0.0 Safari/537.36'),
  ).toBe(true);
  expect(
    supportsBrowserTeacher('Mozilla/5.0 Chrome/142.0.0.0 Edg/142.0.0.0'),
  ).toBe(true);
  expect(
    supportsBrowserTeacher('Mozilla/5.0 Version/26.0 Safari/605.1.15'),
  ).toBe(false);
  expect(supportsBrowserTeacher('Mozilla/5.0 Firefox/145.0')).toBe(false);
  expect(
    supportsBrowserTeacher('Mozilla/5.0 CriOS/142.0.0.0 Mobile Safari/604.1'),
  ).toBe(false);
});
