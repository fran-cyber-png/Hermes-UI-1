/**
 * EL APLANADOR — de un documento de BlockNote al `texto` que se indexa y se busca.
 *
 * ══ POR QUÉ EXISTE ══════════════════════════════════════════════════════════
 *
 * La tabla `notas` suma `doc jsonb` NULLABLE (el documento rico) y **`texto text
 * NOT NULL` SE QUEDA como columna DERIVADA**. La decisión no es estética: el
 * índice GIN y el `WHERE` de `buscarNotas` (`to_tsvector('spanish', texto) @@
 * plainto_tsquery(…)`) no cambian **ni un carácter**, y la búsqueda sigue
 * funcionando el día del deploy — con las notas viejas, que no tienen `doc`, y
 * con las nuevas, sin una rama que las distinga.
 *
 * Esta función es esa derivación, y es **la costura única**: el server escribe
 * `texto = aTextoPlano(doc)` en el MISMO INSERT/UPDATE que escribe `doc`. Si
 * alguien guarda `doc` por otro camino, las dos columnas divergen **en
 * silencio** — la nota se ve bien en pantalla (se pinta desde `doc`) y no
 * aparece nunca en la búsqueda (que lee `texto`). Es la misma clase de fallo que
 * `piezas/version.ts` documenta para el join del lazo: no rompe, miente.
 *
 * ══ LA REGLA DE ORO: SE LEEN DOS CAMPOS, NO SE «RECORREN STRINGS» ═══════════
 *
 * Cada bloque de BlockNote arrastra ~4 cadenas que NO son texto de la persona:
 * el `id` (un uuid), el `type` (`"paragraph"`) y los props (`"default"`,
 * `"default"`, `"left"`). Un aplanador escrito como «juntá todos los strings que
 * encuentres» produce, para una nota de tres palabras:
 *
 *     "9f2c…-a1b3 paragraph default default left Pagó la primera cuota"
 *
 * y eso entra al `to_tsvector` **de todas las notas**: buscar `default` devuelve
 * la libreta entera. Por eso acá no se recorre en busca de cadenas: se leen
 * **exactamente dos campos por nodo** —`text` (la corrida) y `content` (lo
 * anidado)— más `children`, `rows` y `cells` para bajar. **`id`, `type`, `props`
 * y `href` no se tocan nunca**, y no hace falta una lista de exclusión que
 * alguien mantenga cuando BlockNote agregue un prop nuevo: lo que no está en la
 * lista corta no entra.
 *
 * ══ EL SEPARADOR — y el defecto que casi se cuela ═══════════════════════════
 *
 * Tres decisiones, y la tercera es la que una revisión adversaria encontró mal:
 *
 *   · **Entre corridas del MISMO bloque: NADA.** El texto de un párrafo viene
 *     partido en un `StyledText` por cada cambio de estilo, y el corte cae donde
 *     cayó el estilo — **puede caer adentro de una palabra**. Si alguien pone en
 *     negrita «añ» de «año», las corridas son `"añ"` y `"o"`: pegadas con un
 *     espacio dan `"añ o"`, dos lexemas, y `año` deja de existir en el índice.
 *     Las corridas son los caracteres del párrafo en orden; concatenarlas es
 *     reconstruirlo, no una convención elegible.
 *
 *   · **Entre BLOQUES: `\n`.** Sin separador, el final de un bloque y el
 *     principio del siguiente se pegan en un token que no existe. Entre `\n` y
 *     un espacio la búsqueda no nota la diferencia (`to_tsvector` trata todo
 *     blanco igual); gana `\n` por lo otro que hace `texto`: **se muestra**. Una
 *     nota de tres viñetas con espacios en vez de saltos es un párrafo ilegible.
 *
 *   · **Un nodo inline OPACO —ni `text` ni contenido— deja UN ESPACIO, no
 *     nada.** Acá estaba el defecto. El razonamiento de «entre corridas no va
 *     nada» vale entre CORRIDAS; aplicado a cualquier nodo, un inline que no
 *     aporta texto **desaparece y fusiona a sus vecinos**:
 *
 *         [corrida("Pagó la cuota"), {type:"loQueSea"}, corrida("Falta el DNI")]
 *           mal  → "Pagó la cuotaFalta el DNI"   ⇒ lexema `cuotafalta`
 *           bien → "Pagó la cuota Falta el DNI"
 *
 *     Con el lexema fusionado, **`cuota` deja de existir en esa nota** y la nota
 *     se vuelve inencontrable por una palabra que la persona sí escribió. No es
 *     un problema de búsqueda de frase: es un lexema que se pierde.
 *
 *     ¿Puede pasar de verdad? El schema por DEFECTO de BlockNote no tiene un
 *     nodo así — `defaultInlineContentSpecs` son `text` y `link`, y nada más
 *     (verificado en `TypeCellOS/BlockNote@main`, `packages/core/src/blocks/
 *     defaultBlocks.ts`). Pero **`CustomInlineContent` es tipo público y su
 *     `content` puede ser `undefined`**, así que en cuanto se registre un inline
 *     custom —una mención, un chip de curso— el nodo existe. Es latente, y el
 *     precio de cubrirlo es un espacio.
 *
 *     La distinción es fina y es la que hace correcto el archivo: una corrida
 *     con `text: ""` entra **verbatim** (es un tramo de la frase, no separa
 *     nada); un nodo SIN `text` que no produjo texto deja el espacio. Los dos
 *     casos están en los tests, y el del nodo opaco va **en el medio** del
 *     párrafo — al final, que es donde el `.trim()` del bloque lo tapa, el
 *     defecto es invisible y el test pasa igual.
 *
 * Los bloques vacíos **no dejan línea en blanco**: una nota con diez párrafos
 * vacíos entre dos frases no gasta su presupuesto de caracteres en `\n`.
 *
 * ══ TABLAS — degradación DECLARADA, no un reventón ══════════════════════════
 *
 * `TableContent` no es un `InlineContent[]`: es `{ rows: [{ cells: … }] }`, y
 * cada celda tiene su propio anidamiento (y viene en dos formas — una celda
 * objeto con su `content`, o el `InlineContent[]` pelado). Se aplana **una fila
 * por línea, celdas separadas por TAB**. Lo que se pierde, dicho de frente: la
 * estructura (qué celda es de qué columna, el header, los colspan) **no es
 * recuperable** desde `texto`. Está bien que se pierda — `texto` es para buscar
 * y para leer de reojo; la tabla de verdad vive en `doc` y se pinta desde ahí.
 * Lo que no se negocia es que el contenido de las celdas **sí** entre: una nota
 * cuyo dato importante está en una tabla no puede ser inencontrable.
 *
 * ══ DEFENSIVA SIN SER MENTIROSA ═════════════════════════════════════════════
 *
 * La entrada es una columna `jsonb`: puede venir `null`, de una versión anterior
 * del editor, o rota. **Nada de eso puede tirar una excepción** —una nota que no
 * se puede guardar es peor que una nota que se busca mal—, así que cada nodo que
 * no se entiende se saltea y se sigue. Pero **no se inventa**: si no hay texto,
 * la respuesta es la cadena vacía, nunca un placeholder ni el `type` del bloque
 * «para que se vea algo». El tope de profundidad existe por un caso concreto:
 * un `doc` con un ciclo (`doc[0].children === doc`) colgaría el request para
 * siempre — un aplanador puro no puede depender de que le pasen un árbol.
 *
 * ══ CONTRA QUÉ SE VERIFICÓ LA FORMA ═════════════════════════════════════════
 *
 * Las formas (`Block`, `StyledText`, `Link`, `TableContent`) son las de
 * **@blocknote/core@0.52.1**. Acá NO se importan: `@blocknote/core` no está
 * instalado en este repo, y esta función **no lo importa a propósito** —ni a él
 * ni a `@blocknote/server-util`, que monta un JSDOM para aplanar—. Es pura y sin
 * dependencias: se lee estructuralmente lo que el JSON traiga. El precio de no
 * importar los tipos es que un cambio de forma del editor no lo atrapa el
 * compilador; lo atrapan los tests, que son fixtures literales con la forma real.
 */

