import { describe, it } from "node:test";
import assert from "node:assert";
import { armarSystemPrompt, armarContextoContacto } from "./prompt.js";
import type { Hecho } from "../hechos/catalogo.js";
import type { ResumenPieza } from "./acciones.js";

const hechoBase: Hecho = {
  clave: "cuotas",
  rotulo: "Se puede en 2 cuotas",
  texto: "El pago se puede hacer en 2 cuotas.",
  momentos: [],
  orden: 1,
};

const piezaEnviable: ResumenPieza = {
  clase: "plantilla",
  id: "5",
  descripcion: "Flyer Contrainteligencia",
  enviable: true,
};

const piezaNoEnviable: ResumenPieza = {
  clase: "hecho",
  id: "acceso",
  descripcion: "Acceso por un año",
  enviable: false,
};

describe("armarSystemPrompt", () => {
  it("es determinista: mismos inputs → mismo string exacto", () => {
    const entrada = {
      hechos: [hechoBase],
      piezas: [piezaEnviable],
      lecciones: ["No preguntar por precio en el primer mensaje."],
    };
    const a = armarSystemPrompt(entrada);
    const b = armarSystemPrompt(entrada);
    assert.strictEqual(a, b);
  });

  it("las 8 reglas duras están presentes", () => {
    const prompt = armarSystemPrompt({
      hechos: [hechoBase],
      piezas: [piezaEnviable],
      lecciones: [],
    });
    assert.ok(prompt.includes("FLUJO DE PRIMER CONTACTO"));
    // El nombre del bot es Sofía Rodríguez desde el 1-ago-2026 (decisión del dueño).
    // El test se fija en el nombre VIGENTE a propósito: si alguien lo cambia sin
    // actualizar la plantilla de la base, los dos nombres conviven en el mismo hilo.
    assert.ok(prompt.includes("Hola, te saluda Sofía Rodríguez"));
    assert.ok(prompt.includes("NUNCA escribas cifras de precio"));
    assert.ok(prompt.includes("NUNCA inventes datos"));
    assert.ok(prompt.includes("NUNCA digas ni insinúes que eres un bot"));
    assert.ok(prompt.includes("piden hablar con una persona"));
    assert.ok(prompt.includes("dicen que no les interesa"));
    assert.ok(prompt.includes("pide precio, cotización"));
    assert.ok(prompt.includes("registrar_interes") && prompt.includes("No digas"));
    assert.ok(prompt.includes("anoté tu interés"));
    assert.ok(prompt.includes("No prometas nada"));
  });

  it("una pieza no enviable NO aparece en <piezas_enviables>", () => {
    const prompt = armarSystemPrompt({
      hechos: [],
      piezas: [piezaEnviable, piezaNoEnviable],
      lecciones: [],
    });
    assert.ok(prompt.includes("[plantilla:5]"));
    assert.ok(!prompt.includes("[hecho:acceso]"));
  });

  it("cero hechos → sección dice explícitamente que no hay datos", () => {
    const prompt = armarSystemPrompt({
      hechos: [],
      piezas: [],
      lecciones: [],
    });
    assert.ok(prompt.includes("No hay datos afirmables configurados"));
    assert.ok(!prompt.includes("[cuotas]"));
  });

  it("el orden de secciones es fijo", () => {
    const prompt = armarSystemPrompt({
      hechos: [hechoBase],
      piezas: [piezaEnviable],
      lecciones: ["Una lección."],
    });
    const idxRol = prompt.indexOf("<rol>");
    const idxCtx = prompt.indexOf("<contexto_negocio>");
    const idxHechos = prompt.indexOf("<datos_que_puedes_afirmar>");
    const idxPiezas = prompt.indexOf("<piezas_enviables>");
    const idxReglas = prompt.indexOf("<reglas_duras>");
    const idxLecciones = prompt.indexOf("<lecciones>");

    assert.ok(idxRol >= 0);
    assert.ok(idxCtx > idxRol);
    assert.ok(idxHechos > idxCtx);
    assert.ok(idxPiezas > idxHechos);
    assert.ok(idxReglas > idxPiezas);
    assert.ok(idxLecciones > idxReglas);
  });

  it("sin lecciones no incluye la sección", () => {
    const prompt = armarSystemPrompt({
      hechos: [],
      piezas: [],
      lecciones: [],
    });
    assert.ok(!prompt.includes("<lecciones>"));
  });
});

