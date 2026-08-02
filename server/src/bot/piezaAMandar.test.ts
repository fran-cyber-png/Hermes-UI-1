import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  despacharPasos,
  esperaEntreMensajes,
  prepararEnvio,
  type PasoListo,
  type PiezaDelBot,
} from "./piezaAMandar.js";

/**
 * LO QUE DECIDE SI UNA PIEZA SALE — puro, sin base ni disco.
 *
 * Las guardas se prueban acá y no contra la ruta a propósito: el caso que
 * importa es el que todavía no pasó (un flyer cuyo archivo alguien borró, un
 * `{precio}` que Cerberus no pudo resolver), y esos no se pueden montar en una
 * base de prueba sin inventarlos igual.
 */

const FLYER: PiezaDelBot = {
  clase: "plantilla",
  id: "12",
  vigente: true,
  familiaCurso: "DIPICOT",
  pasos: [
    {
      orden: 1,
      texto: "Hola {nombre}, te dejo el flyer 👇",
      media: { archivo: "flyer-julio.jpg", mime: "image/jpeg", clase: "imagen", nombre: "flyer" },
      mediaPendiente: false,
    },
    { orden: 2, texto: "Cualquier duda me decís.", media: null, mediaPendiente: false },
  ],
};

const SIEMPRE = () => true;
const NUNCA = () => false;
const JAVIER = { variables: { nombre: "Javier" }, existeArchivo: SIEMPRE };

