# ADR 0063 — Hermes son DOS módulos de CRM: ventas y campañas

**Fecha**: 19-ago-2026 · **Estado**: aceptada (fase 1 implementada) ·
**Amplía**: ADR 0061 · **Enmienda**: la decisión del 13-ago sobre «un producto, N instancias»
**Medición que la origina**: `docs/auditoria-frontera-campana-escuela.md`

## Qué se decidió

Decisión del dueño: **Hermes maneja los dos negocios, con entornos separados adentro**, y son
**dos módulos de CRM**:

- **`ventas`** — hoy la Escuela de Goberna, con Cerberus como verdad. Mañana, otros clientes.
- **`campana`** — hoy la candidatura de Betto. Mañana, otras campañas.

Ninguno es la excepción del otro. ADR 0061 trató a la campaña como una excepción de la Escuela
—una línea con `proposito = 'campana'` y cuatro superficies que su operador no tiene— y eso
alcanzaba con un solo candidato. Con N clientes de cada lado, «lo normal» tiene que pasar a ser
**un módulo con nombre**, para que una ruta nueva tenga que decidir a cuál pertenece en vez de
heredar la Escuela por no decir nada.

## Por qué hacía falta

ADR 0061 cerró **una** dirección: la línea de campaña ya no se le sirve a nadie de la Escuela. La
contraria estaba abierta, y medida contra producción (`febf7b8`) el 19-ago-2026:

- **Once rutas** servían Cerberus o icarus a cualquier token de vendedora, campaña incluida: la
  ficha con documento y compras, el formulario que **escribe** una venta en el ERP, el catálogo de
  productos, los argumentos de venta, el lazo de piezas, el cerebro RAG del negocio.
- 🔴 **Y el rol cruzaba los dos planos.** `centurion:betto.romero` está cargado como **admin** y
  `centurion:angie` como **supervisor** en la misma tabla `equipo` que la Escuela, y `cargarRol`
  resuelve por `persona_id` y nada más. Con eso `mandaEnElEquipo` les abría el padrón de **73.091**
  contactos de icarus (71.516 con teléfono, 61.471 con correo) —y `POST /habilitar-recorte` para
  **repartirlos**—, la facturación por curso y las campañas por plantilla.

La asimetría es el argumento: la campaña aporta **240 de 15.898** conversaciones (1,5 %) y el plano
al que accedía concentra el padrón, la facturación y el playbook de venta de Goberna.

## Cómo se implementó (fase 1)

`server/src/modulos/`:

- **`modulo.ts`** — el tipo `Modulo`, `moduloDe(lineas)` y `SUPERFICIES`, el mapa
  `prefijo → módulo` con las dieciséis superficies de `ventas`.
- **`deEsteModulo.ts`** — el middleware, que generaliza `numeros/soloEscuela.ts` (borrado). El
  mismo sirve a los dos lados: lo que cambia es el módulo con el que se construye.

Front: `PanelDerecho` recibe `esDeCampana` y **apaga las consultas**, no sólo el dibujo; la vista
**Contactos** sale del riel; `estadoDelContacto` gana una rama honesta (`sinCerberus`).

### Las decisiones que tienen filo

- 🔴 **El default del mapa es «compartido», al revés de un perímetro.** El motor de Hermes —la
  cola, el hilo, el envío, el reparto, los ✓✓, la agenda, el tiempo real— sirve igual a los dos
  módulos, y son las más. Lo que compensa ese default es el **barrido del árbol**: un test cruza
  cada router contra sus `import` de `cerberus/` e icarus y se pone rojo si aparece uno sin
  declarar. Vigila lo que todavía no se decidió, que es como nacieron las once.
