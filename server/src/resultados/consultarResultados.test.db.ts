import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { baseDePrueba, type DbDePrueba } from "../pruebas/base.js";
import {
  sembrarConversionWa,
  sembrarEnvioWa,
  sembrarGestion,
  sembrarMensaje,
} from "../pruebas/sembrar.js";
import { A_MANO, deUnDato, deUnPasoDePlantilla } from "../procedencia/pieza.js";
import { agregar, claveDeAgrupacion } from "./agregar.js";
import { consultarEnvios, consultarResultados } from "./consultarResultados.js";
import { loQuePaso, VENTANAS_POR_DEFECTO } from "./loQuePaso.js";
import { medir } from "./medicion.js";

/**
 * EL LAZO DE RESULTADOS CONTRA LA BASE (épica #169, frente 1).
 *
 * Dos cosas se prueban acá y son distintas:
 *
 *   1. **Que el SQL traiga los hechos crudos correctos** — que la respuesta sea
 *      del hilo correcto (con el número propio en la comparación), que la etapa
 *      «de antes» sea la de antes, y que las de después vengan con su fecha y
 *      SIN recortar.
 *   2. **LA PARIDAD que importa acá**: que el agregado sea EXACTAMENTE la suma
 *      de los veredictos puros, fila por fila. No es paridad SQL≡TS como en
 *      `urgencia.paridad.test.db.ts` —acá la regla vive en un solo idioma a
 *      propósito— sino el candado contra que alguien «optimice» el conteo
 *      metiéndolo en un `GROUP BY` y cree la segunda implementación que #37
 *      enseñó a no crear.
 */

const NUM = "51999999999";
const hace = (h: number) => new Date(Date.now() - h * 60 * 60 * 1000);
const claveDe = (tel: string) => `conv:whatsapp:${tel}:${NUM}`;

/** Una fuente de ventas apagada: es el estado real hasta que el PR #165 esté. */
const SIN_ATRIBUCION = {
  async hayAtribucion() {
    return false;
  },
  async ventasPorClave() {
    return new Map<string, Date[]>();
  },
};

async function envios(db: DbDePrueba, desde = hace(72)) {
  return consultarEnvios(db, { desde, fuenteDeVentas: SIN_ATRIBUCION });
}

