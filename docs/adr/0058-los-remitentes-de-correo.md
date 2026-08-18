# ADR 0058 — Los remitentes de correo

**Fecha**: 17-ago-2026
**Estado**: aceptado — toca `server/` y trae la migración **0029**, así que las dos mitades salen
por **N5**.
**Reemplaza**: la vista Correos del commit **`49b26b9`** (21-jul-2026) — el composer 1-a-1 con un
`SMTP_FROM` único para todo el equipo, sin `Reply-To`, sin firma, sin techo de volumen, sin forma de
leer lo que se mandó y con el destinatario validado por un `/.+@.+\..+/`. Queda descrita acá y
archivada.
**Enmienda**: **ADR 0037** — un correo con `clave` cuelga del timeline del contacto, que es lo que
esa columna prometía desde julio y nunca cumplió. **Consume ADR 0028** sin tocarlo: quién administra
remitentes se pregunta con `mandaEnElEquipo`, nunca con `rol === 'supervisor'`.

---

## El pedido

Del dueño: **«quiero poder configurar con qué correo mando»**. Antes de construir se auditó la vista
—que existe desde el 21-jul-2026 y **nunca se usó para vender**: en producción la tabla `correos`
tiene **tres filas y las tres son pruebas** (`alan` → un hotmail con asunto «test», y dos «probando»
de `ventas10@grupogoberna.com`, del 4 y el 6 de agosto)— y aparecieron **siete huecos**. El pedido
es el primero; los otros seis estaban abajo.

## Lo que había — los siete huecos

| | Qué | Qué costaba |
|---|---|---|
| **H1** | El `From` era `SMTP_FROM` y nada más: **el mismo para las nueve**. Y no había una sola línea que agregara **firma** | La pantalla decía «con tu nombre» y «con tu firma de siempre», y las dos frases eran **falsas** |
| **H2** | **No había `Reply-To`** | La respuesta del lead caía en un buzón que Hermes no lee |
| **H3** | «Nada masivo» no lo garantizaba nadie: el regex aceptaba varias direcciones, y no había techo de volumen | Una lista pegada en «Para» salía como varios mensajes, con **una** fila de auditoría |
| **H4** | `GET /api/correos` hacía `db.select()` sin proyectar | **El cuerpo de todos los correos del equipo** viajaba al navegador de cada vendedora |
| **H5** | `estado = 'enviado'` significa «SES aceptó el POST», no «llegó» | Un correo a una casilla que no existe queda como enviado **para siempre** |
| **H6** | Desde la ficha de un contacto no se podía escribirle: el puente sólo llevaba `para` | Se copiaba la dirección a mano, o no se mandaba |
| **H7** | `correos.clave` existía desde el 21-jul y **nunca se llenó** (las tres filas la tienen `NULL`) | El correo no aparece en ningún timeline, ninguna medición y ningún cruce con la venta |

Este ADR cierra seis. **H5 no se hizo y tiene su sección abajo.**

### Los tres que más duelen

**H1 + H2 — la pantalla prometía dos cosas que el código no hacía.** El pie del composer decía «Se
envía solo a esta persona, **con tu nombre**» y el placeholder «va en texto plano, **con tu firma de
siempre**». El `From` era `Escuela Goberna <escuela@goberna.us>` para las nueve; la firma no existía
en ninguna parte del server. Y encima el agujero que ninguna de las dos frases mencionaba: **sin
`Reply-To`, la respuesta del lead caía en `escuela@goberna.us`**, un buzón de Google Workspace que
Hermes no lee y que la vendedora que escribió no sabe que existe. O sea: **el canal servía para
mandar y estructuralmente no podía recibir.** Con tres filas en toda la base, nadie lo descubrió
operando — se descubrió leyendo.

**H3 — «nada masivo» era una frase de la pantalla.** El destinatario se validaba con `/.+@.+\..+/`,
que da por buena la cadena `"a@b.com, c@d.com"`: hay algo, hay arroba, hay punto. Lo que sigue no es
un error de nadie — **está verificado contra el `addressparser` de la nodemailer instalada (9.0.3),
la que corre en producción**, que la parte en **dos destinatarios** y manda los dos. Y el `;` también
parte, y `"X <a@b.com>, Y <c@d.com>"` también.

