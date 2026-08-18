# ADR 0061 — La línea de campaña sólo la ve quien la atiende

- **Fecha**: 18-ago-2026
- **Estado**: aceptado — decisión del dueño
- **Enmienda de**: ADR 0036 (el Dashboard es de quien lo mira) y ADR 0059 (el
  tiempo real se filtra por dueña), que abren sus fronteras con el ROL. Ésta no.
- **Toca**: `server/src/numeros/campana.ts` (la regla) · la cola, el Pipeline, el
  radar, el embudo, las series, «El negocio» y «Equipo» · el selector de líneas ·
  el SSE · el hilo, la ficha de persona y todo envío de WhatsApp.

## El pedido

> «los supervisores tienen que poder ver las líneas de los demás vendedores.
> betto no lo pueden ver los supervisores. los supervisores de ventas son alan y
> alex y usuario1, betto no entra dentro de ventas.»

La primera mitad **ya funcionaba**: ninguno de los tres tiene filas en
`numero_vendedora`, así que el selector les ofrece «Todas» y la frontera de
asignación (`fronteraDeAsignacionSql`) no les recorta nada. La segunda mitad no
existía.

## Lo medido antes de escribir una línea (producción, 18-ago-2026)

| | |
|---|---|
| `equipo` | `alan` **admin** · `usuario1` **admin** · `alex` **supervisor** |
| La línea de Betto | `51963139984`, `numeros_wa.proposito = 'campana'`, la atienden `usuario2` y `centurion:betto.romero` |
| Su tamaño | **25 conversaciones** en la ventana de 30 días (233 filas de `interactions`), última actividad el 12-ago |
| Sus envíos | **80** por `envios_wa` en 30 días |

O sea: **dos de los tres «supervisores de ventas» son `admin`**. Si la regla se
escribiera contra el rol `supervisor`, el pedido quedaría cumplido a un tercio y
la diferencia no se vería en ninguna pantalla.

## La decisión

**Una línea con `proposito = 'campana'` sólo se le sirve a quien la atiende**
(`numero_vendedora`). A nadie más: ni a las vendedoras de la Escuela, ni a
supervisor, ni a admin.

La regla vive una vez, pura, en `server/src/numeros/campana.ts`, con su gemelo
SQL al lado y `campana.paridad.test.db.ts` cruzándolos en **todas** las
combinaciones de línea × identidad.

### Por qué por PROPÓSITO y no contra el número de Betto

La columna ya existe, es de donde lee `soloSusLineas` (`cola/lineas.ts`), la
mantiene quien da de alta el número, y **una segunda campaña hereda la regla sin
que nadie se acuerde**. Una lista de números a mano es una segunda fuente que se
desincroniza en silencio — la cicatriz de `HERMES_SUPERVISORES` vs. `VEN_ROUTING`.

### 🔴 Por qué el ROL no abre esta puerta, y es la única así

Todas las demás fronteras de Hermes se abren con `puedeSupervisar`: el padrón
(ADR 0035), el Dashboard (0036), la cola (`fronteraDeAsignacionSql`) y el SSE
(0059) le sirven todo a supervisor y admin, **porque quien supervisa es quien
reparte y no se puede repartir lo que no se ve**.

Acá no, y el motivo es que no es la misma clase de recorte: aquéllas separan el
trabajo de un equipo que comparte un negocio; ésta separa **dos negocios**. Un
supervisor de la Escuela no reparte los leads de la campaña de un candidato, así
que verlos no le habilita ninguna acción — sólo lo expone a datos de un cliente
de consultoría. Los dos planos de Goberna no se cruzan.

Por eso `esVedadaParaMi(linea, vendedoraId)` **no tiene un parámetro `veTodo`**:
la firma es la garantía, y si algún día aparece, `campana.test.ts` deja de
compilar antes de fallar.

### Lo que NO cambia

- **Administrar la línea sigue siendo de admin**: Routing, Equipo, alta y baja,
  `/api/admin/numeros/:numero`. Lo que se corta es **leer sus conversaciones**,
  que es otra cosa.
- **`soloSusLineas` no se toca**: sigue encerrando al operador de campaña en lo
  suyo. Son las dos mitades de la misma frase; ésta es la que faltaba.
- Una línea **sin registrar** en `numeros_wa` no se veda: no hay propósito que
  leer, y vedar por las dudas escondería tráfico real (`51987654321` tiene dos
  conversaciones en producción y ninguna fila en el registro).

## Dónde se aplicó, y por qué en cada lugar de esa forma

