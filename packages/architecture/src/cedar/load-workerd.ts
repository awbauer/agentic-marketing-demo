// workerd (the Worker and its tests): the Cloudflare Vite plugin and the Workers test pool turn a
// .wasm import into a compiled WebAssembly.Module, which the web build instantiates
// synchronously. The package's exports hide the .wasm, so it is imported by path; the root
// node_modules holds it (pnpm add -w).
import * as cedarWeb from "@cedar-policy/cedar-wasm/web";
import cedarWasm from "../../../../node_modules/@cedar-policy/cedar-wasm/web/cedar_wasm_bg.wasm?module";
import type { CedarEngine } from "./engine.ts";

export function loadCedar(): CedarEngine {
  cedarWeb.initSync({ module: cedarWasm });
  return cedarWeb;
}
