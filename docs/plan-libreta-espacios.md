# La Libreta se comparte — espacios de trabajo, privados y del equipo

> **10-ago-2026.** Pedido del dueño: «se tiene que poder compartir entre usuarios, tener espacios de
> trabajo compartidos y privados». Decisiones de forma tomadas por él el mismo día (§2).
>
> APIs verificadas contra el código instalado, no recordadas: `@blocknote/core@0.52.1` —sus tipos de
> Yjs (`yjs/extensions/index.d.ts`) son **del paquete npm, no de Hermes**: viven bajo
> `node_modules/@blocknote/core/types/`—, `server/src/reparto/destino.ts`, `server/src/index.ts:182`,
> nginx de VPS1 (`/etc/nginx/sites-enabled/*hermes*`).

---

## 1 · Qué revierte, dicho de frente

Tres documentos dicen hoy que esto no se hace. **No se rodean: se reemplazan** (regla dura #3).

| Dónde | Qué dice hoy |
|---|---|
| **ADR 0012** | «Por autora, no por equipo (a diferencia de `etiquetas`)… promoverlo a compartido es otro frente.» |
| **ADR 0034 §7** | «No hace un espacio compartido del equipo. Arrastraría una decisión que hoy no hace falta tomar: Hermes **no tiene modelo de permisos**.» |
| `plan-libreta-que-deberia-tener.md` §5 | «No colaboración en vivo… arrastra infraestructura **y permisos**.» |

Ese frente es este. Lo que sigue valiendo entero de ADR 0012 es lo otro: **una nota no deriva nada**
—ni etapa, ni recordatorio, ni envío— y se archiva, no se borra. **Sigue sin haber botón de mandar.**

### La evidencia que lo justifica, y la que lo contradice

A favor: el contraargumento honesto que quedó anotado el 8-ago —*«quizá nadie escribe PORQUE no se
puede compartir»*— nunca se pudo descartar, y es exactamente lo que este frente prueba.

En contra, y va escrito para que nadie lo lea de más: **medido hoy, la libreta tiene 5 páginas, 65
caracteres en total, y las cinco son pruebas** («asdasd», «ryvv», «/»). Cuatro nacieron el día del
lanzamiento y **ninguna vendedora volvió**. El control es `eventos_contacto`: salió un día después,
resuelve un dolor documentado, vive en el chat, y tiene **1 fila**.

> **Lo que eso obliga**: la métrica de éxito de este frente **no es «se creó un espacio»**. Es
> **contenido real en un espacio con más de un miembro, escrito por alguien que no lo creó.**

---

## 2 · Decisiones del dueño (10-ago-2026)

1. **Miembros elegidos uno por uno.** No hay un espacio «Goberna» automático que vean todas.
2. **Todos los miembros editan todo.** Un solo rol: el creador administra miembros. No hay
   lector/editor.
3. **Tiempo real tipo Google Docs** (Yjs, cursores a la vista) — el destino, no el primer paso (§6).

---

## 3 · El modelo: `espacio_id NULL` es «mi libreta», y eso no es un atajo

```
una nota se ve  ⟺  (espacio_id IS NULL  ∧  vendedora_id = yo)     ← mi libreta privada
                ∨  (espacio_id = E      ∧  yo soy miembro de E)   ← un espacio
```

**Por qué el privado es implícito y no una fila sembrada:**

- **Cero backfill.** Las 5 filas de producción quedan donde están y significan lo mismo que antes.
- **Leer no escribe.** Un espacio privado creado al abrir la Libreta sería una escritura en un GET —
  la regla que `identidad/` fija («leer una ficha JAMÁS escribe en el grafo»).
- **Degrada exacto a lo de hoy.** Sin la migración, `espacio_id` no existe y la regla colapsa a
  `vendedora_id = yo`: la libreta de siempre, no una pantalla vacía ni una fuga.

**Y «privado» en plural sigue existiendo**: un espacio puede tener **un solo miembro**. O sea que hay
«Mi libreta» (implícita, siempre) más cuantos espacios quieras, con los miembros que elijas —
incluida vos sola.

### El schema (migración `0022`, expand-only)

```sql
CREATE TABLE espacios (
  id          bigserial PRIMARY KEY,
  nombre      text NOT NULL,
  creada_por  text NOT NULL,          -- vendedora_id, la grafía QUE VINO
  creado_at   timestamptz NOT NULL DEFAULT now(),
  archivado_at timestamptz            -- se archiva, no se borra (ADR 0012)
);

CREATE TABLE espacio_miembro (
  espacio_id  bigint NOT NULL REFERENCES espacios(id),
  vendedora_id text NOT NULL,
  agregado_por text NOT NULL,         -- rastro, como `asignada_por` del reparto
  agregado_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (espacio_id, vendedora_id)
);
-- el índice que hace barata la pregunta «¿de qué espacios soy miembro?»
CREATE INDEX espacio_miembro_vendedora ON espacio_miembro (lower(vendedora_id));

ALTER TABLE notas ADD COLUMN espacio_id bigint REFERENCES espacios(id);
CREATE INDEX notas_espacio ON notas (espacio_id) WHERE espacio_id IS NOT NULL;
```

⚠️ **El `when` del journal es un contador monótono y falla en SILENCIO.** La próxima es idx **22**,
con `when` **> 1786795968155**. Se fija con `goberna-journal-set-when`, nunca a mano.

🔴 **`lower(vendedora_id)` en el índice y en TODA comparación.** El mismo humano tiene dos grafías
vivas en producción —Cerberus empuja `Luz`, ella entra como `luz`; y hay `usuario1` y `Usuario1`—.
Con comparación exacta, **a Luz la agregan a un espacio y ella no lo ve**, para siempre y sin un solo
síntoma. Se compara normalizando **de los dos lados** (`mismaVendedora`) y **se guarda la grafía que
vino**: reescribirla rompería el cruce con `gestiones` y `estado_conversacion`.

---

## 4 · Esto es una FRONTERA, no un filtro — y es la tercera del repo

Todo lo que recorta en Hermes está escrito como **filtro y no permiso** («Las mías», «Míos»), porque
la cola es una pantalla compartida donde cualquiera abre cualquier conversación, y presentar eso como
frontera sería una frontera imaginaria. Las excepciones son dos: el **padrón** y el **Dashboard**.

**Ésta es la tercera, y hay que decir de qué es**: una página de un espacio del que no sos miembro
**no se sirve, ni pidiéndola por id**. Vive en el `WHERE` de la consulta, nunca en un `if` del
navegador — un recorte dibujado en el front no existe, los datos ya viajaron.

Lo que **no** cambia: el hilo, la ficha y el envío siguen sirviendo cualquier conversación a
cualquier token. Hermes sigue sin modelo de permisos general.

### Las tres reglas que se caen del modelo

- **`editarNota` deja de ser «solo la autora»** y pasa a ser «miembro del espacio». Hoy es
  `existente.vendedoraId !== opciones.vendedoraId → 403` (`notas/notas.ts:227`). En una nota privada
  (`espacio_id IS NULL`) la regla nueva da exactamente lo mismo que la vieja.
- **Archivar y desarchivar siguen la misma regla** que editar. **Archivar el espacio es del creador.**
- **La búsqueda deja de estar clavada a `'general'`** (`notas/notas.ts:191`) y pasa a mirar todo lo
  visible. El GIN es `to_tsvector('spanish', texto)` y **no lleva `clave` adentro**: sigue sirviendo
  sin reindexar.

### El padrón de personas: no se inventa uno nuevo

Hermes no tiene tabla de usuarios. El único padrón que existe es **rueda ∪ `numero_vendedora`**, que
es lo que `reparto/destino.ts` ya usa para verificar el destino de una reasignación. Hoy tiene **9
personas** (medido): `Luz` · `Sindy` · `Tracy` · `Walter` · `ventas10@` … `ventas14@`.

Se reusa **la misma función pura** (`destinosPosibles`), pasándole la unión global en vez de la de una
línea. Con dos implementaciones, la pantalla ofrecería una lista y el server aceptaría otra (#37).

⚠️ Agregar a alguien que no está en el padrón es **409 enumerando a quién sí se puede**, nunca un 200
que se traga el dedazo — la misma decisión del reparto, por el mismo motivo: un `vendedora_id`
inventado escribe una fila válida y no tiene ningún síntoma.

---

## 5 · El corte

| PR | Qué | Migración | Despliegue |
|---|---|---|---|
| **1** | Espacios: schema, visibilidad, miembros, API | **sí (0022)** | N5 (botón) |
| **2** | La pantalla: selector de espacios, miembros, «quién tocó esto» | no | N4 |
| **3** | Tiempo real (Yjs) | no | N5 **+ nginx a mano** |

**El 1 y el 2 ya entregan el pedido**: compartir entre usuarios, con espacios privados y compartidos.
El 3 cambia *cómo se siente* editar de a dos, y es el único que toca infraestructura.

---

## 6 · PR 3 — lo que el tiempo real arrastra, medido

BlockNote **no es el problema**: `@blocknote/core/yjs` exporta `withCollaboration({fragment, user,
provider})` y las conversiones `blocksToYDoc` / `yDocToBlocks`. Falta instalar los peers (`yjs`,
`y-prosemirror`, `y-protocols` — **los tres MIT**). Lo de abajo sí es trabajo:

1. 🔴 **nginx de VPS1 no soporta WebSocket hoy.** `/api/stream` declara
   `proxy_set_header Connection ""` —lo contrario de lo que pide un `Upgrade`— y no hay
   `map $http_upgrade $connection_upgrade` en ningún lado. Es un cambio **a mano en producción**
   (regla dura #6: se avisa antes de tocar).
2. 🔴 **El server no expone el `http.Server`.** `index.ts:182` es `app.listen(port)` pelado; un
   `WebSocketServer` necesita `http.createServer(app)` y engancharse a `upgrade`.
3. 🔴 **El WebSocket del navegador NO manda `Authorization`.** Es la MISMA cicatriz que ya está
   escrita en `lib/datos/sse.ts` («EventSource no puede mandar headers, por eso se consume con
   fetch») — pero acá `fetch` no es una salida. Quedan el token en la query (**queda en los logs de
   nginx**) o el subprotocolo `Sec-WebSocket-Protocol`. **Se decide a propósito, no de pasada.**
   · La alternativa sin infra: Yjs sobre el **SSE que ya existe** para bajar y `POST` para subir
     (~200 ms de latencia, cero nginx, cero `ws`). Pierde el cursor fluido, no la mezcla automática.
4. 🔴 **LA TRAMPA QUE PIERDE LA BÚSQUEDA EN SILENCIO.** `notas.texto` es una columna **derivada** que
   se calcula dentro de `crearNota`/`editarNota`. El schema ya lo advierte: *«si `doc` se guarda por
   otro camino, `texto` queda viejo y la nota se ve bien en pantalla pero **no aparece nunca en la
   búsqueda**. No rompe: miente.»* **El persistidor de Yjs es exactamente ese otro camino**, y tiene
   que recalcular `texto` en la MISMA escritura, con test.

---

## 7 · Lo que este plan deja afuera a propósito

| | Por qué |
|---|---|
| Lector / editor por miembro | Decisión del dueño: un solo rol. Agregar el segundo es una columna, no un rediseño. |
| Espacios anidados, jerarquía de páginas | Con 5 páginas en toda la base, es estructura para contenido que no existe. |
| Comentarios en la página | `@blocknote/comments` arrastra `ThreadStore` + notificaciones. Otro frente. |
| Adjuntos | Sigue faltando `uploadFile` e infra de disco en VPS1 (sin GC, sin cuota, sin backup). |
| Subir el tope de 2.000 caracteres | El texto más largo escrito en la libreta tiene **47**. |
| Que la Libreta guarde precios y objeciones | **`hechos` ya lo hace**, es del equipo por construcción, y desde el 4-ago tiene pantalla propia. Duplicarlo parte la fuente de verdad. |
