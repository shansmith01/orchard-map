import type { Bay, Layout, Row, Vine } from "../../../lib/layout";
import type { Props } from "./print.server";
import "../../style.css";

// A4 portrait sheets, measured in millimetres. Rows run down the page like in the editor,
// and each sheet holds up to BAYS_PER_SHEET bays of every row in its group.
const PAGE_W = 210;
const PAGE_H = 297;
const MARGIN = 10;
const HEADER_H = 12;
const LABEL_H = 6; // row names above the columns
const FOOTER_H = 10; // legend
const MAP_TOP = MARGIN + HEADER_H + LABEL_H;
const MAP_W = PAGE_W - 2 * MARGIN;
const MAP_H = PAGE_H - MAP_TOP - MARGIN - FOOTER_H;
const BAYS_PER_SHEET = 40;
const MIN_ROW_MM = 9; // rows are widened to at least this, so vines and bay numbers stay legible

type Column = { row: Row; rowIndex: number; firstBay: number; bays: Bay[]; startM: number };
type Sheet = { columns: Column[]; firstBay: number; lastBay: number; startM: number };

function paginate(layout: Layout) {
  const rowWidthM = (r: Row) => Math.max(1, ...r.bays.map((b) => b.widthM));
  const chunkCount = Math.ceil(Math.max(0, ...layout.rows.map((r) => r.bays.length)) / BAYS_PER_SHEET);
  const columnFor = (row: Row, rowIndex: number, firstBay: number): Column => ({
    row,
    rowIndex,
    firstBay,
    bays: row.bays.slice(firstBay, firstBay + BAYS_PER_SHEET),
    startM: row.offsetM + row.bays.slice(0, firstBay).reduce((n, b) => n + b.lengthM, 0),
  });
  const span = (columns: Column[]) => {
    const filled = columns.filter((c) => c.bays.length > 0);
    const startM = Math.min(...filled.map((c) => c.startM));
    const endM = Math.max(...filled.map((c) => c.startM + c.bays.reduce((n, b) => n + b.lengthM, 0)));
    return { startM, lengthM: endM - startM, lastBay: filled[0].firstBay + Math.max(...filled.map((c) => c.bays.length)) };
  };

  // One along-row scale for every sheet: the longest stretch of 40 bays (with any stagger
  // between rows) fills the page height. Rows are widened across the page when needed.
  let longestM = 1;
  for (let c = 0; c < chunkCount; c++)
    longestM = Math.max(longestM, span(layout.rows.map((r, i) => columnFor(r, i, c * BAYS_PER_SHEET))).lengthM);
  const yScale = MAP_H / longestM;
  const maxWidthM = Math.max(1, ...layout.rows.map(rowWidthM));
  const xScale = Math.max(yScale, MIN_ROW_MM / maxWidthM);

  // Fill each sheet with as many rows as fit across it.
  const groups: { row: Row; rowIndex: number }[][] = [];
  let usedMm = Infinity;
  layout.rows.forEach((row, rowIndex) => {
    const w = rowWidthM(row) * xScale;
    if (usedMm + w > MAP_W + 1e-6) {
      groups.push([]);
      usedMm = 0;
    }
    groups[groups.length - 1].push({ row, rowIndex });
    usedMm += w;
  });

  const sheets: Sheet[] = [];
  for (const group of groups) {
    const chunks = Math.ceil(Math.max(0, ...group.map(({ row }) => row.bays.length)) / BAYS_PER_SHEET);
    for (let c = 0; c < chunks; c++) {
      const columns = group.map(({ row, rowIndex }) => columnFor(row, rowIndex, c * BAYS_PER_SHEET));
      const { startM, lastBay } = span(columns);
      sheets.push({ columns, firstBay: c * BAYS_PER_SHEET, lastBay, startM });
    }
  }
  return { sheets, xScale, yScale, rowWidthM };
}

