import { describe, expect, it } from 'vitest';
import {
  FUENTE_CSS,
  MINIMO_FONDO,
  MINIMO_TEXTO,
  TEMAS,
  TOKENS_CLAROS as CLAROS,
  TOKENS_OSCUROS as OSCUROS,
  aHex,
  contraste,
} from './pruebas/contraste';

/**
 * ══ QUE LA SELECCIÓN SE VEA — el candado del `::selection` ═══════════════════
 *
 * 🔴 EL DEFECTO QUE ESTO VIGILA NO SE VE EN NINGÚN DOM. La selección de texto del
 * hilo de WhatsApp nunca estuvo bloqueada: no hay `user-select: none`, ni un
 * handler que se coma el arrastre, ni nadie que intercepte ⌘C. **Funcionaba y era
 * invisible.** `::selection` pintaba `background: var(--secondary)` con
 * `color: var(--navy)`, que son exactamente los dos colores de la burbuja saliente
 * (`bg-secondary text-navy-ink`): contraste 1.00 contra el fondo y 1.00 contra el
 * texto. La vendedora arrastraba el mouse sobre un mensaje propio, no cambiaba un
 * píxel, y concluía que el chat no se puede copiar.
 *
 * Un test de componente no lo puede ver —jsdom no calcula color— y una captura
 * tampoco, porque hay que estar arrastrando. Lo único que lo atrapa es medir el
 * CONTRASTE entre dos declaraciones que viven a 500 líneas de distancia en el
 * mismo archivo. Así que se mide.
 *
 * Es el mismo molde que `src/lib/etapas.test.ts`: se fija una RELACIÓN leyendo el
 * árbol, no la ortografía de un valor. El dueño puede cambiar el azul cuando
 * quiera; lo que no puede es elegir uno que desaparezca sobre una burbuja.
 */

/**
 * La fuente del CSS, el parseo de tokens por tema y la fórmula de contraste
 * viven en `pruebas/contraste.ts`: este archivo dejó de ser el único que las
 * necesita el día que el tema oscuro dejó de ser una copia sin dueño (ver
 * `temaOscuroLegible.test.ts`).
 */
const HILO: Record<string, string> = import.meta.glob('./features/whatsapp/HiloWhatsapp.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
});

const fuente = FUENTE_CSS;
const hilo = Object.values(HILO)[0] ?? '';

/**
 * 🔴 POR QUÉ ESTO MIDE **DOS** TEMAS.
 *
 * Este test nació midiendo un solo juego de tokens —el de `:root`— y su propio
 * docblock decía que alcanzaba «porque este archivo no tiene tokens de tema
 * oscuro». Después los tuvo (546645f), la regla no se repitió, y el resalte
 * volvió a ser invisible en oscuro —blanco sobre #60A5FA, 2.32:1— SIN que este
 * test se enterara: medía el único tema en el que el defecto no estaba.
 */

/** Lo que `::selection` declara hoy, ya resuelto en el tema que se le pida. */
function reglaDeSeleccion(css: string, tokens: Record<string, string>): { fondo: string; tinta: string } {
  const cuerpo = /::selection\s*\{([^}]*)\}/.exec(css)?.[1];
  if (!cuerpo) throw new Error('no hay regla `::selection` en index.css');
  const fondo = /(?:^|[\s;])background\s*:\s*([^;]+);/.exec(cuerpo)?.[1];
  const tinta = /(?:^|[\s;])color\s*:\s*([^;]+);/.exec(cuerpo)?.[1];
  if (!fondo || !tinta) throw new Error('`::selection` tiene que declarar `background` Y `color`');
  return { fondo: aHex(fondo, tokens), tinta: aHex(tinta, tokens) };
}


/**
 * LAS SUPERFICIES DONDE VIVE TEXTO QUE SE ARRASTRA. Las dos primeras son las
 * burbujas del hilo —el caso que rompió— y las otras dos, la mesa sobre la que se
 * apoyan (el hilo es `bg-muted/30` sobre `--background`). Todo lo demás en la app
 * se lee sobre alguna de estas cuatro.
 */
const SUPERFICIES = ['--card', '--secondary', '--background', '--muted'] as const;

/**
 * El puente clase↔token de las burbujas: si alguien repinta la burbuja, la clase
 * desaparece del archivo y este test manda a revisar `SUPERFICIES` en vez de
 * dejar la lista midiendo un color que ya nadie usa.
 */
