import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dominiosVerificados, puedeSerRemitente } from './verificado.js';

/**
 * EL CANDADO ENTRE `puedeSerRemitente` (server) Y `dominioAceptado` (front).
 *
 * ══ ESTAS DOS YA DIVERGIERON, Y EL TEST DEL FRONT FIJABA LA DIVERGENCIA ═════
 *
 * 🔴 El server comparaba el dominio por **igualdad exacta** y el front aceptaba
 * **subdominios**. O sea: la pantalla decía que sí y el POST volvía 400 sobre una
 * dirección que SES manda sin chistar. Lo peor no fue la divergencia sino que
 * había un test verde **de cada lado**: cada uno afirmaba su mitad y ninguno los
 * cruzaba, así que el desacuerdo estaba documentado en dos archivos como si fuera
 * la regla.
 *
 * Se resolvió midiendo contra el SES de producción el 17-ago-2026, mandando de
 * verdad y con controles que cortan la conclusión si la credencial no sirve:
 *
 *   avisos@mail.goberna.us   → ACEPTADO
 *   a@x.y.goberna.us         → ACEPTADO (anidado, también)
 *   prueba@gmail.com         → 554 «Email address is not verified»   ← CONTROL
 *   a@gobernaus.com          → 554 «Email address is not verified»   ← CONTROL
 *
 * El segundo control es el que obliga al punto del prefijo: sin él, `endsWith`
 * pelado deja pasar `xgoberna.us`, que es de otra persona. Es el mismo error de
 * forma que el sufijo de 9 dígitos del teléfono (#119).
 *
 * ══ QUÉ SE CRUZA, Y POR QUÉ EL FRONT ENTRA CON SU PORTÓN ENTERO ═════════════
 *
 * Del lado del server la pregunta la contesta `puedeSerRemitente` sola: la ruta
 * de alta no aplica ningún otro chequeo de forma sobre `direccion`. Del lado del
 * front la contestan **dos** funciones encadenadas —`FORMA_DE_CORREO` y después
 * `dominioAceptado`—, en ese orden y en los dos lugares que preguntan
 * (`motivoParaNoGuardar` y la vista previa del sobre). Cruzar `dominioAceptado`
 * suelto compararía media pregunta contra una entera, así que acá se replica el
 * portón completo. Que el orden siga siendo ése lo fija el último test.
 *
 * ⚠️ No se importa el front: son dos builds distintos y un test del server no
 * puede depender del tsconfig de la app. Se lee el archivo, se le saca lo único
 * que cambia (el regex y la regla del sufijo) y se replica la forma — el molde es
 * `nombreVendedora.paridad.test.ts`. Mover `src/features/correos/correos.ts` rompe
 * esto en EJECUCIÓN con los dos typechecks en verde.
 */

const RUTA_FRONT = fileURLToPath(
  new URL('../../../src/features/correos/correos.ts', import.meta.url),
);

/**
 * ⚠️ Si no encuentra el regex **falla**. Un extractor que devuelve un default
 * deja este archivo verde para siempre sobre dos implementaciones que ya nadie
 * compara, que es exactamente el estado del que venimos.
 */
function formaDelFront(fuente: string): RegExp {
  const m = /^\s*(?:export )?const FORMA_DE_CORREO\s*=\s*(\/.*\/[dgimsuvy]*)\s*;/m.exec(fuente);
  assert.ok(m, 'no encontré `FORMA_DE_CORREO` en el front — ¿se renombró o se movió?');
  const literal = m[1] as string;
  const cierre = literal.lastIndexOf('/');
  return new RegExp(literal.slice(1, cierre), literal.slice(cierre + 1));
}

/** El cuerpo de una función, hasta su llave de cierre en la columna 0. */
function hasta(desde: string): string {
  const fin = desde.indexOf('\n}\n');
  return fin === -1 ? desde : desde.slice(0, fin + 2);
}

/**
 * El portón del FRONT, reconstruido. No se evalúa su código —eso sería confiar en
 * que un `eval` lee igual que el bundler—: se replica la forma y se le inyecta lo
 * único que puede cambiar sin que nadie lo note, que es el regex.
 */
function comoElFront(direccion: string, verificados: string[] | undefined, forma: RegExp): boolean {
  // `motivoParaNoGuardar` recorta la caja antes de preguntar nada.
  const limpia = direccion.trim();
  if (!forma.test(limpia)) return false;

  const dominios = (verificados ?? []).map((d) => d.trim().toLowerCase()).filter((d) => d !== '');
  if (dominios.length === 0) return true;

  const bajo = limpia.toLowerCase();
  const dominio = bajo.slice(bajo.lastIndexOf('@') + 1);
  if (dominio === '') return false;

  return dominios.some((v) => dominio === v || dominio.endsWith(`.${v}`));
}

/**
 * Los casos que deciden si un correo sale o vuelve 554.
 *
 * ⚠️ **Todos los dominios de las listas llevan un punto**, y no es un descuido:
 * SES verifica dominios registrados, así que un `localhost` pelado no puede estar
 * en `SMTP_DOMINIOS_VERIFICADOS`. Sobre un dominio de una sola etiqueta las dos
 * implementaciones SÍ difieren, y está fijado abajo como asimetría conocida en vez
 * de escondido sacando el caso.
 */
