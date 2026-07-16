# meta-escuela — reglas para Claude

Dashboard de pauta Meta Ads del negocio educativo (Goberna, escuela de formación política en LATAM): ROAS, embudo, bandeja de leads y cierre del lazo con Meta (CAPI). Repo ANIDADO: la raíz git es `meta-escuela/meta-escuela`.

## Stack
- **Front**: React 19 + Vite 8 (React Compiler vía `@rolldown/plugin-babel`), Tailwind 4, TanStack Query/Table, Recharts, react-router 7. Lint: oxlint.
- **Server** (`server/`): Express 4 + Drizzle ORM + Postgres 17 (Docker local, puerto **5434** — el 5433 lo usa el LMS). Zod 4.
- **`goberna-kos/`**: CQ Engine del Goberna Knowledge OS (sub-proyecto Python/TS dentro del mismo repo).
- Doble lockfile en la raíz: `bun.lock` + `package-lock.json`, ambos versionados — si tocás deps, sincronizá ambos (TODO verificar cuál manda).

## Correr en local
- `docker compose up -d --wait` — el `--wait` es obligatorio: espera el healthcheck de Postgres.
- `npm run dev` → front en `:5173` · `cd server && npm run dev` → API en `:4100`. Atajo tmux: `ivi matriz`.
- Tests: `cd server && npm test` (puros, sin DB). Typecheck: `npx tsc --noEmit` (server) y `npx tsc --noEmit -p tsconfig.app.json` (front). Trampas conocidas en `docs/06-ENTORNO.md`.

## Deploy
- **No hay CI/CD ni workflows**: corre local en la máquina de trabajo, no está desplegado en los VPS (TODO verificar si habrá deploy). Los datos vienen del ERP Cerberus (VPS2 `:8001`) vía dump SQL + webhook.
- **El engine Ivi** (`goberna-kos/ivi/`) sí está desplegado: corre en geógrafo (`100.117.204.80:8080`) como unidad **systemd** (`ivi.service`, sobrevive reboots y kill -9). Lo activa el operador con `goberna-kos/deploy-ivi-geografo.sh` (necesita TTY para sudo — no correrlo desde un agente). Probe: `GET /api/health`. Tests del engine: `python3 goberna-kos/tests/run.py` (sin pytest).

## Reglas de negocio / gotchas
- **`DECISIONES_MODO=simulacion` es el default**: nada se escribe en Meta. Con `META_TEST_EVENT_CODE` seteado todo va a Test Events. No cambiar estos interruptores sin decisión humana.
- **Esquema vía `drizzle-kit push`** (`npm run db:push` en `server/`): NO hay migraciones SQL versionadas. El `schemaFilter` de `server/drizzle.config.ts` debe incluir `fuentes` y `ontologia` — sin eso esos esquemas nunca se crean, en silencio.
- Secretos solo en `server/.env` (nunca se commitea). Nada de credenciales en el repo.

## Agent skills

### Issue tracker

GitHub Issues del repo (via gh CLI). Ver `docs/agents/issue-tracker.md`.

### Triage labels

Los 5 labels canónicos por defecto. Ver `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` + `docs/adr/` en la raíz. Ver `docs/agents/domain.md`.
