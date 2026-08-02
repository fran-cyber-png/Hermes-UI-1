import assert from "node:assert/strict";
import { test, describe } from "node:test";
// De `ordenes.ts` y no de `enviarYProyectar.ts`: ese importa `db/client.ts`, que
// exige `DATABASE_URL` al importarse y no se puede levantar en un test puro.
import { ordenDeMedia, type OrdenMedia } from "./ordenes.js";
import { EnvioControlado, type OrdenEnvio, type RegistroEnvios } from "./envioControlado.js";
import { TransporteFalso } from "./transporteFalso.js";
import { A_MANO, deUnPasoDePlantilla } from "../procedencia/pieza.js";

/**
 * QUE LO QUE LA ORDEN DECLARA LLEGUE A LA AUDITORÍA — las dos ramas, iguales.
 *
 * El defecto que esto fija no rompía tipos y no rompía ningún test: la rama de
 * texto reenviaba la orden con `{...o}` y la de media **enumeraba** los campos,
 * así que `automatico` viajaba por una y no por la otra. El síntoma es del bot:
 * su texto quedaba marcado como automático y el flyer del MISMO turno como
 * escrito por una persona — y entonces `ultimoSalienteHumanoEn` (`bot/frenos.ts`)
 * lee ese flyer como «hay una vendedora atendiendo» y **el bot se calla solo**
 * en esa conversación, justo después de mandarlo.
 */

const DEL_BOT: OrdenMedia = {
  vendedoraId: "bot",
  numeroPropio: "51984429504",
  telefono: "51961506674",
  referencia: "conv:whatsapp:51961506674:51984429504",
  automatico: true,
  archivo: "flyer-julio.jpg",
  media: {
    ruta: "/tmp/flyer-julio.jpg",
    clase: "imagen",
    mime: "image/jpeg",
    nombre: "flyer",
    texto: "Te dejo el flyer",
  },
};

describe("ordenDeMedia — nada de la orden se pierde en el camino", () => {
  test("🔴 `automatico` viaja: era el campo que la enumeración se comía", () => {
    assert.equal(ordenDeMedia(DEL_BOT, A_MANO).automatico, true);
  });

  test("la procedencia es la que se le pasa, no la de la orden", () => {
    const pieza = deUnPasoDePlantilla({
      plantillaId: 12,
      orden: 1,
      via: "bot",
      contenido: { texto: "Te dejo el flyer", archivo: "flyer-julio.jpg" },
    });
    const orden = ordenDeMedia(DEL_BOT, pieza);
    assert.equal(orden.procedencia?.tipo, "pieza");
    assert.equal(orden.procedencia && "via" in orden.procedencia && orden.procedencia.via, "bot");
  });

  test("`archivo` NO viaja: es de la proyección del hilo, no del envío", () => {
    assert.ok(!("archivo" in ordenDeMedia(DEL_BOT, A_MANO)));
  });

  test("los cinco campos de siempre siguen llegando", () => {
    const o = ordenDeMedia(DEL_BOT, A_MANO);
    assert.equal(o.vendedoraId, "bot");
    assert.equal(o.numeroPropio, "51984429504");
    assert.equal(o.telefono, "51961506674");
    assert.equal(o.referencia, "conv:whatsapp:51961506674:51984429504");
    assert.equal(o.media.ruta, "/tmp/flyer-julio.jpg");
  });
});

/** Registro en memoria: lo mismo que usa `envioControlado.test.ts`. */
class RegistroFalso implements RegistroEnvios {
  readonly intentos: OrdenEnvio[] = [];
  private siguiente = 1;
  async registrarIntento(orden: OrdenEnvio): Promise<number> {
    this.intentos.push(orden);
    return this.siguiente++;
  }
  async marcarEnviado(): Promise<void> {}
  async marcarFallido(): Promise<void> {}
}

describe("y la puerta lo escribe en la fila de auditoría", () => {
  test("un adjunto del bot queda auditado como AUTOMÁTICO y con su pieza", async () => {
    const transporte = new TransporteFalso({ telefono: "51984429504" });
    const registro = new RegistroFalso();
    const envio = new EnvioControlado(transporte, registro);

    const pieza = deUnPasoDePlantilla({
      plantillaId: 12,
      orden: 1,
      via: "bot",
      contenido: { texto: "Te dejo el flyer", archivo: "flyer-julio.jpg" },
    });
    const r = await envio.enviarMedia(ordenDeMedia(DEL_BOT, pieza));

    assert.ok(r.ok);
    // Es lo que después termina en `envios_wa.automatico` (registroEnviosDrizzle
    // lee este mismo objeto) y lo que la burbuja del hilo usa para distinguir
    // «Automático» de una vendedora.
    assert.equal(registro.intentos[0]!.automatico, true);
    assert.equal(registro.intentos[0]!.vendedoraId, "bot");
    assert.equal(registro.intentos[0]!.procedencia?.tipo, "pieza");
  });

  test("un adjunto de una vendedora sigue siendo humano (ausente = lo apretó alguien)", async () => {
    const transporte = new TransporteFalso({ telefono: "51987654321" });
    const registro = new RegistroFalso();
    const envio = new EnvioControlado(transporte, registro);

    const { automatico: _sinMarca, ...deAna } = DEL_BOT;
    await envio.enviarMedia(
      ordenDeMedia({ ...deAna, vendedoraId: "ana", numeroPropio: "51987654321" }, A_MANO),
    );

    assert.notEqual(registro.intentos[0]!.automatico, true);
  });
});
