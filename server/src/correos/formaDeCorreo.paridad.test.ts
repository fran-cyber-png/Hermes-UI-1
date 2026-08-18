import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * EL CANDADO ENTRE LAS COPIAS DE `FORMA_DE_CORREO`.
 *
 * ══ QUÉ PASA EL DÍA QUE SE SEPARAN ══════════════════════════════════════════
 *
 * 🔴 Las dos direcciones del error duelen, y la segunda más:
 *
 *   · **El front afloja y el server no** → la pantalla guarda sin chistar, el
 *     botón se prende, y el POST vuelve **400** sobre una dirección que se veía
 *     bien. Molesto y explicable.
 *   · **El server afloja y el front no** → la pantalla **se niega a guardar algo
 *     válido**, y quien lo intenta está peleando con una regla que no existe
 *     desde el único lugar donde no puede hacer nada al respecto. Ahí no hay
 *     mensaje que ayude: la app dice que no y el server nunca se entera.
 *
 * Y no hay error, ni log, ni conteo que no cierre: se descubre cuando alguien se
 * cansa de que «no me deja» y escribe por Mattermost.
 *
 * ══ ERAN TRES Y HOY SON DOS ═════════════════════════════════════════════════
 *
 * Este regex llegó a estar escrito **tres** veces —`correos/remitente.ts`,
 * `src/features/correos/correos.ts` y una copia privada de `AdminRemitentes.tsx`—
 * y las tres eran `const` privadas sin nada que las cruzara. La tercera se
 * borró al mover las reglas de la pantalla al `.ts` puro; **nada impide que
 * vuelva**, así que acá se fija también su ausencia: una copia nueva es
 * exactamente el estado del que se salió.
 *
 * ⚠️ **La que manda es la del server**: la del front sólo adelanta el aviso
 * mientras se escribe. Si algún día divergen, se arregla la del front.
 *
 * ⚠️ Se leen los dos archivos como TEXTO, no se importan. Del lado del server el
 * regex es una `const` privada —y tiene que poder seguir siéndolo, exportarla
 * para un test sería agrandar la superficie del módulo por comodidad—, y del lado
 * del front son dos builds distintos: un test del server no puede depender del
 * tsconfig de la app. La cicatriz de leer por ruta es que **mover cualquiera de
 * los dos archivos rompe esto en EJECUCIÓN con los dos typechecks en verde**
 * (`whatsapp/lid.paridad.test.ts`): al mudarlos, `grep -rn` de la ruta vieja.
 */

const RUTA_SERVER = fileURLToPath(new URL('./remitente.ts', import.meta.url));
const RUTA_FRONT = fileURLToPath(
  new URL('../../../src/features/correos/correos.ts', import.meta.url),
);
const RUTA_PANTALLA = fileURLToPath(
  new URL('../../../src/features/correos/AdminRemitentes.tsx', import.meta.url),
);

/**
 * Saca el regex tal como está escrito en el fuente.
 *
 * ⚠️ Si no lo encuentra **falla**, nunca devuelve un default. Un extractor que no
 * encuentra nada y dice «todo bien» es el fallo silencioso que este archivo vino a
 * evitar: quedaría un candado verde sobre dos copias que ya nadie compara.
 */
function formaDeCorreoEn(ruta: string): { fuente: string; regex: RegExp } {
  const archivo = readFileSync(ruta, 'utf8');
  const m = /^\s*(?:export )?const FORMA_DE_CORREO\s*=\s*(\/.*\/[dgimsuvy]*)\s*;/m.exec(archivo);
  assert.ok(m, `no encontré \`const FORMA_DE_CORREO\` en ${ruta} — ¿se renombró o se movió?`);

  const literal = m[1] as string;
  const cierre = literal.lastIndexOf('/');
  return {
    fuente: literal,
    regex: new RegExp(literal.slice(1, cierre), literal.slice(cierre + 1)),
  };
}

