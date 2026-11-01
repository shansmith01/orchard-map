import { defineSeed } from "void/seed";
import { makeRow } from "../lib/layout";
import type { Layout } from "../lib/layout";

// Irregular block loosely based on the hand-drawn "green girl / blue boy" sketch:
// later rows start further down and rows end at different lengths.
function sampleLayout(): Layout {
  const shape = [
    { offsetM: 0, bays: 13 },
    { offsetM: 0, bays: 13 },
    { offsetM: 0, bays: 12 },
    { offsetM: 12, bays: 10 },
    { offsetM: 18, bays: 9 },
    { offsetM: 18, bays: 8 },
    { offsetM: 24, bays: 6 },
    { offsetM: 24, bays: 7 },
  ];
  const rows = shape.map((s, i) => makeRow(`Row ${i + 1}`, s.offsetM, s.bays, 6, 4, 2));
  rows.forEach((row, r) =>
    row.bays.forEach((bay, b) => {
      // A male on alternating sides every third bay.
      if ((b + r) % 3 === 0) bay.vines[(b % 2) * 2].sex = "male";
    }),
  );
  rows[3].bays[2].vines[1].status = "psa";
  rows[3].bays[2].vines[1].note = "PSA – cut back";
  rows[4].bays[0].vines[3].status = "dead";
  rows[5].bays[1].vines[0].status = "new";
  rows[6].bays[3].vines[2].status = "unknown";
  return { rows };
}

export default defineSeed<typeof import("./schema")>(async ({ db, schema }) => {
  const [orchard] = await db.insert(schema.orchards).values({ name: "Te Puke demo orchard" }).returning();
  await db.insert(schema.blocks).values({ orchardId: orchard.id, name: "Block 1", layout: sampleLayout() });
});
