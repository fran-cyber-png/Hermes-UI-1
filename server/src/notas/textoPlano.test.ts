import { test } from "node:test";
import assert from "node:assert/strict";
import { SEPARADOR_CELDA, aTextoPlano, hayAnotaciones } from "./textoPlano.js";

/**
 * Puro, sin IO: el aplanador de BlockNote. Los fixtures son documentos CON SU
 * RUIDO —el uuid, el `type`, los tres props— porque el ruido es el punto: la
 * columna `texto` es lo que indexa el GIN, y si ahí entra `"default"` la
 * búsqueda de la vendedora devuelve la libreta entera.
 *
 * Nada se importa de `@blocknote/core` (ni acá ni en el módulo): las formas son
 * las de 0.52.1, escritas a mano como fixtures literales.
 */

/** Una corrida de texto tal como la guarda el editor, con sus estilos. */
function corrida(texto: string, estilos: Record<string, boolean> = {}) {
  return { type: "text", text: texto, styles: estilos };
}

/** Un bloque tal como lo guarda el editor: con uuid, type y los tres props. */
function bloque(tipo: string, contenido: unknown, extras: Record<string, unknown> = {}) {
  return {
    id: "9f2c4b1e-7a3d-4c58-8b91-0e6f2a5d3c47",
    type: tipo,
    props: { textColor: "default", backgroundColor: "default", textAlignment: "left" },
    content: contenido,
    children: [],
    ...extras,
  };
}

test("un párrafo simple es su texto, sin nada alrededor", () => {
  const doc = [bloque("paragraph", [corrida("Pagó la primera cuota")])];
  assert.equal(aTextoPlano(doc), "Pagó la primera cuota");
});

test("las corridas de UN MISMO párrafo se pegan sin separador (son la misma frase)", () => {
  const doc = [bloque("paragraph", [corrida("Pagó la primera cuota el "), corrida("viernes", { bold: true })])];
  assert.equal(aTextoPlano(doc), "Pagó la primera cuota el viernes");
});

test("un estilo que corta ADENTRO de una palabra no la parte en dos", () => {
  // El caso que decide el separador entre corridas: con un espacio en el medio,
  // `año` no existiría en el índice y «todo un año» no se podría buscar.
  const doc = [
    bloque("paragraph", [corrida("el acceso es por todo un "), corrida("añ", { bold: true }), corrida("o")]),
  ];
  const salida = aTextoPlano(doc);
  assert.equal(salida, "el acceso es por todo un año");
  assert.ok(salida.includes("todo un año"), "la frase entera tiene que quedar buscable");
});

test("una corrida VACÍA no separa: es un tramo de la frase, no un nodo opaco", () => {
  // La contracara del test de abajo, y la distinción fina del módulo: `text: ""`
  // entra verbatim. Si dejara un espacio, `año` se partiría igual que arriba.
  const doc = [bloque("paragraph", [corrida("añ"), corrida(""), corrida("o")])];
  assert.equal(aTextoPlano(doc), "año");
});

test("un nodo inline OPACO EN EL MEDIO no fusiona a sus vecinos", () => {
  // ── EL TEST QUE ATRAPA EL DEFECTO ──
  // Un inline sin `text` ni `content` (un `CustomInlineContent` con `content:
  // undefined`, que es tipo público de BlockNote) ocupó una posición entre dos
  // textos. Si desaparece, `to_tsvector` produce el lexema `cuotafalta` y
  // **`cuota` deja de existir en esa nota**: la nota se vuelve inencontrable por
  // una palabra que la persona sí escribió.
  //
  // Va EN EL MEDIO a propósito: al final del párrafo, el `.trim()` del bloque lo
  // tapa y el defecto es invisible — un test que lo ponga ahí pasa igual.
  const opaco = { type: "chipDeCurso", props: { curso: "inteligencia" } };
  const doc = [bloque("paragraph", [corrida("Pagó la cuota"), opaco, corrida("Falta el DNI")])];

  const salida = aTextoPlano(doc);
  assert.equal(salida, "Pagó la cuota Falta el DNI");
  assert.ok(!salida.includes("cuotaFalta"), "los dos textos NO se pueden pegar en un token que nadie escribió");
  assert.ok(!salida.includes("chipDeCurso"), "el type de un inline custom no es texto");
  assert.ok(!salida.includes("inteligencia"), "y sus props menos todavía");
});

test("un nodo opaco al BORDE del párrafo no deja basura: lo recorta el trim del bloque", () => {
  const opaco = { type: "loQueSea", props: {} };
  const doc = [bloque("paragraph", [opaco, corrida("Pagó la cuota"), opaco])];
  assert.equal(aTextoPlano(doc), "Pagó la cuota");
});

test("un heading entra como texto: el nivel es un prop, no una palabra", () => {
  const doc = [
    bloque("heading", [corrida("Acuerdos")], {
      props: { textColor: "default", backgroundColor: "default", textAlignment: "left", level: 2 },
    }),
    bloque("paragraph", [corrida("Paga el viernes")]),
  ];
  assert.equal(aTextoPlano(doc), "Acuerdos\nPaga el viernes");
});