export default function PrintBlock({ block, orchardName }: Props) {
  const layout = block.layout;
  const { sheets, xScale, yScale, rowWidthM } = paginate(layout);
  const printedOn = new Date().toLocaleDateString("en-NZ", { day: "numeric", month: "short", year: "numeric" });

  return (
    <div className="print-view">
      <header className="print-bar">
        <a href={`/blocks/${block.id}`} className="back">
          ← Back to editor
        </a>
        <span className="muted">
          {sheets.length} A4 {sheets.length === 1 ? "sheet" : "sheets"} · up to {BAYS_PER_SHEET} bays per row per sheet
        </span>
        <span className="spacer" />
        <span className="muted small">In the print dialog, choose “Save as PDF”.</span>
        <button className="primary" onClick={() => window.print()}>
          Download PDF
        </button>
      </header>

      {sheets.length === 0 && <p className="print-empty muted">This block has no bays yet.</p>}

      {sheets.map((sheet, i) => {
        let x = MARGIN;
        const rows = sheet.columns.map((c) => c.row.name || `Row ${c.rowIndex + 1}`);
        const rowRange = rows.length > 1 ? `${rows[0]} – ${rows[rows.length - 1]}` : rows[0];
        return (
          <section className="sheet" key={i}>
            <svg viewBox={`0 0 ${PAGE_W} ${PAGE_H}`} role="img" aria-label={`Sheet ${i + 1}: ${rowRange}, bays ${sheet.firstBay + 1}–${sheet.lastBay}`}>
              <text className="sheet-title" x={MARGIN} y={MARGIN + 4}>
                {orchardName} · {block.name}
              </text>
              <text className="sheet-sub" x={MARGIN} y={MARGIN + 9}>
                {rowRange} · Bays {sheet.firstBay + 1}–{sheet.lastBay}
              </text>
              <text className="sheet-sub" x={PAGE_W - MARGIN} y={MARGIN + 4} textAnchor="end">
                Sheet {i + 1} of {sheets.length}
              </text>
              <text className="sheet-sub" x={PAGE_W - MARGIN} y={MARGIN + 9} textAnchor="end">
                Printed {printedOn}
              </text>

              {sheet.columns.map((col, c) => {
                const w = rowWidthM(col.row) * xScale;
                const x0 = x;
                x += w;
                const label = rows[c];
                let y = MAP_TOP + (col.startM - sheet.startM) * yScale;
                return (
                  <g key={col.row.id}>
                    <text
                      className="sheet-row-label"
                      x={x0 + w / 2}
                      y={MAP_TOP - 2}
                      fontSize={Math.min(2.8, (w * 0.9) / (label.length * 0.7))}
                    >
                      {label}
                    </text>
                    {col.bays.map((bay, b) => {
                      const bw = bay.widthM * xScale;
                      const bh = bay.lengthM * yScale;
                      const by = y;
                      y += bh;
                      return (
                        <PrintBay key={bay.id} bay={bay} number={col.firstBay + b + 1} x={x0} y={by} w={bw} h={bh} alt={(col.firstBay + b) % 2 === 1} />
                      );
                    })}
                  </g>
                );
              })}

              <PrintLegend y={PAGE_H - MARGIN - 3} />
            </svg>
          </section>
        );
      })}
    </div>
  );
}

function PrintBay({ bay, number, x, y, w, h, alt }: { bay: Bay; number: number; x: number; y: number; w: number; h: number; alt: boolean }) {
  const r = Math.min(1, w * 0.12, h * 0.16);
  const pole = Math.min(0.7, h * 0.12);
  return (
    <g>
      <rect className={`sheet-bay ${alt ? "alt" : ""}`} x={x} y={y} width={w} height={h} />
      <text className="sheet-bay-number" x={x + w / 2} y={y + h / 2} fontSize={Math.min(2, h * 0.4, w * 0.3)}>
        {number}
      </text>
      {[
        [x, y],
        [x + w, y],
        [x, y + h],
        [x + w, y + h],
      ].map(([px, py], i) => (
        <rect key={i} className="pole" x={px - pole / 2} y={py - pole / 2} width={pole} height={pole} />
      ))}
      {bay.vines.map((v) => (
        <PrintVine key={v.id} vine={v} cx={x + v.x * w} cy={y + v.y * h} r={r} />
      ))}
    </g>
  );
}

function PrintVine({ vine, cx, cy, r }: { vine: Pick<Vine, "sex" | "status">; cx: number; cy: number; r: number }) {
  const ring = r * 1.5;
  return (
    <g className={`sheet-vine ${vine.sex} status-${vine.status}`}>
      <circle className="dot" cx={cx} cy={cy} r={r} strokeWidth={r * 0.25} />
      {vine.status === "psa" && <circle className="psa" cx={cx} cy={cy} r={ring} strokeWidth={r * 0.35} />}
      {vine.status === "new" && (
        <circle className="new" cx={cx} cy={cy} r={ring} strokeWidth={r * 0.3} strokeDasharray={`${r * 0.6} ${r * 0.4}`} />
      )}
      {vine.status === "dead" && (
        <path
          className="dead"
          strokeWidth={r * 0.35}
          d={`M${cx - ring} ${cy - ring}L${cx + ring} ${cy + ring}M${cx + ring} ${cy - ring}L${cx - ring} ${cy + ring}`}
        />
      )}
      {vine.status === "unknown" && (
        <text className="unknown" x={cx + r * 1.2} y={cy - r * 0.6} fontSize={r * 2}>
          ?
        </text>
      )}
    </g>
  );
}

function PrintLegend({ y }: { y: number }) {
  const items: [string, Pick<Vine, "sex" | "status">][] = [
    ["Female", { sex: "female", status: "ok" }],
    ["Male", { sex: "male", status: "ok" }],
    ["PSA", { sex: "female", status: "psa" }],
    ["Dead", { sex: "female", status: "dead" }],
    ["New / replant", { sex: "female", status: "new" }],
    ["Unknown", { sex: "female", status: "unknown" }],
  ];
  let x = MARGIN + 2;
  return (
    <g className="sheet-legend">
      {items.map(([label, vine]) => {
        const cx = x;
        x += 3.5 + label.length * 1.6 + 6; // rough width of 3 mm text
        return (
          <g key={label}>
            <PrintVine vine={vine} cx={cx} cy={y} r={1} />
            <text x={cx + 3.5} y={y}>
              {label}
            </text>
          </g>
        );
      })}
      <rect className="pole" x={x - 0.35} y={y - 0.35} width={0.7} height={0.7} />
      <text x={x + 3.5} y={y}>
        Pole
      </text>
    </g>
  );
}
