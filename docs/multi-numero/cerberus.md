# Multi-número de WhatsApp — lo que construye **Cerberus**

> Contrato **v1 · BORRADOR** · 2026-07-24 · Par: [`hermes.md`](./hermes.md) (contrato autoritativo del API)
>
> **Tu rol (Cerberus):** sos el **registro humano** y el **panel de administración**. Acá el admin
> gestiona qué números de WhatsApp existen, qué significan y qué vendedora(s) tiene cada uno; y desde
> acá se **vincula** (se escanea el QR). Cerberus **empuja** todo eso a Hermes por HTTP; Hermes ejecuta
> el ruteo de mensajes y guarda las credenciales de WhatsApp.
>
> **Estado del lado Hermes (2026-07-24):** el API está **implementado, testeado y en verde** (PR #103:
> 353 tests puros + 33 con base + smoke HTTP del contrato). Base pública: `https://hermes-api.goberna.us`
> (queda vivo cuando se deploye a VPS1). El secreto `HERMES_ADMIN_TOKEN` te lo pasa Estephano por canal
> seguro (nunca en este repo). **Podés arrancar tu panel ya**, contra este contrato — no cambia al deployar.

## Qué NO hacés (para acotar el trabajo)

- **No** manejás sesiones de WhatsApp ni el protocolo: eso es 100 % de Hermes.
- **No** decidís por qué número sale una respuesta: lo hace Hermes, por el número al que llegó el mensaje.
- El mapa número↔vendedora es **solo etiqueta y atribución** — **no** reparte la cola: en Hermes todas
  las vendedoras siguen viendo todas las conversaciones. Asignar una vendedora a un número es
  organizarlo/etiquetarlo, no crear una bandeja privada.

---

## 1. Modelos Django (la fuente de verdad)

- **`NumeroWhatsapp`**: `numero` (canónico, único), `etiqueta`, `proposito`
  (`escuela` | `campana` | `vendedora`), `referencia` (null salvo campaña), `activo` (bool).
- Asignación **M2M** `NumeroWhatsapp.vendedoras → User`. La vendedora es el `User` de Cerberus, y **su
  `username` es la clave que viaja a Hermes** (Hermes ya identifica a las vendedoras por ese username).

## 2. El panel (UI de administración)

Pantalla "Números de WhatsApp":

- **Tabla**: número · etiqueta · propósito · vendedora(s) · **estado de sesión** (badge en vivo, traído
  de Hermes) · acciones.
- **Crear / editar número**: form (número, etiqueta, propósito, referencia si es campaña, vendedoras[]).
- **Botón "Vincular"**: abre un modal, muestra el **QR** (de Hermes) y hace *polling* hasta "conectado".
  Aviso al operador: "escaneá con el teléfono → WhatsApp → Dispositivos vinculados → Vincular".
- **Botón "Desactivar"**.

El **estado de sesión** (`conectado` / `desconectado` / `baneado` / `sin_vincular`) lo sabe **solo
Hermes**; lo traés con `GET /api/admin/numeros`. Si viene `sesion.ban`, **mostralo siempre** (nunca lo
escondas).

## 3. Cliente HTTP hacia Hermes

- Base: **`HERMES_BASE_URL`** = `https://hermes-api.goberna.us`
- Auth en **cada** request: `Authorization: Bearer <HERMES_ADMIN_TOKEN>`
  (mismo secreto que Hermes valida como `HERMES_ADMIN_SERVICE_TOKEN`; en tu config, **referenciado por
  nombre**, nunca pegado en el código ni commiteado).
- Al configurar, verificá el token: `GET /api/admin/ping` → `200 { "servicio": "cerberus", "ok": true }`.

### Cuándo llamás a qué

**Crear o editar un número (o cambiar sus vendedoras)** — un solo endpoint, declarativo e idempotente:

```
PUT {HERMES_BASE_URL}/api/admin/numeros/{numero}
Authorization: Bearer <HERMES_ADMIN_TOKEN>
Content-Type: application/json

{ "etiqueta": "Escuela — línea principal",
  "proposito": "escuela",
  "referencia": null,
  "activo": true,
  "vendedoras": ["ana.torres", "bea.lopez"] }
```
- `vendedoras` = lista de **usernames** de Cerberus. **Reemplaza el set completo** (así agregás/quitás en
  una sola llamada).