test("una lista con hijos anidados: cada bloque su línea, sin viñetas inventadas", () => {
  const doc = [
    bloque("bulletListItem", [corrida("Diplomado de Inteligencia")], {
      children: [
        bloque("bulletListItem", [corrida("Se puede en 2 cuotas")]),
        bloque("bulletListItem", [corrida("El acceso dura un año")], {
          children: [bloque("bulletListItem", [corrida("Confirmado con Cerberus")])],
        }),
      ],
    }),
  ];
  assert.equal(
    aTextoPlano(doc),
    "Diplomado de Inteligencia\nSe puede en 2 cuotas\nEl acceso dura un año\nConfirmado con Cerberus",
  );
});

test("de un link entra el TEXTO y nunca el href", () => {
  const doc = [
    bloque("paragraph", [
      corrida("Le mandé el "),
      {
        type: "link",
        href: "https://grupogoberna.com/inteligencia?utm_source=wa",
        content: [corrida("temario completo")],
      },
      corrida(" por WhatsApp"),
    ]),
  ];
  const salida = aTextoPlano(doc);
  assert.equal(salida, "Le mandé el temario completo por WhatsApp");
  assert.ok(!salida.includes("http"), "la URL no es texto legible: nadie busca una nota por su href");
  assert.ok(!salida.includes("utm_source"));
});

test("un inline custom que ANIDA entra por su content", () => {
  const doc = [
    bloque("paragraph", [
      { type: "mention", props: { usuario: "luz" }, content: [corrida("@Luz")] },
      corrida(" lo confirmó"),
    ]),
  ];
  const salida = aTextoPlano(doc);
  assert.equal(salida, "@Luz lo confirmó");
  assert.ok(!salida.includes("mention"), "el type de un inline custom tampoco es texto");
  assert.ok(!salida.includes("usuario"), "y sus props menos todavía");
});

test("un bloque vacío no deja línea en blanco entre los que sí tienen texto", () => {
  const doc = [
    bloque("paragraph", [corrida("Antes")]),
    bloque("paragraph", []),
    bloque("paragraph", [corrida("   ")]),
    bloque("paragraph", undefined),
    bloque("paragraph", [corrida("Después")]),
  ];
  assert.equal(aTextoPlano(doc), "Antes\nDespués");
});

test("un documento vacío es la cadena vacía, no un placeholder", () => {
  assert.equal(aTextoPlano([]), "");
  assert.equal(aTextoPlano([bloque("paragraph", [])]), "");
});

test("null, undefined y lo que no es un documento no revientan: dan cadena vacía", () => {
  assert.equal(aTextoPlano(null), "");
  assert.equal(aTextoPlano(undefined), "");
  assert.equal(aTextoPlano({}), "");
  assert.equal(aTextoPlano("hola"), "");
  assert.equal(aTextoPlano(42), "");
  assert.equal(aTextoPlano({ blocks: [bloque("paragraph", [corrida("x")])] }), "");
});

test("un doc malformado no tira: se saltea lo que no se entiende y se extrae el resto", () => {
  const doc = [
    null,
    42,
    "suelto",
    { sin: "nada conocido" },
    bloque("paragraph", [null, 7, corrida("lo que sí se pudo"), { type: "text" }]),
    bloque("paragraph", [corrida("y esto")], { children: "no es un array" }),
  ];
  assert.equal(aTextoPlano(doc), "lo que sí se pudo\ny esto");
});

test("un `content` que no es array: un escalar se ignora, una cadena se toma", () => {
  // El slot `content` es contenido por definición, nunca metadatos: si ahí hay
  // una cadena, esa cadena es texto de la persona. Un número es un doc roto.
  assert.equal(aTextoPlano([bloque("paragraph", 123)]), "");
  assert.equal(aTextoPlano([bloque("paragraph", true)]), "");
  assert.equal(aTextoPlano([bloque("paragraph", "texto suelto")]), "texto suelto");
});

test("NO entran el uuid, el type ni los props — el test que justifica la columna derivada", () => {
  const doc = [
    bloque("heading", [corrida("Acuerdos")], {
      props: { textColor: "red", backgroundColor: "default", textAlignment: "center", level: 1 },
    }),
    bloque("bulletListItem", [corrida("Paga el viernes")], {
      id: "0e6f2a5d-3c47-4b91-8a3d-9f2c4b1e7a58",
      children: [bloque("bulletListItem", [corrida("Le falta el DNI")])],
    }),
  ];

  const salida = aTextoPlano(doc);
  assert.equal(salida, "Acuerdos\nPaga el viernes\nLe falta el DNI");

  for (const ruido of [
    "9f2c4b1e",
    "0e6f2a5d",
    "paragraph",
    "heading",
    "bulletListItem",
    "default",
    "textColor",
    "left",
    "center",
    "styles",
  ]) {
    assert.ok(!salida.includes(ruido), `«${ruido}» no puede llegar al índice: ensucia TODAS las notas`);
  }
});

