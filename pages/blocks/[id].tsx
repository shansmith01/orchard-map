import { action } from "@void/react";
import { useHotkeys } from "@tanstack/react-hotkeys";
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  alignedRowOffset,
  layoutGeometry,
  layoutStats,
  makeBay,
  makeRow,
  newId,
  rowAlignments,
  rowLength,
  setBayLength,
  vineStatuses,
  type Bay,
  type BayGeometry,
  type Layout,
  type Row,
  type RowAlignment,
  type SpanGeometry,
  type Vine,
} from "../../lib/layout";
import type { Props } from "./[id].server";
import "../style.css";

type Tool = "select" | "female" | "male" | "erase";
type Selection =
  | { kind: "row"; rowId: string }
  | { kind: "bay"; rowId: string; bayId: string }
  | { kind: "vine"; rowId: string; bayId: string; vineId: string }
  | { kind: "vines"; vineIds: string[] } // two or more vines, from Shift-click or Shift-drag
  | null;
type View = { scale: number; tx: number; ty: number }; // pixels per metre + pan offset

const TOOLS: { id: Tool; label: string; key: "V" | "F" | "M" | "E" }[] = [
  { id: "select", label: "Select / move", key: "V" },
  { id: "female", label: "Female vine", key: "F" },
  { id: "male", label: "Male vine", key: "M" },
  { id: "erase", label: "Erase vine", key: "E" },
];
const STATUS_LABELS: Record<Vine["status"], string> = {
  ok: "Healthy",
  psa: "PSA",
  dead: "Dead / removed",
  new: "New / replant",
  unknown: "Unknown (?)",
};
const LABEL_SPACE_M = 3; // room above the rows for row labels

function find(layout: Layout, rowId: string, bayId?: string, vineId?: string) {
  const row = layout.rows.find((r) => r.id === rowId);
  const bay = bayId ? row?.bays.find((b) => b.id === bayId) : undefined;
  const vine = vineId ? bay?.vines.find((v) => v.id === vineId) : undefined;
  return { row, bay, vine };
}

const rowLabel = (layout: Layout, row: Row) => row.name || `Row ${layout.rows.indexOf(row) + 1}`;

const selectedVineIds = (s: Selection) => (s?.kind === "vine" ? [s.vineId] : s?.kind === "vines" ? s.vineIds : []);

function vineSelection(layout: Layout, vineIds: string[]): Selection {
  if (vineIds.length > 1) return { kind: "vines", vineIds };
  for (const row of layout.rows)
    for (const bay of row.bays)
      if (bay.vines.some((v) => v.id === vineIds[0])) return { kind: "vine", rowId: row.id, bayId: bay.id, vineId: vineIds[0] };
  return null;
}

// The nearest vine from `vineId` in direction (dx, dy), preferring vines in line with it over ones off to the side.
function vineInDirection(layout: Layout, vineId: string, dx: number, dy: number): Selection {
  const points = layoutGeometry(layout).spans.flatMap(({ row, bay, lineX, y, h }) =>
    bay.vines.map((v) => ({ rowId: row.id, bayId: bay.id, vineId: v.id, x: lineX, y: y + v.y * h })),
  );
  const from = points.find((p) => p.vineId === vineId);
  if (!from) return null;
  let best: Selection = null;
  let bestScore = Infinity;
  for (const p of points) {
    const along = (p.x - from.x) * dx + (p.y - from.y) * dy;
    const across = Math.abs((p.x - from.x) * dy - (p.y - from.y) * dx);
    const score = along + 3 * across;
    if (along > 0.01 && score < bestScore) {
      bestScore = score;
      best = { kind: "vine", rowId: p.rowId, bayId: p.bayId, vineId: p.vineId };
    }
  }
  return best;
}

function forEachVine(layout: Layout, fn: (vine: Vine, bay: Bay) => void) {
  for (const row of layout.rows) for (const bay of row.bays) for (const vine of [...bay.vines]) fn(vine, bay);
}

