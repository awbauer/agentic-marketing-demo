// Node (the Google Cloud server, its tests, the unit tests and the scripts): the package's nodejs
// build reads its .wasm beside it and instantiates synchronously. It is required lazily, through
// Node's own require, so no bundler tries to inline it and a browser bundle never runs it.
import type { CedarEngine } from "./engine.ts";

type NodeProcess = { getBuiltinModule?: (id: string) => unknown };
type NodeModule = { createRequire(from: string): (id: string) => unknown };

export function loadCedar(): CedarEngine {
  const node = (globalThis as { process?: NodeProcess }).process;
  if (!node?.getBuiltinModule)
    throw new Error("The Cedar engine runs on the server, not in the browser.");
  const { createRequire } = node.getBuiltinModule("node:module") as NodeModule;
  return createRequire(import.meta.url)("@cedar-policy/cedar-wasm/nodejs") as CedarEngine;
}
