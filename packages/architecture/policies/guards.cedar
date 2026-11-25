// Guards that hold for every call, whoever makes it. A forbid beats any permit, so nothing
// written in another file can open these up.

// Brand scope reaches every call: a person working on one brand, or an agent acting for them,
// cannot touch another brand's objects or call another brand's tools.
@id("forbid-out-of-scope-brand")
@note("{brand} is outside this user's brand scope.")
forbid (principal, action == Action::"call", resource)
when {
  context has target &&
  context.target has brand &&
  !context.brands.contains("all") &&
  !context.brands.contains(context.target.brand)
};

// Agents propose; only a person decides, so no agent can hold a decision action, even one a
// registry grants by mistake.
@id("forbid-agent-decisions")
@note("Agents propose; only a person decides, so no agent can hold a decision action.")
forbid (principal is Agent, action == Action::"call", resource)
when { resource has risk && resource.risk == "decide" };

// The operator's kill switch and a retired lifecycle withhold everything an agent could do.
@id("forbid-withheld-agent")
@note("{agent} is withheld by an operator ({lifecycle}, or switched off), so it may call nothing.")
forbid (principal is Agent, action == Action::"call", resource)
when { principal.disabled || principal.lifecycle == "retire" };
