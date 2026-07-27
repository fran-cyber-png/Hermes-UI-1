import type { Campana } from './campana.js';

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
 * ── Por qué NINGUNA dice que es automática (cambió el 27-jul, #166) ──
 * Hasta ADR 0015 las cuatro empezaban con «Te escribe un mensaje automático».
 * Era una decisión de diseño con su argumento: quien cree hablar con una
 * persona a las 3 a. m. y descubre que no, se siente engañado. **El dueño la
 * revirtió el 27-jul: el lead todavía no puede saber que hay un automatismo
 * detrás.** El argumento viejo no era falso, pero perdió contra el comercial, y
 * lo que queda escrito acá es la decisión vigente, no la que se prefiere.
 *
 * Lo que la reemplaza NO es un disfraz, y la diferencia es lo único que hace
 * defendible el cambio: el mensaje deja de HABLAR de sí mismo, no empieza a
 * mentir. Sigue sin fingir una conversación —no pregunta de vuelta, no
 * improvisa, no dice «te escribo yo»—, sigue siendo un acuse de recibo, y por
 * eso las frases que quedan son las tres que podemos sostener siempre:
 * **estamos fuera del horario**, **atendemos desde tal hora**, **tu mensaje
 * quedó registrado**. Lo que se fue con la mención al automatismo es también la
 * promesa que no controlábamos («una asesora te responde personalmente»): a
 * quien no le respondan igual, la plantilla le habría mentido dos veces.
 *
 * El guardarraíl es `plantillas.test.ts`: ninguna puede volver a nombrar la
 * máquina (ni «automático», ni «bot», ni «sistema»), y ninguna puede prometer
 * una respuesta personal a una hora fija.
 *
 * ── Por campaña, no una sola para todos (ADR 0016) ──
 * «Si vino de "[JUL] INTELIGENCIA", responde lo de Inteligencia» (dueño,
 * 2026-07-25). Lo que cambia por campaña NO es una plantilla entera por curso —
 * eso serían 38 textos que nadie mantiene— sino **una frase**: el `gancho` de la
 * familia (`campana.ts`), que dice qué manda la asesora al abrir. El resto del
 * mensaje es el mismo. Agregar un curso es agregar una entrada en `FAMILIAS`,
 * no escribir una plantilla.
 *
 * ── El punto de integración con las plantillas-secuencia (#138, YA en `main`) ──
 * `server/src/plantillas/` existe y es el hogar del contenido que manda la
 * vendedora: secuencias de pasos con media, precio en vivo desde Cerberus,
 * familia por prefijo de SKU. **Este archivo NO duplica ese modelo, y tampoco lo
 * consume todavía**, por tres diferencias que son de producto, no de código, y
 * que las tiene que cerrar el dueño:
 *
 *   1. **Una secuencia son N mensajes; un acuse es UNO.** ADR 0015 permite «un
 *      acuse», no cuatro mensajes con flyer a las 3 de la mañana. Mandar solo el
 *      paso 1 de una secuencia de cuatro es cambiarle el sentido a la plantilla.
 *   2. **Son POR VENDEDORA** (`plantillas.vendedora_id`) y la auto-respuesta no
 *      tiene vendedora: habría que elegir de quién, y esa es una decisión de
 *      negocio.
 *   3. **Su `{precio}` se resuelve en vivo contra Cerberus.** Un acuse fuera de
 *      horario que cotiza sin que nadie lo mire es otra feature, con otro riesgo.
 *
 * **La costura, cuando se decida**: `catalogo()` pasa a leer de
 * `plantillas/repositorio.ts` las marcadas como aptas —conservando la firma
 * (`Plantilla[]`) y el contrato de `elegir()`— y las familias de `campana.ts` se
 * mapean a `plantillas.familia_curso`. Nada más cambia: ni la decisión, ni la
 * cola, ni el despachador. Lo mismo vale para #45.
 *
 * Hasta entonces, las de este archivo son el mínimo honesto, escritas a partir
 * de las que la vendedora ya usa (flyer 671x, seguimiento 658x, temario 261x —
 * medido en 14 días, issue #125).
 *
 * ── UNA SOLA CABEZA, dos horarios (unión con #101) ──
 * «Dónde está esta conversación» ya no se decide acá: el vocabulario
 * (`ContextoPlantilla`) y el clasificador (`momentoDeVenta`) viven en
 * `sugerencias/estado.ts`, y son los MISMOS que usa el panel derecho para
 * sugerirle a la vendedora qué mandar de día. Antes había dos definiciones
 * gemelas —una acá, otra allá— y ese es exactamente el arreglo del que nadie se
 * entera hasta que divergen: la vendedora vería sugerida una cosa y el sistema
 * mandaría otra a las 3 a. m., sin que nadie pueda explicar por qué.
 *
 * Lo que sigue siendo propio de este archivo es lo que debe serlo: QUÉ SE DICE.
 * El día vende; la noche acusa recibo. Mismo diagnóstico, distinta respuesta.
 */
import {
  estadoDesdeContexto,
  momentoDeVenta,
  type ContextoPlantilla as ContextoBase,
} from '../sugerencias/estado.js';

/**
 * El contexto con el que se decide de noche.
 *
 * Los dos campos que COMPARTE con el día —`esPrimerContacto` y `curso`— se
 * definen una sola vez, en `sugerencias/estado.ts`: son el vocabulario del
 * clasificador que usan los dos horarios. Acá se le suma lo que es propio de la
 * noche y que el panel no necesita: la **campaña** de la que vino (ADR 0016),
 * que decide qué gancho lleva el acuse.
 *
 * Extender en vez de redeclarar es lo que impide que las dos definiciones
 * gemelas vuelvan a separarse — el arreglo del que nadie se entera hasta que
 * la vendedora ve sugerida una cosa y el sistema manda otra a las 3 a. m.
 */
export interface ContextoPlantilla extends ContextoBase {
  /** La campaña de la que vino, con su familia reconocida (`campana.ts`). */
  campana?: Campana | null;
}

export interface DatosPlantilla {
  /** «Hola Ana» o «Hola» a secas: WhatsApp no siempre da el nombre. */
  saludo: string;
  /** El curso que la persona ya dijo que le interesa. Puede no haber. */
  curso: string | null;
  /** A qué hora abre la atención humana, en criollo: «9:00 a. m.». */
  horaApertura: string;
  /** Lo que la asesora manda al abrir, propio de esa familia de cursos. */
  gancho?: string | null;
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
 * curso quiere, se lo nombramos; si no, el MOMENTO DE VENTA compartido
 * (`momentoDeVenta`) distingue primer contacto de conversación en curso — el
 * mismo que de día decide si el panel sugiere el flyer o un seguimiento.
 */
export function catalogo(): Plantilla[] {
  return [
    {
      id: 'fuera-de-horario-campana',
      titulo: 'Fuera de horario — por la campaña de la que vino',
      cuerpo:
        '{{saludo}}, gracias por escribirnos a la Escuela de Goberna. ' +
        'En este momento estamos fuera del horario de atención; atendemos desde las {{hora_apertura}}. ' +
        'Vemos que te interesa {{curso}}: al abrir, una asesora {{gancho}}. ' +
        'Si deseas, déjanos aquí tu consulta y ya la tenemos a mano.',
      // Solo cuando RECONOZCO la familia: sin `gancho` esta plantilla no
      // renderiza, y una respuesta «de campaña» sobre una campaña que no
      // entiendo sería exactamente el invento que esta feature no hace.
      aplica: (ctx) => Boolean(ctx.campana?.familia),
    },
    {
      id: 'fuera-de-horario-interes',
      titulo: 'Fuera de horario — ya sabemos qué curso le interesa',
      cuerpo:
        '{{saludo}}, gracias por escribirnos a la Escuela de Goberna. ' +
        'En este momento estamos fuera del horario de atención; atendemos desde las {{hora_apertura}}. ' +
        'Tenemos anotado tu interés en {{curso}}: al abrir, una asesora retoma tu consulta ' +
        'con el temario, las fechas y el costo. ' +
        'Si deseas, déjanos aquí lo que necesites saber y ya lo tenemos a mano.',
      aplica: (ctx) => Boolean(ctx.curso),
    },
    {
      id: 'fuera-de-horario-primer-contacto',
      titulo: 'Fuera de horario — primer contacto',
      cuerpo:
        '{{saludo}}, gracias por escribirnos a la Escuela de Goberna. ' +
        'En este momento estamos fuera del horario de atención; atendemos desde las {{hora_apertura}}. ' +
        'Cuéntanos qué curso o diplomado te interesa y al abrir te enviamos el temario completo.',
      aplica: (ctx) => momentoDeVenta(estadoDesdeContexto(ctx)) === 'primer-contacto',
    },
    {
      id: 'fuera-de-horario-seguimiento',
      titulo: 'Fuera de horario — ya veníamos hablando',
      cuerpo:
        '{{saludo}}, gracias por escribirnos. ' +
        'En este momento estamos fuera del horario de atención; atendemos desde las {{hora_apertura}}. ' +
        'Tu mensaje ya quedó registrado y lo retomamos apenas abrimos.',
      // El catch-all queda explícito: cualquier momento que no sea primer
      // contacto es «ya veníamos hablando». Si mañana aparece un momento nuevo,
      // cae acá — que es el acuse más neutro, no el más específico.
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
  const valores: Record<string, string | null | undefined> = {
    saludo: datos.saludo,
    curso: datos.curso,
    hora_apertura: datos.horaApertura,
    gancho: datos.gancho,
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
