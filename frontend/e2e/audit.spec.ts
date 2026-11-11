import { expect, test } from '@playwright/test';
import { openPenguins } from './session';

test('checking an existing column lists a wrong label first and opens its row', async ({
  page,
}) => {
  const cells = await openPenguins(page);
  await page.getByLabel('Existing column').selectOption('species');
  await page.getByRole('button', { name: 'Use its values as labels' }).click();
  await expect(cells.first()).toHaveText('Labelled Adelie');
  const relabel = await page.request.put('/labels/0', {
    data: { label: 'Gentoo', mode: 'human' },
  });
  expect(relabel.ok()).toBe(true);
  await page.reload();
  await expect(cells.first()).toHaveText('Labelled Gentoo');

  await page.getByRole('button', { name: 'Check these' }).click();

  const list = page.getByRole('region', { name: 'Check existing labels' });
  const suspects = list.getByRole('listitem');
  await expect(suspects).toHaveCount(10);
  const first = suspects.first().locator('button.main');
  await expect(first).toContainText('Row 0 · Gentoo →');

  await first.click();
  const focused = page.locator('tbody tr', {
    has: page.locator('button:focus'),
  });
  await expect(focused.getByRole('rowheader')).toHaveText('0');
});

test('interrupting the marker pass shows every slip at once', async ({
  page,
}) => {
  await openPenguins(page);
  await page.getByLabel('Existing column').selectOption('species');
  await page.getByRole('button', { name: 'Use its values as labels' }).click();
  await page.request.put('/labels/0', {
    data: { label: 'Gentoo', mode: 'human' },
  });
  await page.reload();
  await page.getByRole('button', { name: 'Check these' }).click();
  const list = page.getByRole('region', { name: 'Check existing labels' });
  await expect(list.getByRole('listitem').first()).toBeVisible();
  await page.keyboard.press('Shift');
  // The full pass takes several seconds; an interrupt must not wait for it.
  await expect(list.getByRole('listitem').last()).toBeVisible({ timeout: 400 });
});
