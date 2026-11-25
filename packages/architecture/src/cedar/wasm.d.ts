// A .wasm?module import is a compiled module in workerd (see load-workerd.ts).
declare module "*.wasm?module" {
  const module: WebAssembly.Module;
  export default module;
}