describe("prepararEnvio — las cinco guardas", () => {
  it("una pieza aprobada, con archivo y sin huecos, sale entera", () => {
    const r = prepararEnvio(FLYER, JAVIER);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.pasos.length, 2);
    assert.equal(r.pasos[0]!.texto, "Hola Javier, te dejo el flyer 👇");
    assert.ok(r.pasos[0]!.media, "el paso 1 lleva su adjunto");
  });

  it("EL CONTENIDO QUE SE VERSIONA ES EL AUTORAL, no el expandido", () => {
    // Si se hasheara «Hola Javier…», cada destinatario sería una versión
    // distinta de la misma pieza y el versionado no mediría nada.
    const r = prepararEnvio(FLYER, JAVIER);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.pasos[0]!.contenido.texto, "Hola {nombre}, te dejo el flyer 👇");
    assert.equal(r.pasos[0]!.contenido.archivo, "flyer-julio.jpg");
  });

  it("una pieza que no existe no sale (y no explota)", () => {
    const r = prepararEnvio(null, JAVIER);
    assert.equal(r.ok, false);
    assert.equal(r.ok === false && r.motivo, "no_existe");
  });

  it("GUARDA 1 — una propuesta sin aprobar no sale", () => {
    const r = prepararEnvio({ ...FLYER, vigente: false }, JAVIER);
    assert.equal(r.ok === false && r.motivo, "no_vigente");
  });

  it("GUARDA 2 — un paso con la imagen pendiente frena la pieza ENTERA", () => {
    // No se manda medio mensaje, y tampoco «el resto»: los pasos de una
    // secuencia se explican unos a otros.
    const conHueco: PiezaDelBot = {
      ...FLYER,
      pasos: [
        FLYER.pasos[0]!,
        { orden: 2, texto: "y acá el temario", media: null, mediaPendiente: true },
      ],
    };
    const r = prepararEnvio(conHueco, JAVIER);
    assert.equal(r.ok === false && r.motivo, "media_pendiente");
  });

  it("GUARDA 3 — un nombre de archivo con `..` no llega a armar una ruta", () => {
    const travesia: PiezaDelBot = {
      ...FLYER,
      pasos: [
        {
          ...FLYER.pasos[0]!,
          media: { archivo: "../../.env", mime: "text/plain", clase: "documento", nombre: null },
        },
      ],
    };
    const r = prepararEnvio(travesia, JAVIER);
    assert.equal(r.ok === false && r.motivo, "archivo_invalido");
  });

  it("GUARDA 4 — si el archivo ya no está en el server, no se manda el texto solo", () => {
    const r = prepararEnvio(FLYER, { ...JAVIER, existeArchivo: NUNCA });
    assert.equal(r.ok === false && r.motivo, "archivo_ausente");
  });

  it("🔴 GUARDA 5 — con `faltantes`, el bot NO manda (la ruta sí, y ahí está bien)", () => {
    // Para una vendedora, `[precio]` en pantalla es un aviso: lo completa antes
    // de apretar. Para un lead es un mensaje roto que ya salió.
    const conPrecio: PiezaDelBot = {
      ...FLYER,
      pasos: [{ orden: 1, texto: "El diploma sale {precio}.", media: null, mediaPendiente: false }],
    };
    const r = prepararEnvio(conPrecio, { variables: { nombre: "Javier" }, existeArchivo: SIEMPRE });
    assert.equal(r.ok === false && r.motivo, "faltan_variables");
    assert.ok(r.ok === false && r.detalle.includes("[precio]"), "el detalle dice qué faltó");
  });

  it("con el precio resuelto, el mismo paso sí sale", () => {
    const conPrecio: PiezaDelBot = {
      ...FLYER,
      pasos: [{ orden: 1, texto: "El diploma sale {precio}.", media: null, mediaPendiente: false }],
    };
    const r = prepararEnvio(conPrecio, {
      variables: { nombre: "Javier", precio: 250, moneda: "USD" },
      existeArchivo: SIEMPRE,
    });
    assert.equal(r.ok, true);
    assert.equal(r.ok && r.pasos[0]!.texto, "El diploma sale USD 250.");
  });

  it("un `{nombre}` sin nombre tampoco sale: «Hola [nombre]» es peor que el silencio", () => {
    const r = prepararEnvio(FLYER, { variables: {}, existeArchivo: SIEMPRE });
    assert.equal(r.ok === false && r.motivo, "faltan_variables");
  });

  it("una pieza sin pasos no es un mensaje vacío: es un error", () => {
    const r = prepararEnvio({ ...FLYER, pasos: [] }, JAVIER);
    assert.equal(r.ok === false && r.motivo, "sin_pasos");
  });

  it("un paso sin texto y sin archivo es un hueco, no un mensaje", () => {
    const vacio: PiezaDelBot = {
      ...FLYER,
      pasos: [{ orden: 1, texto: null, media: null, mediaPendiente: false }],
    };
    assert.equal(prepararEnvio(vacio, JAVIER).ok === false, true);
  });

  it("un hecho (un solo mensaje, sin adjunto) sale como cualquier otra pieza", () => {
    const hecho: PiezaDelBot = {
      clase: "hecho",
      id: "cuotas",
      vigente: true,
      familiaCurso: null,
      pasos: [
        { orden: 1, texto: "Se puede pagar en 2 cuotas.", media: null, mediaPendiente: false },
      ],
    };
    const r = prepararEnvio(hecho, JAVIER);
    assert.equal(r.ok, true);
    assert.equal(r.ok && r.pasos[0]!.texto, "Se puede pagar en 2 cuotas.");
  });
});

// ── El despacho ──────────────────────────────────────────────────────────────

function pasos(n: number): PasoListo[] {
  return Array.from({ length: n }, (_, i) => ({
    orden: i + 1,
    texto: `mensaje ${i + 1}`,
    media: null,
    contenido: { texto: `mensaje ${i + 1}`, archivo: null },
  }));
}

