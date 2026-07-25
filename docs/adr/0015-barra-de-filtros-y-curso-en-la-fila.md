# ADR 0015 — La barra de filtros de la cola y el curso en la fila

**Fecha:** 2026-07-25 · **Estado:** aceptado · **Issues:** #72, #129 (parcial) · **Reemplaza:** los dos
chips sueltos «Piden info» / «Por vencer» de la cabecera de la cola (ADR 0014, #49) y el chip «Pide
info» de la fila cuando el curso se conoce.

## Contexto

El dueño, mirando la cola en producción (2026-07-25):

> «podemos mejorar el "piden info" y "por vencer" que no me termina de convencer, y además agregar
> etiquetas ahí en scroll de izquierda a derecha»

Antes de tocar nada se hizo un **censo de la cola viva** (las 1.867 conversaciones de la ventana de
30 días, leídas por la API con la sesión de una vendedora de prueba):

| señal | filas | % |
|---|---|---|
| total en cola | 1.867 | 100 % |
| `pide_info` | 311 | 16,7 % |
| **`ventana_abierta` (lo que filtraba «Por vencer»)** | **0** | **0 %** |
| sin responder (`NOT respondida`) | 478 | 25,6 % |
| sin leer | 836 | 44,8 % |
| con origen de anuncio | 31 | 1,7 % |
| canal WhatsApp | 1.867 | 100 % |

Y el catálogo de cursos, del lado del dato: **26.075 leads** de formulario (todos de landing web,
con el curso en `campaign_name`), **1 solo interés asentado** en toda la base (#129), y **111
productos activos que son 38 familias con ediciones** — «Diploma de Especialización en Inteligencia y
Contrainteligencia **14**» no entra en una fila de 360 px.

## Decisión

### 1. «Por vencer» se retira del panel (no se renombra: no filtra nada)

Filtraba `ventana_abierta`, que solo es cierto para comentarios de FB/IG de menos de 7 días. Hoy la
cola es 100 % WhatsApp: el filtro devuelve **cero filas, siempre**. Un control que vacía la lista no
es un filtro, es un callejón sin salida — y encima su nombre nunca dijo *qué* vence.

Lo que **no** se tira:

- El concepto sigue vivo donde importa: el **reloj dorado de la fila**, que dice los días que quedan
  de la ventana de Meta. Ese es el lugar correcto para una cuenta regresiva por conversación.
- El server **sigue aceptando `intencion=por-vencer`**: un cambio de UI no rompe el contrato de la
  API (lo consume también el Pipeline con `?etapa=`).
- La migración del valor viejo `puedo-escribirle` (#49) deja de mapear a «Por vencer» y pasa a no
  filtrar: mandar a una vendedora que vuelve a una cola vacía es peor que no migrarla.

### 2. Entra «Sin responder», y todos los filtros muestran su número

«Sin responder» (`NOT respondida`) son 478 de 1.867: la deuda real de la mesa, y se entiende sin
que nadie la explique. Reusa la columna `respondida` que ya deriva `urgenciaSql.ts`; no define
ningún criterio nuevo.

Cada chip trae **su cifra dentro del recorte actual** (`conteosFiltro`, del mismo `SELECT` que el
total, con `count(*) FILTER`: sin consulta extra). Un filtro sin su número obliga a probarlo para
saber si vale la pena; con 1.867 conversaciones eso es un salto al vacío.

### 3. Una sola barra que se corre, con las categorías adentro

Los filtros y las **categorías de la vendedora** (con su color y su conteo, #48) viven en la misma
tira horizontal, con las favoritas primero. Sin barra de scroll a la vista (9 px de riel gris en un
panel de 400 px es ruido y come una fila): que hay más a los lados lo dice un **degradado en el
borde**, y se navega con la rueda del mouse, con Tab y con ← → (patrón `toolbar` de ARIA).

El botón de Listas que estaba arriba a la derecha se fue al final de la barra: dos puertas a lo
mismo era redundancia.

### 4. Se dice qué está filtrado, y se sale con un gesto

Con cualquier recorte activo, la cabecera escribe «N conversaciones con Piden info + Precio» y
ofrece **Ver todo**. Además, el chip encendido lleva su propia ✕. Una cola de 1.867 que muestra 12
sin decir por qué hace creer que no hay trabajo.

### 5. En la fila, el curso le gana a «Pide info»

`pide_info` es el 16,7 % de la cola entera, pero **311 de las 478 sin responder** — dos de cada tres
filas del trabajo pendiente. Un chip que aparece en dos de cada tres filas no ayuda a elegir a quién
atender primero; **qué curso quiere, sí**.

Conviven como pidió el dueño (#72), pero en 360 px no entran los dos: **cuando se conoce el curso,
gana el curso**; «Pide info» queda de respaldo para las filas sin curso. Precedencia del curso:

1. **el interés asentado** — la vendedora lo escuchó y lo registró: manda;
2. **el curso del formulario** que la persona llenó (lead emparejado por teléfono): su propia
   declaración;
3. **la campaña del anuncio** por el que escribió: de dónde vino, no lo que dijo.

Sin ninguna de las tres, **no hay chip**: no se infiere el curso leyendo el texto del mensaje.

Color por **hash de la familia** sobre la paleta `--cat-*` de #48 **sin el neutro y sin nada de la
familia del oro** — el oro en Hermes significa una sola cosa, tiempo que se acaba, y un curso no es
un reloj. El hash es sobre la *familia*, así que las tres redacciones del mismo diploma comparten
color.

### 6. El nombre corto sale de un módulo puro compartido

`familiaDeProducto(sku, nombre)` (`src/lib/producto.ts`) da `{ familia, edicion, nombreCorto }`: la
familia por el prefijo alfabético del SKU (`DIPICOT014` → `DIPICOT`, con los `GEN*` como familia
propia) o, sin SKU —el caso de la cola, que solo tiene texto—, por el nombre normalizado. Es el
mismo módulo que **#129** necesita para agrupar el autocompletado de intereses: se escribe una vez.

## Consecuencias

- **La cobertura del chip de curso hoy es delgada**: con 31 filas de origen-anuncio, ~125
  emparejadas con un lead y 1 interés asentado, se pinta en menos del 10 % de la cola. El chip es
  correcto y crece solo a medida que aterrizan #129 (interés desde la campaña) y #102 (interés
  derivado del anuncio); no es un cartel que haya que llenar a mano.
- **El listado paga un join a `leads`** (26.000 filas) para resolver el curso del formulario. Se
  arranca desde los sufijos de la cola para que sea **una pasada** y solo en la consulta de la
  página (ni el total ni los conteos del embudo lo pagan). Si el plan se degrada, el arreglo es un
  índice sobre la expresión del sufijo de `leads.phone`, no sacar el join.
- **Dos preguntas distintas sobre el mismo lead**: la ficha elige el lead con email
  (`elegirMejorLead`, para poder cotizar); la cola elige el **más reciente** (qué pidió la última
  vez). Está escrito en `cola/cursoSql.ts` para que no se lea como una divergencia.
- **Colisiones de color**: siete colores para 38 familias. Dos familias pueden compartir color; el
  texto es el dato, el color es la ayuda.