export default function BlockEditor({ block, orchardName }: Props) {
  const [name, setName] = useState(block.name);
  const [layout, setLayout] = useState<Layout>(block.layout);
  const [history, setHistory] = useState<Layout[]>([]);
  // The last state the server has. Comparing by reference means undoing back to it counts as clean.
  const [saved, setSaved] = useState({ name: block.name, layout: block.layout });
  const dirty = name !== saved.name || layout !== saved.layout;
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<{ message: string; name: string; layout: Layout } | null>(null);
  const nameMissing = name.trim() === "";
  const saveError = dirty ? failure : null; // a failure is moot once nothing is unsaved
  const [tool, setTool] = useState<Tool>("select");
  const [selection, setSelection] = useState<Selection>(null);
  const [hover, setHover] = useState<string | null>(null);

  // Every edit goes through here so it can be undone.
  const edit = useCallback(
    (fn: (draft: Layout) => void) => {
      setHistory((h) => [...h.slice(-99), layout]);
      const draft = structuredClone(layout);
      fn(draft);
      setLayout(draft);
    },
    [layout],
  );

  const undo = useCallback(() => {
    setHistory((h) => {
      if (h.length === 0) return h;
      setLayout(h[h.length - 1]);
      return h.slice(0, -1);
    });
  }, []);

  const save = useCallback(async () => {
    if (!name.trim()) return;
    const snapshot = { name, layout };
    setSaving(true);
    try {
      const result = await action("/blocks/:id", { params: { id: String(block.id) }, data: snapshot });
      if (result.ok) {
        setSaved(snapshot);
        setFailure(null);
      } else setFailure({ message: result.error.message, ...snapshot });
    } catch (e) {
      setFailure({ message: e instanceof Error ? e.message : "Save failed", ...snapshot });
    } finally {
      setSaving(false);
    }
  }, [block.id, name, layout]);

  const deleteSelection = useCallback(() => {
    if (!selection || selection.kind === "bay") return; // a bay is two rows' posts; remove bays from the row
    edit((d) => {
      if (selection.kind === "vines") {
        const ids = new Set(selection.vineIds);
        forEachVine(d, (_v, bay) => (bay.vines = bay.vines.filter((v) => !ids.has(v.id))));
        return;
      }
      const { row, bay } = find(d, selection.rowId, "bayId" in selection ? selection.bayId : undefined);
      if (selection.kind === "vine" && bay) bay.vines = bay.vines.filter((v) => v.id !== selection.vineId);
      if (selection.kind === "row") d.rows = d.rows.filter((r) => r.id !== selection.rowId);
    });
    setSelection(null);
  }, [selection, edit]);

  // With vines selected, F and M set their sex; otherwise they pick the vine tool like V and E.
  const vineIds = selectedVineIds(selection);
  const setSelectedSex = (sex: Vine["sex"]) => {
    const ids = new Set(vineIds);
    edit((d) => forEachVine(d, (v) => ids.has(v.id) && (v.sex = sex)));
  };

  useHotkeys([
    { hotkey: "Mod+S", callback: () => void save() },
    { hotkey: "Mod+Z", callback: undo, options: { ignoreInputs: true } },
    { hotkey: "Delete", callback: deleteSelection },
    { hotkey: "Backspace", callback: deleteSelection },
    { hotkey: "Escape", callback: () => setSelection(null), options: { ignoreInputs: true } },
    ...([["ArrowUp", 0, -1], ["ArrowDown", 0, 1], ["ArrowLeft", -1, 0], ["ArrowRight", 1, 0]] as const).map(([hotkey, dx, dy]) => ({
      hotkey,
      callback: () => {
        const next = selection?.kind === "vine" && vineInDirection(layout, selection.vineId, dx, dy);
        if (next) setSelection(next);
      },
      options: { enabled: selection?.kind === "vine" },
    })),
    ...TOOLS.map((t) => ({
      hotkey: t.key,
      callback: () => (vineIds.length > 0 && (t.id === "female" || t.id === "male") ? setSelectedSex(t.id) : setTool(t.id)),
    })),
  ]);

  // Auto-save shortly after the last change; each new change restarts the timer,
  // so a vine drag saves once when it ends. Retry an unchanged failed save more slowly.
  const unchangedSinceFailure = saveError?.name === name && saveError.layout === layout;
  useEffect(() => {
    if (!dirty || saving || nameMissing) return;
    const timer = setTimeout(save, unchangedSinceFailure ? 5000 : 800);
    return () => clearTimeout(timer);
  }, [dirty, saving, nameMissing, unchangedSinceFailure, save]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const stats = useMemo(() => layoutStats(layout), [layout]);

  return (
    <div className="editor">
      <header className="editor-bar">
        <a href="/" className="back">
          ← {orchardName}
        </a>
        <input
          className="block-name"
          aria-label="Block name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <div className="tools" role="toolbar" aria-label="Tools">
          {TOOLS.map((t) => (
            <button
              key={t.id}
              className={`tool tool-${t.id}`}
              aria-pressed={tool === t.id}
              title={`${t.label} (${t.key})`}
              onClick={() => setTool(t.id)}
            >
              <span className="tool-icon" aria-hidden="true" />
              {t.label}
            </button>
          ))}
        </div>
        <span className="spacer" />
        <button onClick={undo} disabled={history.length === 0} title="Undo (Ctrl+Z)">
          Undo
        </button>
        <button
          onClick={() => location.assign(`/blocks/${block.id}/print`)}
          disabled={dirty}
          title={dirty ? "Wait for changes to save" : "Lay the map out on A4 sheets and save as PDF"}
        >
          PDF
        </button>
        <span className={`save-status ${saveError || (dirty && nameMissing) ? "error" : ""}`} role="status">
          {saving
            ? "Saving…"
            : dirty && nameMissing
              ? "Block name required"
              : saveError
                ? "Not saved"
                : dirty
                  ? "Unsaved changes"
                  : "All changes saved"}
        </span>
      </header>
      {saveError && (
        <p className="error-banner">
          Couldn’t save: {saveError.message}. Retrying…{" "}
          <button onClick={save} disabled={saving}>
            Retry now
          </button>
        </p>
      )}

      <div className="editor-body">
        <Canvas
          layout={layout}
          tool={tool}
          selection={selection}
          onSelect={setSelection}
          onHover={setHover}
          edit={edit}
          setLayout={setLayout}
          pushHistory={() => setHistory((h) => [...h.slice(-99), layout])}
        />
        <aside className="panel">
          <Inspector layout={layout} selection={selection} edit={edit} onSelect={setSelection} onDelete={deleteSelection} />
          <AddRows layout={layout} edit={edit} />
          <section>
            <h3>Block summary</h3>
            <NumberField
              label="Row spacing (m)"
              value={layout.rowSpacingM}
              onChange={(n) => n > 0 && n <= 20 && edit((d) => (d.rowSpacingM = n))}
            />
            <dl className="stats">
              <dt>Rows</dt>
              <dd>{stats.rows}</dd>
              <dt>Bays</dt>
              <dd>{stats.bays}</dd>
              <dt>Canopy area</dt>
              <dd>{(stats.areaM2 / 10000).toFixed(2)} ha</dd>
              <dt>Female vines</dt>
              <dd>{stats.female}</dd>
              <dt>Male vines</dt>
              <dd>
                {stats.male}
                {stats.male > 0 && <span className="muted"> (1 : {(stats.female / stats.male).toFixed(1)})</span>}
              </dd>
              {vineStatuses
                .filter((s) => s !== "ok" && stats.status[s])
                .map((s) => (
                  <div key={s} className="stat-row">
                    <dt>{STATUS_LABELS[s]}</dt>
                    <dd>{stats.status[s]}</dd>
                  </div>
                ))}
            </dl>
          </section>
          <Legend />
        </aside>
      </div>
      <footer className="status-bar">
        <span>{hover ?? "Scroll to zoom, drag to pan. Click a bay with a vine tool to plant a vine."}</span>
      </footer>
    </div>
  );
}

function Canvas({
  layout,
  tool,
  selection,
  onSelect,
  onHover,
  edit,
  setLayout,
  pushHistory,
}: {
  layout: Layout;
  tool: Tool;
  selection: Selection;
  onSelect: (s: Selection) => void;
  onHover: (s: string | null) => void;
  edit: (fn: (d: Layout) => void) => void;
  setLayout: (l: Layout) => void;
  pushHistory: () => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [rowPreview, setRowPreview] = useState<{ rowId: string; offsetM: number; guideY?: number; label?: string } | null>(null);
  const geo = useMemo(() => layoutGeometry(rowPreview ? {
    ...layout,
    rows: layout.rows.map((r) => r.id === rowPreview.rowId ? { ...r, offsetM: rowPreview.offsetM } : r),
  } : layout), [layout, rowPreview]);
  const [view, setView] = useState<View | null>(null);
  const drag = useRef<
    | { kind: "pan"; startX: number; startY: number; view: View; moved: boolean; onClick?: () => void }
    | { kind: "vine"; rowId: string; bayId: string; vineId: string; base: Layout; started: boolean }
    | { kind: "row"; row: Row; startY: number; scale: number; offsetM: number }
    | { kind: "box"; x0: number; y0: number }
    | null
  >(null);
  const [box, setBox] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);

  const fit = useCallback(() => {
    const el = svgRef.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const w = Math.max(geo.width, 10);
    const h = Math.max(geo.height, 10) + LABEL_SPACE_M;
    const scale = Math.min((width - 80) / w, (height - 80) / h);
    setView({ scale, tx: (width - w * scale) / 2, ty: (height - h * scale) / 2 + LABEL_SPACE_M * scale });
  }, [geo.width, geo.height]);

  useEffect(() => {
    if (!view) fit();
  }, [view, fit]);

  // Non-passive wheel listener so we can stop the page from scrolling.
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      setView((v) => {
        if (!v) return v;
        const scale = Math.min(200, Math.max(1, v.scale * Math.exp(-e.deltaY * 0.0015)));
        const k = scale / v.scale;
        return { scale, tx: px - (px - v.tx) * k, ty: py - (py - v.ty) * k };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const toWorld = (clientX: number, clientY: number) => {
    const rect = svgRef.current!.getBoundingClientRect();
    return { x: (clientX - rect.left - view!.tx) / view!.scale, y: (clientY - rect.top - view!.ty) / view!.scale };
  };

  const bayFraction = (rowId: string, bayId: string, clientX: number, clientY: number) => {
    const g = geo.spans.find((b) => b.row.id === rowId && b.bay.id === bayId)!;
    const p = toWorld(clientX, clientY);
    const clamp = (n: number) => Math.round(Math.min(1, Math.max(0, n)) * 1000) / 1000;
    return { y: clamp((p.y - g.y) / g.h) };
  };

  const startPan = (e: ReactPointerEvent, onClick?: () => void) => {
    if (!view) return;
    svgRef.current!.setPointerCapture(e.pointerId);
    if (e.shiftKey && e.button === 0 && tool === "select") {
      const p = toWorld(e.clientX, e.clientY);
      drag.current = { kind: "box", x0: p.x, y0: p.y };
      return;
    }
    drag.current = { kind: "pan", startX: e.clientX, startY: e.clientY, view, moved: false, onClick };
  };

  const plant = (span: SpanGeometry, clientX: number, clientY: number) => {
    if (tool !== "female" && tool !== "male") return;
    const { row, bay } = span;
    const vine: Vine = { id: newId(), sex: tool, status: "ok", note: "", ...bayFraction(row.id, bay.id, clientX, clientY) };
    edit((d) => find(d, row.id, bay.id).bay!.vines.push(vine));
    onSelect({ kind: "vine", rowId: row.id, bayId: bay.id, vineId: vine.id });
  };

  // Clicking a bay plants on whichever of its two rows is nearer.
  const onBayDown = (e: ReactPointerEvent, g: BayGeometry) => {
    if (e.button !== 0) return startPan(e);
    e.stopPropagation();
    const { clientX, clientY } = e;
    startPan(e, () => {
      if (tool === "female" || tool === "male") plant(toWorld(clientX, clientY).x < g.x + g.w / 2 ? g.left : g.right, clientX, clientY);
      else onSelect({ kind: "bay", rowId: g.left.row.id, bayId: g.left.bay.id });
    });
  };

  // A strip along each row, so vine tools also plant where a row has no bay beside it.
  const onSpanDown = (e: ReactPointerEvent, span: SpanGeometry) => {
    if (e.button !== 0) return startPan(e);
    e.stopPropagation();
    const { clientX, clientY } = e;
    startPan(e, () => plant(span, clientX, clientY));
  };

  const onVineDown = (e: ReactPointerEvent, row: Row, bay: Bay, vine: Vine) => {
    if (e.button !== 0) return startPan(e);
    e.stopPropagation();
    if (tool === "erase") {
      edit((d) => {
        const b = find(d, row.id, bay.id).bay!;
        b.vines = b.vines.filter((v) => v.id !== vine.id);
      });
      onSelect(null);
      return;
    }
    if (tool === "female" || tool === "male") {
      if (vine.sex !== tool) edit((d) => (find(d, row.id, bay.id, vine.id).vine!.sex = tool));
      onSelect({ kind: "vine", rowId: row.id, bayId: bay.id, vineId: vine.id });
      return;
    }
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      const ids = selectedVineIds(selection);
      onSelect(vineSelection(layout, ids.includes(vine.id) ? ids.filter((id) => id !== vine.id) : [...ids, vine.id]));
      return;
    }
    svgRef.current!.setPointerCapture(e.pointerId);
    onSelect({ kind: "vine", rowId: row.id, bayId: bay.id, vineId: vine.id });
    drag.current = { kind: "vine", rowId: row.id, bayId: bay.id, vineId: vine.id, base: layout, started: false };
  };

  const onMove = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    if (d.kind === "pan") {
      const dx = e.clientX - d.startX;
      const dy = e.clientY - d.startY;
      if (!d.moved && Math.hypot(dx, dy) < 4) return;
      d.moved = true;
      setView({ ...d.view, tx: d.view.tx + dx, ty: d.view.ty + dy });
    } else if (d.kind === "box") {
      const p = toWorld(e.clientX, e.clientY);
      setBox({ x0: d.x0, y0: d.y0, x1: p.x, y1: p.y });
    } else if (d.kind === "row") {
      if (Math.abs(e.clientY - d.startY) < 4 && !rowPreview) return;
      const raw = Math.min(1000, Math.max(0, d.row.offsetM + (e.clientY - d.startY) / d.scale));
      const index = layout.rows.findIndex((r) => r.id === d.row.id);
      const length = rowLength(d.row);
      let best: { offsetM: number; guideY: number; label: string } | undefined;
      let distance = 8 / d.scale;
      const consider = (offsetM: number, guideY: number, label: string) => {
        if (offsetM < 0 || offsetM > 1000 || Math.abs(offsetM - raw) > distance) return;
        distance = Math.abs(offsetM - raw);
        best = { offsetM, guideY, label };
      };
      if (!e.altKey) {
        for (const neighbour of [layout.rows[index - 1], layout.rows[index + 1]]) {
          if (!neighbour) continue;
          let boundary = neighbour.offsetM;
          const boundaries = [boundary];
          for (const bay of neighbour.bays) boundaries.push(boundary += bay.lengthM);
          let ownBoundary = 0;
          const ownBoundaries = [0];
          for (const bay of d.row.bays) ownBoundaries.push(ownBoundary += bay.lengthM);
          for (const target of boundaries)
            for (const source of ownBoundaries) consider(target - source, target, "Bay boundary");
          for (const alignment of rowAlignments) {
            const fraction = alignment === "top" ? 0 : alignment === "centre" ? 0.5 : 1;
            const target = neighbour.offsetM + rowLength(neighbour) * fraction;
            consider(target - length * fraction, target, `Align ${alignment}`);
          }
        }
      }
      d.offsetM = best?.offsetM ?? Math.round(raw * 100) / 100;
      setRowPreview({ rowId: d.row.id, offsetM: d.offsetM, ...best });
    } else {
      if (!d.started) {
        pushHistory();
        d.started = true;
      }
      // Vines stay inside their bay; dragging is clamped to its edges.
      const pos = bayFraction(d.rowId, d.bayId, e.clientX, e.clientY);
      const next = structuredClone(d.base);
      Object.assign(find(next, d.rowId, d.bayId, d.vineId).vine!, pos);
      setLayout(next);
    }
  };

  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    if (d?.kind === "row" && d.offsetM !== d.row.offsetM) {
      edit((next) => { find(next, d.row.id).row!.offsetM = d.offsetM; });
    }
    setRowPreview(null);
    if (d?.kind === "pan" && !d.moved) (d.onClick ?? (() => onSelect(null)))();
    if (d?.kind === "box" && box) {
      // Add every vine inside the box to the current selection.
      const [xa, xb] = [Math.min(box.x0, box.x1), Math.max(box.x0, box.x1)];
      const [ya, yb] = [Math.min(box.y0, box.y1), Math.max(box.y0, box.y1)];
      const ids = new Set(selectedVineIds(selection));
      for (const g of geo.spans)
        for (const v of g.bay.vines) {
          const vx = g.lineX;
          const vy = g.y + v.y * g.h;
          if (vx >= xa && vx <= xb && vy >= ya && vy <= yb) ids.add(v.id);
        }
      onSelect(vineSelection(layout, [...ids]));
    }
    setBox(null);
  };

  const s = view?.scale ?? 10;
  const sel = selection;
  const selectedVines = useMemo(() => new Set(selectedVineIds(selection)), [selection]);
  const poles = useMemo(() => {
    const seen = new Map<string, { x: number; y: number }>();
    for (const b of geo.spans) {
      for (const y of [b.y, b.y + b.h]) seen.set(`${b.lineX.toFixed(2)},${y.toFixed(2)}`, { x: b.lineX, y });
    }
    return [...seen.values()];
  }, [geo]);

  return (
    <div className="canvas-wrap">
      <svg
        ref={svgRef}
        className={`canvas tool-${tool}`}
        onPointerDown={(e) => startPan(e)}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={() => {
          drag.current = null;
          setRowPreview(null);
          setBox(null);
        }}
        onLostPointerCapture={() => {
          if (drag.current?.kind === "row") {
            drag.current = null;
            setRowPreview(null);
          }
        }}
        onPointerLeave={() => onHover(null)}
        role="application"
        aria-label="Block layout"
      >
        {view && (
          <g transform={`translate(${view.tx} ${view.ty}) scale(${view.scale})`}>
            {geo.rows.map(({ row, lineX }, i) => {
              const label = row.name || `Row ${i + 1}`;
              const w = layout.rowSpacingM;
              return (
              <text
                key={row.id}
                className={`row-label ${sel?.kind === "row" && sel.rowId === row.id ? "selected" : ""}`}
                x={lineX}
                y={row.offsetM - 0.8}
                fontSize={Math.min(1.4, (w * 0.9) / (label.length * 0.72))}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  onSelect({ kind: "row", rowId: row.id });
                }}
              >
                {label}
              </text>
              );
            })}
            {tool === "select" && sel?.kind === "row" && geo.rows.filter((g) => g.row.id === sel.rowId).map(({ row, lineX }) => (
              <g key={`handle-${row.id}`}>
                <rect
                  className="row-drag-handle"
                  x={lineX - 12 / s}
                  y={row.offsetM - 0.8 - 36 / s}
                  width={24 / s}
                  height={24 / s}
                  rx={4 / s}
                  role="slider"
                  tabIndex={0}
                  aria-label={`Move ${row.name} vertically`}
                  aria-valuemin={0}
                  aria-valuemax={1000}
                  aria-valuenow={row.offsetM}
                  aria-valuetext={`${row.offsetM} metres from top`}
                  aria-orientation="vertical"
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      drag.current = null;
                      setRowPreview(null);
                    }
                    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
                    e.preventDefault();
                    const delta = (e.key === "ArrowUp" ? -1 : 1) * (e.shiftKey ? 0.1 : 1);
                    edit((d) => { find(d, row.id).row!.offsetM = Math.min(1000, Math.max(0, Math.round((row.offsetM + delta) * 100) / 100)); });
                  }}
                  onPointerDown={(e) => {
                    if (e.button !== 0) return;
                    e.stopPropagation();
                    e.currentTarget.focus();
                    svgRef.current!.setPointerCapture(e.pointerId);
                    drag.current = { kind: "row", row: find(layout, row.id).row!, startY: e.clientY, scale: s, offsetM: row.offsetM };
                  }}
                ><title>Drag vertically · snaps to neighbours · Alt for free movement · arrow keys to nudge</title></rect>
                <text className="row-drag-icon" x={lineX} y={row.offsetM - 0.8 - 19 / s} fontSize={16 / s}>↕</text>
              </g>
            ))}
            {geo.bays.map((g) => {
              const { left, right } = g;
              const selected = sel?.kind === "bay" && sel.bayId === left.bay.id;
              return (
                <rect
                  key={left.bay.id}
                  className={`bay ${selected ? "selected" : ""} ${left.index % 2 ? "alt" : ""}`}
                  x={g.x}
                  y={g.y}
                  width={g.w}
                  height={g.h}
                  vectorEffect="non-scaling-stroke"
                  onPointerDown={(e) => onBayDown(e, g)}
                  onPointerEnter={() =>
                    onHover(
                      `Bay ${left.index + 1} · ${rowLabel(layout, left.row)} – ${rowLabel(layout, right.row)} · ${g.h} m long · ${left.bay.vines.length + right.bay.vines.length} vines`,
                    )
                  }
                />
              );
            })}
            {geo.rows.map(({ row, lineX, y, h }) => (
              <line
                key={row.id}
                className={`row-line ${sel?.kind === "row" && sel.rowId === row.id ? "selected" : ""}`}
                x1={lineX}
                x2={lineX}
                y1={y}
                y2={y + h}
                vectorEffect="non-scaling-stroke"
              />
            ))}
            {(tool === "female" || tool === "male") &&
              geo.spans.map((span) => (
                <rect
                  key={span.bay.id}
                  className="span-hit"
                  x={span.lineX - 0.6}
                  y={span.y}
                  width={1.2}
                  height={span.h}
                  onPointerDown={(e) => onSpanDown(e, span)}
                />
              ))}
            {s > 14 &&
              geo.bays.map(({ left, x, y, w, h }) => (
                <text key={left.bay.id} className="bay-number" x={x + w / 2} y={y + h / 2} fontSize={0.9}>
                  {left.index + 1}
                </text>
              ))}
            {poles.map((p) => (
              <rect key={`${p.x},${p.y}`} className="pole" x={p.x - 0.15} y={p.y - 0.15} width={0.3} height={0.3} />
            ))}
            {geo.spans.map(({ row, bay, lineX, y, h }) =>
              bay.vines.map((v) => {
                const cx = lineX;
                const cy = y + v.y * h;
                const selected = selectedVines.has(v.id);
                return (
                  <g
                    key={v.id}
                    className={`vine ${v.sex} status-${v.status} ${selected ? "selected" : ""}`}
                    onPointerDown={(e) => onVineDown(e, row, bay, v)}
                  >
                    <title>
                      {`${v.sex === "male" ? "Male" : "Female"} · ${STATUS_LABELS[v.status]}${v.note ? ` · ${v.note}` : ""}`}
                    </title>
                    {selected && <circle className="vine-halo" cx={cx} cy={cy} r={0.75} />}
                    <circle className="vine-dot" cx={cx} cy={cy} r={0.42} vectorEffect="non-scaling-stroke" />
                    {v.status === "psa" && <circle className="psa-ring" cx={cx} cy={cy} r={0.62} />}
                    {v.status === "dead" && (
                      <path className="dead-x" d={`M${cx - 0.5} ${cy - 0.5}L${cx + 0.5} ${cy + 0.5}M${cx + 0.5} ${cy - 0.5}L${cx - 0.5} ${cy + 0.5}`} />
                    )}
                    {v.status === "new" && <circle className="new-ring" cx={cx} cy={cy} r={0.62} />}
                    {v.status === "unknown" && (
                      <text className="unknown-mark" x={cx + 0.55} y={cy - 0.35} fontSize={0.8}>
                        ?
                      </text>
                    )}
                  </g>
                );
              }),
            )}
            {rowPreview?.guideY !== undefined && (
              <g className="row-snap-guide" pointerEvents="none">
                <line x1={-1} x2={geo.width + 1} y1={rowPreview.guideY} y2={rowPreview.guideY} vectorEffect="non-scaling-stroke" />
                <text x={geo.width + 1.5} y={rowPreview.guideY} fontSize={12 / s}>{rowPreview.label}</text>
              </g>
            )}
            {box && (
              <rect
                className="select-box"
                x={Math.min(box.x0, box.x1)}
                y={Math.min(box.y0, box.y1)}
                width={Math.abs(box.x1 - box.x0)}
                height={Math.abs(box.y1 - box.y0)}
                vectorEffect="non-scaling-stroke"
              />
            )}
          </g>
        )}
        {layout.rows.length === 0 && (
          <text className="empty-hint" x="50%" y="50%">
            No rows yet. Use “Add rows” on the right to lay out the block.
          </text>
        )}
      </svg>
      <div className="zoom-controls">
        <button onClick={() => setView((v) => v && zoomAtCenter(v, 1.3, svgRef.current!))} aria-label="Zoom in">
          +
        </button>
        <button onClick={() => setView((v) => v && zoomAtCenter(v, 1 / 1.3, svgRef.current!))} aria-label="Zoom out">
          −
        </button>
        <button onClick={fit}>Fit</button>
      </div>
    </div>
  );
}