/**
 * Las direcciones que importan: los `vendedora_id` que EXISTEN en producción, los
 * dominios de este frente, y lo que convertiría un `Reply-To` en dos.
 *
 * ⚠️ `'a@goberna.us\n'` está a propósito y **los dos lados lo aceptan**: en
 * JavaScript el `$` de un regex sin flag `m` matchea también antes de un `\n`
 * final. No es un desacuerdo entre las copias —es un agujero COMPARTIDO—, y lo
 * que lo tapa es `sinSaltos()` en `remitente.ts`, no este regex. Queda escrito acá
 * para que nadie llegue a la conclusión de que el regex solo alcanza.
 */
const DIRECCIONES = [
  // Los ids reales del equipo: tres son buzones y el resto no.
  'ventas10@grupogoberna.com',
  'ventas11@grupogoberna.com',
  'luz',
  'Luz',
  'Sindy',
  'alan',
  'Usuario1',
  'centurion:algo',
  // Los buzones del frente.
  'escuela@goberna.us',
  'ventas@goberna.us',
  'avisos@mail.goberna.us',
  'a@x.y.goberna.us',
  'Escuela@Goberna.US',
  'a.b+c%d_e-f@goberna.us',
  // Lo que partiría una cabecera en dos, o la dejaría a medias.
  'a@b@goberna.us',
  'a,b@goberna.us',
  'a;b@goberna.us',
  'a b@goberna.us',
  'a<b@goberna.us',
  '"a"@goberna.us',
  '@goberna.us',
  'a@',
  'a@goberna',
  'a@goberna.us.',
  'a@goberna..us',
  '',
  '   ',
  'a@goberna.us\n',
];

describe('`FORMA_DE_CORREO`: el server y la copia del front', () => {
  test('las dos copias contestan lo mismo sobre cada dirección', () => {
    const server = formaDeCorreoEn(RUTA_SERVER);
    const front = formaDeCorreoEn(RUTA_FRONT);

    for (const direccion of DIRECCIONES) {
      assert.equal(
        front.regex.test(direccion),
        server.regex.test(direccion),
        `«${direccion}»: el front dice ${front.regex.test(direccion)} y el server ` +
          `${server.regex.test(direccion)} — una de las dos pantallas miente sobre lo que se puede guardar`,
      );
    }
  });

  /**
   * ⚠️ La lista de arriba es finita y un regex tiene infinitas entradas: un juego
   * de casos puede quedar verde con dos regex que difieren en algo que a nadie se
   * le ocurrió escribir. Lo único que cierra el hueco es que sean **el mismo
   * texto**, y por eso este test existe además del otro.
   */
  test('🔴 y son el MISMO texto, que es lo que un juego de casos no puede garantizar', () => {
    assert.equal(
      formaDeCorreoEn(RUTA_FRONT).fuente,
      formaDeCorreoEn(RUTA_SERVER).fuente,
      'los dos `FORMA_DE_CORREO` dejaron de estar escritos igual: la que manda es la del server',
    );
  });

  /**
   * 🔴 La tercera copia vivía privada en el `.tsx` y anotada como deuda en su
   * propio archivo. Se fue; esto es lo que impide que vuelva de callado — y volver
   * es fácil, porque escribir el regex a mano ahí adentro compila, pasa el lint y
   * se ve razonable.
   */
  test('🔴 `AdminRemitentes.tsx` no volvió a escribir la suya', () => {
    const pantalla = readFileSync(RUTA_PANTALLA, 'utf8');

    assert.doesNotMatch(
      pantalla,
      /^\s*(?:export )?const FORMA_DE_CORREO\s*=/m,
      'volvió la TERCERA copia: la pantalla tiene que importarla de `correos.ts`, no declararla',
    );
    assert.match(
      pantalla,
      /FORMA_DE_CORREO/,
      'la pantalla dejó de nombrar `FORMA_DE_CORREO` — si dejó de validar la dirección, este candado ya no protege nada',
    );
  });
});
