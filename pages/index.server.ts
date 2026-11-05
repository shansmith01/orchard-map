import { defineHandler, type InferProps } from "void";
import { asc, db } from "void/db";
import { blocks, orchards } from "@schema";
import { z } from "zod";
import { layoutGeometry, migrateLayout } from "../lib/layout";

export type Props = InferProps<typeof loader>;

export const loader = defineHandler(async () => {
  const [orchardRows, blockRows] = await Promise.all([
    db.select().from(orchards).orderBy(asc(orchards.name)),
    db
      .select({ id: blocks.id, orchardId: blocks.orchardId, name: blocks.name, layout: blocks.layout, updatedAt: blocks.updatedAt })
      .from(blocks)
      .orderBy(asc(blocks.name)),
  ]);
  return {
    orchards: orchardRows.map((o) => ({
      ...o,
      blocks: blockRows
        .filter((b) => b.orchardId === o.id)
        .map(({ layout: stored, ...b }) => {
          const layout = migrateLayout(stored);
          return {
            ...b,
            rowCount: layout.rows.length,
            bayCount: layoutGeometry(layout).bays.length,
          };
        }),
    })),
  };
});

const name = z.string().trim().min(1).max(100);

export const actions = {
  createOrchard: defineHandler.withValidator({ body: z.object({ name }) })(async (_c, { body }) => {
    await db.insert(orchards).values(body);
  }),
  createBlock: defineHandler.withValidator({ body: z.object({ name, orchardId: z.coerce.number().int() }) })(
    async (c, { body }) => {
      const [block] = await db.insert(blocks).values(body).returning({ id: blocks.id });
      return c.redirect(`/blocks/${block.id}`);
    },
  ),
};
