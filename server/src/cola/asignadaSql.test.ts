import { test } from "node:test";
import assert from "node:assert/strict";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { fronteraDeAsignacionSql } from "./asignadaSql.js";

/**
 * LA MITAD QUE SE PUEDE FIJAR SIN BASE: **qué ramas tiene el `WHERE`**.
 *
 * Lo que estos tests miran es el SQL generado, no filas. Es a propósito y es la
 * mitad barata: la pregunta «¿la rama de las líneas sin dueña está o no está?»
 * es la decisión entera de este frente, y responderla no necesita sembrar
 * `numero_vendedora` ni levantar Postgres. **El comportamiento —a quién le baja
 * la cola de 2.930 a 51— va en `fronteraDeAsignacion.test.db.ts`**, contra base:
 * un predicado puede tener la rama correcta y estar mal cableado, y eso desde
 * acá no se ve.
 *
 * ⚠️ **Se compara el texto NORMALIZADO de espacios, nunca byte a byte.** El
 * predicado se compone con `sql.join`, así que la sangría no es estable ni
 * significa nada; congelar el texto crudo daría un test que se pone rojo al
 * reindentar un docblock y verde ante un cambio de semántica.
 */
const dialecto = new PgDialect();

/** El SQL como lo va a ver Postgres, con los espacios apretados. */
function texto(fragmento: SQL): string {
  return dialecto.sqlToQuery(fragmento).sql.replace(/\s+/g, " ").trim();
}

function parametros(fragmento: SQL): unknown[] {
  return dialecto.sqlToQuery(fragmento).params;
}

/** El fragmento tal como sale de `RAMA_LINEA_SIN_DUENA`, apretado. */
const RAMA_SIN_DUENA =
  "NOT EXISTS ( SELECT 1 FROM numero_vendedora nv WHERE nv.numero = todo.numero_propio )";

const conFrontera = (conLineaPropia: boolean): SQL => {
  const f = fronteraDeAsignacionSql("walter", false, conLineaPropia);
  assert.ok(f, "la frontera tiene que aplicar: hay identidad y no ve todo");
  return f;
};

test("quien ve todo (supervisor o admin) no se recorta, tenga o no línea propia", () => {
  // 🔴 El orden importa y por eso se prueban las dos combinaciones: `veTodo`
  // gana ANTES que cualquier rama. `usuario1` es ADMIN en producción, así que
  // esta regla no lo va a tocar aunque tenga su línea del QR — acotarlo es
  // cambiarle el rol, que es operación y no código (D4: la frontera es
  // propiedad del rol).
  assert.equal(fronteraDeAsignacionSql("usuario1", true, true), null);
  assert.equal(fronteraDeAsignacionSql("usuario1", true, false), null);
});

test("sin identidad (un servicio) tampoco se recorta", () => {
  assert.equal(fronteraDeAsignacionSql(undefined, false, true), null);
  assert.equal(fronteraDeAsignacionSql("   ", false, true), null);
});

test("SIN línea propia el predicado es el de siempre: las TRES ramas", () => {
  // Es lo que ve la mayoría del equipo (Luz, Sindy y las cinco `ventas1X`). Si
  // este test se pone rojo, el cambio no le tocó a dos personas: le tocó a todas.
  const t = texto(conFrontera(false));
  assert.ok(t.includes("todo.numero_propio IS NULL"), "falta la rama de los leads y comentarios");
  assert.ok(t.includes("lower(btrim(nv.vendedora_id))"), "falta la rama de «esta línea es mía»");
  assert.ok(t.includes(RAMA_SIN_DUENA), "falta la rama de «la línea no tiene dueña»");
});

test("🔴 CON línea propia se cae la rama de «la línea no tiene dueña», y solo esa", () => {
  // Ahí están las 2.879 huérfanas de Walter y las 5.577 de Usuario1 (medido con
  // `frontera:preflight` contra producción, 18-ago-2026): archivo de líneas
  // apagadas que nadie declaró suyo. Quien trajo su propio número no tiene nada
  // que hacer ahí.
  const t = texto(conFrontera(true));
  assert.ok(!t.includes("NOT EXISTS"), "la rama de las líneas sin dueña tenía que caerse");
  assert.ok(t.includes("todo.numero_propio IS NULL"), "los leads de formulario NO se tocan");
  assert.ok(t.includes("lower(btrim(nv.vendedora_id))"), "su propia línea entera se conserva");
});

test("⚠️ los leads de formulario se conservan en los DOS casos — decisión, no olvido", () => {
  // ADR 0051 exime a los leads del reparto a propósito: no entraron por ninguna
  // línea nuestra, así que no pueden tener dueño. Sacarlos de acá le apagaría los
  // ~154 formularios de la ventana a las dos personas del pedido, sin que nadie
  // lo pidiera. Este test existe para que quitarlos cueste discutirlo.
  for (const conLineaPropia of [false, true]) {
    assert.ok(
      texto(conFrontera(conLineaPropia)).includes("todo.numero_propio IS NULL"),
      `los leads se cayeron con conLineaPropia=${conLineaPropia}`,
    );
  }
});

