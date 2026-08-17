# Auditoría — ¿el chat de una vendedora lo ve sólo ella y su supervisor?

> **Qué es este documento.** La respuesta, medida contra el código desplegado, a una pregunta del
> dueño (17-ago-2026): *«los chats de ellas, todos —los de Meta, los de whatsmeow, todos—, sus chats
> de ella solo los verá ella y su supervisor, nadie más»*.
>
> **La respuesta es NO.** Hoy no se cumple, y no le falta poco.
>
> Se auditaron seis superficies del server en paralelo; cada hallazgo pasó por un escéptico
> independiente que intentó **refutarlo** leyendo el código. Lo que sigue es lo que sobrevivió a eso:
> **82 fugas confirmadas** (18 críticas · 45 serias · 19 menores) y **24 descartadas** por falsas.
>
> Corte: `origin/main` = **`1cb683a`**, que es exactamente lo que corre en producción (verificado:
> `/srv/hermes` en el mismo SHA, servicio reiniciado 17-ago 16:46:24). Toda ruta lleva `archivo:línea`
> y el request que la reproduce.

---

## 0 · Lo que hay que leer aunque no se lea nada más

### 0.1 · El invariante, escrito como se verifica

```
Para toda conversación C con dueña V:
  ve el contenido de C  ⟺  quien pide es V, o quien pide tiene rol supervisor/admin
```

**Hoy sólo UNA ruta lo cumple**: `GET /api/conversaciones`, la cola, que ganó la frontera por rol el
17-ago-2026. **Todo lo demás sirve cualquier conversación a cualquier token de vendedora.**

Y ahí está el resumen del problema: se construyó **una frontera para la LISTA** y ninguna para **el
contenido**. La cola dejó de mostrar las conversaciones ajenas y el hilo las sigue entregando enteras.

### 0.2 · 🔴 «Su supervisor» no existe, y eso es la mitad del pedido

El modelo de roles (`equipo`, migración 0028, viva desde hoy) tiene `admin` / `supervisor` /
`vendedora`. Un supervisor ve **todo, de todas**. **No hay ningún mapeo de quién supervisa a quién.**

O sea que la segunda mitad del requisito —«y **su** supervisor»— **no es expresable** con el modelo
actual. Hoy sólo se puede decir «ella + TODOS los supervisores». Si «su supervisor» tiene que ser una
persona concreta, eso es una columna nueva en `equipo` y un frente propio; conviene decidirlo antes
de escribir los arreglos, porque cambia la firma del predicado que hay que meter en ~40 lugares.

### 0.3 · 🟡 Lo que está vivo AHORA y conviene mirar hoy

**`GET /vincular/estado` es una ruta ANÓNIMA que expone el QR de vinculación en vuelo.**
Sin `Authorization`, sin cookie. Devuelve el número que se está vinculando, el **data-URI del QR** y,
al conectar, el JID de la cuenta. Lee el **mismo singleton `vinculador`** que usa la pantalla nueva de
auto-vinculación, así que un pareo iniciado desde Hermes se lee entero desde esta puerta vieja.

Quien lea el QR antes que la vendedora **se queda con su sesión de WhatsApp**.

**Pero está contenido, y hay que entender cómo, porque es frágil:**

