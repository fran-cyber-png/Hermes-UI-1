# Plan — Hermes como WhatsApp Business potenciado

> Síntesis de 5 diseños en paralelo, verificada contra el código (2026-07-22).

mmary": "DiseÃ±a el salto de Hermes a Â«WhatsApp Business potenciadoÂ»: filtros nuevos, pin, categorÃ­as con color, templates con /, notas, correo en el chat, multi-nÃºmero y tests reales",
  "agentCount": 6,
  "logs": [],
  "result": "Citations grounded. `correos.clave` exists (schema.ts:396) with no `clave` index (only :402). Urgencia is genuinely 6 levels (urgencia.ts:64-105) vs the SQL's 4 (conversaciones.ts:128) â even the SQL's own header comment says "dos niveles" (:20-22), extra proof of drift. `/api/venta/productos` already has `requiereVendedora` (venta.ts:28) but its mapping (:40-41) returns no moneda. Synthesizing now.

---

# Hermes potenciado â un solo plan

## 1 Â· La tesis, en 5 lÃ­neas

Hermes pasa de "una cola de WhatsApp con ficha al lado" a **la mesa de trabajo completa de una vendedora**: atiende, responde con texto guardado (Respuesta rÃ¡pida por `/`), manda el correo **sin salir del hilo**, anota como en un Notion a una tecla, prioriza con una cola estilo WhatsApp Business (fijar, no-leÃ­do, favoritos, categorÃ­as) y, cuando se decida, ve tambiÃ©n Facebook/Instagram/Messenger â todo contra Cerberus, todo con evidencia.
Lo que **NO** es: no es un enviador masivo, no es un automatizador (nada sale solo: un envÃ­o = una acciÃ³n humana), no es multi-bandeja privada (sigue siendo *una sola pantalla*), y **la ConversaciÃ³n sigue siendo por un canal** â el correo entra como *contexto*, no como mensaje del hilo.
El norte de Estephano âÂ«WhatsApp Business potenciadoÂ» y Â«todo ahÃ­ para vender sin salirÂ»â se cumple profundizando la herramienta de la vendedora que ya trabaja a diario, no ensanchando canales primero.

---

## 2 Â· Las decisiones que tenÃ©s que tomar

**D1 â Â¿Profundizar WhatsApp o ensanchar canales primero?**
Recomiendo **profundizar**: composer + correo-en-el-chat + notas + cola potenciada. La Ãºnica vendedora usa WhatsApp todos los dÃ­as; eso le da valor maÃ±ana. *Costo de la alternativa (FB/IG primero):* ingesta de ~330 mil filas con PII real sobre una API con la auth partida (Â§8.1), y destapa un bug de producto âlos 24 h de Messenger no estÃ¡n en la cola, asÃ­ que la vendedora abrirÃ­a ~100 conversaciones para descubrir que 95 estÃ¡n muertas (`interactionsIngestor.ts` barre historial completo; `conversaciones.ts:130` mete todo <24 h en nivel vivo). Alto valor, pero pesado y riesgoso: va despuÃ©s.

