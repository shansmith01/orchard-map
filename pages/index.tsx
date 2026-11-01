import { Form, useForm } from "@void/react";
import type { Props } from "./index.server";
import "./style.css";

export default function OrchardsPage({ orchards }: Props) {
  const orchardForm = useForm("/?createOrchard", { name: "" }, { resetOnSuccess: true });

  return (
    <main className="home">
      <header>
        <h1>Orchard Map</h1>
        <p>Pick a block to map its rows, bays and vines.</p>
      </header>

      {orchards.map((orchard) => (
        <section key={orchard.id} className="card">
          <h2>{orchard.name}</h2>
          {orchard.blocks.length === 0 ? (
            <p className="muted">No blocks yet.</p>
          ) : (
            <ul className="block-list">
              {orchard.blocks.map((b) => (
                <li key={b.id}>
                  <a href={`/blocks/${b.id}`}>{b.name}</a>
                  <span className="muted">
                    {b.rowCount} rows · {b.bayCount} bays
                  </span>
                </li>
              ))}
            </ul>
          )}
          <NewBlockForm orchardId={orchard.id} />
        </section>
      ))}

      <section className="card">
        <h2>New orchard</h2>
        <Form form={orchardForm} className="inline-form">
          <input
            aria-label="Orchard name"
            placeholder="Orchard name"
            value={orchardForm.data.name}
            onChange={(e) => orchardForm.setData("name", e.target.value)}
            required
          />
          <button disabled={orchardForm.pending}>Add orchard</button>
        </Form>
      </section>
    </main>
  );
}

function NewBlockForm({ orchardId }: { orchardId: number }) {
  const form = useForm("/?createBlock", { name: "", orchardId });
  return (
    <Form form={form} className="inline-form">
      <input
        aria-label="Block name"
        placeholder="New block name"
        value={form.data.name}
        onChange={(e) => form.setData("name", e.target.value)}
        required
      />
      <button disabled={form.pending}>Add block</button>
    </Form>
  );
}
