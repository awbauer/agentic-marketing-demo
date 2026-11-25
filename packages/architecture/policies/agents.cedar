// The architecture agents' grants. The registry (packages/architecture/src/registry.ts) names
// each agent's grants and scope; the gateway links this template once per live agent with
// grants, as agent-<id>, and fills the agent's attributes from the registry and the operator's
// overrides. What an agent is offered and what it may call are both this decision.

@id("agent-grants")
@note("{agent} ({lifecycle}) may call its registered grants on {scope}.")
permit (principal is Agent in ?principal, action == Action::"call", resource is Capability)
when {
  principal.grants.contains(resource.name) &&
  // A call that names an object must name one of the agent's kind.
  (
    principal.scope == "any" ||
    (if context has target && context.target has kind then context.target.kind == principal.scope else true)
  )
};
