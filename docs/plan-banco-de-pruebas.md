# T13 · El banco de pruebas — probar el bot entero sin tocar producción

> **Pedido del dueño (29-jul-2026)**: «tiene que ser seguro, tengo que poder probarlo; sería genial
> que pueda haber un usuario de prueba con un número de prueba enlazado con QR para que podamos
> probar todo el flujo sin necesidad de romper Cerberus — el flujo de mensajes automáticos, registro
> de venta, etc.»
>
> Es el ticket **T13** del plan (`docs/plan-bot-primera-linea.md`) y **bloquea el rollout**: ninguna
> línea sube a `automatico` sin que la etapa B haya corrido de punta a punta. Vive aparte porque es
> largo y porque se lee solo, sin el plan al lado.

## T13 — El banco de pruebas

**Depende de**: T0 (la migración del bot tiene que existir para que la base del banco la aplique). Se puede construir en paralelo a T1–T5. **Modelo sugerido**: Opus para T13.0 y T13.1 (la guardia y el doble de Cerberus), Sonnet para el resto.
**Bloquea**: **T11.3 (rollout del lunes)**. Ninguna línea sube a `automatico` sin que la etapa B haya corrido de punta a punta.

Pedido del dueño, textual (29-jul): *«tiene que ser seguro, tengo que poder probarlo; sería genial que pueda haber un usuario de prueba con un número de prueba enlazado con QR para que podamos probar todo el flujo sin necesidad de romper Cerberus — el flujo de mensajes automáticos, registro de venta, etc.»*

---

### 🔴 El estado de HOY, verificado en esta laptop (29-jul, 11:09)

Esto no es contexto: es el primer bloqueante, y hay que resolverlo antes de escribir una línea.

```
server/.env             WHATSAPP_TRANSPORTE=whatsmeow
                        WHATSAPP_NUMERO=51986394450      ← la línea de VENTAS de producción
                        CERBERUS_BASE_URL=https://app.goberna.us   ← el ERP vivo
                        DATABASE_URL=…@127.0.0.1:5434/meta_escuela
server/.wa-sessions/    51986394450.db  (43 MB) · .db-shm con fecha de HOY 11:09
ps aux                  PID 10606  …/@whatsmeow-node/darwin-arm64/bin/whatsmeow-node
                        PID 10487  node … tsx … src/index.ts
```

**La laptop es hoy un dispositivo vinculado vivo de la línea que factura, apuntando al Cerberus de producción.** Cualquier banco de pruebas montado *sobre este checkout tal como está* arranca hablándole a leads reales. El banco vive en **otro checkout**, y eso no es prolijidad: `.wa-sessions/` y `.wa-media/` se derivan de `import.meta.url` (`whatsapp/wiring.ts:60`, `whatsapp/mediaDir.ts:19`, `whatsapp/vincular.ts:38`, `routes/admin.ts:39`) y **no son configurables por env**. Un directorio distinto es el único aislamiento posible de la credencial.

---

### Las dos etapas, y qué prueba cada una

El diseño es por etapas a propósito: **la etapa A destraba hoy el 80% sin depender de un segundo teléfono** (que es una dependencia externa que el código no resuelve), y la etapa B agrega el cable. **El aislamiento de la etapa A no se relaja en la B: es la misma guardia, el mismo checkout, la misma base, el mismo Cerberus de mentira.** Lo único que cambia entre las dos son **dos líneas del `.env`**.

#### Etapa A — la puerta de desarrollo (sin teléfono, sin SIM, sin QR)

`WHATSAPP_TRANSPORTE=falso` + `POST /api/whatsapp/_dev/simular`. Es el stack que el ensayo del 28-jul ya corrió 9/9 (`docs/checklist-3ago/checklist-3ago.md` §2), con la pieza que le faltaba: el Cerberus de mentira.

| Sí prueba | No prueba |
|---|---|
| Login **real** (handshake CSRF, `sesiones_cerberus`, token HMAC) contra el Django de mentira | Que el Django **real** acepte lo que le mandamos |
| Que entre un mensaje y se proyecte a la conversación | El cable de WhatsApp: delays reales, media, eco, `temporary_ban`, semáforo |
| `decision.ts` con hechos reales de base (T5), claims concurrentes, debounce | La reputación de la línea frente a Meta |
| Que el bot piense, que los guardrails bloqueen, que `bot_respuestas` guarde el porqué | El **tono y el ritmo tal como los ve una persona en su celular** |
| Modo sombra completo, y modo automático hasta el borde del transporte | Que `crearVenta` sobreviva a las validaciones de stock/cuotas/permisos de Cerberus |
| Ficha del panel → banda verde «Cliente» → botón **Registrar venta** → modal con monedas y países | El residuo de `clasificarRespuestaVenta` (venta.ts:147-150): un 200 con HTML cuenta como registrada. El falso siempre responde JSON limpio, **así que ese camino nunca se ejercita** |
| El `venta_request_key` que habría viajado al ERP, legible | El lazo hacia Meta (CAPI): apagado por ausencia de credenciales, a propósito |
| **Volumen**: 30 conversaciones de un `for`, topes por hora, spam, `SKIP LOCKED` | El ruteo multi-línea del bot (ver §Exigencias sobre T5) |

#### Etapa B — la línea real por QR (fidelidad, antes del lunes)

`WHATSAPP_TRANSPORTE=whatsmeow` + `WHATSAPP_NUMEROS=<número de prueba>`. El dueño le escribe desde su celular y el bot le contesta de verdad.

| Sí prueba, y **solo** esto lo prueba | Sigue sin probar |
|---|---|
| **El tono y el ritmo en la pantalla de una persona** — lo que ningún test puede ver | Concurrencia (una conversación no son 2.000) |
| Los delays del chunker, las burbujas, el orden real de llegada | `temporary_ban` (solo se produce con `simularBan()`, o sea en etapa A) |
| Media: que un flyer llegue y se vea | El paso de los días: follow-up a enfriados, caducidad, ventanas horarias |
| Desconexión y reconexión, el semáforo diciendo la verdad | Que la línea de **producción** se comporte igual (número nuevo ≠ número con historia) |
| Que un envío del bot quede marcado y aparezca en el hilo | Bugs que solo aparecen bajo `NODE_ENV=production` — eso lo sigue atrapando N3 |

⚠️ **`_dev/simular` deja de existir en la etapa B** y está bien: `index.ts:146-148` la monta solo si `NODE_ENV !== "production"` **y** hay al menos una línea falsa. No se inyectan mensajes de mentira en una sesión real. Volver a la etapa A es revertir las dos líneas.

---

**Leer primero**:
`server/src/pruebas/base.ts` (líneas 40-80: `PROHIBIDOS` + `guardarAntiProd` — **el molde exacto de la guardia**, incluido el detalle de imprimir `host:puerto/base` y nunca la URL entera) ·
`server/src/cerberus/auth.ts` (líneas 54-105: el handshake completo) · `server/src/cerberus/venta.ts` (líneas 82-89 `parseOpciones`/`parseCsrf`, 92-115 `cargarFormulario`, 135-155 `clasificarRespuestaVenta`, 154-245 `crearVenta`) · `server/src/cerberus/ficha.ts` (líneas 60-115: los dos GET y la confirmación por `telefonos[]`) · `server/src/cerberus/productos.ts` (líneas 68-88: el endpoint y `mapearProducto`) ·
`server/src/whatsapp/wiring.ts` (107-130) y `whatsapp/gestor.ts` (`numerosConfigurados`, línea 40) ·
`server/src/whatsapp/vincular.ts` (el QR: líneas 10, 38-56, 99-101) ·
`server/src/index.ts` (60, 124, 133, 146-149, 156-166) ·
`docs/adr/0022-staging.md` (**qué NO se deroga**) · `docs/checklist-3ago/checklist-3ago.md` §2 y §3 (el precedente y su hueco admitido).

