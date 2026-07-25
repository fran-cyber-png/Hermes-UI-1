/**
 * LO QUE SE DICE — un catálogo cerrado de plantillas. La auto-respuesta ELIGE
 * entre estos textos; no genera ni una palabra propia.
 *
 * ── Por qué un catálogo y no un modelo ──
 * Un texto generado no se puede revisar antes de que salga, no se puede
 * versionar y no se puede auditar («¿quién dijo eso?»). Acá lo que sale está
 * escrito de antemano, se lee entero en una pantalla, y lo que se guardó en la
 * cola es EXACTAMENTE lo que se mandó.
 *
 * ── Por qué todas dicen que son automáticas ──
 * Decisión de diseño, no un adorno: el mensaje avisa que es automático y que
 * una persona responde al abrir. Un cliente que cree estar hablando con una
 * persona a las 3 a. m. y descubre que no, se siente engañado; uno que sabe que
 * recibió un acuse fuera de horario, no. Además es lo que hace innecesario
 * cualquier disfraz: si el mensaje no finge ser humano, no hay nada que
 * disimular.
 *
 * ── El punto de integración con #45 ──
 * Los mensajes predeterminados de la vendedora (issue #45: «insertar con / en el
 * composer») todavía no están en `main`. Cuando lleguen, ESTE archivo es el
 * lugar: `catalogo()` pasa a leer las plantillas marcadas como «apta para
 * auto-respuesta» de esa tabla, conservando la firma (`Plantilla[]`) y el
 * contrato de `elegir()`. Nada más cambia — ni la decisión, ni la cola, ni el
 * despachador. Hasta entonces, las tres de acá son el mínimo honesto, escritas
 * a partir de las que la vendedora ya usa (flyer 671x, seguimiento 658x,
 * temario 261x — medido en 14 días, issue #125).
 */

export interface DatosPlantilla {
  /** «Hola Ana» o «Hola» a secas: WhatsApp no siempre da el nombre. */
  saludo: string;
  /** El curso que la persona ya dijo que le interesa. Puede no haber. */
  curso: string | null;
  /** A qué hora abre la atención humana, en criollo: «9:00 a. m.». */
  horaApertura: string;
}

export interface ContextoPlantilla {
  /** Primer mensaje de esta persona: nadie le habló nunca desde Hermes. */
  esPrimerContacto: boolean;
  /** El curso registrado como interés, si lo hay. */
  curso: string | null;
}

export interface Plantilla {
  id: string;
  /** Para la pantalla de simulacro: qué es esto en una línea. */
  titulo: string;
  /** El texto con marcadores `{{...}}`. Sin emojis (regla dura #4 de la casa). */
  cuerpo: string;
  /** Cuándo aplica. La primera que aplica, gana (el orden del catálogo manda). */
  aplica: (ctx: ContextoPlantilla) => boolean;
}

/**
 * El catálogo, en orden de prioridad. La más específica primero: si sabemos qué
 * curso quiere, se lo nombramos; si no, distinguimos primer contacto de
 * seguimiento.
 */
export function catalogo(): Plantilla[] {
  return [
    {
      id: 'fuera-de-horario-interes',
      titulo: 'Fuera de horario — ya sabemos qué curso le interesa',
      cuerpo:
        '{{saludo}}, gracias por escribirnos a la Escuela de Goberna. ' +
        'Te escribe un mensaje automático: en este momento estamos fuera del horario de atención. ' +
        'Tenemos anotado tu interés en {{curso}} y una asesora te responde personalmente ' +
        'a partir de las {{hora_apertura}} con el temario, las fechas y el costo. ' +
        'Si deseas, déjanos aquí tu consulta y ya la tenemos a mano al abrir.',
      aplica: (ctx) => Boolean(ctx.curso),
    },
    {
      id: 'fuera-de-horario-primer-contacto',
      titulo: 'Fuera de horario — primer contacto',
      cuerpo:
        '{{saludo}}, gracias por escribirnos a la Escuela de Goberna. ' +
        'Te escribe un mensaje automático: en este momento estamos fuera del horario de atención. ' +
        'Una asesora te responde personalmente a partir de las {{hora_apertura}}. ' +
        'Cuéntanos qué curso o diplomado te interesa y al abrir te enviamos el temario completo.',
      aplica: (ctx) => ctx.esPrimerContacto,
    },
    {
      id: 'fuera-de-horario-seguimiento',
      titulo: 'Fuera de horario — ya veníamos hablando',
      cuerpo:
        '{{saludo}}, gracias por escribirnos. ' +
        'Te escribe un mensaje automático: en este momento estamos fuera del horario de atención. ' +
        'Tu consulta ya quedó registrada y la asesora que te viene atendiendo te responde ' +
        'a partir de las {{hora_apertura}}.',
      aplica: () => true,
    },
  ];
}

/** La plantilla aplicable, o null si ninguna lo es (entonces no se responde). */
export function elegir(ctx: ContextoPlantilla, plantillas: Plantilla[] = catalogo()): Plantilla | null {
  return plantillas.find((p) => p.aplica(ctx)) ?? null;
}

const MARCADOR = /\{\{\s*([a-z_]+)\s*\}\}/g;

/**
 * Rellena los marcadores. FAIL-CLOSED: si queda uno sin valor, lanza — antes
 * mandar nada que mandarle «{{curso}}» a un cliente.
 */
export function render(cuerpo: string, datos: DatosPlantilla): string {
  const valores: Record<string, string | null> = {
    saludo: datos.saludo,
    curso: datos.curso,
    hora_apertura: datos.horaApertura,
  };

  return cuerpo.replace(MARCADOR, (_todo, clave: string) => {
    const valor = valores[clave];
    if (valor == null || valor === '') {
      throw new Error(`la plantilla pide «${clave}» y no hay valor: no se manda nada`);
    }
    return valor;
  });
}

/** «Hola Ana» / «Hola». El nombre de WhatsApp puede ser basura: se limpia. */
export function saludoDe(personaNombre: string | null | undefined): string {
  const nombre = (personaNombre ?? '').trim().split(/\s+/)[0] ?? '';
  // Un «nombre» que es un número (el teléfono, cuando el contacto no está
  // guardado) no se saluda por nombre: quedaría «Hola 51987654321».
  const usable = nombre.length >= 2 && nombre.length <= 20 && !/\d/.test(nombre);
  return usable ? `Hola ${nombre}` : 'Hola';
}

/**
 * `09:00` → `9:00 de la mañana` — cómo lo diría una persona, no un reloj de
 * 24 h. Sin punto final a propósito: si devolviera «9:00 a. m.» y la plantilla
 * cierra la frase, al cliente le llega «a partir de las 9:00 a. m..».
 */
export function horaEnCriollo(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const momento = h < 12 ? 'de la mañana' : h < 19 ? 'de la tarde' : 'de la noche';
  const hora12 = h % 12 === 0 ? 12 : h % 12;
  return `${hora12}:${String(m).padStart(2, '0')} ${momento}`;
}
