# ADR 0053 — El ruteo por campaña: qué pauta cae en qué vendedora

**Fecha**: 11-ago-2026
**Estado**: aceptado — toca el server, va por **N5** (migración `0025`)
**Se apoya en** el reparto de leads del 4-ago (`reparto/rueda.ts`, `conversacion_asignada`): no lo
reemplaza, le pone una excepción por arriba.
**Estrena** la décima vista del riel, y con ella la primera vista que **no la ve todo el mundo**.

---

## El pedido

*«poner las campañas activas a este número Meta API enlazado a Hermes, mostrar los vendedores, y
poder elegir qué campaña va a caer a qué vendedor»* (dueño, 11-ago-2026).

Hoy los leads de la línea de Cloud API se reparten por **round-robin por carga**: la rueda reparte
parejo justamente **porque no sabe de dónde viene nadie**. Este frente le da la única información
que hace que valga la pena decidir distinto — de qué campaña llegó la persona.

## Lo que la medición cambió del pedido

Todo lo de abajo se midió en producción **antes** de escribir una línea, contra `events` y contra la
Graph API con el `META_ACCESS_TOKEN` de VPS1.

### 🔴 Catorce anuncios son DOS campañas

| Campaña | Estado en Meta | Anuncios | Personas | Cuándo |
|---|---|---|---|---|
| `[AGO] OSINT - INTERACCIONES - 11 - 31` | **ACTIVE** | 4 | 10 | 11-ago |
| `[JUL] INTELIGENCIA \| WSP` | **PAUSED** | 10 | 78 | 1–2 ago |

Por eso **la unidad de decisión es la CAMPAÑA y no el anuncio**: catorce renglones para dos
decisiones no se opera, y cada anuncio nuevo de una campaña ya ruteada nacería sin regla.

### 🔴 Meta no manda el nombre de la campaña

El `referral` de un click-to-WhatsApp trae **`source_id` (el ad_id)** y el `headline` del creativo, y
nada más. La campaña hay que **resolverla contra la Graph API**
(`GET /<ad_id>?fields=campaign{id,name,effective_status}`). Se verificó que el token de producción
puede hacerlo **antes** de diseñar sobre esa base: si no hubiera podido, el frente entero se habría
tenido que hacer por anuncio.

### 🔴 Y el titular no sirve como identidad

El mismo `ad_id` (`120248616484060016`) llega con **dos titulares distintos** —«Inteligencia
Estratégica» y «I Foro de Estado 2026»— porque le cambiaron el creativo. Agrupar por titular
**partiría una campaña en dos y juntaría dos en una**, sin un solo síntoma. Se agrupa por `source_id`.

## Cómo funciona

Dos tablas (migración `0025`) y una excepción en el camino que ya existía:

- **`campana_anuncio`** (`ad_id` → campaña, nombre, `effective_status` crudo). 🔴 **No es un caché,
  es una precondición**: el reparto ocurre adentro del webhook, con un lead esperando del otro lado,
  y ahí no se le puede preguntar nada a la Graph API. El webhook resuelve contra esta tabla y nada
  más. Se llena con el botón «Actualizar desde Meta» o con `npm run routing:refrescar`.
- **`campana_ruteo`** (`numero_propio` + `campana_id` → `vendedora_id`, `asignada_por`).
- **`asignarSiHaceFalta(db, clave, linea, adId?)`** — la regla le gana a la rueda, y queda
  `motivo='campana'`. Lo específico le gana a lo general, la misma forma que el alias por `adId`
  contra el título inferido (`cursos/`) y que lo manual contra lo derivado en el grafo de identidad.

### La tabla vacía ES el interruptor

No hay bandera de encendido y no hace falta: **sin reglas, el reparto es exactamente el round-robin
de hoy**. La primera regla la crea una persona eligiendo en la pantalla — elegir *es* encender. Un
switch aparte habría dejado el estado «configurado pero apagado», que en una pantalla de ruteo se
lee como «ya está andando».

### Todo lo dudoso vuelve a la rueda

`aQuienLeCae` devuelve `null` —«que decida la rueda»— en tres casos, y **ninguno es un error**:

1. el mensaje no vino de un anuncio;
2. el anuncio **se estrenó hoy** y todavía no se resolvió contra Meta;
3. su campaña no tiene regla.

Es el mismo fail-open del reparto: un lead mal ruteado está peor atendido, un lead sin dueño está
perdido. El caso (2) es el que muerde y por eso **los anuncios sin resolver se CUENTAN en la
pantalla**: son el único motivo por el que una campaña viva puede faltar de la lista, y sin ese
número la pantalla afirmaría «estas son todas».

## Las decisiones que se tomaron al revés de lo obvio

