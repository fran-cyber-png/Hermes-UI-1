import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { EVENTOS_DE_LINK, MOTIVOS_DE_CORTE } from "./auditoriaLink.js";

/**
 * EL CANDADO ENTRE LOS DOS VOCABULARIOS DEL REGISTRO DE LINKS.
 *
 * `src/features/notas/auditoria.ts` copia a mano `EVENTOS_DE_LINK` y
 * `MOTIVOS_DE_CORTE`, porque el registro tiene que poder pintarse sin pedirle al
 * server cuatro strings estáticos. Mientras esa copia exista, este test es lo
 * único que la mantiene honesta — el mismo mecanismo que cruza los eventos de
 * contacto (`eventos/paridad.test.ts`) y por el mismo motivo.
 *
 * 🔴 **El caso que atrapa no rompe nada visible.** Si acá se agrega un evento
 * —digamos `vencido`— y el front no se entera, el registro lo dibuja igual (cae en
 * la rama genérica de `fraseDeEvento`, que existe para eso) pero **el desplegable
 * «Filtrar por acción» no lo ofrece**: quedan filas que no se pueden filtrar y una
 * lista que dice menos de lo que muestra. En una superficie de auditoría eso es
 * exactamente lo que no se puede tener.
 *
 * Se parsea el texto en vez de importar porque el server no compila el árbol del
 * front (otro tsconfig, otro build) — la técnica de `catalogo/vocabulario.test.ts`.
 */

const RUTA_FRONT = fileURLToPath(new URL("../../../src/features/notas/auditoria.ts", import.meta.url));
const RUTA_PANTALLA = fileURLToPath(new URL("../../../src/features/notas/AuditoriaDeLink.tsx", import.meta.url));

function listaDelFront(nombre: string, fuente: string): string[] {
  const bloque = new RegExp(`export const ${nombre} = \\[([\\s\\S]*?)\\] as const;`).exec(fuente);
  assert.ok(bloque, `no encontré ${nombre} en ${RUTA_FRONT}`);
  return [...(bloque[1] as string).matchAll(/'([a-z_]+)'/g)].map((m) => m[1] as string);
}

test("los eventos del registro dicen lo mismo en el server y en el front", () => {
  const front = listaDelFront("EVENTOS_DE_LINK", readFileSync(RUTA_FRONT, "utf8"));
  assert.deepEqual(front, [...EVENTOS_DE_LINK]);
});

test("los motivos de corte dicen lo mismo en los dos lados", () => {
  const front = listaDelFront("MOTIVOS_DE_CORTE", readFileSync(RUTA_FRONT, "utf8"));
  assert.deepEqual(front, [...MOTIVOS_DE_CORTE]);
});

test("🔴 el desplegable «Filtrar por acción» ofrece TODOS los eventos que el server puede devolver", () => {
  // Lo que fija es la RELACIÓN, no el texto: todo evento que el registro puede
  // traer se tiene que poder filtrar. Un evento nuevo sin su `<option>` deja filas
  // imposibles de aislar, y no se ve como un error — se ve como que no hay nada.
  const pantalla = readFileSync(RUTA_PANTALLA, "utf8");
  for (const evento of EVENTOS_DE_LINK) {
    assert.ok(
      pantalla.includes(`<option value="${evento}">`),
      `«${evento}» no se puede elegir en el filtro por acción de AuditoriaDeLink.tsx`,
    );
  }
});

test("🔴 el front NO puede pintar una cifra llamada «personas» a secas", () => {
  // La regla central de este frente: un link público se abre sin identidad, así
  // que «cuánta gente entró» no tiene respuesta. Las tres cifras van separadas y
  // rotuladas por lo que cada una cuenta de verdad. Este test se pone rojo si
  // alguien las colapsa en un total que suena mejor y no se puede sostener.
  const pantalla = readFileSync(RUTA_PANTALLA, "utf8");
  assert.ok(pantalla.includes("personas de Goberna"), "la cifra identificada tiene que decir de quiénes es");
  assert.ok(pantalla.includes("aperturas sin cuenta"), "lo anónimo se cuenta como APERTURAS, nunca como personas");
  assert.ok(
    !/>\s*personas\s*</.test(pantalla),
    "un rótulo «personas» a secas afirmaría cuánta gente entró, que es justo lo que no se sabe",
  );
});
