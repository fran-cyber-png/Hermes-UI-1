# ADR 0046 — La Libreta se comparte: espacios de trabajo, y la tercera frontera del repo

- **Fecha**: 2026-08-10
- **Estado**: aceptada
- **Decide**: Estephano («se tiene que poder compartir entre usuarios, tener espacios de trabajo
  compartidos y privados», 10-ago-2026). Las tres decisiones de forma, en §3.
- **Revierte**: la decisión «por autora, no por equipo» de **ADR 0012**, y el «no hace un espacio
  compartido del equipo» de **ADR 0034 §7**.
- **Plan**: `docs/plan-libreta-espacios.md`

## 1 · Qué se revierte, y por qué recién ahora

Tres documentos decían que esto no se hacía, y los tres daban **el mismo motivo**: Hermes no tiene
modelo de permisos, así que compartir sería «todos editan todo» o inventar permisos.

| Dónde | Qué decía |
|---|---|
| **ADR 0012** | «Por autora, no por equipo (a diferencia de `etiquetas`)… promoverlo a compartido es otro frente.» |
| **ADR 0034 §7** | «No hace un espacio compartido del equipo. Arrastraría una decisión que hoy no hace falta tomar.» |
| `plan-libreta-que-deberia-tener.md` §5 | «No colaboración en vivo… arrastra infraestructura **y permisos**.» |

Se elige la primera de las dos salidas —**todos los miembros editan todo**— y se paga el precio de
frente: hay **un** rol nuevo (quien creó el espacio), no tres.

Lo que sigue valiendo entero de ADR 0012: **una nota no deriva nada** —ni etapa, ni recordatorio, ni
envío—, se archiva y no se borra, y **no hay botón de mandar**.

### La evidencia, con la parte que incomoda incluida

A favor: el contraargumento que quedó anotado el 8-ago —*«quizá nadie escribe PORQUE no se puede
compartir»*— nunca se pudo descartar, y este frente es lo único que lo prueba.

En contra, medido el 10-ago en producción: la libreta tiene **5 páginas y 65 caracteres en total**, y
las cinco son pruebas («asdasd», «ryvv», «/»). Cuatro nacieron el día del lanzamiento y **ninguna
vendedora volvió**. El control es `eventos_contacto`: salió un día después, resuelve un dolor
documentado, vive en el chat, y tiene **1 fila**.

> **Lo que eso obliga**: la métrica de éxito **no es «se creó un espacio»**. Es **contenido real en un
> espacio con más de un miembro, escrito por alguien que no lo creó.**

## 2 · El modelo: `espacio_id IS NULL` es «mi libreta»

```
una nota se ve  ⟺  (espacio_id IS NULL  ∧  vendedora_id = yo)     ← mi libreta privada
                ∨  (espacio_id = E      ∧  yo soy miembro de E)   ← un espacio
```

**Por qué el privado es implícito y no una fila sembrada por persona:**

- **Cero backfill.** Las 5 filas de producción quedan donde están y significan lo mismo que antes.
- **Leer no escribe.** Un espacio creado al abrir la Libreta sería una escritura adentro de un GET —
  la regla que `identidad/` fija («leer una ficha JAMÁS escribe en el grafo»).
- 🔴 **Sin la migración, degrada EXACTAMENTE a la libreta de hoy.** `espaciosDe` devuelve `[]`, la
  regla colapsa a `vendedora_id = yo`, y la pantalla es la de siempre. Degrada hacia **menos**, nunca
  hacia más: es lo contrario del catálogo de piezas (ADR 0023) y por el mismo criterio — acá el
  consumidor es una persona, y para una persona la degradación honesta es ver lo suyo.

Y **«privado» en plural no se pierde**: un espacio puede tener **un solo miembro**.

⚠️ **`espacio_id` es un eje DISTINTO de `clave`, y no se colapsan.** `clave` dice a QUÉ está anclada
la nota (una conversación, o la libreta); `espacio_id` dice **quién la ve**.

## 3 · Las tres decisiones del dueño (10-ago-2026)

1. **Miembros elegidos uno por uno.** No hay un espacio «Goberna» automático que vean todas.
2. **Todos los miembros editan todo**; quien lo creó administra miembros y archiva.
3. **Tiempo real tipo Google Docs** como destino — **no** en este ADR (§7).

## 4 · Esto es una FRONTERA, y es la tercera del repo

Todo lo que recorta en Hermes está escrito como **filtro y no permiso** («Las mías» en
`cola/lineas.ts`, «Míos» en `cola/asignadaSql.ts`), porque la cola es una pantalla compartida donde
cualquiera abre cualquier conversación y presentar ese recorte como frontera sería **una frontera
imaginaria — peor que ninguna, porque se le cree**. Las excepciones eran dos: el padrón (ADR 0035) y
el Dashboard (ADR 0036).

**Ésta es la tercera, y hay que decir de qué es**: una página de un espacio del que no sos miembro
**no se sirve, ni pidiéndola por id**. Por eso vive en el `WHERE` (`visibleParaSql`) y no en un `if`
del navegador — un recorte dibujado en el front no existe, los datos ya viajaron.

🔴 **Y también del lado de la ESCRITURA** (`puedeEscribirEn`). Es el agujero que no se ve mirando la
lectura: el `POST` lleva `espacioId` en el body, así que sin esa guarda cualquiera **planta** una
página adentro del espacio de otro equipo mandando un número — y la lista de ese equipo la muestra
como una página más y de nadie.

Lo que **no** cambia: el hilo, la ficha y el envío siguen sirviendo cualquier conversación a cualquier
token. Hermes sigue sin modelo de permisos general.