describe("los hechos crudos que trae el SQL", () => {
  test("un envío contestado a la hora: trae el entrante posterior, no el anterior", async (t) => {
    const db = await baseDePrueba(t);
    const tel = "51900000001";
    // Escribió ANTES (así llegó a la cola), le mandamos, y contestó DESPUÉS.
    await sembrarMensaje(db, { personaId: tel, occurredAt: hace(6) });
    await sembrarEnvioWa(db, { telefono: tel, creadoAt: hace(5) });
    await sembrarMensaje(db, { personaId: tel, occurredAt: hace(4) });

    const [h] = await envios(db);
    assert.ok(h.primerEntranteEn, "hubo respuesta");
    assert.ok(h.primerEntranteEn! > h.salioEn, "y es POSTERIOR al envío");
    assert.equal(loQuePaso(h).huboRespuesta, true);
    assert.ok(Math.abs(loQuePaso(h).minutosHastaLaRespuesta! - 60) < 2);
  });

  test("un saliente nuestro NO es una respuesta de la persona", async (t) => {
    const db = await baseDePrueba(t);
    const tel = "51900000002";
    await sembrarEnvioWa(db, { telefono: tel, creadoAt: hace(5) });
    await sembrarMensaje(db, { personaId: tel, direccion: "saliente", occurredAt: hace(4) });

    const [h] = await envios(db);
    assert.equal(h.primerEntranteEn, null, "hablarle otra vez no es que haya contestado");
    assert.equal(loQuePaso(h).huboRespuesta, false);
  });

  test("EL NÚMERO PROPIO ENTRA EN LA COMPARACIÓN: la respuesta al otro hilo no cuenta", async (t) => {
    const db = await baseDePrueba(t);
    const tel = "51900000003";
    // La misma persona nos escribe a DOS números nuestros. Sin esta guarda, el
    // envío desde un número se llevaría la respuesta que ella le dio al otro.
    await sembrarEnvioWa(db, { telefono: tel, numeroPropio: NUM, creadoAt: hace(5) });
    await sembrarMensaje(db, {
      personaId: tel,
      numeroPropio: "51988888888",
      occurredAt: hace(4),
    });

    const [h] = await envios(db);
    assert.equal(h.primerEntranteEn, null);
  });

  test("la etapa de ANTES es la última asentada antes del envío, y las de después vienen con su fecha", async (t) => {
    const db = await baseDePrueba(t);
    const tel = "51900000004";
    await sembrarGestion(db, { clave: claveDe(tel), etapa: "interesado", creadoAt: hace(8) });
    await sembrarGestion(db, { clave: claveDe(tel), etapa: "contactado", creadoAt: hace(6) });
    await sembrarEnvioWa(db, { telefono: tel, creadoAt: hace(5) });
    await sembrarGestion(db, { clave: claveDe(tel), etapa: "cotizado", creadoAt: hace(4) });

    const [h] = await envios(db);
    assert.equal(h.etapaAntes, "contactado", "la última de antes, no la primera");
    assert.equal(h.etapasDespues.length, 1);
    assert.equal(h.etapasDespues[0].etapa, "cotizado");
    assert.ok(h.etapasDespues[0].cuando instanceof Date, "con su fecha: la ventana la aplica el TS");
    assert.equal(loQuePaso(h).huboAvanceDeEtapa, true);
  });

  test("un envío FALLIDO no entra: no tiene resultado que medir", async (t) => {
    const db = await baseDePrueba(t);
    await sembrarEnvioWa(db, { telefono: "51900000005", estado: "fallido", creadoAt: hace(5) });
    assert.equal((await envios(db)).length, 0);
  });

  test("la procedencia vuelve entera desde las cinco columnas", async (t) => {
    const db = await baseDePrueba(t);
    const pieza = deUnPasoDePlantilla({
      plantillaId: 12,
      orden: 3,
      via: "panel-sugerencia",
      contenido: { texto: "hola {nombre}, el diploma cuesta {precio}" },
      momento: "cotizada",
    });
    await sembrarEnvioWa(db, { telefono: "51900000006", creadoAt: hace(5), procedencia: pieza });

    const [h] = await envios(db);
    assert.deepEqual(h.procedencia, pieza);
  });

  test("un envío sin pieza vuelve como la LÍNEA DE BASE, no como un hueco", async (t) => {
    const db = await baseDePrueba(t);
    await sembrarEnvioWa(db, { telefono: "51900000007", creadoAt: hace(5) });

    const [h] = await envios(db);
    assert.deepEqual(h.procedencia, A_MANO);
  });

  test("se mide desde que SALIÓ, no desde que se anotó el intento", async (t) => {
    const db = await baseDePrueba(t);
    const tel = "51900000008";
    await sembrarEnvioWa(db, { telefono: tel, creadoAt: hace(6), resueltoAt: hace(5) });
    const [h] = await envios(db);
    assert.ok(Math.abs(h.salioEn.getTime() - hace(5).getTime()) < 2000);
  });
});

describe("«¿compró?» — el seam, y su degradación honesta", () => {
  test("sin atribución conectada, la respuesta es «no lo sabemos», nunca «no»", async (t) => {
    const db = await baseDePrueba(t);
    await sembrarEnvioWa(db, { telefono: "51900000010", creadoAt: hace(5) });

    const r = await consultarResultados(db, { desde: hace(72), fuenteDeVentas: SIN_ATRIBUCION });
    assert.equal(r.seSabeDeVentas, false);
    assert.equal(r.filas[0].ventasDespues, null, "en blanco, no en cero");
  });

  test("`conversiones_wa` vacía en la base real = sin atribución (el estado de hoy)", async (t) => {
    // Sin inyectar nada: la fuente viva mira `conversiones_wa`, que hoy tiene 0
    // filas mientras Cerberus registra ~6.800 ventas. Decir «esta pieza cerró 0»
    // sería cierto sobre nuestra tabla y falso sobre el negocio.
    const db = await baseDePrueba(t);
    await sembrarEnvioWa(db, { telefono: "51900000011", creadoAt: hace(5) });

    const r = await consultarResultados(db, { desde: hace(72) });
    assert.equal(r.seSabeDeVentas, false);
  });

  test("con la atribución poblada, la venta posterior cuenta y la anterior no", async (t) => {
    const db = await baseDePrueba(t);
    const conVenta = "51900000012";
    const yaCompro = "51900000013";
    await sembrarEnvioWa(db, { telefono: conVenta, creadoAt: hace(5) });
    await sembrarConversionWa(db, { telefono: conVenta, iniciadaAt: hace(2) });
    await sembrarEnvioWa(db, { telefono: yaCompro, creadoAt: hace(5) });
    await sembrarConversionWa(db, { telefono: yaCompro, iniciadaAt: hace(10) });

    const hechos = await consultarEnvios(db, { desde: hace(72) });
    const porClave = new Map(hechos.map((h) => [h.clave, h]));

    assert.equal(porClave.get(claveDe(conVenta))!.seSabeDeVentas, true);
    assert.ok(porClave.get(claveDe(conVenta))!.ventaEn, "la venta posterior se ve");
    assert.equal(
      porClave.get(claveDe(yaCompro))!.ventaEn,
      null,
      "una venta ANTERIOR al envío no la causó este mensaje",
    );
  });
});