const CASOS: ReadonlyArray<{ direccion: string; dominios: string[] }> = [
  // ── El caso normal y los dos subdominios MEDIDOS ────────────────────────────
  { direccion: 'escuela@goberna.us', dominios: ['goberna.us'] },
  { direccion: 'ventas@goberna.us', dominios: ['goberna.us'] },
  { direccion: 'avisos@mail.goberna.us', dominios: ['goberna.us'] },
  { direccion: 'a@x.y.goberna.us', dominios: ['goberna.us'] },

  // ── El sufijo que NO es subdominio: el CONTROL de la medición ───────────────
  { direccion: 'a@xgoberna.us', dominios: ['goberna.us'] },
  { direccion: 'a@gobernaus.com', dominios: ['goberna.us'] },
  // El dominio del equipo, que NO está verificado: tres de las nueve lo tienen.
  { direccion: 'ventas10@grupogoberna.com', dominios: ['goberna.us'] },

  // ── Mayúsculas de los DOS lados ────────────────────────────────────────────
  { direccion: 'Escuela@GOBERNA.US', dominios: ['goberna.us'] },
  { direccion: 'escuela@goberna.us', dominios: ['Goberna.US'] },
  { direccion: 'Avisos@Mail.Goberna.Us', dominios: ['GOBERNA.us'] },

  // ── Bordes de la caja y de la lista ────────────────────────────────────────
  { direccion: '  escuela@goberna.us  ', dominios: ['goberna.us'] },
  { direccion: 'escuela@goberna.us', dominios: ['  goberna.us  '] },
  { direccion: 'a@otro.pe', dominios: ['', 'goberna.us', '   ', 'otro.pe'] },
  { direccion: 'a@sub.otro.pe', dominios: ['goberna.us', 'otro.pe'] },
  { direccion: 'a@otrope.com', dominios: ['goberna.us', 'otro.pe'] },

  // ── Lo que partiría una cabecera en dos, o la dejaría a medias ─────────────
  { direccion: 'a@b@goberna.us', dominios: ['goberna.us'] },
  { direccion: 'a b@goberna.us', dominios: ['goberna.us'] },
  { direccion: '@goberna.us', dominios: ['goberna.us'] },
  { direccion: 'a@', dominios: ['goberna.us'] },
  { direccion: 'a@goberna.us.', dominios: ['goberna.us'] },
  { direccion: '', dominios: ['goberna.us'] },
  { direccion: '   ', dominios: ['goberna.us'] },
];

