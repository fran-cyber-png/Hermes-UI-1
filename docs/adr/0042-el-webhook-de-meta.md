# ADR 0042 — Instagram y Facebook en vivo: no se habían desconectado, nunca se enchufó el caño

**Fecha**: 7-ago-2026
**Estado**: aceptado (código); **pendiente de una acción manual en el dashboard de Meta**
**Reemplaza como camino principal a**: el polling de `npm run ingest:interactions`, que queda como red de seguridad

## El problema

El dueño preguntó: *«teníamos el sistema conectado con IG y Facebook, ¿qué pasó?»*.

La respuesta, medida capa por capa en VPS1 el 7-ago-2026, es que **no se desconectó nada: nunca
llegó a estar conectado del lado de Hermes**.

**1. El token de Meta está vivo.** `GET me/accounts` con `META_ACCESS_TOKEN` de producción devuelve
**12 Páginas** (Goberna, Latam, Perú, Chile, Colombia, Ecuador, Bolivia, Guatemala, Honduras,
Panamá, Brasil, Uruguay, República Dominicana) y **9 cuentas de Instagram** vinculadas. Es un token
de *system user* que **no expira** (`expires_at: 0`). Del lado de Meta no había nada roto.

**2. La UI existe y está cableada** — no es código muerto, a diferencia de `PanelNotas`:
`App.tsx` → `ConversacionActiva` → `HiloMessenger` (Messenger read-only) y `ResponderPanel` para
comentarios, con `QuePuedoHacer` consultando la ventana de Meta antes de que la vendedora redacte.

**3. La cola sabe ordenarlos**: el nivel 2 de `cola/urgencia.ts` es literalmente *comentario de Meta
con la ventana abierta y sin responder*.

**4. Y en la base de producción no había un solo dato.**

```
interactions: 12.895 filas — TODAS canal='whatsapp', desde 2026-07-21
events por source:
  icarus_landing  25.424   último 2026-07-24
  whatsapp        12.968   último 2026-08-07
  meta_lead_ad       651   último 2026-05-19
  meta_wa_msg        295
  meta_wa_ctwa        81
```

**Cero eventos `meta_comment_fb`, `meta_comment_ig` y `meta_message_fb`.** Ni uno.

### La causa

La captura de FB/IG era un **script manual** (`npm run ingest:interactions`, polling del Graph API) y
**nadie lo corría**: el `crontab` de `deploy` en VPS1 tiene 20 entradas de otros proyectos y ninguna
de Hermes; `systemctl list-timers` está vacío. Y **no existía webhook**: `/webhook` montaba
`whatsapp`, `cerberus` y `landing`, y nada más.

El remate: las **12 Páginas tenían `subscribed_apps` vacío**. La app de Meta nunca se suscribió a
ninguna.

> **La lección que se lleva `docs/estado.md`.** Ese archivo afirma «Cola unificada 4 canales ·
> Messenger read-only · comentarios privado-antes-que-público». Es cierto del **código** y falso de
> la **realidad**. Un doc que describe capacidades del front no prueba que haya datos atrás: antes de
> afirmar que un canal funciona hay que **contar filas en la base**, no leer componentes.

## La decisión

**Webhook en tiempo real**, no un cron con el script de polling. Decisión del dueño, sobre estas dos
opciones:

| | latencia | costo | qué pide |
|---|---|---|---|
| cron con el script que ya existe | minutos | cero código | un `crontab` |
| **webhook** | segundos | receptor + suscripción | una acción manual en el dashboard |

El webhook gana porque el valor de un comentario **decae con las horas** —la ventana de respuesta
privada corre desde que lo escribieron— y porque la primera corrida del polling volcaría miles de
comentarios viejos de golpe en la cola de las vendedoras.

**No hace falta revisión de app**: los permisos ya estaban concedidos el 7-ago-2026
(`pages_manage_metadata`, `pages_read_user_content`, `pages_messaging`, `pages_manage_engagement`,
`instagram_basic`, `instagram_manage_comments`, `instagram_manage_messages`).

### 1. Los dos caminos conviven, y de eso depende que se pueda dejar el polling

El polling **no se archiva**: es la red que recupera lo que se perdió mientras el server estaba
caído, y la única forma de traer lo viejo — ningún webhook reenvía el pasado.

Que convivan sin duplicar depende de **un acuerdo**: el mismo `source` y el mismo `external_id` para
el mismo hecho. Y se cumple porque los ids de Meta son los mismos por los dos lados — el `mid` del
webhook de Messenger es el id que devuelve `conversations{messages{id}}`, y el `comment_id` de `feed`
es el `id` de `posts{comments{id}}`.

Para que ese acuerdo no se rompa en silencio:

- **una sola función de escritura**, `meta/proyectarInteraccion.ts`, que usan los dos;
- **`meta/caminos.paridad.test.ts`** LEE el archivo del polling y falla si los `source` divergen o si
  el polling vuelve a tener un `insert` propio (el patrón de `limitesMedia.paridad.test.ts`);
- **`meta/caminos.test.db.ts`** escribe por los dos caminos contra una base real, en los dos órdenes,
  y verifica que quede **una** fila.

