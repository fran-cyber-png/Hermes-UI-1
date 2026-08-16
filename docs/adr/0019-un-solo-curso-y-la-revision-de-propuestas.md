# ADR 0019 — El curso de una conversación se decide UNA vez, y las propuestas del minado se revisan desde la app

**Fecha**: 2026-07-27 · **Estado**: aceptada · **Issues**: #128 (Dashboard por curso), #102/#129
(alias de curso), plantillas-secuencia.

## El contexto: dos síntomas que resultaron ser el mismo tema

El 26-jul pasaron dos cosas el mismo día:

1. El dueño puso la auto-respuesta en **supervisada**, entraron leads todo el día y hubo
   **cero recomendaciones**. En la base había dos plantillas en estado `propuesta` —el flyer
   del diploma con **418** conversaciones de respaldo y el seguimiento con **296**— y la app
   decía «Todavía no hay secuencias».
2. En «El negocio → Por curso» el Dashboard decía **«Sin curso identificado: 68 de 70
   (97 %)»** mientras, en la pantalla de al lado, la cola le pintaba a casi todas las filas
   el chip «Inteligencia Estratég…».

El hilo común es el mismo: **la app sabía el dato y no lo usaba**, y en los dos casos porque
la respuesta a «¿de qué curso es esto?» estaba escrita más de una vez.

## Las decisiones

### 1 · La precedencia del curso vive en un solo lugar (y su gemelo en SQL, atado con un test)

`interés registrado > curso del formulario > anuncio` — la regla que cerró el dueño en #72.
Hasta hoy estaba escrita **tres** veces: en el front para el chip, en `cursos/derivar.ts` para
la propuesta de la ficha, y —a medias, mirando solo el formulario— dentro del SQL del
Dashboard. La tercera divergió, y nadie se enteró hasta que alguien miró las dos pantallas
juntas.

Ahora la definición legible vive en **`cursos/precedencia.ts`** (pura) y su gemelo para las
consultas que agrupan, en **`cola/cursoSql.ts`**, al lado de los fragmentos que traen los
candidatos. El Dashboard **consume esos fragmentos**; no tiene los suyos.

**Por qué se acepta un gemelo y no una sola escritura**: la versión pura decide sobre una
fila ya traída; la de SQL agrupa 1.900 conversaciones dentro de Postgres. Traerlas para
decidir en TypeScript costaría el escaneo entero en cada apertura del panel. Lo que impide
que se separen es **`dashboard/curso.paridad.test.db.ts`**, que corre las dos sobre los mismos
datos sembrados y falla si difieren — el mismo mecanismo del ADR 0009 para la urgencia.

**Lo que este ADR NO hace**: unificar la copia del front (`src/dominio/curso.ts`).
Hoy coincide, y hacerla compartir código con el server necesita un paquete común que no
existe. Queda escrito acá para que se sepa que es la tercera copia viva.

### 2 · La traducción texto → familia se hace en TypeScript, aunque la agregación sea SQL

El Dashboard agrupa por **familia de curso**, no por texto crudo: las tres redacciones del
mismo diploma no pueden ser tres filas. Traducir requiere el matcheo por palabra entera con
preferencia por el alias más específico (`cursos/alias.ts`), y **eso no se reescribe en SQL**.

La consulta por curso pasó a ser dos: una pregunta qué textos distintos hay en el período,
se traducen en TypeScript con el único matcheador que existe, y la segunda agrupa con ese
mapa como `VALUES`. La agregación se queda en Postgres porque **la mediana de demora no se
puede sumar entre grupos**: juntar dos textos de la misma familia después de agregarlos daría
una mediana inventada.

### 3 · Hay alias por `adId`, no solo por texto

«Adquiérelo ahora» (22 personas), «No lo dejes pasar» (17) y «FORMA PARTE» (2) son anuncios
reales que **no nombran ningún curso**. Un alias de texto no los puede resolver sin inventar:
mapear la frase «adquiérelo ahora» haría que cualquier anuncio futuro con ese copy heredara
el curso equivocado.

