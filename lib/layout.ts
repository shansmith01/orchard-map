import { z } from "zod";

// A row is a line of posts, rowSpacingM from the next across the whole block. Its `bays` are
// the spans between neighbouring posts along it, and each span's vines are planted on the row
// between those posts at y (0 = first post, 1 = second). What a grower calls a bay is the cell
// between two neighbouring rows, a post on each corner; layoutGeometry derives those.
export const vineSexes = ["female", "male"] as const;
export const vineStatuses = ["ok", "psa", "dead", "new", "unknown"] as const;

const fraction = z.number().min(0).max(1);

export const vineSchema = z.object({
  id: z.string().min(1),
  sex: z.enum(vineSexes),
  status: z.enum(vineStatuses),
  note: z.string().max(200),
  y: fraction,
});

export const baySchema = z.object({
  id: z.string().min(1),
  lengthM: z.number().positive().max(50), // along the row
  vines: z.array(vineSchema),
});

export const rowSchema = z.object({
  id: z.string().min(1),
  name: z.string().max(50),
  offsetM: z.number().min(0).max(1000), // where the first bay starts along the row
  bays: z.array(baySchema),
});

export const layoutSchema = z.object({ rowSpacingM: z.number().positive().max(20), rows: z.array(rowSchema) });

export type Vine = z.infer<typeof vineSchema>;
export type Bay = z.infer<typeof baySchema>;
export type Row = z.infer<typeof rowSchema>;
export type Layout = z.infer<typeof layoutSchema>;

// Before rows were post lines, a row was the strip between two post lines: each bay had a
// width and vines down both sides (x < 0.5 on the left). Blocks saved then are still stored
// that way until their next save.
type LegacyLayout = {
  rows: { id: string; name: string; offsetM: number; bays: { id: string; lengthM: number; widthM: number; vines: (Vine & { x: number })[] }[] }[];
};
export type StoredLayout = Layout | LegacyLayout;

// Each side of a legacy strip becomes its own row, keeping every vine, and rows are named
// Row 1, Row 2… by position. Derived ids are deterministic so an unsaved conversion keeps
// the same ids on every load.
export function migrateLayout(layout: StoredLayout): Layout {
  if ("rowSpacingM" in layout) return renameSplitRows(layout);
  return {
    rowSpacingM: layout.rows[0]?.bays[0]?.widthM ?? 4,
    rows: layout.rows
      .flatMap((row) =>
        (["left", "right"] as const).map((side) => ({
          id: side === "left" ? row.id : `${row.id}-right`,
          offsetM: row.offsetM,
          bays: row.bays.map((bay) => ({
            id: side === "left" ? bay.id : `${bay.id}-right`,
            lengthM: bay.lengthM,
            vines: bay.vines.filter((v) => v.x < 0.5 === (side === "left")).map(({ x: _x, ...vine }) => vine),
          })),
        })),
      )
      .map((row, i) => ({ ...row, name: `Row ${i + 1}` })),
  };
}

// An earlier conversion named rows "Row 1 left", "Row 1 right"…; renames those by position.
const SPLIT_NAME = /^Row \d+ (left|right)$/;
function renameSplitRows(layout: Layout): Layout {
  if (!layout.rows.some((r) => SPLIT_NAME.test(r.name))) return layout;
  return { ...layout, rows: layout.rows.map((r, i) => (SPLIT_NAME.test(r.name) ? { ...r, name: `Row ${i + 1}` } : r)) };
}

export const rowAlignments = ["top", "centre", "bottom"] as const;
export type RowAlignment = (typeof rowAlignments)[number];

export const rowLength = (row: Row) => row.bays.reduce((sum, bay) => sum + bay.lengthM, 0);

// Alignment is a one-time offset, not a constraint linking two rows.
export function alignedRowOffset(lengthM: number, neighbour: Row | undefined, alignment: RowAlignment): number {
  if (!neighbour) return 0;
  const fraction = alignment === "top" ? 0 : alignment === "centre" ? 0.5 : 1;
  return Math.min(1000, Math.max(0, neighbour.offsetM + (rowLength(neighbour) - lengthM) * fraction));
}