**D2 â #37 (urgencia duplicada): Â¿test de paridad (B) ahora, o Ãºnica fuente en TS (A) ya?**
Recomiendo **B ahora**, extrayendo el SQL a `consultarCola(db)`/`consultarRadar(db)` y un test que corre los 6 casos contra las dos implementaciones. Hoy `urgencia.ts:64-105` tiene 6 niveles y el SQL de `conversaciones.ts:128` tiene 4 renumerados â divergencia real, verde en CI. *Costo de A (unificar en TS ya):* la cola pagina en la base (perf de #30, regresiÃ³n ya pagada en `a662b28`/`6335bd6`); traer todo a memoria para ordenar en TS la rompe. A es el norte, pero solo despuÃ©s de que el harness exista.

**D3 â Â¿NÃºmero de WhatsApp por vendedora (propÃ³sito `vendedora`)?**
Recomiendo **NO en el primer corte**. `conversaciones.ts` no filtra por vendedora en ningÃºn lado; un nÃºmero personal mete reparto de leads por la puerta trasera. *Costo de habilitarlo:* convierte el CRM en N bandejas privadas â lo contrario de Â«una sola pantallaÂ». Si lo querÃ©s, la pregunta real no es de canales, es **Â«Â¿los leads se reparten, con quÃ© regla?Â»** â otro frente. Los propÃ³sitos `escuela` (default de hoy, no cambia nada) y `campana` (filtro de cola) sÃ­ entran.

**D4 â El correo: Â¿vuelve multicanal el hilo, o entra como "Marca"?**
Recomiendo **Marca** (contexto en el hilo, no mensaje). *Costo de multicanal:* rompe Deuda/Silencio (CONTEXT.md) â un correo contarÃ­a como "Ãºltimo mensaje nuestro" y **una Deuda de WhatsApp se volverÃ­a Silencio en silencio**, la conversaciÃ³n baja en la cola y la persona que esperaba por WhatsApp deja de verse; y cambia la forma de la clave `conv:<canal>:...` de la que cuelgan etiquetas, intereses, gestiones y recordatorios. La ConversaciÃ³n **se queda "por un canal"**.

**D5 â Notas: Â¿editables (rompe el append-only de la casa) o append-only?**
Recomiendo **editables por su autora**, con `editado_at` visible. `events`/`gestiones` son append-only porque *algo se deriva de la secuencia* (la etapa actual = la Ãºltima fila, `schema.ts:305-310`); de una nota **no se deriva nada**. *Costo de append-only:* typos eternos y un panel lleno de Â«perdÃ³n, era el viernesÂ».

**D6 â La cola: Â¿el default pasa de `puedo-escribirle` a `Todo`, con tabs que reemplazan los filtros?**
Recomiendo **sÃ­**: tabs `Todo Â· No leÃ­dos Â· Favoritos` + chips de categorÃ­as favoritas + smart-filters derivados (`Piden info`, `Por vencer`). NingÃºn concepto viejo se tira: `puedo-escribirle` â smart-filter "Por vencer" + el chip dorado de Ventana que ya se pinta por fila (`FilaConversacion.tsx:119-124`); `pide-info` â "Piden info" (regex intacto, `conversaciones.ts:27`). *Costo/trampa:* si el default de `useLocalStorage('hermes.colaFiltro')` (`ColaUnificada.tsx:61`) y el cachÃ© persistido no coinciden, la app abre mostrando la pÃ¡gina cacheada de otro filtro. Y hay que **re-apuntar el vacÃ­o** Â«EstÃ¡s al dÃ­aÂ» (`ColaUnificada.tsx:339-375`, hoy atado a `puedo-escribirle`) al concepto cero-Deuda.

---

## 3 Â· El modelo de datos, completo

### Tablas nuevas

**`estado_conversacion`** â todo lo personal de la vendedora en una fila (un solo LEFT JOIN en la consulta caliente):

| columna | tipo | nota |
|---|---|---|
| `vendedora_id` | text | keyea lo personal, como `recordatorios`/`gestiones` |
| `clave` | text | `conv:â¦`/`int:â¦`/`lead:â¦` |
| `fijada` | boolean default false | pin (tope 3) |
| `fijada_at` | timestamptz null | orden/tope del pin |
| `favorita` | boolean default false | filtro "Favoritos" |
| `leido_hasta` | timestamptz null | **cursor** de lectura |
| `updated_at` | timestamptz | |

`unique(vendedora_id, clave)`; index `(vendedora_id, fijada)` y `(vendedora_id, favorita)`.

**`categorias`** â catÃ¡logo compartido (sube `etiquetas` de nivel): `nombre` (unique, es la clave de join), `color` (enum de **paleta fija sin oro**), `es_favorito` (bool â chip en la barra), `orden` (int), `origen` (`'sistema'|'equipo'`), `creado_por`, `creado_at`. Seed `origen='sistema'`: interesada / precio / reclamo.

**`respuestas_rapidas`** â texto del equipo para el composer: `id`, `atajo` (`^[a-z0-9-]{1,24}$`), `titulo`, `cuerpo` (vars `{nombre}{curso}{precio}`), `canal` (null=ambos / `'correo'`), `asunto` (solo correo), `curso_sku` (**ata a un producto de Cerberus; sin esto no hay `{precio}`**), `vendedora_id` (autorÃ­a), `usos` (int default 0), `archivado_at` (null=viva), `creado_at`, `actualizado_at`. `uniqueIndex(atajo) where archivado_at is null`; `index(archivado_at, usos)`.

**`notas`** â nota con ancla: `id`, `clave` (conversaciÃ³n o `'general'`=libreta), `vendedora_id` (autora), `texto` (â¤2.000 tras trim), `fijada` (bool), `creado_at`, `editado_at` (null=nunca), `archivado_at` (null=viva). Index `(clave, creado_at desc)`, `(vendedora_id, creado_at desc)`, **GIN `to_tsvector('spanish', texto)`** (a mano: drizzle-kit no genera GIN; documentar en `docs/deploy-vps1.md`; si falta, degrada a seq scan, no revienta).

**`numeros_wa`** â quÃ© nÃºmeros existen y quÃ© significan (NO credenciales; la sesiÃ³n sigue en `server/.wa-sessions/<numero>.db`): `numero` PK (normalizado), `etiqueta`, `proposito` (`'escuela'|'campana'|'vendedora'`), `vendedora_id` (null salvo `vendedora`), `referencia` (null salvo `campana`), `activo`, `creado_at`, `vinculado_at`. â¤10 filas, sin Ã­ndices. Fallback de arranque: si estÃ¡ vacÃ­a, se usa `WHATSAPP_NUMERO` (VPS1 levanta sin tocar nada).

### Columnas nuevas sobre tablas existentes

- `correos.respuesta_id` (nullable) y `envios_wa.respuesta_id` (nullable) â auditorÃ­a: cuÃ¡nto de lo enviado saliÃ³ de una Respuesta rÃ¡pida y cuÃ¡l. Suma un campo a `OrdenEnvio` (`envioControlado.ts:22-32`) â **sigue siendo un destinatario por orden**.
- `correos_clave_idx` sobre `(clave, creado_at)` â hoy el Ãºnico Ã­ndice de `correos` es `(vendedora_id, creado_at)` (`schema.ts:402`).
- (FB/IG, fase tardÃ­a) Ã­ndice candidato `(tipo, occurred_at)` sobre `interactions`, medido con `EXPLAIN ANALYZE` antes/despuÃ©s en VPS1.
- **`correos.clave` ya existe** (`schema.ts:396`) â no se crea, se **cablea** (hoy `VistaCorreos.tsx:91` manda `{para,asunto,cuerpo}` sin `clave`, asÃ­ que todo correo es huÃ©rfano).

### Lo que se DERIVA, no se guarda (la casa deriva lo derivable)

- **`no_leido`** = `max(occurred_at entrante) > leido_hasta`. Lo que se persiste es el **cursor** (un hecho: cuÃ¡ndo abriÃ³), no la conclusiÃ³n. Distinto de `respondida` (existe leÃ­da-sin-responder). El cursor lo avanza abrir el hilo (`conversacionWa.ts:64`, cross-canal); los ticks azules siguen siendo efecto lateral aparte.
- **`{precio}`** = `/api/venta/productos` con `curso_sku`, **en vivo en el instante de expandir** (`venta.ts:28-43`). El cuerpo guardado **nunca** contiene un nÃºmero â el problema de "actualizar todas las plantillas al subir el precio" **deja de existir**. Si Cerberus no responde: hueco `[precio]`, **jamÃ¡s un nÃºmero cacheado ni cero** (`precioNormal===0` = no verificable; Cerberus devuelve 0 cuando falta, `venta.ts:40`).
- `respondida`, `pide_info`, `ventana_abierta`, `nivel` de urgencia, la etapa del embudo â ya derivados hoy.
- `por-vencer` / `piden-info` â clÃ¡usulas WHERE computadas, no estado guardado (seguras frente a #37: filtran, no reordenan).

---

## 4 Â· Orden de ejecuciÃ³n (fases que entregan valor solas)

> **CD/botÃ³n**: el front se despliega solo al mergear a `main`; el server va por botÃ³n (verificado hoy). Marcado por fase.

**Fase 0 â Cimientos (SERVER + CI Â· botÃ³n).** *Enablers, no valor de usuario, pero desbloquean todo.*
- **Cerrar #36 (auth partida)** en `/api/conversaciones`, `/api/persona/*`, `/api/whatsapp/conversacion`, `/api/whatsapp/media`. Barato. **Prerequisito de la Fase 3 (pin/no-leÃ­do por vendedora) y de la Fase 5 (backfill FB/IG).**
- **Harness de tests #33** (DiseÃ±o 5): `docker-compose.test.yml` (pgvector, puerto **5439**, tmpfs), template (`createdb` â `CREATE EXTENSION vector` â `drizzle-kit push --force`, en ese orden exacto â sin la extensiÃ³n, push muere en `rag.documentos`), base-por-archivo, **guardia hard-fail anti-prod** (`:5438`/`hermes_db`/`meta_escuela`), `sembrar.ts`, job separado en `ci.yml`.
- **Con el harness: cerrar #37 y #38 juntos** (comparten el seam). Extraer `consultarCola(db)`/`consultarRadar(db)`; test de paridad de 6 niveles (#37 opciÃ³n B); JOIN a `recordatorios` en el radar + `seguimientoEn` en `FilaRadar` (`cola/radar.ts:32`) para que **VENCIDO llegue** (#38). *Depende de #33; resuelve #37 y #38.*

**Fase 1 â El composer potenciado (SERVER + FRONT Â· botÃ³n, luego CD).** *El golpe mÃ¡s directo a Â«todo ahÃ­ para venderÂ».*
- Server: `respuestas_rapidas`, `GET/POST/PATCH/DELETE /api/respuestas`, `POST /api/respuestas/:id/expandir {clave}` (una clave, no lista); cablear `correos.clave`, `GET /api/correos?clave=`, `correos_clave_idx`, `correos.respuesta_id`/`envios_wa.respuesta_id`.
- Front: menÃº `/` (frontera de palabra; `Enter` con menÃº abierto **inserta, no envÃ­a**), composer de correo en el footer (segmentado `WhatsApp | Correo`, mismo textarea, mismo `/`), "Marca" de correo en el hilo (fila centrada estilo `SeparadorDia`, `HiloWhatsapp.tsx:60-66`, sin oro, nunca a la derecha).
- **PrecondiciÃ³n barata (verificar antes de escribir cÃ³digo):** que `/api/venta/productos` devuelva **moneda** (hoy el mapeo `venta.ts:40-41` no la trae â un `{precio}` sin moneda en LATAM es una bomba), y que `Ficha.correo` venga poblado en prod (si casi nunca, el composer de correo arranca muerto).

**Fase 2 â Notas / Â«el Notion a una teclaÂ» (SERVER + FRONT Â· botÃ³n, luego CD).**
- Server: `notas`, GIN, `/api/notas` (auth desde la 2Âª lÃ­nea), backfill de `gestiones.notas` no-autogeneradas.
- Front: caja de notas en el aside de Mensajes (reemplaza el campo `notas` de `RegistrarGestion`), cajÃ³n Â«Tu libretaÂ» con tecla `n` (agregar a `ATAJOS`), badge de conteo neutro (jamÃ¡s dorado) en fila y tarjeta de Pipeline.

**Fase 3 â La cola potenciada (SERVER + FRONT Â· botÃ³n, luego CD). Depende de #36 y #37 (Fase 0).**
- Server: `estado_conversacion`, `categorias`, endpoints de fijar/favorita/leÃ­do/no-leÃ­do/categorÃ­as, `ORDER BY fijada DESC, nivel ASC, orden ASC` (banda de pin **sobre** los 6 niveles ya en paridad â por eso #37 es precondiciÃ³n), backfill `etiquetas`â`categorias`.
- Front: tabs + chips + secciÃ³n fija de pin + indicadores de fila (punto azul, estrella, pÃ­ldora de categorÃ­a con **borde de color, nunca sombra**, sin oro; no en la banda lateral que es temperatura, `FilaConversacion.tsx:94`).
- *Slice front-only que puede adelantarse por CD:* reorganizar la barra en tabs + smart-filters `Piden info`/`Por vencer` que angostan las filas ya cargadas (mismo patrÃ³n que la bÃºsqueda, `ColaUnificada.tsx:71-78`). Es mÃ¡s superficial que la versiÃ³n server-backed, pero da mejora visible sin esperar el botÃ³n.

**Fase 4 â Multi-nÃºmero (SERVER + FRONT Â· botÃ³n, luego CD).**
- Guarda #0 en `EnvioControlado` (`orden.numeroPropio === this.numeroPropio`, rechazo **sin registrar**), `GestorWhatsapp` reemplaza `whatsapp()` (`wiring.ts:67`, con fallback a `WHATSAPP_NUMERO`), `numeros_wa`, `GET /api/whatsapp/numeros`, `?numeroPropio=` en conversaciÃ³n/cola, **arreglo del bug de mezcla de hilos** (`whatsapp.ts:28-40`, latente con 1 nÃºmero), vinculaciÃ³n con candado. Extraer `claveDeConversacion()` puro (mata la duplicaciÃ³n `App.tsx:224`/`ColaUnificada.tsx:160`). **PropÃ³sito `vendedora` OFF** (D3).

**Fase 5 â FB/IG visibles (SERVER Â· botÃ³n + trabajo de operador). Depende de #36 (Fase 0).**
- Ingestor incremental (`desde: Date`, `since` en cada llamada) + `proyeccionesDe()` pura; **la ventana de 24 h de Messenger** en `CONTEXT.md`, en la capa de urgencia unificada (no un 5Âº nivel a mano en el SQL) y en la fila; paginar `/api/persona/conv`; **backfill manual y medido** una vez en VPS1 (`EXPLAIN ANALYZE` antes/despuÃ©s); reloj **apagado por default**, 15 min, corrida inicial con jitter, `emitirRT`; webhook `webhook/meta.ts` **con firma verificada** (`webhook/firma.ts`, que hoy nadie usa, Â§8.5).

---

## 5 Â· QuÃ© se tira o cambia (con ADR)

- **`RegistrarGestion.tsx`** â se le retira el campo `notas` (lo reemplaza la caja de notas). Anotar deja de **exigir mover el embudo** (hoy `guardar()` manda `etapa: etapaActual ?? 'interesado'`, `RegistrarGestion.tsx:105`, y ensucia una tabla append-only). Queda solo Â«prÃ³xima acciÃ³nÂ» y es **candidato a archivo** porque `AgendarRapido` (`BarraGestion.tsx:108`) lo hace en dos toques. **ADR** (regla dura #3).
- **`etiquetas`** (`schema.ts:344`) â **se conserva** como tabla de asignaciÃ³n; su identidad-por-string sube de nivel con `categorias`; backfill de huÃ©rfanas a catÃ¡logo con color neutro. **ADR corto** de quÃ© reemplaza.
- **`whatsapp()` singleton** (`wiring.ts:29,67`) â reemplazado por `GestorWhatsapp`; `/sesion` queda como alias del primer nÃºmero o se borra (un solo consumidor, `conversacionWa.ts:37`). **ADR.**
- **`gestiones.notas`** â se queda (historial) pero la UI **deja de escribirle**.
- **SQL inline de radar/cola** (`dashboard.ts:24-127`, `conversaciones.ts:147`) â se extrae a `consultarRadar(db)`/`consultarCola(db)` (habilita test y es el rumbo de #37).
- **Los 3 filtros de la cola** (`ColaUnificada.tsx:17-21`) â no se tiran; se reencarnan como tabs + smart-filters (D6).

**CONTEXT.md â cambios de glosario, explÃ­citos:**
- **NUEVO â Respuesta rÃ¡pida:** texto que el equipo guardÃ³; se **inserta** en el composer y siempre se edita antes de enviar; no se manda sola. *Evitar:* plantilla, macro, campaÃ±a, secuencia.
- **NUEVO â Marca:** un hecho que pasÃ³ dentro del tiempo de la conversaciÃ³n pero no es un mensaje del canal (correo, llamada, venta). Se dibuja en el hilo como contexto pero **no cambia de quiÃ©n es el turno**: no salda Deuda, no empieza Silencio, no cuenta para Enfriamiento. *Evitar:* mensaje, evento.
- **NUEVO â Ventana de Messenger (24 h):** plazo del canal Messenger, **distinto** de la Ventana de 7 dÃ­as de comentarios. Solo relevante cuando entre FB/IG (Fase 5).
- **PRESERVADO â ConversaciÃ³n:** sigue siendo Â«por un canal y un nÃºmero propioÂ». **NO se vuelve multicanal** (D4). DecisiÃ³n explÃ­cita: el correo es Marca, no canal del hilo.
- **AclaraciÃ³n â "no leÃ­do":** estado personal derivado de un cursor de lectura, **distinto de `respondida`** (una conversaciÃ³n puede estar leÃ­da-sin-responder).

---

## 6 Â· QuÃ© NO hacer (las trampas)

- **Nada que itere transportes ni destinatarios:** no `enviarMasivo`, no mÃ©todo del gestor que devuelva la lista iterable, no selecciÃ³n mÃºltiple en la cola, no Â«mandÃ¡ a los de la etiqueta *precio*Â». La firma `expandir({clave})` y `EnvioControlado` de a uno **son** el guardarraÃ­l (`transporte.ts:16-22`).
- **No `recordatorios.respuesta_id`** (Â«al vencer, deja la respuesta listaÂ»): un texto precargado a un Enter de salir deja de ser una decisiÃ³n. Fuera de v1, por escrito.
- **No secuencias, drips, autorespuesta, saludo automÃ¡tico ni Â«escribiendoâ¦Â» simulado.**
- **No `{precio}` de ningÃºn lado que no sea Cerberus en el instante**, ni cacheado ni cero. Expandir en el server, no en el front (el cachÃ© se rehidrata de IndexedDB con precio de ayer, ADR 0007).
- **La nota no tiene botÃ³n Â«EnviarÂ».** Si se confunde con Respuesta rÃ¡pida, la libreta se vuelve un enviador y rompe Â«un envÃ­o = una acciÃ³n humanaÂ».
- **No cachear notas en IndexedDB** (una nota Â«paga el viernesÂ» leÃ­da como actual es peor que un spinner). Y **los emojis SÃ pasan en notas** â la regla latin1 #4 NO aplica (una nota nunca va a Cerberus); no Â«endurecerÂ» por analogÃ­a.
- **No opciÃ³n A de #37 ahora** (rompe la perf de #30). No agregar la banda de pin al SQL **sin** cerrar #37 primero (metÃ©s una divergencia mÃ¡s a mano).
- **No hacer el backfill de FB/IG antes de cerrar #36** ni antes de arreglar la ventana de 24 h de Messenger (inundÃ¡s la cola de conversaciones muertas y multiplicÃ¡s Ã200 la exposiciÃ³n de PII).
- **No prender el reloj de interacciones por default** en el mismo PR que lo agrega. **No** usar el nÃºmero propio como atribuciÃ³n de venta/campaÃ±a (ya hay fuentes mejores: `vendedoraId` del token, `origen` con el `adId`).
- **No nÃºmero por vendedora** en el primer corte (D3). **No** meter el correo como burbuja a la derecha ni contarlo para Deuda/Silencio/Enfriamiento.
- **Testing:** no testcontainers, no rollback-global (choca con el singleton `db/client.ts:10`), no snapshots de pantallas enteras (ruido con el rediseÃ±o en curso), no dumps de prod con PII. Ojo: el default de la cola en `localStorage` y el cachÃ© persistido tienen que coincidir (D6).

---

## 7 Â· El primer dÃ­a (funcionando y verificable maÃ±ana)

**Objetivo de maÃ±ana: matar un bug de producciÃ³n con evidencia y dejar el cimiento puesto â sin tocar la UI de la vendedora.**

1. **Levantar el harness (#33) + el primer test rojoâverde de #38.** `docker-compose.test.yml` (5439/tmpfs), template con `CREATE EXTENSION vector` antes de `db:push`, guardia anti-prod, y extraer `consultarRadar(db, ahora)`. El test Â«un seguimiento de ayer sube la conversaciÃ³n a VENCIDOÂ» **arranca ROJO** (prueba que el campo `seguimientoEn` nunca llega, `radar.ts:32`), y se pone **verde** con el JOIN a `recordatorios`. *Verificable:* el test en CI + **screenshot con Playwright del radar** mostrando una conversaciÃ³n VENCIDA arriba (regla dura #2; se firma un token de dev con `firmarSesion` y se siembra en `localStorage`, tÃ©cnica ya resuelta, `estado.md:90`).
2. **Cerrar #36 en las 4 rutas** (server, botÃ³n). *Verificable con `curl`:* `/api/conversaciones` sin Bearer â **401**; con token â 200. Desbloquea Fases 3 y 5.
3. **Dos verificaciones baratas que destraban la Fase 1**, sin escribir cÃ³digo de producto: mirar el payload de `productos-cursos/` por la **moneda** (`venta.ts:36-42`), y un `SELECT` de muestra de `Ficha.correo` poblado en `meta_escuela` (5438). Con eso, `{precio}` y el composer de correo entran a la Fase 1 sabiendo que se pueden shipear.

Al cerrar el dÃ­a: #38 muerto de verdad (con screenshot), el harness que hace que **la prÃ³xima consulta SQL nazca con su `*.db.test.ts` al lado** (lo que pidiÃ³ Estephano: Â«que cada funcionalidad nazca aseguradaÂ»), la auth cerrada, y la Fase 1 con vÃ­a libre.