| Superficie | Cómo |
|---|---|
| Cola, chips y desglose del Pipeline | `AND` en `msgCte` — poda **antes** de que el `OR` de pins pueda saltarse la ventana |
| Radar del Dashboard | después del `UNION`, junto al recorte personal: una condición para las dos ramas |
| Embudo, series, «El negocio», «Equipo» | el mismo fragmento sobre `interactions.numero_propio` y `envios_wa.numero_propio` |
| Selector de líneas (`GET /api/whatsapp/lineas`) | filtra lo que se **ofrece**, después del recorte de `soloSusLineas` |
| SSE | `linea` pasa a ser un campo **requerido** de `EventoRT`, y se consulta **antes** que `esSuya` |
| Hilo, envío, adjunto, leído, foto, reaccionar, editar | **403 `linea_de_campana`** en la ruta |
| `/api/persona/*` | filtro en el `WHERE` → **404**, porque el id es un `serial` enumerable |

### 🔴 El gemelo SQL no recibe una lista leída antes: pregunta en la misma consulta

Es lo que hace que esto no tenga degradación que discutir. Si `numeros_wa` no se
pudiera leer, la consulta entera falla y no se sirve nada — que es lo que tiene
que pasar en una frontera. Con una lista traída aparte habría un `catch` y, con
él, la pregunta «¿y si no se pudo leer?», cuya única respuesta cómoda es servir
de más.

Las **rutas** sí necesitan la lista (lo que deciden es un 403, no un `WHERE`), y
por eso hay un segundo camino: `cargarLineasVedadas`, el gemelo de `cargarRol`.
Atrapa para que el proceso no se caiga —Express 4 no atrapa el rechazo de un
middleware `async`— pero **`vedadasDe(req)` tira**, así que la ruta termina en
500. No atrapar no es lo mismo que fallar abierto.

### 🔴 El hilo tiene DOS mitades y hacen falta las dos

Con `?numeroPropio=` de campaña se contesta **403**. **Sin** él, el hilo se sirve
igual y lo de campaña se cae adentro: `hiloDe` sin línea junta TODAS las líneas
de ese teléfono, así que un 403 ahí escondería **también la conversación de la
Escuela con la misma persona**.

### ⚠️ `hiloDe` NO tiene un default fail-closed, a propósito

Tres de sus cinco llamadores son maquinaria del server (`bot/orquestador.ts`,
`bot/contexto.ts`, `corridas/correrCorrida.ts`): leen el hilo para poder
contestar, y el bot que atiende una línea de campaña **es** esa línea. Un default
fail-closed le serviría un hilo vacío y contestaría sin contexto, sin un solo
error. La frontera se resuelve en la RUTA, que es el único lugar donde hay una
persona del otro lado.

## Lo que esto NO cierra

Sigue en pie lo que la auditoría del 17-ago-2026 §7.2 pide: el seam único
`puedeVerConversacion(rol, vendedoraId, clave)` para el aislamiento **entre
vendedoras** (~40 rutas). Ésta es una frontera de LÍNEA, que se puede escribir hoy
porque no depende de decidir qué significa «su supervisor» (§0.2, sin decidir).
No se parchearon 40 rutas: se tocaron las que sirven contenido de una
conversación de WhatsApp.

Tampoco se toca la **ficha de Cerberus** (`/api/contactos/ficha?telefono=`): es
el ERP de la Escuela y un lead de campaña no está ahí; recortarla es parte del
seam de arriba, no de esto.

## Los candados, y los cuatro se verificaron EN ROJO

- `numeros/campana.test.ts` — la regla, con las dos grafías y el borde sin identidad.
- `numeros/campana.paridad.test.db.ts` — SQL ≡ TS, todas las combinaciones.
- `cola/campanaFueraDeLaEscuela.test.db.ts` — el **cableado** en la cola, los
  conteos, el embudo y el radar, con un supervisor y un admin de sujeto.
- `routes/whatsapp.campana.test.db.ts` — los 403, con el montaje real.
- `realtime/visibilidad.test.ts` + `routes/stream.test.ts` — el SSE, regla y cable.
- `features/whatsapp/campanaEnHilo.test.tsx` — que la pantalla lo LEA.

Evidencia: `docs/evidencia/campana-selector-sin-betto.png`,
`docs/evidencia/campana-hilo-403.png`. Sin server:
`node scratchpad/api-campana.mjs` + `VITE_API_URL=http://localhost:4199 npx vite --port 5199`.