export const newId = () => crypto.randomUUID();

// Vines evenly spaced between the bay's two posts.
export function makeBay(lengthM: number, vinesPerBay: number): Bay {
  const vines: Vine[] = Array.from({ length: vinesPerBay }, (_, i) => ({
    id: newId(),
    sex: "female",
    status: "ok",
    note: "",
    y: (i + 0.5) / vinesPerBay,
  }));
  return { id: newId(), lengthM, vines };
}

export function makeRow(name: string, offsetM: number, bayCount: number, lengthM: number, vinesPerBay: number): Row {
  return {
    id: newId(),
    name,
    offsetM,
    bays: Array.from({ length: bayCount }, () => makeBay(lengthM, vinesPerBay)),
  };
}

const EPS = 1e-3; // metres; post positions closer than this are the same position

// A span is the stretch of one row between two neighbouring posts, holding that row's vines there.
export type SpanGeometry = { row: Row; bay: Bay; index: number; lineX: number; y: number; h: number };
// A bay is the cell between two neighbouring rows, with a post on each corner.
export type BayGeometry = { left: SpanGeometry; right: SpanGeometry; x: number; y: number; w: number; h: number };

// Pairs the spans of two neighbouring rows that have posts at the same two positions.
export function pairSpans<T extends { y: number; h: number }>(left: T[], right: T[]): [T, T][] {
  return left.flatMap((a) => {
    const b = right.find((b) => Math.abs(b.y - a.y) < EPS && Math.abs(b.h - a.h) < EPS);
    return b ? [[a, b] as [T, T]] : [];
  });
}

// Lays rows of posts side by side rowSpacingM apart (x) and their spans end to end (y), in metres.
export function layoutGeometry(layout: Layout) {
  const spacing = layout.rowSpacingM;
  const rows: { row: Row; lineX: number; y: number; h: number; spans: SpanGeometry[] }[] = [];
  let maxY = 0;
  layout.rows.forEach((row, i) => {
    const lineX = (i + 0.5) * spacing;
    let y = row.offsetM;
    const spans = row.bays.map((bay, index) => {
      const span = { row, bay, index, lineX, y, h: bay.lengthM };
      y += bay.lengthM;
      return span;
    });
    rows.push({ row, lineX, y: row.offsetM, h: y - row.offsetM, spans });
    maxY = Math.max(maxY, y);
  });
  const bays: BayGeometry[] = rows.slice(1).flatMap((right, i) =>
    pairSpans(rows[i].spans, right.spans).map(([l, r]) => ({ left: l, right: r, x: l.lineX, y: l.y, w: spacing, h: l.h })),
  );
  return { rows, spans: rows.flatMap((r) => r.spans), bays, width: layout.rows.length * spacing, height: maxY };
}

// Posts line up across the block, so a bay's length is the gap between two cross-lines of
// posts: changing it moves every post below it, in every row, keeping the grid lined up.
export function setBayLength(layout: Layout, startM: number, oldM: number, newM: number) {
  const endM = startM + oldM;
  for (const row of layout.rows) {
    if (row.offsetM > endM - EPS) {
      row.offsetM = Math.min(1000, Math.max(0, row.offsetM + newM - oldM));
      continue;
    }
    let y = row.offsetM;
    for (const bay of row.bays) {
      if (Math.abs(y - startM) < EPS && Math.abs(bay.lengthM - oldM) < EPS) {
        bay.lengthM = newM;
        break;
      }
      y += bay.lengthM;
    }
  }
}

export function layoutStats(layout: Layout) {
  let female = 0, male = 0;
  const status: Record<string, number> = {};
  for (const row of layout.rows) {
    for (const bay of row.bays) {
      for (const v of bay.vines) {
        if (v.sex === "male") male++;
        else female++;
        status[v.status] = (status[v.status] ?? 0) + 1;
      }
    }
  }
  const { bays } = layoutGeometry(layout);
  const areaM2 = bays.reduce((n, b) => n + b.w * b.h, 0);
  return { rows: layout.rows.length, bays: bays.length, female, male, areaM2, status };
}
