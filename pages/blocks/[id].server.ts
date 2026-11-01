import { defineHandler, type InferProps } from "void";
import { db, eq, sql } from "void/db";
import { blocks, orchards } from "@schema";
import { layoutSchema } from "../../lib/layout";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

export type Props = InferProps<typeof loader>;

export const loader = defineHandler(async (c) => {
  const [row] = await db
    .select({ block: blocks, orchardName: orchards.name })
    .from(blocks)
    .innerJoin(orchards, eq(orchards.id, blocks.orchardId))
    .where(eq(blocks.id, Number(c.req.param("id"))));
  if (!row) throw new HTTPException(404, { message: "Block not found" });
  return { block: row.block, orchardName: row.orchardName };
});

export const action = defineHandler.withValidator({
  body: z.object({ name: z.string().trim().min(1).max(100), layout: layoutSchema }),
})(async (c, { body }) => {
  await db
    .update(blocks)
    .set({ ...body, updatedAt: sql`(datetime('now'))` })
    .where(eq(blocks.id, Number(c.req.param("id"))));
});
