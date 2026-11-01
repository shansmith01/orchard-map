# Orchard Map

A full-stack React app built with [Void](https://void.cloud/) (Vite + Cloudflare Workers, D1 database).

## Develop

```sh
pnpm install
pnpm void db seed   # optional: load sample data from db/seed.ts
pnpm dev            # http://localhost:5173
```

- `pages/` — UI pages, with companion `.server.ts` loaders and actions
- `routes/api/` — server API routes
- `db/schema.ts` — Drizzle schema (D1/SQLite)

## Deploy

```sh
pnpm void deploy --platform cloudflare
```
