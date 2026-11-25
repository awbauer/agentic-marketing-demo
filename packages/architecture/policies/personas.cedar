// What people may do in the workbench. Which transition a person may take is the state
// machine's check; here the gateway lets them ask.

@id("persona-read")
@note("Every signed-in persona can read and ask for drafts.")
permit (principal is Persona, action == Action::"call", resource is Capability)
when { ["read", "draft"].contains(resource.risk) };

@id("persona-transition")
@note("Any persona may attempt a transition; the state machine decides which one.")
permit (principal is Persona, action == Action::"call", resource is Capability)
when { ["transition", "propose_transition"].contains(resource.name) };

// Compliance owns the evidence, so it owns a claim's supersession.
@id("persona-supersede-claim")
@note("Compliance owns the evidence, so it owns a claim's supersession.")
permit (principal is Persona, action == Action::"call", resource == Capability::"supersede_claim")
when {
  [Persona::"compliance", Persona::"admin"].contains(principal) &&
  (if context has target && context.target has kind then context.target.kind == "claim" else true)
};

@id("persona-accept-optimization")
@note("The brand lead disposes on optimization.")
permit (principal is Persona, action == Action::"call", resource == Capability::"accept_optimization")
when { [Persona::"brand-lead", Persona::"admin"].contains(principal) };
