import { describe, it } from "node:test";
import assert from "node:assert";
import { crearTools } from "./tools.js";
import type { Accion, ResumenPieza } from "./acciones.js";

const catalogo: ResumenPieza[] = [
  { clase: "plantilla", id: "5", descripcion: "Flyer Contrainteligencia", enviable: true },
  { clase: "hecho", id: "cuotas", descripcion: "Se puede en 2 cuotas", enviable: false },
];

describe("crearTools", () => {
  /**
   * ESTE TEST SE DIO VUELTA DOS VECES, y la tercera versión es la que queda.
   *
   * 1. Pedía la confirmación («agendada para enviar») cuando `ejecutar.ts`
   *    descartaba la acción. El modelo le creía y redactaba como si el documento
   *    hubiera salido: «Ya tienes en tu chat el temario completo» (Carlos,
   *    1-ago-2026 12:09:38), y quince segundos después el lead: «No tengo nada
   *    todavía apenas estoy pidiendo la información».
   * 2. Pasó a exigir «NO se envió», que era la verdad mientras F3 no existía.
   * 3. **Con F3 conectado, «NO se envió» volvió a ser mentira**: la pieza sale,
   *    justo detrás de este mensaje. Lo que se fija ahora es lo único cierto en
   *    el instante en que el modelo lee la respuesta — todavía no salió, pero va
   *    a salir— y lo que no cambió nunca: que el pasado sigue prohibido, porque
   *    «ya lo tienes» es falso mientras el lead lo lee.
   */
  it("mandar_pieza con id existente → acumula y promete el envío EN FUTURO, nunca en pasado", () => {
    const recolector: Accion[] = [];
    const { handlers } = crearTools(recolector, catalogo);
    const result = handlers["mandar_pieza"]!({ id: "plantilla:5" });
    assert.ok(/anotada/i.test(result), `no confirma que quedó anotada: «${result}»`);
    assert.ok(/JUSTO DESPUÉS/i.test(result), `no dice cuándo sale: «${result}»`);
    // Solo las formas AFIRMATIVAS del pasado. Nada de buscar «ya la tiene»: el
    // propio mensaje la contiene, dentro de la prohibición de la línea siguiente.
    assert.ok(!/\benviad[ao]\b|\bagendad[ao]\b/i.test(result), `afirma el pasado: «${result}»`);
    // Y la prohibición explícita sigue viajando: es la que evitó los seis leads
    // de esa mañana.
    assert.ok(/NO digas que ya la tiene/i.test(result), `perdió la prohibición: «${result}»`);
    assert.strictEqual(recolector.length, 1);
    assert.deepStrictEqual(recolector[0], {
      tipo: "mandar_pieza",
      clase: "plantilla",
      id: "5",
    });
  });

  /**
   * EL DEDUPE DEL TURNO. Ahora que el texto del modelo sobrevive a la vuelta con
   * `tool_use` (`agente.ts`), lo natural es que en la vuelta siguiente vuelva a
   * narrar «te paso el flyer» — y de ahí a volver a llamar la tool hay un paso.
   * Sin esta guarda eso son DOS flyers idénticos al mismo lead.
   */
  it("mandar_pieza dos veces con la MISMA pieza → una sola acción, y se lo dice", () => {
    const recolector: Accion[] = [];
    const { handlers } = crearTools(recolector, catalogo);
    handlers["mandar_pieza"]!({ id: "plantilla:5" });
    const segunda = handlers["mandar_pieza"]!({ id: "plantilla:5" });
    assert.ok(/YA está anotada/i.test(segunda), `no avisa que estaba repetida: «${segunda}»`);
    assert.strictEqual(recolector.length, 1, "la pieza sale UNA vez");
  });

  /**
   * EL DEDUPE POR CONVERSACIÓN, DICHO A TIEMPO. Se le pasa al armar las tools —
   * leído de `envios_wa`— en vez de chequearse solo antes de despachar: si el
   * modelo se entera recién ahí, el turno YA salió prometiendo un flyer que
   * después se bloquea. Incluye lo que la vendedora mandó a mano, que es la
   * mitad que el bot no puede ver de ninguna otra forma.
   */
  it("una pieza que esa conversación YA recibió no se acumula, y se le explica", () => {
    const recolector: Accion[] = [];
    const { handlers } = crearTools(recolector, catalogo, undefined, new Set(["plantilla:5"]));
    const result = handlers["mandar_pieza"]!({ id: "plantilla:5" });
    assert.ok(/YA le llegó/i.test(result), `no le dice que ya la tiene: «${result}»`);
    assert.strictEqual(recolector.length, 0, "no se manda de nuevo");
  });

  it("lo que ya recibió NO bloquea a las demás piezas", () => {
    const recolector: Accion[] = [];
    const conDos = [
      ...catalogo,
      { clase: "plantilla" as const, id: "9", descripcion: "Temario", enviable: true },
    ];
    const { handlers } = crearTools(recolector, conDos, undefined, new Set(["plantilla:5"]));
    handlers["mandar_pieza"]!({ id: "plantilla:9" });
    assert.strictEqual(recolector.length, 1);
  });

  it("dos piezas DISTINTAS sí se acumulan las dos", () => {
    const recolector: Accion[] = [];
    const conDos = [
      ...catalogo,
      { clase: "plantilla" as const, id: "9", descripcion: "Temario", enviable: true },
    ];
    const { handlers } = crearTools(recolector, conDos);
    handlers["mandar_pieza"]!({ id: "plantilla:5" });
    handlers["mandar_pieza"]!({ id: "plantilla:9" });
    assert.strictEqual(recolector.length, 2);
  });

  it("mandar_pieza con id inexistente → no acumula, devuelve error", () => {
    const recolector: Accion[] = [];
    const { handlers } = crearTools(recolector, catalogo);
    const result = handlers["mandar_pieza"]!({ id: "plantilla:99" });
    assert.ok(result.includes("no existe"));
    assert.strictEqual(recolector.length, 0);
  });

  it("mandar_pieza con pieza no enviable → error", () => {
    const recolector: Accion[] = [];
    const { handlers } = crearTools(recolector, catalogo);
    const result = handlers["mandar_pieza"]!({ id: "hecho:cuotas" });
    assert.ok(result.includes("no se puede enviar"));
    assert.strictEqual(recolector.length, 0);
  });

  /**
   * Misma vuelta que `mandar_pieza`, y con el mismo matiz: la fila **sí** se
   * escribe ahora (`ejecutar.ts` → `cursos/registrarFamilia.ts`), pero al CERRAR
   * el turno y contra el catálogo vivo de Cerberus — así que en el instante en
   * que el modelo lee esto todavía no existe, y puede no llegar a existir (la
   * familia puede no tener ninguna edición activa). Futuro, no pasado.
   */
  it("registrar_interes con familia válida → acumula y anuncia el registro en FUTURO", () => {
    const recolector: Accion[] = [];
    const { handlers } = crearTools(recolector, catalogo);
    const result = handlers["registrar_interes"]!({ familia: "DIPCINTE" });
    assert.ok(/se registra al cerrar el turno/i.test(result), `afirma de más: «${result}»`);
    // La regla 7 no se toca: esto no se le cuenta al lead.
    assert.ok(/No se lo menciones al lead/i.test(result), `perdió la regla 7: «${result}»`);
    assert.strictEqual(recolector.length, 1);
    assert.deepStrictEqual(recolector[0], {
      tipo: "registrar_interes",
      familia: "DIPCINTE",
    });
  });

  it("registrar_interes dos veces con la misma familia → una sola acción", () => {
    const recolector: Accion[] = [];
    const { handlers } = crearTools(recolector, catalogo);
    handlers["registrar_interes"]!({ familia: "DIPCINTE" });
    handlers["registrar_interes"]!({ familia: "DIPCINTE" });
    assert.strictEqual(recolector.length, 1, "pedirla dos veces no son dos idas a Cerberus");
  });

  it("registrar_interes con familia inválida → error", () => {
    const recolector: Accion[] = [];
    const { handlers } = crearTools(recolector, catalogo);
    const result = handlers["registrar_interes"]!({ familia: "INVENTADA" });
    assert.ok(result.includes("no es una familia"));
    assert.strictEqual(recolector.length, 0);
  });

  it("calificar dos veces → queda la última", () => {
    const recolector: Accion[] = [];
    const { handlers } = crearTools(recolector, catalogo);
    handlers["calificar"]!({ temperatura: "frio", motivo: "no responde" });
    handlers["calificar"]!({ temperatura: "caliente", motivo: "quiere pagar" });
    assert.strictEqual(recolector.length, 1);
    const accion = recolector[0];
    assert.strictEqual(accion.tipo, "calificar");
    if (accion.tipo === "calificar") {
      assert.strictEqual(accion.temperatura, "caliente");
      assert.strictEqual(accion.motivo, "quiere pagar");
    }
  });

  it("calificar con temperatura inválida → error", () => {
    const recolector: Accion[] = [];
    const { handlers } = crearTools(recolector, catalogo);
    const result = handlers["calificar"]!({ temperatura: "hirviendo", motivo: "x" });
    assert.ok(result.includes("debe ser"));
    assert.strictEqual(recolector.length, 0);
  });

  it("escalar_a_vendedora con motivo válido → acumula", () => {
    const recolector: Accion[] = [];
    const { handlers } = crearTools(recolector, catalogo);
    const result = handlers["escalar_a_vendedora"]!({ motivo: "pidio_humano" });
    assert.ok(result.includes("escalada"));
    assert.strictEqual(recolector.length, 1);
    assert.deepStrictEqual(recolector[0], {
      tipo: "escalar",
      motivo: "pidio_humano",
    });
  });

  it("escalar_a_vendedora con motivo inválido → error", () => {
    const recolector: Accion[] = [];
    const { handlers } = crearTools(recolector, catalogo);
    const result = handlers["escalar_a_vendedora"]!({ motivo: "quiero_hablar" });
    assert.ok(result.includes("inválido"));
    assert.strictEqual(recolector.length, 0);
  });

  it("pausar_conversacion → acumula", () => {
    const recolector: Accion[] = [];
    const { handlers } = crearTools(recolector, catalogo);
    const result = handlers["pausar_conversacion"]!({ motivo: "rechazo" });
    assert.ok(result.includes("pausada"));
    assert.strictEqual(recolector.length, 1);
    assert.deepStrictEqual(recolector[0], {
      tipo: "pausar",
      motivo: "rechazo",
    });
  });

  it("pausar_conversacion con motivo inválido → error", () => {
    const recolector: Accion[] = [];
    const { handlers } = crearTools(recolector, catalogo);
    const result = handlers["pausar_conversacion"]!({ motivo: "aburrido" });
    assert.ok(result.includes("debe ser"));
    assert.strictEqual(recolector.length, 0);
  });

  it("5 tools definidas", () => {
    const { definiciones } = crearTools([], catalogo);
    const nombres = definiciones.map((d) => d.name);
    assert.deepStrictEqual(nombres.sort(), [
      "calificar",
      "escalar_a_vendedora",
      "mandar_pieza",
      "pausar_conversacion",
      "registrar_interes",
    ]);
  });
});