Sin eso, renombrar `meta_comment_fb` de un solo lado mete el mismo comentario dos veces: la clave
`(source, external_id)` sería distinta, así que no habría error, ni log — solo la conversación
duplicada en la cola.

### 2. La traducción va pura, afuera del Express

`webhook/metaPayload.ts` (`interpretar()`) toma el body y devuelve qué escribir, sin tocar base ni
red. `webhook/meta.ts` es solo el cableado. No es prolijidad: el archivo del handler importa `db`, y
sin la separación un test de los payloads reales de Meta exigiría `DATABASE_URL` para verificar una
función que no toca la base.

Los tres casos que justifican el módulo, y que mal leídos producen una fila que se ve razonable en la
base y miente en la pantalla:

- **`is_echo` es NUESTRO propio mensaje.** Meta devuelve por el webhook todo lo que la Página manda,
  incluso desde Business Suite. Leído como entrante, la cola contaría como deuda las respuestas que
  ya dimos y `respondida` diría lo contrario de lo que pasó. Se guarda igual, marcado saliente: el
  polling ya aprendió que tirar nuestras propias respuestas deja la base sin saber a quién le
  contestamos.
- **`feed` trae todo el muro** (posts, reacciones, compartidos). Sin recorte, cada reacción entraría a
  la cola como si alguien nos hubiera hablado. Y `verb: remove`/`hide` no es contenido nuevo: se
  ignora en vez de guardarse vacío, que es el fantasma que el fix #70 sacó de la UI.
- **El webhook de comentarios de Instagram no manda hora.** Con `new Date(undefined)` la fila queda
  `Invalid Date`; con un 0, en enero de 1970 — y ahí cae **fuera de la ventana de 30 días de la
  cola**, o sea que el comentario se guarda y no aparece en ninguna pantalla. `momento()` usa la del
  `entry` y distingue segundos de milisegundos, que Meta mezcla entre campos.

### 3. Misma firma HMAC y mismo secreto que WhatsApp

`WHATSAPP_APP_SECRET` es el App Secret de la app de Meta (`1958308695630264`), no algo de WhatsApp:
la misma app firma los eventos de la Cloud API, los de las Páginas y los de Instagram. Un secreto por
objeto sería otro secreto que mantener sin nada que gane, y en el primer rotado quedaría uno viejo
rebotando eventos en silencio. Se distinguen solo por la etiqueta del log — sin eso, un 403 no dice
cuál de los dos webhooks se está cayendo.

Falla **cerrado**, como el de WhatsApp: sin secreto configurado, todo POST es 403.

### 4. Ack primero

Meta reintenta si no ve un 200 pronto y **desactiva la suscripción** tras fallar seguido. Se responde
200 y después se escribe, con un `try` por interacción: un payload raro en el tercer comentario no
puede llevarse puestos los dos que ya se entendieron. Mismo contrato que `recibirWhatsapp` y que el
webhook de Cerberus.

## Lo que falta, y no es código

Suscribir la Página le dice a Meta «mandale los eventos a la app». **Dónde** los manda se declara una
sola vez en el dashboard, y **sin eso el script responde `success: true` y no llega nada** — sin
error, sin log, sin forma de notarlo salvo mirando la base. Por eso `npm run meta:suscribir` lo
imprime al terminar, incluso cuando todo salió bien.

1. Meta app `1958308695630264` → Webhooks → objetos **`page`** e **`instagram`**:
   - Callback URL: `https://hermes-api.goberna.us/webhook/meta`
   - Verify token: el `WHATSAPP_VERIFY_TOKEN` del `.env` de VPS1
2. `cd /srv/hermes/server && npm run meta:suscribir` (dry-run) y después `-- --aplicar`.
3. Verificar **contando filas**, no mirando un 200:
   ```sql
   SELECT source, count(*), max(occurred_at) FROM events
   WHERE source LIKE 'meta_comment%' OR source = 'meta_message_fb' GROUP BY 1;
   ```

Dry-run corrido contra producción el 7-ago-2026 (solo lectura): **12 Páginas · 9 con Instagram · 12
sin suscribir**.

## Lo que cuesta

- **Se abre un caño hacia la cola de las vendedoras.** 12 Páginas de 12 países en una sola cola:
  hasta hoy la cola era WhatsApp puro. No hay recorte por país ni por Página, y puede hacer falta —
  pero acotarlo antes de ver el volumen real sería adivinar.
- **`contexto_texto` viaja vacío por el webhook.** El polling trae el texto del post porque pide el
  post entero; el webhook no lo manda. La fila muestra «en "…"» solo si el polling pasó después. Se
  deja `null` antes que inventar: un texto equivocado ahí es peor que ninguno.
- **`messaging_postbacks` está suscrito y no se interpreta.** Se pidió porque llega junto con
  `messages` en la práctica; hoy `interpretar()` lo descarta por no traer `message.mid`. Es tráfico
  que se recibe y se tira, a la vista en el log.
- **Nada de esto responde todavía.** Este ADR es la mitad que RECIBE. Responder un comentario o un DM
  desde Hermes usa `routes/responder.ts`, que existe y no se tocó — y hasta ahora nunca tuvo datos
  con los que probarse.