---

## T13.0 — La guardia de arranque (va primero, sola, y nada se levanta hasta que esté verde)

`server/src/banco/guardia.ts`. Núcleo **puro** + cáscara impura, como toda la casa.

```ts
export interface Violacion { que: string; problema: string }

/** El de ventas, verificado en docs/deploy-vps1.md y en el CLAUDE.md. Literal en
 *  código y NO en un .env: un .env no pasa por PR. No son secretos. */
export const LINEAS_DE_PRODUCCION: readonly string[];

export const PUERTO_BANCO = '5441';
export const BASE_BANCO = 'hermes_banco';

/**
 * PURA. `sesiones` = nombres de archivo de server/.wa-sessions/ (inyectados para
 * poder testear cada motivo sin tocar disco ni env). Devuelve TODAS las
 * violaciones, no la primera. NUNCA arma un mensaje con una URL entera.
 */
export function motivosDeNoAislamiento(
  env: NodeJS.ProcessEnv, sesiones: string[], cwd: string,
): Violacion[];

/** La cáscara: lee el entorno real, imprime las coordenadas o las violaciones, y `process.exit(1)`. */
export function exigirAislamiento(): void;
```

Las once negativas, cada una con su violación nombrada:

1. **`DATABASE_URL`** parsea, hostname `127.0.0.1`, puerto **`5441`**, pathname **`/hermes_banco`**. Exigencia **positiva**, no solo lista negra.
2. La misma **lista negra** de `pruebas/base.ts` extendida: `:5434 :5438 :5439 :5440 meta_escuela hermes_db hermes_staging hermes_test`. (Se puede usar tal cual porque el banco tiene **Postgres propio con usuario `hermes_banco`** — si reusáramos el contenedor de dev, la cadena `meta_escuela` estaría en la URL por el rol y la guardia saltaría siempre. Ese es el motivo del contenedor aparte, no la prolijidad.)
3. **`CERBERUS_BASE_URL`** presente, parseada con `new URL()`, protocolo `http:` y hostname `127.0.0.1` o `localhost`. **Ausente = producción** (`?? 'https://app.goberna.us'` en siete archivos), así que ausente **se rechaza**.
4. **`META_ACCESS_TOKEN`, `META_TOKEN`, `META_PIXEL_ID`, `META_APP_ID`, `LAZO_RELOJ`** vacías o ausentes. No alcanza con no usarlas: no puede tenerlas. Así `capiDesdeEnv()` (`lazo/capi.ts:92-96`) tira y ningún `Purchase` sale hacia `graph.facebook.com`. Fail-closed **por ausencia**, sin depender de acordarse de `META_TEST_EVENT_CODE`.
5. **`ICARUS_DATABASE_URL`** e **`ICARUS_CERBERUS_WEBHOOK_URL`** ausentes (🚨 del CLAUDE.md: repuntar la segunda rompe producción de un cliente).
6. **`AUTO_RESPUESTA`** ≠ `on`. Dos mecanismos contestándole al mismo lead hacen la prueba ilegible.
7. **`HERMES_SESSION_SECRET`** presente, ≥32 caracteres y ≠ `dev-inseguro-cambiar-en-produccion`. Propio del banco: un token del banco no vale en producción y viceversa (el argumento del ADR 0022).
8. **`WHATSAPP_NUMERO` vacía**, siempre. Es el *fallback* de `numerosConfigurados` (`gestor.ts:41`: `env.WHATSAPP_NUMEROS ?? env.WHATSAPP_NUMERO ?? ''`): si sobrevive del `.env` viejo y alguien se olvida de `WHATSAPP_NUMEROS`, **levanta la línea de ventas**.
9. Con `WHATSAPP_TRANSPORTE=whatsmeow`: **`WHATSAPP_NUMEROS` tiene EXACTAMENTE una entrada, igual a `BANCO_NUMERO`, y `BANCO_NUMERO` no está en `LINEAS_DE_PRODUCCION`**.
10. **`server/.wa-sessions/` no contiene ningún `.db` que no sea `<BANCO_NUMERO>.db`** — la nombra por archivo y aborta. Es la única condición que mira el disco, y es la que atrapa el desastre real: una sesión de producción copiada a mano al worktree.
11. **`BOT_LINEAS` ⊆ {`BANCO_NUMERO`}**, **`PORT`** ≠ 4110 (prod) ≠ 4111 (staging), y el **cwd** no es `/srv/hermes`, `/srv/hermes-staging` ni `/Users/milaa/goberna/hermes` (el checkout canónico).

**El lanzador** `server/src/banco/servidor.ts` (`npm run banco`) es la **única puerta documentada** para arrancar el banco:

```ts
import 'dotenv/config';        // 1
import { exigirAislamiento } from './guardia.js';
exigirAislamiento();            // 2 — tira acá o no tira más
await import('../index.js');    // 3 — recién ahora existe el server
```

El orden es load-bearing: la guardia corre **entera** antes de que se importe una línea de `src/index.ts`, así que no hay estado a medio aplicar. **El lanzador no SETEA una sola variable: solo lee y valida.**

---

## T13.1 — El Cerberus de mentira

`server/src/banco/cerberusFalso.ts` + `banco/datos.ts` + `banco/ventasDelBanco.ts`. Express mínimo, **bind solo a `127.0.0.1`**, puerto **9910**. Se arranca como proceso aparte (`npm run banco:cerberus`) — **no es un router que se monte en `index.ts`**, así que no hay una línea de montaje que alguien pueda olvidarse de borrar.

Los siete handlers, con las formas **exactas** que el código real parsea (verificadas leyendo cada archivo, no supuestas):

