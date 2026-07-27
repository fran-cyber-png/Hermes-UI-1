import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { baseDePrueba } from "../pruebas/base.js";
import { sembrarInteres, sembrarLead, sembrarMensaje } from "../pruebas/sembrar.js";
import { consultarCola } from "../cola/consultarCola.js";
import { ALIAS_SEMILLA, familiaDeAnuncio, familiaDeTexto } from "../cursos/alias.js";
import { cursoDeConversacion } from "../cursos/precedencia.js";
import { consultarNegocio } from "./negocio.js";

/**
 * ══ EL TEST DE PARIDAD COLA ↔ DASHBOARD ═════════════════════════════════════
 *
 * El bug que este archivo existe para que no vuelva: el Dashboard decía «Sin
 * curso identificado: 68 de 70 (97 %)» mientras la cola de al lado le pintaba el
 * chip «Inteligencia Estratég…» a casi todas las filas. Dos partes del sistema
 * mirando el MISMO dato y contando cosas distintas — porque el Dashboard usaba
 * solo el formulario y la cola usaba la precedencia entera.
 *
 * Es el tercer episodio de la misma clase de falla en este repo (la urgencia,
 * #37/ADR 0009; la etapa efectiva, ADR 0013), así que se cierra igual: con un
 * test que corre las DOS lecturas sobre los MISMOS datos sembrados y falla si
 * difieren. No compara números de una planilla: compara sistema contra sistema.
 *
 * La comparación es sobre la pregunta que las dos contestan —«¿de qué curso es
 * esta conversación?»— resuelta con la única definición que hay:
 * `cursos/precedencia.ts` sobre lo que sirve la cola, contra lo que agrupa el
 * Dashboard con su gemelo en SQL.
 */

const AHORA = new Date("2026-07-25T18:00:00Z");
const enLima = (dia: string, hora: string) => new Date(`${dia}T${hora}-05:00`);
const RANGO = { desde: new Date("2026-07-19T05:00:00Z"), hasta: new Date("2026-07-26T05:00:00Z") };

const opciones = (extra: Record<string, unknown> = {}) => ({
  ...RANGO,
  ahora: AHORA,
  dimension: "curso" as const,
  aliases: ALIAS_SEMILLA,
  ...extra,
});

const clave = (personaId: string, numeroPropio = "51999999999") =>
  `conv:whatsapp:${personaId}:${numeroPropio}`;

/** El anuncio de Click-to-WhatsApp tal como lo guarda `whatsapp/origen.ts`. */
const anuncio = (titulo: string | null, adId = "120215551234567") => ({
  fuente: "anuncio",
  titulo,
  adId,
});

/** Lo que la cola sirve de una fila: los tres candidatos de curso. */
interface FilaDeCola {
  clave: string;
  interes_curso: string | null;
  lead_curso: string | null;
  origen_anuncio: { fuente: string; titulo?: string | null; adId?: string | null } | null;
  ultima_origen: { fuente: string; titulo?: string | null; adId?: string | null } | null;
}

/** La familia que le corresponde a una fila de la COLA, con las piezas compartidas. */
function familiaSegunLaCola(f: FilaDeCola): { etiqueta: string | null; familia: string | null } {
  const curso = cursoDeConversacion({
    interesCurso: f.interes_curso,
    leadCurso: f.lead_curso,
    anuncio: f.origen_anuncio ?? f.ultima_origen,
  });
  if (!curso) return { etiqueta: null, familia: null };

  const alias =
    curso.fuente === "anuncio"
      ? familiaDeAnuncio(ALIAS_SEMILLA, { adId: curso.adId, titulo: curso.crudo })
      : familiaDeTexto(ALIAS_SEMILLA, curso.crudo);
  return { etiqueta: alias?.nombreCurso ?? (curso.crudo || null), familia: alias?.familia ?? null };
}

