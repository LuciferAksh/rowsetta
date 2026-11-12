import { describe, expect, it } from 'vitest';
import { instantiateSynchronously } from '../src/browser/wasm';

const empty = new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0]);

describe('instantiateSynchronously', () => {
  it('instantiates bytes without the async engine path', async () => {
    const fake = Object.create(WebAssembly) as typeof WebAssembly;
    Object.assign(fake, {
      Module: WebAssembly.Module,
      Instance: WebAssembly.Instance,
      instantiate: () => new Promise(() => {}),
    });
    instantiateSynchronously(fake);
    const { module, instance } = await fake.instantiate(empty);
    expect(module).toBeInstanceOf(WebAssembly.Module);
    expect(instance).toBeInstanceOf(WebAssembly.Instance);
  });

  it('streams a response through the same path', async () => {
    const fake = Object.create(WebAssembly) as typeof WebAssembly;
    Object.assign(fake, {
      Module: WebAssembly.Module,
      Instance: WebAssembly.Instance,
    });
    instantiateSynchronously(fake);
    const { instance } = await fake.instantiateStreaming(new Response(empty));
    expect(instance).toBeInstanceOf(WebAssembly.Instance);
  });
});