test("lo ASIGNADO a esa persona entra en los dos casos — es la otra mitad del pedido", () => {
  // «de ventas meta solo los que le asignaron a ellos»: eso no es una rama nueva,
  // ya lo trae la primera condición de la frontera, que no mira la línea.
  for (const conLineaPropia of [false, true]) {
    const f = conFrontera(conLineaPropia);
    assert.ok(texto(f).includes("lower(btrim(COALESCE(ca.vendedora_id, cl.vendedora_id)))"));
    assert.ok(parametros(f).includes("walter"));
  }
});

test("🔴 el caso SIN línea propia no cambió: es el de casi todo el equipo", () => {
  // El candado que más importa, y va contra el SQL LITERAL a propósito: este
  // frente es para DOS personas, y las otras nueve no pueden pagar ni un cambio
  // de plan. Si alguien toca las ramas compartidas, esto se pone rojo antes de
  // que nadie note que a Luz le cambió la cola.
  assert.equal(
    texto(conFrontera(false)),
    "( lower(btrim(COALESCE(ca.vendedora_id, cl.vendedora_id))) = $1 " +
      "OR (COALESCE(ca.vendedora_id, cl.vendedora_id) IS NULL AND " +
      "(todo.numero_propio IS NULL " +
      "OR EXISTS ( SELECT 1 FROM numero_vendedora nv WHERE nv.numero = todo.numero_propio " +
      "AND lower(btrim(nv.vendedora_id)) = $2 ) " +
      "OR NOT EXISTS ( SELECT 1 FROM numero_vendedora nv WHERE nv.numero = todo.numero_propio ))) )",
  );
});

test("🔴 con línea propia cambian DOS cosas, y la segunda es la que casi se olvida", () => {
  // 🔴 Este test reemplaza a uno que afirmaba «la diferencia es EXACTAMENTE una
  // rama». **Era cierto y estaba incompleto**, y el hueco que dejaba es el que
  // un crítico encontró leyendo el SQL en vez del enunciado: con sólo quitar la
  // rama de «línea sin dueña», la rama de «la línea es mía» seguía diciendo
  // *cualquiera de mis líneas*. O sea que agregar a Walter al mapa de Ventas
  // Meta —el gesto natural para darle trabajo ahí— le entregaba esa línea
  // ENTERA, lo huérfano incluido: lo contrario del pedido.
  const con = texto(conFrontera(true));

  // 1. Se cae la rama de «la línea no tiene dueña» (el archivo de las retiradas).
  assert.ok(!con.includes(RAMA_SIN_DUENA), "la rama de las huérfanas sigue ahí");

  // 2. Y «la línea es mía» se acota a las PROPIAS: propósito declarado y una
  //    sola persona en el mapa. Las dos condiciones, o Ventas Meta se cuela.
  assert.ok(con.includes("FROM numeros_wa n"), "no mira el propósito de la línea");
  assert.ok(
    con.includes("count(DISTINCT lower(btrim(nv2.vendedora_id)))"),
    "no cuenta cuántas personas comparten la línea",
  );
  assert.ok(
    !con.includes("FROM numero_vendedora nv WHERE nv.numero = todo.numero_propio"),
    "quedó la rama ANCHA de «cualquiera de mis líneas»: Ventas Meta se cuela entera",
  );
});

test("🔴 el conteo de personas va DISTINCT y en minúsculas, como su gemelo", () => {
  // `numero_vendedora` tiene PK `(numero, vendedora_id)`, así que `Walter` y
  // `walter` son dos filas del mismo humano. Con un `count(*)` crudo su propia
  // línea contaría 2, dejaría de ser propia, y **la regla se apagaría sola**.
  // La consulta que alimenta al módulo puro (`numeros/repositorio.ts`) cuenta
  // igual: si una mitad dice «es propia» y la otra no, el booleano apaga la rama
  // que la otra ya acotó.
  const con = texto(conFrontera(true));
  assert.ok(con.includes("count(DISTINCT lower(btrim("));
  assert.ok(!/count\(\*\)/.test(con), "un conteo crudo cuenta dos veces al mismo humano");
});

test("⚠️ la identidad se normaliza de los DOS lados, también acá", () => {
  // En producción el mismo humano tiene dos grafías vivas (`Luz`/`luz`,
  // `Usuario1`/`usuario1`). El lado de la base ya va con `lower(btrim(...))`;
  // este test cuida el lado del parámetro, que es el que se puede olvidar.
  // ⚠️ Con línea propia hay un parámetro MÁS —el propósito—, y va en el medio:
  // por eso se afirma la lista entera y no sólo que la identidad esté.
  assert.deepEqual(parametros(fronteraDeAsignacionSql("  Usuario1  ", false, false)!), [
    "usuario1",
    "usuario1",
  ]);
  assert.deepEqual(parametros(fronteraDeAsignacionSql("  Usuario1  ", false, true)!), [
    "usuario1",
    "vendedora",
    "usuario1",
  ]);
});
