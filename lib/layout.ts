import { z } from "zod";

// A bay is the space between four poles. Vines sit inside it at fractional
// positions: x runs across the row (0 = left side, 1 = right side) and
// y runs along the row (0 = start of the bay, 1 = end).
export const vineSexes = ["female", "male"] as const;
export const vineStatuses = ["ok", "psa", "dead", "new", "unknown"] as const;

const fraction = z.number().min(0).max(1);

export const vineSchema = z.object({
  id: z.string().min(1),
  sex: z.enum(vineSexes),
  status: z.enum(vineStatuses),
  note: z.string().max(200),
  x: fraction,
  y: fraction,
});

export const baySchema = z.object({
  id: z.string().min(1),
  lengthM: z.number().positive().max(50), // along the row
  widthM: z.number().positive().max(20), // across the row
  vines: z.array(vineSchema),
});

export const rowSchema = z.object({
  id: z.string().min(1),
  name: z.string().max(50),
  offsetM: z.number().min(0).max(1000), // where the first bay starts along the row
  bays: z.array(baySchema),
});

export const layoutSchema = z.object({ rows: z.array(rowSchema) });

export type Vine = z.infer<typeof vineSchema>;
export type Bay = z.infer<typeof baySchema>;
export type Row = z.infer<typeof rowSchema>;
export type Layout = z.infer<typeof layoutSchema>;


export const newId = () => crypto.randomUUID();

// Vines planted down each side of the bay, as in a typical T-bar/pergola block.
export function makeBay(lengthM: number, widthM: number, vinesPerSide: number): Bay {
  const vines: Vine[] = [];
  for (const x of [0.15, 0.85]) {
    for (let i = 0; i < vinesPerSide; i++) {
      vines.push({ id: newId(), sex: "female", status: "ok", note: "", x, y: (i + 0.5) / vinesPerSide });
    }
  }
  return { id: newId(), lengthM, widthM, vines };
}

export function makeRow(name: string, offsetM: number, bayCount: number, lengthM: number, widthM: number, vinesPerSide: number): Row {
  return {
    id: newId(),
    name,
    offsetM,
    bays: Array.from({ length: bayCount }, () => makeBay(lengthM, widthM, vinesPerSide)),
  };
}

export type BayGeometry = { row: Row; bay: Bay; x: number; y: number; w: number; h: number };

// Lays rows side by side (x, across) and bays end to end (y, along the row), in metres.
export function layoutGeometry(layout: Layout) {
  const rows: { row: Row; x: number; w: number; y: number; h: number }[] = [];
  const bays: BayGeometry[] = [];
  let x = 0;
  let maxY = 0;
  for (const row of layout.rows) {
    const w = Math.max(1, ...row.bays.map((b) => b.widthM));
    let y = row.offsetM;
    for (const bay of row.bays) {
      bays.push({ row, bay, x, y, w: bay.widthM, h: bay.lengthM });
      y += bay.lengthM;
    }
    rows.push({ row, x, w, y: row.offsetM, h: y - row.offsetM });
    maxY = Math.max(maxY, y);
    x += w;
  }
  return { rows, bays, width: x, height: maxY };
}

export function layoutStats(layout: Layout) {
  let bays = 0, female = 0, male = 0, areaM2 = 0;
  const status: Record<string, number> = {};
  for (const row of layout.rows) {
    for (const bay of row.bays) {
      bays++;
      areaM2 += bay.lengthM * bay.widthM;
      for (const v of bay.vines) {
        if (v.sex === "male") male++;
        else female++;
        status[v.status] = (status[v.status] ?? 0) + 1;
      }
    }
  }
  return { rows: layout.rows.length, bays, female, male, areaM2, status };
}
