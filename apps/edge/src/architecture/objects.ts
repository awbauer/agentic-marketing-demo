// Reading and saving governed objects for the operations and the agents' tools.
import { type GovernedObject, getObject, type World } from "@northstar/architecture";
import { ArchError, type Ctx } from "./context";

export const ISO = (ctx: Ctx) => ctx.now().toISOString();

export async function worldFor(ctx: Ctx) {
  return ctx.store.loadWorld(ctx.now());
}

export function need(world: World, urn: unknown, kind?: GovernedObject["kind"]): GovernedObject {
  if (typeof urn !== "string") throw new ArchError(400, "BAD_REQUEST", "A urn is required.");
  const object = getObject(world, urn);
  if (!object) throw new ArchError(404, "NOT_FOUND", `${urn} is not a governed object.`);
  if (kind && object.kind !== kind)
    throw new ArchError(400, "BAD_REQUEST", `${urn} is a ${object.kind}, not a ${kind}.`);
  return object;
}

/**
 * Saves new objects. An object that already exists is never overwritten: the same content is a
 * no-op, and different content is a conflict, so approved text can't change without a new review.
 */
export async function persist(ctx: Ctx, world: World, objects: readonly GovernedObject[]) {
  for (const object of objects) {
    const existing = getObject(world, object.urn);
    if (existing && JSON.stringify(existing.attributes) !== JSON.stringify(object.attributes))
      throw new ArchError(
        409,
        "CONFLICT",
        `${object.urn} already exists with different content. Supersede it as a new version instead of regenerating it.`,
        { urn: object.urn, state: existing.approvalState },
      );
  }
  await ctx.store.saveObjects(objects.filter((object) => !getObject(world, object.urn)));
}
