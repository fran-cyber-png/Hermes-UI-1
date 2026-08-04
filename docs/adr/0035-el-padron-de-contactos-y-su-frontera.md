# ADR 0035 — El padrón de contactos, y la primera frontera de verdad de Hermes

- **Fecha**: 2026-08-04
- **Estado**: aceptado
- **Issue**: (frente nuevo; nace de la decisión del dueño del 4-ago)
- **Enmienda a**: nada. **Convive con** ADR 0011 (perímetro) y con la doctrina de
  «filtro, no permiso» de `cola/lineas.ts` y `cola/asignadaSql.ts`, que **no se
  toca**: lo de allá sigue siendo un filtro.

## El problema

La vista **Contactos** era un spotlight: se pegaba un teléfono y respondía si esa
persona ya era cliente de Cerberus. Una pregunta por vez, sobre alguien que la
vendedora ya tenía en la mano.

Lo que hace falta es lo otro: **a quiénes les hablamos ahora**. Esa lista existe y
no estaba en ninguna pantalla — son los contactos de `icarus.contacts`, y no son
pocos. Medido en VPS1 el 4-ago-2026:

```
contactos            72.923
con teléfono usable  71.341  (97,8 %)
con nombre           72.770
con correo           61.298
dicen haber comprado 10.564
tienen venta REAL     4.783   ← 55 % del contador no tiene nada detrás
```

Y una decisión de organización que la pantalla tiene que sostener: **ventas10 es
supervisor**. Reparte los contactos entre las vendedoras, y cada una trabaja lo
que le tocó.

## Las decisiones

### 1. Acá el recorte SÍ es una frontera, y por eso vive en el server

Todo lo demás que recorta en Hermes está documentado como **filtro y no permiso**,
con un argumento que sigue siendo cierto: la cola es una pantalla compartida,
cualquiera puede abrir cualquier conversación, y presentar ese recorte como
frontera sería una frontera imaginaria — peor que ninguna, porque se le cree.

La decisión del dueño para el padrón es la contraria: **la vendedora no ve el
padrón**, ve lo que le habilitaron. Eso es una frontera, y una frontera que se
dibuja en el navegador no existe: los datos ya viajaron. Por eso la ruta
`/api/padron/contactos` no sirve las 72.923 filas a un token que no es supervisor
— el recorte está en el `WHERE`, no en un `if` de React.

Lo que esto **no** cambia: el resto de Hermes sigue sin modelo de permisos. Una
vendedora sigue pudiendo abrir cualquier conversación. La frontera es de esta
pantalla, sobre datos que no llegaron por una conversación.

### 2. Supervisor por entorno (`HERMES_SUPERVISORES`), no por tabla

Hermes **no tiene padrón de usuarios**: el login es un handshake contra Django y
solo devuelve «entró» o «no entró». No hay dónde colgar un rol. Con un supervisor,
una tabla con su CLI es andamiaje para representar una lista de un elemento.

Lo que sí se hereda de `reparto_rueda` es que **no se edita desde la app**: quién
ve 72.923 contactos con nombre, teléfono, correo y DNI no puede estar a un clic de
cualquier token. Es deliberadamente incómodo.

**Fail-closed**: sin la variable, nadie es supervisor. Y no se dibuja como lista
vacía — la respuesta lleva `sinSupervisores` y la pantalla lo explica, porque una
tabla en blanco se lee «se perdieron los contactos», no «falta configurar esto».

### 3. El reparto se guarda en Hermes, no en icarus

A icarus **no le escribimos**: la conexión fuerza `default_transaction_read_only=on`
a nivel de servidor. Es la misma razón que el puente de ventas — icarus es la
plataforma multi-tenant de los clientes de consultoría y sirve a un cliente real.

`icarus.contacts` tiene una columna `assigned_to` que parece exactamente esto y
**no lo es**: sus cinco valores son NÚMEROS DE LÍNEA (`+51944531711`,
`+51986394450`, `+51986855496`, `+593992073457`, `+51902829728`), no personas.
Responde «por qué línea pasó», no «de quién es».

El precio, dicho de frente: reparto y datos viven en bases distintas, así que **no
hay JOIN**. Se leen los ids de una y se piden esas filas a la otra. Por eso la
página tiene tope duro y por eso la lista de una vendedora no se puede servir con
icarus caído — ahí va un error que lo dice, nunca una lista vacía (la cicatriz de
ADR 0023).

### 4. «Compró» se pregunta a `icarus.sales`, nunca a `n_purchases`

10.564 contactos dicen haber comprado; 4.783 tienen una venta que lo respalde. El
contador lo copió verbatim el import de `leads_crm` y nadie lo recalculó — es el
mismo hallazgo de #133, entrando por otra puerta.

Si el filtro mirara el contador, el supervisor armaría un lote donde **más de la
mitad de los «clientes» nunca compró nada**, y la vendedora abriría el chat
saludando por una compra que no existe. En la tabla los tres estados se
distinguen: verde `Sí` con venta real, gris `sin respaldo` cuando icarus afirma sin
nada detrás, y `—`.

### 5. Un contacto, una dueña

`contacto_id` es PRIMARY KEY, no parte de una compuesta con la vendedora.
Habilitar el mismo contacto a dos personas es el defecto que el reparto de leads
existe para evitar. Re-habilitar **pisa**, que es lo que hace un supervisor cuando
alguien se va de vacaciones.

## Lo que deliberadamente no se hizo

- **No hay envío desde acá.** Repartir no manda nada. Lo que sigue —elegir
  plantilla y escribirle a un contacto que nunca escribió— es outbound en frío, y
  tiene un problema de canal antes que de código: las líneas de las vendedoras son
  whatsmeow (cliente no oficial) y abrir conversación en frío a cientos por ahí es
  el camino corto a que Meta revoque la línea. La línea del bot sí es Cloud API y
  puede abrir con **plantilla aprobada por Meta**. Esa decisión es de otro frente.
- **No se archivó el buscador por teléfono.** Consulta a Cerberus en vivo y trae
  folios y montos por venta; el padrón es una copia de icarus y no los tiene. Son
  dos preguntas, conviven en dos solapas.
- **No se copian los datos personales a Hermes.** `contacto_habilitado` guarda la
  asignación y nada más — misma decisión que `clientes_padron` (#133): es una tabla
  derivada y descartable, y una copia de nombre/teléfono/correo envejecería en
  silencio contra la fuente viva.

## Lo que se verificó

- `padron/supervisor.test.ts` (9) — la frontera, incluida la **grafía**:
  `Ventas10` configurado y `ventas10` tipeado son la misma persona. El defecto que
  ese test impide está vivo en producción con otra persona (Cerberus empuja `Luz`,
  ella entra como `luz`).
- `padron/filtros.test.ts` (10) — el vocabulario; una etapa que icarus invente
  mañana **pasa** y devuelve cero filas, no un 400.
- `padron/consultarPadron.test.db.ts` (15) — el SQL contra Postgres de verdad.
  Atrapó dos cosas que compilaban perfecto: `sql.array` serializando ids como
  `text[]` contra una columna `bigint` (la consulta reventaba entera), y que el
  total tiene que ser el del **recorte** y no el de la página.
- `padron/habilitados.test.db.ts` (11) — el reparto. Atrapó que `lower()` sin
  `btrim()` no es la misma normalización que `mismaVendedora`: un `vendedora_id`
  con un espacio de más pasaba al escribir y no encontraba una sola fila al leer.
- Evidencia visual: `docs/evidencia/padron-supervisor.png`,
  `padron-lote.png`, `padron-vendedora.png`.
