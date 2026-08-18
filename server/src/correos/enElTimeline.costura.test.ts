import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * EL CANDADO DE LA COSTURA: QUE LA RUTA DEL TIMELINE **USE** EL SEAM.
 *
 * ══ POR QUÉ ESTO NO LO CUBRE `enElTimeline.test.db.ts` ══════════════════════
 *
 * 🔴 **El defecto de H7 no vivía en ninguna función: vivía en que nadie la
 * llamaba.** `correos.clave` se escribía correctamente, se guardaba
 * correctamente, y el handler que arma el timeline (`GET /api/eventos?clave=`)
 * simplemente no miraba la tabla. Un test que le pase su `db` a
 * `correosDelTimeline` y lo encuentre impecable **pasa en verde con el frente
 * entero desconectado** — que es exactamente el estado en el que estuvo hasta
 * hoy.
 *
 * Es la lección de `routes/conversaciones.etapa.test.ts`: `?etapa=sin_respuesta`
 * contestaba 400 con los quince tests con base en verde, porque todos llamaban al
 * seam directo y se salteaban la ruta. Y la de ADR 0042: **antes de afirmar que
 * algo anda, mirá el camino completo, no el componente**.
 *
 * ══ POR QUÉ SE LEE EL ARCHIVO Y NO SE LEVANTA LA RUTA ═══════════════════════
 *
 * `routes/eventos.ts` importa el singleton `db`, que se resuelve AL IMPORTARSE
 * (`db/client.ts` lee `DATABASE_URL` en el cuerpo del módulo): probarlo de verdad
 * cuesta el andamio entero de `correos.test.db.ts` —base propia, singleton
 * apuntado antes del import, `app.listen(0)`— y arrastra su flake conocido de
 * `fetch failed`. Lo que hay que impedir es una sola cosa —que alguien saque el
 * brazo «porque no lo usa nadie»— y para eso alcanza con leer el archivo.
 *
 * ⚠️ **Lo que este test NO puede ver**: que la consulta sea la correcta, que la
 * clave se pase bien o que la respuesta salga con la forma esperada. Eso lo fija
 * `enElTimeline.test.db.ts`. Los dos juntos cubren el frente; ninguno solo.
 */

const RUTA = fileURLToPath(new URL('../routes/eventos.ts', import.meta.url));

test('la ruta del timeline consulta los correos de la conversación', () => {
  const fuente = readFileSync(RUTA, 'utf8');

  assert.ok(
    fuente.includes('correosDelTimeline'),
    'GET /api/eventos tiene que consultar `correosDelTimeline`: sin eso, un correo mandado ' +
      'desde la ficha no se ve en ninguna parte y la próxima vendedora le manda el precio de nuevo',
  );
  assert.ok(
    /from\s+["']\.\.\/correos\/enElTimeline\.js["']/.test(fuente),
    'el seam se importa de `correos/enElTimeline.js`, no se reimplementa acá',
  );
});

test('los correos viajan en su PROPIA clave, nunca mezclados con los eventos', () => {
  const fuente = readFileSync(RUTA, 'utf8');

  // 🔴 `eventos_contacto.id` y `correos.id` son dos secuencias independientes: el
  // evento 7 y el correo 7 existen los dos a la vez. El front cuelga Editar y
  // Borrar del id (`panel/timeline.ts` → `EventoLinea.tsx`), así que mezclarlos
  // hace que «borrar» sobre un correo archive el evento manual de otra persona,
  // con un 200 y sin un solo síntoma.
  assert.ok(
    /res\.json\(\{\s*eventos,\s*correos\s*\}\)/.test(fuente),
    'la respuesta lleva `eventos` y `correos` como dos claves: mezclarlos colisiona los ids',
  );
});
