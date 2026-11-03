import assert from "node:assert/strict";
import { test } from "node:test";
import { alignedRowOffset, layoutGeometry, makeRow, rowLength } from "./layout.ts";

test("alignment uses actual bay lengths and the neighbour's starting offset", () => {
  const neighbour = makeRow("Left", 7, 3, 6, 4, 0);
  neighbour.bays[1].lengthM = 11; // 23 m, not three uniform 6 m bays
  const shorter = makeRow("Right", 0, 2, 4, 4, 0); // 8 m
  assert.equal(alignedRowOffset(rowLength(shorter), neighbour, "top"), 7);
  assert.equal(alignedRowOffset(rowLength(shorter), neighbour, "centre"), 14.5);
  shorter.offsetM = alignedRowOffset(rowLength(shorter), neighbour, "bottom");
  assert.equal(shorter.offsetM, 22);
  const geometry = layoutGeometry({ rows: [neighbour, shorter] });
  assert.equal(geometry.rows[0].y + geometry.rows[0].h, 30);
  assert.equal(geometry.rows[1].y + geometry.rows[1].h, 30);
  neighbour.bays[0].lengthM = 9;
  assert.equal(shorter.offsetM, 22, "alignment does not create a live link");
});

test("alignment handles first rows, equal lengths, and a longer new row", () => {
  const neighbour = makeRow("Left", 12, 2, 6, 4, 0);
  for (const alignment of ["top", "centre", "bottom"] as const) {
    assert.equal(alignedRowOffset(12, undefined, alignment), 0);
    assert.equal(alignedRowOffset(12, neighbour, alignment), 12);
  }
  assert.equal(alignedRowOffset(30, neighbour, "centre"), 3);
  assert.equal(alignedRowOffset(30, neighbour, "bottom"), 0);
  neighbour.offsetM = 999;
  assert.equal(alignedRowOffset(2, neighbour, "bottom"), 1000);
});