- → `200 { "numero": { … } }`. Mandá esto cada vez que el admin guarda el form.

**Desactivar un número:**
```
DELETE {HERMES_BASE_URL}/api/admin/numeros/{numero}   → 200 { "ok": true }
```

**Poblar / refrescar la tabla (con estados en vivo):**
```
GET {HERMES_BASE_URL}/api/admin/numeros
→ { "numeros": [ { …, "sesion": { "estado": "conectado", "ban": null } } ] }
```

**Vincular (con el teléfono a mano):**
1. `POST {HERMES_BASE_URL}/api/admin/numeros/{numero}/vincular` → `{ "estado": "vinculando" }`.
   (Arranca el pareo; el QR **no** viene en esta respuesta, viene en el polling.)
2. *Polling* cada ~2 s: `GET …/api/admin/numeros/{numero}/vincular/estado` → `{ "estado": "…", "qr"?: "…" }`.
   Cuando `estado` sea `esperando_qr`, mostrá el `qr` en un `<img src="data:image/png;base64,…">`.
   Cerrá el modal en `conectado`; si `expirado`, volvé a arrancar (paso 1).
3. Si el paso 1 devuelve `409 vinculacion_en_curso`, avisá "hay otra vinculación en curso" y reintentá
   luego — **Hermes vincula de a un número por vez**.

### Manejo de errores

Todas las respuestas de error tienen la forma:
```json
{ "error": { "motivo": "…", "mensaje": "…" } }
```
| HTTP | motivo | Qué hacés |
|---|---|---|
| 400 | `entrada_invalida` | Datos del form mal (número/propósito); mostralo al admin |
| 401 | `credencial_invalida` | Token mal configurado; revisá `HERMES_ADMIN_TOKEN` |
| 404 | `no_existe` | El número no está registrado en Hermes (¿se saltó el `PUT`?) |
| 409 | `vinculacion_en_curso` / `ya_vinculado` | Reintentá / usá el flujo de vinculación |
| 5xx | `fallo_interno` | Hermes caído: **no pierdas el cambio local**, reintentá |

**Cerberus es la fuente de verdad:** si Hermes rechaza o está caído, **guardá el cambio en Django igual**
y reintentá el push (una cola/tarea de reintento). Un número que existe en Cerberus pero todavía no
llegó a Hermes = "pendiente de sincronizar" (mostralo como badge). Idealmente, un botón "re-sincronizar"
que re-emite el `PUT` de todos los números activos.

## 4. Normalización del número

Enviá **solo dígitos, con código de país, sin `+` ni espacios** — p. ej. `51986394450` — y usá ese mismo
formato en el `{numero}` de la URL. (Hermes re-normaliza, pero mandá canónico para que las claves
coincidan de los dos lados.)

## 5. Config / secretos

- `HERMES_BASE_URL` = `https://hermes-api.goberna.us`
- `HERMES_ADMIN_TOKEN` = credencial de servicio (la provee Goberna/infra). **Por nombre, nunca en el
  repo ni en el código.**

---

## Checklist Cerberus

- [ ] Modelos `NumeroWhatsapp` + M2M a `User` (`vendedoras`).
- [ ] Panel: tabla + form + modal de vinculación con QR + *polling* de estado.
- [ ] Cliente HTTP a Hermes: `PUT` (upsert), `DELETE`, `GET` (lista), `POST …/vincular`,
      `GET …/vincular/estado`, `GET /ping` — todos con el Bearer.
- [ ] Cola/retry del push (Cerberus es la fuente; tolerar Hermes caído sin perder cambios).
- [ ] Config `HERMES_BASE_URL` + `HERMES_ADMIN_TOKEN`.
- [ ] Normalización canónica del número antes de enviar.

---

## Resumen del flujo, punta a punta

1. Admin crea/edita el número en el panel de Cerberus y asigna vendedora(s).
2. Cerberus hace `PUT /api/admin/numeros/{numero}` → Hermes guarda su copia (`sin_vincular`).
3. Admin toca "Vincular" (con el teléfono en la mano) → Cerberus `POST …/vincular` → muestra el QR.
4. Admin escanea; Cerberus *pollea* `…/vincular/estado` hasta `conectado`.
5. Hermes levanta el transporte del número. Desde ahí, los mensajes que llegan a ese número aparecen en
   la cola (compartida) de Hermes, y las respuestas salen **por ese mismo número** automáticamente.
