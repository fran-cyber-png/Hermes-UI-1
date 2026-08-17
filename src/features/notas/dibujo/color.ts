/**
 * CONVERSIONES DE COLOR — puras, sin DOM.
 *
 * El selector avanzado necesita moverse entre tres representaciones y ninguna
 * sirve para las tres cosas a la vez:
 *
 *   · **HEX** es lo que se guarda en la figura y lo que la gente copia y pega.
 *   · **RGB** es lo que la gente escribe cuando tiene un valor de marca.
 *   · **HSV** es lo único con lo que se puede ARMAR un selector visual: el
 *     cuadrado grande es saturación × valor a matiz fijo, y la barra es el
 *     matiz. En RGB ese cuadrado no existe.
 *
 * Todo esto vive acá y no adentro del componente por un motivo concreto: son
 * las funciones donde un error se ve como «el color que elegí no es el que
 * salió», que es imposible de depurar mirando la pantalla. Acá se prueban con
 * valores conocidos.
 *
 * ⚠️ El canal alfa no se maneja: las figuras guardan un `#rrggbb` y la
 * transparencia del resaltador la pone el pintor (`pintar.ts`), no el color.
 * Un selector con alfa haría que el mismo color signifique dos cosas distintas
 * según la herramienta.
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface Hsv {
  /** 0–360 */
  h: number;
  /** 0–1 */
  s: number;
  /** 0–1 */
  v: number;
}

function recortar(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/** Redondea y recorta a un byte. Lo usan todas las salidas RGB. */
export function aByte(n: number): number {
  return Number.isFinite(n) ? recortar(Math.round(n), 0, 255) : 0;
}

/**
 * TEXTO → RGB. Acepta lo que una persona escribe o pega de verdad:
 * `#3b82f6`, `3b82f6`, `#39f`, con espacios y en mayúsculas.
 *
 * Devuelve `null` cuando no se entiende, y **no adivina**: un campo que
 * convierte `#zzz` en negro le muestra a la vendedora un color que no pidió y
 * la deja sin saber que se equivocó al tipear.
 */
export function desdeHex(texto: string): Rgb | null {
  const limpio = texto.trim().replace(/^#/, '');

  // La forma corta es la de siempre en CSS: cada dígito se duplica, así que
  // `#39f` es `#3399ff` y no `#0309 0f`.
  if (/^[0-9a-fA-F]{3}$/.test(limpio)) {
    return {
      r: parseInt(limpio[0] + limpio[0], 16),
      g: parseInt(limpio[1] + limpio[1], 16),
      b: parseInt(limpio[2] + limpio[2], 16),
    };
  }
  if (/^[0-9a-fA-F]{6}$/.test(limpio)) {
    return {
      r: parseInt(limpio.slice(0, 2), 16),
      g: parseInt(limpio.slice(2, 4), 16),
      b: parseInt(limpio.slice(4, 6), 16),
    };
  }
  return null;
}

/** RGB → `#rrggbb`, siempre en minúsculas y siempre de seis dígitos. */
export function aHex({ r, g, b }: Rgb): string {
  const dos = (n: number) => aByte(n).toString(16).padStart(2, '0');
  return `#${dos(r)}${dos(g)}${dos(b)}`;
}

/** HSV → RGB. `h` en grados, `s` y `v` en 0–1. */
export function hsvARgb({ h, s, v }: Hsv): Rgb {
  const matiz = ((h % 360) + 360) % 360;
  const sat = recortar(s, 0, 1);
  const val = recortar(v, 0, 1);

  const c = val * sat;
  const x = c * (1 - Math.abs(((matiz / 60) % 2) - 1));
  const m = val - c;

  const sector = Math.floor(matiz / 60) % 6;
  const [r, g, b] = (
    [
      [c, x, 0],
      [x, c, 0],
      [0, c, x],
      [0, x, c],
      [x, 0, c],
      [c, 0, x],
    ] as const
  )[sector];

  return { r: aByte((r + m) * 255), g: aByte((g + m) * 255), b: aByte((b + m) * 255) };
}

/**
 * RGB → HSV.
 *
 * ⚠️ Con un gris (saturación 0) el matiz es **indefinido en matemática pero no
 * en la pantalla**: si devolviera 0, mover el cuadrado sobre un negro saltaría
 * el selector de matiz al rojo y la barra pegaría un salto que nadie pidió.
 * Por eso el llamador conserva su matiz y esto solo se usa al ENTRAR un color
 * nuevo (un HEX pegado, un color de la paleta).
 */
export function rgbAHsv({ r, g, b }: Rgb): Hsv {
  const rr = aByte(r) / 255;
  const gg = aByte(g) / 255;
  const bb = aByte(b) / 255;

  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const d = max - min;

  let h = 0;
  if (d !== 0) {
    if (max === rr) h = 60 * (((gg - bb) / d) % 6);
    else if (max === gg) h = 60 * ((bb - rr) / d + 2);
    else h = 60 * ((rr - gg) / d + 4);
  }
  if (h < 0) h += 360;

  return { h, s: max === 0 ? 0 : d / max, v: max };
}

/** `#rrggbb` → HSV, o `null` si el texto no es un color. */
export function hexAHsv(texto: string): Hsv | null {
  const rgb = desdeHex(texto);
  return rgb ? rgbAHsv(rgb) : null;
}

/** HSV → `#rrggbb`. El atajo que usa el selector en cada movimiento. */
export function hsvAHex(hsv: Hsv): string {
  return aHex(hsvARgb(hsv));
}

/**
 * ¿SOBRE ESTE COLOR SE LEE MEJOR EL NEGRO O EL BLANCO?
 *
 * Lo usa la vista previa para escribir el HEX ENCIMA del color elegido. Sin
 * esto, el texto desaparece en los dos extremos de la paleta — y justo el
 * blanco y el negro son los dos colores que más se usan.
 *
 * Es la luminancia relativa de WCAG con el umbral de siempre; no hace falta más
 * precisión para decidir entre dos opciones.
 */
export function tintaSobre(color: string): '#000000' | '#ffffff' {
  const rgb = desdeHex(color) ?? { r: 255, g: 255, b: 255 };
  const canal = (c: number) => {
    const n = c / 255;
    return n <= 0.03928 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
  };
  const luminancia = 0.2126 * canal(rgb.r) + 0.7152 * canal(rgb.g) + 0.0722 * canal(rgb.b);
  return luminancia > 0.179 ? '#000000' : '#ffffff';
}
