import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  PASO_FLYER,
  PASO_FLYER_AGOSTO,
  TEXTO_CUOTAS,
  VECTORES_DE_MENSAJE,
  VECTORES_DE_SECUENCIA,
} from "../piezas/vectores.js";
import { procedenciaDelComposer, type LeerPasoDeSecuencia } from "./desdeElComposer.js";
import type { ContenidoDePieza } from "./pieza.js";

/**
 * LA TERCERA PUERTA, QUE ES LA QUE DABA CERO.
 *
 * `procedencia/paridad.test.ts` fija que lo que estampa el lazo sea lo que publica
 * el catálogo — pero lo prueba por los constructores (`deUnPasoDePlantilla`), que
 * son los que usa `POST /api/plantillas/:id/enviar-paso`. Hay una segunda entrada
 * al mismo `envios_wa`: la vendedora toca el texto en el panel, cae en el composer,
 * lo edita y manda por `POST /api/whatsapp/enviar`. Esa puerta armaba la versión
 * con lo que declaraba el navegador, y **el navegador no puede saber la versión**:
 *
 *   1. el archivo no viaja (el front recibe `conImagen: boolean`, no el nombre), y
 *   2. el texto que viaja YA está resuelto con el `{nombre}` y el `{precio}` de
 *      esa persona.
 *
 * O sea que daba cero filas justo para el paso 1 de la secuencia —el del flyer, el
 * 42 % de la venta— y encima una versión distinta por destinatario. Cero en
 * silencio se lee «esa pieza no se usó nunca», que es la conclusión falsa que toda
 * la épica #169 existe para no sacar.
 *
 * Los vectores son los MISMOS de `piezas/vectores.ts`: si esta puerta y el
 * catálogo se separan otra vez, se cae acá.
 */

const [SECUENCIA_JULIO, SECUENCIA_AGOSTO] = VECTORES_DE_SECUENCIA;

/** Lo que la pantalla deja en la caja: la vista previa YA EXPANDIDA para esa persona. */
const VISTA_PREVIA_ANA = "Hola Ana, te dejo el flyer del Diplomado en Inteligencia 👇";
const VISTA_PREVIA_JAVIER = "Hola Javier, te dejo el flyer del Diplomado en Inteligencia 👇";

/** Un lector que devuelve siempre el mismo paso, y cuenta cuántas veces lo llamaron. */
function lectorDe(contenido: ContenidoDePieza | null) {
  const llamadas: [number, number][] = [];
  const leer: LeerPasoDeSecuencia = async (plantillaId, orden) => {
    llamadas.push([plantillaId, orden]);
    return contenido;
  };
  return { leer, llamadas };
}

const DEL_PANEL = {
  clase: "plantilla",
  ref: "12#1",
  via: "panel-sugerencia",
  editada: false,
  textoPieza: VISTA_PREVIA_ANA,
};

