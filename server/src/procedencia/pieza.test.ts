import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  A_MANO,
  CLASES_DE_PIEZA,
  VIAS_DE_PIEZA,
  columnasDeProcedencia,
  deUnAcuse,
  deUnDato,
  deUnPasoDePlantilla,
  esAMano,
  procedenciaDesdeColumnas,
  refDePieza,
  rotuloDePieza,
  versionDePieza,
} from "./pieza.js";
import { versionDeUnMensaje, versionLegible } from "../piezas/version.js";

const CUOTAS = "Se puede pagar en 2 cuotas.";
const dato = (texto: string | null, editada = false) =>
  deUnDato({ clave: "cuotas", editada, contenido: texto === null ? null : { texto } });
const paso = (
  plantillaId: number,
  orden: number,
  via: "panel-sugerencia" | "panel-secuencias" = "panel-secuencias",
  contenido: { texto: string | null; archivo?: string | null } | null = { texto: "hola {nombre}" },
) => deUnPasoDePlantilla({ plantillaId, orden, via, contenido });

/**
 * LA PROCEDENCIA ES UN HECHO — y `null` es la LÍNEA DE BASE, no un hueco.
 *
 * Estos tests fijan las dos cosas que hacen que el lazo de resultados no mienta:
 * que una pieza se identifique igual hoy y después del frente 2 (la unificación
 * del catálogo), y que «lo escribió la vendedora» sea un valor con nombre, no la
 * ausencia de uno.
 */

describe("la pieza se identifica por (clase, ref) — estable a través del frente 2", () => {
  test("un paso de secuencia: la ref lleva la plantilla Y el orden", () => {
    const p = paso(12, 3);
    assert.equal(p.tipo, "pieza");
    assert.equal(p.clase, "plantilla");
    assert.equal(p.ref, "12#3");
    assert.equal(p.via, "panel-secuencias");
    assert.equal(p.editada, false);
  });

  test("dos pasos de la misma secuencia NO son la misma pieza", () => {
    const uno = paso(12, 1);
    const dos = paso(12, 2);
    assert.notEqual(refDePieza(uno), refDePieza(dos));
  });

  test("la MISMA pieza mandada por dos vías es la misma pieza", () => {
    // Es la razón de ser de la columna `via`: si la vía formara parte de la
    // identidad, «la secuencia 12 funciona» sería incontestable — quedaría
    // partida en dos piezas que nadie puede sumar.
    const sugerida = paso(12, 1, "panel-sugerencia");
    const elegida = paso(12, 1, "panel-secuencias");
    assert.equal(refDePieza(sugerida), refDePieza(elegida));
    assert.notEqual(sugerida.via, elegida.via);
  });

  test("un dato recomendado se identifica por su clave, que es estable al renombrar el rótulo", () => {
    const p = dato(CUOTAS);
    assert.equal(p.clase, "hecho");
    assert.equal(p.ref, "cuotas");
    assert.equal(p.via, "panel-datos");
  });

  test("un dato que la vendedora reescribió queda marcado como editado", () => {
    const p = dato(CUOTAS, true);
    assert.equal(p.editada, true, "lo que salió no es la frase del catálogo, y el número no puede fingir que sí");
  });

  test("un acuse de la auto-respuesta lleva el id de su plantilla", () => {
    const p = deUnAcuse({
      plantillaId: "fuera-de-horario-primer-contacto",
      contenido: { texto: "Gracias por escribirnos." },
    });
    assert.equal(p.clase, "acuse");
    assert.equal(p.ref, "fuera-de-horario-primer-contacto");
    assert.equal(p.via, "automatica");
  });

  test("las clases y las vías son listas cerradas: un typo no entra a la base", () => {
    assert.deepEqual([...CLASES_DE_PIEZA], ["plantilla", "hecho", "acuse", "gancho"]);
    assert.deepEqual(
      [...VIAS_DE_PIEZA],
      ["panel-sugerencia", "panel-secuencias", "panel-datos", "automatica"],
    );
  });
});