describe("armarContextoContacto", () => {
  it("con nombre y procedencia", () => {
    const ctx = armarContextoContacto({
      nombre: "María",
      procedenciaNombre: "WhatsApp",
    });
    assert.ok(ctx.includes("María"));
    assert.ok(ctx.includes("WhatsApp"));
  });

  it("sin datos devuelve vacío", () => {
    assert.strictEqual(armarContextoContacto({}), "");
  });

  it("con interés y señales", () => {
    const ctx = armarContextoContacto({
      nombre: "Juan",
      interes: "DIPCINTE",
      senales: ["cotizado", "cliente"],
    });
    assert.ok(ctx.includes("DIPCINTE"));
    assert.ok(ctx.includes("cotizado"));
    assert.ok(ctx.includes("cliente"));
  });

  it("con país confirmado lo dice sin calificativo", () => {
    const ctx = armarContextoContacto({
      nombre: "María",
      pais: "Perú",
      procedenciaPais: "de Cerberus",
    });
    assert.ok(ctx.includes("País: Perú"));
    assert.ok(ctx.includes("(de Cerberus)"));
    assert.ok(!ctx.includes("País probable"));
  });

  it("el país por prefijo se marca como probable", () => {
    const ctx = armarContextoContacto({
      nombre: "Javier",
      pais: "México",
      procedenciaPais: "del prefijo del teléfono",
    });
    assert.ok(ctx.includes("País probable: México"));
    assert.ok(ctx.includes("(del prefijo del teléfono)"));
  });

  /**
   * El país NO se pregunta (decisión del dueño, 1-ago-2026): ya viene en el
   * código del teléfono y `armarContextoContacto` se lo pasa al modelo en cada
   * turno. Preguntarlo gastaba un turno entero por lead — a René (5215646898604)
   * le costó el de las 11:29 — para conseguir un dato que ya estaba en el `521`.
   *
   * Se fija acá, sobre el string del prompt, porque es lo único que el modelo
   * lee: la regla no vive en ningún `if` que se pueda testear de otra forma.
   */
  it("el prompt prohíbe preguntar el país y no lo pide en el primer contacto", () => {
    const prompt = armarSystemPrompt({ hechos: [], piezas: [], lecciones: [] });
    assert.ok(prompt.includes("NUNCA preguntes de qué país escribe"));
    assert.ok(!prompt.includes("NOMBRE y PAÍS"));
  });

  /**
   * LA IDENTIDAD NO PUEDE SALIR DEL HILO.
   *
   * Medido en producción el 3-ago-2026, sobre las 171 respuestas que el bot
   * llegó a mandar: **39 se presentaron como «Kathy Alva, asesora académica» y
   * 6 como «Sofía Rodríguez, asesora comercial»** — dos personas distintas, con
   * dos cargos distintos, saliendo del mismo número. Kathy Alva es una asesora
   * REAL: su nombre entró al hilo por un envío a mano (30-jul, línea 51941654039)
   * y por el prompt viejo (`edbca9d`), y de ahí el modelo lo siguió tomando.
   *
   * El nombre ya se corrigió en el prompt, pero eso **no alcanza**: quedan 64
   * leads con «Kathy Alva» escrito en su hilo —54 de ellos en conversaciones
   * todavía vivas— y el modelo lee ese historial en cada turno. Sin una regla
   * explícita, el turno siguiente vuelve a presentarse con el nombre que
   * encuentra escrito, y la identidad del bot pasa a depender de quién atendió
   * antes. Eso es lo que se ve desde afuera como «el bot responde inestable».
   *
   * El segundo `assert` es el candado que importa: no fija que la regla exista
   * —eso es la letra—, fija que **ningún otro nombre de asesora vuelva a entrar
   * al prompt**. Es la forma de test que ya usa `plantillas.test.ts` para
   * prohibir «automático»/«bot»/«sistema»: se prohíbe la clase, no el caso.
   */
  /**
   * EL PROMPT PROHIBÍA EL VOSEO Y LO USABA EN SUS PROPIAS INSTRUCCIONES.
   *
   * El bloque `<rol>` exige "tú" y lista "tenés/podés/sos/decime" como formas
   * PROHIBIDAS; tres reglas más abajo, el mismo texto decía «VOS SOS LA
   * ASESORA», «si no tenés el dato: pedí un momento y decí que se lo traés
   * vos», «Escalá igual», «que no controlás», «citá su contenido». El modelo
   * recibía la regla y su contraejemplo en el mismo string.
   *
   * En las 171 respuestas medidas el voseo salió 0 veces, así que esto no
   * estaba haciendo daño todavía — se arregla igual, porque una instrucción que
   * se desmiente a sí misma es deuda que se cobra sola cuando cambia el modelo
   * o sube la temperatura, y el costo de arreglarla ahora es un texto.
   *
   * El test descarta lo que está entre comillas: ahí es donde la regla CITA las
   * formas prohibidas, y prohibirlas ahí sería prohibir el enunciado mismo.
   *
   * Compara PALABRAS COMPLETAS, no `\b...\b`: en JS los acentos no son `\w`, así
   * que `/\bdecí\b/` matchea adentro de «decírselo» —que es correcto y está en la
   * regla 7— y el test se acusaba solo.
   */
  it("el prompt no usa voseo fuera de la lista que lo prohíbe", () => {
    const prompt = armarSystemPrompt({ hechos: [], piezas: [], lecciones: [] });
    // Fuera lo entrecomillado: la lista de formas prohibidas y los ejemplos.
    const sinCitas = prompt.replace(/"[^"]*"/g, "");
    const palabras = new Set(
      (sinCitas.toLowerCase().match(/[a-záéíóúüñ]+/g) ?? []),
    );

    const VOSEO = [
      "tenés", "podés", "querés", "sabés", "traés", "controlás", "necesitás",
      "sos", "vos", "citá", "pedí", "decí", "escalá", "mandá", "fijate",
    ];
    for (const forma of VOSEO) {
      assert.ok(
        !palabras.has(forma),
        `el prompt usa voseo («${forma}») en una regla, y el bloque <rol> lo prohíbe`,
      );
    }
  });

  it("fija la identidad contra el historial y no admite otro nombre de asesora", () => {
    const prompt = armarSystemPrompt({ hechos: [], piezas: [], lecciones: [] });

    assert.ok(prompt.includes("TU IDENTIDAD NO LA DEFINE EL HISTORIAL"));
    assert.ok(prompt.includes("NO lo adoptes ni te presentes con él"));

    // Ninguna asesora que no sea Sofía Rodríguez puede nombrarse acá.
    const NOMBRES_PROHIBIDOS = [/\bKathy\b/i, /\bAlva\b/i, /asesora académica/i];
    for (const prohibido of NOMBRES_PROHIBIDOS) {
      assert.ok(
        !prohibido.test(prompt),
        `el prompt nombra a otra asesora (${prohibido}): dos identidades en el mismo número`,
      );
    }
  });
});