- 🔴 **`moduloDe` sale de las LÍNEAS, no del namespace de la identidad.** Hoy los datos coinciden
  al 100 % (17 identidades `centurion:*` y ninguna de Cerberus atienden la campaña), pero hasta el
  15-ago la atendía `usuario2`, que es de Cerberus. Un segundo criterio que hoy da lo mismo decide
  distinto mañana sin que nada falle (#37).
- 🔴 **Fail-closed en el middleware, no en `moduloDe`.** Esa función tiene un default (`ventas`)
  que existe para la vendedora sin líneas; ante un error de lectura el middleware **no la llama**:
  contesta 500 y no deja pasar. Confundir los dos casos es cómo un fail-closed se vuelve fail-open
  sin que cambie una línea.
- ⚠️ **Dos subrutas, y van montadas ANTES que su router padre.** `/api/gestiones/intereses` y
  `/api/dashboard/negocio`: el resto de esos routers es CRM genérico. `app.use` matchea en orden,
  así que el padre montado primero atiende la subruta y el candado no corre nunca — sin error y sin
  log. Hay test.

## El embudo de campaña (fase 2)

`Te esperan → Contestaron → Simpatizan → Se comprometieron → Son voluntarios`, y
`Dijeron que no` al costado. Decisión del dueño del 19-ago-2026.

- 🔴 **LOS TRES PRIMEROS PELDAÑOS SE COMPARTEN, Y NO ES AHORRO.** `sin_respuesta`,
  `interesado` y `contactado` derivan de **quién habló** —no de plata—, así que son
  igual de ciertos en los dos módulos. Lo que cambia es la cola.
- 🔴 **LA COLA SE DECLARA, NO SE DERIVA — y eso invierte ADR 0044.** El embudo de
  ventas se deriva porque el comprador deja huellas verificables: un precio en el
  hilo, una venta en Cerberus. Un votante no deja ninguna. Que alguien «se
  comprometió» sólo lo puede afirmar quien habló con él.
- 🔴 **EL MODO DE FALLAR QUE ESTO TENÍA ARMADO ERA MUDO.** `ESCALA_ETAPAS` no es una
  lista: es una **tabla de rangos**, y `etapaEfectiva` resuelve con
  `escala.indexOf(manual) >= escala.indexOf(derivada)`, donde **`indexOf` da -1** para
  lo que no está. Con las etapas de campaña fuera de la escala, la vendedora declaraba
  «Se comprometió» y la tarjeta volvía sola a «Contestaron»: sin error, sin log, y sin
  forma de distinguirlo de «todavía no la moví».
- 🔴 **LA ESCALA SE ELIGE POR CONSULTA, y es correcto por construcción**: una consulta
  **nunca mezcla los dos módulos**. La mitad de arriba la garantiza
  `cola/lineas.ts:soloSusLineas` —un operador de campaña sólo ve sus líneas— y la de
  abajo, ADR 0061, que le veda esa línea a todo el que no la atiende. ⚠️ Si alguna de
  las dos se relajara, esto pasa a tener que resolverse **por fila** (join a
  `numeros_wa.proposito`), y el docblock de `escalaDe` es la única advertencia que hay.
- 🔴 **EN CAMPAÑA NO SE DERIVAN `cierre` NI `cotizado`**, y los dos vetos son por
  motivos distintos: `cierre` sale de `conversiones_wa`, que dice «esta persona compró
  alguna vez» —un teléfono que además le compró un diplomado a la Escuela ascendería a
  un peldaño que en campaña no existe—, y `cotizado` sale de un monto en el hilo, donde
  hablar de plata no es haber cotizado nada.
- 🔴 **SON CINCO COLUMNAS Y «NUNCA CONTESTARON» ES LA QUE SE CAE.** Seis no entran a
  1280 —medido al armar ADR 0050, con la captura de la última columna cortada contra el
  borde—, así que había que elegir. Se saca ésa y no un peldaño porque un comando
  contacta gente en frío por definición (el silencio es el caso normal, no una venta
  enfriándose) y porque **una escalera con un escalón faltante no se puede subir**.
  ⚠️ La etapa sigue existiendo: se deriva, se ve en Mensajes y se puede pedir con
  `?etapa=sin_respuesta`. Si en campaña pasa lo que pasó en ventas —«se me están
  desapareciendo los leads», Luz, 11-ago— esto se revierte y sale otra.
- 🔴 **LOS DOS TABLEROS TIENEN EXACTAMENTE CINCO COLUMNAS, Y ES UN INVARIANTE CON
  TEST.** `VistaEmbudo` llama a `useConversaciones` cinco veces con nombre fijo porque
  React prohíbe que la cantidad de hooks varíe entre renders. Un sexto elemento rompe la
  app con el error opaco de React, justo al cambiar de módulo.
- 🔴 **LA BARRA DEL CHAT PREGUNTA QUÉ SE PUEDE DECLARAR, no qué se dibuja.** Con la
  lista de ventas clavada, un operador de campaña podía declarar «Sabe el precio»: la
  gestión se guardaba y su propio tablero la devolvía al piso. `etapasDeclarablesDe` y
  `columnasDe` son dos preguntas distintas — `sin_respuesta` es columna y no se declara,
  `perdido` se declara y no es columna.
- ⚠️ **`ETAPAS_CONSULTABLES` pasa a ser la UNIÓN de los dos módulos**: la ruta
  `?etapa=` es compartida y resolver el módulo ahí costaría otra consulta para ganar
  nada — pedir `?etapa=comprometido` desde ventas no es una fuga, es una lista vacía.

## El territorio (fase 3)

Distrito y local de votación son lo que ningún CRM de ventas necesita y toda campaña sí. Tablas
`distrito` + `contacto_territorio` (migración **0037**), server en `server/src/territorio/`, ruta
`/api/territorio`, bloque en el panel y catálogo por CLI (`npm run territorio:distritos`).

- 🔴 **CATÁLOGO Y NO TEXTO LIBRE.** Un `zona` de texto era la opción barata y es exactamente la
  deuda que `eventos_contacto` existe para no repetir (ADR 0037): **texto libre no se agrupa, no se
  cuenta y no se cruza**. La pregunta que una campaña se hace todos los días —«¿cuántos
  comprometidos tengo en San Juan de Lurigancho?»— no se contesta con un `LIKE`.
- 🔴 **ES LA PRIMERA SUPERFICIE DE `campana` DEL REPO, y estrena el candado en el otro sentido.**
  Hasta acá el middleware sólo sabía negarle a la campaña lo de la Escuela. Una vendedora de ventas
  come 403 acá, y no porque el dato sea secreto: un distrito electoral no significa nada en su
  embudo y ofrecerlo sería ruido en la única pantalla donde decide a quién le escribe.
- 🔴 **LA LÍNEA SALE DE `numero_vendedora`, NUNCA DE UN `?linea=`.** Con el query string, cualquier
  operador de campaña leería el catálogo —y los conteos— de otra candidatura. Es justo lo que la
  fase de `entorno` viene a impedir entre rivales, cerrado acá por construcción antes de que el
  problema exista.
- 🔴 **EL DESTINO SE VERIFICA** (`distritoAjeno`), como en `reparto/destino.ts`: un `distritoId` de
  otra campaña es un número válido, escribe una fila válida y **nadie se entera** — la persona
  quedaría anotada en un distrito que su propia pantalla no muestra y del otro lado engordaría un
  conteo ajeno.
- 🔴 **El UNIQUE va sobre `lower(btrim(nombre))` y `claveDistrito` dice lo MISMO.** Con dos recetas
  entran «San Isidro» y «san isidro», que en la pantalla se ven iguales, y la campaña reparte su
  gente entre las dos — la cicatriz de `Luz`/`luz`.
- 🔴 **La FK es `restrict`, no `cascade`.** Con cascade, apagar mal un distrito se lleva en silencio
  el territorio de cada persona anotada ahí: el trabajo de campo de quien salió a caminar. El
  catálogo se apaga (`activo = false`), no se borra.
- ⚠️ **LEER degrada y ESCRIBIR no.** Sin la migración el catálogo viene vacío y el bloque lo dice;
  `anotarTerritorio` deja subir el error, porque un «guardado» que no guardó es peor que un error —
  la operadora sigue caminando y da el dato por tomado.
- ⚠️ **Los tres vacíos dicen cosas distintas y cada uno lo arregla otra persona**: «no tenés línea»
  (un admin), «no hay distritos cargados» (quien maneja la campaña, con el CLI), «todavía no le
  preguntaste» (ella misma, ahora).
- ⚠️ **El catálogo NO se edita desde la app**, como la rueda del reparto y los roles: qué distritos
  tiene una candidatura es decisión de quien la maneja, no una acción de la mesa de trabajo.
- ⚠️ **`local_votacion` NO entró.** Catalogar centros de votación es un import del padrón de la
  ONPE, y ponerlo como texto libre sería la misma deuda que el catálogo vino a evitar.
- ⚠️ **La clave es la CONVERSACIÓN**, como `gestiones` y `eventos_contacto`, porque Hermes no tiene
  tabla de personas. Hoy da igual —una campaña, una línea— y el día que tenga dos números la misma
  persona tendría que declarar su distrito dos veces.

## Lo que esto NO resuelve, y hay que decirlo

- 🔴 **NO aísla una campaña de OTRA campaña.** Separa `ventas` de `campana`; dos candidatos rivales
  caerían los dos en `campana` y se verían entre sí. Ese recorte es por **entorno** y va en el
  `WHERE` de las consultas compartidas. **Es la fase 3.**
- 🔴 **El rol sigue cruzando los planos.** Las once rutas quedaron cerradas por superficie, así que
  el agujero grande está tapado — pero `mandaEnElEquipo` le sigue diciendo `true` a un admin de
  campaña. **Es la fase 2**, y hay que hacerla igual: mientras el rol no conozca el módulo, la
  próxima ruta de supervisor nace abierta.
- ⚠️ **`eventos.ts` es residuo conocido**: `POST /` consulta el catálogo de Cerberus si el evento
  trae `curso`. No se veda el router entero porque el timeline es genérico. Se cierra con el
  vocabulario de campaña.
- ⚠️ **El test de paridad con base de campaña se escribió y NO se ejecutó**
  (`etapaCampana.paridad.test.db.ts`): Docker estaba apagado en la máquina donde se armó el frente.
  Compila con el typecheck y corre en N2b. **La paridad SQL ≡ TS no está verificada localmente.**

## El costo que se acepta

La decisión de un solo Hermes con entornos adentro **convierte el aislamiento en un `WHERE`**,
cuando la decisión del 13-ago lo había puesto en instancias separadas justamente porque dos
candidatos pueden ser rivales. Es viable y es lo decidido; lo que cambia es dónde vive la garantía:
en que ninguna consulta se olvide del recorte. Por eso la forma tiene que ser **un seam único con
gemelo SQL, test de paridad y un candado que rompa el arranque** si una ruta nueva no declara nada
— nunca parchear ruta por ruta, que es como se llegó a las 82 fugas de la auditoría del 17-ago.