## 5 · Lo que se cayó del modelo

- 🔴 **`editarNota`/`archivar`/`desarchivar` dejan de ser «solo la autora».** Antes eran tres copias
  de `existente.vendedoraId !== opciones.vendedoraId` en tres cuerpos; ahora la regla vive una vez
  (`noPuedeTocar`). Con tres copias, la próxima mutación copia la que tenga más cerca, y basta que una
  quede con la regla vieja para que un espacio compartido sea de solo lectura en esa operación.
  ⚠️ **Sobre una nota privada las dos reglas dan lo mismo**: nadie pierde el candado que tenía.
- **La búsqueda deja de estar clavada a `clave = 'general'`** — era el punto 11 de
  `plan-libreta-que-deberia-tener.md`, anotado cuando el conjunto oculto tenía tamaño cero. Buscar y
  no encontrar la página del equipo sería la peor forma de compartir, porque **no se ve que falta
  nada**. El GIN no se reindexa: `to_tsvector('spanish', texto)` nunca tuvo `clave` adentro.
- **`vendedora_id` sigue siendo QUIÉN LA ESCRIBIÓ.** Ya no es quién la ve. Se muestra en la fila
  —solo dentro de un espacio, y solo si no sos vos— porque es lo que decide a quién preguntarle por
  ese precio. Editar una página ajena **no reescribe su autoría** (con test).
- **El padrón de a quién invitar NO se inventa**: es rueda ∪ `numero_vendedora` (9 personas hoy),
  reusando `destinosPosibles` de `reparto/destino.ts`. Con dos implementaciones, la pantalla ofrecería
  una lista y el server aceptaría otra (#37). Un destino desconocido es **409 enumerando a quién sí se
  puede**, nunca un 200 que se traga el dedazo.
- 🔴 **A la creadora no se la puede sacar, ni ella misma.** El espacio quedaría sin nadie que pueda
  administrarlo —agregar exige ser la creadora, verlo exige ser miembro—, o sea un lugar imposible de
  arreglar desde la app. Para irse del todo, se archiva.
- **Archivar el espacio no toca las páginas**: se archiva el lugar, no lo escrito.

## 6 · 🔴 Las dos grafías, otra vez — y acá el fallo es no ver nada

Medido en producción: `numero_vendedora` dice **`Luz`**, `sesiones_cerberus` dice **`luz`**, y hay
`usuario1` y `Usuario1`. El `vendedoraId` del token es **lo que se tipeó en el login**.

Con comparación exacta, **a Luz la agregan a un espacio y no lo ve nunca**: sin error, sin fila
huérfana, sin conteo que no cierre. Se compara normalizando **de los dos lados** (`mismaVendedora` en
el server, `mismoUsuario` en el front) y **se guarda la grafía que vino** — reescribirla rompería el
cruce con `gestiones` y `estado_conversacion`. **Lo que reabre el agujero es normalizar de un lado.**

El índice `espacio_miembro_vendedora_idx` va sobre `lower(vendedora_id)` por eso, no por rendimiento:
sin él, ese `lower` deja afuera el índice normal en la consulta más caliente de la vista.

## 7 · Lo que este ADR NO hace

- **No hay tiempo real todavía.** Es la decisión 3 del dueño y es un frente propio, porque arrastra
  cuatro cosas medidas: nginx de VPS1 **no soporta WebSocket** hoy (`/api/stream` declara
  `proxy_set_header Connection ""`, lo contrario de un `Upgrade`); `index.ts:182` es `app.listen(port)`
  pelado, sin `http.Server` donde colgar el `upgrade`; el **WebSocket del navegador no manda
  `Authorization`** (la misma cicatriz de `lib/datos/sse.ts`, pero ahí la salida fue `fetch` y acá no
  existe); y 🔴 **`notas.texto` es una columna DERIVADA** que se calcula dentro de
  `crearNota`/`editarNota` — el persistidor de Yjs es «ese otro camino» del que advierte el schema, y
  tiene que recalcularla en la misma escritura o la página **se ve bien y no aparece nunca en la
  búsqueda**.
- **No hay lector/editor.** Decisión del dueño: un solo rol. El segundo es una columna.
- **No hay jerarquía de páginas ni espacios anidados.** Con 5 páginas en toda la base, sería
  estructura para contenido que no existe.
- **No se comparten las notas históricas de `gestiones`.** Viven en otra tabla, son de solo lectura y
  siguen siendo por autora: mostrarlas adentro de un espacio serviría las notas de gestión de una
  vendedora a todo el equipo por la puerta de atrás (con test).
- **Sin oro.** El dorado significa tiempo que se acaba, y acá no se acaba nada.

## 8 · Cómo se sabe si estuvo bien

```sql
-- Lo que importa: contenido de verdad, en un espacio de más de uno, escrito por
-- alguien que no lo creó.
SELECT e.nombre, count(*) FILTER (WHERE n.vendedora_id <> e.creada_por) AS de_otros,
       count(*) AS paginas, max(length(n.texto)) AS mas_larga
FROM espacios e JOIN notas n ON n.espacio_id = e.id
GROUP BY 1 ORDER BY 2 DESC;
```

Si a las dos semanas hay espacios y **cero páginas de alguien que no sea su creadora**, compartir no
era lo que faltaba — y ahí la pregunta vuelve a ser la del 8-ago: en Hermes lo que se usa es **un clic
que mueve algo**, no escribir.

Capturas: `docs/evidencia/libreta-espacios-*.png`.
