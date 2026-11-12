// WebKit on Linux can leave an async WebAssembly.instantiate() pending forever
// while the worker idles, which stalls Pyodide startup. Workers may compile
// synchronously, and that path does not hang.
export function instantiateSynchronously(wasm: typeof WebAssembly): void {
  const instantiate = wasm.instantiate.bind(wasm);
  const compile = (
    source: BufferSource | WebAssembly.Module,
    imports?: WebAssembly.Imports,
  ): Promise<
    WebAssembly.WebAssemblyInstantiatedSource | WebAssembly.Instance
  > => {
    if (source instanceof wasm.Module) return instantiate(source, imports);
    const module = new wasm.Module(source);
    const instance = new wasm.Instance(module, imports);
    return Promise.resolve({ module, instance });
  };
  Object.assign(wasm, {
    instantiate: compile,
    instantiateStreaming: async (
      response: Response | PromiseLike<Response>,
      imports?: WebAssembly.Imports,
    ) => compile(await (await response).arrayBuffer(), imports),
  });
}