describe("lo que estampa el composer = lo que publica el catálogo", () => {
  test("el paso del flyer: la versión sale de la FILA, no del texto que mandó el navegador", async () => {
    assert.ok(SECUENCIA_JULIO);
    const { leer, llamadas } = lectorDe(PASO_FLYER);

    const p = await procedenciaDelComposer(DEL_PANEL, leer);

    assert.equal(p?.tipo, "pieza");
    assert.equal(p.clase, "plantilla");
    assert.equal(p.ref, SECUENCIA_JULIO.refsDePaso[0]);
    assert.equal(
      p.version,
      SECUENCIA_JULIO.versionesDePaso[0],
      "el composer tiene que estampar la MISMA versión que publica el catálogo para 12#1",
    );
    assert.deepEqual(llamadas, [[12, 1]], "el paso se lee por (plantilla, orden), que es lo estable");
  });

  test("cambiar el flyer cambia la versión que estampa el composer, con el texto igual", async () => {
    // El precio vive DENTRO de la imagen. Si el composer no mirara el archivo,
    // las dos ofertas se sumarían en un promedio y la que funcionó desaparecería.
    assert.ok(SECUENCIA_JULIO && SECUENCIA_AGOSTO);
    const julio = await procedenciaDelComposer(DEL_PANEL, lectorDe(PASO_FLYER).leer);
    const agosto = await procedenciaDelComposer(DEL_PANEL, lectorDe(PASO_FLYER_AGOSTO).leer);

    assert.equal(julio?.tipo === "pieza" && julio.version, SECUENCIA_JULIO.versionesDePaso[0]);
    assert.equal(agosto?.tipo === "pieza" && agosto.version, SECUENCIA_AGOSTO.versionesDePaso[0]);
    assert.notEqual(
      julio?.tipo === "pieza" && julio.version,
      agosto?.tipo === "pieza" && agosto.version,
    );
  });

  test("la MISMA pieza para dos contactos distintos estampa la MISMA versión", async () => {
    // Lo que cae en la caja es `vistaPrevia.texto`, ya expandido con el `{nombre}`
    // y el `{precio}` de ESA persona. Hashear eso hacía de cada destinatario una
    // versión distinta: el versionado dejaba de medir la pieza y pasaba a medir
    // a quién se la mandaron.
    const paraAna = await procedenciaDelComposer(DEL_PANEL, lectorDe(PASO_FLYER).leer);
    const paraJavier = await procedenciaDelComposer(
      { ...DEL_PANEL, textoPieza: VISTA_PREVIA_JAVIER },
      lectorDe(PASO_FLYER).leer,
    );

    assert.equal(paraAna?.tipo, "pieza");
    assert.equal(paraJavier?.tipo, "pieza");
    assert.equal(paraAna.version, paraJavier.version);
    assert.notEqual(VISTA_PREVIA_ANA, VISTA_PREVIA_JAVIER, "los dos textos SÍ son distintos");
  });

  test("un dato recomendado se sigue versionando por el texto de la caja, sin tocar la base", async () => {
    // Y está bien: el texto de un `hecho` cae en la caja tal cual está en el
    // catálogo, sin marcadores y sin archivo. Releer la fila sería peor —si
    // alguien la editó en el medio, lo que salió fue el texto viejo—.
    const v = VECTORES_DE_MENSAJE.find((x) => x.direccion.clase === "hecho" && x.contenido.texto);
    assert.ok(v);
    const { leer, llamadas } = lectorDe(PASO_FLYER);

    const p = await procedenciaDelComposer(
      { clase: "hecho", ref: v.ref, via: "panel-datos", editada: true, textoPieza: TEXTO_CUOTAS },
      leer,
    );

    assert.equal(p?.tipo, "pieza");
    assert.equal(p.clase, "hecho");
    assert.equal(p.ref, v.ref);
    assert.equal(p.version, v.version);
    assert.equal(p.editada, true, "que ella lo haya reescrito viaja igual");
    assert.deepEqual(llamadas, [], "un hecho no tiene pasos: no se toca la base");
  });

  test("una plantilla que no se pudo leer conserva la pieza con versión `null`", async () => {
    // `null` significa UNA sola cosa —no se pudo determinar el contenido— y nunca
    // se mezcla con una versión conocida. Perder la versión es barato; estampar
    // una inventada es el error que este trabajo existe para no cometer.
    const p = await procedenciaDelComposer(DEL_PANEL, lectorDe(null).leer);
    assert.equal(p?.tipo, "pieza");
    assert.equal(p.ref, "12#1");
    assert.equal(p.version, null);
  });

  test("un id de plantilla que no es un número no manda a leer nada, y no inventa versión", async () => {
    const { leer, llamadas } = lectorDe(PASO_FLYER);
    const p = await procedenciaDelComposer({ ...DEL_PANEL, ref: "doce#1" }, leer);
    assert.equal(p?.tipo, "pieza");
    assert.equal(p.ref, "doce#1");
    assert.equal(p.version, null, "sin fila que leer, la versión es «no sabemos»");
    assert.deepEqual(llamadas, []);
  });

  test("ante un cuerpo raro, la línea de base — nunca una pieza inventada", async () => {
    const { leer } = lectorDe(PASO_FLYER);
    for (const cuerpo of [undefined, null, "12#1", 42, {}, { clase: "dato", ref: "x", via: "panel-datos" }]) {
      assert.equal(await procedenciaDelComposer(cuerpo, leer), undefined, JSON.stringify(cuerpo));
    }
  });
});
