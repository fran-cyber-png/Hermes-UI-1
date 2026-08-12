import { describe, expect, it } from 'vitest';

/**
 * ══ QUE LA SELECCIÓN SE VEA — el candado del `::selection` ═══════════════════
 *
 * 🔴 EL DEFECTO QUE ESTO VIGILA NO SE VE EN NINGÚN DOM. La selección de texto del
 * hilo de WhatsApp nunca estuvo bloqueada: no hay `user-select: none`, ni un
 * handler que se coma el arrastre, ni nadie que intercepte ⌘C. **Funcionaba y era
 * invisible.** `::selection` pintaba `background: var(--secondary)` con
 * `color: var(--navy)`, que son exactamente los dos colores de la burbuja saliente
 * (`bg-secondary text-navy`): contraste 1.00 contra el fondo y 1.00 contra el
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
 * El árbol como texto. `import.meta.glob` es la vía de Vite y está tipada acá
 * (`types: ["vite/client"]`): un `node:fs` compilaría en vitest pero NO pasa
 * `tsc -p tsconfig.app.json`, que no lleva los tipos de node.
 */
const CSS: Record<string, string> = import.meta.glob('./index.css', {
  query: '?raw',
  import: 'default',
  eager: true,
});
const HILO: Record<string, string> = import.meta.glob('./features/whatsapp/HiloWhatsapp.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
});

const fuente = Object.values(CSS)[0] ?? '';
const hilo = Object.values(HILO)[0] ?? '';

/** Los tokens de color declarados en `:root`, resueltos a hex. */
function tokensDeRaiz(css: string): Record<string, string> {
  const bloque = /:root\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';
  const tokens: Record<string, string> = {};
  for (const m of bloque.matchAll(/(--[a-z0-9-]+)\s*:\s*(#[0-9A-Fa-f]{3,8})\s*;/g)) {
    tokens[m[1]] = m[2];
  }
  return tokens;
}

const TOKENS = tokensDeRaiz(fuente);

/** Resuelve un valor CSS que puede ser un hex directo o un `var(--token)`. */
function aHex(valor: string): string {
  const crudo = valor.trim();
  const ref = /^var\(\s*(--[a-z0-9-]+)\s*\)$/.exec(crudo);
  const hex = ref ? TOKENS[ref[1]] : crudo;
  if (!hex || !/^#[0-9A-Fa-f]{3,6}$/.test(hex)) {
    throw new Error(`no se pudo resolver «${valor}» a un hex (¿token nuevo sin declarar en :root?)`);
  }
  return hex;
}

/** Lo que `::selection` declara hoy, ya resuelto. */
function reglaDeSeleccion(css: string): { fondo: string; tinta: string } {
  const cuerpo = /::selection\s*\{([^}]*)\}/.exec(css)?.[1];
  if (!cuerpo) throw new Error('no hay regla `::selection` en index.css');
  const fondo = /(?:^|[\s;])background\s*:\s*([^;]+);/.exec(cuerpo)?.[1];
  const tinta = /(?:^|[\s;])color\s*:\s*([^;]+);/.exec(cuerpo)?.[1];
  if (!fondo || !tinta) throw new Error('`::selection` tiene que declarar `background` Y `color`');
  return { fondo: aHex(fondo), tinta: aHex(tinta) };
}

/** Luminancia relativa de WCAG 2.1 — la fórmula, sin atajos. */
function luminancia(hex: string): number {
  const n = hex.slice(1);
  const partes =
    n.length === 3 ? [...n].map((c) => c + c) : [n.slice(0, 2), n.slice(2, 4), n.slice(4, 6)];
  const [r, g, b] = partes.map((p) => {
    const c = parseInt(p, 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contraste(a: string, b: string): number {
  const [claro, oscuro] = [luminancia(a), luminancia(b)].sort((x, y) => y - x);
  return (claro + 0.05) / (oscuro + 0.05);
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

/** El piso de WCAG para un elemento no textual (el rectángulo del resalte). */
const MINIMO_FONDO = 3;
/** El piso de WCAG AA para texto normal. */
const MINIMO_TEXTO = 4.5;

describe('el resalte de selección se ve', () => {
  it('hay tokens y hay regla que medir (si no, el test no verifica nada)', () => {
    // Sin esta guarda, un glob que dejara de matchear volvería todo verde por
    // vacío — el mismo falso verde de `verificar-assets.sh`.
    expect(Object.keys(TOKENS).length).toBeGreaterThan(0);
    expect(fuente).toContain('::selection');
    expect(hilo).toContain('rounded-2xl');
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

  /**
   * 🔴 EL TEST QUE MOTIVÓ EL FRENTE. Un fondo de selección igual al de un
   * contenedor de texto no rompe nada, no tira ningún error y no se ve en ninguna
   * captura: simplemente la selección deja de existir para el ojo.
   */
  it('el fondo del resalte no coincide con ninguna superficie', () => {
    const { fondo } = reglaDeSeleccion(fuente);
    for (const token of SUPERFICIES) {
      expect(
        fondo.toLowerCase(),
        `\`::selection\` usa el mismo color que ${token}: la selección sería invisible ahí`,
      ).not.toBe(TOKENS[token].toLowerCase());
    }
  });

  it(`el fondo del resalte contrasta ${MINIMO_FONDO}:1 contra cada superficie`, () => {
    const { fondo } = reglaDeSeleccion(fuente);
    for (const token of SUPERFICIES) {
      const c = contraste(fondo, TOKENS[token]);
      expect(c, `${fondo} sobre ${token} (${TOKENS[token]}) da ${c.toFixed(2)}:1`).toBeGreaterThanOrEqual(
        MINIMO_FONDO,
      );
    }
  });

  it(`el texto seleccionado se lee ${MINIMO_TEXTO}:1 sobre el resalte`, () => {
    // Resaltar y volver ilegible lo resaltado es cambiar un defecto por otro:
    // la vendedora copia mirando qué agarró.
    const { fondo, tinta } = reglaDeSeleccion(fuente);
    const c = contraste(tinta, fondo);
    expect(c, `tinta ${tinta} sobre resalte ${fondo} da ${c.toFixed(2)}:1`).toBeGreaterThanOrEqual(
      MINIMO_TEXTO,
    );
  });

  /**
   * El dorado significa «tiempo que se acaba» y nada más. Un resalte es un estado
   * de la interfaz, no un plazo — y aparecería en cada arrastre, que es la forma
   * más rápida de gastar la única señal de urgencia que tiene la app.
   */
  it('el resalte no es de oro', () => {
    const { fondo, tinta } = reglaDeSeleccion(fuente);
    const oros = [TOKENS['--gold'], TOKENS['--gold-ink'], TOKENS['--temp-tibio']].map((h) =>
      h?.toLowerCase(),
    );
    expect(oros).not.toContain(fondo.toLowerCase());
    expect(oros).not.toContain(tinta.toLowerCase());
  });
});
