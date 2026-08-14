import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { vendedoraIdDeCenturion } from './centurion.js';

/**
 * EL PREFIJO `centurion:` ESTÁ ESCRITO EN LOS DOS LADOS, Y NO SE PUEDE IMPORTAR
 * DE UNO AL OTRO (son dos builds distintos, como en `ivi/paridad-front.test.ts`).
 *
 * Lo que decide cada lado con ese prefijo:
 *
 *   server ... con qué `vendedora_id` se guarda y se busca la línea asignada
 *   front .... si se le promete —o no— una sesión de Cerberus
 *
 * 🔴 **Si divergen, no hay error ni log**: el front deja de reconocer una
 * identidad de Centurión y vuelve el aviso «reconectá con Cerberus» que ningún
 * botón puede apagar (la identidad no existe en Cerberus, así que `entrar()`
 * nunca deja cookie). El síntoma es un banner permanente, no una excepción.
 *
 * Se lee el front como TEXTO. Si el `const` deja de existir o cambia de forma, el
 * test FALLA en vez de dar por bueno un `undefined` — un parser que no encuentra
 * nada y dice «todo bien» es el falso verde de siempre.
 */

const RUTA_FRONT = fileURLToPath(new URL('../../../src/features/auth/identidad.ts', import.meta.url));

function prefijoDelFront(): string {
  const fuente = readFileSync(RUTA_FRONT, 'utf8');
  const m = fuente.match(/export const PREFIJO_CENTURION = '([^']*)';/);
  assert.ok(m, `no encontré PREFIJO_CENTURION en ${RUTA_FRONT}: ¿cambió de forma?`);
  return m[1];
}

test('🔴 el prefijo de una identidad de Centurión es el MISMO en el server y en el front', () => {
  const delServer = vendedoraIdDeCenturion('betto.romero').replace('betto.romero', '');
  assert.equal(delServer, 'centurion:', 'cambió el namespacing del server: hay filas viejas en `numero_vendedora`');
  assert.equal(prefijoDelFront(), delServer);
});

test('el front reconoce como de Centurión exactamente lo que el server namespacea', () => {
  const id = vendedoraIdDeCenturion('betto.romero');
  assert.ok(id.startsWith(prefijoDelFront()), `el front no reconocería «${id}»`);
});
