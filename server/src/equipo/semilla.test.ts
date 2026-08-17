import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { EQUIPO_SEMILLA, esCadenaDeServicio, revisarSemilla } from "./semilla.js";
import { clavePersona } from "./roles.js";
import { ENV_SUPERVISORES } from "../padron/supervisor.js";

const env = (v: Record<string, string | undefined> = {}) => v as NodeJS.ProcessEnv;

describe("la semilla", () => {
  test("todos los ids ya vienen canónicos: la base los rechazaría si no", () => {
    // El CHECK `equipo_id_canonico_ck` es de la base. Una semilla con `Luz`
    // adentro no fallaría al compilar: fallaría en el arranque de producción.
    for (const p of EQUIPO_SEMILLA) {
      assert.equal(p.personaId, clavePersona(p.personaId), `«${p.personaId}» no está canónico`);
    }
  });

  test("no hay ids repetidos — dos filas con la misma PK revientan el INSERT entero", () => {
    const vistos = new Set(EQUIPO_SEMILLA.map((p) => p.personaId));
    assert.equal(vistos.size, EQUIPO_SEMILLA.length);
  });

  test("cada grafía declarada colapsa a su persona", () => {
    // Una grafía que no normaliza a su `persona_id` es un diccionario que miente:
    // diría que `Ana` es `luz`.
    for (const p of EQUIPO_SEMILLA) {
      for (const g of p.grafias) {
        assert.equal(clavePersona(g), p.personaId, `la grafía «${g}» no es de «${p.personaId}»`);
      }
    }
  });

  test("son DOS los admin (D6), y ninguna cadena de servicio se coló", () => {
    const admins = EQUIPO_SEMILLA.filter((p) => p.rol === "admin").map((p) => p.personaId).sort();
    assert.deepEqual(admins, ["alan", "usuario1"]);
    for (const p of EQUIPO_SEMILLA) {
      assert.equal(esCadenaDeServicio(p.personaId), false, `«${p.personaId}» es una cadena, no una persona`);
    }
  });

  test("`ventas10@` NO está: su rol es la pregunta P3, sin decidir", () => {
    // Sin fila, la cascada cae al CSV y esa cuenta conserva exactamente lo que
    // tiene hoy. Con una fila `vendedora` le sacaríamos el padrón y las campañas
    // sin que nadie lo pidiera.
    assert.equal(
      EQUIPO_SEMILLA.some((p) => p.personaId === "ventas10@grupogoberna.com"),
      false,
    );
  });

  test("`tracy` SÍ está: es la que una lista escrita de memoria dejaba afuera", () => {
    assert.ok(EQUIPO_SEMILLA.some((p) => p.personaId === "tracy"));
  });
});

describe("las cadenas de servicio no son personas", () => {
  test("las tres medidas, con cualquier grafía", () => {
    for (const c of ["campana", "goberna-admin", "bot", "Campana", " BOT "]) {
      assert.equal(esCadenaDeServicio(c), true, `«${c}» no es un humano`);
    }
  });

  test("`centurion:` se excluye por PREFIJO, no por nombre", () => {
    // Cada candidatura genera su propia cadena; una lista de nombres las deja
    // entrar a todas menos la que alguien se acordó de escribir.
    assert.equal(esCadenaDeServicio("centurion:gavilano"), true);
    assert.equal(esCadenaDeServicio("centurion:cualquier-cosa-nueva"), true);
    assert.equal(esCadenaDeServicio("centurionista"), false, "el prefijo es `centurion:`, con dos puntos");
  });

  test("una persona de verdad no cae en el filtro", () => {
    for (const p of ["luz", "alan", "ventas10@grupogoberna.com"]) {
      assert.equal(esCadenaDeServicio(p), false);
    }
  });
});

describe("🔴 la siembra no le puede sacar poder a nadie en silencio", () => {
  test("a quien el `.env` hace supervisor y la semilla haría vendedora, NO se lo siembra", () => {
    // Una fila activa le gana al CSV (tiene que ganar: si no, dar de baja sería
    // decorativo). Sembrar a `luz` como vendedora mientras está en el CSV le
    // sacaría el padrón en el próximo restart, sin un error y sin un log.
    const r = revisarSemilla(EQUIPO_SEMILLA, env({ [ENV_SUPERVISORES]: "Luz" }));
    assert.deepEqual(r.degradarian, ["luz"]);
    assert.equal(
      r.aSembrar.some((p) => p.personaId === "luz"),
      false,
    );
    assert.equal(r.aSembrar.length, EQUIPO_SEMILLA.length - 1);
  });

  test("a un admin de la semilla que está en el CSV sí se lo siembra: gana poder, no lo pierde", () => {
    const r = revisarSemilla(EQUIPO_SEMILLA, env({ [ENV_SUPERVISORES]: "alan" }));
    assert.deepEqual(r.degradarian, []);
    assert.equal(r.aSembrar.length, EQUIPO_SEMILLA.length);
  });

  test("sin CSV se siembra todo", () => {
    const r = revisarSemilla(EQUIPO_SEMILLA, env());
    assert.deepEqual(r.degradarian, []);
    assert.equal(r.aSembrar.length, EQUIPO_SEMILLA.length);
  });

  test("compara normalizando los dos lados", () => {
    const r = revisarSemilla(EQUIPO_SEMILLA, env({ [ENV_SUPERVISORES]: " USUARIO2 " }));
    assert.deepEqual(r.degradarian, ["usuario2"]);
  });
});