| Endpoint | Forma obligatoria | Por qué, con la línea |
|---|---|---|
| `GET /ingresar/` | `Set-Cookie: csrftoken=X` + HTML con `name="csrfmiddlewaretoken" value="X"` | `auth.ts:60` — el regex es `/name="csrfmiddlewaretoken"\s+value="([^"]+)"/`: **ese orden de atributos y espacio en blanco entre ellos**, o el login da `{ok:false, caido:true}` |
| `POST /ingresar/` | credenciales del fixture → **302** con `Set-Cookie: sessionid=…` y `Location: /`; credenciales malas → **200** con el form | `auth.ts:98`: `if (redirige && sessionid && !location.includes('/ingresar'))`. La rama mala mantiene vivo el smoke, que exige **401 y no 503** |
| `GET /clientes/buscar/?q=` | `{clientes:[{id,nombre,codigo,dni,pais,correo}]}`, match por substring de dígitos | imita `telefonos__numero__icontains`; sin credencial, igual que el real |
| `GET /clientes/:id/json/` | `{ventas_count, ventas:[{folio_venta,estado_display,monto_total,moneda,fecha_venta}], telefonos:[{numero,prefijo}]}` | `ficha.ts:98-101` exige `Array.isArray(detalle.telefonos)` y confirma con `mismoTelefono`. **Sin `telefonos[]` no hay ficha ⇒ no hay botón de venta** — que es exactamente donde murió el ensayo del 28-jul |
| `GET /productos/api/public/productos-cursos/?estado=1[&q=]` | `{results:[{codigo_producto, sku_producto, nombre_producto, precio_normal, precio_promocion}]}` | `productos.ts:79-88` (`mapearProducto`). Lo consumen **dos** módulos con su propia `const BASE` (`cerberus/productos.ts:55` y `plantillas/catalogo.ts:16`); el mismo falso sirve a los dos porque los dos leen `CERBERUS_BASE_URL` |
| `GET /ventas/crearVenta/` | HTML con `<select name="moneda">` / `<select name="pais">` y `<option value="1">Soles</option>` + su `csrfmiddlewaretoken` | `venta.ts:83-84`: el `value` **tiene que ser dígitos** (`/<option value="(\d+)"[^>]*>([^<]+)</g`) y el select se aísla con `<select[^>]*name="moneda"[\s\S]*?</select>`. `crearVenta` **vuelve a pedir esta URL** (línea 163) solo para refrescar el CSRF |
| `POST /ventas/crearVenta/` | valida cookie + csrf → `{success:true, folio_venta:'PRUEBA-0001'}` **y escribe una línea en `server/.banco/ventas.jsonl`** | `venta.ts:137-139` acepta `folio` o `folio_venta`. El JSONL es el entregable: es lo que Hermes le habría mandado al ERP, legible por una persona |