describe("PARIDAD: el agregado es la suma de los veredictos puros", () => {
  test("fila por fila, los conteos coinciden con aplicar `loQuePaso` a mano", async (t) => {
    const db = await baseDePrueba(t);
    const contenidoCuotas = { texto: "Se puede pagar en 2 cuotas." };
    const cuotas = deUnDato({ clave: "cuotas", editada: false, contenido: contenidoCuotas });
    const cuotasEditado = deUnDato({ clave: "cuotas", editada: true, contenido: contenidoCuotas });
    const paso = deUnPasoDePlantilla({
      plantillaId: 12,
      orden: 1,
      via: "panel-sugerencia",
      contenido: { texto: "hola {nombre}" },
    });

    // Un conjunto que toca todas las ramas: con y sin respuesta, con avance de
    // etapa, con pérdida declarada, editado, y la línea de base.
    const casos: { tel: string; procedencia?: typeof cuotas; contesta?: number; etapa?: string }[] = [
      { tel: "51900001001", procedencia: cuotas, contesta: 4 },
      { tel: "51900001002", procedencia: cuotas },
      { tel: "51900001003", procedencia: cuotas, contesta: 4, etapa: "cotizado" },
      { tel: "51900001004", procedencia: cuotasEditado, contesta: 4 },
      { tel: "51900001005", procedencia: paso, etapa: "perdido" },
      { tel: "51900001006", procedencia: paso, contesta: 2 },
      { tel: "51900001007", contesta: 3 },
      { tel: "51900001008" },
    ];

    for (const c of casos) {
      await sembrarMensaje(db, { personaId: c.tel, occurredAt: hace(6) });
      await sembrarEnvioWa(db, { telefono: c.tel, creadoAt: hace(5), procedencia: c.procedencia });
      if (c.contesta) await sembrarMensaje(db, { personaId: c.tel, occurredAt: hace(c.contesta) });
      if (c.etapa) await sembrarGestion(db, { clave: claveDe(c.tel), etapa: c.etapa, creadoAt: hace(4) });
    }

    const hechos = await consultarEnvios(db, { desde: hace(72), fuenteDeVentas: SIN_ATRIBUCION });
    assert.equal(hechos.length, casos.length, "entraron todos los envíos sembrados");

    const r = agregar(hechos, VENTANAS_POR_DEFECTO);

    // La cuenta a mano, sin tocar `agregar`: si algún día el conteo se muda a
    // un GROUP BY, este bloque es lo que va a fallar.
    const aMano = new Map<string, { n: number; resp: number; avanzo: number; perd: number }>();
    for (const h of hechos) {
      const clave = claveDeAgrupacion(h.procedencia);
      const v = loQuePaso(h, VENTANAS_POR_DEFECTO);
      const acc = aMano.get(clave) ?? { n: 0, resp: 0, avanzo: 0, perd: 0 };
      acc.n++;
      if (v.huboRespuesta) acc.resp++;
      if (v.huboAvanceDeEtapa) acc.avanzo++;
      if (v.seDeclaroPerdida) acc.perd++;
      aMano.set(clave, acc);
    }

    assert.equal(r.filas.length, aMano.size);
    for (const fila of r.filas) {
      const esperado = aMano.get(fila.clave)!;
      assert.deepEqual(
        {
          envios: fila.envios,
          respondieron: fila.respondieron,
          avanzaronDeEtapa: fila.avanzaronDeEtapa,
          seDeclararonPerdidas: fila.seDeclararonPerdidas,
        },
        {
          envios: esperado.n,
          respondieron: medir("respondio_despues_de", esperado.resp, esperado.n),
          avanzaronDeEtapa: medir("avanzo_de_etapa_despues_de", esperado.avanzo, esperado.n),
          seDeclararonPerdidas: medir("se_declaro_perdida_despues_de", esperado.perd, esperado.n),
        },
        `la fila ${fila.clave} no coincide con la suma de los veredictos puros`,
      );
    }

    // Y las tres filas esperadas están, con la línea de base primera.
    assert.equal(r.filas[0].clave, "a-mano");
    assert.deepEqual(
      r.filas.map((f) => f.pieza).sort(),
      ["a-mano", "dato:cuotas", "paso:12#1"],
    );
    // Los editados NO se pierden en el agrupado: son la MISMA pieza y la MISMA
    // versión (el texto del catálogo no cambió), contados aparte.
    assert.equal(r.filas.find((f) => f.pieza === "dato:cuotas")!.envios, 4);
    assert.equal(r.filas.find((f) => f.pieza === "dato:cuotas")!.editados, 1);
  });
});
