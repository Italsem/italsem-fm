# Italsem FM

Applicazione React + Cloudflare Pages Functions per la gestione rifornimenti, mezzi e report consumi.

## Sviluppo locale

```bash
npm ci
npm run dev
```

## Build locale

```bash
npm run build
npm run lint
```

## Deploy Cloudflare Pages

Questa repo usa `wrangler.toml` con:

- `pages_build_output_dir = "dist"`
- build command: `npm run build`

Se in Cloudflare compaiono errori TypeScript/JSX (es. `Expected corresponding JSX closing tag for 'main'`), verifica sempre che il deploy stia puntando all'**ultimo commit** che passa localmente `npm run build`.

### Checklist rapida

1. `npm run build` in locale deve passare.
2. `npm run lint` in locale deve passare.
3. Il commit pushato deve contenere le ultime modifiche su `src/App.tsx`.
4. Su Cloudflare, rilancia il deploy dal commit più recente.

## CI

È presente una GitHub Action (`.github/workflows/build-check.yml`) che esegue automaticamente:

- `npm ci`
- `npm run lint`
- `npm run build`

così eventuali regressioni di build vengono bloccate prima della distribuzione.
