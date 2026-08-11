import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { baseDePrueba } from "../pruebas/base.js";
import { esTextoDeAnuncio, pregunto, preguntoPrecio, preguntoSql, soloClicSql } from "./pregunta.js";

/**
 * PARIDAD SQL ≡ TS DE «¿PIDIÓ ALGO?» — el candado del patrón de ADR 0009.
 *
 * El predicado vive dos veces por necesidad (la cola filtra y cuenta en la base,
 * el front y los tests lo quieren puro) y una sola por diseño. Si alguien toca un
 * nivel de un lado y no del otro, esto falla en CI en vez de callárselo.
 *
 * ⚠️ NO ES UNA PRECAUCIÓN TEÓRICA. El predicado que este módulo reemplaza existía
 * dos veces —`cola/urgenciaSql.ts` y `canales/consultas.ts`— y la segunda copia
 * tenía `info\b` donde la primera tenía `info\y`. En Postgres `\b` es un
 * backspace: esa rama **nunca matcheó nada**, sin error y sin log. Un test como
 * éste lo hubiera atrapado el día que se escribió.
 */

/**
 * El corpus. Cada línea salió de producción (censo del 11-ago-2026) salvo las
 * marcadas, que son los bordes que el corpus real no tenía.
 */
const CORPUS = [
  // El texto que prellena Meta, en sus seis variantes reales.
  "Hola Quiero más información del Diploma de Inteligencia y Contrainteligencia",
  "Hola. Quiero más información sobre el servicio de Consultoría.",
  "¡Hola! Quiero más información",
  "Hola. ¿Puedo obtener más información sobre esto?",
  "¡Hola! Me gustaría conseguir más información sobre esto.",
  "¡Hola! Quiero más información del I Foro de Estado 2026.",
  // El anuncio CON una pregunta agregada por la persona.
  "Hola Quiero más información del Diploma de Inteligencia y Contrainteligencia ¿Cuál es el costo?",
  // Señales de plata.
  // ⚠️ La primera NO es un lead: es Walter probando el bot. Se conserva por su
  // forma; las tres de abajo son de gente real y son las que justifican la regla.
  "Pásame la cotización urgentemente quiero comprar ahora mismo",
  "Cual es el precio. Gracias",
  "Sí gracias por la información si hago un negocio en éstos días les envío el pago",
  "Es un precio elevado. Gracias..para la próxima cuando ya vaya como candidato",
  "Cuantas cuotas?",
  "el nombre de yape es a nombre de una empresa?",
  "Más tarde hago el pago",
  "Buen día me podrías enviar el link de pago de nuevo del 360",
  "Cuál es el proceso de inscripción y pago",
  "Que precio tiene?",
  "COSTO",
  "Y su costo",
  "Cuanto cuesta by cuandoninicia",
  // Sustantivos concretos.
  "Como son los certificados",
  "Cuales son los requisitos ?",
  "Quisiera saber qué días es",
  "Y ese certificado en que lugar me puede servir",
  // Pedidos genéricos escritos a mano.
  "Necesito información",
  "Un poco más de información x favor",
  "Información sobre el curso",
  "Más información",
  "Me das información por favor?",
  "Hola, me interesa el diplomado de inteligencia y contrainteligencia",
  // Cierres y cortesías.
  "Ya no me interesa",
  "Ya no estoy interesado",
  "MUCHAS GRACIAS POR LA INFORMACION. EXCELNTE DIA",
  "Muchas gracias por la información. Talvez en otra ocasión. Buenas tardes!",
  "Si me decido, les avisaré. Gracias por la información.",
  "Muchas gracias por la información, ¿cuánto cuesta?",
  // Autorespuestas de otros negocios.
  "Gracias por comunicarte con Lander Valera ¿Cómo puedo ayudarte?",
  "Gracias por comunicarte con Jasper Desing. ¿Cómo podemos ayudarte? 😀",
  "Gracias por comunicarte con nosotros. Por favor, haznos saber cómo podemos ayudarte",
  // Ruido puro.
  "Cómo estás",
  "gracias",
  "ok",
  "si",
  "hola",
  "👍",
  "buenas tardes",
  // «info» a secas y sus vecinos: el borde de palabra escrito a mano.
  "info",
  "info?",
  "más info por favor",
  "un trato informal",
  "infografía del curso",
  // Bordes que el corpus real no traía.
  "no me interesa el precio",
  "HOLA QUIERO MÁS INFORMACIÓN DEL DIPLOMA",
  "hola quiero mas informacion",
] as const;

describe("paridad SQL ≡ TS, texto por texto", () => {
  test("«¿pidió algo?» dice lo mismo en Postgres que en TypeScript", async (t) => {
    const db = await baseDePrueba(t);
    for (const texto of CORPUS) {
      const [fila] = await db.execute<{ hay: boolean }>(
        sql`SELECT (${preguntoSql("t.texto")}) AS hay FROM (SELECT ${texto}::text AS texto) t`,
      );
      assert.equal(fila.hay, pregunto(texto), `«${texto}» difiere entre SQL y TS`);
    }
  });

  test("«¿solo hizo clic?» dice lo mismo en Postgres que en TypeScript", async (t) => {
    const db = await baseDePrueba(t);
    for (const texto of CORPUS) {
      const [fila] = await db.execute<{ hay: boolean }>(
        sql`SELECT (${soloClicSql("t.texto")}) AS hay FROM (SELECT ${texto}::text AS texto) t`,
      );
      assert.equal(fila.hay, esTextoDeAnuncio(texto), `«${texto}» difiere entre SQL y TS`);
    }
  });

  test("el corpus ejercita las dos respuestas de cada predicado", async () => {
    // Un test de paridad sobre un corpus que da siempre `false` pasaría con dos
    // implementaciones rotas. Esto verifica que el corpus discrimine.
    const conteo = (f: (s: string) => boolean) => CORPUS.filter(f).length;
    assert.ok(conteo(pregunto) >= 10, "pocos positivos de `pregunto` en el corpus");
    assert.ok(conteo((s) => !pregunto(s)) >= 10, "pocos negativos de `pregunto` en el corpus");
    assert.ok(conteo(esTextoDeAnuncio) >= 5, "pocos textos de anuncio en el corpus");
    assert.ok(conteo(preguntoPrecio) >= 8, "pocas señales de plata en el corpus");
  });
});
