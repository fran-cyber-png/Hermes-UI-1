import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  ORDEN,
  ROLES,
  alcanzaRol,
  clavePersona,
  esRol,
  puedeAdministrar,
  puedeSupervisar,
  type Rol,
} from "./roles.js";

describe("los roles son una ESCALERA, no tres cajones", () => {
  test("todo lo que puede una vendedora lo puede un supervisor, y todo lo suyo un admin", () => {
    // La propiedad, no los tres casos: si mañana entra un rol al medio, esto
    // sigue siendo lo que hay que probar.
    for (const minimo of ROLES) {
      for (const rol of ROLES) {
        assert.equal(
          alcanzaRol(rol, minimo),
          ORDEN[rol] >= ORDEN[minimo],
          `${rol} vs ${minimo}: la escalera no puede tener agujeros`,
        );
      }
    }
  });

  test("un admin responde que sí a `puedeSupervisar` aunque NO sea supervisor", () => {
    // El nombre no dice `esSupervisor` justamente por esto: la pregunta es
    // «¿alcanza?», no «¿cuál es?». Con tres conjuntos independientes, el admin
    // se quedaría afuera del padrón y de «El negocio» sin que nadie lo pida.
    assert.equal(puedeSupervisar("admin"), true);
    assert.equal(puedeSupervisar("supervisor"), true);
    assert.equal(puedeSupervisar("vendedora"), false);
  });

  test("administrar es SOLO del admin", () => {
    assert.equal(puedeAdministrar("admin"), true);
    assert.equal(puedeAdministrar("supervisor"), false);
    assert.equal(puedeAdministrar("vendedora"), false);
  });
});

describe("`esRol` — lo que viene de la base es `text`", () => {
  test("reconoce los tres y nada más", () => {
    for (const r of ROLES) assert.equal(esRol(r), true);
    assert.equal(esRol("dueño"), false);
    assert.equal(esRol("Admin"), false, "la base guarda minúsculas: `Admin` no es un rol");
    assert.equal(esRol(undefined), false);
    assert.equal(esRol(null), false);
    assert.equal(esRol(2), false);
  });
});

describe("`clavePersona` — la receta canónica, una sola", () => {
  test("las tres grafías partidas de producción colapsan a una", () => {
    // 🔴 Medido: `luz`/`Luz`, `usuario1`/`Usuario1`, `usuario2`/`Usuario2` son
    // el MISMO humano cada par. Comparar exacto no da error: da que la persona
    // no ve sus propias filas.
    assert.equal(clavePersona("Luz"), clavePersona("luz"));
    assert.equal(clavePersona("Usuario1"), clavePersona("usuario1"));
    assert.equal(clavePersona("  Usuario2 "), clavePersona("usuario2"));
  });

  test("recorta y baja: es exactamente `lower(btrim(...))`, como el CHECK de la base", () => {
    assert.equal(clavePersona("  Ventas10@GRUPOGOBERNA.com  "), "ventas10@grupogoberna.com");
    assert.equal(clavePersona(""), "");
    assert.equal(clavePersona("   "), "");
  });

  test("es idempotente — aplicarla dos veces no cambia nada", () => {
    for (const crudo of ["Luz", " ALAN ", "ventas10@grupogoberna.com", ""]) {
      assert.equal(clavePersona(clavePersona(crudo)), clavePersona(crudo));
    }
  });
});

describe("agregar un rol obliga a decirle dónde va", () => {
  test("`ORDEN` cubre los tres y ROLES está ordenado de menos a más", () => {
    const roles: readonly Rol[] = ROLES;
    assert.equal(Object.keys(ORDEN).length, roles.length);
    for (let i = 1; i < roles.length; i++) {
      assert.ok(ORDEN[roles[i]!] > ORDEN[roles[i - 1]!], "ROLES va de menos a más poder");
    }
  });
});
