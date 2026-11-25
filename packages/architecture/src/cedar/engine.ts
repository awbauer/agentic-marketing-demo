// The seam between the gateway and the Cedar engine (@cedar-policy/cedar-wasm). Each runtime
// loads the same WebAssembly its own way, chosen by the `#cedar-runtime` import condition in
// packages/architecture/package.json: workerd imports the .wasm as a module (load-workerd.ts);
// Node, the tests and the scripts require the package's nodejs build (load-node.ts). Both load
// synchronously on first use, so evaluating a policy stays a plain function call.
import type * as CedarWasm from "@cedar-policy/cedar-wasm/nodejs";
import { loadCedar } from "#cedar-runtime";

export type CedarEngine = Pick<
  typeof CedarWasm,
  "isAuthorized" | "statefulIsAuthorized" | "preparsePolicySet" | "validate" | "getCedarVersion"
>;
export type {
  AuthorizationAnswer,
  Context as CedarContext,
  EntityJson,
  PolicySet as CedarPolicySet,
  TemplateLink,
} from "@cedar-policy/cedar-wasm/nodejs";

let engine: CedarEngine | undefined;

/** The engine, loaded once per isolate or process. */
export function cedar(): CedarEngine {
  engine ??= loadCedar();
  return engine;
}
