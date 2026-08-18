import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { leerDestinatario } from "./destinatario.js";

/**
 * QUÉ PROTEGEN ESTOS TESTS.
 *
 * Un solo defecto, y es el que convierte la caja de «Para» en una lista de
 * difusión: la validación vieja (`/.+@.+\..+/`) daba por buena una cadena con
 * comas, y **nodemailer la parte en varios destinatarios**. Verificado contra
 * el `addressparser` de la versión instalada (nodemailer 9.0.3):
 * `"a@b.com, c@d.com"` sale como dos direcciones, y las dos reciben el correo.
 *
 * Por eso el test que sigue no es un caso de borde: es la razón de que este
 * módulo exista. Si alguna vez se pone verde con `ok: true`, «nada masivo»
 * volvió a ser una frase de la pantalla.
 */

describe("uno y uno solo", () => {
  it("una dirección sola pasa", () => {
    assert.deepEqual(leerDestinatario("a@b.com"), { ok: true, direccion: "a@b.com" });
  });

  /**
   * 🔴 EL TEST QUE JUSTIFICA EL MÓDULO.
   *
   * Con el regex viejo esto era `true`, y salían DOS correos: uno a `a@b.com` y
   * otro a `c@d.com`. Sin ritmo, sin techo y con **una sola fila** en `correos`
   * diciendo que se mandó a la cadena entera — o sea que ni la auditoría podía
   * decir a quiénes les había llegado.
   */
  it("dos direcciones separadas por coma NO se mandan: nodemailer las parte en dos", () => {
    assert.deepEqual(leerDestinatario("a@b.com, c@d.com"), { ok: false, motivo: "varios" });
  });

  it("sin el espacio después de la coma es el mismo caso", () => {
    assert.deepEqual(leerDestinatario("a@b.com,c@d.com"), { ok: false, motivo: "varios" });
  });

  /**
   * El punto y coma parte igual que la coma — medido, no supuesto. Es la forma
   * en que pega una lista quien viene de Outlook, así que no es hipotética.
   */
  it("el punto y coma también parte, así que también se rechaza", () => {
    assert.deepEqual(leerDestinatario("a@b.com; c@d.com"), { ok: false, motivo: "varios" });
  });

  it("con nombre y picos, dos siguen siendo dos", () => {
    assert.deepEqual(leerDestinatario("X <a@b.com>, Y <c@d.com>"), {
      ok: false,
      motivo: "varios",
    });
  });

  /**
   * ⚠️ EL MOTIVO ACÁ ES `forma`, NO `varios`, Y ESO ES DELIBERADO.
   *
   * `X <a@b.com>` es UN destinatario escrito en forma RFC; decirle «pusiste
   * varios» a quien escribió uno la manda a buscar una coma que no está. Se
   * rechaza igual —el nombre visible del destinatario no lo escribimos
   * nosotros, y aceptar los picos es abrirle la puerta a la forma de arriba,
   * que sí son dos— pero el motivo dice la verdad de lo que pasó.
   */
  it("una dirección con picos se rechaza por FORMA: es una, mal escrita", () => {
    assert.deepEqual(leerDestinatario("X <a@b.com>"), { ok: false, motivo: "forma" });
  });

  /**
   * Separadas por un espacio nodemailer NO manda dos: se queda con la primera y
   * usa la segunda como nombre visible. El daño es el opuesto —un destinatario
   * se pierde en silencio— y se rechaza por la misma razón: la cadena se lee de
   * más de una manera.
   */
  it("separadas por un espacio tampoco: ahí nodemailer PIERDE una", () => {
    assert.deepEqual(leerDestinatario("a@b.com c@d.com"), { ok: false, motivo: "forma" });
  });
});

