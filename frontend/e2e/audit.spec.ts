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
  const first = suspects.first().getByRole('button');
  await expect(first).toContainText('Row 0: labelled Gentoo');

  await first.click();
  const focused = page.locator('tbody tr', {
    has: page.locator('button:focus'),
  });
  await expect(focused.getByRole('rowheader')).toHaveText('0');
});
