# Multi-número de WhatsApp — lo que construye **Hermes**

> Contrato **v1 · BORRADOR** · 2026-07-24 · Par: [`cerberus.md`](./cerberus.md) · Base técnica: issue **#50**
>
> **Dirección de la integración:** Cerberus es el registro humano (panel + fuente de verdad del mapa
> número↔vendedora) y **empuja** los cambios a Hermes por HTTP (push). Hermes es dueño de las sesiones
> de WhatsApp (credenciales en VPS1), del ruteo de mensajes y del estado de sesión, y **expone** el API
> de administración de este documento.

## Los dos frentes

| Frente | Qué | ¿Lo toca Cerberus? |
|---|---|---|
| **A — Ruteo multi-número** (interno, issue #50) | Que la respuesta salga por el número al que llegó el mensaje | No |
| **B — API de administración** (este doc) | Lo que Cerberus consume para administrar números, asignaciones y vinculación | Sí (lo llama) |

El modelo de datos ya está listo para varios números: cada mensaje se estampa con `numeroPropio` y la
clave de conversación ya es `(canal, persona, numeroPropio)`. Verificado en prod: **el 100 % de los
mensajes de WhatsApp tiene `numeroPropio` poblado**. Lo que falta es runtime + administración.

---

## Frente A — Ruteo (issue #50, interno de Hermes)

Hoy hay **un** transporte (`WHATSAPP_NUMERO`, singleton `whatsapp()` en `server/src/whatsapp/wiring.ts`).
Para N números:

- [ ] **`GestorWhatsapp`** reemplaza el singleton por un `Map<numero, transporte>`; levanta un transporte
  por cada número `activo` con sesión. **Fallback**: si `numeros_wa` está vacía, usa `WHATSAPP_NUMERO`
  (VPS1 sigue andando sin tocar nada).
- [ ] **Guarda #0** en `EnvioControlado`: la orden ya lleva `numeroPropio`; enrutar al transporte de ESE
  número y rechazar (sin auditar) si no coincide. Hoy `numeroPropio` se **audita pero no se rutea** —
  con 2 números una respuesta puede salir por el equivocado.
- [ ] **Bug de mezcla de hilos**: `GET /api/whatsapp/conversacion/:telefono` filtra solo por teléfono
  del contacto → scopear también por `numeroPropio` (ídem `marcarLeido` y `foto`). Latente con 1
  número; se destapa con el 2.º.
- [ ] `claveDeConversacion(canal, telefono, numeroPropio)` **pura** (hoy duplicada en el front).

> Frente A es independiente de Cerberus; es lo que hace funcionar "responder desde el mismo número".

---

## Frente B — API de administración

### Autenticación — credencial de servicio

Todas las rutas `/api/admin/*` van detrás de una **credencial de servicio** (patrón issue #95), separada
del token HMAC de vendedora:

- Header: `Authorization: Bearer <token>`.
- El token se compara contra el env **`HERMES_ADMIN_SERVICE_TOKEN`** (fail-closed, `timingSafeEqual`).
  Identidad lógica: `servicio:cerberus`. Es el **mismo secreto** que Cerberus guarda como
  `HERMES_ADMIN_TOKEN`.
- Sin token o token inválido → **401** `{ "error": { "motivo": "credencial_invalida", "mensaje": "…" } }`.
- [ ] Middleware **`requiereServicio`** (nuevo, `server/src/auth/`), montado delante del router admin.
  Convive con el perímetro de vendedoras (ADR 0009).

> El token se **referencia por nombre**, jamás se pega en código/docs (regla dura #1). Se provisiona
> fuera de banda y se rota cambiando el env + redeploy.

### Modelo de datos

`server/src/db/schema.ts`, aplicar con `npm run db:push`. Hermes guarda una **copia** del mapa (la
necesita para etiquetar la cola y para reportes); Cerberus es la fuente.

**`numeros_wa`** — el número y su significado:

| columna | tipo | nota |
|---|---|---|
| `numero` | text **PK** | canónico: solo dígitos con código país (`51986394450`) |
| `etiqueta` | text | nombre visible |
| `proposito` | text | `escuela` \| `campana` \| `vendedora` |
| `referencia` | text null | solo `campana` (adId / campaña) |
| `activo` | boolean | default `true` |
| `vinculado_at` | timestamptz null | cuándo quedó la sesión |
| `creado_at` / `actualizado_at` | timestamptz | |

**`numero_vendedora`** — el mapa muchos-a-muchos (etiqueta / atribución):

| columna | tipo | nota |
|---|---|---|
| `numero` | text FK → `numeros_wa` | |
| `vendedora_id` | text | **username de Cerberus** (misma clave que `vendedoraId` en `envios_wa`/`gestiones`) |
| **PK** | (`numero`, `vendedora_id`) | |

El **estado de sesión** (conectado/baneado/…) NO se persiste como fuente: lo sabe el transporte en
vivo, y el `GET` lo calcula al momento.

> **Atribución de venta ≠ este mapa.** La venta se acredita a la vendedora del **token** que la registró
> (`vendedoraId`), no al dueño del número. Por eso "2 vendedoras en 1 número" no crea ambigüedad.

### El objeto `Numero` (lo que devuelve Hermes)

```json
{
  "numero": "51986394450",
  "etiqueta": "Escuela — línea principal",
  "proposito": "escuela",
  "referencia": null,
  "activo": true,
  "vendedoras": ["ana.torres", "bea.lopez"],
  "sesion": {
    "estado": "conectado",
    "vinculado_at": "2026-07-21T16:20:00Z",
    "ban": null
  }
}
```

- `sesion.estado` ∈ `sin_vincular` · `vinculando` · `conectado` · `desconectado` · `baneado`.
- `sesion.ban` = `null` **o** `{ "codigo": "temporary_ban", "expira_at": "2026-07-25T…Z" }`. El ban
  **se muestra siempre**, nunca se esconde.

### Endpoints

Todos bajo `/api/admin`, todos con `Authorization: Bearer`.

#### `GET /api/admin/numeros`
Lista todos los números con su estado de sesión en vivo.
→ `200` `{ "numeros": Numero[] }`

#### `GET /api/admin/numeros/:numero`
→ `200` `{ "numero": Numero }` · `404 no_existe`

#### `PUT /api/admin/numeros/:numero` — **upsert declarativo** (crea o actualiza)
Cerberus manda el **estado deseado completo**. Idempotente (retry-safe).
```json
{
  "etiqueta": "Escuela — línea principal",
  "proposito": "escuela",
  "referencia": null,
  "activo": true,
  "vendedoras": ["ana.torres", "bea.lopez"]
}
```
- Crea el número si no existía (queda `sesion.estado = "sin_vincular"` hasta vincular).
- **Reemplaza el set completo** de `vendedoras` (agregar/quitar en una sola llamada).
→ `200` `{ "numero": Numero }` · `400 entrada_invalida`

#### `DELETE /api/admin/numeros/:numero` — baja lógica
Marca `activo = false` y detiene su transporte. **No borra la sesión** (`.wa-sessions/<numero>.db` queda).
→ `200` `{ "ok": true }` · `404 no_existe`
Purga destructiva de la credencial (opcional, guardado): `?purgar=true` borra también la `.db`.

#### `POST /api/admin/numeros/:numero/vincular` — arranca la vinculación
Arranca el pareo (uno-a-la-vez: SQLite no admite dos escritores de la misma sesión — reusa
`server/src/whatsapp/vinculador.ts`). Devuelve `{ "estado": "vinculando" }`; **el QR aparece en el
polling de `.../vincular/estado`** (estado `esperando_qr`, con `qr`) — llega por evento ~1-2 s después
del arranque y rota solo.
→ `200` `{ "estado": "vinculando" }`
- `409 vinculacion_en_curso` → `{ "error": { "motivo": "vinculacion_en_curso", "numero_en_curso": "51955000000" } }` si otro número se está vinculando.
- `409 ya_vinculado` si el número ya está conectado (pasar `?forzar=true` para re-parear).

#### `GET /api/admin/numeros/:numero/vincular/estado` — polling del pareo
→ `200` `{ "estado": "conectado", "vinculado_at": "2026-07-24T14:30:00Z" }`
`estado` ∈ `esperando_qr` · `vinculando` · `conectado` · `baneado` · `expirado` · `error`. Con `qr`
cuando es `esperando_qr`; en `error`: `{ "estado": "error", "motivo": "…" }`.
Al llegar a `conectado`, Hermes libera la sesión y el `GestorWhatsapp` levanta el transporte del número.

#### `GET /api/admin/ping` — verificación de credencial
→ `200` `{ "servicio": "cerberus", "ok": true }` (para que Cerberus valide el token en su config).

### Errores (envelope común)

```json
{ "error": { "motivo": "no_existe", "mensaje": "El número 519… no está registrado." } }
```
`motivo` → HTTP: `entrada_invalida`→400 · `credencial_invalida`→401 · `no_existe`→404 ·
`vinculacion_en_curso` / `ya_vinculado` / `conflicto`→409 · `fallo_interno`→500. (Uniones
discriminadas, patrón de la casa — `docs/arquitectura.md` §5.4.)

### Normalización del número

Canónico = **solo dígitos, con código de país, sin `+` ni espacios** (`51986394450`). Hermes normaliza
al recibir (`normalizarTelefono`, Perú `51` por defecto); el `:numero` de la URL va en canónico.

---

## El claim (D5) — ticket aparte, prerrequisito del caso "número compartido"

Para "pool + claim" (dos vendedoras en un número sin doble-mensaje) hace falta construir el claim, que
**hoy no existe** (verificado). Fuera de este contrato, pero necesario:
- [ ] Claim por conversación (`vendedora_id`, `expira_at` corto).
- [ ] Al abrir un chat: tomar el claim, mostrar "la atiende Ana" en la fila, liberar por TTL.

---

## Checklist Hermes

- [ ] `numeros_wa` + `numero_vendedora` (schema + `db:push`).
- [ ] `requiereServicio` + env `HERMES_ADMIN_SERVICE_TOKEN`.
- [ ] Router nuevo `server/src/routes/admin.ts` con los 7 endpoints (Zod valida entrada/salida).
- [ ] Reusar `vinculador.ts` (singleton) bajo `/api/admin/…/vincular`.
- [ ] `GestorWhatsapp` + guarda #0 + fix bug de hilos (issue #50).
- [ ] Consumir `numero_vendedora` para etiquetar la cola y reportes por vendedora (follow-up).
- [ ] Claim D5 (ticket aparte).
- [ ] ADR: "`GestorWhatsapp` reemplaza el singleton `whatsapp()`" + "API de administración desde Cerberus".
- [ ] Tests: contrato del router (401 sin token, upsert idempotente, `vincular` 409 en curso) + con-base
  (#33) para el hilo scopeado por `numeroPropio`.