describe("la forma de una dirección", () => {
  it("sin arroba no es una dirección", () => {
    // nodemailer no falla acá: devuelve dirección VACÍA con `pepe` de nombre.
    assert.deepEqual(leerDestinatario("pepe"), { ok: false, motivo: "forma" });
  });

  /**
   * `a@b` nodemailer lo acepta y SES contesta 554 media hora después, en un
   * rebote que nadie mira. Preferimos el «revisá el destinatario» de la
   * pantalla, que la vendedora lee con el lead todavía adelante.
   */
  it("un dominio sin punto se rechaza acá, no en el rebote de SES", () => {
    assert.deepEqual(leerDestinatario("a@b"), { ok: false, motivo: "forma" });
  });

  it("los locales de gente real pasan: puntos, más y guiones", () => {
    assert.deepEqual(leerDestinatario("ana.perez+foro@grupogoberna.com"), {
      ok: true,
      direccion: "ana.perez+foro@grupogoberna.com",
    });
    assert.deepEqual(leerDestinatario("ventas-10@grupogoberna.com.pe"), {
      ok: true,
      direccion: "ventas-10@grupogoberna.com.pe",
    });
  });
});

describe("vacío", () => {
  it("la cadena vacía y la de puros espacios son el mismo motivo", () => {
    assert.deepEqual(leerDestinatario(""), { ok: false, motivo: "vacio" });
    assert.deepEqual(leerDestinatario("   "), { ok: false, motivo: "vacio" });
  });

  /**
   * ⚠️ Puros espacios CON un salto adentro sigue siendo `vacio`, no
   * `salto_de_linea`: no escribió nada, y acusarla de inyectar una cabecera es
   * ruido que le hace desconfiar de un mensaje que después sí importa.
   */
  it("un campo en blanco con un salto adentro sigue siendo vacío", () => {
    assert.deepEqual(leerDestinatario("  \n  "), { ok: false, motivo: "vacio" });
  });
});

describe("inyección de cabeceras", () => {
  /**
   * 🔴 EL ÚNICO AGUJERO DE ESTE FRENTE QUE SE EXPLOTA DESDE LA PANTALLA.
   *
   * Un salto de línea adentro del valor de una cabecera **abre una cabecera
   * nueva**: quien escriba esto en la caja de «Para» se manda una copia oculta
   * de un correo que sale con el remitente de Goberna, y en la tabla `correos`
   * queda una fila que dice que se le mandó a `a@b.com` y nada más. No hace
   * falta tocar la API ni saber nada: alcanza con pegar dos renglones.
   *
   * (Medido: nodemailer lee esa cadena como un GRUPO con `otro@mal.com`
   * adentro — o sea que ni siquiera falla, cambia de forma.)
   */
  it("un salto de línea con un Bcc detrás se rechaza por lo que es", () => {
    assert.deepEqual(leerDestinatario("a@b.com\nBcc: otro@mal.com"), {
      ok: false,
      motivo: "salto_de_linea",
    });
  });

  it("el retorno de carro cuenta igual que el salto", () => {
    assert.deepEqual(leerDestinatario("a@b.com\r\nBcc: otro@mal.com"), {
      ok: false,
      motivo: "salto_de_linea",
    });
  });

  /**
   * ⚠️ Un salto al FINAL también se rechaza, aunque parezca inofensivo — y ese
   * es el precio elegido. Separar «al final» de «en el medio» obliga a mirar
   * qué viene después del salto, que es justo el trabajo que la inyección
   * necesita que alguien haga mal. La regla se queda sin excepciones.
   */
  it("un salto al final tampoco pasa: la regla no tiene excepciones", () => {
    assert.deepEqual(leerDestinatario("a@b.com\n"), { ok: false, motivo: "salto_de_linea" });
  });
});

describe("lo que se conserva de lo que escribió la vendedora", () => {
  it("los espacios de los bordes se recortan", () => {
    assert.deepEqual(leerDestinatario("  a@b.com  "), { ok: true, direccion: "a@b.com" });
  });

  /**
   * ⚠️ LAS MAYÚSCULAS NO SE TOCAN.
   *
   * El local-part es case-sensitive según el RFC 5321 §2.4 y hay servidores que
   * lo respetan, así que pasar a minúsculas es reescribir el dato de la
   * vendedora para que nos quede cómodo. Y el error no rebota: le llega a otra
   * casilla, o a ninguna, sin un solo síntoma de este lado.
   *
   * Donde sí se normaliza es al comparar remitentes NUESTROS
   * (`remitentes_correo_direccion_uq` va sobre `lower(direccion)`): ahí la
   * pregunta es si dos filas son el mismo buzón, no a quién se le manda.
   */
  it("las mayúsculas se conservan tal cual se escribieron", () => {
    assert.deepEqual(leerDestinatario("A@B.com"), { ok: true, direccion: "A@B.com" });
    assert.deepEqual(leerDestinatario("Ana.Perez@Goberna.us"), {
      ok: true,
      direccion: "Ana.Perez@Goberna.us",
    });
  });
});