describe('el dominio verificado: server y front', () => {
  test('las dos implementaciones contestan lo mismo sobre cada dirección', () => {
    const forma = formaDelFront(readFileSync(RUTA_FRONT, 'utf8'));

    for (const { direccion, dominios } of CASOS) {
      const delServer = puedeSerRemitente(direccion, dominios);
      const delFront = comoElFront(direccion, dominios, forma);
      assert.equal(
        delFront,
        delServer,
        `«${direccion}» contra [${dominios.join(', ')}]: el front dice ${delFront} y el server ` +
          `${delServer} — o la pantalla promete un alta que rebota, o se niega a guardar algo válido`,
      );
    }
  });

  /**
   * LAS DOS ASIMETRÍAS DE LA LISTA, FIJADAS COMO ASIMETRÍAS.
   *
   * 🔴 **No son el mismo hecho dicho de dos maneras: la lista vacía significa
   * cosas distintas de cada lado.**
   *
   *   · En el **front**, `undefined` es «el server no me lo dijo» —un server viejo
   *     en la ventana N4↔N5— y `[]` es indistinguible de eso. Apagar el alta por
   *     cualquiera de las dos dejaría la pantalla muerta justo cuando hay que
   *     usarla, así que **no valida nada** y deja que conteste el 400.
   *   · En el **server** no existe «no me lo dijeron»: el argumento lo arma
   *     `dominiosVerificados`, que ante la variable ausente o vacía devuelve el
   *     único dominio MEDIDO como verificado. Una lista vacía ahí sólo puede
   *     llegar de un llamador que la inventó, y por eso es **fail-closed**.
   *
   * ⚠️ La asimetría **no se puede ver en producción**, y ése es el argumento de
   * que sea correcta: para que muerda haría falta que el server reciba `[]`, y su
   * propia capa de entorno no lo puede producir. Borrar cualquiera de las dos
   * mitades para que el test quede lindo rompe algo real: fail-open del lado del
   * server, o pantalla muerta del lado del front.
   */
  test('🔴 con la lista vacía el server cierra y el front no valida — la asimetría es a propósito', () => {
    const forma = formaDelFront(readFileSync(RUTA_FRONT, 'utf8'));

    // Server: fail-closed, hasta con la dirección que sí está verificada.
    assert.equal(puedeSerRemitente('escuela@goberna.us', []), false);

    // Front: no valida el dominio, ni con la lista vacía ni sin lista. La forma
    // sigue mandando, así que un no-correo sigue siendo un no-correo.
    assert.equal(comoElFront('x@gmail.com', [], forma), true);
    assert.equal(comoElFront('x@gmail.com', undefined, forma), true);
    assert.equal(comoElFront('luz', undefined, forma), false);

    // Y la razón por la que nada de esto muerde: el server no puede recibir `[]`.
    assert.deepEqual(dominiosVerificados({}), ['goberna.us']);
    assert.deepEqual(dominiosVerificados({ SMTP_DOMINIOS_VERIFICADOS: '' }), ['goberna.us']);
    assert.deepEqual(dominiosVerificados({ SMTP_DOMINIOS_VERIFICADOS: ' , , ' }), ['goberna.us']);
  });

  /**
   * LAS DOS ASIMETRÍAS DE FORMA, Y HACIA QUÉ LADO FALLA CADA UNA.
   *
   * ⚠️ El front exige `FORMA_DE_CORREO` sobre la dirección y **el server no**: su
   * portón pide una sola arroba, dos mitades no vacías y ningún espacio, nada más.
   * Así que hay direcciones que el server acepta y la pantalla no:
   *
   *   · `a,b@goberna.us` — una coma adentro de un `From` es la forma de convertir
   *     un destinatario en dos. Que la pantalla se niegue está BIEN; lo que está
   *     abierto es que un POST directo la escriba igual.
   *   · `a@localhost` — un dominio de una sola etiqueta. No puede aparecer en
   *     `SMTP_DOMINIOS_VERIFICADOS` porque SES verifica dominios registrados, así
   *     que hoy es teórico.
   *
   * 🔴 **Las dos fallan hacia el lado del front, y ése es el lado CARO**, contra
   * lo que el propio docblock de `dominioAceptado` pide («puede ser más floja que
   * la del server, nunca más estricta»): quien las escriba ve un botón apagado y
   * no tiene desde dónde arreglarlo. Quedan fijadas acá —no escondidas sacando el
   * caso— para que el día que alguien afloje `FORMA_DE_CORREO` o endurezca
   * `puedeSerRemitente` este archivo lo obligue a decidir en vez de dejarlo pasar.
   */
  test('⚠️ el server acepta dos formas que la pantalla no, y están anotadas', () => {
    const forma = formaDelFront(readFileSync(RUTA_FRONT, 'utf8'));

    // Una coma: el server la deja pasar, el front no.
    assert.equal(puedeSerRemitente('a,b@goberna.us', ['goberna.us']), true);
    assert.equal(comoElFront('a,b@goberna.us', ['goberna.us'], forma), false);

    // Un dominio de una sola etiqueta: ídem.
    assert.equal(puedeSerRemitente('a@localhost', ['localhost']), true);
    assert.equal(comoElFront('a@localhost', ['localhost'], forma), false);
  });

  /**
   * 🔴 Lo de arriba cruza el RESULTADO; esto cruza la FORMA. Sin esto, el front
   * podría volver a la igualdad exacta —o dejar de preguntar la forma antes del
   * dominio— y la réplica de este archivo seguiría diciendo que están de acuerdo,
   * porque la réplica es mía, no suya.
   */
  test('🔴 el front sigue teniendo la MISMA forma que esta réplica', () => {
    const fuente = readFileSync(RUTA_FRONT, 'utf8');
    // ⚠️ Se corta en el cierre de la función. Sin el corte, el `actual` de un
    // assert fallido es **el resto del archivo** —cuatrocientas líneas de docblocks
    // en la consola— y el mensaje que explica qué se rompió queda enterrado.
    const fn = hasta(fuente.slice(fuente.indexOf('export function dominioAceptado')));

    assert.match(
      fn,
      /dominio === v \|\| dominio\.endsWith\(`\.\$\{v\}`\)/,
      'el front cambió la regla del subdominio: o volvió a la igualdad exacta, o perdió el punto del prefijo y `xgoberna.us` pasa',
    );
    assert.match(
      fn,
      /if \(dominios\.length === 0\) return true;/,
      'el front dejó de tratar la lista vacía como «el server no me lo dijo»: revisá la asimetría de arriba antes de cambiarlo',
    );

    // El orden del portón: la forma se pregunta ANTES que el dominio, y en los dos
    // lugares que preguntan. Con el orden dado vuelta, el aviso señala la caja
    // equivocada; sin la primera pregunta, la réplica de acá deja de ser fiel.
    const guarda = hasta(fuente.slice(fuente.indexOf('export function motivoParaNoGuardar')));
    const posForma = guarda.indexOf('FORMA_DE_CORREO.test(direccion)');
    const posDominio = guarda.indexOf('dominioAceptado(direccion');
    assert.ok(posForma > 0, '`motivoParaNoGuardar` dejó de preguntar la forma de la dirección');
    assert.ok(posDominio > 0, '`motivoParaNoGuardar` dejó de preguntar el dominio');
    assert.ok(
      posForma < posDominio,
      'el front pregunta el dominio antes que la forma: esta réplica supone el orden contrario',
    );
  });
});