describe("despacharPasos — el orden, el ritmo y el corte", () => {
  it("salen en orden y espaciados: nadie escribe cuatro mensajes en el mismo segundo", async () => {
    const salieron: number[] = [];
    const esperas: number[] = [];
    const r = await despacharPasos(
      pasos(3),
      async (p) => {
        salieron.push(p.orden);
        return { ok: true };
      },
      { esperar: async (ms) => void esperas.push(ms), azar: () => 0.5 },
    );
    assert.deepEqual(salieron, [1, 2, 3]);
    assert.equal(r.enviados, 3);
    assert.equal(r.corte, null);
    // Dos esperas para tres mensajes: no se espera después del último.
    assert.deepEqual(esperas, [4000, 4000]);
  });

  it("🔴 CORTA AL PRIMER FALLO — el resto de la secuencia no sale detrás", async () => {
    // Si el flyer no salió, el «acá va el temario» que lo sigue deja una
    // conversación que no se entiende. Y si falló el primero, lo más probable es
    // que la línea esté caída: seguir es escribir contra un número muerto.
    const salieron: number[] = [];
    const r = await despacharPasos(
      pasos(4),
      async (p) => {
        salieron.push(p.orden);
        return p.orden === 2 ? { ok: false, motivo: "la sesión está \"baneado\"" } : { ok: true };
      },
      { esperar: async () => {} },
    );
    assert.deepEqual(salieron, [1, 2], "el 3 y el 4 ni se intentan");
    assert.equal(r.enviados, 1, "cortar no des-envía el que ya salió");
    assert.equal(r.corte?.orden, 2);
    assert.ok(r.corte?.motivo.includes("baneado"));
  });

  it("un fallo en el primer paso no manda nada", async () => {
    const r = await despacharPasos(pasos(3), async () => ({ ok: false, motivo: "sin transporte" }), {
      esperar: async () => {},
    });
    assert.equal(r.enviados, 0);
    assert.equal(r.corte?.orden, 1);
  });

  it("la espera está entre 2 y 6 segundos, siempre", () => {
    assert.equal(esperaEntreMensajes(() => 0), 2000);
    assert.equal(esperaEntreMensajes(() => 1), 6000);
  });
});

/**
 * EL KILL-SWITCH ENTRE PASOS.
 *
 * Un revisor adversario lo encontró antes de que llegara a producción: el freno
 * se leía UNA vez arriba del bucle, y el bucle puede correr más de un minuto
 * (hasta 6 s de Cerberus por pieza más el espaciado de 2–6 s). La vendedora que
 * aprieta «apagar» a los veinte segundos veía salir igual los pasos que
 * faltaban, con sus adjuntos.
 *
 * Lo que se fija acá es que `abortar` se pregunta ENTRE pasos y que corta.
 */
describe("despacharPasos — el corte por kill-switch", () => {
  const paso = (orden: number): PasoListo => ({
    orden,
    texto: `paso ${orden}`,
    media: null,
    contenido: { texto: `paso ${orden}`, archivo: null },
  });

  it("corta antes del paso siguiente cuando abortar devuelve un motivo", async () => {
    const enviados: number[] = [];
    let vueltas = 0;
    const r = await despacharPasos(
      [paso(1), paso(2), paso(3)],
      async (p) => {
        enviados.push(p.orden);
        return { ok: true };
      },
      {
        esperar: async () => {},
        // Levanta el freno recién después de la primera pregunta, que es el
        // caso real: la vendedora aprieta mientras la secuencia va por la mitad.
        abortar: async () => (++vueltas >= 2 ? "apagada_en_vuelo:apagado" : null),
      },
    );

    assert.deepEqual(enviados, [1, 2], "el paso 3 salió después de apagar");
    assert.equal(r.enviados, 2);
    assert.equal(r.corte?.orden, 3);
    assert.equal(r.corte?.motivo, "apagada_en_vuelo:apagado");
  });

  it("NO se pregunta antes del primer paso: eso ya lo decidió el orquestador", async () => {
    let preguntas = 0;
    await despacharPasos([paso(1)], async () => ({ ok: true }), {
      esperar: async () => {},
      abortar: async () => {
        preguntas++;
        return null;
      },
    });
    assert.equal(preguntas, 0, "preguntó de más: el freno inicial ya se leyó afuera");
  });

  it("sin `abortar` se comporta como antes: manda todo", async () => {
    const r = await despacharPasos([paso(1), paso(2)], async () => ({ ok: true }), {
      esperar: async () => {},
    });
    assert.equal(r.enviados, 2);
    assert.equal(r.corte, null);
  });
});
