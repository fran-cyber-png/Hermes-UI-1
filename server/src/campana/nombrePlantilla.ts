/**
 * LAS REGLAS DE UNA PLANTILLA NUEVA, ANTES DE MOLESTAR A META.
 *
 * ══ POR QUÉ SE VALIDA ACÁ SI META VALIDA IGUAL ══════════════════════════════
 *
 * Porque el ciclo con Meta es de **hasta 24 horas**. Mandar una plantilla con
 * una mayúscula en el nombre y enterarse al día siguiente —con un enum pelado
 * por toda explicación— es el peor lazo de retroalimentación posible para algo
 * que se escribe en dos minutos.
 *
 * Lo que se valida acá es sólo lo **mecánico y documentado**: nombre, largos,
 * variables. El juicio de contenido es de Meta y no se adivina: si aprueba o no
 * un texto promocional lo decide su revisión, y fingir que lo sabemos sería
 * bloquear plantillas legítimas.
 *
 * ══ LOS LARGOS SON LOS REALES, NO LOS QUE SE SUELEN CREER ═══════════════════
 *
 * Verificados contra la documentación oficial en agosto de 2026:
 *   · nombre: **512** caracteres (no 60, que es lo que casi todos asumen);
 *   · header de texto: 60 · cuerpo: **1024** · pie: 60;
 *   · botones: hasta 10, pero **con 4 o más no se ven en WhatsApp Desktop**.
 */

export const CATEGORIAS = ["MARKETING", "UTILITY", "AUTHENTICATION"] as const;
export type Categoria = (typeof CATEGORIAS)[number];

export const MAX_NOMBRE = 512;
export const MAX_CUERPO = 1024;
export const MAX_HEADER_TEXTO = 60;
export const MAX_PIE = 60;

/** Un problema que impide mandarla, en criollo y accionable. */
export interface Reparo {
  campo: "nombre" | "cuerpo" | "header" | "pie" | "categoria" | "idioma";
  problema: string;
  /** Qué hacer. Un reparo sin salida es un reproche. */
  arreglo: string;
}

export interface PlantillaNueva {
  nombre: string;
  idioma: string;
  categoria: string;
  cuerpo: string;
  headerTexto?: string | null;
  pie?: string | null;
}

/**
 * EL NOMBRE QUE META ACEPTA: minúsculas, números y guiones bajos.
 *
 * Se **sugiere** a partir de lo que la persona escribió en vez de rechazarlo:
 * «Promo 3x1 Agosto» → `promo_3x1_agosto`. Rechazar un nombre por tener una
 * mayúscula, cuando la corrección es obvia y mecánica, es hacerle hacer al
 * humano el trabajo de la máquina.
 */
export function sugerirNombre(crudo: string): string {
  return crudo
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, MAX_NOMBRE);
}

export function nombreEsValido(nombre: string): boolean {
  return nombre.length > 0 && nombre.length <= MAX_NOMBRE && /^[a-z0-9_]+$/.test(nombre);
}

/**
 * LAS VARIABLES: `{{1}}`, `{{2}}`… y las dos formas de escribirlas mal.
 *
 * Meta rechaza con `2388299` una variable al principio o al final del texto, y
 * con `2388293` dos variables pegadas. Las dos son fáciles de escribir sin
 * querer y las dos cuestan un ciclo de 24 h — por eso se atrapan acá.
 */
export function variablesDe(texto: string): number[] {
  return [...texto.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
}

export function revisar(p: PlantillaNueva): Reparo[] {
  const reparos: Reparo[] = [];

  if (!nombreEsValido(p.nombre)) {
    reparos.push({
      campo: "nombre",
      problema: "El nombre sólo puede tener minúsculas, números y guiones bajos.",
      arreglo: p.nombre ? `Probá con «${sugerirNombre(p.nombre)}».` : "Escribí un nombre.",
    });
  }

  if (!CATEGORIAS.includes(p.categoria as Categoria)) {
    reparos.push({
      campo: "categoria",
      problema: `«${p.categoria}» no es una categoría de Meta.`,
      arreglo: `Tiene que ser ${CATEGORIAS.join(", ")}.`,
    });
  }

  if (!p.idioma?.trim()) {
    reparos.push({
      campo: "idioma",
      problema: "Falta el idioma.",
      /**
       * El aviso sale de una cicatriz real: `promo_3x1_cursos` está registrada
       * como `en` con el cuerpo en español, y pedirla como `es` da 132001 —
       * «la plantilla no existe en ese idioma». El idioma es una etiqueta, no
       * una promesa sobre el texto.
       */
      arreglo: "Por ejemplo `es_PE`. Ojo: es una etiqueta, tiene que coincidir EXACTO al mandar.",
    });
  }

  const cuerpo = p.cuerpo?.trim() ?? "";
  if (!cuerpo) {
    reparos.push({ campo: "cuerpo", problema: "El cuerpo no puede estar vacío.", arreglo: "Escribí el mensaje." });
  } else {
    if (cuerpo.length > MAX_CUERPO) {
      reparos.push({
        campo: "cuerpo",
        problema: `El cuerpo tiene ${cuerpo.length} caracteres y el máximo es ${MAX_CUERPO}.`,
        arreglo: `Sacá ${cuerpo.length - MAX_CUERPO}.`,
      });
    }
    // Meta 2388299: una variable al principio o al final.
    if (/^\s*\{\{\d+\}\}/.test(cuerpo) || /\{\{\d+\}\}\s*$/.test(cuerpo)) {
      reparos.push({
        campo: "cuerpo",
        problema: "Hay una variable al principio o al final del texto, y Meta rechaza eso.",
        arreglo: "Ponele texto alrededor: «Hola {{1}}, …» en vez de «{{1}}, …».",
      });
    }
    // Meta 2388293: dos variables pegadas.
    if (/\}\}\s*\{\{/.test(cuerpo)) {
      reparos.push({
        campo: "cuerpo",
        problema: "Hay dos variables pegadas ({{1}}{{2}}), y Meta rechaza eso.",
        arreglo: "Separalas con texto o puntuación.",
      });
    }
    const vars = variablesDe(cuerpo);
    const esperadas = vars.map((_, i) => i + 1);
    if (vars.length > 0 && vars.join(",") !== esperadas.join(",")) {
      reparos.push({
        campo: "cuerpo",
        problema: `Las variables van de 1 en adelante y sin saltos. Encontré ${vars.join(", ")}.`,
        arreglo: `Deberían ser ${esperadas.join(", ")}.`,
      });
    }
  }

  if (p.headerTexto && p.headerTexto.length > MAX_HEADER_TEXTO) {
    reparos.push({
      campo: "header",
      problema: `El encabezado tiene ${p.headerTexto.length} caracteres y el máximo es ${MAX_HEADER_TEXTO}.`,
      arreglo: `Sacá ${p.headerTexto.length - MAX_HEADER_TEXTO}.`,
    });
  }

  if (p.pie && p.pie.length > MAX_PIE) {
    reparos.push({
      campo: "pie",
      problema: `El pie tiene ${p.pie.length} caracteres y el máximo es ${MAX_PIE}.`,
      arreglo: `Sacá ${p.pie.length - MAX_PIE}.`,
    });
  }

  return reparos;
}