Peor que partirse es reescribirse, y eso también se midió contra el mismo parser:

```
"a(b)c@goberna.us"       → address: "ac@goberna.us", name: "b"   ← el paréntesis es un COMENTARIO (RFC 5322)
"equipo:ana@goberna.us"  → un GRUPO; sale hacia "ana@goberna.us"
"a@b.com\nBcc: otro@x"   → un grupo con otro@x adentro
```

O sea que la vendedora escribe una dirección, la fila de `correos` guarda **ésa**, y el mensaje sale
hacia **otra**. Es la misma regla que la campaña de WhatsApp ya tuvo que aprender (ADR 0055):
***un destinatario mal leído no cuesta un mensaje, le llega a otra persona*** — y acá la auditoría
queda mintiendo sin que nada dé error.

**H4 — la lista mandaba el cuerpo de todos.** `db.select().from(correos)` sirve las nueve columnas, y
`cuerpo` es lo que una persona le escribió a un lead: la cotización, el precio, lo que le prometió.
**El front no lo dibujaba, y por eso nadie lo vio** — pero un recorte dibujado en el navegador no
existe: los datos ya viajaron, ya están en el caché de IndexedDB (ADR 0007) y ya salieron en
cualquier captura de la pestaña de red. Es exactamente lo que ADR 0035 y ADR 0036 prohíben.

---

## Lo medido contra SES y DNS (17-ago-2026)

Todo el diseño del sobre sale de acá, y por eso está medido y no supuesto. **El control es lo que
hace válida la conclusión**: sin él, tres «aceptado» seguidos sólo prueban que la credencial anda.

🔴 **El SMTP de producción es Amazon SES** (`SMTP_HOST` = `email-smtp.us-east-1.amazonaws.com`), **no
`mail.goberna.us`** como decía la doc desde el 21-jul-2026 — casi un mes. El **MX de `goberna.us` es
Google Workspace**, así que por `mail.goberna.us` no sale nada: es, a lo sumo, por donde se recibe.

Mandando de verdad, con dos controles:

| Prueba | Resultado |
|---|---|
| `ventas@goberna.us` (un buzón que **nunca existió**) | **ACEPTADO** |
| `escuela@goberna.us` + `Reply-To: ventas11@grupogoberna.com` | **ACEPTADO** |
| `avisos@mail.goberna.us` (subdominio) | **ACEPTADO** |
| `a@x.y.goberna.us` (subdominio anidado) | **ACEPTADO** |
| `prueba@gmail.com` | **554 «Email address is not verified»** ← **CONTROL** |
| `a@gobernaus.com` | **554** ← **CONTROL del sufijo** |

De ahí salen los tres hechos que gobiernan el frente:

1. **`goberna.us` está verificado como DOMINIO**, y **cubre sus subdominios**. Un buzón que no existe
   sale igual: SES verifica el dominio, no la casilla.
2. **`grupogoberna.com` NO está verificado.** Los `ventas10@`, `ventas11@` y `ventas12@` del equipo
   **no pueden ser `From`** — serían un 554 con un lead esperando.
3. **SES no verifica el `Reply-To`.** Ésa es la rendija por la que entra D2.

⚠️ **SPF, el DKIM de SES y DMARC ya estaban bien montados**: los tres CNAMEs de Easy DKIM existen,
resuelven y no están proxied en Cloudflare. **No hay nada que arreglar ahí**, y conviene que quede
escrito: es lo primero que alguien va a querer tocar el día que un correo caiga en spam, y no es eso.

⚠️ **El `SMTP_USER` de SES es un Access Key ID de IAM, no un buzón.** La versión vieja hacía
`SMTP_FROM ?? SMTP_USER` y **lo publicaba en `GET /estado`**, que es lo primero que pide la vista: la
mitad de una credencial, en el navegador de las nueve, en el caché de IndexedDB y en cualquier
captura de la pestaña de red. Es la regla dura #1 entrando por una puerta que nadie miraba. Y como
respaldo tampoco servía: puesto en el `From`, SES lo rechaza con 554.

---

## Las dos decisiones del dueño

### D1 · Los remitentes viven en una tabla y se administran desde una pantalla, no en el `.env`

