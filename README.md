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

## Errore: `Unexpected token '<' ... non e un JSON valido`

Questo errore indica che una chiamata API (`/api/...`) ha ricevuto HTML (tipicamente `index.html`) invece di JSON.

Controlli da fare su Cloudflare Pages:

1. Project con **Pages Functions abilitate** (cartella `functions/` presente nel repo).
2. Deploy del **commit piu recente** (non un merge commit vecchio).
3. Verificare che le route `/api/*` rispondano (es. `/api/debug-db`).
4. Verificare i binding (`DB`, `PHOTOS`) nel progetto Pages.

## "Linux" nel log di deploy

E normale: Cloudflare builda in ambiente Linux remoto. Non dipende dal fatto che tu usi Windows.

## Checklist rapida

1. `npm run build` in locale deve passare.
2. `npm run lint` in locale deve passare.
3. Su Cloudflare, rilancia il deploy dal commit piu recente.
4. Testa `/api/debug-db` dopo il deploy per confermare le Functions.

## CI

E presente una GitHub Action (`.github/workflows/build-check.yml`) che esegue automaticamente:

- `npm ci`
- `npm run lint`
- `npm run build`

cosi eventuali regressioni di build vengono bloccate prima della distribuzione.


## Alert automatici email per scadenze

E possibile inviare alert email automatici per le scadenze dei mezzi tramite endpoint API:

- `GET /api/alerts/deadlines?days=30` → anteprima delle scadenze nel periodo
- `POST /api/alerts/deadlines?days=30` → invio email riepilogo scadenze

Requisiti:

- autenticazione con utente `admin`
- variabili ambiente su Cloudflare Pages:
  - `ALERT_EMAIL_TO` (obbligatoria, una o piu email separate da virgola)
  - `ALERT_EMAIL_FROM` (opzionale, default `alert@italsem-fm.local`)
  - `ALERT_EMAIL_SUBJECT` (opzionale)

Esempio chiamata:

```bash
curl -X POST "https://<tuo-dominio>/api/alerts/deadlines?days=30" \
  -H "Authorization: Bearer <TOKEN_ADMIN>"
```

Per automatizzare il processo, configura un cron esterno (es. GitHub Actions schedule, cron server, Zapier/Make) che chiami il `POST` giornalmente.
