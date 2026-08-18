import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { nombreCortoDeVendedora } from "./nombreVendedora.js";

/**
 * Lo que este módulo tiene que decir sobre los ids que EXISTEN en producción, no
 * sobre los que se pueden imaginar. Los nueve del equipo son de tres formas
 * distintas —una palabra (`luz`), una palabra con mayúscula (`Sindy`) y un correo
 * entero (`ventas10@grupogoberna.com`)— y las tres terminan en el `From` de un
 * correo que lee alguien de afuera.
 */

describe("el nombre corto que va en el From", () => {
  test("los ids reales del equipo", () => {
    assert.equal(nombreCortoDeVendedora("luz"), "Luz");
    assert.equal(nombreCortoDeVendedora("Luz"), "Luz");
    assert.equal(nombreCortoDeVendedora("Sindy"), "Sindy");
    assert.equal(nombreCortoDeVendedora("alan"), "Alan");
    assert.equal(nombreCortoDeVendedora("Usuario1"), "Usuario1");
    assert.equal(nombreCortoDeVendedora("Tracy"), "Tracy");
  });

  test("🔴 un vendedora_id que es un correo NO sale entero en el display name", () => {
    // Es el caso que da sentido al módulo: tres de las nueve tienen su id en
    // `grupogoberna.com`, y sin esto el lead leería
    // «ventas10@grupogoberna.com · Escuela Goberna <escuela@goberna.us>» — dos
    // direcciones en el mismo renglón, que se lee como un correo mal armado.
    assert.equal(nombreCortoDeVendedora("ventas10@grupogoberna.com"), "Ventas10");
    assert.equal(nombreCortoDeVendedora("ventas14@grupogoberna.com"), "Ventas14");
  });

  test("corta en el primer separador, sea cual sea", () => {
    assert.equal(nombreCortoDeVendedora("sindy.rojas"), "Sindy");
    assert.equal(nombreCortoDeVendedora("ana-maria"), "Ana");
    assert.equal(nombreCortoDeVendedora("juan_perez"), "Juan");
    assert.equal(nombreCortoDeVendedora("maria jose"), "Maria");
  });

  test("no inventa un nombre propio: un username sin forma de nombre sale tal cual", () => {
    // Feo y cierto le gana a lindo y adivinado: esto lo ve una persona de afuera
    // en el remitente de un correo.
    assert.equal(nombreCortoDeVendedora("srojas"), "Srojas");
  });

  test("⚠️ un id con prefijo de sistema queda entero — no es una persona", () => {
    // Los dos puntos NO son separador: partido diría «Centurion», que se lee como
    // el nombre de alguien.
    assert.equal(nombreCortoDeVendedora("centurion:algo"), "Centurion:algo");
  });

  test("los bordes se recortan antes de cortar", () => {
    assert.equal(nombreCortoDeVendedora("  luz  "), "Luz");
    assert.equal(nombreCortoDeVendedora("\tSindy\n"), "Sindy");
  });

  test("⚠️ un id vacío devuelve la cadena vacía, nunca un placeholder", () => {
    // `armarSobre` cuenta con esto: filtra las mitades vacías y, si no queda
    // ninguna, manda la dirección sola. Un «(sin nombre)» acá se leería como un
    // error del sistema en el renglón que el lead mira primero.
    assert.equal(nombreCortoDeVendedora(""), "");
    assert.equal(nombreCortoDeVendedora("   "), "");
  });

  test("⚠️ un id que ARRANCA con un separador vuelve crudo, no vacío", () => {
    // Es el mismo comportamiento del front y hay que dejarlo escrito: cortar
    // devolvería la cadena vacía, o sea un remitente sin nombre, sobre un id que
    // sí tiene letras. Feo y completo le gana a limpio y perdido.
    assert.equal(nombreCortoDeVendedora("@goberna.us"), "@goberna.us");
    assert.equal(nombreCortoDeVendedora("_luz"), "_luz");
  });
});
