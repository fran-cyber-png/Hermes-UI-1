import { clavePersona } from "./roles.js";

/**
 * ¿ESTE `equipo.nombre` ES UN NOMBRE DE VERDAD, O ES EL USERNAME OTRA VEZ?
 *
 * ══ POR QUÉ HACE FALTA PREGUNTARLO ═══════════════════════════════════════════
 *
 * `equipo.nombre` es `NOT NULL`, así que la siembra tuvo que poner algo para
 * cada persona — y para las cuentas cuyo username ES el correo puso el correo
 * (`equipo/semilla.ts`: `nombre: \`ventas${n}@grupogoberna.com\``). O sea que la
 * columna tiene dos clases de valor mezcladas: nombres de humanos («Cielo
 * Huambo») y relleno («ventas13@grupogoberna.com»).
 *
 * Servir el relleno como si fuera un nombre es PEOR que no servir nada: hoy el
 * selector muestra «Ventas13» —feo pero corto y estable— y pasaría a mostrar el
 * correo entero, que no entra en 224 px y se corta en «ventas13@grupogob…».
 *
 * ══ 🔴 LA REGLA VIVE ACÁ Y SOLO ACÁ, Y POR ESO EL SERVER NO SIRVE EL RELLENO ══
 *
 * La alternativa era mandarlo todo y que el navegador decidiera. No: sería la
 * misma pregunta contestada en dos lados (#37), y la copia del front se
 * respondería con una comparación de cadenas contra un id que ya viajó
 * normalizado — la receta de `clavePersona` vive en el server. Acá se filtra, y
 * el front recibe **solo nombres que se pueden mostrar**; lo que no está, cae a
 * su `nombreCorto()` de siempre, que es exactamente lo que se ve hoy.
 *
 * Corolario: **no hay estado intermedio que dibujar.** «Sin nombre» y «el nombre
 * es el username» se ven igual en la pantalla, que es la verdad — de las dos
 * cosas Hermes sabe lo mismo: nada.
 */
export function esNombreDeVerdad(personaId: string, nombre: string | null | undefined): boolean {
  const limpio = (nombre ?? "").trim();
  if (!limpio) return false;
  // Se compara con la MISMA receta con la que se guarda el id (`lower(btrim)`),
  // no con `===`: la fila de `Tracy` guarda `nombre = 'Tracy'` sobre
  // `persona_id = 'tracy'`, y con comparación exacta pasaría por nombre propio.
  // No rompe nada visible —`nombreCorto('tracy')` da lo mismo— pero dejaría la
  // regla diciendo «esto es un nombre» sobre algo que nadie escribió como tal.
  return clavePersona(limpio) !== clavePersona(personaId);
}
