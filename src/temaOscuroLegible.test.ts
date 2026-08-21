import { describe, expect, it } from 'vitest';
import {
  MINIMO_TEXTO,
  TEMAS,
  TOKENS_CLAROS as CLAROS,
  TOKENS_OSCUROS as OSCUROS,
  contraste,
} from './pruebas/contraste';

/**
 * ══ QUE EL TEMA OSCURO SE LEA — el candado del desdoble de `--navy` ══════════
 *
 * 🔴 EL DEFECTO QUE ESTO VIGILA TAMPOCO SE VE EN UN DOM, Y ADEMÁS SOLO LE PASA A
 * ALGUNAS. Durante semanas la app se ponía oscura sola —una media query global
 * que nadie pedía— y en oscuro `--navy` seguía valiendo #0E2A52. `--navy` era a
 * la vez la SUPERFICIE de una chapa (`bg-navy text-white`) y la TINTA del título
 * de cada pantalla (`text-navy`), así que el título quedaba en azul institucional
 * sobre #1A2332: contraste 1.1:1. El título estaba ahí, ocupaba su lugar, tenía
 * su texto en el DOM y era un rectángulo vacío. Quien tenía el sistema en claro
 * no vio nunca nada raro.
 *
 * La corrección no fue un color: fue partir el token en dos papeles —`--navy`
 * superficie, `--navy-ink` tinta— y elegir el papel en el marcado. Este test fija
 * ESA RELACIÓN, no la ortografía de un hex: el dueño puede cambiar el azul
 * cuando quiera; lo que no puede es elegir uno que desaparezca sobre una mesa.
 */

/** Las superficies donde se apoya texto. Todo lo demás se lee sobre alguna. */
const SUPERFICIES = ['--card', '--secondary', '--background', '--muted'] as const;

/** Las tintas que tienen que leerse sobre cualquiera de esas superficies. */
const TINTAS = ['--foreground', '--navy-ink'] as const;

/**
 * Todo el front como texto, para preguntarle QUÉ PAPEL eligió cada llamada.
 * Es la parte del invariante que no vive en el CSS: un token con dos papeles no
 * se arregla en la hoja, se arregla en quien lo escribe.
 */
const FUENTES: Record<string, string> = import.meta.glob(['./**/*.tsx', './**/*.ts'], {
  query: '?raw',
  import: 'default',
  eager: true,
});

/** Los archivos que todavía piden la TINTA por el token de la SUPERFICIE. */
function archivosConTintaDeSuperficie(): string[] {
  return Object.entries(FUENTES)
    .filter(([ruta]) => !ruta.includes('.test.') && !ruta.includes('/pruebas/'))
    .filter(([, fuente]) => /(?<![\w-])text-navy(?!-ink)/.test(fuente))
    .map(([ruta]) => ruta)
    .sort();
}

describe('el tema oscuro se lee', () => {
  it('hay dos temas que medir (si no, el test no verifica nada)', () => {
    expect(Object.keys(CLAROS).length).toBeGreaterThan(0);
    expect(Object.keys(FUENTES).length).toBeGreaterThan(50);
  });

  /**
   * El corazón del asunto. Si alguien vuelve a fundir los dos papeles en un
   * token —o «arregla» el tema oscuro invirtiendo `--navy` a secas—, esto se
   * pone rojo antes de que ningún título desaparezca.
   */
  it('la superficie no se invierte y la tinta sí', () => {
    expect(
      OSCUROS['--navy'],
      '`--navy` es superficie (`bg-navy text-white`, los velos de los modales): invertirlo deja esas chapas en blanco sobre blanco',
    ).toBe(CLAROS['--navy']);
    expect(
      OSCUROS['--navy-ink'],
      '`--navy-ink` es tinta: si no se aclara en oscuro, el título de cada pantalla queda en 1.1:1',
    ).not.toBe(CLAROS['--navy-ink']);
  });

  for (const { nombre, tokens } of TEMAS) {
    it(`[${nombre}] cada tinta se lee ${MINIMO_TEXTO}:1 sobre cada superficie`, () => {
      for (const tinta of TINTAS) {
        for (const superficie of SUPERFICIES) {
          const c = contraste(tokens[tinta], tokens[superficie]);
          expect(
            c,
            `${tinta} (${tokens[tinta]}) sobre ${superficie} (${tokens[superficie]}) da ${c.toFixed(2)}:1`,
          ).toBeGreaterThanOrEqual(MINIMO_TEXTO);
        }
      }
    });
  }

  /**
   * LA EXCEPCIÓN, Y POR QUÉ TIENE QUE SEGUIR SIÉNDOLO. La chapa de pendientes
   * del riel es `bg-gold text-navy`: el oro NO se apaga en el tema oscuro —es
   * señal de tiempo que se acaba, no decoración—, así que sobre esa chapa la
   * tinta clara no se ve. Es el único lugar de la app donde `text-navy` (el
   * token de superficie) es lo correcto, y el test guarda las dos mitades: que
   * la excepción se lea, y que sea UNA.
   */
  it('la chapa de oro conserva su tinta oscura, y es la única que lo hace', () => {
    for (const { nombre, tokens } of TEMAS) {
      const c = contraste(tokens['--navy'], tokens['--gold']);
      expect(c, `[${nombre}] navy sobre oro da ${c.toFixed(2)}:1`).toBeGreaterThanOrEqual(
        MINIMO_TEXTO,
      );
    }
    // Y la prueba de que la excepción no es capricho: la tinta clara ahí es ilegible.
    const conTintaClara = contraste(OSCUROS['--navy-ink'], OSCUROS['--gold']);
    expect(conTintaClara).toBeLessThan(MINIMO_TEXTO);

    expect(
      archivosConTintaDeSuperficie(),
      'apareció otro `text-navy`: o es tinta y va `text-navy-ink`, o es otra chapa que no se apaga en oscuro y entonces se documenta acá',
    ).toEqual([
      './App.tsx',
      // El chip «Solo calientes» del radar: misma chapa de oro, mismo motivo.
      './features/dashboard/VistaDashboard.tsx',
    ]);
  });
});