- **La línea sale del ENV `WHATSAPP_CLOUD_API_NUMERO_PROPIO`, no del gestor de WhatsApp.** El primer
  borrador la buscaba como el webhook (la línea cuyo transporte es `TransporteCloudApi`), y eso ata
  la pantalla a que el transporte esté ARRIBA: con el proceso caído, Routing decía «no hay línea de
  Cloud API» —o sea, «acá no se puede decidir nada»— mientras las reglas seguían guardadas y el
  webhook seguía aplicándolas. **Un ruteo es configuración: se mira justo cuando algo anda mal.** No
  son dos fuentes: `whatsapp/wiring.ts` monta esa línea leyendo esta misma variable.
- **Refrescar es un POST, nunca el GET.** Escribir adentro de una lectura haría que mirar la pantalla
  cambie el estado, y que Routing no abra el día que la Graph API esté lenta.
- **La regla no reasigna lo ya repartido.** Se aplica en el primer mensaje de cada conversación:
  cambiar de manos a mitad de una charla es peor que estar mal repartido. La pantalla lo dice.
- **Sacar la regla BORRA la fila**, al revés de `reparto_rueda`, donde la baja lógica conserva de
  quién eran las conversaciones. Acá la fila no es de nadie —es una preferencia— y una fila
  «inactiva» solo daría la duda de si sigue mandando.
- **No se le exige a la dueña estar en la rueda.** El destino ya se verificó contra
  `destinosPosibles`, y exigirlo haría que sacar a alguien de la rueda le apagara sus campañas en
  silencio.
- **Un estado que Meta no nombra no es «pausada»**: es «no se sabe», y se dice. Mapearlo a pausada
  diría que una campaña que está gastando plata no está corriendo.

## Lo que NO es

**Sigue siendo un filtro, no un permiso** — como todo `conversacion_asignada`. Decide a quién le
aparece primero un lead nuevo y quién queda de responsable, no quién puede abrir el chat. Hermes no
tiene modelo de permisos (`requiereVendedora` dice «es una vendedora», no «cuál»), y un recorte
presentado como frontera sería una frontera imaginaria. Lo que sí hay es rastro: `asignada_por`.

**Y solo existe sobre la línea de Cloud API**, no por elección: el `referral` lo manda Meta y solo
llega por su webhook. Las tres líneas de las vendedoras son whatsmeow y ahí el dato no existe —
ofrecer la pantalla para ellas sería ofrecer una decisión que no se puede tomar.

## La vista, y la primera llave por persona

Routing es la **décima** del riel (`src/features/routing/`) y entra por el criterio de ADR 0034: es
un LUGAR con acción primaria nombrable («elegir quién atiende una campaña»). La ve quien esté en
`VEN_ROUTING` (`features/vistas/acceso.ts`).

🔴 **Eso es visibilidad, no una frontera**, y decirlo importa más que el código: mientras la vista
solo lea `/api/routing` —que está detrás del perímetro como todo lo demás— esconderla del riel no
protege nada. El día que haya algo que recortar, el recorte va en el `WHERE` de su ruta (ADR 0035 y
0036), no en el riel.

🔴 **Y la décima vista rompió los atajos.** El rango de ⌘N se «derivaba» de `VISTAS` pero comparando
**cadenas**: `e.key <= String(VISTAS.length)`. Con nueve anda de casualidad; con diez, `String(10)`
es `'10'` y `'2' <= '10'` da **false** — quedaba andando ⌘1 y se rompían las ocho del medio. El
candado histórico del repo («el que importa es el de la ÚLTIMA vista») **no puede ver este defecto**:
la décima no tiene tecla, así que el test de «la última se abre con su tecla» ni se puede escribir, y
el que se pone rojo es ⌘2. Ahora se compara el número y el tope es
`Math.min(vistas.length, TECLAS_DE_VISTA)`, donde 9 es cuántas teclas de dígito hay — no un tope de
diseño. Verificado poniéndolo rojo.

## Evidencia

Server real contra una base local sembrada con las **92 llegadas reales** de producción, y el
refresco contra Meta de verdad: `preguntados 14 · resueltos 14 · fallaron 0`.

- `docs/evidencia/routing-campanas.png` — las dos campañas con su estado y su volumen real.
- `docs/evidencia/routing-campana-elegida.png` — elegir una vendedora y que quede.
- `docs/evidencia/routing-riel-luz-no-la-ve.png` — el riel de quien no tiene la vista.

Reproducir: `server/scratchpad/sembrar-routing-demo.mjs` (siembra desde un volcado read-only de
prod) y `scratchpad/capturar-routing-campanas.mjs`.

## Lo que queda abierto

- **`?todo=1` es la única forma de refrescar el ESTADO.** Una campaña que se pausó ayer sigue
  diciendo «activa» hasta que alguien la vuelva a preguntar. Un cron con
  `npm run routing:refrescar -- --aplicar --todo` lo resolvería; no se puso porque todavía no hay a
  quién le duela.
- **Repartir por campaña no reparte el pasado**: las 1.083 asignaciones `manual` que dejó la difusión
  siguen donde están.
- **No hay «varias vendedoras por campaña»** (una campaña con su propia rueda chica). Se puede, y no
  se hizo: hoy son dos campañas y cuatro personas en la rueda.
