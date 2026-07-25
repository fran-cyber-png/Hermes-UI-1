/**
 * LAS SECCIONES DEL PANEL DERECHO — pura, para poder discutirla con un test.
 *
 * El panel mide ~360 px en una app de escritorio. Con ese ancho, un acordeón
 * obliga a scrollear para llegar a lo de abajo y a plegar lo de arriba para ver
 * lo de abajo; una barra de pestañas cuesta una fila de 28 px y deja el resto
 * del alto entero para el contenido. Cuatro secciones entran en una fila con
 * ícono + rótulo corto.
 *
 * Lo que NO va en pestañas: la identidad de la persona, sus etiquetas y las dos
 * respuestas sugeridas. Eso se ve SIEMPRE, sin elegir nada — es lo que la
 * vendedora mira en el primer segundo y lo que aprieta en el segundo.
 */

export type IdPestana = "ficha" | "plantillas" | "notas" | "curso";

export interface Pestana {
  id: IdPestana;
  etiqueta: string;
  /** `false` = se muestra apagada con su motivo, nunca se esconde en silencio. */
  disponible: boolean;
  motivo?: string;
}

export interface ContextoPanel {
  canal: "whatsapp" | "facebook" | "instagram";
  /** Hay un teléfono con el que buscar la ficha en Cerberus. */
  conTelefono: boolean;
}

/**
 * Las cuatro, siempre en el mismo orden. Una pestaña que aparece y desaparece
 * según el canal obliga a re-aprender la pantalla en cada conversación: mejor
 * apagada, con el motivo a la vista.
 */
export function pestanasDe(ctx: ContextoPanel): Pestana[] {
  const esWa = ctx.canal === "whatsapp";
  return [
    { id: "ficha", etiqueta: "Ficha", disponible: true },
    {
      id: "plantillas",
      etiqueta: "Enviar",
      disponible: esWa,
      motivo: esWa ? undefined : "Las secuencias se mandan por WhatsApp",
    },
    { id: "notas", etiqueta: "Notas", disponible: true },
    { id: "curso", etiqueta: "Curso", disponible: true },
  ];
}

/**
 * Qué pestaña se abre. Se respeta la última que la vendedora eligió mientras
 * siga disponible —cambiar de conversación no debería reordenarle la cabeza—;
 * si no, la primera disponible.
 */
export function pestanaInicial(pestanas: Pestana[], preferida: IdPestana | null): IdPestana {
  const elegida = pestanas.find((p) => p.id === preferida && p.disponible);
  if (elegida) return elegida.id;
  return pestanas.find((p) => p.disponible)!.id;
}