function zoomAtCenter(v: View, k: number, el: SVGSVGElement): View {
  const { width, height } = el.getBoundingClientRect();
  const scale = Math.min(200, Math.max(1, v.scale * k));
  const f = scale / v.scale;
  return { scale, tx: width / 2 - (width / 2 - v.tx) * f, ty: height / 2 - (height / 2 - v.ty) * f };
}

function NumberField({ label, value, onChange, step = 0.1, min = 0 }: { label: string; value: number; onChange: (n: number) => void; step?: number; min?: number }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type="number"
        step={step}
        min={min}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const n = Number(e.target.value);
          if (e.target.value !== "" && Number.isFinite(n) && n >= min) onChange(n);
        }}
      />
    </label>
  );
}

function Inspector({
  layout,
  selection,
  edit,
  onSelect,
  onDelete,
}: {
  layout: Layout;
  selection: Selection;
  edit: (fn: (d: Layout) => void) => void;
  onSelect: (s: Selection) => void;
  onDelete: () => void;
}) {
  if (!selection) {
    return (
      <section>
        <h3>Selection</h3>
        <p className="muted">Click a row label, a bay or a vine to edit it.</p>
        <p className="muted small">Shift-click vines, or Shift-drag a box around them, to select several at once.</p>
      </section>
    );
  }
  if (selection.kind === "vines") return <MultiVineInspector layout={layout} vineIds={selection.vineIds} edit={edit} onSelect={onSelect} onDelete={onDelete} />;
  const { row, bay, vine } = find(
    layout,
    selection.rowId,
    "bayId" in selection ? selection.bayId : undefined,
    selection.kind === "vine" ? selection.vineId : undefined,
  );
  if (!row || (selection.kind !== "row" && !bay) || (selection.kind === "vine" && !vine)) return null;
  const rowIndex = layout.rows.indexOf(row);
  const rowName = rowLabel(layout, row);
  const geo = layoutGeometry(layout);

  if (selection.kind === "vine" && bay && vine) {
    const set = (patch: Partial<Vine>) => edit((d) => Object.assign(find(d, row.id, bay.id, vine.id).vine!, patch));
    return (
      <section>
        <h3>
          Vine <span className="muted">· {rowName}, bay {row.bays.indexOf(bay) + 1}</span>
        </h3>
        <div className="segmented" role="group" aria-label="Sex">
          {(["female", "male"] as const).map((sex) => (
            <button key={sex} aria-pressed={vine.sex === sex} aria-keyshortcuts={sex === "female" ? "F" : "M"} onClick={() => set({ sex })}>
              <span>{sex === "female" ? "Female" : "Male"}</span>
              <kbd className="hotkey" aria-hidden="true">{sex === "female" ? "F" : "M"}</kbd>
            </button>
          ))}
        </div>
        <label className="field">
          <span>Status</span>
          <select value={vine.status} onChange={(e) => set({ status: e.target.value as Vine["status"] })}>
            {vineStatuses.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Note</span>
          <input value={vine.note} maxLength={200} onChange={(e) => set({ note: e.target.value })} placeholder="e.g. graft, cut back" />
        </label>
        <p className="muted small">Arrow keys move to the next vine.</p>
        <div className="actions">
          {(() => {
            const beside = geo.bays.find((g) => g.left.bay.id === bay.id) ?? geo.bays.find((g) => g.right.bay.id === bay.id);
            return (
              beside && (
                <button onClick={() => onSelect({ kind: "bay", rowId: beside.left.row.id, bayId: beside.left.bay.id })}>Select bay</button>
              )
            );
          })()}
          <button className="danger" onClick={onDelete}>
            Delete vine
          </button>
        </div>
      </section>
    );
  }

  if (selection.kind === "bay" && bay) {
    const g = geo.bays.find((g) => g.left.bay.id === bay.id);
    if (!g) return null;
    const { left, right } = g;
    const vines = [...left.bay.vines, ...right.bay.vines];
    const setVines = (fn: () => Vine[]) =>
      edit((d) => {
        find(d, left.row.id, left.bay.id).bay!.vines = fn();
        find(d, right.row.id, right.bay.id).bay!.vines = fn();
      });
    return (
      <section>
        <h3>
          Bay {left.index + 1} <span className="muted">· {rowName} – {rowLabel(layout, right.row)}</span>
        </h3>
        <NumberField label="Length (m)" value={g.h} onChange={(n) => n > 0 && n <= 50 && edit((d) => setBayLength(d, g.y, g.h, n))} />
        <p className="muted small">Changing the length moves every post below this bay, in every row, so posts stay lined up.</p>
        <p className="muted">
          {vines.filter((v) => v.sex === "female").length} female, {vines.filter((v) => v.sex === "male").length} male
        </p>
        <div className="actions">
          <button onClick={() => setVines(() => makeBay(g.h, 2).vines)}>Reset to 2 vines per side</button>
          <button onClick={() => setVines(() => [])}>Clear vines</button>
          <button onClick={() => onSelect({ kind: "row", rowId: left.row.id })}>Select {rowName}</button>
          <button onClick={() => onSelect({ kind: "row", rowId: right.row.id })}>Select {rowLabel(layout, right.row)}</button>
        </div>
      </section>
    );
  }

  const setRow = (fn: (r: Row) => void) => edit((d) => fn(find(d, row.id).row!));
  const move = (delta: number) =>
    edit((d) => {
      const i = d.rows.findIndex((r) => r.id === row.id);
      const j = i + delta;
      if (j < 0 || j >= d.rows.length) return;
      [d.rows[i], d.rows[j]] = [d.rows[j], d.rows[i]];
    });
  const last = row.bays[row.bays.length - 1];
  return (
    <section>
      <h3>{rowName}</h3>
      <label className="field">
        <span>Name</span>
        <input value={row.name} maxLength={50} onChange={(e) => setRow((r) => (r.name = e.target.value))} />
      </label>
      <NumberField label="Starts at (m from top)" value={row.offsetM} onChange={(n) => setRow((r) => (r.offsetM = n))} />
      <p className="muted small">Align once to the row on the left:</p>
      <div className="segmented" role="group" aria-label="Align selected row">
        {rowAlignments.map((alignment) => (
          <button key={alignment} disabled={rowIndex === 0} onClick={() => setRow((r) => {
            r.offsetM = alignedRowOffset(rowLength(r), layout.rows[rowIndex - 1], alignment);
          })}>
            {alignment === "top" ? "Top" : alignment === "centre" ? "Centre" : "Bottom"}
          </button>
        ))}
      </div>
      <p className="muted small">Select / move: drag the ↕ handle above the row. Snaps to neighbours; hold Alt for free movement. Arrow keys nudge 1 m; Shift nudges 0.1 m. Offsets stay within 0–1000 m.</p>
      <p className="muted">
        {row.bays.length} bays · {row.bays.reduce((n, b) => n + b.lengthM, 0).toFixed(1)} m long
      </p>
      <NumberField label="All bays length" value={row.bays[0]?.lengthM ?? 6} onChange={(n) => n > 0 && setRow((r) => r.bays.forEach((b) => (b.lengthM = n)))} />
      <div className="actions">
        <button
          onClick={() =>
            setRow((r) => {
              const nb = makeBay(r.bays[0]?.lengthM ?? 6, 2);
              r.bays.unshift(nb);
              r.offsetM = Math.max(0, r.offsetM - nb.lengthM);
            })
          }
        >
          Add bay at top
        </button>
        <button onClick={() => setRow((r) => r.bays.push(makeBay(last?.lengthM ?? 6, 2)))}>Add bay at bottom</button>
        <button disabled={row.bays.length === 0} onClick={() => setRow((r) => r.bays.pop())}>
          Remove last bay
        </button>
        <button disabled={rowIndex === 0} onClick={() => move(-1)}>
          ← Move left
        </button>
        <button disabled={rowIndex === layout.rows.length - 1} onClick={() => move(1)}>
          Move right →
        </button>
        <button
          onClick={() => {
            const copy = structuredClone(row);
            copy.id = newId();
            copy.name = `Row ${layout.rows.length + 1}`;
            copy.bays.forEach((b) => {
              b.id = newId();
              b.vines.forEach((v) => (v.id = newId()));
            });
            edit((d) => d.rows.splice(rowIndex + 1, 0, copy));
            onSelect({ kind: "row", rowId: copy.id });
          }}
        >
          Duplicate row
        </button>
        <button className="danger" onClick={onDelete}>
          Delete row
        </button>
      </div>
    </section>
  );
}

function MultiVineInspector({
  layout,
  vineIds,
  edit,
  onSelect,
  onDelete,
}: {
  layout: Layout;
  vineIds: string[];
  edit: (fn: (d: Layout) => void) => void;
  onSelect: (s: Selection) => void;
  onDelete: () => void;
}) {
  const ids = new Set(vineIds);
  const vines: Vine[] = [];
  forEachVine(layout, (v) => ids.has(v.id) && vines.push(v));
  const set = (patch: Partial<Vine>) => edit((d) => forEachVine(d, (v) => ids.has(v.id) && Object.assign(v, patch)));
  const allSame = <K extends keyof Vine>(k: K) => (vines.every((v) => v[k] === vines[0]?.[k]) ? vines[0]?.[k] : undefined);
  const males = vines.filter((v) => v.sex === "male").length;
  return (
    <section>
      <h3>{vines.length} vines selected</h3>
      <p className="muted">
        {vines.length - males} female, {males} male
      </p>
      <div className="segmented" role="group" aria-label="Set sex for all">
        {(["female", "male"] as const).map((sex) => (
          <button key={sex} aria-pressed={allSame("sex") === sex} aria-keyshortcuts={sex === "female" ? "F" : "M"} onClick={() => set({ sex })}>
            <span>All {sex}</span>
            <kbd className="hotkey" aria-hidden="true">{sex === "female" ? "F" : "M"}</kbd>
          </button>
        ))}
      </div>
      <label className="field">
        <span>Status</span>
        <select value={allSame("status") ?? ""} onChange={(e) => set({ status: e.target.value as Vine["status"] })}>
          {allSame("status") === undefined && <option value="">Mixed</option>}
          {vineStatuses.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </label>
      <div className="actions">
        <button onClick={() => onSelect(null)}>Clear selection</button>
        <button className="danger" onClick={onDelete}>
          Delete {vines.length} vines
        </button>
      </div>
    </section>
  );
}

function AddRows({ layout, edit }: { layout: Layout; edit: (fn: (d: Layout) => void) => void }) {
  const [opts, setOpts] = useState({ count: 1, bays: 10, lengthM: 6, vinesPerBay: 2, offsetM: 0 });
  const [alignment, setAlignment] = useState<RowAlignment | "custom">("top");
  const set = (k: keyof typeof opts) => (n: number) => setOpts((o) => ({ ...o, [k]: n }));
  return (
    <section>
      <h3>Add rows</h3>
      <div className="field-grid">
        <NumberField label="Rows" step={1} min={1} value={opts.count} onChange={set("count")} />
        <NumberField label="Bays per row" step={1} min={1} value={opts.bays} onChange={set("bays")} />
        <NumberField label="Bay length (m)" value={opts.lengthM} onChange={set("lengthM")} />
        <NumberField label="Vines per bay" step={1} value={opts.vinesPerBay} onChange={set("vinesPerBay")} />
        {alignment === "custom" && <NumberField label="Start at (m)" value={opts.offsetM} onChange={set("offsetM")} />}
      </div>
      <label className="field">
        <span>Row alignment</span>
        <select value={alignment} onChange={(e) => setAlignment(e.target.value as RowAlignment | "custom")}>
          <option value="top">Top</option>
          <option value="centre">Centre</option>
          <option value="bottom">Bottom</option>
          <option value="custom">Custom offset</option>
        </select>
      </label>
      <p className="muted small">Relative to the row on the left. First row starts at 0 m unless custom. Alignment is limited to 0–1000 m from the map top.</p>
      <button
        className="primary wide"
        disabled={opts.count < 1 || opts.bays < 1 || opts.lengthM <= 0}
        onClick={() =>
          edit((d) => {
            for (let i = 0; i < Math.min(opts.count, 100); i++) {
              const row = makeRow(`Row ${d.rows.length + 1}`, opts.offsetM, Math.min(opts.bays, 200), opts.lengthM, Math.min(opts.vinesPerBay, 10));
              if (alignment !== "custom") row.offsetM = alignedRowOffset(rowLength(row), d.rows[d.rows.length - 1], alignment);
              d.rows.push(row);
            }
          })
        }
      >
        Add {opts.count === 1 ? "row" : `${opts.count} rows`} to the right
      </button>
      {layout.rows.length > 0 && <p className="muted small">Select a row label to realign it, drag it vertically or change bay sizes.</p>}
    </section>
  );
}

function Legend() {
  return (
    <section>
      <h3>Legend</h3>
      <svg className="legend" viewBox="0 0 220 92" role="img" aria-label="Legend">
        <g transform="scale(14)">
          <circle className="legend-female" cx={1} cy={1} r={0.42} />
          <circle className="legend-male" cx={1} cy={2.6} r={0.42} />
          <circle className="legend-female" cx={1} cy={4.2} r={0.42} />
          <circle className="psa-ring" cx={1} cy={4.2} r={0.62} />
          <circle className="legend-female" cx={1} cy={5.8} r={0.42} />
          <circle className="new-ring" cx={1} cy={5.8} r={0.62} />
          <rect className="pole" x={8.85} y={0.85} width={0.3} height={0.3} />
          <circle className="legend-female dimmed" cx={8.9} cy={2.6} r={0.42} />
          <path className="dead-x" d="M8.4 2.1L9.4 3.1M9.4 2.1L8.4 3.1" />
          <circle className="legend-female" cx={8.9} cy={4.2} r={0.42} />
          <text className="unknown-mark" x={9.45} y={3.85} fontSize={0.8}>
            ?
          </text>
        </g>
        <text x={30} y={14}>Female</text>
        <text x={30} y={36}>Male</text>
        <text x={30} y={59}>PSA</text>
        <text x={30} y={81}>New / replant</text>
        <text x={142} y={14}>Pole</text>
        <text x={142} y={36}>Dead</text>
        <text x={142} y={59}>Unknown</text>
      </svg>
    </section>
  );
}
