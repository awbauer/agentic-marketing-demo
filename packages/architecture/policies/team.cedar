// The campaign team (packages/architecture/src/team.ts): each agent's own tools, and the
// decisions only people take. The gateway links the grant template once per team agent with
// tools, as team-<id>. squad.cedar and lifecycle.cedar narrow what a spoke may use in a squad
// run and at each lifecycle step.

@id("team-grants")
@note("{agent} may call its own tools: {grants}.")
permit (principal is Agent in ?principal, action == Action::"call", resource is TeamTool)
when { principal.grants.contains(resource.name) };

// People in the loop. Each decision is taken by a person in the browser, acting as one of these
// roles; agents hold none of them (and forbid-agent-decisions refuses them anyway).

@id("team-person-compliance")
@note("Only a compliance reviewer takes the compliance review decision.")
permit (principal is Persona, action == Action::"call", resource == TeamTool::"decide_compliance")
when { [Persona::"compliance", Persona::"admin"].contains(principal) };

@id("team-person-client")
@note("Only a client (played by the brand lead) takes the client approval decision.")
permit (principal is Persona, action == Action::"call", resource == TeamTool::"decide_proposal")
when { [Persona::"brand-lead", Persona::"admin"].contains(principal) };

@id("team-person-focus")
@note("Only a brand lead takes the choose the focus area decision.")
permit (principal is Persona, action == Action::"call", resource == TeamTool::"decide_focus")
when { [Persona::"brand-lead", Persona::"admin"].contains(principal) };

@id("team-person-concept")
@note("Only a brand lead takes the choose the concept decision.")
permit (principal is Persona, action == Action::"call", resource == TeamTool::"decide_concept")
when { [Persona::"brand-lead", Persona::"admin"].contains(principal) };

@id("team-person-concept-review")
@note("Only a medical reviewer takes the early concept review decision.")
permit (principal is Persona, action == Action::"call", resource == TeamTool::"review_concept")
when { [Persona::"reviewer", Persona::"admin"].contains(principal) };

@id("team-person-medical")
@note("Only a medical reviewer takes the medical review decision.")
permit (principal is Persona, action == Action::"call", resource == TeamTool::"review_medical")
when { [Persona::"reviewer", Persona::"admin"].contains(principal) };

@id("team-person-legal")
@note("Only a legal reviewer takes the legal review decision.")
permit (principal is Persona, action == Action::"call", resource == TeamTool::"review_legal")
when { [Persona::"senior", Persona::"admin"].contains(principal) };

@id("team-person-regulatory")
@note("Only a regulatory reviewer takes the regulatory review and approval decision.")
permit (principal is Persona, action == Action::"call", resource == TeamTool::"review_regulatory")
when { [Persona::"compliance", Persona::"admin"].contains(principal) };

@id("team-person-audience")
@note("Only a marketing operations lead takes the approve the hcp list decision.")
permit (principal is Persona, action == Action::"call", resource == TeamTool::"approve_audience")
when { [Persona::"marketer", Persona::"admin"].contains(principal) };

@id("team-person-go-live")
@note("Only a brand lead takes the approve go-live decision.")
permit (principal is Persona, action == Action::"call", resource == TeamTool::"approve_go_live")
when { [Persona::"brand-lead", Persona::"admin"].contains(principal) };

@id("team-person-fda-2253")
@note("Only a regulatory reviewer takes the submit form fda 2253 decision.")
permit (principal is Persona, action == Action::"call", resource == TeamTool::"submit_2253")
when { [Persona::"compliance", Persona::"admin"].contains(principal) };

@id("team-person-next-action")
@note("Only a brand lead takes the decide the next action decision.")
permit (principal is Persona, action == Action::"call", resource == TeamTool::"decide_next_action")
when { [Persona::"brand-lead", Persona::"admin"].contains(principal) };
