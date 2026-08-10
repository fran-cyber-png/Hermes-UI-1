import { describe, it } from "node:test";
import assert from "node:assert";
import { planearMovimiento } from "./mover.js";

/**
 * MOVER UNA PÁGINA DE LUGAR.
 *
 * Lo que estos tests protegen son **dos puertas de atrás distintas**, y por eso
 * mover pregunta por los dos permisos y no por uno:
 *
 *   · sin el permiso de ORIGEN, mover es la puerta de atrás para **leer** lo que
 *     la frontera niega (te llevás a tu libreta una página de un espacio ajeno);
 *   · sin el permiso de DESTINO, mover es la puerta de atrás para **plantar** una
 *     página adentro del espacio de otro equipo.
 *
 * Ninguna de las dos falla ruidosamente si se cae: las dos devuelven un 200.
 */

const MIO = 7;
const AJENO = 42;
const YO = { vendedoraId: "luz", espacios: [MIO] };

describe("planearMovimiento — de mi libreta a un espacio", () => {
  it("mi página propia a un espacio del que soy miembro", () => {
    const r = planearMovimiento({ vendedoraId: "luz", espacioId: null }, MIO, YO);
    assert.equal(r.ok, true);
    assert.equal(r.ok && r.destino, MIO);
    assert.equal(r.ok && r.sacaDelEquipo, false, "compartir no le saca nada a nadie");
  });

  it("🔴 NO a un espacio del que no soy miembro — sería plantar una página ajena", () => {
    const r = planearMovimiento({ vendedoraId: "luz", espacioId: null }, AJENO, YO);
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.motivo, "no-sos-miembro-del-destino");
  });
});

describe("planearMovimiento — traer de vuelta a mi libreta", () => {
  it("se puede, y AVISA que se la saca al equipo", () => {
    const r = planearMovimiento({ vendedoraId: "luz", espacioId: MIO }, null, YO);
    assert.equal(r.ok, true);
    assert.equal(r.ok && r.destino, null);
    assert.equal(r.ok && r.sacaDelEquipo, true, "es el único efecto que nadie espera");
  });

  it("también la que escribió OTRA persona — en un espacio la autoría no es el candado", () => {
    // Se permite a propósito: adentro de un espacio todos editan todo (decisión
    // del dueño), y mover es una edición. El freno es el aviso, no el permiso.
    const r = planearMovimiento({ vendedoraId: "sindy", espacioId: MIO }, null, YO);
    assert.equal(r.ok, true);
    assert.equal(r.ok && r.sacaDelEquipo, true);
  });
});

describe("planearMovimiento — lo que no se puede", () => {
  it("🔴 NO se puede tocar una página de un espacio ajeno, ni para llevársela", () => {
    // La puerta de atrás para LEER: sin esta guarda, adivinar un id y «moverla a
    // mi libreta» sirve la página entera de un equipo del que no sos parte.
    const r = planearMovimiento({ vendedoraId: "caro", espacioId: AJENO }, null, YO);
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.motivo, "no-podes-tocarla");
  });

  it("NO se puede mover la página privada de otra persona", () => {
    const r = planearMovimiento({ vendedoraId: "sindy", espacioId: null }, MIO, YO);
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.motivo, "no-podes-tocarla");
  });

  it("moverla a donde ya está no escribe nada", () => {
    // No es un error que haya que mostrar, pero tampoco puede tocar `editado_at`:
    // la página figuraría «editada» por un clic que no cambió nada.
    const enEspacio = planearMovimiento({ vendedoraId: "luz", espacioId: MIO }, MIO, YO);
    assert.equal(!enEspacio.ok && enEspacio.motivo, "ya-esta-ahi");

    const enLibreta = planearMovimiento({ vendedoraId: "luz", espacioId: null }, null, YO);
    assert.equal(!enLibreta.ok && enLibreta.motivo, "ya-esta-ahi");
  });

  it("las dos grafías del mismo humano se resuelven, como en todo lo demás", () => {
    const r = planearMovimiento({ vendedoraId: "Luz", espacioId: null }, MIO, YO);
    assert.equal(r.ok, true, "Cerberus la escribe «Luz» y ella entra como «luz»");
  });
});