Tres comportamientos feos **a propósito**, porque son los que rompen en vivo y hoy nadie ensaya:
- un **emoji** en cualquier campo del POST → **500** (regla dura #4: el latin1 de Cerberus). Hermes tiene que decir «Cerberus rechazó la venta», no «ok».
- `?lento=1` → duerme 20 s: ejercita el techo de 12 s del panel.
- `?sesion=muerta` → 302 a `/ingresar` en el POST: el único caso que borra la fila de `sesiones_cerberus`.

Más `GET /_banco/ventas` para el guion, y **el falso se niega a arrancar** si `existsSync('/srv/hermes')` o si falta `BANCO=si` en el entorno.

```ts
export interface ClienteFalso { id: number; nombre: string; codigo: string; dni: string; pais: string; correo: string;
  telefonos: Array<{ numero: string; prefijo: string }>;
  ventas: Array<{ folio_venta: string; estado_display: string; monto_total: string; moneda: string; fecha_venta: string }> }
export interface DatosDelBanco { usuarios: Record<string,string>; clientes: ClienteFalso[];
  productos: Array<{ codigo_producto: string; sku_producto: string; nombre_producto: string; precio_normal: number; precio_promocion: number }>;
  monedas: Array<{ id: string; nombre: string }>; paises: Array<{ id: string; nombre: string }>; bitacora: string }

export function datosDesdeEnv(env?: NodeJS.ProcessEnv): DatosDelBanco;
/** PURO: la app Express, sin escuchar. Es lo que testea cerberusFalso.test.ts. */
export function crearCerberusFalso(datos: DatosDelBanco): import('express').Express;
export async function arrancarCerberusFalso(puerto?: number): Promise<{ url: string; ventas(): VentaFalsa[]; cerrar(): Promise<void> }>;
```

El fixture (`banco/datos.ts`) lleva: el usuario `prueba`, **el celular del dueño como cliente con dos compras** (sin eso el pie del panel dice «Sin la ficha no se puede registrar una venta» y no hay botón), un cliente **sin** compras, un teléfono que **no** existe (lead nuevo), un **guatemalteco de local de 8 dígitos** (el caso que `variantesLocales` existe para cubrir, #119), y productos con **SKU de familias reales** para que `resolverCurso`/`{precio}` y el chip de curso funcionen de verdad.

**La vuelta del lazo** (`banco/webhook.ts`): al crear la venta, el falso POSTea a `http://127.0.0.1:4112/webhook/cerberus?token=<CERBERUS_WEBHOOK_TOKEN>` con el payload que valida `atribucion/payload.ts`, y **`idempotency_key` = el `venta_request_key` recibido tal cual**. Sin esto, «registrar una venta» solo prueba que el POST salió de Hermes; con esto, la atribución cierra y se ve en `conversiones_wa`.

---

## T13.2 — La semilla (sin esto el banco miente por omisión)

`server/src/banco/sembrar.ts` → `npm run banco:sembrar` (dry-run por default, `--aplicar` escribe, como `hechos:sembrar`).

Una base recién migrada **no tiene**: fila en `numeros_wa` (el ensayo del 28-jul tuvo que meter tres a mano), catálogo de `hechos`, plantillas, ni `bot_estado`. Con eso, el bot ve **el catálogo que la corrección #7 del plan ya midió: 9 piezas, 4 enviables, y las 4 son acuses de fuera-de-horario** — y el dueño concluye «el bot no sirve» cuando el problema es que no hay piezas.

Siembra, idempotente: `numeros_wa` + `numero_vendedora` para `BANCO_NUMERO` · el catálogo de `hechos` (**reusa `hechos/catalogo.ts`**, no lo reimplementa) · `ALIAS_SEMILLA` ya corre sola al arrancar (`index.ts:181`) · **una plantilla-secuencia de dos pasos** (saludo + flyer con `{curso}`/`{precio}`) en `vigente` · `bot_estado` en el modo que se le pase (`--modo sombra|automatico`, default `sombra`).

```ts
export interface ResumenSemilla { numeros: number; hechos: number; plantillas: number; pasos: number; piezas: number; enviables: number }
export async function sembrarBanco(base: typeof db, opts: { numeroPropio: string; vendedoraId: string; modo: 'apagado'|'sombra'|'automatico'; aplicar: boolean }): Promise<ResumenSemilla>;
```

**Sale con error si `enviables === 0`.** Es la cicatriz del ADR 0023 aplicada acá: un catálogo vacío que arranca verde es la falla que Ivi pagó con semanas.

---

## T13.3 — El andamio

- **`docker-compose.banco.yml`** (raíz): `pgvector/pgvector:pg17` (mismo major que prod; el schema necesita la extensión `vector`), contenedor `hermes_banco_db`, usuario y base `hermes_banco`, **`127.0.0.1:5441:5432`** — nunca 5434 (dev) / 5438 (prod) / 5439 (test) / 5440 (staging). **Con volumen, no tmpfs**: la conversación de prueba tiene que sobrevivir a cerrar la laptop. Password de `${BANCO_DB_PASSWORD:?falta BANCO_DB_PASSWORD}`.
- **`server/env.banco.example`** — solo nombres (regla dura #1). ⚠️ **SIN el punto inicial, y verificado**: `git check-ignore` confirma que `server/.env.banco.example` **quedaría ignorado** por `.gitignore:17` (`.env.*`, cuya única excepción es `!.env.example`). Un archivo que nadie puede commitear no sirve de ejemplo. Existe para que nadie caiga en `cp ../hermes/server/.env server/.env`, que es el desastre exacto descrito arriba. Trae ya fijos: `PORT=4112`, `CERBERUS_BASE_URL=http://127.0.0.1:9910`, `WHATSAPP_TRANSPORTE=falso`, `WHATSAPP_NUMERO=` (vacía, con el porqué en comentario), `AUTO_RESPUESTA=off`, `LAZO_RELOJ=`, `META_ACCESS_TOKEN=`, `META_APP_ID=`, `META_PIXEL_ID=`, `ICARUS_DATABASE_URL=`; y en blanco: `DATABASE_URL`, `BANCO_NUMERO`, `WHATSAPP_NUMEROS`, `WHATSAPP_NUMEROS_FALSOS`, `BOT_LINEAS`, `HERMES_SESSION_SECRET`, `HERMES_ADMIN_SERVICE_TOKEN`, `HERMES_CATALOGO_SERVICE_TOKEN`, `CERBERUS_WEBHOOK_TOKEN`, `ANTHROPIC_API_KEY`, `BANCO_USUARIO`, `BANCO_CLAVE`, `BANCO_TELEFONO_DUENO`.
  Documenta además **`WHATSAPP_NUMEROS` y `WHATSAPP_NUMEROS_FALSOS`, que hoy NO están en `server/.env.example`** (verificado): quien monte el banco leyendo el ejemplo no se entera de que la multi-línea existe.
- **`.gitignore`**: agregar `server/.banco/`.
- **`server/package.json`**, cinco scripts:
  ```json
  "banco":          "tsx src/banco/servidor.ts",
  "banco:cerberus": "tsx src/banco/cerberusFalso.ts",
  "banco:sembrar":  "tsx src/banco/sembrar.ts",
  "banco:vincular": "tsx src/banco/vincular.ts",
  "banco:ventas":   "tsx src/banco/imprimirVentas.ts"
  ```
- **`server/src/banco/vincular.ts`** — envoltorio de `wa:vincular` que **corre `exigirAislamiento()` primero**, imprime la ruta absoluta de la sesión y el número **antes** de mostrar el QR, y —lo importante— **compara el JID conectado contra `BANCO_NUMERO` y borra la `.db` si no coinciden**. Sin eso, escanear con el WhatsApp equivocado deja a Hermes leyendo los chats personales de quien escaneó, y nadie se entera.

---

## T13.4 — Los candados (lo que hace que esto no dependa de que alguien se acuerde)

`server/src/banco/aislamiento.test.ts` — vive en `src/banco/` **a propósito**: el glob de `npm test` es `tsx --test src/**/*.test.ts` bajo `sh`, que sin globstar entra **exactamente dos niveles**, así que `src/banco/*.test.ts` **sí lo corre CI** (y `src/bot/evals/*.test.ts` no — corrección #3 del plan). Dos afirmaciones:

- **(a)** recorriendo el grafo de imports estáticos desde `server/src/index.ts`, **ningún archivo bajo `src/banco/` es alcanzable**. Ni por transitividad.
- **(b)** `src/banco/cerberusFalso.ts` existe y está bajo `src/banco/` (si alguien lo mueve, el candado (a) dejaría de cubrir sin fallar).

Límite honesto, escrito en el propio test: **lee imports estáticos**. Un `await import(variable)` con path computado se le escapa. Atrapa el caso realista —alguien agrega un `import` «para un debug rápido»— no a un decidido. Mismo espíritu que `piezas/receta-unica.test.ts`.

---

## Tests

- **`banco/guardia.test.ts`** (puro, node:test) — **un caso por negativa**: base de prod · base de dev · base de staging · base de test · `hermes_banco` en el puerto equivocado · Cerberus remoto · Cerberus ausente · `META_ACCESS_TOKEN` con valor · `ICARUS_DATABASE_URL` presente · `AUTO_RESPUESTA=on` · secreto de dev · `WHATSAPP_NUMERO` sobreviviente · dos números en `WHATSAPP_NUMEROS` · un número de `LINEAS_DE_PRODUCCION` · **un `.db` intruso en `.wa-sessions/`, y el mensaje lo NOMBRA** · `PORT=4110` · cwd de producción. Más el caso feliz. Y el caso que importa de verdad: **`motivosDeNoAislamiento` con el `.env` real de producción copiado tal cual devuelve ≥4 violaciones.**
- **`banco/cerberusFalso.test.ts`** — **es el criterio de aceptación del ticket**, no un extra. Levanta el falso en un puerto efímero y corre **contra él las funciones REALES, sin mocks**: `autenticarEnCerberus`, `ficha`, `buscarProductos`, `cargarFormulario` y `crearVenta`.
  ⚠️ **Trampa obligatoria de escribir en el test**: `const BASE = (process.env.CERBERUS_BASE_URL ?? …)` **se congela al importar el módulo** en los siete archivos. Setear la variable después del `import` no tiene efecto. Hay que arrancar el falso, setear `process.env.CERBERUS_BASE_URL`, y **recién ahí** `const { ficha } = await import('../cerberus/ficha.js')`. Como `node:test` corre cada archivo en su propio proceso, alcanza con que sea la primera importación de ese módulo en ese archivo.
- **`banco/aislamiento.test.ts`** — el candado del grafo de imports.
- **`banco/sembrar.test.db.ts`** — con `baseDePrueba(t)`: sembrar dos veces no duplica; con catálogo vacío el resumen dice `enviables: 0` y el script sale 1.

**Verificar**: `cd server && npm test && npx tsc --noEmit` verdes · el guion de abajo corrido entero, etapa A · **screenshots de la etapa B** (regla dura #2) en `docs/evidencia/banco-*.png`.

---

## Prohibido

1. **Prohibido copiar `server/.env` del checkout principal al banco.** Hoy trae la línea de ventas y el Cerberus real. Se parte de `env.banco.example` y se completa a mano.
2. **Prohibido montar el banco sobre `/srv/hermes-staging`.** Derogaría el ADR 0022 §«WhatsApp es el transporte falso, sin excepción», y además el job `n3-staging` le hace `git checkout --quiet --force` en **cada push a `main`**: el fin de semana se pisaría solo, a mitad de una prueba.
3. **Prohibido crear un usuario de prueba en el Cerberus REAL.** Es una credencial permanente con permiso de venta, imposible de revocar por código, y ensucia `tb_venta` para siempre. El usuario de prueba vive **dentro del Django de mentira, en memoria**.
4. **Prohibido agregar una bandera de «modo prueba» al código de producción** (`CERBERUS_TRANSPORTE=falso`, `HERMES_VENDEDORA_DE_PRUEBA`, cualquier `if (esBanco)`). Una bandera vive en `server/.env`, que es gitignored, no aparece en ningún diff y ningún job de CI verifica. Si se filtrara: las tres vendedoras seguirían trabajando —login OK, cola OK, fichas OK— y **ninguna venta llegaría al ERP, en silencio**, hasta que alguien concilie. La lección ya está escrita en `auth/perimetro.ts:9`: «la auth por-router se olvida; el perímetro no».
5. **Prohibido tocar una sola línea de `server/src/` fuera de `src/banco/`.** El banco se conecta por variables que **ya existen** (`CERBERUS_BASE_URL`, `DATABASE_URL`, `WHATSAPP_TRANSPORTE`, `WHATSAPP_NUMEROS`). Cero `if` nuevos en el camino de auth, del perímetro, de `EnvioControlado` o del schema. *(El seam inyectable estilo `DepsIvi` sobre los cinco módulos de `cerberus/` es el arreglo correcto y va al ADR como **deuda** — 5-6 h tocando login y venta, días antes de un rollout, no.)*
6. **Prohibido correr `npm run wa:vincular` desde el checkout principal** para el número de prueba: la sesión cae en el directorio equivocado. Se usa `npm run banco:vincular`, que valida antes.
7. **Prohibido vincular el celular personal del dueño.** Él es el **lead**: escribe desde afuera. Vincularlo haría de Hermes un dispositivo enlazado a su WhatsApp personal, leyéndole todos los chats.
8. **Prohibido `db:push` en la base del banco**: persiste, así que va por migraciones versionadas (ADR 0021). `db:push` sigue siendo correcto solo para las bases efímeras de test.
9. **Prohibido cargar `META_*` «para probar el CAPI».** La ausencia es la guardia. El CAPI tiene su propio mecanismo probado (`META_TEST_EVENT_CODE`, `lazo/capi.ts:30-37`) y es un ensayo aparte.
10. **Prohibido exponer el banco a internet** o montarlo en VPS1. `/vincular` queda fuera del perímetro y **sin auth** (comentario propio de `index.ts:138-141`); en la laptop es inocuo porque no hay nginx ni DNS delante.
11. **Prohibido que el guion dependa de `npm run dev` del checkout principal.** Ese comando levanta la línea de ventas (ver §🔴 arriba).

---

## El guion del dueño

Shell **fish**. Rutas absolutas. Puertos del banco: **API 4112 · Postgres 5441 · Cerberus falso 9910**.

### PASO 0 — apagar la línea de producción que corre en esta laptop (una sola vez)

```fish
ps aux | grep -E 'whatsmeow|tsx watch' | grep -v grep
# Ctrl-C en la terminal donde corre `npm run dev`; si no la encontrás:
pkill -f 'tsx watch src/index.ts'; pkill -f 'whatsmeow-node'
ps aux | grep whatsmeow | grep -v grep      # tiene que NO imprimir nada
```

### PASO 1 — el banco vive en su propio checkout (regla dura #3: worktree, no copia)

```fish
cd /Users/milaa/goberna/hermes
git worktree add /Users/milaa/goberna/banco-hermes -b banco/pruebas
cd /Users/milaa/goberna/banco-hermes && npm install
cd /Users/milaa/goberna/banco-hermes/server && npm install   # baja el binario Go de mac, 21 MB, 2-4 min

# LA VERIFICACIÓN QUE IMPORTA: el worktree no tiene ninguna sesión de WhatsApp.
ls -la /Users/milaa/goberna/banco-hermes/server/.wa-sessions/ 2>&1
# "No such file or directory" o vacío = correcto.
```

### PASO 2 — la base del banco

```fish
cd /Users/milaa/goberna/banco-hermes
env BANCO_DB_PASSWORD=(openssl rand -hex 16) docker compose -f docker-compose.banco.yml up -d --wait
docker ps --filter name=hermes_banco_db --format '{{.Names}} {{.Ports}}'
```

*(Guardá esa password en `/Users/milaa/goberna/banco-hermes/.env` como `BANCO_DB_PASSWORD=` — compose la lee de ahí.)*

### PASO 3 — el `.env` del banco, a mano

```fish
cd /Users/milaa/goberna/banco-hermes/server
cp env.banco.example .env
openssl rand -hex 32     # correlo 4 veces: SESSION_SECRET, ADMIN, CATALOGO, WEBHOOK
$EDITOR .env
#   DATABASE_URL=postgresql://hermes_banco:<pass>@127.0.0.1:5441/hermes_banco
#   BANCO_NUMERO=51900000001          ← el número de prueba (etapa A: inventado)
#   WHATSAPP_NUMEROS_FALSOS=51900000001
#   BOT_LINEAS=51900000001
#   BANCO_USUARIO=prueba   BANCO_CLAVE=<una de mentira>
#   BANCO_TELEFONO_DUENO=51<tu celular, E.164 sin +>
#   ANTHROPIC_API_KEY=<la misma que va a usar producción>
```

### PASO 4 — la guardia (si esto no pasa, no sigas)

```fish
cd /Users/milaa/goberna/banco-hermes/server
npx tsx --test src/banco/guardia.test.ts src/banco/aislamiento.test.ts
npm run banco:sembrar        # dry-run primero
```

### PASO 5 — schema y semilla

```fish
cd /Users/milaa/goberna/banco-hermes/server
npm run db:migrate
npm run banco:sembrar -- --aplicar --modo sombra
#   → N hechos · N plantillas · N pasos · N piezas · N ENVIABLES
#   Si enviables = 0 sale con error, a propósito.
```

### PASO 6 — arrancar (tres terminales, siempre las mismas)

```fish
# TERMINAL 1 — el Cerberus de mentira
cd /Users/milaa/goberna/banco-hermes/server && env BANCO=si npm run banco:cerberus
#   → cerberus falso en http://127.0.0.1:9910
#     usuario de prueba: prueba · cliente sembrado: <tu celular>
#     las ventas se anotan en server/.banco/ventas.jsonl

# TERMINAL 2 — el front, servido por el MISMO server (el camino OTA de producción)
cd /Users/milaa/goberna/banco-hermes && env VITE_API_URL=http://127.0.0.1:4112 npx vite build

# TERMINAL 3 — Hermes del banco, con su guardia
cd /Users/milaa/goberna/banco-hermes/server && npm run banco
```

El paso 3 tiene que imprimir, **antes** de escuchar:

```
════════ BANCO DE PRUEBAS ════════
  base      127.0.0.1:5441/hermes_banco
  cerberus  http://127.0.0.1:9910   (de mentira, en loopback)
  transporte falso · líneas 51900000001
  bot       sombra
  meta      sin credenciales (no puede mandar un Purchase)
  ventas    server/.banco/ventas.jsonl
  API       http://127.0.0.1:4112
══════════════════════════════════
```

Si en vez de eso aborta, el mensaje dice **cuál** de las once negativas saltó. **Un banco que no arranca es la guardia funcionando.**

### PASO 7 — entrar

```fish
open http://127.0.0.1:4112
```

Usuario `prueba` y la clave del `.env`. ⚠️ Se entra por **la pantalla de login de verdad**: mismo handshake CSRF, misma fila en `sesiones_cerberus`, mismo token HMAC. Solo el Django del otro lado es de mentira — y por eso el botón de venta después funciona. (Un token firmado a mano **no** sirve: `crearVenta` exige la cookie que solo deja un login, `venta.ts:155`.)

### PASO 8 — ETAPA A: el flujo completo sin teléfono

```fish
curl -X POST http://127.0.0.1:4112/api/whatsapp/_dev/simular \
  -H 'content-type: application/json' \
  -d '{"telefono":"51999888777","texto":"Hola, vi el anuncio del diploma en inteligencia, ¿me pasan información?","nombre":"Lead de prueba","numeroPropio":"51900000001"}'
```

La conversación aparece en **Mensajes** y en la cola. El bot tiene 25 s de debounce y después piensa. Segundo turno, para ver la calificación moverse:

```fish
curl -X POST http://127.0.0.1:4112/api/whatsapp/_dev/simular \
  -H 'content-type: application/json' \
  -d '{"telefono":"51999888777","texto":"sí, quiero inscribirme, ¿cómo pago?","numeroPropio":"51900000001"}'
```

Qué pensó, sin depender de que la UI del chip ya exista:

```fish
docker exec hermes_banco_db psql -U hermes_banco -d hermes_banco -c \
  "select creado_en, estado, motivo, left(texto,80) as texto, acciones, tokens_entrada, tokens_salida from bot_respuestas order by creado_en desc limit 10;"

docker exec hermes_banco_db psql -U hermes_banco -d hermes_banco -c \
  "select clave, temperatura, escalada, motivo from bot_calificaciones order by actualizado_en desc limit 10;"
```

Que **todo** lo que salió pasó por `EnvioControlado` y quedó marcado:

```fish
docker exec hermes_banco_db psql -U hermes_banco -d hermes_banco -c \
  "select creado_en, automatico, pieza_via, pieza_clase, pieza_ref, left(texto,50) from envios_wa order by creado_en desc limit 10;"
# automatico = t y pieza_via = 'bot' en todo lo que mandó el bot.
```

**La venta.** Escribir desde el número del dueño, que es el que el Cerberus falso conoce como cliente:

```fish
curl -X POST http://127.0.0.1:4112/api/whatsapp/_dev/simular \
  -H 'content-type: application/json' \
  -d '{"telefono":"51<TU CELULAR>","texto":"quiero pagar el diploma","numeroPropio":"51900000001"}'
```

Abrir esa conversación → el panel derecho se pinta **verde «Cliente»** con dos compras → al pie **«Registrar venta»** → monedas, países y curso del catálogo falso → confirmar.

```fish
curl -s http://127.0.0.1:9910/_banco/ventas | jq          # folio PRUEBA-0001 + el venta_request_key
cd /Users/milaa/goberna/banco-hermes/server && npm run banco:ventas

docker exec hermes_banco_db psql -U hermes_banco -d hermes_banco -c \
  "select * from conversiones_wa order by 1 desc limit 3;"

# ⚠ ESPERADO, NO ES UN ERROR TUYO:
docker exec hermes_banco_db psql -U hermes_banco -d hermes_banco -c \
  "select estado, error from webhooks_recibidos order by 1 desc limit 3;"
# → estado 'error' con «Falta META_PIXEL_ID en el entorno». Es a propósito: el banco
#   no le manda eventos a Meta. La venta YA quedó en conversiones_wa porque
#   proyectarVenta corre ANTES del CAPI (webhook/ruta.ts:150 vs :177).
```

Y el humo de siempre, contra el banco:

```fish
cd /Users/milaa/goberna/banco-hermes/server && env BASE_URL=http://127.0.0.1:4112 npm run humo -- --sesion
```

### PASO 9 — volumen y topes (sigue sin teléfono)

```fish
for i in (seq 1 30)
  curl -s -X POST http://127.0.0.1:4112/api/whatsapp/_dev/simular \
    -H 'content-type: application/json' \
    -d "{\"telefono\":\"5199900$i\",\"texto\":\"hola, info del diploma\",\"numeroPropio\":\"51900000001\"}" > /dev/null
end
docker exec hermes_banco_db psql -U hermes_banco -d hermes_banco -c \
  "select estado, motivo, count(*) from bot_respuestas group by 1,2 order by 3 desc;"
```

### PASO 10 — ETAPA B: la línea real por QR

**Prerrequisito que el código no resuelve: un SEGUNDO número de WhatsApp** (SIM aparte o WhatsApp Business en otro teléfono). Si mañana no hay SIM, la etapa A se entrega igual — pero eso hay que resolverlo **en paralelo**, no descubrirlo el domingo a las 6 de la tarde.

```fish
cd /Users/milaa/goberna/banco-hermes/server
$EDITOR .env
#   BANCO_NUMERO=<el número de prueba REAL>
#   WHATSAPP_NUMEROS=<el mismo>
#   BOT_LINEAS=<el mismo>
#   WHATSAPP_TRANSPORTE=whatsmeow      ← una de las dos líneas que cambian
#   WHATSAPP_NUMERO=                    ← vacía, siempre

npm run banco:vincular -- <numero>
#   Valida el aislamiento, imprime la ruta ABSOLUTA de la sesión, y después el QR:
#   «📷 QR listo: /var/folders/…/hermes-wa-qr.png»
open $TMPDIR/hermes-wa-qr.png
#   En el TELÉFONO DE PRUEBA (nunca el personal):
#   WhatsApp → Ajustes → Dispositivos vinculados → Vincular un dispositivo → escanear
#   Ctrl-C cuando diga «✅ Conectado como <jid>».
#   Si el JID no coincide con BANCO_NUMERO, el envoltorio BORRA la sesión y aborta.

ls -la .wa-sessions/     # UN solo .db, y es el del número de prueba
npm run banco            # → «transporte whatsmeow · líneas <numero>»
```

Ahora el dueño **le escribe desde su celular**, uno por vez y esperando:

1. «Hola, quería información del diploma» — arranca.
2. «¿cuánto cuesta?» — **el texto no puede traer una cifra**; el precio llega como pieza.
3. «¿se puede pagar en cuotas?» — sale del hecho, no inventado.
4. «¿tienen sede en Quito?» — **no puede inventar**: escala.
5. «¿sos un bot?» — ni lo afirma ni lo niega: escala.
6. «quiero hablar con una persona» — escala.
7. «quiero inscribirme ya» — caliente + escalada `por_cerrar`.

Lo que se mira acá **no son las tablas**: es el ritmo, el tono y el largo de las burbujas en la pantalla del celular. Eso es lo único que esta etapa compra.

### PASO 11 — la prueba de que nada tocó producción (es el entregable, no un extra)

```fish
cd /Users/milaa/goberna/banco-hermes/server

# (a) El banco no conoce la URL de Cerberus.
grep -rn "app.goberna.us" src/banco/ ; echo "---- vacío arriba = correcto ----"
grep -n "CERBERUS_BASE_URL" .env      # tiene que decir 127.0.0.1:9910

# (b) EL CANDADO: producción no puede alcanzar el banco, ni por transitividad.
npx tsx --test src/banco/aislamiento.test.ts

# (c) ¿A quién le habla el proceso del banco? Nada hacia app.goberna.us.
lsof -nP -p (pgrep -f 'src/banco/servidor.ts') -i | grep ESTABLISHED

# (d) Las ventas del banco están en el 5441 y en un JSONL, no en el ERP.
npm run banco:ventas
```

Y en `https://app.goberna.us`, a mano: **no existe el usuario `prueba`** y no hay venta ni cotización nueva. No la hay porque **no hubo POST** — el falso devolvió el folio en memoria.

### Apagar / empezar de cero / traer código nuevo

```fish
# Ctrl-C en las tres terminales.
cd /Users/milaa/goberna/banco-hermes && docker compose -f docker-compose.banco.yml down
# La base persiste: mañana `up -d --wait` + `npm run banco` vuelven a la misma conversación.

# De cero (⚠ necesario si se reusa la base con transporte FALSO: los ids del falso se
# repiten entre reinicios y los entrantes nuevos chocan con la idempotencia `wa:falso-N`
# y se DESCARTAN sin decir nada):
docker compose -f docker-compose.banco.yml down -v
# …y repetir pasos 2, 5.

# Código nuevo cuando entra un PR del bot:
cd /Users/milaa/goberna/banco-hermes
git fetch origin && git checkout --detach origin/<rama> && npm install
cd server && npm install && npm run db:migrate
```

---

## Cada mecanismo nuevo, y por qué no puede afectar producción

| Mecanismo | Por qué no puede llegar a producción |
|---|---|
| **`banco/cerberusFalso.ts`** | Se despliega como **código muerto**: nada lo importa, `index.ts` no lo monta (es un **proceso**, no un router — no hay línea de montaje que olvidarse de borrar), y `banco/aislamiento.test.ts` falla en **N1** si alguien lo importa. Aun corriéndolo a mano en VPS1: bindea 127.0.0.1, exige `BANCO=si` y **se niega si existe `/srv/hermes`**. |
| **`CERBERUS_BASE_URL` a loopback** | **No es una bandera nueva**: la variable ya existe y ya se lee en los siete archivos. Si se filtrara al `.env` de prod, el efecto es **nadie puede loguearse y ninguna venta llega al ERP**: caída total, inmediata, ruidosa, cero datos comprometidos. Falla hacia «nadie entra», nunca hacia «cualquiera entra». |
| **`banco/guardia.ts` + lanzador** | `src/index.ts` no lo importa (candado (a)). Corrido en VPS1 **se niega a arrancar** (el `DATABASE_URL` de prod está en la lista negra). No setea una sola variable: solo lee. Mismo perfil de riesgo que el throw de `auth/servicio.ts:17`. |
| **Base `:5441/hermes_banco`** | Exigencia **positiva**, no solo lista negra: si alguien copia el `.env` de prod al banco, el banco no arranca y dice qué marca lo delató, sin imprimir la URL. Al revés no aplica: producción no importa nada del banco, y VPS1 no tiene Postgres en 5441. |
| **La sesión de WhatsApp** | El aislamiento es por **ausencia**, no por variable: `.wa-sessions/` sale de `import.meta.url` y no es configurable. El worktree nace vacío; la credencial de la línea de ventas **físicamente no está ahí**. |
| **`WHATSAPP_NUMEROS` del banco** | Si se filtrara a prod: se levantaría una línea cuyo `.db` no existe en VPS1 → queda `sin-vincular`, se ve caída en el semáforo y no manda nada (`wiring.ts` captura el fallo por línea). Inocuo y visible. |
| **`BOT_LINEAS` del banco** | En prod queda vacío hasta el rollout, y con `BOT_LINEAS` vacío el despachador ni arranca su `setInterval` (T5). Un número del banco filtrado ahí haría pensar al bot sobre una línea que no corre: `gestor.de()` devuelve null y la guarda #0 de `EnvioControlado` rechaza sin auditar. |
| **Meta / CAPI** | Apagado **por ausencia**: `capiDesdeEnv()` (`lazo/capi.ts:95-96`) tira sin pixel o token, y la guardia **exige que estén vacías**. No alcanza con no usarlas: no puede tenerlas. |
| **icarus** | `ICARUS_DATABASE_URL` e `ICARUS_CERBERUS_WEBHOOK_URL` ausentes o el banco no arranca. El banco no corre los scripts de icarus y no tiene con qué. |
| **`server/.banco/ventas.jsonl`** | Si se filtrara, nada lo lee: solo lo importa el falso. Y como **no es una tabla**, no hay migración que viaje ni schema que compartir — el JSONL es en sí una forma de aislamiento. |
| **Secretos del banco** | `HERMES_SESSION_SECRET` propio: un token del banco no vale en producción y viceversa (el argumento del ADR 0022 para que el smoke firme tokens). |
| **Superficie HTTP** | El banco agrega **cero endpoints**. No toca `auth/perimetro.ts`, no agrega excepciones, no monta routers. `_dev/simular` **ya existe** con su doble candado (`index.ts:146-149`): el banco la usa, no la ensancha. |

### 🔴 Los tres que hoy dependen de que alguien no se equivoque

| Riesgo | Mitigación estructural que este ticket incluye |
|---|---|
| 🔴 **`LINEAS_DE_PRODUCCION` es un literal a mano.** Solo tengo verificado `51986394450`; la memoria dice que son tres líneas (Luz, Walter, Sindy) y los otros dos números no están en el repo. Una cuarta línea que nadie agregue ahí queda descubierta. | La defensa que **sí** es estructural no es la lista: es que el worktree nace con `.wa-sessions/` vacío **y** la guardia exige que el único `.db` presente sea `<BANCO_NUMERO>.db`. Una línea de producción solo puede levantarse si alguien copió su credencial **y** la declaró. La lista es cinturón sobre tirantes. *El arreglo de fondo —un `proposito: 'prueba'` en `numeros_wa`, que hoy solo acepta `escuela\|campana\|vendedora` (`numeros/dominio.ts:15`)— es un frente aparte: anotarlo como issue.* |
| 🔴 **Correr `wa:vincular` desde el checkout equivocado** deja la sesión en `hermes/server/.wa-sessions/` y la guardia del banco no se entera (mira la suya). | `npm run banco:vincular`: corre `exigirAislamiento()` **antes**, imprime la ruta absoluta de destino y el número antes del QR, y el guion lleva el `ls -la .wa-sessions/` de verificación. La dirección que hace daño —una sesión de producción **dentro** del banco— sí la atrapa la guardia. |
| 🔴 **Escanear el QR con el WhatsApp equivocado** (el personal del dueño) convierte a Hermes en un dispositivo enlazado a sus chats. Ningún `if` previo puede impedirlo. | `banco/vincular.ts` **compara el JID conectado contra `BANCO_NUMERO` y borra la `.db` si no coinciden**, en el acto. `vincular.ts:74` ya imprime `✅ Conectado como ${jid}`: el dato está disponible, solo hay que actuar sobre él en vez de imprimirlo. |

---

## Dónde se engancha con T0–T12

**Lo bloquea a él**: **T0** — la base del banco corre `db:migrate`, así que las seis tablas del bot tienen que estar en migración versionada antes de que el banco muestre nada del bot. *(T13.0, T13.1 y T13.2 se pueden construir en paralelo a T0: no dependen del schema del bot, solo la semilla del `bot_estado`.)*

**Él bloquea**: **T11.3 (rollout del lunes)**. Y **T11.2**: el tablero de `bot:evaluar` se corre **contra el banco**, no contra producción.

**Se benefician**:
- **T5** — «sombra funcionando end-to-end en local con transporte falso» (cierre del viernes) **es literalmente el paso 8 de este guion**. Sin el banco, ese cierre no tiene dónde ocurrir.
- **T6 / T9** — los screenshots de la regla dura #2 (chip del bot, cola con 🔥, vista sombra) salen del banco con datos sembrados, **no de producción con teléfonos de leads reales**. Hoy la alternativa era un proxy que frena los POST (`docs/evidencia/README-58…`).
- **T8** — `bot:simulacro --demo` y los evals corren sin base; el banco les da el corpus con forma real y la línea viva para la validación cualitativa.
- **T10** — `routes/bot.test.db.ts` no lo necesita, pero probar el chip contra rutas vivas sí.
- **T12** — el runbook de emergencia se **ensaya** acá (apagar por chip, por `curl`, por `BOT_LINEAS=` + restart) antes de necesitarlo un lunes.

### Dos exigencias que el banco impone sobre otros tickets, porque son bugs que él **no puede ver**

1. **🔴 Sobre T5 — el despachador del bot NO puede copiar el patrón de `autorespuesta/reloj.ts:42-43`.** Verificado en el código: ahí dice `envio: whatsapp().envio`, y `whatsapp()` es `gestorWhatsapp().primero()` (`wiring.ts:145`). Con dos líneas, un envío para la segunda muere en la guarda #0 (`envioControlado.ts:142`, «envío enrutado a la línea equivocada»), el despachador lo lee como «falló un envío» y ejecuta `frenar()` → `fijarModo('apagada')`: **un mensaje de una línea apaga el mecanismo entero de las tres**. `enviarYProyectar.ts:83` ya lo arregló para la vendedora (`puertaDe(o.numeroPropio, gestorWhatsapp())`); el reloj de la auto-respuesta no. **El banco tiene UNA línea, así que este defecto es estructuralmente invisible ahí.** Exigencia: T5 rutea con `puertaDe`, un `bot/despachador.test.db.ts` con **dos** transportes falsos lo prueba, y un test de grep afirma que `server/src/bot/` no importa `whatsapp()`.
2. **Sobre T7 — reloj inyectable a nivel proceso.** El banco vive en una laptop que se cierra: nada que dependa del paso de los días (follow-up a ≥3 días, ventana horaria, caducidad) se observa naturalmente. `elegirCandidatos(db, ahora, limite)` ya recibe `ahora`; `correrFollowups({ ahora })` también. **Que `bot:followup:simulacro` acepte `--hora` y `--dias`**, como `auto:simulacro` acepta `--hora`.

---

## Riesgos que quedan vivos

1. **El falso valida el FLUJO, no el CONTRATO.** Las validaciones de Django —stock, cuotas, `permission_required`, el formato real del folio— las inventamos leyendo el cliente. Si `crearVenta` le manda a Cerberus algo que el ERP rechaza, el banco dice «venta registrada» igual. **La primera venta real sigue siendo una primera vez.** Lo único que sigue cubriendo el contrato del login es el smoke de N3 contra el Cerberus **real** (ADR 0022, que no se deroga).
2. **El residuo de `clasificarRespuestaVenta` (venta.ts:147-150): un 200 con HTML cuenta como registrada.** El falso siempre responde JSON limpio, así que ese camino **nunca** se ejercita. Es el único lugar donde el banco puede dar verde sobre algo que en producción sale mal en silencio.
3. **`cargarFormulario` (venta.ts:95) tiene su `fetch` fuera de todo try/catch**, a diferencia de los dos de `crearVenta`. En el banco eso es informativo (matar el Terminal 1 con sesión viva y abrir el modal se ve ruidosamente); en producción es un bug real que este ticket **no** arregla. Anotarlo como issue aparte.
4. **El catálogo del banco lo elige quien escribe el fixture, así que puede halagar al bot.** Producción hoy tiene 9 piezas y 4 enviables, todas acuses de fuera-de-horario. Mitigación real, y es un paso aparte antes del rollout: **exportar el catálogo vivo de producción (solo lectura) e importarlo al banco.**
5. **Sin historia**: no hay `clientes_padron`, ni 1.876 conversaciones, ni `envios_wa` con procedencia acumulada. El radar, «Se enfrió», el lazo de resultados y el follow-up se ven sobre datos de juguete. «El bot contestó bien en el banco» dice menos de lo que parece.
6. **Una cuenta de WhatsApp nueva no se comporta como una línea con años de historia** frente a whatsmeow. Un ban en el banco no predice nada, y no-ban en el banco no vacuna nada. El riesgo del rollout se acota arrancando por **una** línea real, no probando acá.
7. **El banco corre sin `NODE_ENV=production`** (o pierde `_dev/simular`). Los tres guardas fail-closed (`auth/sesion.ts:20`, `auth/servicio.ts:17`, `perimetro.ts:41` + `index.ts:146`) se comportan al revés ahí, a propósito. **Un bug que solo aparece bajo `NODE_ENV=production` no se ve en el banco** — lo sigue atrapando N3.
8. **El banco corre en una rama.** Antes del rollout hay que rebasear el worktree sobre el commit que efectivamente va a producción y repetir los pasos 8-10. Si no, se validó otra cosa.
9. **`ANTHROPIC_API_KEY` es de verdad y gasta plata de verdad.** No hay nada falso ahí y no debería haberlo — pero conviene un `BOT_MAX_TURNOS_DIA` bajo en el `.env` del banco para que una conversación de prueba que se va de mano no sea una sorpresa en la factura.
10. **Es un cuarto entorno, sin CI que lo verifique.** Si el schema cambia y nadie corre `db:migrate` en el worktree, el banco miente en la próxima corrida. Mitigación barata: que `npm run banco` corra `db:estado --exigir-coherencia` como **duodécima negativa**, igual que hace el job `n3-staging`.
11. **Nada de esto se verificó contra VPS1** (el reconocimiento fue read-only). En particular, que `NODE_ENV=production` esté de verdad en la unidad systemd de `hermes` —de la que cuelgan tres guardas— hay que confirmarlo con `systemctl show hermes -p Environment` antes de apoyarse en ella.

---

## T13.5 — Documentación (mismo PR)

- **`docs/adr/0029-el-banco-de-pruebas.md`** — Contexto · Decisión · **Lo que NO deroga**: el ADR 0022 queda intacto, staging no cambia (WhatsApp falso, Cerberus real, sin `.wa-sessions/`); el banco es un **cuarto** entorno con otro propósito · **Alternativas descartadas**, cada una con su radio de daño escrito: (a) un usuario real en el Cerberus real; (b) la bandera `CERBERUS_TRANSPORTE=falso` / `HERMES_VENDEDORA_DE_PRUEBA`; (c) montar el banco sobre staging · **Deuda que deja**: los siete `const BASE` congelados al importar siguen ahí y el default sigue siendo producción — el arreglo correcto es la costura inyectable (`ClienteCerberus` por composition root, o `DepsCerberus { fetch?, baseUrl? }` estilo `DepsIvi`), y es trabajo de **después** del lunes, no de días antes de un rollout · Y archiva el stack de ensayo de `docs/checklist-3ago/checklist-3ago.md` §2, diciendo por qué no alcanzaba: su propia §3 admite *«Modal de venta | No se llegó: sin Cerberus no hay ficha ⇒ no hay botón»*.
- **`docs/banco-de-pruebas.md`** — el guion de arriba tal cual, el mapa de puertos, las dos tablas de «qué prueba / qué NO prueba», y el reset. Se enlaza desde `CLAUDE.md` §Correr en local y desde T11.
- **`CLAUDE.md`** — §Correr en local: una línea apuntando al banco. Y corregir de paso lo que ya está viejo y va a hacer perder media hora: **`wa:vincular` no da «un código de 8 dígitos», vincula por QR** (`vincular.ts:49-56` y :100, con el porqué escrito: «el pairCode por número devolvía 400 en este número»). Que sea QR es, casualmente, exactamente lo que el dueño pidió.