describe("LA VERSIÓN — sin ella el lazo mide un blanco móvil y no lo dice", () => {
  test("cambiar el texto cambia la versión: los dos textos NO se suman", () => {
    // El caso que esto existe para impedir: una pieza que rendía 12 % y saltó a
    // 30 % con el texto nuevo, reportada 21 % para siempre.
    const vieja = dato("Se puede pagar en 2 cuotas.");
    const nueva = dato("El pago va en 2 cuotas: una para reservar y otra antes de empezar.");
    assert.equal(vieja.ref, nueva.ref, "es la misma pieza…");
    assert.notEqual(vieja.version, nueva.version, "…y son dos versiones distintas");
  });

  test("el MISMO texto da la MISMA versión, siempre (es contenido, no un contador)", () => {
    assert.equal(dato(CUOTAS).version, dato(CUOTAS).version);
    assert.equal(versionDePieza({ texto: CUOTAS }), versionDePieza({ texto: CUOTAS }));
  });

  test("un cambio de SOLO espacios o saltos de línea NO es una versión nueva", () => {
    // Un editor que guarda CRLF no puede partir en dos la historia de una pieza.
    assert.equal(versionDePieza({ texto: "hola\nchau" }), versionDePieza({ texto: "hola\r\nchau" }));
    assert.equal(versionDePieza({ texto: CUOTAS }), versionDePieza({ texto: `  ${CUOTAS}\n` }));
  });

  test("EL TEXTO DE LA PIEZA ES LA PLANTILLA SIN RESOLVER, nunca el mensaje final", () => {
    // Si el hash se calculara sobre lo que salió, CADA DESTINATARIO sería una
    // versión distinta y el versionado no mediría nada.
    const plantilla = paso(12, 1, "panel-secuencias", { texto: "Hola {nombre}, cuesta {precio}." });
    const otroContacto = paso(12, 1, "panel-secuencias", { texto: "Hola {nombre}, cuesta {precio}." });
    assert.equal(plantilla.version, otroContacto.version);
    // Y el mensaje YA resuelto es otra cosa: si alguien lo pasara por error, se
    // notaría — no coincide con la versión de la plantilla.
    const resuelto = paso(12, 1, "panel-secuencias", { texto: "Hola Ana, cuesta S/ 350." });
    assert.notEqual(plantilla.version, resuelto.version);
  });

  test("cambiar la IMAGEN de un paso también es una versión nueva", () => {
    // El flyer es contenido: cambiarlo cambia lo que la persona recibe.
    const conFlyerA = paso(12, 1, "panel-secuencias", { texto: "mirá esto", archivo: "flyer-a.jpg" });
    const conFlyerB = paso(12, 1, "panel-secuencias", { texto: "mirá esto", archivo: "flyer-b.jpg" });
    assert.notEqual(conFlyerA.version, conFlyerB.version);
  });

  test("un paso SOLO de imagen tiene versión igual (el texto vacío no lo anula)", () => {
    const soloImagen = paso(12, 1, "panel-secuencias", { texto: null, archivo: "flyer.jpg" });
    assert.ok(soloImagen.version, "una imagen es contenido");
  });

  test("sin contenido conocido, la versión es null — y eso se lee «no sabemos qué texto era»", () => {
    const p = dato(null);
    assert.equal(p.version, null);
  });

  test("pero el contenido VACÍO sí tiene versión: «vacío» y «no sabemos» son cosas distintas", () => {
    // Antes esto devolvía `null` mientras el catálogo publicaba un hash para la
    // misma pieza: dos respuestas distintas, y el join no cerraba. `null`
    // significa una sola cosa — no se pudo determinar el contenido.
    assert.notEqual(versionDePieza({ texto: "" }), null);
    assert.equal(versionDePieza({ texto: "" }), versionDeUnMensaje({ texto: "" }));
  });

  test("CRITERIO DE ACEPTACIÓN: un envío ya escrito conserva la versión vieja", () => {
    // El envío se guarda con SU versión; cambiar la pieza después no puede
    // re-atribuirlo. Acá se prueba sobre las columnas, que es la forma en que
    // la fila vive: lo guardado no depende del catálogo de hoy.
    const guardado = columnasDeProcedencia(dato("Se puede pagar en 2 cuotas."));
    const hoyLaPiezaDice = dato("Ahora se puede en 3 cuotas.");

    assert.notEqual(guardado.piezaVersion, hoyLaPiezaDice.version);
    // Y al leerla, la fila vieja sigue apuntando a la versión con la que salió.
    const leida = procedenciaDesdeColumnas(guardado);
    assert.equal(leida.tipo, "pieza");
    assert.equal(
      (leida as { version: string }).version,
      versionDePieza({ texto: "Se puede pagar en 2 cuotas." }),
    );
  });
});

