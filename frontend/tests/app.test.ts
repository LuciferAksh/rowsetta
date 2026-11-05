import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import App from '../src/App.svelte';

describe('application skeleton', () => {
  it('identifies the provisional name and development status', () => {
    const { body } = render(App);

    expect(body).toContain('<main>');
    expect(body).toContain('Tabular Studio (working title)');
    expect(body).toContain('The application is under development.');
  });
});