const BURBUJAS = [
  { clase: 'bg-secondary', token: '--secondary', cual: 'saliente' },
  { clase: 'bg-card', token: '--card', cual: 'entrante' },
] as const;

describe('el resalte de selección se ve', () => {
  it('hay tokens y hay regla que medir (si no, el test no verifica nada)', () => {
    // Sin esta guarda, un glob que dejara de matchear volvería todo verde por
    // vacío — el mismo falso verde de `verificar-assets.sh`.
    expect(Object.keys(CLAROS).length).toBeGreaterThan(0);
    expect(fuente).toContain('::selection');
    expect(hilo).toContain('rounded-2xl');
  });

  /**
   * La guarda del tema oscuro: si mañana alguien borra el bloque
   * `:root[data-theme="dark"]`, `OSCUROS` se vuelve una copia de `CLAROS` y los
   * cuatro tests de abajo pasarían midiendo dos veces el mismo tema. Verde por
   * vacío, otra vez, en el lugar exacto donde ya pasó.
   */
  it('el tema oscuro existe y pisa de verdad la paleta', () => {
    expect(fuente).toContain(':root[data-theme="dark"]');
    expect(OSCUROS['--background']).not.toBe(CLAROS['--background']);
    expect(OSCUROS['--primary-hover']).not.toBe(CLAROS['--primary-hover']);
  });

  it('las dos burbujas del hilo siguen siendo las superficies que se miden', () => {
    for (const b of BURBUJAS) {
      expect(
        hilo.includes(b.clase),
        `la burbuja ${b.cual} ya no usa \`${b.clase}\`: revisá SUPERFICIES acá`,
      ).toBe(true);
      expect(SUPERFICIES).toContain(b.token);
    }
  });

  for (const { nombre, tokens } of TEMAS) {
    /**
     * 🔴 EL TEST QUE MOTIVÓ EL FRENTE. Un fondo de selección igual al de un
     * contenedor de texto no rompe nada, no tira ningún error y no se ve en
     * ninguna captura: simplemente la selección deja de existir para el ojo.
     */
    it(`[${nombre}] el fondo del resalte no coincide con ninguna superficie`, () => {
      const { fondo } = reglaDeSeleccion(fuente, tokens);
      for (const token of SUPERFICIES) {
        expect(
          fondo.toLowerCase(),
          `\`::selection\` usa el mismo color que ${token}: la selección sería invisible ahí`,
        ).not.toBe(tokens[token].toLowerCase());
      }
    });

    it(`[${nombre}] el fondo del resalte contrasta ${MINIMO_FONDO}:1 contra cada superficie`, () => {
      const { fondo } = reglaDeSeleccion(fuente, tokens);
      for (const token of SUPERFICIES) {
        const c = contraste(fondo, tokens[token]);
        expect(
          c,
          `${fondo} sobre ${token} (${tokens[token]}) da ${c.toFixed(2)}:1`,
        ).toBeGreaterThanOrEqual(MINIMO_FONDO);
      }
    });

    it(`[${nombre}] el texto seleccionado se lee ${MINIMO_TEXTO}:1 sobre el resalte`, () => {
      // Resaltar y volver ilegible lo resaltado es cambiar un defecto por otro:
      // la vendedora copia mirando qué agarró.
      const { fondo, tinta } = reglaDeSeleccion(fuente, tokens);
      const c = contraste(tinta, fondo);
      expect(c, `tinta ${tinta} sobre resalte ${fondo} da ${c.toFixed(2)}:1`).toBeGreaterThanOrEqual(
        MINIMO_TEXTO,
      );
    });

    /**
     * El dorado significa «tiempo que se acaba» y nada más. Un resalte es un
     * estado de la interfaz, no un plazo — y aparecería en cada arrastre, que es
     * la forma más rápida de gastar la única señal de urgencia que tiene la app.
     */
    it(`[${nombre}] el resalte no es de oro`, () => {
      const { fondo, tinta } = reglaDeSeleccion(fuente, tokens);
      const oros = [tokens['--gold'], tokens['--gold-ink'], tokens['--temp-tibio']].map((h) =>
        h?.toLowerCase(),
      );
      expect(oros).not.toContain(fondo.toLowerCase());
      expect(oros).not.toContain(tinta.toLowerCase());
    });
  }
});
