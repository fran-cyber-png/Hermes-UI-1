/**
 * MEDIR CONTRASTE SOBRE LA FUENTE DEL CSS — la herramienta compartida.
 *
 * Existe porque el defecto que persigue no se ve en ningún DOM: dos colores que
 * viven a 300 líneas de distancia en `index.css` y que, juntos, dan un elemento
 * que está ahí y no se lee. jsdom no calcula color y una captura no lo delata
 * (hay que estar arrastrando el mouse, o tener el sistema en oscuro). Lo único
 * que lo atrapa es leer el árbol y medir la RELACIÓN entre dos declaraciones.
 *
 * Vive acá y no adentro de un test porque ya son dos los que miden lo mismo con
 * la misma fórmula (`seleccionVisible.test.ts` y `temaOscuroLegible.test.ts`), y
 * una fórmula de WCAG copiada dos veces es una fórmula que se puede corregir en
 * un solo lado.
 */

/**
 * El árbol como texto. `import.meta.glob` es la vía de Vite y está tipada acá
 * (`types: ["vite/client"]`): un `node:fs` compilaría en vitest pero NO pasa
 * `tsc -p tsconfig.app.json`, que no lleva los tipos de node.
 */
const CSS: Record<string, string> = import.meta.glob('../index.css', {
  query: '?raw',
  import: 'default',
  eager: true,
});

/** La fuente de `src/index.css`. */
export const FUENTE_CSS = Object.values(CSS)[0] ?? '';

/** El cuerpo del primer bloque que matchee `selector` (con un grupo de captura). */
export function cuerpoDe(css: string, selector: RegExp): string {
  return selector.exec(css)?.[1] ?? '';
}

/** Los tokens de color de un cuerpo de declaraciones, resueltos a hex. */
export function tokensDelBloque(cuerpo: string): Record<string, string> {
  const tokens: Record<string, string> = {};
  for (const m of cuerpo.matchAll(/(--[a-z0-9-]+)\s*:\s*(#[0-9A-Fa-f]{3,8})\s*;/g)) {
    tokens[m[1]] = m[2];
  }
  return tokens;
}

/**
 * LOS DOS TEMAS. El oscuro HEREDA del claro y solo pisa lo suyo — igual que en
 * el CSS, donde `:root[data-theme="dark"]` redefine tokens sobre `:root`. Por
 * eso acá se mezclan en ese orden en vez de copiar una lista: una lista copiada
 * es la que ya se desincronizó una vez.
 */
export const TOKENS_CLAROS = tokensDelBloque(cuerpoDe(FUENTE_CSS, /:root\s*\{([\s\S]*?)\n\}/));
export const TOKENS_OSCUROS = {
  ...TOKENS_CLAROS,
  ...tokensDelBloque(cuerpoDe(FUENTE_CSS, /:root\[data-theme="dark"\]\s*\{([\s\S]*?)\n\}/)),
};

export const TEMAS = [
  { nombre: 'claro', tokens: TOKENS_CLAROS },
  { nombre: 'oscuro', tokens: TOKENS_OSCUROS },
] as const;

/** Resuelve un valor CSS que puede ser un hex directo o un `var(--token)`. */
export function aHex(valor: string, tokens: Record<string, string>): string {
  const crudo = valor.trim();
  const ref = /^var\(\s*(--[a-z0-9-]+)\s*\)$/.exec(crudo);
  const hex = ref ? tokens[ref[1]] : crudo;
  if (!hex || !/^#[0-9A-Fa-f]{3,6}$/.test(hex)) {
    throw new Error(`no se pudo resolver «${valor}» a un hex (¿token nuevo sin declarar en :root?)`);
  }
  return hex;
}

/** Luminancia relativa de WCAG 2.1 — la fórmula, sin atajos. */
export function luminancia(hex: string): number {
  const n = hex.slice(1);
  const partes =
    n.length === 3 ? [...n].map((c) => c + c) : [n.slice(0, 2), n.slice(2, 4), n.slice(4, 6)];
  const [r, g, b] = partes.map((p) => {
    const c = parseInt(p, 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contraste(a: string, b: string): number {
  const [claro, oscuro] = [luminancia(a), luminancia(b)].sort((x, y) => y - x);
  return (claro + 0.05) / (oscuro + 0.05);
}

/** El piso de WCAG AA para texto normal. */
export const MINIMO_TEXTO = 4.5;
/** El piso de WCAG para un elemento no textual (un rectángulo de resalte, un filete). */
export const MINIMO_FONDO = 3;