Una fila de `alias_curso` con `ad_id` se compara **exacto** contra `origen.adId` y queda
fuera del matcheo por texto. Y un mapeo por anuncio le gana al título: **lo afirmado por una
persona gana sobre lo inferido de un texto**, la misma regla que hace que el interés
registrado le gane al formulario.

### 4 · Una propuesta minada es del EQUIPO; aprobarla es hacerse cargo

`plantillas.vendedora_id` es obligatorio, así que el script de minado las guarda bajo un id
—el que le pasaron por línea de comandos—. Con la visibilidad atada a esa columna, dos
propuestas con 418 y 296 conversaciones de respaldo eran invisibles para todo el mundo menos
para esa vendedora.

Una propuesta minada la ve cualquiera. **Es seguro por construcción**: una propuesta no se
puede enviar (guarda 1 de `routes/plantillas.ts`). Al aprobarla, la plantilla pasa a ser de
quien la aprobó — porque a partir de ahí sale a nombre de alguien, y ese alguien responde.
Una plantilla **aprobada** de otra vendedora sigue siendo privada.

### 5 · No se aprueba sin resolver el curso

El minado dejaba `familia_curso` en NULL. Una plantilla aprobada sin familia **no matchea con
ninguna conversación**: queda aprobada e inútil, sin ningún cartel que lo diga. Es
exactamente el estado en el que estaban las dos de producción.

Aprobar ahora exige una decisión: confirmar la familia que el minado infirió, elegir otra, o
marcar «sirve para cualquier curso» **a propósito**. Omitir la clave en el body no es lo
mismo que mandarla en `null`: lo primero es silencio y se rechaza con `falta_familia`. La
regla vive pura en `plantillas/aprobacion.ts`.

**Lo que NO bloquea aprobar**: un paso con la imagen pendiente. Aprobar es decir «el texto
está bien»; la imagen se carga después, y mandar un paso incompleto ya lo frena la guarda 2
de la ruta. Bloquear acá obligaría a subir el flyer para poder opinar sobre el texto, que son
dos decisiones distintas.

### 6 · El minado infiere la familia y no parte el saludo por la hora del día

Dos cambios al minado, los dos medidos:

- **La familia se infiere del propio texto** de la secuencia entera (el saludo no nombra el
  curso; el flyer del paso 2, sí). El humano confirma en vez de investigar.
- **«Buenos días» y «buenas tardes» son el mismo saludo.** La firma de un mensaje corta al
  encabezado (40 caracteres) y la hora del día caía adentro: el saludo de la asesora se
  partía en dos cohortes de ~195 y ~180 conversaciones y ninguno le ganaba al flyer. Por eso
  la secuencia de **dos pasos** que el dueño mostró —saludo, después flyer— no se proponía
  nunca: aparecían sus dos pedazos por separado. Colapsar el saludo horario la hace aparecer
  entera, con su paso 2 incluido.

## Consecuencias

- La fila «sin atribuir» del Dashboard baja de 97 % a lo que de verdad no se sabe, y pasa a
  significar **no saber nada** de la conversación. Un anuncio con volumen que el diccionario
  no sabe traducir sale con su texto crudo: ese gap hay que verlo, y `npm run cursos:gaps` lo
  lista con su `adId` listo para mapear.
- El chip de la cola dejó de perder el anuncio: leía `ultima_origen` y el referral de
  Click-to-WhatsApp viaja solo en el primer mensaje. Ahora la cola sirve `origen_anuncio`.
- **`alias_curso.ad_id` necesita `db:push` manual.** Hasta que corra, `aliasesActivos`
  reintenta sin esa columna: se degrada el mapeo por anuncio, no la atribución entera.
- Un cambio de precedencia ahora se hace en dos archivos y el test de paridad avisa si se
  hizo en uno solo.

## Qué reemplaza

- El cruce propio contra `leads` que vivía dentro de `dashboard/negocio.ts` (`leads_curso`):
  reemplazado por los fragmentos compartidos de `cola/cursoSql.ts`.
- La aprobación de una propuesta desde el despliegue de la fila en `PanelPlantillas.tsx`, que
  dependía de `POST /preparar` y por lo tanto de tener una conversación abierta y Cerberus
  vivo: reemplazada por `RevisionPropuesta.tsx`, que se lee sin nada de eso.