/** Entre BLOQUES. Ver arriba por qué `\n` y no un espacio. */
export const SEPARADOR_BLOQUE = "\n";

/** Entre CELDAS de una misma fila. La convención de texto plano de siempre. */
export const SEPARADOR_CELDA = "\t";

/**
 * Lo que deja un nodo inline que NO aportó texto. No es cosmético: es lo único
 * que impide que sus dos vecinos se fusionen en un lexema que nadie escribió.
 */
export const SEPARADOR_INLINE_OPACO = " ";

/**
 * Tope de anidamiento. No es un límite de producto (una lista de 50 niveles no
 * existe): es el freno para un `doc` con un ciclo, que si no cuelga el proceso.
 */
const PROFUNDIDAD_MAXIMA = 50;

/** Un objeto JSON, que no es un array. Los arrays se preguntan aparte. */
type Nodo = Record<string, unknown>;

function esNodo(valor: unknown): valor is Nodo {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor);
}

/**
 * UN NODO INLINE → su texto.
 *
 * El orden de las ramas ES la regla del separador, y no se puede reordenar:
 *
 *   1. Una cadena suelta se toma tal cual. El slot `content` es contenido por
 *      definición —nunca metadatos—, así que si ahí hay una cadena, es texto.
 *   2. **Una corrida (`text`) entra VERBATIM, aunque sea `""`.** Es un tramo de
 *      la frase: no separa nada, ni siquiera cuando está vacía.
 *   3. Lo anidado (`content`) se recorre: un `Link` —cuyo texto vive adentro y
 *      **cuyo `href` no es texto legible**, nadie busca una nota por su URL— o
 *      un inline custom.
 *   4. **Todo lo demás deja un espacio**, no nada: un nodo que no se entiende
 *      igual OCUPÓ UNA POSICIÓN entre dos textos, y borrarlo los pega.
 *
 * Frenar por profundidad cae en (4) a propósito: truncar es aceptable, fusionar
 * lo que quedó a los lados no.
 */