Tabla `remitentes_correo` (migración 0029: `direccion`, `nombre`, `responder_a`, `firma`, `activo`,
`creado_por`) + cuatro columnas nuevas en `correos` (`remitente_id`, `desde`, `responder_a`,
`id_externo`), y la pantalla en `src/features/correos/AdminRemitentes.tsx`.

**Por qué no el `.env`**: con qué correo sale un mensaje es **config del negocio**, no de la máquina.
En el `.env` cada alta es un cambio de entorno en VPS1 + un reinicio a mano — y sabemos que ese
camino falla en silencio, porque **N5 sale verde y no reinicia si el SHA ya está desplegado**
(§Deploy del `CLAUDE.md`). Es el mismo criterio de `hechos` y `alias_curso`: lo que cambia con el
negocio se edita desde la app; lo que es una credencial vive en el `.env`.

**Lo que cuesta, y hay que nombrarlo**: la tabla nace vacía y la pantalla llega antes que el server
(el front sale por N4 y el server por N5). Esa ventana se cubre con el script —§«El día del deploy»—
y con el **camino de compatibilidad**: sin ningún remitente dado de alta, Correos sale por
`SMTP_FROM` exactamente como el 21-jul.

Quién puede administrar se pregunta con **`mandaEnElEquipo(req)`** (`server/src/equipo/cargarRol.ts`),
así que un **admin** entra igual que un supervisor. Con `rol === 'supervisor'` el admin se queda
afuera de su propia pantalla de configuración, y eso no da error: da un 403 que parece un permiso mal
puesto.

### D2 · La respuesta del lead le llega a quien escribió

El `Reply-To` es **el correo de la vendedora que mandó**, y recién si su `vendedora_id` no es un buzón
se cae al `responder_a` del remitente. El orden es ése y no el contrario **porque el `responder_a` es
un buzón compartido**: con él arriba, la respuesta de un lead que Sindy trabajó hace tres días le
llega a todo el mundo y a nadie en particular — que es exactamente el agujero H2.

Lo que lo hace posible es el hecho medido: **SES no verifica el `Reply-To`.** Que el correo de la
vendedora sea `@grupogoberna.com` —dominio **no** verificado— es un problema en el `From` y ninguno
acá. SES verifica **de quién SALE**, no **a dónde se CONTESTA**.

**Lo que cuesta**: Hermes no tiene tabla de personas, así que «¿el `vendedora_id` es además un buzón?»
es una pregunta que se contesta mirando la cadena (`correoDeVendedora`, en
`server/src/correos/remitente.ts`). En producción conviven las dos formas —`ventas10@…` sí, `luz`,
`alan`, `Sindy`, `Usuario1` no— y hay ids con prefijo de sistema (`centurion:algo`) que no son ni una
cosa ni la otra. **La forma aceptada es deliberadamente angosta y falla hacia el «no»**: fallar hacia
el no es barato (se cae al `responder_a`, que existe y alguien lee) y fallar hacia el sí pone una
dirección inventada en el `Reply-To` — la respuesta rebota o se pierde, y nadie se entera hasta que
el lead se queja de que nunca le contestaron.

---

## La forma del sobre

```
From:     "Luz · Escuela Goberna" <escuela@goberna.us>
Reply-To: ventas11@grupogoberna.com
```

**El `From` sale por un buzón verificado y el nombre de la vendedora va en el display name**, que SES
no verifica. Así «con tu nombre» deja de ser una frase de la pantalla sin tener que verificar
`grupogoberna.com` en SES ni pedirle nada a sistemas. El punto medio es el mismo con el que el resto
de la app encadena dos hechos («82 · de 3.051», «Aprobado · ana»): quien recibe lee **«Luz»** primero
y **«Escuela Goberna»** como el lugar del que viene, que es la jerarquía que queremos.

Y la pantalla **enseña el sobre en vez de prometerlo** (`resumenDelSobre`, en
`src/features/correos/correos.ts`). Es la regla que ordena la mitad del front de este frente: *una
promesa no se puede verificar mirando; un `Luz · Escuela Goberna <escuela@goberna.us>` sí.*

---

## Lo que se decidió y NO es obvio