describe("paridad cola ↔ dashboard: el curso de una conversación es UNO", () => {
  test("EL BUG: sin lead ni interés, el ANUNCIO identifica el curso en las dos lecturas", async (t) => {
    const db = await baseDePrueba(t);

    // Una conversación que llegó por «[JUL] INTELIGENCIA | WSP» y nada más: sin
    // formulario y sin interés asentado. Es el caso masivo de producción, y el
    // que el Dashboard contaba como «sin curso identificado».
    await sembrarMensaje(db, {
      personaId: "51900000001",
      origen: anuncio("[JUL] INTELIGENCIA | WSP"),
      occurredAt: enLima("2026-07-22", "10:00"),
    });

    const negocio = await consultarNegocio(db, opciones());
    const fila = negocio.filas.find((f) => f.familia === "DIPICOT");

    assert.ok(fila, "el Dashboard tiene que atribuir la conversación a DIPICOT por el anuncio");
    assert.equal(fila.llegaron, 1);
    assert.equal(fila.clave, "Inteligencia y Contrainteligencia");
    assert.equal(negocio.sin_atribuir, 0, "ya no hay «sin curso identificado» que no lo sea");
  });

  test("las dos lecturas coinciden conversación por conversación, en los cuatro casos", async (t) => {
    const db = await baseDePrueba(t);

    // (a) solo anuncio → gana el anuncio.
    await sembrarMensaje(db, {
      personaId: "51900000001",
      origen: anuncio("[JUL] INTELIGENCIA | WSP"),
      occurredAt: enLima("2026-07-22", "10:00"),
    });

    // (b) anuncio + formulario → gana el formulario (lo que la persona eligió).
    await sembrarMensaje(db, {
      personaId: "51900000002",
      origen: anuncio("[JUL] INTELIGENCIA | WSP"),
      occurredAt: enLima("2026-07-22", "11:00"),
    });
    await sembrarLead(db, {
      phone: "51900000002",
      campaignName: "Ciberinteligencia y Ciberdefensa",
      createdTime: enLima("2026-07-21", "09:00"),
    });

    // (c) anuncio + formulario + interés asentado → gana el interés.
    await sembrarMensaje(db, {
      personaId: "51900000003",
      origen: anuncio("[JUL] INTELIGENCIA | WSP"),
      occurredAt: enLima("2026-07-22", "12:00"),
    });
    await sembrarLead(db, {
      phone: "51900000003",
      campaignName: "Ciberinteligencia y Ciberdefensa",
      createdTime: enLima("2026-07-21", "09:00"),
    });
    await sembrarInteres(db, {
      clave: clave("51900000003"),
      curso: "Diploma técnico en Osint & Socmint",
    });

    // (d) nada de nada → sin atribuir, y las dos lo dicen igual.
    await sembrarMensaje(db, {
      personaId: "51900000004",
      occurredAt: enLima("2026-07-22", "13:00"),
    });

    const cola = await consultarCola(db, { limit: 100 });
    const filasCola = cola.conversaciones as unknown as FilaDeCola[];
    assert.equal(filasCola.length, 4, "las cuatro conversaciones están en la cola");

    // Lo que la COLA dice de cada una, con la precedencia + el diccionario.
    const esperadoPorFamilia = new Map<string | null, number>();
    for (const f of filasCola) {
      const { familia } = familiaSegunLaCola(f);
      esperadoPorFamilia.set(familia, (esperadoPorFamilia.get(familia) ?? 0) + 1);
    }

    // Lo que el DASHBOARD dice, agrupado por familia.
    const negocio = await consultarNegocio(db, opciones());
    const realPorFamilia = new Map<string | null, number>();
    for (const fila of negocio.filas) {
      realPorFamilia.set(fila.familia ?? null, (realPorFamilia.get(fila.familia ?? null) ?? 0) + fila.llegaron);
    }

    assert.deepEqual(
      [...realPorFamilia.entries()].sort(),
      [...esperadoPorFamilia.entries()].sort(),
      "la cola y el Dashboard tienen que atribuir exactamente las mismas conversaciones",
    );

    // Y el reparto es el esperado, para que el test falle con un mensaje útil si
    // alguna vez cambia la precedencia sin querer.
    assert.deepEqual(
      [...esperadoPorFamilia.entries()].sort(),
      [
        [null, 1], // (d)
        ["DIPCINTE", 1], // (b), el formulario
        ["DIPICOT", 1], // (a), el anuncio
        ["DIPOSOC", 1], // (c), el interés asentado
      ].sort(),
    );
  });

  test("un anuncio que no nombra ningún curso NO se inventa una familia: sale con su texto", async (t) => {
    const db = await baseDePrueba(t);
    await sembrarMensaje(db, {
      personaId: "51900000005",
      origen: anuncio("Adquiérelo ahora"),
      occurredAt: enLima("2026-07-22", "10:00"),
    });

    const negocio = await consultarNegocio(db, opciones());
    const fila = negocio.filas.find((f) => f.clave === "Adquiérelo ahora");

    assert.ok(fila, "la fila existe con el texto crudo: un gap con volumen hay que verlo");
    assert.equal(fila.familia, null, "sin alias que matchee no se inventa una familia");
    assert.equal(negocio.sin_atribuir, 0, "«sin atribuir» es no saber NADA, no «no sé traducirlo»");
  });

  test("el anuncio se lee del PRIMER mensaje: una conversación que siguió no pierde su curso", async (t) => {
    const db = await baseDePrueba(t);
    // El referral de Click-to-WhatsApp viaja solo en el primer mensaje.
    await sembrarMensaje(db, {
      personaId: "51900000006",
      origen: anuncio("[JUL] INTELIGENCIA | WSP"),
      occurredAt: enLima("2026-07-22", "10:00"),
    });
    await sembrarMensaje(db, {
      personaId: "51900000006",
      texto: "¿me pasas el temario?",
      occurredAt: enLima("2026-07-22", "10:30"),
    });

    const negocio = await consultarNegocio(db, opciones());
    assert.equal(negocio.filas.find((f) => f.familia === "DIPICOT")?.llegaron, 1);

    const [fila] = (await consultarCola(db, { limit: 10 })).conversaciones as unknown as FilaDeCola[];
    assert.equal(familiaSegunLaCola(fila).familia, "DIPICOT", "la cola tampoco lo pierde");
  });
});