function textoDeInline(nodo: unknown, profundidad: number): string {
  if (typeof nodo === "string") return nodo;
  if (profundidad > PROFUNDIDAD_MAXIMA || !esNodo(nodo)) return SEPARADOR_INLINE_OPACO;
  if (typeof nodo.text === "string") return nodo.text;

  const anidado = textoDeContenidoInline(nodo.content, profundidad + 1);
  return anidado === "" ? SEPARADOR_INLINE_OPACO : anidado;
}

/**
 * El `content` de un bloque (o de una celda) → su texto, en UNA línea.
 *
 * El `join("")` es la decisión del separador entre corridas, y es la línea más
 * delicada del archivo: las corridas son los caracteres del párrafo, partidos
 * por dónde cambió el estilo. Cualquier cosa entre medio parte palabras — y por
 * eso el espacio de un nodo opaco lo pone `textoDeInline`, que sí sabe si lo que
 * vio era una corrida o no.
 */
function textoDeContenidoInline(contenido: unknown, profundidad: number): string {
  if (typeof contenido === "string") return contenido;
  if (profundidad > PROFUNDIDAD_MAXIMA || !Array.isArray(contenido)) return "";
  return contenido.map((nodo) => textoDeInline(nodo, profundidad + 1)).join("");
}

/**
 * Una celda: o el objeto `{ type: "tableCell", content: [...] }`, o el
 * `InlineContent[]` pelado (las dos formas conviven en `TableContent`).
 * `textoDeInline` ya sabe bajar por `content`, así que el objeto no necesita
 * rama propia.
 */
function textoDeCelda(celda: unknown, profundidad: number): string {
  if (Array.isArray(celda)) return textoDeContenidoInline(celda, profundidad + 1);
  return textoDeInline(celda, profundidad + 1);
}

/**
 * Una tabla → una línea por fila. Se reconoce **por su forma** (`rows` es un
 * array) y no por `content.type === "tableContent"`: un `type` nuevo o
 * renombrado del lado del editor tiraría el contenido de la tabla al piso en
 * silencio, que es exactamente el fallo que este archivo viene a evitar.
 */
function lineasDeTabla(contenido: Nodo, profundidad: number): string[] {
  const filas = contenido.rows;
  if (!Array.isArray(filas)) return [];

  const lineas: string[] = [];
  for (const fila of filas) {
    const celdas = esNodo(fila) && Array.isArray(fila.cells) ? fila.cells : [];
    const textos = celdas
      .map((celda) => textoDeCelda(celda, profundidad + 1).trim())
      .filter((texto) => texto !== "");
    if (textos.length > 0) lineas.push(textos.join(SEPARADOR_CELDA));
  }
  return lineas;
}

/**
 * UN BLOQUE → sus líneas: la suya (si tiene texto) y las de sus hijos.
 *
 * Los hijos ANIDAN —una lista con sub-ítems es recursión— y cada uno es un
 * bloque completo, o sea **su propia línea**: la sub-viñeta no se pega al final
 * de la viñeta madre. La viñeta en sí (el `•`, el `1.`) no se escribe: es del
 * `type`, no del texto, y en el índice sería ruido idéntico en cada nota.
 */
function lineasDeBloque(bloque: unknown, profundidad: number): string[] {
  if (profundidad > PROFUNDIDAD_MAXIMA || !esNodo(bloque)) return [];

  const lineas: string[] = [];
  const contenido = bloque.content;

  if (esNodo(contenido)) {
    lineas.push(...lineasDeTabla(contenido, profundidad + 1));
  } else {
    // El `.trim()` recorta el bloque entero, ya reconstruido: los espacios de
    // ADENTRO (los de «…la primera cuota el » + «viernes», y el que deja un nodo
    // opaco en el medio) ya se concatenaron y no los toca nadie. Es también lo
    // que hace que un nodo opaco al BORDE del párrafo no deje basura.
    const propia = textoDeContenidoInline(contenido, profundidad + 1).trim();
    if (propia !== "") lineas.push(propia);
  }

  if (Array.isArray(bloque.children)) {
    for (const hijo of bloque.children) lineas.push(...lineasDeBloque(hijo, profundidad + 1));
  }

  return lineas;
}

/**
 * EL DOCUMENTO ENTERO → el `texto` que se guarda, se indexa y se muestra.
 *
 * Recibe `unknown` y no un `Block[]` **a propósito**: lo que llega es una
 * columna `jsonb` o el body de un request, y tiparlo como si fuera un documento
 * válido sería afirmar en el tipo algo que nadie verificó. Total: siempre
 * devuelve una cadena. Sin texto, la cadena vacía — «vacío» y «roto» se ven
 * igual desde acá, y la diferencia la sabe el que valida la nota
 * (`validarTexto`), que es quien tiene que rechazarla.
 */
export function aTextoPlano(doc: unknown): string {
  if (!Array.isArray(doc)) return "";

  const lineas: string[] = [];
  for (const bloque of doc) lineas.push(...lineasDeBloque(bloque, 0));
  return lineas.join(SEPARADOR_BLOQUE);
}
