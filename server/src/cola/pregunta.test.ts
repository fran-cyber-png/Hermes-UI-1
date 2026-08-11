import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { esTextoDeAnuncio, pidioDatos, pregunto, preguntoPrecio } from "./pregunta.js";

/**
 * ESTE TEST ESTÁ ESCRITO CON TEXTOS REALES DE PRODUCCIÓN, no inventados.
 *
 * Salen del censo del 11-ago-2026 sobre la ventana de 30 días. Importa que sean
 * reales porque los tres defectos del predicado viejo eran invisibles con textos
 * de laboratorio: nadie escribe a mano «Hola Quiero más información del Diploma
 * de Inteligencia y Contrainteligencia» 424 veces, y esa repetición ES el bug.
 */

/** Los dos textos que Meta prellena, tal cual llegan. */
const TEXTO_DEL_ANUNCIO = [
  "Hola Quiero más información del Diploma de Inteligencia y Contrainteligencia",
  "Hola. Quiero más información sobre el servicio de Consultoría.",
  "¡Hola! Quiero más información",
  "Hola. ¿Puedo obtener más información sobre esto?",
  "¡Hola! Me gustaría conseguir más información sobre esto.",
  "¡Hola! Quiero más información del I Foro de Estado 2026.",
];

describe("el texto que escribe el anuncio, no la persona", () => {
  for (const texto of TEXTO_DEL_ANUNCIO) {
    test(`«${texto.slice(0, 46)}…» es un clic, no una pregunta`, () => {
      assert.equal(esTextoDeAnuncio(texto), true);
      assert.equal(
        pregunto(texto),
        false,
        "el predicado viejo contaba esto como un pedido: 563 de 685 conversaciones",
      );
    });
  }

  test("si le AGREGAN una pregunta al texto del anuncio, ya no es solo un clic", () => {
    const texto = "Hola Quiero más información del Diploma de Inteligencia y Contrainteligencia ¿Cuál es el costo?";
    assert.equal(esTextoDeAnuncio(texto), false, "el `[^?]*$` es lo que deja pasar este caso");
    assert.equal(preguntoPrecio(texto), true);
  });

  test("«info» a secas es un pedido; «informal» no", () => {
    // El borde de palabra está escrito a mano porque ni `\\b` ni `\\y` significan
    // lo mismo en los dos motores. Ver INFO_A_SECAS.
    for (const texto of ["info", "info?", "más info por favor", "hola, quiero info"]) {
      assert.equal(pregunto(texto), true, texto);
    }
    for (const texto of ["un trato informal", "infografía del curso"]) {
      assert.equal(pregunto(texto), false, texto);
    }
  });

  test("un pedido de información ESCRITO A MANO sí cuenta", () => {
    // El primer intento de arreglo sacaba `informaci` del regex y perdía estos.
    for (const texto of ["Necesito información", "Un poco más de información x favor", "Información sobre el curso"]) {
      assert.equal(esTextoDeAnuncio(texto), false, texto);
      assert.equal(pregunto(texto), true, texto);
    }
  });
});

describe("el nivel PRECIO no lo tumba ninguna cortesía", () => {
  test("«Pásame la cotización urgentemente quiero comprar ahora mismo»", () => {
    // ⚠️ Este texto existe en producción pero NO es un lead: es Walter probando el
    // bot el 31-jul (el bot le contesta «Perfecto, Walter»). Se conserva como caso
    // porque la FORMA es la de una señal de compra —y el predicado tiene que
    // agarrarla venga de quien venga—, pero la regla se justifica con los reales
    // de acá abajo. Cruzá `persona_id` contra `numeros_wa` antes de citar un texto.
    assert.equal(preguntoPrecio("Pásame la cotización urgentemente quiero comprar ahora mismo"), true);
  });

  test("🔴 los REALES que un veto de cortesía descartaría", () => {
    // Medido: de 63 conversaciones de gente real cuyo último mensaje nombra plata,
    // 6 llevan además una fórmula de cortesía. Estas tres son las que valen, y son
    // exactamente las que el segundo intento de arreglo perdía.
    for (const texto of [
      "Cual es el precio. Gracias",
      "Sí gracias por la información si hago un negocio en éstos días les envío el pago",
      "Me inscribí en este curso, me lo dieron bastante barato y la empresa esta en mí país",
    ]) {
      assert.equal(preguntoPrecio(texto), true, texto);
      assert.equal(pregunto(texto), true, texto);
    }
  });

  test("una pregunta de plata con la cortesía adelante sigue contando", () => {
    assert.equal(pregunto("Muchas gracias por la información, ¿cuánto cuesta?"), true);
  });

  for (const texto of [
    "Cuantas cuotas?",
    "el nombre de yape es a nombre de una empresa?",
    "Más tarde hago el pago",
    "Buen día me podrías enviar el link de pago de nuevo del 360",
    "Cuál es el proceso de inscripción y pago",
    "Que precio tiene?",
    "COSTO",
  ]) {
    test(`«${texto.slice(0, 46)}» es señal de compra`, () => {
      assert.equal(preguntoPrecio(texto), true, "el predicado viejo no veía ninguno de estos");
    });
  }
});

describe("lo que el predicado viejo contaba como pedido y es lo contrario", () => {
  for (const texto of [
    "Ya no me interesa",
    "Ya no estoy interesado",
    "MUCHAS GRACIAS POR LA INFORMACION. EXCELNTE DIA",
    "Muchas gracias por la información. Talvez en otra ocasión. Buenas tardes!",
    "Si me decido, les avisaré. Gracias por la información.",
  ]) {
    test(`«${texto.slice(0, 46)}…» no es un pedido`, () => {
      assert.equal(pregunto(texto), false);
    });
  }

  test("la autorespuesta de OTRO negocio no es un lead", () => {
    // Aparece al escribirle a un número que es una cuenta de empresa.
    for (const texto of [
      "Gracias por comunicarte con Lander Valera ¿Cómo puedo ayudarte?",
      "Gracias por comunicarte con Jasper Desing. ¿Cómo podemos ayudarte? 😀",
    ]) {
      assert.equal(pregunto(texto), false, texto);
    }
  });

  test("«cómo estás» no es una pregunta comercial", () => {
    // `cómo` estaba suelto en el regex viejo.
    assert.equal(pregunto("Cómo estás"), false);
  });
});

describe("los bordes", () => {
  test("sin texto no pide nada — y no explota", () => {
    for (const vacio of [null, undefined, ""]) {
      assert.equal(pregunto(vacio), false);
      assert.equal(preguntoPrecio(vacio), false);
      assert.equal(pidioDatos(vacio), false);
      assert.equal(esTextoDeAnuncio(vacio), false);
    }
  });

  test("`pregunto` es exactamente la unión de los dos niveles", () => {
    for (const texto of [
      "cuánto cuesta",
      "cuál es el temario",
      "hola",
      "Hola Quiero más información del Diploma de Inteligencia y Contrainteligencia",
      "no me interesa el precio",
    ]) {
      assert.equal(pregunto(texto), preguntoPrecio(texto) || pidioDatos(texto), texto);
    }
  });

  test("un cierre con palabra de plata sigue siendo compra, y eso es a propósito", () => {
    // «no me interesa el precio» dice que no, pero también dice «precio». El
    // nivel fuerte gana: es preferible que la vendedora mire una fila de más a
    // que se le pierda una venta. La fila igual muestra el texto.
    assert.equal(preguntoPrecio("no me interesa el precio"), true);
    assert.equal(pidioDatos("no me interesa el precio"), false);
  });
});