test("una tabla se aplana: una fila por línea, celdas con TAB", () => {
  const celda = (texto: string) => ({
    type: "tableCell",
    content: [corrida(texto)],
    props: { backgroundColor: "default", textColor: "default", textAlignment: "left", colspan: 1, rowspan: 1 },
  });

  const doc = [
    bloque("table", {
      type: "tableContent",
      columnWidths: [undefined, undefined],
      headerRows: 1,
      rows: [
        { cells: [celda("Curso"), celda("Precio")] },
        { cells: [celda("Inteligencia"), celda("S/ 300")] },
      ],
    }),
  ];

  assert.equal(
    aTextoPlano(doc),
    ["Curso", "Precio"].join(SEPARADOR_CELDA) + "\n" + ["Inteligencia", "S/ 300"].join(SEPARADOR_CELDA),
  );
});

test("la tabla también acepta la forma con las celdas peladas, y no revienta si no", () => {
  const pelada = [bloque("table", { type: "tableContent", rows: [{ cells: [[corrida("A")], [corrida("B")]] }] })];
  assert.equal(aTextoPlano(pelada), `A${SEPARADOR_CELDA}B`);

  // Sin `rows`, con `rows` que no es array, con filas basura: degrada a vacío.
  assert.equal(aTextoPlano([bloque("table", { type: "tableContent" })]), "");
  assert.equal(aTextoPlano([bloque("table", { type: "tableContent", rows: "nada" })]), "");
  assert.equal(aTextoPlano([bloque("table", { type: "tableContent", rows: [null, { cells: null }] })]), "");
});

test("una tabla no tapa el resto del documento", () => {
  const doc = [
    bloque("paragraph", [corrida("Cotización enviada")]),
    bloque("table", { type: "tableContent", rows: [{ cells: [[corrida("Inteligencia")], [corrida("S/ 300")]] }] }),
    bloque("paragraph", [corrida("Confirmar el viernes")]),
  ];
  assert.equal(aTextoPlano(doc), `Cotización enviada\nInteligencia${SEPARADOR_CELDA}S/ 300\nConfirmar el viernes`);
});

test("un doc con un ciclo termina, no cuelga el request", () => {
  // Un `jsonb` no puede tener ciclos, pero un objeto armado en memoria sí: el
  // aplanador es puro y no puede confiar en que le pasen un árbol.
  const hijo: Record<string, unknown> = { id: "x", type: "paragraph", content: [corrida("hola")], children: [] };
  hijo.children = [hijo];
  const salida = aTextoPlano([hijo]);
  assert.ok(salida.startsWith("hola"), "extrae lo que puede antes de frenar por profundidad");
  assert.ok(salida.split("\n").length < 200, "frena por profundidad en vez de recorrer para siempre");
});

test("el trim es del bloque entero, no de las corridas de adentro", () => {
  const doc = [bloque("paragraph", [corrida("  Pagó la cuota el "), corrida("viernes  ")])];
  assert.equal(aTextoPlano(doc), "Pagó la cuota el viernes");
});

/**
 * ══ LA CAPA DE ANOTACIONES ══════════════════════════════════════════════════
 *
 * Vive en su propia columna, NO en el `doc`. Lo único que el aplanado necesita
 * saber de ella es si hay algo dibujado — para no rechazar por «vacía» una
 * página anotada. Nada de la capa entra al texto indexado: ver el docblock de
 * `textoPlano.ts` para el porqué (un PATCH que trae solo anotaciones tendría
 * que rederivar `texto` sin el `doc`, y lo dejaría vacío).
 */

const TRAZO = { clase: "trazo", color: "#ef4444", grosor: 3, puntos: [[10, 10], [20, 25]] };
const ROTULO = { clase: "rotulo", color: "#111827", tamano: 24, en: [30, 40], texto: "Ojo con esto" };

test("hayAnotaciones distingue una capa dibujada de una vacía", () => {
  assert.equal(hayAnotaciones([TRAZO]), true);
  assert.equal(hayAnotaciones([TRAZO, ROTULO]), true);
  assert.equal(hayAnotaciones([]), false, "borrar todo deja la capa vacía, y eso no es contenido");
  assert.equal(hayAnotaciones(null), false, "una página que nunca se anotó");
  assert.equal(hayAnotaciones(undefined), false);
});

test("hayAnotaciones no se cree cualquier cosa que sea un array", () => {
  // Sale de un `jsonb` o de un body: lo que no tenga forma de figura no cuenta.
  assert.equal(hayAnotaciones("[]"), false, "un string no es una capa");
  assert.equal(hayAnotaciones({ clase: "trazo" }), false, "un objeto suelto tampoco");
  assert.equal(hayAnotaciones([1, "dos", null]), false);
  assert.equal(hayAnotaciones([{ sinClase: true }]), false);
});

test("🔴 el aplanado del `doc` NO cambió por existir la capa", () => {
  // La regla de oro sigue en pie: se leen `text` y `content`, props nunca. Si
  // algún día alguien mete los rótulos acá, este test es el que lo frena.
  const doc = [bloque("paragraph", [corrida("Cómo llegar al local")])];
  assert.equal(aTextoPlano(doc), "Cómo llegar al local");
});
