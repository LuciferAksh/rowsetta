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
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
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

test.describe('saved browser labels', () => {
  // Exercise the WASM/lite path without downloading the WebGPU teacher.
  test.use({ userAgent: 'Rowsetta label recovery test' });
  test('restores labels after reload and reopening the same file and target', async ({
    page,
  }, testInfo) => {
    const errors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    page.on('pageerror', (error) => errors.push(error.message));
    const file = {
      name: 'labels.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from('x,y\n1,\n2,\n3,\n4,\n'),
    };
    async function open() {
      await page.locator('input[type=file]').setInputFiles(file);
      await expect(
        page.getByText('Opened labels.csv.', { exact: true }),
      ).toBeVisible();
      await page.getByLabel('New target name', { exact: true }).fill('y');
      await page
        .getByLabel('Classes, separated by commas', { exact: true })
        .fill('yes, no');
      await page
        .getByRole('button', { name: 'Create target', exact: true })
        .click();
      await expect(page.locator('.appbar')).toContainText('target: y');
    }
    await page.goto('/');
    await expect(
      page.getByText('Browser runtime ready.', { exact: true }),
    ).toBeVisible();
    await open();
    const first = page
      .getByRole('table')
      .locator('tbody')
      .getByRole('button')
      .first();
    await first.focus();
    await page.keyboard.press('1');
    await expect(first).toHaveText('Labelled yes');
    await page.reload();
    await expect(
      page.getByText('Browser runtime ready.', { exact: true }),
    ).toBeVisible();
    await open();
    const saved = page.getByRole('region', { name: 'Saved labels' });
    await expect(saved).toContainText('1 saved label');
    await saved.scrollIntoViewIfNeeded();
    await expect(
      saved.getByRole('button', { name: 'Restore labels', exact: true }),
    ).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('restore-desktop.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await saved.scrollIntoViewIfNeeded();
    await expect(
      saved.getByRole('button', { name: 'Discard saved labels', exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(390);
    await page.screenshot({ path: testInfo.outputPath('restore-mobile.png') });
    await testInfo.attach('restore-controls', {
      body: await saved.ariaSnapshot(),
      contentType: 'text/plain',
    });
    await page.setViewportSize({ width: 1280, height: 720 });
    await expect(first).toHaveText('Unlabelled');
    await saved
      .getByRole('button', { name: 'Restore labels', exact: true })
      .click();
    await expect(first).toHaveText('Labelled yes');
    await expect(saved).toHaveCount(0);
    await expect(page.getByText(/^Target: y/)).toContainText('1 human labels');
    await page.screenshot({
      path: testInfo.outputPath('labels-restored.png'),
      fullPage: true,
    });
    await page.reload();
    await expect(
      page.getByText('Browser runtime ready.', { exact: true }),
    ).toBeVisible();
    await open();
    await saved
      .getByRole('button', { name: 'Discard saved labels', exact: true })
      .click();
    await expect(first).toHaveText('Unlabelled');
    await expect(saved).toHaveCount(0);
    await page.reload();
    await expect(
      page.getByText('Browser runtime ready.', { exact: true }),
    ).toBeVisible();
    await open();
    await expect(saved).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});

test('successful runtime startup emits no console errors', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(
    page.getByText('Browser runtime ready.', { exact: true }),
  ).toBeVisible();
  if (testInfo.project.name === 'chromium') {
    await expect(page.locator('.appbar')).toContainText('TabICLv2 (WebGPU)');
  }
  expect(errors).toEqual([]);
});

test.describe('browser export health', () => {
  test.use({ userAgent: 'Rowsetta export recovery test' });
  test('dbt identifier errors preserve the browser runtime and recover with SQL', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(
      page.getByText('Browser runtime ready.', { exact: true }),
    ).toBeVisible();
    await page.locator('input[type=file]').setInputFiles({
      name: 'risk.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(
        `x\n${Array.from({ length: 20 }, (_, row) => String(row)).join('\n')}\n`,
      ),
    });
    await page
      .getByLabel('New target name', { exact: true })
      .fill('Risk category');
    await page
      .getByLabel('Classes, separated by commas', { exact: true })
      .fill('a, b');
    await page
      .getByRole('button', { name: 'Create target', exact: true })
      .click();
    await expect(page.locator('.appbar')).toContainText(
      'target: Risk category',
    );
    const cells = page.locator('tbody button.chip');
    for (const [row, key] of [
      [0, '1'],
      [1, '1'],
      [2, '1'],
      [17, '2'],
      [18, '2'],
      [19, '2'],
    ] as const) {
      await cells.nth(row).focus();
      await page.keyboard.press(key);
      await expect(cells.nth(row)).toHaveText(
        `Labelled ${key === '1' ? 'a' : 'b'}`,
      );
    }
    const panel = page.getByRole('region', { name: 'Export' });
    await expect(
      panel.getByRole('button', { name: 'Export rule' }),
    ).toBeEnabled();
    await panel.getByRole('button', { name: 'Export rule' }).click();
    await expect(panel.locator('pre')).toContainText('SELECT');
    await panel.getByRole('radio', { name: 'dbt', exact: true }).check();
    await expect(panel.getByRole('alert')).toContainText('dbt identifier');
    await expect(
      page.getByRole('complementary', { name: 'Browser runtime' }),
    ).toContainText('Browser runtime ready.');
    await expect(page.locator('.appbar')).toContainText('model up to date');
    await expect(
      page.getByRole('button', { name: 'Retry by reloading' }),
    ).toHaveCount(0);
    await panel.getByRole('radio', { name: 'SQL', exact: true }).check();
    await expect(panel.getByRole('alert')).toHaveCount(0);
    await expect(panel.locator('pre')).toContainText('SELECT');
  });
});
