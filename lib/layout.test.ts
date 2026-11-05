import assert from "node:assert/strict";
import { test } from "node:test";
import { alignedRowOffset, layoutGeometry, makeRow, migrateLayout, rowLength, setBayLength, type StoredLayout } from "./layout.ts";

test("alignment uses actual bay lengths and the neighbour's starting offset", () => {
  const neighbour = makeRow("Left", 7, 3, 6, 0);
  neighbour.bays[1].lengthM = 11; // 23 m, not three uniform 6 m bays
  const shorter = makeRow("Right", 0, 2, 4, 0); // 8 m
  assert.equal(alignedRowOffset(rowLength(shorter), neighbour, "top"), 7);
  assert.equal(alignedRowOffset(rowLength(shorter), neighbour, "centre"), 14.5);
  shorter.offsetM = alignedRowOffset(rowLength(shorter), neighbour, "bottom");
  assert.equal(shorter.offsetM, 22);
  const geometry = layoutGeometry({ rowSpacingM: 4, rows: [neighbour, shorter] });
  assert.equal(geometry.rows[0].y + geometry.rows[0].h, 30);
  assert.equal(geometry.rows[1].y + geometry.rows[1].h, 30);
  neighbour.bays[0].lengthM = 9;
  assert.equal(shorter.offsetM, 22, "alignment does not create a live link");
});

test("alignment handles first rows, equal lengths, and a longer new row", () => {
  const neighbour = makeRow("Left", 12, 2, 6, 0);
  for (const alignment of ["top", "centre", "bottom"] as const) {
    assert.equal(alignedRowOffset(12, undefined, alignment), 0);
    assert.equal(alignedRowOffset(12, neighbour, alignment), 12);
  }
  assert.equal(alignedRowOffset(30, neighbour, "centre"), 3);
  assert.equal(alignedRowOffset(30, neighbour, "bottom"), 0);
  neighbour.offsetM = 999;
  assert.equal(alignedRowOffset(2, neighbour, "bottom"), 1000);
});

test("a legacy strip becomes one row per side, keeping every vine on its own side", () => {
  const vine = (id: string, x: number, y: number, sex: "female" | "male" = "female") => ({ id, sex, status: "ok" as const, note: "", x, y });
  const legacy: StoredLayout = {
    rows: [
      {
        id: "r1",
        name: "Row 1",
        offsetM: 6,
        bays: [
          { id: "b1", lengthM: 5, widthM: 3.5, vines: [vine("v1", 0.85, 0.25, "male"), vine("v2", 0.15, 0.25), vine("v3", 0.11, 0.75)] },
          { id: "b2", lengthM: 7, widthM: 3.5, vines: [vine("v4", 0.85, 0.5)] },
        ],
      },
    ],
  };
  const layout = migrateLayout(legacy);
  assert.equal(layout.rowSpacingM, 3.5);
  assert.deepEqual(layout.rows.map((r) => [r.id, r.name, r.offsetM]), [["r1", "Row 1 left", 6], ["r1-right", "Row 1 right", 6]]);
  const vineIds = layout.rows.map((r) => r.bays.map((b) => b.vines.map((v) => v.id)));
  assert.deepEqual(vineIds, [[["v2", "v3"], []], [["v1"], ["v4"]]]);
  assert.deepEqual(layout.rows[1].bays.map((b) => b.lengthM), [5, 7]);
  assert.deepEqual(layout.rows[1].bays[0].vines[0], { id: "v1", sex: "male", status: "ok", note: "", y: 0.25 });
  assert.equal(migrateLayout(layout), layout, "a converted layout is left alone");
  assert.deepEqual(migrateLayout(legacy), layout, "converting again gives the same ids");
});

test("bays are the cells between neighbouring rows wherever both have posts at the same two positions", () => {
  const a = makeRow("A", 0, 3, 6, 2); // posts at 0, 6, 12, 18
  const b = makeRow("B", 6, 2, 6, 2); // posts at 6, 12, 18
  const c = makeRow("C", 3, 2, 6, 2); // staggered: posts at 3, 9, 15
  const geo = layoutGeometry({ rowSpacingM: 4, rows: [a, b, c] });
  assert.deepEqual(
    geo.bays.map((g) => [g.left.row.name, g.right.row.name, g.x, g.y, g.w, g.h]),
    [["A", "B", 2, 6, 4, 6], ["A", "B", 2, 12, 4, 6]],
  );
  assert.equal(geo.spans.length, 7, "every row's spans keep their vines");
});

test("changing a bay's length moves every post below it, in every row", () => {
  const a = makeRow("A", 0, 3, 6, 0); // posts at 0, 6, 12, 18
  const b = makeRow("B", 6, 2, 6, 0); // posts at 6, 12, 18
  const d = makeRow("D", 12, 1, 6, 0); // starts below the bay being changed
  const layout = { rowSpacingM: 4, rows: [a, b, d] };
  setBayLength(layout, 6, 6, 8.5);
  assert.deepEqual(a.bays.map((x) => x.lengthM), [6, 8.5, 6]);
  assert.deepEqual(b.bays.map((x) => x.lengthM), [8.5, 6]);
  assert.equal(b.offsetM, 6);
  assert.equal(d.offsetM, 14.5);
  assert.equal(layoutGeometry(layout).bays.length, 3, "posts still line up, so every bay survives");
});