describe("«a mano» es un valor, no la ausencia de uno", () => {
  test("A_MANO es la línea de base y se pregunta por su nombre", () => {
    assert.equal(A_MANO.tipo, "a-mano");
    assert.equal(esAMano(A_MANO), true);
    assert.equal(esAMano(dato(CUOTAS)), false);
  });

  test("se lee en castellano, y dice lo que es", () => {
    assert.equal(rotuloDePieza(A_MANO), "escrito a mano (la línea de base)");
    // El rótulo lleva la versión: dos textos distintos NO se leen igual.
    assert.equal(
      rotuloDePieza(dato(CUOTAS)),
      `hecho · cuotas @${versionLegible(versionDePieza({ texto: CUOTAS }))}`,
    );
    assert.ok(rotuloDePieza(paso(7, 2, "panel-sugerencia")).startsWith("plantilla · 7#2 @"));
  });

  test("refDePieza de lo escrito a mano es null — y ese null ES el dato", () => {
    assert.equal(refDePieza(A_MANO), null);
  });
});

describe("las columnas: ida y vuelta sin perder nada", () => {
  test("una pieza va a cinco columnas y vuelve idéntica", () => {
    const p = deUnPasoDePlantilla({
      plantillaId: 12,
      orden: 3,
      via: "panel-sugerencia",
      contenido: { texto: "hola {nombre}" },
      momento: "cotizada",
    });
    const cols = columnasDeProcedencia(p);
    assert.deepEqual(cols, {
      piezaClase: "plantilla",
      piezaRef: "12#3",
      piezaVersion: versionDePieza({ texto: "hola {nombre}" }),
      piezaVia: "panel-sugerencia",
      piezaEditada: false,
      momentoVenta: "cotizada",
    });
    assert.deepEqual(procedenciaDesdeColumnas(cols), p);
  });

  test("lo escrito a mano deja las cuatro columnas de pieza en null — pero conserva el momento", () => {
    // El momento es lo que hace comparable la línea de base: «la vendedora
    // escribiendo a mano cuando la conversación estaba cotizada» es el rival
    // legítimo del dato de las cuotas, y sin el momento no se puede aparear.
    const cols = columnasDeProcedencia({ tipo: "a-mano", momento: "cotizada" });
    assert.deepEqual(cols, {
      piezaClase: null,
      piezaRef: null,
      piezaVersion: null,
      piezaVia: null,
      piezaEditada: false,
      momentoVenta: "cotizada",
    });
    assert.deepEqual(procedenciaDesdeColumnas(cols), { tipo: "a-mano", momento: "cotizada" });
  });

  test("una fila vieja (todo null, de antes de este cambio) se lee como escrita a mano sin momento", () => {
    const leida = procedenciaDesdeColumnas({
      piezaClase: null,
      piezaRef: null,
      piezaVersion: null,
      piezaVia: null,
      piezaEditada: false,
      momentoVenta: null,
    });
    assert.deepEqual(leida, { tipo: "a-mano", momento: null });
  });

  test("una fila a medias (clase sin ref) NO se inventa una pieza: cae a la línea de base", () => {
    // No debería pasar nunca —los constructores son la única puerta— pero si
    // pasa, contarla como pieza le atribuiría a alguien un resultado ajeno.
    const leida = procedenciaDesdeColumnas({
      piezaClase: "plantilla",
      piezaRef: null,
      piezaVersion: "abc",
      piezaVia: "panel-sugerencia",
      piezaEditada: false,
      momentoVenta: "cotizada",
    });
    assert.deepEqual(leida, { tipo: "a-mano", momento: "cotizada" });
  });

  test("una clase que no conocemos tampoco se inventa (una fila de un Hermes más nuevo)", () => {
    const leida = procedenciaDesdeColumnas({
      piezaClase: "pieza-del-futuro",
      piezaRef: "x",
      piezaVersion: "abc",
      piezaVia: "panel-datos",
      piezaEditada: false,
      momentoVenta: null,
    });
    assert.equal(leida.tipo, "a-mano");
  });

  test("un momento que no está en el vocabulario compartido se descarta, no se guarda crudo", () => {
    const leida = procedenciaDesdeColumnas({
      piezaClase: null,
      piezaRef: null,
      piezaVersion: null,
      piezaVia: null,
      piezaEditada: false,
      momentoVenta: "inventado",
    });
    assert.equal(leida.momento, null);
  });
});
