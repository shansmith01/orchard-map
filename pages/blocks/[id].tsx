import { action } from "@void/react";
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  layoutGeometry,
  layoutStats,
  makeBay,
  makeRow,
  newId,
  vineStatuses,
  type Bay,
  type Layout,
  type Row,
  type Vine,
} from "../../lib/layout";
import type { Props } from "./[id].server";
import "../style.css";

type Tool = "select" | "female" | "male" | "erase";
type Selection =
  | { kind: "row"; rowId: string }
  | { kind: "bay"; rowId: string; bayId: string }
  | { kind: "vine"; rowId: string; bayId: string; vineId: string }
  | null;
type View = { scale: number; tx: number; ty: number }; // pixels per metre + pan offset

const TOOLS: { id: Tool; label: string; key: string }[] = [
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
    if (!selection) return;
    edit((d) => {
      const { row, bay } = find(d, selection.rowId, "bayId" in selection ? selection.bayId : undefined);
      if (selection.kind === "vine" && bay) bay.vines = bay.vines.filter((v) => v.id !== selection.vineId);
      if (selection.kind === "bay" && row) row.bays = row.bays.filter((b) => b.id !== selection.bayId);
      if (selection.kind === "row") d.rows = d.rows.filter((r) => r.id !== selection.rowId);
    });
    setSelection(null);
  }, [selection, edit]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && e.target.closest("input, select, textarea");
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void save();
      } else if (typing) {
        return;
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        undo();
      } else if (e.key === "Delete" || e.key === "Backspace") {
        deleteSelection();
      } else if (e.key === "Escape") {
        setSelection(null);
      } else {
        const t = TOOLS.find((t) => t.key === e.key.toUpperCase());
        if (t && !e.ctrlKey && !e.metaKey) setTool(t.id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save, undo, deleteSelection]);

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
  const geo = useMemo(() => layoutGeometry(layout), [layout]);
  const [view, setView] = useState<View | null>(null);
  const drag = useRef<
    | { kind: "pan"; startX: number; startY: number; view: View; moved: boolean; onClick?: () => void }
    | { kind: "vine"; rowId: string; bayId: string; vineId: string; base: Layout; started: boolean }
    | null
  >(null);

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
    const g = geo.bays.find((b) => b.row.id === rowId && b.bay.id === bayId)!;
    const p = toWorld(clientX, clientY);
    const clamp = (n: number) => Math.round(Math.min(1, Math.max(0, n)) * 1000) / 1000;
    return { x: clamp((p.x - g.x) / g.w), y: clamp((p.y - g.y) / g.h) };
  };

  const startPan = (e: ReactPointerEvent, onClick?: () => void) => {
    if (!view) return;
    svgRef.current!.setPointerCapture(e.pointerId);
    drag.current = { kind: "pan", startX: e.clientX, startY: e.clientY, view, moved: false, onClick };
  };

  const onBayDown = (e: ReactPointerEvent, row: Row, bay: Bay) => {
    if (e.button !== 0) return startPan(e);
    e.stopPropagation();
    const { clientX, clientY } = e;
    startPan(e, () => {
      if (tool === "female" || tool === "male") {
        const pos = bayFraction(row.id, bay.id, clientX, clientY);
        const vine: Vine = { id: newId(), sex: tool, status: "ok", note: "", ...pos };
        edit((d) => find(d, row.id, bay.id).bay!.vines.push(vine));
        onSelect({ kind: "vine", rowId: row.id, bayId: bay.id, vineId: vine.id });
      } else {
        onSelect({ kind: "bay", rowId: row.id, bayId: bay.id });
      }
    });
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
    if (d?.kind === "pan" && !d.moved) (d.onClick ?? (() => onSelect(null)))();
  };

  const s = view?.scale ?? 10;
  const sel = selection;
  const poles = useMemo(() => {
    const seen = new Map<string, { x: number; y: number }>();
    for (const b of geo.bays) {
      for (const [x, y] of [
        [b.x, b.y],
        [b.x + b.w, b.y],
        [b.x, b.y + b.h],
        [b.x + b.w, b.y + b.h],
      ]) {
        seen.set(`${x.toFixed(2)},${y.toFixed(2)}`, { x, y });
      }
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
        onPointerCancel={() => (drag.current = null)}
        onPointerLeave={() => onHover(null)}
        role="application"
        aria-label="Block layout"
      >
        {view && (
          <g transform={`translate(${view.tx} ${view.ty}) scale(${view.scale})`}>
            {geo.rows.map(({ row, x, w }, i) => {
              const label = row.name || `Row ${i + 1}`;
              return (
              <text
                key={row.id}
                className={`row-label ${sel?.kind === "row" && sel.rowId === row.id ? "selected" : ""}`}
                x={x + w / 2}
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
            {geo.bays.map(({ row, bay, x, y, w, h }, i) => {
              const bayIndex = row.bays.indexOf(bay);
              const selected =
                (sel?.kind === "bay" && sel.bayId === bay.id) || (sel?.kind === "row" && sel.rowId === row.id);
              return (
                <rect
                  key={bay.id}
                  className={`bay ${selected ? "selected" : ""} ${i % 2 ? "alt" : ""}`}
                  x={x}
                  y={y}
                  width={w}
                  height={h}
                  vectorEffect="non-scaling-stroke"
                  onPointerDown={(e) => onBayDown(e, row, bay)}
                  onPointerEnter={() =>
                    onHover(
                      `${row.name || "Row"} · Bay ${bayIndex + 1} · ${bay.lengthM} m long × ${bay.widthM} m wide · ${bay.vines.length} vines`,
                    )
                  }
                />
              );
            })}
            {s > 14 &&
              geo.bays.map(({ row, bay, x, y, w, h }) => (
                <text key={bay.id} className="bay-number" x={x + w / 2} y={y + h / 2} fontSize={0.9}>
                  {row.bays.indexOf(bay) + 1}
                </text>
              ))}
            {poles.map((p) => (
              <rect key={`${p.x},${p.y}`} className="pole" x={p.x - 0.15} y={p.y - 0.15} width={0.3} height={0.3} />
            ))}
            {geo.bays.map(({ row, bay, x, y, w, h }) =>
              bay.vines.map((v) => {
                const cx = x + v.x * w;
                const cy = y + v.y * h;
                const selected = sel?.kind === "vine" && sel.vineId === v.id;
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
      </section>
    );
  }
  const { row, bay, vine } = find(
    layout,
    selection.rowId,
    "bayId" in selection ? selection.bayId : undefined,
    selection.kind === "vine" ? selection.vineId : undefined,
  );
  if (!row || (selection.kind !== "row" && !bay) || (selection.kind === "vine" && !vine)) return null;
  const rowIndex = layout.rows.indexOf(row);
  const rowName = row.name || `Row ${rowIndex + 1}`;

  if (selection.kind === "vine" && bay && vine) {
    const set = (patch: Partial<Vine>) => edit((d) => Object.assign(find(d, row.id, bay.id, vine.id).vine!, patch));
    return (
      <section>
        <h3>
          Vine <span className="muted">· {rowName}, bay {row.bays.indexOf(bay) + 1}</span>
        </h3>
        <div className="segmented" role="group" aria-label="Sex">
          {(["female", "male"] as const).map((sex) => (
            <button key={sex} aria-pressed={vine.sex === sex} onClick={() => set({ sex })}>
              {sex === "female" ? "Female" : "Male"}
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
        <div className="actions">
          <button onClick={() => onSelect({ kind: "bay", rowId: row.id, bayId: bay.id })}>Select bay</button>
          <button className="danger" onClick={onDelete}>
            Delete vine
          </button>
        </div>
      </section>
    );
  }

  if (selection.kind === "bay" && bay) {
    const bayIndex = row.bays.indexOf(bay);
    const set = (patch: Partial<Bay>) => edit((d) => Object.assign(find(d, row.id, bay.id).bay!, patch));
    const insert = (at: number) => {
      const nb = makeBay(bay.lengthM, bay.widthM, 0);
      edit((d) => {
        const r = find(d, row.id).row!;
        r.bays.splice(at, 0, nb);
        if (at === 0) r.offsetM = Math.max(0, r.offsetM - nb.lengthM);
      });
      onSelect({ kind: "bay", rowId: row.id, bayId: nb.id });
    };
    return (
      <section>
        <h3>
          Bay {bayIndex + 1} <span className="muted">· {rowName}</span>
        </h3>
        <div className="field-grid">
          <NumberField label="Length (m)" value={bay.lengthM} onChange={(lengthM) => lengthM > 0 && set({ lengthM })} />
          <NumberField label="Width (m)" value={bay.widthM} onChange={(widthM) => widthM > 0 && set({ widthM })} />
        </div>
        <p className="muted">
          {bay.vines.filter((v) => v.sex === "female").length} female, {bay.vines.filter((v) => v.sex === "male").length} male
        </p>
        <div className="actions">
          <button onClick={() => insert(bayIndex)}>Insert bay before</button>
          <button onClick={() => insert(bayIndex + 1)}>Insert bay after</button>
          <button onClick={() => set({ vines: makeBay(bay.lengthM, bay.widthM, 2).vines })}>Reset to 2 vines per side</button>
          <button onClick={() => set({ vines: [] })}>Clear vines</button>
          <button onClick={() => onSelect({ kind: "row", rowId: row.id })}>Select row</button>
          <button className="danger" onClick={onDelete}>
            Delete bay
          </button>
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
      <p className="muted">
        {row.bays.length} bays · {row.bays.reduce((n, b) => n + b.lengthM, 0).toFixed(1)} m long
      </p>
      <div className="field-grid">
        <NumberField label="All bays length" value={row.bays[0]?.lengthM ?? 6} onChange={(n) => n > 0 && setRow((r) => r.bays.forEach((b) => (b.lengthM = n)))} />
        <NumberField label="All bays width" value={row.bays[0]?.widthM ?? 4} onChange={(n) => n > 0 && setRow((r) => r.bays.forEach((b) => (b.widthM = n)))} />
      </div>
      <div className="actions">
        <button
          onClick={() =>
            setRow((r) => {
              const nb = makeBay(r.bays[0]?.lengthM ?? 6, r.bays[0]?.widthM ?? 4, 2);
              r.bays.unshift(nb);
              r.offsetM = Math.max(0, r.offsetM - nb.lengthM);
            })
          }
        >
          Add bay at top
        </button>
        <button onClick={() => setRow((r) => r.bays.push(makeBay(last?.lengthM ?? 6, last?.widthM ?? 4, 2)))}>Add bay at bottom</button>
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

function AddRows({ layout, edit }: { layout: Layout; edit: (fn: (d: Layout) => void) => void }) {
  const [opts, setOpts] = useState({ count: 1, bays: 10, lengthM: 6, widthM: 4, vinesPerSide: 2, offsetM: 0 });
  const set = (k: keyof typeof opts) => (n: number) => setOpts((o) => ({ ...o, [k]: n }));
  return (
    <section>
      <h3>Add rows</h3>
      <div className="field-grid">
        <NumberField label="Rows" step={1} min={1} value={opts.count} onChange={set("count")} />
        <NumberField label="Bays per row" step={1} min={1} value={opts.bays} onChange={set("bays")} />
        <NumberField label="Bay length (m)" value={opts.lengthM} onChange={set("lengthM")} />
        <NumberField label="Bay width (m)" value={opts.widthM} onChange={set("widthM")} />
        <NumberField label="Vines per side" step={1} value={opts.vinesPerSide} onChange={set("vinesPerSide")} />
        <NumberField label="Start at (m)" value={opts.offsetM} onChange={set("offsetM")} />
      </div>
      <button
        className="primary wide"
        disabled={opts.count < 1 || opts.bays < 1 || opts.lengthM <= 0 || opts.widthM <= 0}
        onClick={() =>
          edit((d) => {
            for (let i = 0; i < Math.min(opts.count, 100); i++) {
              d.rows.push(
                makeRow(`Row ${d.rows.length + 1}`, opts.offsetM, Math.min(opts.bays, 200), opts.lengthM, opts.widthM, Math.min(opts.vinesPerSide, 10)),
              );
            }
          })
        }
      >
        Add {opts.count === 1 ? "row" : `${opts.count} rows`} to the right
      </button>
      {layout.rows.length > 0 && <p className="muted small">Then select a row to shorten it, offset its start or change bay sizes.</p>}
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
