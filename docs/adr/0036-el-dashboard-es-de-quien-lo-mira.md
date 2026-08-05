# ADR 0036 — El Dashboard es de quien lo mira

- **Fecha**: 2026-08-05
- **Estado**: aceptado
- **Issue**: (frente nuevo; nace de la decisión del dueño del 5-ago)
- **Convive con** ADR 0035 (el padrón y su frontera), del que hereda el mecanismo
  (`HERMES_SUPERVISORES`, fail-closed) y el argumento. **No enmienda** la doctrina
  de «filtro, no permiso» de `cola/lineas.ts` y `cola/asignadaSql.ts`: la cola
  sigue siendo compartida y sus recortes siguen siendo filtros.

## El problema

`GET /api/dashboard` servía **todo a todos**: el radar entero, el embudo entero,
las series enteras y las filas de las cinco vendedoras. Detrás de
`requiereVendedora`, que dice «es una vendedora», no «cuál».

Eso era correcto mientras Hermes fuera de una persona. Desde el **4-ago-2026** el
reparto está vivo (`conversacion_asignada`, PR #273): cada lead nuevo de la línea
del bot sale con dueño. Y sin embargo cada vendedora abría Hermes y veía el
trabajo de las otras cuatro mezclado con el suyo — que es exactamente lo que el
reparto vino a evitar. El «a quién atiendo ahora» que abre la mañana estaba
respondido con la lista de otra gente.

## Las decisiones

### 1. Quien no es supervisor ve SOLO sus conversaciones asignadas

Estricto: lo que no tiene dueño **no aparece**. El supervisor ve todo y es quien
reparte — ésa es la premisa explícita de la decisión, no un supuesto.

El recorte baja a las **cinco** consultas del Dashboard, no a una: radar
(`consultarRadar`), embudo (`contarPorEtapaEfectiva`), series de 14 días
(`consultarSeriesDashboard`), «qué piden» (`intereses`) y el cuadro Equipo
(`porVendedora`, que queda en una sola fila). Recortar solo la lista y dejar el
riel en cifras globales sería peor que no recortar: dos respuestas distintas a la
misma pregunta, en la misma pantalla.

### 2. Es una frontera — pero hay que decir **de qué**

Como en el padrón, el server deja de servir lo ajeno y el recorte vive en el
`WHERE`, no en un `if` del navegador (un recorte dibujado en el front no existe:
los datos ya viajaron).

Pero la frase completa importa: **es la frontera del DASHBOARD, no la del dato**.
El hilo, la ficha y el envío siguen sirviendo cualquier conversación a cualquier
token — Hermes no tiene modelo de permisos. Lo que cambia es qué pantalla te arma
la mañana, no a qué podés llegar si tenés la clave. Decirlo al revés sería
prometer una frontera imaginaria, que es el defecto del que se defiende el resto
del repo.

### 3. «El negocio» es 403, no un recorte

La solapa de facturación por curso y por anuncio es la lectura del que pone la
plata. No existe una versión personal de «cuánto factura cada curso»: o se ve o no
se ve. Mismo motivo y mismo nombre que en el padrón (`no_es_supervisor`), para que
las dos fronteras se lean igual desde afuera. Y no como un query-param: un
`?supervisor=1` sería la frontera entera a un clic de curl.

### 4. Lo que no tiene dueño posible se cae, y la pantalla lo dice

Los **leads de formulario** (Lead Ads y landings) y los **comentarios de FB/IG**
no se reparten: el reparto asigna CONVERSACIONES y la clave de un comentario es
`int:<id>`. Con recorte personal esas listas van vacías.

Por eso la respuesta lleva `soloMisAsignadas: true`, y con eso la pantalla:

- explica el vacío —«Todavía no tenés conversaciones asignadas. Acá aparecen las
  que te reparte el supervisor»— en vez de «nada cayó con estos filtros», que
  sería **falso**: cayó, no es tuyo;
- **apaga los chips** de Landing y Lead Ads, que serían ceros permanentes;
- rotula el cuadro **«Vos»** en vez de «Equipo», y suelta el renglón
  «Automático» (la resta del software contra el equipo no resta nada al lado de
  una sola persona: sumaría).

### 5. Fail-closed, y `?? true` en el front

Sin `HERMES_SUPERVISORES` **nadie** es supervisor: todas ven solo lo suyo. Una
config que falta tiene que cerrar la puerta.

Del lado del front, en cambio, el campo **ausente** se lee como «ve todo»
(`data?.supervisor ?? true`), y no es una contradicción: el campo falta en dos
casos que no son «no es supervisor» —un server viejo, y una respuesta rehidratada
del caché de IndexedDB (ADR 0007)—. Con `false` por default, «El negocio»
desaparecería **para todos, incluido el supervisor**, en la ventana entre el
deploy del front (N4, sin restart) y el del server (N5, a botón).

## 🔴 Lo que esto cuesta, medido antes de escribirlo

En VPS1, el 5-ago-2026:

```
radar de 7 días   213 conversaciones
  con dueño        83
  sin dueño       130   (61 %)

luz                        78
ventas10@grupogoberna.com   1   ← supervisor
ventas11@grupogoberna.com   1
ventas12@grupogoberna.com   1
ventas13@grupogoberna.com   1
ventas14@grupogoberna.com   1
```

Prendido hoy, esto le deja a **cuatro vendedoras un Dashboard de una sola fila**,
y 130 conversaciones visibles únicamente para los dos supervisores.

Eso no invalida la decisión: la confirma como destino y expone su precondición
**operativa**. El reparto tiene que cubrir la cola antes —o el mismo día— de que
esto se prenda. Es una tarea de operación, no de código, y no hay línea que
tocar para arreglarla.

Lo único que el código puede hacer al respecto ya está hecho: que el vacío **diga
su motivo**. Una pantalla en blanco se lee «se rompió algo» o «hoy no hay
trabajo»; las dos conclusiones son equivocadas y las dos cuestan una mañana.

## Alternativas descartadas

- **Recortar solo el radar** y dejar el riel global. Dos respuestas a la misma
  pregunta en la misma pantalla: el embudo diría 213 y la lista mostraría 1.
- **Mostrar lo huérfano junto a lo propio**, marcado. Es la opción fail-open que
  usa «Las mías», y era defendible; el dueño eligió lo contrario con un motivo
  explícito: *el supervisor asigna a todos*. Queda escrito acá porque si un día
  el reparto no alcanza a cubrir la cola, ésta es la salida ya pensada.
- **Una tabla de roles** en vez de la variable de entorno. Mismo argumento que
  ADR 0035: con dos supervisores, la tabla es andamiaje — una migración, un CLI y
  un lugar más donde mirar para representar una lista de dos elementos. La firma
  `(vendedoraId, env) → boolean` deja mudarlo sin tocar a quien lo llama.

## Dónde vive

- `server/src/dashboard/personal.ts` — la regla y los dos fragmentos SQL.
- `server/src/routes/dashboard.ts` — el cableado y el 403 de `/negocio`.
- `server/src/cola/consultarRadar.ts`, `cola/consultarCola.ts`,
  `dashboard/series.ts` — los seams que aceptan el recorte.
- `src/features/dashboard/VistaDashboard.tsx` — lo que la pantalla dice cuando
  está recortada.
- Tests: `dashboard/personal.test.ts` (la regla), `personal.test.db.ts` (que el
  recorte recorte, contra base) y `routes/dashboard.test.db.ts` (la puerta del
  403). Hueco declarado: que `GET /` pase el recorte a los cinco seams se
  verifica con `curl` contra staging, porque la ruta usa el singleton `db`.