| Desde dónde | Resultado, medido el 17-ago 17:0X |
|---|---|
| Internet (`https://hermes-api.goberna.us/vincular/estado`) | **403** — lo bloquea **nginx** |
| Adentro de VPS1 (`http://127.0.0.1:4110/vincular/estado`) | **200** + `{"estado":"inactivo"}`; la consola HTML sirve 3.837 bytes |

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://hermes-api.goberna.us/vincular/estado   # 403
curl -s -o /dev/null -w "%{http_code}\n" https://hermes-api.goberna.us/api/conversaciones # 401 ← el control: el request SÍ llega a Express
ssh deploy@161.132.39.165 'curl -s -w "\n%{http_code}\n" http://127.0.0.1:4110/vincular/estado'  # 200
```

🔴 **La regla de nginx NO está versionada en el repo.** No está en `deploy/`, no está en
`docs/deploy-vps1.md`. O sea que **la única protección de esta puerta es invisible para cualquiera que
lea el código**, y se reabre sola con un bloque de nginx nuevo, un redeploy del proxy o una mudanza de
host. Y «adentro de VPS1» no es una frontera fuerte: esa máquina corre decenas de contenedores de
otros proyectos, y cualquiera de ellos alcanza `127.0.0.1:4110`.

El código lo reconoce por escrito (`index.ts:177-179`): *«⚠ /vincular queda FUERA del perímetro /api y
sigue abierto: la consola del operador no tiene auth propia todavía»*.

**Qué hacer, en orden de esfuerzo**: (a) borrar `vincularRouter` — la auto-vinculación de ADR/paso 4
lo reemplaza y `wa:vincular` cubre el resto; (b) si se quiere conservar, montarlo detrás de
`requiereServicio`; (c) mientras tanto, **versionar la regla de nginx en `deploy/vps1/`** para que
deje de ser invisible.

⚠️ Y `POST /vincular/iniciar` es peor que una lectura: **actúa sin credencial**. Valida sólo
`numero.length >= 8` y abre `.wa-sessions/<numero>.db` con un segundo cliente whatsmeow. Contra una
sesión viva son **dos escritores del mismo SQLite**, y recuperar eso exige el teléfono físico y volver
a escanear. Le faltan las tres guardas que sí tienen las otras dos puertas (`409 vinculacion_en_curso`,
`409 ya_vinculado`, `409 linea_ya_corriendo`).

### 0.4 · Las tres que juntas hacen trivial cosechar el equipo entero

No son tres fugas sueltas: **son una cadena**, y cada eslabón elimina la precondición del siguiente.

1. **`GET /api/stream` (SSE) es un broadcast.** `emitirRT` publica en un `EventEmitter` único y
   `suscribirRT(cb)` **no recibe `vendedoraId` ni ningún discriminante**; el handler reenvía el evento
   crudo. Cada vendedora recibe un frame por **cada** mensaje de **todo** Hermes:
   `{"tipo":"mensaje","canal":"whatsapp","telefono":"519XXXXXXXX","direccion":"entrante"}`.
   Eso es el teléfono del lead ajeno y el instante exacto — y con `direccion: saliente`, además,
   vigilancia de la compañera: a quién le contestó y a qué hora. **No queda en ningún log.**
2. **`GET /api/whatsapp/conversacion/:telefono` sirve el hilo** sin mirar dueño ni rol. El SSE le
   entrega el teléfono, así que la única precondición que tenía («conocer un número ajeno») desaparece.
3. **`GET /api/persona/:interactionId` es enumerable**: el id es un `serial`. Recorriendo `1..N` se
   lee el nombre y las últimas 25 interacciones **sin conocer ningún teléfono previo**.

Un script de diez líneas se lleva el hilo del equipo entero, en vivo, con un token legítimo.

---

## 1 · Las 18 fugas críticas

#### C1 · `GET /api/whatsapp/conversacion/:telefono`

- **Dónde**: `server/src/routes/whatsapp.ts:175-266 → server/src/whatsapp/hilo.ts:75-118`
- **Se reproduce con**: `GET /api/whatsapp/conversacion/51987654321?numeroPropio=51984429504`
- **Qué obtiene**: Los últimos 200 mensajes con texto entrante y saliente, autor, persona_nombre, adjuntos (payload->media), origen del anuncio, citas resueltas, reacciones, ✓✓ y ediciones. Todo de una conversación ajena.
- **Cómo lo comprobó el escéptico**: Leí `hiloDe(base, telefono, numeroPropio, conMarca)`: su firma no tiene ningún parámetro de dueño ni de rol, y el único predicado del WHERE es `i.canal='whatsapp' AND i.persona_id=$1` más `mismaLinea(numeroPropio)` (hilo.ts:112-113). El handler no llama `rolDe(req)`, ni `esMiaSql`, ni `fronteraDeAsignacionSql` — no importa ninguno de los tres. Confirmado tal cual lo reportó el auditor.

#### C2 · `GET /api/persona/conv/:canal/:personaId`

- **Dónde**: `server/src/routes/persona.ts:39-49 → server/src/gente/repositorioDePersona.ts:40-52`
- **Se reproduce con**: `GET /api/persona/conv/whatsapp/51987654321`
- **Qué obtiene**: 100 filas con id, tipo, direccion, autor, persona_nombre, texto y occurred_at — y sin scope de línea, o sea mezclando las cinco líneas históricas, incluidas las tres retiradas el 11-ago.
- **Cómo lo comprobó el escéptico**: El SQL es literalmente `WHERE canal = $1 AND persona_id = $2 ORDER BY occurred_at ASC LIMIT 100`. Ni línea, ni dueño, ni rol. Un matiz que el auditor no dijo: al ser ASC con LIMIT 100 son los 100 más VIEJOS, así que en un hilo largo no sirve lo reciente — no cambia que sea una fuga, cambia qué se lleva.

#### C3 · `GET /api/persona/:interactionId`

- **Dónde**: `server/src/routes/persona.ts:51-80 → repositorioDePersona.ts:63-96`
- **Se reproduce con**: `GET /api/persona/1234 (los ids son bigserial: se recorre 1..N)`
- **Qué obtiene**: persona_nombre + las últimas 25 interacciones de esa persona con texto y contexto_texto completos. No hace falta conocer ningún teléfono de antemano: el id es secuencial.
- **Cómo lo comprobó el escéptico**: `interaccionPorId` es `SELECT ... WHERE id = $1` sin más, y `historialDeLaPersona` es `WHERE canal=$1 AND persona_id=$2 LIMIT 25`. El router no consulta el rol en ninguna de sus cuatro rutas (no importa `rolDe` ni `requiereVendedora`; solo lo cubre el perímetro). Es la ruta de DETALLE de la ruta de lista `/api/interactions`, exactamente el patrón «lista protegida, detalle no» — salvo que acá tamp…

#### C4 · `GET /api/interactions`

- **Dónde**: `server/src/routes/interactions.ts:19-40 → server/src/interacciones/consultas.ts:104-140`
- **Se reproduce con**: `GET /api/interactions?tipo=mensaje&limit=100&offset=0 (paginando se baja la tabla entera)`
- **Qué obtiene**: Filas crudas de `interactions` con texto, contexto_texto, persona_nombre, canal, tipo, occurred_at, status y el `id` — que es la llave para /api/persona/:id.
- **Cómo lo comprobó el escéptico**: El `ws[]` del WHERE solo puede recibir canal, tipo, intencion y rango (consultas.ts:108-117). No hay línea, dueño, rol ni ventana obligatoria: `filtroFecha` devuelve null si el rango no se pide. El SELECT (consultas.ts:120) lista `texto` explícitamente. Confirmado.

#### C5 · `GET /api/stream (SSE)`

- **Dónde**: `server/src/routes/stream.ts:26 → server/src/realtime/bus.ts:27-34; emisores en whatsapp/repositorioDrizzle.ts:60 y whatsapp/wiring.ts:125`
- **Se reproduce con**: `GET /api/stream con cualquier Bearer, dejándolo abierto`
- **Qué obtiene**: Un push por CADA mensaje de todo Hermes con `{tipo:'mensaje', canal, telefono, direccion}`: el teléfono del lead ajeno y el instante exacto en que escribió o le contestaron. Con eso se reconstruye en vivo la cartera y el ritmo de trabajo de las otras, y se cosechan los teléfonos con los que después se pide el hilo.
- **Cómo lo comprobó el escéptico**: `emisor.emit('rt', e)` sobre un `EventEmitter` único; `suscribirRT(cb)` no recibe `vendedoraId` ni ningún criterio, y el handler SSE escribe `JSON.stringify(e)` sin filtrar. El tipo `EventoRT` lleva `telefono: string | null` y `repositorioDrizzle.ts:63` lo llena con `interaccion.personaId`. No existe concepto de destinatario en el bus.

#### C6 · `GET /api/overview`

- **Dónde**: `server/src/routes/overview.ts:67 y la función `bandejaDe()` en :143-156`
- **Se reproduce con**: `GET /api/overview con el Bearer de cualquier vendedora`
- **Qué obtiene**: El campo `bandeja` de la respuesta trae las 15 últimas interacciones ENTRANTES sin atender de todo el equipo, con `persona_nombre`, `texto`, `contexto_texto`, `occurred_at`, `status` y el `id` (que es la llave de /api/persona/:id). Es contenido crudo de chats ajenos, servido por la ruta que la home pide al montar. El SQL es `SELECT id, canal, tipo, persona_nombre, texto, contexto_texto, occurred_at, status FROM interactions WHERE status='nuevo' AND direccion='entrante' … LIMIT 15`, sin línea, sin dueño, sin rol. El auditor no miró este router.

#### C7 · `GET /api/persona/conv/:canal/:personaId`

- **Dónde**: `server/src/routes/persona.ts:39-49 → server/src/gente/repositorioDePersona.ts:40-52`
- **Se reproduce con**: `GET /api/persona/conv/whatsapp/51999888777`
- **Qué obtiene**: Hasta 100 mensajes con `texto`, `direccion`, `autor`, `persona_nombre` y `occurred_at`. Es la fuga confirmada de `/api/whatsapp/conversacion/:telefono` por una segunda puerta.
- **Cómo lo comprobó el escéptico**: El handler lee `req.params` y llama directo al seam. El seam es `WHERE canal = ${canal} AND persona_id = ${personaId} ORDER BY occurred_at ASC LIMIT 100` — sin numeroPropio, sin dueño, sin rol. El router no tiene `requiereVendedora` propio: lo cubre `perimetroApi`, que solo valida el Bearer.

#### C8 · `GET /api/enlaces/buscar`

- **Dónde**: `server/src/routes/enlaces.ts:23-26 → server/src/identidad/unificado.ts:115-154`
- **Se reproduce con**: `GET /api/enlaces/buscar?q=519 (y ?q=511, ?q=521, ?q=ana…)`
- **Qué obtiene**: 12 filas por consulta con la `clave` armada (`conv:<canal>:<persona_id>:<numeroPropio>`), el teléfono, el nombre del lead, el conteo de mensajes y la fecha del último. Es el enumerador que arma todo lo demás: entrega la clave ya formateada para pegar en las otras rutas.
- **Cómo lo comprobó el escéptico**: `buscarContactos` exige `termino.length >= 2` y `digitos.length >= 3` para el LIKE numérico; con `?q=519` los tres dígitos pasan y el WHERE queda `persona_id LIKE '%519%'` sobre `interactions`, filtrado solo por canal. `ORDER BY max(occurred_at) DESC LIMIT 12` recorre la base variando el patrón. No hay ningún predicado de línea, dueño ni rol.

#### C9 · `GET /api/contactos/ficha`

- **Dónde**: `server/src/routes/contactos.ts:15-22 → server/src/cerberus/ficha.ts`
- **Se reproduce con**: `GET /api/contactos/ficha?telefono=51999888777`
- **Qué obtiene**: La ficha de Cerberus de cualquier teléfono: nombre, código de cliente, DNI, país, correo y sus ventas con folio, estado, monto, moneda y fecha. Es la PII más sensible que sirve Hermes.
- **Cómo lo comprobó el escéptico**: El handler valida que el teléfono no esté vacío y llama `ficha(telefono)` directo. `ficha()` no recibe ni vendedoraId ni rol — sale por HTTP a Cerberus con las credenciales del server. El único requisito es el teléfono, que `/api/enlaces/buscar` regala.

#### C10 · `GET /api/persona/:interactionId`

- **Dónde**: `server/src/routes/persona.ts:51-80 → server/src/gente/repositorioDePersona.ts:63-71 y :84-96`
- **Se reproduce con**: `GET /api/persona/12345 (y 12346, 12347… los ids de `interactions` son enteros correlativos)`
- **Qué obtiene**: Las últimas 25 interacciones de esa persona en ese canal con `texto`, `contexto_texto`, `tipo`, `occurred_at` y `status`, más `nombre` (`persona_nombre`) y `canal`. El auditor sumó `persona.ts` al informe pero leyó UNA de sus cuatro rutas: ésta es la misma fuga de contenido, y encima es el CUARTO enumerador de la superficie — el único que no exige conocer ni un teléfono ni una clave, solo contar de 1 en adelante. `interaccionPorId` es `SELECT … FROM interactions WHERE id = ${id}` y `historialDeLaPersona` es `WHERE canal = $1 AND persona_id = $2 ORDER BY occurred_at DESC LIMIT 25`: ni número propio, ni dueño, ni rol. ⚠️ Y a diferencia de `/api/gente/*`, ésta SÍ está viva en el front (`src/fe…

#### C11 · `GET /api/gestiones/intereses (SIN el parámetro `claves`)`

- **Dónde**: `server/src/routes/gestiones.ts:101-108 → server/src/gestiones/intereses.ts:103-110`
- **Se reproduce con**: `GET /api/gestiones/intereses`
- **Qué obtiene**: La tabla `intereses` ENTERA: mapa clave→cursos de toda la base, con la fecha de cada uno, el `productoId` y el `sku`. Es EXACTAMENTE el mismo defecto que el auditor encontró en `/etiquetas` —`String(req.query.claves ?? '').split(',').filter(Boolean)` da `[]`, y el seam lee `claves.length ? where(inArray(...)) : select().from(intereses)`— pero acá no lo vio: reportó la ruta solo en su forma «con claves conocidas». El comentario del propio seam lo documenta como retrocompatibilidad («Sin claves, esto es «traeme todos los intereses de la base»»). O sea: tercer enumerador que no exige saber nada de antemano, y encima el más caro de los tres, porque dice QUÉ QUIERE COMPRAR cada lead ajeno.

#### C12 · `GET /api/stream (SSE)`

- **Dónde**: `server/src/routes/stream.ts:17-34 (el handler) · server/src/realtime/bus.ts:24-34 (el bus) · server/src/whatsapp/repositorioDrizzle.ts:59-65 (el emisor)`
- **Se reproduce con**: `curl -N -H 'Authorization: Bearer <token de CUALQUIER vendedora>' https://hermes-api.goberna.us/api/stream — y esperar. Sin un solo query param.`
- **Qué obtiene**: Un frame por cada mensaje que entra o sale de CUALQUIER conversación del equipo: {"tipo":"mensaje","canal":"whatsapp","telefono":"519XXXXXXXX","direccion":"entrante"|"saliente"}. O sea el TELÉFONO del lead ajeno (el identificador con el que se abre la ficha), el instante exacto y si escribió él o le contestamos. Con `direccion: 'saliente'` además es vigilancia de la compañera: a quién le contestó y a qué hora. No queda en ningún log.
- **Cómo lo comprobó el escéptico**: Leí `stream.ts` entero: el handler recibe `req` y NUNCA lo consulta — no hay `rolDe(req)`, no hay `req.vendedoraId`, no hay filtro en el callback (reenvía el evento crudo con `res.write('data: ' + JSON.stringify(e))`). `suscribirRT` (bus.ts:32) es un `EventEmitter.on` de proceso, sin discriminante. Confirmé que la identidad SÍ está en el request cuando llega: `perimetroApi` (index.ts:86) deja `re…

#### C13 · `GET /api/stream → GET /api/whatsapp/conversacion/:telefono (encadenado)`

- **Dónde**: `server/src/routes/stream.ts:26-28 entrega el teléfono · server/src/routes/whatsapp.ts:175-181 sirve el hilo sin chequear dueño ni rol`
- **Se reproduce con**: `1) curl -N -H 'Authorization: Bearer <token vendedora>' .../api/stream → leer `telefono` de cada frame. 2) curl -H 'Authorization: Bearer <el mismo token>' '.../api/whatsapp/conversacion/519XXXXXXXX' (sin ?numeroPropio).`
- **Qué obtiene**: El contenido completo de cualquier conversación del equipo: texto de los mensajes, adjuntos, origen del lead (anuncio/campaña), reacciones. El SSE elimina la única precondición que tenía esa fuga en el modelo de amenaza («puede saber el teléfono de un lead ajeno»): se lo entrega solo, en vivo. Un script de diez líneas cosecha el hilo del equipo entero a medida que ocurre.
- **Cómo lo comprobó el escéptico**: Leí `routes/whatsapp.ts:175-181`: `const numeroPropio = typeof req.query.numeroPropio === 'string' ? ... : undefined; const mensajes = await hiloDe(db, telefono, numeroPropio);` — cero `rolDe`, cero `mandaEnElEquipo`, cero consulta a `conversacion_asignada`, y con `numeroPropio` ausente el hilo cruza todas las líneas. ⚠️ CON UNA SALVEDAD QUE EL AUDITOR NO PUSO: esto NO es un segundo defecto de S3…

#### C14 · `GET /api/interactions`

- **Dónde**: `server/src/routes/interactions.ts:19-40 → server/src/interacciones/consultas.ts:104-141 (SELECT en :119-128)`
- **Se reproduce con**: `GET /api/interactions?tipo=mensaje&limit=100&offset=0 con Bearer de vendedora`
- **Qué obtiene**: `texto` completo de cualquier mensaje entrante o saliente de cualquier conversación, con `persona_nombre`, `contexto_texto`, `occurred_at`, `status`, `id`, más `total` (el tamaño del universo, ~94k). Paginable con `offset` hasta vaciar la tabla `interactions`.
- **Cómo lo comprobó el escéptico**: Seguí la cadena entera. El array `ws` de `consultarInteracciones` se arma SOLO con `canal` (:109), `tipo` (:110), `intencion` (:111-112) y `rango` (:114-117): no hay ni una condición de dueño, de línea ni de rol, y el seam ni siquiera recibe un `vendedoraId`. La ruta tampoco resuelve rol (no importa `rolDe`). Lo único que hay delante es `perimetroApi` (`auth/perimetro.ts:56-62`), que valida ident…

#### C15 · `GET /api/overview`

- **Dónde**: `server/src/routes/overview.ts:67-140 (campo `bandeja`, armado en :143-156)`
- **Se reproduce con**: `GET /api/overview?rango=7d`
- **Qué obtiene**: Los 15 entrantes sin atender más recientes de TODO el negocio, con `persona_nombre` y `texto` completo. Sobre la línea compartida 51984429504 son, casi por definición, mensajes de conversaciones asignadas a otras vendedoras.
- **Cómo lo comprobó el escéptico**: `bandejaDe()` es `SELECT id, canal, tipo, persona_nombre, texto, contexto_texto, occurred_at, status FROM interactions WHERE status='nuevo' AND direccion='entrante' AND (tipo='mensaje' OR occurred_at > now()-7d) ORDER BY occurred_at DESC LIMIT 15` — sin dueño, sin línea, sin rol. Y verifiqué el detalle que hace grande la fuga: `interactions.status` tiene `.notNull().default('nuevo')` (`db/schema.…

#### C16 · `PUT /api/reparto/asignacion`

- **Dónde**: `server/src/routes/reparto.ts:110-160 → server/src/reparto/asignar.ts:341-372 (`reasignar`)`
- **Se reproduce con**: `PUT /api/reparto/asignacion Authorization: Bearer <vendedora> {"clave":"conv:whatsapp:51999888777:51984429504","numeroPropio":"51984429504","vendedoraId":"<yo misma>"}`
- **Qué obtiene**: La conversación entera pasa a su cola y desaparece de la de su dueña, sin síntoma. Es la llave maestra de la frontera desplegada HOY. CORRECCIÓN sobre el informe original: la única validación NO es trivial de saltar — `esDestinoValido(vendedoraId, destinos)` (routes/reparto.ts:130-146) exige que la atacante esté en `reparto_rueda` de ESA línea o en `numero_vendedora`. Una vendedora fuera de la rueda de esa línea come 409 al asignarse a sí misma; lo que SÍ puede es pasársela a un tercero válido, que igual se la saca a la dueña. En producción las cinco `ventas1X` están en la rueda de `51984429504`, así que el auto-asignarse funciona tal cual. La gravedad no baja: el destino verificado protege…
- **Cómo lo comprobó el escéptico**: Leí `routes/reparto.ts` entero: no hay `rolDe(req)`, ni `mandaEnElEquipo(req)`, ni lectura del dueño actual. `reasignar` (asignar.ts:341) es un `INSERT ... ON CONFLICT (clave) DO UPDATE SET vendedora_id = aQuien` — no lee nada antes de escribir. Y `git grep -n "frontera\|duenoSql" server/src/cola/asignadaSql.ts` confirma que `duenoSql = COALESCE(ca.vendedora_id, cl.vendedora_id)` (línea 79) y que…

#### C17 · `GET /api/correos`

- **Dónde**: `server/src/routes/correos.ts:50-53 → server/src/correos/correos.ts:44-46 (`ultimosCorreos`)`
- **Se reproduce con**: `GET /api/correos Authorization: Bearer <vendedora>`
- **Qué obtiene**: Los últimos 50 correos 1-a-1 del equipo entero con la fila completa: `vendedora_id`, `para` (el mail del lead ajeno), `asunto`, `cuerpo` (el texto ENTERO), `clave` (que en WhatsApp es `conv:whatsapp:<teléfono del lead>:<línea>`, o sea el teléfono en claro), `estado`, `motivo` y fechas. Contenido puro de la comunicación de otra vendedora con su lead. Está declarado como decisión de producto en el docblock («del equipo — coordinación, no secreto»), pero contradice frontalmente el invariante: correo es un canal 1-a-1 y acá se sirve el cuerpo completo a cualquier token de vendedora. El recorte mínimo compatible con el motivo declarado («no le escribas dos veces») sería `para` + fecha, sin `cuer…
- **Cómo lo comprobó el escéptico**: `ultimosCorreos` es literalmente `base.select().from(correos).orderBy(desc(correos.creadoAt)).limit(50)` — `select()` sin proyección devuelve todas las columnas, y no hay un solo `.where()`. El handler llama con `_req` (ni siquiera lee `req.vendedoraId`). Verifiqué que `correos` lleva `cuerpo` y `clave` mirando `CorreoAAuditar` (correos/correos.ts:52-58), que es lo que se inserta.

#### C18 · `GET /vincular/estado (y GET /vincular)`

- **Dónde**: `server/src/routes/vincular.ts:22 y :31 · montaje anónimo en server/src/index.ts:180 (fuera del perímetro, y el fallback SPA de index.ts:199 excluye `vincular` justo para que llegue) · el estado se ar…`
- **Se reproduce con**: `curl https://hermes-api.goberna.us/vincular/estado — sin Authorization, sin cookie, sin nada; en bucle cada 1,5 s. La consola entera: GET https://hermes-api.goberna.us/vincular`
- **Qué obtiene**: El número que se está vinculando, el data-URI del QR del pareo en vuelo y, al conectar, el JID de la cuenta. Es anónimo y derrota la guarda de dueño de `routes/miLinea.ts:285` — cuyo propio docblock dice «si Ana inicia un pareo y Bea consulta /vincular/estado, Bea vería el QR de Ana». Esa guarda cubre SOLO `/api/whatsapp/mi-linea/vincular/estado`; el `vinculador` es el MISMO singleton importado por las tres puertas (`whatsapp/vinculador.ts` exporta `export const vinculador = new Vinculador()`, y lo importan `routes/vincular.ts`, `routes/admin.ts:12` y `numeros/miLineaCableado.ts`), así que un pareo arrancado por mi-línea o por /api/admin se lee entero desde esta puerta vieja, que no tiene a…
- **Cómo lo comprobó el escéptico**: Leí `routes/vincular.ts` entero: los cuatro handlers no tienen un solo middleware, ni `requiereVendedora` ni `requiereServicio`. Verifiqué que `esRutaAbierta` (`auth/perimetro.ts:40-42`) devuelve `true` para todo lo que no arranca en `/api/`, o sea que el perímetro ni lo mira. Verifiqué el montaje en `index.ts:180` y que el comentario de `index.ts:177-179` lo reconoce por escrito («queda FUERA de…

---

## 2 · Las 45 serias

Sirven contenido o metadatos de conversaciones ajenas, o permiten **actuar** sobre ellas (mandar
mensajes, reaccionar, editar, marcar leído, reasignar). Se separan de las críticas porque exigen
conocer una clave o un teléfono — precondición que, por §0.4, el SSE regala.

| # | Ruta | Dónde | Qué obtiene |
|---|---|---|---|
| S1 | `POST /api/whatsapp/enviar` | `server/src/routes/whatsapp.ts:341-377 → whatsapp/envia…` | No lee: escribe. Le manda un WhatsApp al lead de otra vendedora por la línea compartida, queda auditado a nombre del atacante en `envios_wa`, y cance… |
| S2 | `POST /api/whatsapp/enviar-media` | `server/src/routes/whatsapp.ts:545-606` | Lo mismo que /enviar pero con adjunto: un archivo al lead de otra vendedora, más el archivo escrito a disco en .wa-media/. |
| S3 | `POST /api/whatsapp/reaccionar` | `server/src/routes/whatsapp.ts:492-510 → server/src/rea…` | Le pone o le quita una reacción a un mensaje del lead de otra vendedora, y al lead le llega. El mensajeId sale del hilo, que ya se puede leer sin per… |
| S4 | `POST /api/whatsapp/leido/:telefono` | `server/src/routes/whatsapp.ts:291-335` | Actúa sobre la conversación ajena hacia AFUERA: le manda los ✓✓ azules al lead de otra vendedora (whatsapp.ts:329). Para el lead es «me leyeron» sobr… |
| S5 | `GET /api/whatsapp/media/:archivo` | `server/src/routes/whatsapp.ts:383-395; el nombre de la…` | Cualquier archivo de .wa-media/ por su nombre. La foto de perfil es ENUMERABLE porque el nombre es exactamente `pfp-<telefono>.<jpg|png>`: sabiendo e… |
| S6 | `GET /api/entrenamiento/corridas/:id y GET /api/entrenamient…` | `server/src/routes/entrenamiento.ts:265 y :271-300; el …` | Una fila por CONVERSACIÓN REAL sobre la que corrió el bot (hasta 300 por corrida), con `clave` = `conv:whatsapp:<telefono>:<linea>` —o sea el teléfon… |
| S7 | `GET /api/entrenamiento/agujeros?numero=51984429504` | `server/src/routes/entrenamiento.ts:392-400 → server/sr…` | Hasta 50 escaladas del bot con la PREGUNTA TEXTUAL que el lead escribió (subconsulta a `interactions` por el último entrante, consultarAgujeros.ts:87… |
| S8 | `GET /api/sugerencias?clave=conv:whatsapp:51987654321:519844…` | `server/src/routes/sugerencias.ts:24-68 (el `ficha(tele…` | Dos cosas de una conversación ajena. (1) Su estado derivado del hilo: `pidioInfo` —calculado sobre el ÚLTIMO mensaje entrante—, `cotizada`, `enfriada… |
| S9 | `GET /api/senales?claves=conv:a,conv:b,…` | `server/src/routes/senales.ts:26-58 → server/src/senale…` | Por cada conversación ajena: si se cotizó, CUÁNDO (`ocurridoEn`), los MONTOS detectados con su moneda y confianza (`Veredicto.montos`, cotizacion.ts:… |
| S10 | `POST /api/plantillas/:id/enviar-paso` | `server/src/routes/plantillas.ts:388-460 (schema en :37…` | La CUARTA puerta de envío, que el auditor no listó (miró /enviar y /enviar-media). Manda un mensaje —con imagen incluida si el paso la tiene— al lead… |
| S11 | `GET /api/gestiones/etiquetas (sin el parámetro `claves`)` | `server/src/routes/gestiones.ts:174-179 → server/src/ge…` | La tabla `etiquetas` entera: mapa clave→etiquetas de todas las conversaciones que alguien clasificó, con el teléfono y la línea adentro de cada clave. |
| S12 | `GET /api/gestiones/etapas` | `server/src/routes/gestiones.ts:95-97 → server/src/gest…` | El mapa clave→etapa actual de toda conversación con al menos una gestión asentada, sin un solo parámetro: teléfono, línea y punto del embudo (cotizad… |
| S13 | `GET /api/contactos/lead` | `server/src/routes/contactos.ts:33-41 → server/src/gent…` | El lead-form de esa persona: `full_name`, `email`, `campaign_name`, `ad_name`, `form_name`, `platform` y fecha. El complemento de `/ficha` para quien… |
| S14 | `GET /api/gente/buscar` | `server/src/routes/gente.ts:13-20 → server/src/canales/…` | Hasta 20 personas del grafo de identidad: nombre, un contacto (correo preferido, si no teléfono) y cantidad de compras, ordenadas por compras DESC. |
| S15 | `GET /api/gente/:id` | `server/src/routes/gente.ts:22-33 → server/src/canales/…` | El 360: nombre, TODAS las identidades `{tipo,valor}` (correos, teléfonos, wa_id), LTV en USD, compras, países, reembolsos, cuotas, y la línea de tiem… |
| S16 | `GET /api/eventos?clave=` | `server/src/routes/eventos.ts:45-52 → server/src/evento…` | El timeline escrito a mano de esa conversación: `tipo`, comentario en texto libre, curso y el `vendedora_id` de quien lo registró. |
| S17 | `GET /api/gestiones/de/:clave` | `server/src/routes/gestiones.ts:90-92 → server/src/gest…` | Las últimas 10 gestiones con `select()` sin proyección: etapa, próxima acción, próxima fecha, `notas` en texto libre (prosa que otra vendedora escrib… |
| S18 | `GET /api/gestiones/intereses?claves=` | `server/src/routes/gestiones.ts:101-108 → server/src/ge…` | Qué curso quiere cada lead ajeno, con fecha, `productoId` y `sku`, más el `derivados` (el curso deducido del anuncio por el que entró). Acepta lote s… |
| S19 | `GET /api/senales?claves=` | `server/src/routes/senales.ts:26-57 → server/src/senale…` | Por conversación ajena: si se cotizó, con qué `confianza`, y —verificado— los MONTOS detectados en el mensaje saliente, más si se enfrió y hace cuánt… |
| S20 | `GET /api/sugerencias?clave=` | `server/src/routes/sugerencias.ts:24-68 → server/src/su…` | El `estado` derivado del hilo ajeno: `esPrimerContacto`, `curso`, `pidioInfo`, `cotizada`, `enfriada`, `vioMaterial`, `negocio` — derivado del PRIMER… |
| S21 | `GET /api/enlaces?clave=` | `server/src/routes/enlaces.ts:29-36 → server/src/identi…` | El grupo unificado: cada otro contacto con su identidad de canal, canal, `persona_id`, nombre, TODAS sus claves, mensajes, último at, intereses por c… |
| S22 | `POST /api/contactos/registrar-venta` | `server/src/routes/contactos.ts:52-66 → server/src/cont…` | Actuar sobre un lead ajeno: inserta en `conversiones_wa` con el `vendedoraId` del token del atacante sobre el teléfono de otra, robándose la atribuci… |
| S23 | `POST /api/gestiones` | `server/src/routes/gestiones.ts:50-87 → server/src/gest…` | Mover la etapa del embudo de una conversación ajena —incluido `perdido`, terminal humano— y dejarle una nota firmada. La tarjeta se le mueve de colum… |
| S24 | `DELETE /api/gestiones/intereses · POST/DELETE /api/gestione…` | `server/src/routes/gestiones.ts:166-170, :181-194, :196…` | Escritura y BORRADO sobre datos de una conversación ajena, sin rastro de quién borró. Quitarle el interés a un lead ajeno lo saca de «Saben el precio… |
| S25 | `POST /api/eventos` | `server/src/routes/eventos.ts:62-82 → server/src/evento…` | Planta un evento firmado en el timeline de una conversación ajena; un `pregunto_curso` además asienta el interés (escribe en `intereses`), o sea que … |
| S26 | `POST /api/enlaces · DELETE /api/enlaces` | `server/src/routes/enlaces.ts:45-60 y :63-76 → server/s…` | Fusionar o des-fusionar las identidades de dos conversaciones ajenas, escribiendo en `ontologia.vinculos_identidad` con `actor:'operador:<yo>'`. |
| S27 | `POST /api/gestiones/intereses` | `server/src/routes/gestiones.ts:122-137 → server/src/ge…` | Escribir un interés sobre una conversación ajena. El auditor reportó el DELETE de intereses y omitió el POST. Verifiqué la cadena: `registrarInteres`… |
| S28 | `POST /api/gestiones/intereses/derivado` | `server/src/routes/gestiones.ts:148-164 → server/src/cu…` | Dos cosas, y la segunda es la interesante. (1) Escritura: confirma el interés derivado sobre una conversación ajena, firmado con el token del atacant… |
| S29 | `GET /api/persona/:interactionId/link` | `server/src/routes/persona.ts:156-200 → server/src/gent…` | El permalink público del comentario de Facebook/Instagram de cualquier interacción, enumerando el id. Confirma la existencia de la interacción (404 v… |
| S30 | `GET /api/stream — la campanita y el aviso de escritorio (el…` | `src/lib/datos/tiempoReal.ts:62-68 (dispara) · src/lib/…` | Le suena la campanita a Sindy cuando le escriben a un lead de Luz, y si la pestaña no está a la vista salta un `Notification` del SO que dice «Nuevo … |
| S31 | `GET /api/stream — el evento de REACCIÓN (el auditor lo dio …` | `server/src/whatsapp/wiring.ts:125 · server/src/whatsap…` | Un frame {"tipo":"mensaje","canal":"whatsapp","telefono":"519XXXXXXXX"} con el teléfono del lead ajeno cada vez que reacciona a un mensaje. Sin `dire… |
| S32 | `GET /api/stream — la conexión no revalida la sesión NUNCA, …` | `server/src/routes/stream.ts:17-34 (retiene `res` indef…` | El mismo censo en vivo del hallazgo 1, pero para alguien que ya NO debería tener acceso. `requiereVendedora` corre una sola vez, en el handshake; a p… |
| S33 | `GET /api/dashboard (campos `etapas` y `etiquetas`)` | `server/src/routes/dashboard.ts:132-135 → server/src/da…` | El mapa COMPLETO `clave → etapa asentada` de todas las conversaciones gestionadas del equipo, y `clave → etiquetas manuales`. Como la clave es `conv:… |
| S34 | `GET /api/leads` | `server/src/routes/leads.ts:86-110 (la consulta en :104)` | `db.select().from(leads)` sin proyección ni filtro: la fila entera de cada lead de formulario — `full_name`, `email`, `phone`, `campaign_name`, `cust… |
| S35 | `GET /api/gestiones/etapas` | `server/src/routes/gestiones.ts:95-97 → server/src/gest…` | El mapa COMPLETO `clave → etapa` de toda la base, sin ventana de fechas y sin un solo WHERE. Es el mismo dato de la fuga 3 del auditor pero por una p… |
| S36 | `GET /api/gestiones/etiquetas (sin `?claves=`)` | `server/src/routes/gestiones.ts:174-179 → server/src/ge…` | TODAS las etiquetas manuales de TODAS las conversaciones del equipo, con su clave. El seam ramifica `claves.length ? where(inArray(...)) : select().f… |
| S37 | `GET /api/senales?claves=…` | `server/src/routes/senales.ts:26-57 → server/src/senale…` | Para cualquier clave construida a mano: si se cotizó, CUÁNDO, los `montos` detectados, si se enfrió, y —lo peor— el campo `motivo`, que devuelve el F… |
| S38 | `GET /api/hechos?clave=conv:…` | `server/src/routes/hechos.ts:73-95 (línea 82) → server/…` | El estado comercial completo de cualquier conversación: `esPrimerContacto`, `curso` (el interés que registró la otra vendedora), `pidioInfo` (derivad… |
| S39 | `POST /api/plantillas/:id/enviar-paso` | `server/src/routes/plantillas.ts:388-478 (schema :373-3…` | No es leer: es ACTUAR (fuga tipo 4). Manda un WhatsApp real al lead de otra vendedora desde la línea compartida, y el mensaje queda PROYECTADO en el … |
| S40 | `GET /api/reparto/rueda?linea=` | `server/src/routes/reparto.ts:58-88 (línea 66) → server…` | El nombre de cada vendedora de la línea y CUÁNTAS conversaciones tiene asignada cada una (`asignadas`, `orden`, `activa`), más `destinos` con la list… |
| S41 | `POST /api/correos/enviar` | `server/src/routes/correos.ts:55-97 (el body llega crud…` | Fuga tipo 4 — actuar sobre la conversación ajena, y el auditor no la abrió (no aparece ni en `sanas` ni en `fugas`). Manda un correo real, desde el S… |
| S42 | `POST /vincular/iniciar · POST /vincular/cerrar` | `server/src/routes/vincular.ts:15 y :26 → server/src/wh…` | No lee: ACTÚA, y sin credencial (punto 4 de la lista de fugas). `iniciar` valida ÚNICAMENTE `numero.length >= 8` después de sacar los no-dígitos (vin… |
| S43 | `POST /api/sdk/invocar/governa.tesoreria.reloj` | `server/src/routes/sdk.ts:54 → server/src/sdk/herramien…` | Hasta 100 filas con NOMBRE Y APELLIDO del cliente (`concat(cl.payload->>'nombre_cliente',' ',cl.payload->>'apellido_cliente')`), folio de venta, mont… |
| S44 | `GET /api/stream (SSE)` | `server/src/routes/stream.ts:17 y :26 → server/src/real…` | El TELÉFONO de cada mensaje entrante de TODAS las líneas y TODAS las vendedoras, en tiempo real y en el momento exacto en que llega. `streamRouter.ge… |
| S45 | `GET /api/whatsapp/media/:archivo` | `server/src/routes/whatsapp.ts:383` | El adjunto —foto, audio, PDF, video— de cualquier conversación, de cualquier vendedora. El handler valida el NOMBRE contra `/^[A-Za-z0-9._-]+$/` (bie… |

---

## 3 · Las 19 menores

| # | Ruta | Qué obtiene |
|---|---|---|
| m1 | `GET /api/whatsapp/foto/:telefono` | La foto de perfil cacheada de cualquier contacto (el docblock dice «la foto es PII»), y de yapa un efecto de escritura: si no hay foto se cachea «no tiene» por 7 días so… |
| m2 | `POST /api/whatsapp/editar` | Reescribiría el texto de un mensaje que otra vendedora ya le mandó a su lead, y la corrección le llegaría al lead. |
| m3 | `GET /api/autorespuesta/bandeja` | Por cada borrador esperando aprobación: `telefono`, `personaNombre`, la `clave` de la conversación, el `texto` que se le va a mandar, la campaña de la que vino y cuándo … |
| m4 | `GET /api/correos` | Los últimos 50 correos del EQUIPO con `select()` sin proyección: destinatario (`para`), asunto, CUERPO completo, la `clave` de conversación asociada y quién lo mandó. Es… |
| m5 | `GET /api/conversaciones (la única ruta protegida) — la fron…` | La cola entera del equipo, sin frontera y sin un solo error. El loop apaga por nombre `curso_ruteo`, `conversacion_asignada`, `bot_calificaciones` y `clientes_padron`; c… |
| m6 | `PATCH/DELETE /api/eventos/:id — oráculo de dueño` | La escritura sí está protegida, pero el par 404/409 distingue «no existe» de «existe y es de otra», y el cuerpo del 409 nombra a la vendedora («esto lo registró Luz…»). … |
| m7 | `GET /api/persona/:interactionId/puede-privado` | Metadato de una interacción ajena por id: existe o no (404 vs 200), su `canal`, su `tipo`, cuántos DÍAS tiene (`dias`) y si la ventana de 7 días sigue abierta. Con eso s… |
| m8 | `GET /api/stream — el {tipo:'estado'} del webhook de landing…` | «Acaba de entrar un lead de landing», con su marca de tiempo, empujado a todas las vendedoras conectadas — incluidas las que no van a trabajarlo. No lleva ningún identif… |
| m9 | `GET /api/resultados/piezas?vendedora=<otra>` | Los agregados de trabajo de OTRA vendedora: total de `envios`, y por pieza el `n`, la mediana de demora y las tasas de respuesta / avance de etapa / venta. Es justo lo q… |
| m10 | `GET /api/overview/tesoreria · /comercial · /cartera · /lazo…` | Nombre y apellido de clientes con folio, monto, moneda y método de pago (hasta 100 filas); la lista de deudores con nombre y saldo; el mix comercial y la serie de factur… |
| m11 | `POST /api/sdk/invocar/:nombre` | Exactamente lo mismo que `/api/overview/tesoreria` (nombre y apellido de clientes, folio, monto, método de pago), porque la herramienta es `ejecutar: () => relojDeTesore… |
| m12 | `GET /api/gestiones/intereses?claves=…` | Qué curso(s) quiere la conversación ajena, con fecha, más los `derivados` del anuncio por el que entró. Mismo patrón que `/api/senales`: la ruta parsea claves y consulta… |
| m13 | `GET /api/conversaciones (frontera fail-open por degradación)` | La cola entera, de todas. `const frontera = conAsignacion ? fronteraDeAsignacionSql(...) : null`: si el loop de degradación apaga `conAsignacion` porque la tabla no exis… |
| m14 | `POST /api/plantillas/:id/preparar` | El nombre real del contacto según Cerberus, embebido en el texto expandido, para cualquier teléfono. Y funciona como oráculo «¿este número ya compró?», porque el nombre … |
| m15 | `GET /api/categorias` | El `conteo` de cada categoría sale de `SELECT lower(etiqueta), count(DISTINCT clave) FROM etiquetas GROUP BY lower(etiqueta)` — sin `WHERE vendedora_id`. El `WHERE c.ven… |
| m16 | `POST /api/agenda · POST /api/venta/crear` | Escritura sobre conversación ajena (fuga tipo 4). Agendar con una clave que no es suya inserta una fila en `gestiones` con SU `vendedora_id` y etapa `contactado` sobre e… |
| m17 | `Todo el server — CORS abierto (deuda #94)` | Confirmo el análisis del auditor y lo suscribo TAL CUAL, incluida su parte desinflante: `cors()` sin opciones pone `Access-Control-Allow-Origin: *` y NO pone `Allow-Cred… |
| m18 | `POST /webhook/cerberus` | Nada de conversaciones: es escritura, y falla cerrado sin secreto. Dos debilidades menores, confirmadas, que nombro por completitud y NO como rotura del invariante. (1) … |
| m19 | `POST /webhook/landing/:token` | Nada: NO es una fuga y lo digo primero para que nadie lo lea como tal. Lo reporto porque el auditor declaró esta puerta «sana» y la puerta lo es (`timingSafeEqual` contr… |

---

## 4 · Lo que SÍ está protegido

Esta lista vale tanto como la de arriba: **es la que dice hasta dónde llegó la mirada**, y es contra la
que hay que comparar cuando alguien diga «esto ya estaba bien».

- **S1** — GET /api/conversaciones — PROTEGIDA, y es el molde. El rol baja aparte de las opciones (routes/conversaciones.ts:123, `rolDe(req)`), consultarCola lo traduce a un booleano una sola vez (cola/consultarCola.ts:1110) y el recorte vive en el WHERE (cola/asignadaS…
- **S1** — PUT /api/conversaciones/estado — SANA en cuanto a fuga. El upsert va por (req.vendedoraId del token, clave) (routes/conversaciones.ts:155): escribe estado PERSONAL y no devuelve ni una fila ajena. Acepta cualquier `clave`, o sea que se puede fijar una convers…
- **S1** — GET /api/whatsapp/sesion — SANA. Devuelve estado del transporte, nombre, limitesMedia y puedeEditar (routes/whatsapp.ts:84-110). Ni un dato de conversación ni de persona.
- **S1** — GET /api/whatsapp/lineas — SANA para este invariante. Lista las líneas VIVAS del gestor con su etiqueta y la marca `mias` (routes/whatsapp.ts:134-172), y hasta recorta a las propias cuando la vendedora es exclusiva de campaña (:154, soloSusLineas). No expone …
- **S1** — GET /api/interactions/canales — SANA. Solo agregados por canal (total, pide_info, ventana_abierta, sin_atender, comentarios, mensajes) con GROUP BY canal (interacciones/consultas.ts:167-183). No identifica a nadie ni se puede desagregar a una conversación.
- **S1** — GET /api/interactions/frescura — SANA. Un timestamp de última ingesta, un total global y un booleano (routes/interactions.ts:73). Nada por persona.
- **S1** — El perímetro en sí — SANO y hay que decirlo, porque es lo que evita que esto sea peor. `perimetroApi` (server/src/auth/perimetro.ts:60) exige vendedora para TODO /api salvo /api/auth, /api/admin y /api/catalogo, compara en minúsculas para que /API/… no lo esq…
- **S2** — GET /api/eventos/vocabulario (server/src/routes/eventos.ts:37-42) — no toca la base ni recibe una clave: deriva la respuesta de `CATALOGO_EVENTOS`/`TIPOS_EVENTO` en cada request. Cero dato de conversación, no hay nada que recortar.
- **S2** — PATCH /api/eventos/:id (server/src/routes/eventos.ts:92-108 → server/src/eventos/registrarEvento.ts:170-172, `puedeTocar` con `mismaVendedora`) — un evento ajeno NO se puede editar: la guarda compara normalizando los dos lados, así que la grafía `Luz`/`luz` n…
- **S2** — DELETE /api/eventos/:id (server/src/routes/eventos.ts:111-124 → `archivarEvento`, misma guarda `mismaVendedora`) — archivar un evento ajeno tampoco se puede, por el mismo camino.
- **S2** — Autoría no suplantable en TODAS las escrituras de la superficie: el `vendedoraId` sale siempre de `req.vendedoraId!` (del token HMAC) y nunca del body — eventos.ts:77, gestiones.ts:70, :133, :156, :191, enlaces.ts:53, :70, contactos.ts:60. Nadie puede firmar …
- **S2** — Ninguna ruta de S2 es anónima (server/src/auth/perimetro.ts:47-49, :56-62) — `/api/gente` y `/api/persona` no traen `requiereVendedora` propio en su router, pero el perímetro cerrado por defecto las cubre igual: solo `/api/auth`, `/api/admin` y `/api/catalogo…
- **S2** — GET /api/senales (server/src/routes/senales.ts:37-42) tiene tope de lote de 200 claves y GET /api/gestiones/intereses no tiene ninguno — el tope no es una frontera, pero acota el costo de un volcado. Lo anoto como lo único que hoy pone un techo, no como prote…
- **S3** — `GET /api/stream` NO es anonimo — eso si esta bien. Vive detras del perimetro cerrado por defecto (`server/src/auth/perimetro.ts:56-62`, montado en `index.ts:86`), no figura en PREFIJOS_ABIERTOS (perimetro.ts:22-26), y el consumidor corta el loop ante 401/403…
- **S3** — LA SUPERFICIE ES EXACTAMENTE UN ENDPOINT, y eso lo verifique en vez de asumirlo: `git grep -n 'res.write|writeHead|flushHeaders' origin/main -- server/src` devuelve SOLO `routes/stream.ts` (lineas 18, 24, 27, 31). No hay websockets: `git grep -niE 'websocket|…
- **S3** — El SSE NO transporta contenido de mensajes. `EventoRT` (`server/src/realtime/bus.ts:16-22`) es un tipo cerrado de dos variantes y ninguna tiene campo de texto, adjunto, nombre ni nota. Lo que se filtra es el IDENTIFICADOR (telefono) y el metadato temporal, no…
- **S3** — `whatsapp/wiring.ts:145` — el emisor de los ✓✓ (recibos de entrega) manda `telefono: null` explicitamente. No identifica ninguna conversacion: es un «refresca la pantalla» pelado. Sano, y ademas solo emite `if (filas > 0)`, o sea cuando algo cambio de verdad.
- **S3** — `whatsapp/wiring.ts:159` (cambio de estado de una linea) y `webhook/landing.ts:93` (lead nuevo de landing) emiten `{ tipo: 'estado' }` — cero identificadores, cero campos. Lo unico que revela es «algo se movio en el sistema», no atribuible a ninguna persona n…
- **S3** — Facebook / Instagram / comentarios NO tienen fuga por este canal, porque no tienen tiempo real en absoluto: `git grep -n 'emitirRT|realtime/bus' origin/main -- server/src/meta server/src/webhook` devuelve UNICAMENTE `webhook/landing.ts` (el `{tipo:'estado'}` …
- **S3** — `esMensajeEntrante` (`src/lib/notificaciones/decidir.ts:11-13`) hace bien lo que promete: la campanita no suena por lo que manda la propia vendedora, ni por una reaccion, ni por un ✓✓, y trata `direccion` ausente como «no sonar» (fail-closed hacia el silencio…
- **S3** — La identidad para poder filtrar YA ESTA DISPONIBLE en el request cuando llega al stream: `perimetroApi` (index.ts:86) deja `req.vendedoraId` y `cargarRol` (index.ts:94, app-wide) deja `req.rolResuelto`, ambos ANTES de `app.use('/api/stream', streamRouter)` (i…
- **S4** — GET /api/dashboard/negocio — 403 `no_es_supervisor` antes de tocar la base, decidido con el rol resuelto por el server y no por query param: `server/src/routes/dashboard.ts:66-70` (`recorteDelDashboard(req.vendedoraId, rolDe(req).rol)`), con `puedeSupervisar`…
- **S4** — GET /api/dashboard → campo `chats` (EL RADAR, el que sirve filas con nombre y telefono) — RECORTADO EN EL WHERE. `routes/dashboard.ts:109` pasa `soloAsignadasA` y el recorte vive en el SQL, despues del UNION: `server/src/cola/consultarRadar.ts:191` (`WHERE ${…
- **S4** — GET /api/dashboard → campo `formularios` — se cae entero con recorte personal: `server/src/dashboard/consultasDelDashboard.ts:79` (`if (soloAsignadasA !== null) return []`), antes de ejecutar una sola consulta.
- **S4** — GET /api/dashboard → campo `embudo` — `contarPorEtapaEfectiva` acota por clave asignada: `server/src/cola/consultarCola.ts:1505-1507` (`soloMisClavesSql(sql\`todo.clave\`, soloAsignadasA)`) y de ahi al GROUP BY de `desglosarEmbudo`.
- **S4** — GET /api/dashboard → campo `cursos` — `server/src/dashboard/consultasDelDashboard.ts:150` (`WHERE ${soloMisClavesSql(sql\`clave\`, soloAsignadasA)}`).
- **S4** — GET /api/dashboard → campo `series` (las tres) — cada una acotada donde se puede: leads/dia por clave asignada con el join a `events` (`server/src/dashboard/series.ts:111-119`), envios/dia y ventas/dia por `vendedora_id` normalizado (`series.ts:164` y `:180`,…
- **S4** — GET /api/dashboard → campo `porVendedora` — el filtrado ocurre en el SERVER antes del `res.json`, no en el navegador: `server/src/routes/dashboard.ts:151-156`, con `mismaVendedora` normalizando las dos grafias; `automaticos` se anula. La consulta cruda no lle…
- **S4** — GET /api/conversaciones (la pagina del Pipeline y de Mensajes) — el rol viaja APARTE de las opciones armadas con el query string: `server/src/routes/conversaciones.ts:123` (`rolDe(req)`), y `consultarCola` lo traduce a un solo booleano en `server/src/cola/con…
- **S4** — EL DESGLOSE DEL EMBUDO (Pipeline) — la frontera SI entro ahi, y esto es lo que revise expresamente: `server/src/cola/consultarCola.ts:1342` le pasa `[...condicionesBase, ...soloMias, ...(frontera ? [frontera] : [])]` a `desglosarEmbudo`. El predicado esta en …
- **S4** — LOS CONTEOS Y EL TOTAL de la cola — la frontera entra tambien al `count(*) FILTER` y al `WHERE` de la consulta de conteos: `server/src/cola/consultarCola.ts:1297` y `:1322`. Era el defecto #390 (la cabecera decia 7 sobre una cola de 1) y esta cerrado, con `co…
- **S4** — GET /api/resultados/piezas — no devuelve texto ni clave de conversacion: `consultarResultados` es `agregar(...)` y las filas que salen son por PIEZA (`server/src/resultados/agregar.ts:168-203`). El `texto` y la `referencia` que trae el SQL (`resultados/consul…
- **S4** — GET /api/decisions — solo lee snapshots de pauta de Meta desde `ontologia`/`pauta` y los pasa por detectores puros (`server/src/routes/decisions.ts:44-70`). No toca `interactions`, `envios_wa` ni `conversacion_asignada`.
- **S4** — GET /api/structure/:campaignId — proxy a la Graph API de Meta con `META_ACCESS_TOKEN`; devuelve gasto/impresiones/clics por campana-conjunto-anuncio (`server/src/routes/structure.ts:63-90`). Cero datos de conversacion.
- **S4** — GET/PUT /api/config/cuentas-pauta — cuentas publicitarias configuradas (`server/src/routes/config.ts:18-42`). No hay dato de conversacion; el PUT es escritura compartida sin rol, pero sobre config de pauta, no sobre nada de un lead.
- **S4** — EL PERIMETRO — cerrado por defecto y case-insensitive: `server/src/auth/perimetro.ts:39-62`; las tres excepciones (`/api/auth`, `/api/admin`, `/api/catalogo`) son credenciales de servicio o el login. Ninguna ruta de mi superficie queda sin identidad. Lo que f…
- **S4** — LA RESOLUCION DEL ROL — se hace una vez por request leyendo el Bearer directo, nunca un query param, y nunca tira: `server/src/equipo/cargarRol.ts:59-83`, con default fail-closed (`rolDe` → `SIN_IDENTIDAD`, `:93-95`).
- **S5** — GET/POST/PATCH/DELETE /api/agenda — las cuatro pasan por `vendedoraId` del token y el WHERE lo lleva la base: `consultarAgenda` filtra `eq(recordatorios.vendedoraId, …)` (server/src/agenda/recordatorios.ts:41) y PATCH/DELETE llevan el mismo `and(eq(id), eq(ve…
- **S5** — GET /api/notas?clave= — la membresía se verifica en la ruta ANTES de consultar y es 403, no lista vacía (server/src/routes/notas.ts:127-128); el WHERE de la consulta usa `miLibretaPrivadaSql` o `eq(espacio_id)`, nunca un `eq()` pelado (server/src/notas/notas.…
- **S5** — GET /api/notas?q= — el filtro de visibilidad va en el `WHERE` con `visibleParaSql(quien)` (server/src/notas/notas.ts:315), la misma regla pura que el listado (server/src/espacios/visibilidad.ts:81 `puedeVer`). Buscar «precio» no devuelve la libreta privada de…
- **S5** — POST /api/notas — frontera también del lado de la escritura: `puedeEscribirEn(espacioId, quien)` antes del insert (server/src/routes/notas.ts:166-167). No se puede plantar una página en un espacio ajeno mandando un número en el body.
- **S5** — PATCH /api/notas/:id, /:id/archivar, /:id/desarchivar, /:id/mover — las cuatro pasan por `noPuedeTocar` → `puedeEditar` (server/src/notas/notas.ts:357, aplicado en :372, :419, :436) y mover exige los DOS permisos vía `planearMovimiento` (server/src/notas/nota…
- **S5** — GET /n/:token (la puerta anónima) — NO sirve nada de un chat. `leerPorToken` proyecta solo `titulo/texto/doc` y deja fuera `clave`, autora, espacio, fechas e id (server/src/espacios/linkRepositorio.ts:38-70); descarta lo que no tiene forma de token antes de t…
- **S5** — GET /api/notas/por-link/:token — devuelve la fila entera (server/src/notas/consultarNotaPorId.ts:29), pero eso es semántica de capability: el token es `randomBytes(16)` y el router está detrás de `requiereVendedora`. La proyección ancha vive acá y la recortad…
- **S5** — POST /api/espacios/:id/miembros, DELETE /:id/miembros/:v, PATCH /:id, PATCH /:id/archivar — las cuatro entran por `conPermisoDeAdmin` → `puedeAdministrar` (solo la creadora), con 404 y 403 distinguidos a propósito (server/src/routes/espacios.ts:110-124). Saca…
- **S5** — GET /api/espacios/ — `listarEspaciosDe` → `espaciosDe`, que filtra por `lower(btrim(vendedora_id)) = yo` y degrada a `[]` sin la migración, nunca a «todos» (server/src/espacios/repositorio.ts:43-48).
- **S5** — GET /api/padron/contactos y /facetas — ES una frontera de verdad y está bien puesta: el rol lo resuelve el SERVER con `mandaEnElEquipo(req)` (server/src/routes/padron.ts:130), nunca un query-param; para quien no manda `soloEstos` es SIEMPRE una lista (el tipo…
- **S5** — GET /api/padron/reparto, POST /habilitar, POST /habilitar-recorte, POST /quitar — 403 `no_es_supervisor` de entrada en las cuatro (server/src/routes/padron.ts:244, :263, :315, :378). La carga de las demás vendedoras NO se sirve a una vendedora normal, al revé…
- **S5** — GET /api/venta/formulario, /locales, /productos — catálogo y opciones de Cerberus resueltas con la sesión del PROPIO token (`req.vendedoraId!`, server/src/routes/venta.ts:34, :67, :78). No hay dato de conversación ajena.
- **S5** — GET /api/plantillas/ y GET /api/plantillas/cursos — `listarPlantillas` filtra por `visiblePara(vendedoraId)` = mías + las de alcance `equipo` + las propuestas del equipo (server/src/plantillas/repositorio.ts:172); `/cursos` es catálogo de Cerberus. PATCH /:id…
- **S5** — GET /api/hechos/catalogo, POST /, PUT /:clave, DELETE /:clave — catálogo global de frases de venta, sin dato de ninguna conversación (server/src/routes/hechos.ts:60, :97, :111, :130). Que cualquier vendedora lo edite es una decisión de producto declarada, no …
- **S5** — GET /api/correos/estado — solo dice si el SMTP está configurado y desde qué dirección (server/src/routes/correos.ts:45). Sin dato de nadie.
- **S5** — POST /api/categorias, PATCH /:id, DELETE /:id — el CRUD del catálogo filtra por `and(eq(id), eq(vendedoraId))` en el seam, así que un id ajeno da 404 y no toca nada (server/src/categorias/consultarCategorias.ts:127, :161). La fuga de este router está en el co…
- **S5** — GET /api/espacios/padron — sirve la lista de personas invitables (rueda ∪ `numero_vendedora`, 9 personas de la misma empresa) y NO un oráculo «¿existe Fulana?» (server/src/routes/espacios.ts:52). Es plantel, no dato de conversación.
- **S6** — auth/perimetro.ts — EL PERIMETRO ESTA BIEN CONSTRUIDO. Cerrado por defecto (perimetro.ts:57-63), tres excepciones enumeradas con su porque (perimetro.ts:22-26), compara en minusculas ANTES de decidir (perimetro.ts:40-42) asi que /API/conversaciones no lo esqu…
- **S6** — GET/PUT/DELETE /api/admin/numeros[/:numero] y sus tres de vinculacion — index.ts:181 monta requiereServicio para el router entero; auth/servicio.ts:52-57 compara en tiempo constante y falla cerrado, y auth/servicio.ts:19 impide arrancar en produccion sin el s…
- **S6** — GET /api/catalogo/piezas y /api/catalogo/vocabulario — routes/catalogo.ts:67 exige requiereServicioDeCatalogo, un secreto PROPIO (auth/servicio.ts:139-146): 503 si falta configuracion, 401 si el token es invalido, y un token de vendedora nunca lo satisface. M…
- **S6** — POST /api/auth/login — routes/auth.ts:66. Solo devuelve token + vendedora propia; la cascada vive pura en auth/loginCascada.ts; un fallo de base es 503 y no 401 (auth.ts:41-47), asi que no confunde config con credencial.
- **S6** — POST /api/auth/centurion — routes/auth.ts:120. Apagado salvo que exista CENTURION_SSO_SECRET (auth.ts:121-124) y rechaza con 403 a quien no tenga linea asignada (auth.ts:139-142). Es la unica puerta donde el fail-open de cola/lineas.ts se invierte a proposito…
- **S6** — GET /api/auth/yo — routes/auth.ts:159. Lleva requiereVendedora como handler propio pese a estar en PREFIJOS_ABIERTOS, y devuelve unicamente la identidad de quien pregunta.
- **S6** — GET y POST /webhook/whatsapp y /webhook/meta — webhook/ruta.ts:20,23,38,39. HMAC-SHA256 sobre los BYTES crudos (firma.ts:18-42), timingSafeEqual, hex estricto de 64 antes de decodificar (firma.ts:36 — cierra el 500 disparable sin credencial), fail-closed sin …
- **S6** — POST /webhook/landing/:token — webhook/landing.ts:36-40. timingSafeEqual contra LANDING_WEBHOOK_TOKEN y fail-closed sin secreto.
- **S6** — GET /n/:token — routes/publico.ts:36. La unica puerta anonima que sirve contenido y esta acotada bien: vive FUERA de /api a proposito, token de 128 bits aleatorios y nunca el id (espacios/link.ts:35-40), se descarta lo que no tiene forma de token ANTES de toc…
- **S6** — POST /api/ivi/preguntar — routes/ivi.ts:38. requiereVendedora explicito, el `usuario` sale del token y no del body (ivi.ts:48), topes de tamano (ivi.ts:26-27), y no lee NI UNA fila de conversaciones: reenvia solo lo que la vendedora tipeo. El IVI_SERVICE_TOKE…
- **S6** — GET /api/whatsapp/mi-linea, POST y DELETE /vincular, GET /vincular/estado (los de mi-linea) — routes/miLinea.ts:150 declara requiereVendedora aunque el perimetro ya lo exija, y el candado `pareoActual` filtra POR DUENO y con vigencia (miLinea.ts:295-303, regl…
- **S6** — /api/whatsapp/_sim y /api/whatsapp/_dev — index.ts:185-187 solo los monta fuera de produccion, y su exencion del perimetro tambien es solo-dev (perimetro.ts:29-35 y :45), asi que hay dos candados independientes. El unit versionado pone NODE_ENV=production (de…
- **S6** — requiereVendedora — auth/sesion.ts:32-42. HMAC-SHA256 con timingSafeEqual (sesion.ts:37-39), expiracion verificada (sesion.ts:42) y auth/sesion.ts:20 impide arrancar en produccion con el secreto de dev.
- **S6** — cargarRol — equipo/cargarRol.ts:65-84. No es una puerta (nunca responde 401) y no puede tumbar el proceso: el catch deja el rol sin resolver. `rolDe` es fail-closed a `vendedora` (cargarRol.ts:96), asi que un router montado suelto o un pedido con credencial d…
- **S6** — La forma del server — un solo express() y un solo listen (index.ts:75 y :204, verificado con git grep de express()/createServer/.listen en todo server/src): no hay un segundo servidor HTTP que esquive el perimetro. Y el fallback SPA excluye api/, webhook/ y v…
- **S6** — Los scripts (npm run campana, reparto:rueda, ventas:sincronizar, wa:vincular, etc.) no tienen puerta HTTP: `git grep -l child_process` sobre server/src en origin/main devuelve SOLO tres archivos de prueba y de migraciones (migraciones/adopcion.test.db.ts, pru…
- **S6** — Las herramientas agregadas del SDK — governa.lazo.* (sdk/herramientas/lazo.ts), governa.ventas.* (ventas.ts), governa.atribucion.roasPorPais (atribucion.ts), governa.historia.resumen (historia.ts:84) y governa.pauta.serie (historia.ts:119) devuelven conteos, …

---

## 5 · Lo que se reportó y NO es fuga

Los escépticos descartaron 24 hallazgos. Queda escrito para que nadie los vuelva a levantar y para
que se vea qué chequeo los salva.

- **S1** — POST /api/responder/:id y DELETE /api/responder/:id — NO violan ESTE invariante, y el propio auditor lo admite («lo reporto por completitud») pero igual lo cuenta entre las 14 fugas. Verifiqué el handler (routes/responder.ts:59-71): rechaza con 400 todo lo que no sea `tipo = 'comentario'`, y un comentario de FB/IG no es el chat de ninguna vendedora — no se reparte, no tiene dueña, y ADR 0042 midi…
- **S1** — GET /api/persona/:interactionId/link y GET /api/persona/:interactionId/puede-privado — no sirven contenido ni metadato de un chat. Leí los dos seams: `datosDelLink` (repositorioDePersona.ts:157) devuelve id, canal, page_id, permalink, external_id, contexto_id — ni texto, ni persona, ni teléfono — y para una fila de WhatsApp `page_id` es null, así que `tokenDePagina` no encuentra Página y la ruta …
- **S2** — NO descarto ninguna de las 20 rutas del informe: seguí las 20 cadenas hasta su SQL y en ninguna hay un chequeo de rol ni de dueño que el auditor no haya visto. Lo que sí corrijo son tres afirmaciones sobre TAMAÑO y MECANISMO, que es donde el informe se pasa de la evidencia. Van las tres abajo.
- **S2** — DESCARTO el mecanismo de fuga de la ficha en `GET /api/sugerencias?clave=` («la ficha ajena se filtra por el renderizado»). Es cierto que la ruta llama `ficha(telefono)` con el teléfono sacado de la clave (sugerencias.ts:38-41) y mete el nombre real en `vistaPrevia.texto`. Pero eso solo se materializa si `sugerirDos` devuelve al menos una plantilla, y `listarPlantillas(base, o.vendedoraId)` sirve…
- **S2** — DESCARTO el «volcado del padrón por fuerza bruta» y la gravedad crítica de `GET /api/gente/buscar` y `GET /api/gente/:id`. El auditor lo dejó anotado como no determinado y aun así lo puntuó crítica, que es afirmar el tamaño por la vía de la nota al pie. Verificable desde el código: `git grep 'INSERT INTO ontologia' -- server/src` da exactamente dos escritores de `ontologia.personas` — `ontologia/…
- **S2** — DESCARTO la descripción de `GET /api/gestiones/etiquetas` como «el inventario de conversaciones de las cinco vendedoras» y la de `GET /api/gestiones/etapas` como «TODAS las conversaciones con gestión». Las dos rutas fugan, y por el mecanismo exacto que el auditor identificó (el `[]` que el seam interpreta como «todas»). Pero las tablas `etiquetas` y `gestiones` solo tienen fila para las conversac…
- **S3** — NINGUNA de las tres fugas reportadas es falsa — las tres las reproduje leyendo el código. Lo que sí corrijo es el CONTEO: el hallazgo 2 (la cadena SSE → /conversacion/:telefono) no es un defecto propio de S3. El código que falla es `routes/whatsapp.ts:175-181`, que el brief ya daba por confirmado como fuga de otra superficie. Presentarlo como segunda fuga de S3 cuenta dos veces el mismo agujero d…
- **S3** — Corrijo un dato de contexto que el auditor da por hecho y NO está en el código: «la única línea viva es la de Cloud API 51984429504». Eso sale del CLAUDE.md y de la memoria, no de `origin/main` — qué línea corre lo deciden `WHATSAPP_TRANSPORTE`, `WHATSAPP_NUMEROS` y `WHATSAPP_CLOUD_API_NUMERO_PROPIO` en el `.env` de VPS1, que tengo prohibido tocar. No cambia el veredicto (la fuga es del código, n…
- **S3** — Corrijo una de las que marcó SANAS: `webhook/landing.ts:93` no es completamente inocuo. Emite `{tipo:'estado'}` al persistir un lead de landing, y eso empuja a todas las vendedoras conectadas la señal «acaba de entrar un lead» con su marca de tiempo. No identifica a nadie —por eso queda en `menor`— pero cae del lado del criterio 2 del brief, no del lado de «agregado no desagregable». Va en fugasN…
- **S4** — NINGUNA de las seis cayó. Intenté tumbar cada una siguiendo la cadena ruta → seam → SQL y buscando un chequeo río arriba o río abajo: no hay ninguno. Lo único delante de las seis es `perimetroApi` (`auth/perimetro.ts:56-62`), que valida identidad y no cuál — y `cargarRol` (`index.ts:94`) anota el rol pero no lo exige: ningún handler de estos seis lee `req.rolResuelto`. Lo que sí corrijo son sever…
- **S4** — CORRECCIÓN a la fuga 4 (`/api/resultados/piezas`): la frase «baja crudo al `AND e.vendedora_id = ${o.vendedoraId}`» se lee como inyección SQL y no lo es. Dentro de un template `sql` de drizzle eso es un parámetro bindeado (`consultarResultados.ts:21-23`). El defecto es de AUTORIZACIÓN, no de sanitización, y confundirlo hace que un lector desestime el hallazgo cuando el `psql` no reproduce nada.
- **S4** — MATIZ a la fuga 5 (`/api/leads`): su argumento —«el Dashboard le niega los formularios a la no supervisora»— no sostiene por sí solo la gravedad, porque la COLA hace lo contrario a propósito: `lineaAlcanzableSql` (`cola/asignadaSql.ts:272-283`) sirve a todas lo que tiene `numero_propio IS NULL`, y eso incluye los leads de formulario. Lo que sí la sostiene, y es lo que verifiqué, es (a) el ruteo p…
- **S4** — MATIZ a la fuga 6: la propia salvedad del auditor es la correcta y hay que dejarla escrita en el informe final para que no se sobre-reporte — `/api/overview/*` no sirve contenido de conversación ni revela de quién es ningún chat. Es un bypass de la frontera del Dashboard (ADR 0036), no del invariante de aislamiento de chats.
- **S4** — VERIFIQUÉ las «sanas» que más riesgo tenían de estar mal y aguantan: `consultarRadar` aplica el recorte DESPUÉS del UNION sobre las dos ramas (`cola/consultarRadar.ts:191`), no dentro de una mitad; `contarPorEtapaEfectiva` usa `soloMisClavesSql` sobre `todo.clave` (`consultarCola.ts:1505-1507`); las tres normalizaciones comparan `lower(btrim())` de LOS DOS lados (`personal.ts:109-111`, `asignadaS…
- **S5** — NINGUNA de las 8 fugas del informe resultó falsa. Seguí las 8 cadenas completas hasta el SQL y en ninguna encontré un chequeo de rol o de dueño que el auditor no hubiera visto. Lo que sí corregí son tres sub-afirmaciones dentro de fugas reales, que van detalladas en `confirmadas` y se resumen acá abajo — un informe con precisión de más también se deja de leer.
- **S5** — SOBRE-AFIRMACIÓN en la fuga crítica de `PUT /api/reparto/asignacion`: «la única validación es que el destino esté en la rueda, que es precisamente lo que la atacante cumple al asignarse a sí misma» es demasiado ancho. `esDestinoValido` (routes/reparto.ts:130) exige estar en `reparto_rueda` de ESA línea o en `numero_vendedora` de esa línea; una vendedora fuera de la rueda come 409 al auto-asignars…
- **S5** — SOBRE-AFIRMACIÓN en `GET /api/categorias`: «basta crear una categoría con el nombre exacto que usa otra vendedora para obtener, DIRIGIDO, cuántas conversaciones tiene ELLA etiquetadas así» es incorrecto. El subquery agrupa solo por `lower(etiqueta)`, así que devuelve la unión del equipo para ese rótulo, no el número de una persona. Es un agregado de equipo probeable a demanda, no un contador per-…
- **S5** — SUB-GRADUACIÓN en `GET /api/reparto/rueda`: `menor` es demasiado suave. El propio informe cita que «cuántas tiene otra vendedora» cuenta como fuga de metadato, y además esta ruta entrega los `vendedoraId` que hacen pasar la validación del PUT crítico. La subo a `seria` y agrego el argumento decisivo que el auditor no usó: la MISMA consulta (`cargaPorVendedora`) sí está protegida con 403 `no_es_su…
- **S5** — RESUELVO dos de los `noPudeDeterminar` a favor del código, o sea que NO son fugas: (a) `nombreSeguro` (whatsapp/mediaDir.ts:26) es lista BLANCA (`replace(/[^A-Za-z0-9._-]/g,'_')` + `slice(0,120)`), así que `POST /api/plantillas/media` no tiene traversal; y el nombre final es `tpl-<Date.now()>-<nombre>`, o sea que tampoco puede pisar un adjunto de WhatsApp ya guardado. (b) `POST /api/plantillas/:i…
- **S5** — VERIFIQUÉ las 17 declaraciones de `sanas` una por una y todas se sostienen. Las dos que más desconfianza merecían: `GET /api/notas?clave=` mezcla las notas históricas de `gestiones`, y `listarNotasHistoricas` (notas/notas.ts:184-195) SÍ filtra con `mismaVendedoraEnSql(gestiones.vendedoraId, …)` — normalizando los dos lados con `lower(btrim(...))`; y el recorte del padrón para quien no manda es `s…
- **S6** — `POST /api/sdk/invocar/governa.historia.deVenta` como fuga de PII — NO LO ES, y la incógnita que el auditor declaró («no leí ontologia/derivarHechos.ts») se resuelve leyéndolo. El `payload` crudo de `ontologia.hechos` que la herramienta devuelve sin proyectar lo arma únicamente `ontologia/derivarHechos.ts` en tres lugares: `deVenta` (línea 84) escribe `{folio, montoTotal, codigoMoneda, codigoClie…
- **S6** — El MECANISMO con que el auditor justificó la gravedad de la fuga 1 — «escaneándolo desde su propio teléfono queda como DISPOSITIVO VINCULADO de esa línea: ve TODAS las conversaciones de esa vendedora, pasadas y futuras». Eso está al revés. El QR de `getQRChannel()` (`whatsapp/vinculador.ts:105`) es la solicitud de pareo del CLIENTE whatsmeow que corre en el server; quien lo escanea autoriza a ese…
- **S6** — El `|` dentro del `vendedoraId` como fuga (el auditor ya lo había dejado como endurecimiento; lo confirmo y explico por qué no sube). `firmarSesion` (`auth/sesion.ts:24`) arma `${vendedoraId}|${expira}` y `verificarSesion` (`auth/sesion.ts:41`) parte por `|` tomando [0] y [1], sin exigir dos partes: un username `alan|9999999999999` daría un token que se lee como `alan` con expiración eterna. Pero…
- **S6** — `/n/:token` como vector de XSS — lo revisé YO porque el riesgo, si existiera, sería peor de lo que el auditor evaluó: `hermes-api.goberna.us` sirve la SPA y `/n/` desde el MISMO origen (`index.ts:196`), así que un script inyectado en la página pública leería el `localStorage` donde vive el Bearer de quien abra el link. No existe: `espacios/paginaPublica.ts` escapa `&`, `<`, `>` y `"` en `escapar(…

---

## 6 · Lo que esta auditoría NO cubrió

Honestidad sobre el alcance. Lo de acá abajo **no se miró o no se pudo determinar**, así que no se
puede afirmar que esté sano.

- **S1** — Lo que SÍ verifiqué leyendo código, hasta el SQL: las 22 rutas de los 6 routers del auditor; los seams hilo.ts, repositorioDePersona.ts, interacciones/consultas.ts, envioControlado.ts, enviarYProyectar.ts, reacciones/enviar.ts, ediciones/editar.ts, realtime/bus.ts; los tres transportes (para saber qué muerde hoy con Cloud API); el perímetro (`auth/perimetro.ts`, sano: cerrado por defecto, compara en minúsculas, exenciones de dev solo fuera de prod); y la frontera de la cola completa — confirmo …
- **S2** — Leí enteros los 8 archivos de ruta (`contactos.ts`, `gente.ts`, `eventos.ts`, `gestiones.ts`, `enlaces.ts`, `senales.ts`, `sugerencias.ts`, `persona.ts`) y seguí las 30 rutas hasta su SQL, abriendo estos seams: `cerberus/ficha.ts`, `gente/leadDeTelefono.ts`, `gente/repositorioDePersona.ts` (completo), `canales/persona360.ts`, `eventos/registrarEvento.ts`, `gestiones/bitacoraComercial.ts`, `gestiones/intereses.ts`, `gestiones/registrarInteres.ts`, `gestiones/registrarGestion.ts`, `cursos/confirm…
- **S3** — Lo que SÍ miré, archivo por archivo contra `origin/main` (`1cb683a`): `routes/stream.ts` entero · `realtime/bus.ts` entero · los 5 sitios de emisión (`whatsapp/repositorioDrizzle.ts:59-65`, `whatsapp/wiring.ts:125/145/159`, `webhook/landing.ts:93`) · el camino completo de la línea de Cloud API hasta el emisor (`webhook/whatsapp.ts` → `transporteCloudApi.ts:324-341` → `ingesta.ts` → `repositorioDrizzle`) · `auth/perimetro.ts` y `auth/sesion.ts` completos · `equipo/cargarRol.ts` y el orden de mon…
- **S4** — Leí completos, contra `origin/main` (1cb683a): `routes/{overview,dashboard,conversaciones,interactions,resultados,leads,decisions,config,structure,sdk,gestiones,senales}.ts` y los seams que listé en «superficie». Todos los hallazgos, propios y ajenos, los reproduje siguiendo la cadena ruta → seam → SQL; ninguno es inferencia. QUÉ QUEDÓ SIN MIRAR, honestamente: 1. **No consulté producción** (prohibido). O sea que ninguna fuga tiene VOLUMEN medido. En particular no sé cuántas filas tienen hoy `ge…
- **S5** — Leí las 55 rutas de los 11 routers de S5 y bajé hasta el SQL en todas. Lo que hay que saber de la cobertura del informe que revisé: `rutasRevisadas: 55` está inflado — el auditor NOMBRA 49. Seis nunca aparecen ni en `sanas` ni en `fugas`: `POST /api/notas/:id/link`, `DELETE /api/notas/:id/link`, `POST /api/espacios/`, `POST /api/plantillas/media`, `POST /api/plantillas/:id/aprobar` y `POST /api/correos/enviar`. Las abrí las seis: las cinco primeras están sanas (los dos de link pasan por `puedeE…
- **S6** — Leí YO, línea por línea y contra `origin/main`: `auth/perimetro.ts`, `auth/sesion.ts`, `auth/servicio.ts`, `equipo/cargarRol.ts`, `index.ts` entero (montajes, orden, estático, fallback SPA), `routes/vincular.ts`, `whatsapp/vinculador.ts`, `routes/miLinea.ts`, `numeros/miLineaCableado.ts`, `routes/admin.ts`, `routes/catalogo.ts`, `routes/auth.ts`, `routes/publico.ts`, `espacios/paginaPublica.ts`, `espacios/link.ts` (cabeceras), `webhook/ruta.ts`, `webhook/firma.ts`, `webhook/cerberus.ts`, `webho…

⚠️ Además, por diseño de la corrida:

- **No se ejecutó nada contra producción** (salvo las tres comprobaciones de §0.3, que son `GET` sin
  credencial). Todo lo demás se decidió **leyendo el código** de `origin/main`.
- **No se probó con tokens reales de dos vendedoras.** Cada fuga está verificada por lectura de la
  cadena ruta → seam → SQL, no por explotación. **La verificación empírica es el siguiente paso**, y es
  barata: dos tokens y `curl`.
- **El front no se auditó**, a propósito: un recorte en el navegador no es una frontera. Si el server
  manda de más, ya es fuga.

---

## 7 · El plan para cerrarlo

### 7.1 · Lo que NO hay que hacer

**Parchear las ~40 rutas una por una.** Así se llegó acá: cada frente puso su propio recorte donde se
acordó. Un predicado repetido cuarenta veces diverge — es #37, la cicatriz más repetida de este repo,
a escala.

### 7.2 · La forma que sí

**Una guarda de conversación, en un solo lugar, que se pida explícitamente.**

1. **Un seam único**: `puedeVerConversacion(rol, vendedoraId, clave) → boolean`, puro, con su gemelo
   SQL, y su test de paridad cruzando los dos — el patrón que el repo ya usa en `cola/ventana.ts`,
   `entrega/dominio.ts` y `espacios/visibilidad.ts`.
2. **Fail-closed y por defecto**: un middleware que exija la guarda a toda ruta que reciba `clave`,
   `telefono` o `personaId`, y que **rompa el arranque** si una ruta nueva no la declara. Lo que no se
   declara, no se sirve. Es lo contrario del modelo de hoy, donde lo que no se acuerda queda abierto.
3. **Normalizar los DOS lados** en cada comparación de identidad (`Luz` vs `luz`). Es la cicatriz que
   más veces mordió, y en una frontera **falla hacia ABIERTO**.
4. **Empezar por decidir §0.2**: si «su supervisor» es una persona concreta, la firma de la guarda
   cambia. Decidirlo después obliga a tocar los ~40 lugares dos veces.

### 7.3 · El orden, por lo que más expone

| # | Qué | Por qué primero |
|---|---|---|
| **1** | `GET /api/stream` — filtrar por dueño, o degradar el payload a «algo cambió» sin teléfono | Es continuo, silencioso, y **alimenta a las otras dos**. Cortarlo solo ya rompe la cadena de §0.4 |
| **2** | `/vincular` — borrarlo o cerrarlo, y versionar la regla de nginx | Es la única con impacto **irreversible**: quien lea el QR se queda con la sesión de WhatsApp |
| **3** | El hilo y las personas (`C1`, `C2`, `C3`) | Es el contenido, y `C3` es **enumerable** |
| **4** | La guarda única de §7.2 sobre el resto | Lo demás cae solo cuando existe el seam |

### 7.4 · Cómo se verifica que quedó cerrado

**No alcanza con leer el código.** El candado tiene que ser un test que se ponga rojo:

```bash
# Un test con base por cada superficie: sembrar dos vendedoras con una conversación
# cada una, pedir con el token de A la conversación de B, y exigir 403/404.
cd server && npm run test:db
```

Y la prueba empírica, contra staging (nunca producción):

```bash
# Con dos tokens reales, la conversación de la otra tiene que dar 403/404 — no 200.
curl -H "Authorization: Bearer $TOKEN_A" ".../api/whatsapp/conversacion/<telefono-de-B>"
curl -N -H "Authorization: Bearer $TOKEN_A" ".../api/stream"   # no debe llegar nada de B
```

---

## 8 · Cómo se rehace esta auditoría

Está automatizada y es reproducible: seis auditores en paralelo + un escéptico por superficie que
intenta refutar cada hallazgo y busca lo que se le pasó.

- El script: `scratchpad/wf-auditoria-aislamiento.js` de la sesión del 17-ago-2026.
- Las seis superficies: **S1** el hilo y el contenido · **S2** la ficha, el timeline y la identidad ·
  **S3** tiempo real · **S4** dashboard y agregados · **S5** agenda, notas, correos, padrón, reparto ·
  **S6** el perímetro, las credenciales de servicio y los scripts.
- El modelo de amenaza que hay que conservar: **el atacante es otra vendedora del equipo con su token
  legítimo y devtools abiertas**, no un extraño. Y **un recorte en el navegador no cuenta**.

⚠️ **Lo que esta corrida enseñó sobre el método**: los auditores tenían prohibido tocar producción, y
por eso reportaron `/vincular/estado` como fuga crítica alcanzable desde internet. **Lo es en el
código y no lo es en producción** — nginx la tapa. La lección no es que se equivocaran: es que
**leer el código da la superficie y sólo el sistema vivo da el alcance**, y hacen falta los dos.
