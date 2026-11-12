import { expect, test } from '@playwright/test';

test('a runtime download failure preserves early labels and offers recovery', async ({
  page,
}) => {
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/browser/runtime/pyodide.asm.wasm', async (route) => {
    await held;
    await route.abort('failed');
  });
  await page.goto('/');
  const first = page
    .getByRole('table')
    .locator('tbody')
    .getByRole('button')
    .first();
  await expect(first).toHaveText('Unlabelled');
  await first.focus();
  await page.keyboard.press('1');
  await expect(first).toHaveText('Labelled Adelie');
  release();
  await expect(page.getByRole('alert')).toContainText('Reload this page');
  await expect(first).toHaveText('Labelled Adelie');
});

test('static demo queues labels, predicts and exports SQL without data egress', async ({
  page,
}, testInfo) => {
  const requests: { method: string; url: string; data: string | null }[] = [];
  const errors: string[] = [];
  page.on('request', (request) =>
    requests.push({
      method: request.method(),
      url: request.url(),
      data: request.postData(),
    }),
  );
  page.on('pageerror', (error) => {
    errors.push(error.message);
    console.error(error.message);
  });
  // Hold the runtime while exercising the labelable static table.
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/browser/runtime/pyodide.asm.wasm', async (route) => {
    await held;
    await route.continue();
  });
  await page.goto('/');
  await expect(page.getByRole('table')).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Use its values as labels' }),
  ).toHaveCount(0);
  const cells = page.getByRole('table').locator('tbody').getByRole('button');
  let currentPage = 0;
  for (const [row, key] of [
    [0, '1'],
    [1, '1'],
    [152, '3'],
    [153, '3'],
    [276, '2'],
    [277, '2'],
  ] as const) {
    const targetPage = Math.floor(row / 100);
    while (currentPage < targetPage) {
      await page.getByRole('button', { name: 'Next page' }).click();
      currentPage++;
      await expect(page.getByRole('rowheader').first()).toHaveText(
        String(currentPage * 100),
      );
    }
    const cell = cells.nth(row % 100);
    await cell.focus();
    await page.keyboard.press(key);
    await expect(cell).toHaveText(/Labelled/);
  }
  await expect(
    page.getByText('Label rows now;', { exact: false }),
  ).toBeVisible();
  release();
  await expect(page.getByRole('status')).toHaveText('Proposals updated');
  await expect(cells.nth(6)).toHaveText(/^(Proposed|Unsure)/);
  await page.getByRole('button', { name: 'Export rule', exact: true }).click();
  const sql = page.locator('pre');
  await expect(sql).toContainText('SELECT');
  const fullModel =
    (await page
      .locator('.appbar')
      .getByText('TabICLv2 (WebGPU)', { exact: true })
      .count()) > 0;
  if (testInfo.project.name === 'chromium') expect(fullModel).toBe(true);
  await expect(sql).toContainText(
    fullModel
      ? 'TabICLv2 (WebGPU)'
      : 'lite model (random forest), not TabICLv2',
  );
  if (fullModel) {
    expect(
      await page.evaluate(async () =>
        Boolean(await navigator.gpu.requestAdapter()),
      ),
    ).toBe(true);
    expect(
      requests.some((request) => request.url.includes('/weights/onnx/')),
    ).toBe(true);
  } else {
    expect(requests.some((request) => request.url.includes('/weights/'))).toBe(
      false,
    );
  }
  await expect(sql).toContainText('browser demo');
  await page.screenshot({
    path: testInfo.outputPath('browser-demo.png'),
    fullPage: true,
  });
  await testInfo.attach('requests', {
    body: JSON.stringify(requests, null, 2),
    contentType: 'application/json',
  });
  expect(errors).toEqual([]);
  expect(requests.length).toBeGreaterThan(10);
  for (const request of requests) {
    expect(request.method).toBe('GET');
    expect(request.data).toBeNull();
    expect(new URL(request.url).origin).toBe('http://127.0.0.1:4173');
    expect(new URL(request.url).search).toBe('');
    expect(request.url).not.toMatch(/huggingface|hf\.co|spike/);
  }
});
