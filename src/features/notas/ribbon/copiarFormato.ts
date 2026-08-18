/**
 * COPIAR FORMATO — el pincel de Word, construido sobre la API que ya usamos.
 *
 * ══ ES CAPACIDAD NUEVA, Y HAY QUE DECIRLO ══════════════════════════════════
 *
 * `docs/barra-de-formato-libreta.md` lo dejó afuera diciendo «no existe en
 * BlockNote», y es cierto que el paquete no lo trae. Lo que sí trae es todo lo
 * que hace falta: `getActiveStyles()` para mirar con qué se está escribiendo y
 * `addStyles()`/`removeStyles()` para escribir. Lo que falta es la decisión, y
 * la decisión es esto: **puro, sin editor, testeable**.
 *
 * ══ 🔴 APLICAR NO ES «PONER LO COPIADO»: ES TAMBIÉN SACAR LO QUE SOBRA ══════
 *
 * El caso que lo obliga: se copia el formato de un texto normal y se suelta
 * sobre uno en negrita. Si sólo se pone lo copiado, la negrita se queda y el
 * resultado no se parece al origen — o sea que el pincel no copió el formato,
 * copió una parte. Por eso se calculan las dos mitades.
 *
 * ⚠️ **Y `removeStyles` recibe QUÉ sacar, no «sacá todo»** (sin argumento ni
 * compila). Lo que se le pasa sale de mirar lo que está activo AHORA, nunca de
 * una lista escrita a mano: con una lista, el día que el esquema gane un estilo
 * nuevo el pincel lo dejaría puesto y nadie se enteraría — el mismo argumento
 * por el que «Limpiar formato» usa `getActiveStyles()`.
 *
 * ⚠️ **Se copian ESTILOS, no el tipo de bloque.** Un párrafo no se convierte en
 * título por soltarle el pincel encima: para eso está la galería de Estilos, y
 * mezclarlo haría que soltar el pincel sobre una lista la desarme.
 */

/** La forma cruda de `getActiveStyles()`: nombre del estilo → su valor. */
export type Estilos = Record<string, unknown>;

/**
 * Lo que hay que hacerle a la selección de destino para que quede igual que el
 * origen. Las dos mitades por separado porque son dos llamadas distintas del
 * editor, y porque así se pueden mirar en un test sin montar nada.
 */
export interface CambioDeFormato {
  /** Estilos a sacar: están puestos en el destino y no en lo copiado. */
  aQuitar: Estilos;
  /** Estilos a poner: es lo copiado, tal cual. */
  aPoner: Estilos;
}

export function cambioDeFormato(copiado: Estilos, enElDestino: Estilos): CambioDeFormato {
  const aQuitar: Estilos = {};
  for (const [estilo, valor] of Object.entries(enElDestino)) {
    if (!(estilo in copiado)) aQuitar[estilo] = valor;
  }
  return { aQuitar, aPoner: { ...copiado } };
}

/**
 * ¿Hay algo que copiar? Un cursor sobre texto sin ningún formato devuelve `{}`,
 * y ese objeto vacío **sí es un formato válido**: significa «texto normal», y
 * soltarlo sobre una negrita tiene que limpiarla.
 *
 * O sea que `{}` no se puede usar como «no copié nada». El estado de «no hay
 * nada armado» es `null`, y por eso el tipo lo dice.
 */
export type FormatoEnElPincel = Estilos | null;
