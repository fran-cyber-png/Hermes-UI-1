import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { armarSobre, type Remitente } from './remitente.js';

/**
 * EL CANDADO ENTRE LOS DOS ` · ` DEL DISPLAY NAME.
 *
 * ══ POR QUÉ UN SEPARADOR MERECE UN TEST ═════════════════════════════════════
 *
 * 🔴 **La pantalla DIBUJA el sobre y el server lo MANDA, y son dos cadenas
 * distintas.** El composer de Correos arma «Luz · Escuela Goberna» con
 * `resumenDelSobre` (front) y el correo sale con el `From` de `armarSobre`
 * (server). El día que uno cambie a « — » y el otro no, la vendedora lee un
 * remitente arriba del botón y al lead le llega otro — que es, palabra por
 * palabra, el defecto que este frente vino a corregir: la vista prometía «con tu
 * nombre» y mandaba «Escuela Goberna» para las nueve.
 *
 * Y falla del peor modo posible: **no falla**. No hay 400, no hay log, no hay
 * excepción. Los dos textos son válidos, sólo que uno es mentira.
 *
 * ⚠️ **`nombreVendedora.paridad.test.ts` NO cubre esto.** Ese candado cruza cómo
 * se saca el nombre corto («ventas10@…» → «Ventas10») y la FORMA de `armarSobre`;
 * el pegamento entre las dos mitades le es invisible, porque los dos lados le
 * pasan el mismo nombre y el mismo remitente. Un separador distinto lo deja verde.
 *
 * ⚠️ Se lee el front como TEXTO: son dos builds distintos, y del lado del server
 * la constante es privada a propósito. Mover cualquiera de los dos archivos rompe
 * esto en EJECUCIÓN con los dos typechecks en verde.
 */

const RUTA_SERVER = fileURLToPath(new URL('./remitente.ts', import.meta.url));
const RUTA_FRONT = fileURLToPath(
  new URL('../../../src/features/correos/correos.ts', import.meta.url),
);

/**
 * ⚠️ Si no encuentra la constante **falla**, nunca devuelve `' · '` de default:
 * un extractor que se cae para el lado del «igual» convierte este archivo en
 * decoración, y este repo ya pagó una (`urgencia.paridad.test.db.ts` pasaba en
 * verde sin sembrar el caso que tenía que ver).
 */
function separadorEn(ruta: string): string {
  const fuente = readFileSync(ruta, 'utf8');
  const m = /^\s*(?:export )?const SEPARADOR_NOMBRES\s*=\s*(['"`])([\s\S]*?)\1\s*;/m.exec(fuente);
  assert.ok(m, `no encontré \`const SEPARADOR_NOMBRES\` en ${ruta} — ¿se renombró o se movió?`);
  return m[2] as string;
}

describe('`SEPARADOR_NOMBRES`: el sobre que se dibuja y el que sale', () => {
  test('el front pega las dos mitades del nombre con el mismo separador que el server', () => {
    const delServer = separadorEn(RUTA_SERVER);
    const delFront = separadorEn(RUTA_FRONT);

    assert.equal(
      // Se muestran escapados: entre ` · ` y ` ·  ` la diferencia es un espacio y
      // un `assert.equal` pelado imprimiría dos líneas que se ven idénticas.
      JSON.stringify(delFront),
      JSON.stringify(delServer),
      'la pantalla enseñaría un `From` con un separador y el lead recibiría otro',
    );
  });

  /**
   * 🔴 Lo de arriba cruza las dos CONSTANTES; esto verifica que la del server siga
   * siendo la que termina en la cabecera. Sin este segundo test, `armarSobre`
   * podría dejar de usarla —un `join(' - ')` escrito a mano, un `${a} — ${b}`— y
   * las dos constantes seguirían de acuerdo entre ellas mientras el correo sale
   * con otra cosa.
   */
  test('🔴 y es el que `armarSobre` pone de verdad en el `From`', () => {
    const separador = separadorEn(RUTA_SERVER);
    const remitente: Remitente = {
      id: 1,
      direccion: 'escuela@goberna.us',
      nombre: 'Escuela Goberna',
      responderA: null,
      firma: null,
    };

    const { from } = armarSobre(remitente, 'luz', 'Luz');

    assert.equal(
      from,
      `"Luz${separador}Escuela Goberna" <escuela@goberna.us>`,
      '`armarSobre` dejó de usar `SEPARADOR_NOMBRES` para unir las dos mitades',
    );
  });
});
