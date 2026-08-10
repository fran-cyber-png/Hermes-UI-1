import { describe, it } from "node:test";
import assert from "node:assert";
import { puedeAdministrar, puedeEditar, puedeEscribirEn, puedeVer } from "./visibilidad.js";

/**
 * LA FRONTERA DE LOS ESPACIOS (ADR 0046).
 *
 * Lo que estos tests protegen NO es un bug de dibujo: es una fuga. Cuando una
 * regla de visibilidad se equivoca no tira una excepción — devuelve un 200 con
 * la página de otra persona, o esconde la propia para siempre.
 *
 * Los dos fallos que este archivo existe para atrapar:
 *   · servir de más  → la libreta privada de alguien se ve desde afuera;
 *   · servir de menos → a Luz la agregan a un espacio y nunca lo ve, porque
 *     Cerberus la escribe `Luz` y ella entra como `luz`.
 */

const YO = { vendedoraId: "luz", espacios: [7, 9] };

describe("puedeVer — la libreta privada (espacioId === null)", () => {
  it("la autora ve la suya", () => {
    assert.equal(puedeVer({ vendedoraId: "luz", espacioId: null }, YO), true);
  });

  it("🔴 NADIE MÁS la ve, ni siendo miembro de todos los espacios", () => {
    // El caso que convierte un bug en una fuga: una nota privada no se sirve
    // aunque el que pregunta esté en cuanto espacio exista.
    assert.equal(puedeVer({ vendedoraId: "sindy", espacioId: null }, YO), false);
  });

  it("🔴 LAS DOS GRAFÍAS DEL MISMO HUMANO SON LA MISMA PERSONA", () => {
    // Medido en producción: `numero_vendedora` dice `Luz` y `sesiones_cerberus`
    // dice `luz`. Con comparación exacta, ella no ve sus propias páginas viejas.
    assert.equal(puedeVer({ vendedoraId: "Luz", espacioId: null }, YO), true);
    assert.equal(puedeVer({ vendedoraId: "  LUZ  ", espacioId: null }, YO), true);
  });

  it("una autora vacía no es «cualquiera»: no se ve", () => {
    // `mismaVendedora` rechaza la cadena vacía a propósito. Sin eso, una fila con
    // `vendedora_id = ''` sería visible para todo token, incluido uno vacío.
    assert.equal(puedeVer({ vendedoraId: "", espacioId: null }, { vendedoraId: "", espacios: [] }), false);
  });
});

describe("puedeVer — un espacio", () => {
  it("el miembro ve la página aunque la haya escrito otra", () => {
    // Es el pedido entero: compartir es que la página de Sindy la vea Luz.
    assert.equal(puedeVer({ vendedoraId: "sindy", espacioId: 7 }, YO), true);
  });

  it("quien no es miembro no la ve, aunque la haya escrito", () => {
    // 🔴 El caso contraintuitivo, y el que decide que esto sea una frontera y no
    // un filtro: sacaron a la autora del espacio, y desde entonces no la ve.
    // Si la autoría sobreviviera como llave, sacar a alguien no sacaría nada.
    assert.equal(puedeVer({ vendedoraId: "luz", espacioId: 42 }, YO), false);
  });

  it("un espacio que no existe no se cuela por parecerse a `null`", () => {
    assert.equal(puedeVer({ vendedoraId: "luz", espacioId: 0 }, YO), false);
  });
});

describe("puedeEditar", () => {
  it("REEMPLAZA «solo la autora»: cualquier miembro edita", () => {
    // Decisión del dueño (10-ago). Si editar siguiera siendo de la autora, un
    // espacio del equipo sería una carpeta de solo lectura para todos menos uno.
    assert.equal(puedeEditar({ vendedoraId: "sindy", espacioId: 9 }, YO), true);
  });

  it("sobre una nota privada da LO MISMO que la regla vieja", () => {
    // La garantía de que nadie pierde el candado que ya tenía: en `espacio_id
    // IS NULL`, «miembro del espacio» y «solo la autora» son la misma frase.
    assert.equal(puedeEditar({ vendedoraId: "luz", espacioId: null }, YO), true);
    assert.equal(puedeEditar({ vendedoraId: "sindy", espacioId: null }, YO), false);
  });
});

describe("puedeAdministrar", () => {
  it("solo quien creó el espacio", () => {
    assert.equal(puedeAdministrar({ creadaPor: "luz" }, YO), true);
    assert.equal(puedeAdministrar({ creadaPor: "sindy" }, YO), false);
  });

  it("normaliza las dos grafías, como todo lo demás", () => {
    assert.equal(puedeAdministrar({ creadaPor: "Luz" }, YO), true);
  });

  it("ser miembro NO alcanza para desarmar el lugar", () => {
    // Editar el contenido es de todos; sacar miembros y archivar el espacio, no.
    // Sin esto, cualquier miembro puede sacar a la creadora.
    assert.equal(puedeAdministrar({ creadaPor: "tracy" }, { vendedoraId: "luz" }), false);
  });
});

describe("puedeEscribirEn — la frontera del lado de la ESCRITURA", () => {
  it("mi libreta siempre", () => {
    assert.equal(puedeEscribirEn(null, YO), true);
  });

  it("un espacio del que soy miembro, sí", () => {
    assert.equal(puedeEscribirEn(7, YO), true);
  });

  it("🔴 NO SE PUEDE PLANTAR UNA PÁGINA EN UN ESPACIO AJENO", () => {
    // El agujero que no se ve mirando solo la lectura: el POST lleva `espacioId`
    // en el body, así que sin esta guarda cualquiera escribe adentro del espacio
    // de otro equipo mandando un número.
    assert.equal(puedeEscribirEn(42, YO), false);
  });
});