- 🔴 **`sinSaltos()` es lo único que separa la caja de asunto de una inyección de cabeceras.** Una
  cabecera SMTP termina en CRLF: un retorno de carro adentro del asunto **cierra la cabecera y lo que
  sigue se manda como una cabecera nueva**. O sea que desde la caja de asunto de la pantalla se podía
  agregar un `Bcc:` y mandarle el correo a quien fuera, **sin tocar la API y sin dejar rastro en
  `correos`**. Es el único agujero de este frente que se explota desde la UI. Los que inyectan son
  `\r` y `\n` y nada más; los otros cuatro (NEL, VT, FF, U+2028/29) se limpian igual para que la
  regla sea UNA y no tenga excepciones que alguien tenga que recordar: *una cabecera es una línea*.
  ⚠️ Y los saltos **se reemplazan por un espacio, no se borran**: borrarlos pega las palabras
  («Foro de Estado\n2026» → «Foro de Estado2026») y al lead le llega un asunto que en la pantalla se
  veía bien.
- 🔴 **El dominio se chequea al DAR DE ALTA, no al mandar** (`server/src/correos/verificado.ts`). Un
  remitente mal dado de alta **no se ve mal en ningún lado**: la fila queda escrita, la pantalla lo
  lista, el selector lo ofrece — y el defecto aparece días después, en el correo de OTRA persona,
  como «el correo no salió, volvé a intentar». En el alta hay alguien mirando la config y la
  respuesta se puede explicar («ese dominio no está verificado en SES»).
  ⚠️ **Esto NO reemplaza al 554**: la lista de `SMTP_DOMINIOS_VERIFICADOS` es una **promesa sobre lo
  que SES ya aceptó**, no una fuente de verdad. Quien la toca tiene que haber mirado SES primero.
  · 🔴 **El subdominio se aceptó por medición, no por discusión.** Comparaba por igualdad exacta del
    lado del server y el front aceptaba subdominios: la pantalla decía que sí y el server contestaba
    400 sobre una dirección que **SES manda sin chistar**. ⚠️ Y **el punto del prefijo es
    obligatorio**: con un `endsWith('goberna.us')` pelado, `xgoberna.us` pasa — el dominio de otra
    persona, autorizado por una comparación de cadenas. Es el mismo error de forma que el sufijo de
    9 dígitos del teléfono (#119).
- 🔴 **El techo de volumen es de la VENDEDORA, y el de WhatsApp es de la LÍNEA.** Los números son los
  mismos (20/hora, 60/día, cruzados con un test contra `autorespuesta/config.ts`) pero el sujeto
  cambia a propósito: en WhatsApp cada línea es de alguien; acá el `From` son unos pocos buzones
  compartidos por todo el equipo, así que un techo por remitente no acota a nadie — **la primera que
  empiece a mandar se come el cupo de las otras ocho**, y la que quedó afuera no tendría cómo saber
  por qué.
  ⚠️ **Y NO es anti-ban.** Esto es SES, no WhatsApp: SES no banea por ritmo, cobra. Lo que un envío
  en masa quema es la **reputación del dominio**, que es de las nueve, y lo que rompe es la política
  —un correo es una acción humana—. Sin decir esto, alguien sube el techo «porque acá no hay ban».
- 🔴 **El `try` del camino de ÉXITO estuvo del lado equivocado durante una hora, y vale dejar escrito
  por qué.** El camino de FALLO envolvía su escritura —donde reintentar es inofensivo— y el de ÉXITO
  no. Como el handler está envuelto en `ruta()` (`server/src/lib/ruta.ts`), un hipo de la base
  —un `ETIMEDOUT`, o `correos.remitente_id` que todavía no existe porque N5 no corrió— se convertía
  en un **500 genérico sobre un correo que el lead ya tiene en la bandeja**. Y un 500 en un composer
  significa una cosa sola para quien lo mira: volver a apretar Enviar. Le llegan dos. Ahora las dos
  ramas atrapan y el éxito contesta que salió, con el hueco en el log: **se pierde la auditoría, no
  el correo ni la certeza de quien lo mandó.**
- ⚠️ **El `try` envuelve SÓLO el `sendMail`, y por eso el motivo del proveedor puede llegar a la
  pantalla.** Antes un mismo `try` cubría el envío y el `INSERT`, así que el error podía ser el
  diálogo del SMTP o el SQL entero de drizzle (`porQueFallo` lo documenta) y había que contestar un
  texto genérico. Separados, ahí adentro sólo cae lo que dijo SES — y eso es lo **único** que
  distingue «esa casilla no existe» de «se cayó un momento», dos fallas que se arreglan al revés.
- ⚠️ **El orden de las preguntas de `POST /enviar` es contrato**: destinatario → asunto → cuerpo →
  ritmo → remitente → SMTP → salir. Lo barato y lo que corrige la persona va primero. **El ritmo va
  ANTES de resolver el remitente** porque un techo quemado no se arregla eligiendo otro buzón:
  contestar «elegí un remitente» a quien ya no puede mandar la manda a probar cosas que no la van a
  destrabar. Eso no vive en ningún módulo puro — vive en cuál `if` está primero, y por eso el candado
  es un test **de la ruta** (`server/src/correos/correos.test.db.ts`).
- ⚠️ **Los cuatro motivos del destinatario no se colapsan en un `false`.** Decirle «pusiste varios» a
  quien escribió `Ana <ana@x.com>` la manda a buscar una coma que no existe, y decirle «tiene un
  salto de línea» a quien no escribió nada es ruido. `vacio` → `salto_de_linea` → `varios` → `forma`,
  en ese orden y cada uno con su lectura.
- ⚠️ **El asunto que se pasa se RECHAZA, no se recorta.** La versión vieja hacía
  `String(asunto).slice(0, 200)`: al lead le llegaba un asunto cortado a la mitad de una palabra y en
  la pantalla se veía entero — dos cosas que nadie podía atar. Es el criterio de `RECORTE_MAX` en el
  padrón (**nunca recorta en silencio**) y el de `atribucion/llave.ts`.
- ⚠️ **`conteosDeRitmo` NO degrada, y el resto del módulo sí.** La misma consulta tiene dos
  consumidores y dos respuestas correctas y opuestas ante el mismo fallo: en `GET /estado` un fallo
  hace que el campo **no viaje** (un contador inventado diría «te quedan 20» mientras el envío se
  frena); en `POST /enviar` tira, porque un techo que se abre solo cuando la base hipa es la
  definición de teatro.
- ⚠️ **Sin la migración 0029 todo degrada a lo de antes, nunca hacia más**: `listarRemitentes` avisa
  por log y devuelve `[]`, la pantalla no tiene remitente que ofrecer y el envío sale por `SMTP_FROM`
  como el 21-jul. Las lecturas de `correos` van sin las columnas del sobre, y ahí **el hueco no
  miente**: sin la migración ningún correo pudo salir con remitente, así que `desde: null` es la
  verdad y no un «no se pudo preguntar». Es el criterio de `reacciones/repositorio.ts` —el consumidor
  es una persona— y **no** el del catálogo de piezas (ADR 0023), donde media respuesta honesta se
  vuelve una mentira para un índice que cachea.
- 🔴 **`GET /api/correos` enumera columna por columna, y ése es el arreglo sostenible de H4.** No es
  que devuelva menos: es que **el cuerpo se pide (`GET /api/correos/:id`), no se recibe de yapa**. Y
  enumerar tiene el efecto que lo hace durar: **una columna nueva del schema nace fuera de la lista**.
  Con `select()` a secas nace servida a todo el equipo y quien la agrega ni se entera.
  ⚠️ Ninguna de las dos filtra por autora, y eso es **un filtro que no existe, no una frontera que se
  rompió**: la auditoría de qué se le dijo a un lead es del equipo, igual que el hilo de WhatsApp. El
  día que tenga que ser frontera va en el `WHERE`, como el padrón y el Dashboard, nunca en un `if`
  del navegador.
- 🔴 **La fila de la lista es un BOTÓN, y sin ese clic la ruta nace huérfana.** `GET /api/correos/:id`
  existe justamente porque el cuerpo dejó de viajar de prepo; si nadie la llama, Hermes se queda sin
  **ninguna** forma de leer lo que mandó. En este repo eso no es hipotético: `PanelNotas` y `onCorreo`
  estuvieron meses dibujados y muertos, sin un solo síntoma. El candado es
  `src/features/correos/lecturaCableada.test.ts`.
- 🔴 **`clave` opcional es el motivo por el que H7 duró un mes.** La columna existía desde el 21-jul,
  la intención estaba escrita en el schema, y el front mandaba `{para, asunto, cuerpo}` y nada más.
  Tiene que **seguir** siendo opcional —se puede escribir un correo suelto, sin conversación de
  origen— así que lo que se fija con test es lo otro: **que el puente la tenga y no la mande es lo
  que no puede pasar** (`src/features/panel/puenteCorreo.test.ts`,
  `src/features/correos/VistaCorreos.test.tsx`).
  ⚠️ Y la clave se pacta **contra un destinatario**: si quien escribe cambia el «Para» después de que
  el puente lo prellenó, la clave se suelta. Colgar un correo del hilo de otra persona es peor que no
  colgarlo de ninguno.
- ⚠️ **El `vendedora_id` crudo no se pinta en la lista.** Es la lección de ADR 0049 (cuatro
  componentes pintando el identificador con un `capitalize` de CSS, que se veía bien de casualidad),
  y acá se veía peor: los `ventas1X@grupogoberna.com` entran en su columna como «ventas10@gru…», o
  sea que **las cinco de la rueda se leen igual salvo por un dígito**. El id completo no se pierde:
  vive en el `title`, que es donde hace falta cuando lo que se está haciendo es auditar.
- ⚠️ **`nombreCortoDeVendedora` es una SEGUNDA copia de `nombreCorto` (`src/dominio/dueno.ts`),
  escrita a sabiendas.** El `From` se arma en el server y el server no puede importar `src/`: son dos
  tsconfig, dos builds y dos deploys. Lo que cuesta es concreto — el mismo humano leyéndose «Ventas10»
  en la fila de la cola y «ventas10» en el sobre del correo, en la misma pantalla, sin ningún error —
  y por eso el candado (`server/src/correos/nombreVendedora.paridad.test.ts`) **lee el archivo del
  front**. Es el molde de `limitesMedia.paridad.test.ts` y de `notas/limiteTexto.paridad.test.ts`.

### El día del deploy no hay pantalla: `npm run correos:remitentes`

D1 dice que los remitentes se administran desde una pantalla, y está bien. Pero **la pantalla y el
server no llegan juntos**: el front sale por N4 y el server por N5, que es un botón. En esa ventana
la tabla existe y está vacía, `GET /estado` contesta `sinRemitentes: true` y **no hay ninguna forma
de cargar el primero**.

Sin el script (`server/src/scripts/remitentesCorreo.ts`) eso se destraba de una sola manera: un
`INSERT` a mano contra la base de producción. Y ahí pasa lo mismo que motivó `reparto:rueda` — se
escribe `escuela@gobena.us`, la fila queda **válida**, el selector la ofrece y el defecto aparece en
el 554 del primer envío, con un lead esperando. **Peor acá que allá: el `INSERT` a mano se saltea
`puedeSerRemitente`, que es el único control de dominio verificado que tiene el frente entero.**

Dry-run por default, como todo script que escribe en esta casa. ⚠️ **No reemplaza a la pantalla y no
debería crecer hasta parecerlo**: es la puerta de arranque y la de auditoría desde una sesión SSH,
igual que `reparto:rueda` convive con `/api/reparto`.

---

## Lo que NO entra: el rebote (H5)

**`estado = 'enviado'` significa «SES aceptó el POST», no «llegó».** SES contesta con un `messageId`
—que se guarda en `correos.id_externo`, y sirve para **una sola cosa**: cruzar esa fila contra los
logs de SES— y el rebote, el buzón lleno y la queja de spam pasan **después**. Sin webhook de bounce
no hay forma de enterarse: un correo a una casilla que no existe **queda como `enviado` para
siempre**, y la vendedora concluye «ya le escribí, no me contesta» sobre alguien que nunca lo
recibió. Es el mismo hueco que tenían los ✓✓ antes de la migración 0021.

**Va como frente aparte, con sus pasos, y no como algo hecho a medias** — la cicatriz es ADR 0042
(«nunca se enchufó el caño»): *antes de afirmar que un canal anda, contá filas en la base*.

Lo que hace falta, en orden:

1. Crear un tema **SNS** y suscribirle las notificaciones de SES: `Bounce`, `Complaint` y —si se
   quiere cerrar el lazo completo— `Delivery`. **Se configura en la consola de SES, no en Hermes**:
   es la mitad que no es código, igual que declarar el callback de `/webhook/meta`.
2. Un receptor `POST /webhook/ses` **fuera de `/api`** —el perímetro es cerrado por defecto y sus
   excepciones son puertas propias (ADR 0047)— que **verifique la firma de SNS** y conteste el
   `SubscriptionConfirmation` del handshake. Ack primero, como el webhook de Meta.
3. Escala **monótona** sobre `correos`, con el molde exacto de `entrega/dominio.ts`: los avisos
   llegan desordenados, así que el avance se hace **en la base**, con el orden adentro del `WHERE`, y
   la misma regla vive pura con su test de paridad.
4. La llave del cruce es **`id_externo`**, y ya se guarda: sin eso no habría contra qué aplicar el
   rebote. Es la única razón por la que esa columna está en la migración 0029 y no en la del frente
   que la va a usar.

⚠️ **Y la verificación no es un 200**: se cuentan filas en `correos` con estado de rebote, mandando a
propósito a una casilla que no existe. Un webhook que contesta 200 y no escribe nada se ve igual que
uno que anda.

Tampoco entran, y por decisión: **adjuntos** (un correo de Hermes es texto plano), **HTML**, **hilos
de ida y vuelta** (Hermes manda; lo que vuelve lo lee la vendedora en su Gmail, que es lo que D2
garantiza) y **cualquier forma de lista** — eso es otra herramienta y otra política.

### 🔴 Deuda abierta del server: reactivar un remitente NO chequea el dominio

Encontrado **capturando la evidencia**, no por un test — el molde de ADR 0049, donde el grep encontró
un caso y la captura los otros tres. En `correos-admin-remitentes.png` la fila retirada
`ventas@grupogoberna.com` ofrecía **«Volver a usarlo»** como una acción normal, en navy, sin una
palabra sobre por qué estaba retirada.

`PATCH /remitentes/:id {activo:true}` **no pregunta nada**: su propio docblock dice que el dominio se
verifica «al DAR DE ALTA, el único control que existe», y ese mismo docblock se toma el trabajo de
rechazar `direccion` en el PATCH por ser «la puerta de atrás». Reactivar es **la segunda puerta**, y
no hace falta nada raro para llegar:

- el **`INSERT` a mano contra producción** que este mismo ADR documenta como el destrabe del día del
  deploy se saltea `puedeSerRemitente` por definición — esa fila se puede retirar y volver a prender
  para siempre;
- **`SMTP_DOMINIOS_VERIFICADOS` es una variable de entorno**: el día que se angoste, o que SES
  revoque un dominio, todas las filas viejas de ese dominio quedan dadas de alta y reactivables.

**Lo que se hizo ahora es sólo la mitad de adelante**, y hay que leerlo así: `FilaRemitente` dice el
motivo con el ámbar de siempre y apaga el botón, con la MISMA `dominioAceptado` que ya frenaba el
alta (candado: *«lo que NO se puede dar de alta tampoco se puede volver a prender»*, en
`AdminRemitentes.test.ts`). Eso adelanta el aviso a quien administra — es lo mismo que hace
`motivoParaNoGuardar` — pero **no es la garantía**, y la regla del repo es literal: esconder algo del
navegador no protege nada. **Cerrarlo es preguntar `puedeSerRemitente` en el PATCH cuando viene
`activo: true`**, y va con su test de ruta.

---

## Qué reemplaza

La vista Correos que entró con **`49b26b9`** (21-jul-2026), descrita acá para que quede archivada:

| | Cómo era | Cómo queda |
|---|---|---|
| `From` | `SMTP_FROM`, uno para las nueve | remitente elegido + **nombre de la vendedora** en el display name |
| `Reply-To` | no existía | **el correo de quien escribió** (D2), con el `responder_a` del remitente de respaldo |
| Firma | la frase estaba en la UI, el código no la agregaba | `firma` por remitente, con el separador `-- ` de RFC 3676 |
| Destinatario | `/.+@.+\..+/` | `leerDestinatario`: **uno solo**, con cuatro motivos legibles |
| Volumen | sin techo | 20/hora · 60/día **por vendedora** → 429 con las dos cifras |
| Asunto | `slice(0, 200)` en silencio | `sinSaltos` + rechazo explícito |
| Lista del equipo | `db.select()` — el cuerpo de todos | proyección enumerada, sin `cuerpo` |
| Leer un enviado | no se podía | `GET /api/correos/:id` + la hoja de lectura |
| `clave` | `NULL` en las tres filas que existen | viaja desde el puente de la ficha |
| Rebote | invisible | **sigue invisible** — frente aparte, arriba |

El composer 1-a-1, la auditoría de los fallidos y el 503 honesto cuando falta el SMTP **no se
tocaron**: eran correctos y son de aquel commit.

---

## Los candados

| Test | Qué fija |
|---|---|
| `server/src/correos/destinatario.test.ts` | Las formas que nodemailer parte y las que **reescribe**, con los textos medidos |
| `server/src/correos/remitente.test.ts` | El sobre, las comillas del display name, el orden del `Reply-To` y que `sinSaltos` no pegue palabras |
| `server/src/correos/verificado.test.ts` | Subdominios sí, `xgoberna.us` no, dos arrobas no, lista vacía → nadie |
| `server/src/correos/ritmo.test.ts` | El `>=`, y que **la hora gane al día**; cruza los números contra los de WhatsApp |
| `server/src/correos/limites.paridad.test.ts` · `src/features/correos/topeCuerpo.paridad.test.ts` | Los dos topes, server ≡ front (#37) |
| `server/src/correos/nombreVendedora.paridad.test.ts` | El nombre corto, contra el archivo del front |
| `server/src/correos/repositorio.test.db.ts` | Que la lista **no pueda** traer el cuerpo, y la degradación sin la migración |
| `server/src/correos/correos.test.db.ts` | **La costura**: que la ruta use el seam, y el ORDEN de las preguntas de `POST /enviar` |
| `src/features/correos/correos.test.ts` | Que el botón y `⌘↵` consulten la MISMA condición |
| `src/features/correos/lecturaCableada.test.ts` | Que la fila abra el correo — la ruta no puede quedar huérfana |
| `src/features/correos/VistaCorreos.test.tsx` · `src/features/panel/puenteCorreo.test.ts` | Que el puente lleve la `clave` y que se suelte al cambiar el «Para» |

⚠️ **Las variables de SMTP se borran adentro de `correos.test.db.ts`, y no es higiene**: si la máquina
que corre los tests las tuviera en el entorno, `POST /enviar` llegaría al paso 7 y `sendMail` saldría
a la red con las credenciales de SES de producción. Un test que manda correos de verdad no se nota
hasta que alguien recibe uno.

---

## Evidencia

`docs/evidencia/correos-composer-remitente.png` · `correos-sin-remitentes.png` (el día del deploy) ·
`correos-admin-remitentes.png` · `correos-admin-supervisora-con-buzon.png` ·
`correos-uno-por-correo.png` (los dos destinatarios) · `correos-techo-de-ritmo.png` ·
`correos-leer-enviado.png` · `correos-lectura.png` · `correos-lista-enviados.png`.

Todas a **1280×800**, que es la laptop de la vendedora.

⚠️ **`correos-lista-enviados.png` existe porque a 1280×800 la lista NO entra entera, y el número
está medido: faltan 70 px** (el contenido pide 788 y el alto útil son 718). De esos, **82 px son el
banner de la propia galería** —el rótulo que explica el caso—, así que la mayor parte del recorte es
chrome de la evidencia y no de la pantalla; la app tiene su propio riel arriba, así que esto **no
alcanza para afirmar que ahí entra**. `fullPage` no sirve: la galería envuelve la vista en
`h-screen` y quien scrollea es un contenedor interno, no el documento. Esa captura es la misma
pantalla con ese contenedor abajo del todo, y es la que prueba que las **tres** filas de producción
están —las dos `probando` del 6-ago y el `test` de Alan del 4-ago, en sus dos grupos de día.

Sin server ni base: `npx vite --port 5199` → `/galeria-correos.html`, con un flag por caso real
(`?sinremitentes=1`, `?desconectado=1`, `?supervisor=1`, `?admin=1`, `?techo=1`, `?varios=1`,
`?correo=1`, `?leer=1`).

⚠️ **La galería sirve las TRES filas que existen en producción**, con sus fechas y su `desde` en
hueco —son anteriores a la migración— y **no un caso ideal**: ese hueco es justamente lo que hay que
poder mirar, y una galería con datos lindos ya escondió tres defectos una vez (radar de leads,
8-ago-2026).