/**
 * 🔴 LOS CARACTERES QUE NO PARTEN LA CADENA: LA REESCRIBEN.
 *
 * Estos tests se agregaron DESPUÉS, al verificar el módulo contra el parser real
 * en vez de contra el enunciado del módulo. El docblock decía «laxo con lo raro
 * pero cerrado con lo múltiple», y esa frase deja afuera un tercer caso que es
 * peor que los dos: cadenas que nodemailer lee como **UNA sola dirección
 * distinta de la que se escribió**.
 *
 * Medido contra el `addressparser` de nodemailer 9.0.3, el que corre en producción:
 *
 *   "a(b)c@goberna.us"      → address: **"ac@goberna.us"**   ← el paréntesis es un
 *                             COMENTARIO de RFC 5322 y se descarta entero
 *   "equipo:ana@goberna.us" → un GRUPO; sale hacia "ana@goberna.us"
 *   "\"x\"@goberna.us"      → address: "x@goberna.us"
 *
 * O sea: la vendedora escribe una dirección, `correos.para` guarda **esa**, y el
 * mensaje sale hacia **otra**. No hay error, no hay rebote, no hay nada que ate
 * una cosa con la otra — la auditoría queda mintiendo y el correo se lo lleva un
 * tercero. Es el mismo daño que la campaña de WhatsApp ya documentó para los
 * teléfonos: *un destinatario mal leído no cuesta un mensaje, le llega a otra
 * persona*.
 *
 * ⚠️ La propiedad que fijan estos tests no es «rechaza estas cinco cadenas», es
 * **toda dirección ACEPTADA sale exactamente hacia donde dice**. Si alguien
 * aflojara el regex para dejar entrar una dirección «rara pero válida», lo que
 * tiene que volver a correr es la comparación contra el parser, no la lista.
 */
describe("las direcciones que el parser REESCRIBE", () => {
  it("🔴 el paréntesis es un comentario de RFC 5322: 'a(b)c@goberna.us' saldría hacia 'ac@goberna.us'", () => {
    assert.deepEqual(leerDestinatario("a(b)c@goberna.us"), { ok: false, motivo: "forma" });
  });

  it("🔴 los dos puntos abren un GRUPO: 'equipo:ana@goberna.us' saldría hacia 'ana@goberna.us'", () => {
    assert.deepEqual(leerDestinatario("equipo:ana@goberna.us"), { ok: false, motivo: "forma" });
  });

  it("🔴 la comilla doble se descarta: '\"x\"@goberna.us' saldría hacia 'x@goberna.us'", () => {
    assert.deepEqual(leerDestinatario('"x"@goberna.us'), { ok: false, motivo: "forma" });
  });

  it("los corchetes tampoco entran (dominio literal de RFC 5322)", () => {
    assert.deepEqual(leerDestinatario("a[b]@goberna.us"), { ok: false, motivo: "forma" });
  });

  it("la barra invertida tampoco: es el escape adentro de un quoted-string", () => {
    assert.deepEqual(leerDestinatario("a\\b@goberna.us"), { ok: false, motivo: "forma" });
  });

  it("⚠️ y lo que SÍ es una dirección de gente real sigue entrando intacto", () => {
    // El endurecimiento no puede costar direcciones válidas: `+`, `.`, `_`, `-` y
    // los acentos son de personas que existen y a las que hay que poder escribirles.
    for (const buena of [
      "ana@goberna.us",
      "ana.perez+diplomado@goberna.us",
      "ana_perez-2@sub.dominio.com.pe",
      "josé@goberna.us",
    ]) {
      assert.deepEqual(leerDestinatario(buena), { ok: true, direccion: buena }, buena);
    }
  });
});
