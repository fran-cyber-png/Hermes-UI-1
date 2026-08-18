import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  ENV_ADMINS,
  SIN_IDENTIDAD,
  adminsConfigurados,
  laFronteraSeAplica,
  resolverRol,
  type LecturaDeEquipo,
} from "./cascada.js";
import { ENV_SUPERVISORES } from "../padron/supervisor.js";

const env = (v: Record<string, string | undefined> = {}) => v as NodeJS.ProcessEnv;

const OK = (fila: LecturaDeEquipo["fila"]): LecturaDeEquipo => ({ estado: "ok", fila });
const SIN_TABLA: LecturaDeEquipo = { estado: "sin_tabla", fila: null };
const FALLO: LecturaDeEquipo = { estado: "fallo", fila: null };

const FILA = (rol: "admin" | "supervisor" | "vendedora", activa = true) => ({
  personaId: "luz",
  nombre: "Luz",
  rol,
  activa,
});

describe("la cascada, rama por rama", () => {
  test("la tabla manda: la fila activa decide el rol", () => {
    const r = resolverRol("Luz", OK(FILA("supervisor")), env());
    assert.equal(r.rol, "supervisor");
    assert.equal(r.fuente, "tabla");
    assert.equal(r.personaId, "luz", "el id viaja canónico, no como se tipeó");
  });

  test("sin fila cae al CSV transitorio, y eso es lo que mantiene vivo el padrón de hoy", () => {
    const r = resolverRol("alan", OK(null), env({ [ENV_SUPERVISORES]: "Alan, ventas10@x.com" }));
    assert.equal(r.rol, "supervisor");
    assert.equal(r.fuente, "env-supervisores");
  });

  test("sin fila y sin CSV: vendedora", () => {
    const r = resolverRol("tracy", OK(null), env());
    assert.equal(r.rol, "vendedora");
    assert.equal(r.fuente, "default");
  });

  test("una fila DADA DE BAJA no cae al CSV — si no, la baja sería decorativa", () => {
    // Sacar a alguien del equipo tiene que sacarle el poder. Si el CSV la
    // resucitara, desactivarla desde el panel no haría nada y nadie lo notaría.
    const r = resolverRol("luz", OK(FILA("supervisor", false)), env({ [ENV_SUPERVISORES]: "luz" }));
    assert.equal(r.rol, "vendedora");
    assert.equal(r.desactivada, true);
    assert.equal(r.fuente, "tabla");
  });
});

describe("el break-glass", () => {
  test("gana sobre la tabla, y lo DICE", () => {
    const r = resolverRol("Alan", OK(FILA("vendedora")), env({ [ENV_ADMINS]: "alan" }));
    assert.equal(r.rol, "admin");
    assert.equal(r.porBreakGlass, true);
  });

  test("🔴 funciona con la base caída — una salida de emergencia no puede depender de la base", () => {
    const r = resolverRol("alan", FALLO, env({ [ENV_ADMINS]: "Alan" }));
    assert.equal(r.rol, "admin", "si el blip apagara el break-glass, no habría cómo entrar a arreglar");
    assert.equal(r.porBreakGlass, true);
  });

  test("normaliza los DOS lados: `Usuario1` en la variable y `usuario1` en el token", () => {
    const r = resolverRol("usuario1", OK(null), env({ [ENV_ADMINS]: " Usuario1 " }));
    assert.equal(r.rol, "admin");
  });

  test("sin la variable, nadie (fail-closed)", () => {
    assert.deepEqual(adminsConfigurados(env()), []);
    assert.deepEqual(adminsConfigurados(env({ [ENV_ADMINS]: " , ,  " })), []);
    assert.equal(resolverRol("alan", OK(null), env({ [ENV_ADMINS]: "" })).rol, "vendedora");
  });
});

describe("🔴 LOS DOS MODOS DE FALLA NO SON EL MISMO", () => {
  // Este bloque es el candado del frente. Colapsarlos —tratar un blip de
  // Postgres como «falta la migración»— apaga la frontera de la cola en cada
  // hipo de la base: con los CSV ya apagados, eso es la cola entera de Luz
  // servida a cualquier token durante unos segundos, sin un solo error visible.

  test("TABLA AUSENTE: cascada al `.env` y la frontera queda APAGADA", () => {
    const r = resolverRol("alan", SIN_TABLA, env({ [ENV_SUPERVISORES]: "alan" }));
    assert.equal(r.rol, "supervisor", "sin tabla, el CSV sigue siendo la fuente");
    assert.equal(r.sinTablaDeEquipo, true);
    assert.equal(r.rolNoResuelto, false);
    assert.equal(laFronteraSeAplica(r), false, "sin tabla, la cola se comporta como antes del frente");
  });

  test("CONSULTA FALLIDA: vendedora, NO se cae al `.env`, y la frontera queda ENCENDIDA", () => {
    const r = resolverRol("alan", FALLO, env({ [ENV_SUPERVISORES]: "alan" }));
    assert.equal(r.rol, "vendedora", "un blip degrada a lo más estricto");
    assert.equal(r.rolNoResuelto, true);
    assert.equal(r.sinTablaDeEquipo, false);
    assert.equal(laFronteraSeAplica(r), true, "un blip NO puede abrir la cola");
  });

  test("las dos banderas nunca viajan juntas, y ninguna implica la otra", () => {
    const lecturas: LecturaDeEquipo[] = [OK(null), OK(FILA("admin")), SIN_TABLA, FALLO];
    for (const l of lecturas) {
      const r = resolverRol("x", l, env());
      assert.ok(
        !(r.sinTablaDeEquipo && r.rolNoResuelto),
        "si las dos se prenden juntas es que alguien las unificó",
      );
    }
    // Y la propiedad que las separa, dicha como una sola línea: la frontera
    // depende de `sinTablaDeEquipo` y NO de `rolNoResuelto`.
    assert.notEqual(
      laFronteraSeAplica(resolverRol("x", SIN_TABLA, env())),
      laFronteraSeAplica(resolverRol("x", FALLO, env())),
    );
  });
});

describe("el default sin identidad", () => {
  test("es fail-closed y dice que no se resolvió", () => {
    assert.equal(SIN_IDENTIDAD.rol, "vendedora");
    assert.equal(SIN_IDENTIDAD.rolNoResuelto, true);
    assert.equal(SIN_IDENTIDAD.sinTablaDeEquipo, false);
    assert.equal(laFronteraSeAplica(SIN_IDENTIDAD), true);
  });
});

describe("bordes del id", () => {
  test("un id vacío no matchea ninguna lista", () => {
    const r = resolverRol("   ", OK(null), env({ [ENV_ADMINS]: "alan", [ENV_SUPERVISORES]: "luz" }));
    assert.equal(r.rol, "vendedora");
    assert.equal(r.personaId, "");
  });
});
