import type { EnviosDeUnaPlantilla, EnviosPorPlantilla, Medicion } from './plantillas';

/**
 * CÓMO SE LEE «CUÁNTO SE MANDÓ ESTA PLANTILLA».
 *
 * Puro y aparte del JSX por el mismo motivo que `ivi/presentacion.ts`: un
 * `switch` adentro de un componente no se puede interrogar sobre el caso que
 * todavía no pasó — y acá los casos que importan son justamente los raros (0
 * envíos, 0 respuestas, muestra chica, dos versiones del texto).
 *
 * ⚠️ **Acá no se decide nada, sólo se redacta.** Los números —el intervalo de
 * Wilson, si la muestra alcanza— los calcula el server (`resultados/medicion.ts`)
 * y viajan hechos. Recalcularlos en el navegador sería la segunda cabeza de
 * siempre (#37), y la que se equivocaría es la que no tiene los tests.
 */

/**
 * 🔴 QUÉ DIBUJAR — y la rama que importa es la primera.
 *
 * Los tres casos se ven parecidos en pantalla y significan cosas opuestas:
 *
 *   · **no se pudo contar** (cargando, 502, 403) → NADA. Un «0 envíos» acá
 *     invita a mandar de nuevo una campaña que ya salió a mil personas.
 *   · **no está en la respuesta** → se mandó 0 veces. Es un cero de VERDAD, y
 *     sólo se puede afirmar porque el server contestó.
 *   · **está** → los números.
 *
 * Vive acá y no adentro del componente porque es exactamente la clase de regla
 * que un test tiene que poder interrogar sobre el caso que todavía no pasó: el
 * defecto no sería visible en una captura, porque una captura se saca cuando el
 * server anda.
 */
export type QueDibujar =
  | { tipo: 'nada' }
  | { tipo: 'nunca' }
  | { tipo: 'datos'; e: EnviosDeUnaPlantilla };

export function queDibujar(data: EnviosPorPlantilla | undefined, nombre: string): QueDibujar {
  if (!data) return { tipo: 'nada' };
  const e = data.plantillas.find((x) => x.plantilla === nombre);
  return e ? { tipo: 'datos', e } : { tipo: 'nunca' };
}

/** «1.004» — el separador de miles importa cuando el número decide una campaña. */
export function numero(n: number): string {
  return n.toLocaleString('es-PE');
}

/**
 * EL PORCENTAJE, Y NUNCA UN «0 %» QUE NO LO ES.
 *
 * 4 de 1.000 redondea a 0 %, y «0 %» se lee como «no contestó nadie» — que es
 * falso y encima es la diferencia entre tirar la plantilla y repetirla. Debajo
 * del 1 % se dice `<1 %`.
 */
export function porcentaje(m: Medicion): string {
  if (m.tasa === null) return '—';
  const pct = m.tasa * 100;
  if (m.exitos > 0 && pct < 1) return '<1%';
  return `${Math.round(pct)}%`;
}

/** «26 de 1.000 (3%)». La proporción NUNCA viaja sin su muestra. */
export function conMuestra(m: Medicion): string {
  if (m.n === 0) return 'sin envíos que medir';
  return `${numero(m.exitos)} de ${numero(m.n)} (${porcentaje(m)})`;
}

/**
 * EL RANGO DE DÍAS. Un solo día no se escribe como un rango.
 *
 * Se arma con `toLocaleDateString` y no a mano: el mes en castellano corto
 * («5 ago») ya lo sabe decir el navegador.
 */
export function rango(primerUso: string, ultimoUso: string): string {
  const a = new Date(primerUso);
  const b = new Date(ultimoUso);
  const dia = (d: Date) => d.toLocaleDateString('es-PE', { day: 'numeric', month: 'short' });
  const mismoDia = a.toDateString() === b.toDateString();
  return mismoDia ? dia(a) : `${dia(a)} – ${dia(b)}`;
}

/**
 * LA PRIMERA LÍNEA: cuánto salió, cuándo, y qué no salió.
 *
 * `noSalieron` va SIEMPRE que exista y nunca sumado al total: son mensajes que
 * nadie recibió, y meterlos adentro de «1.004 envíos» convertiría un fracaso de
 * entrega en alcance.
 */
export function resumen(e: EnviosDeUnaPlantilla): string {
  const partes = [`${numero(e.salieron)} ${e.salieron === 1 ? 'envío' : 'envíos'}`];
  partes.push(rango(e.primerUso, e.ultimoUso));
  if (e.noSalieron > 0) partes.push(`${numero(e.noSalieron)} no salieron`);
  return partes.join(' · ');
}

/**
 * 🔴 «SALIERON» Y «SE PUEDEN MEDIR» SON DOS NÚMEROS, y cuando difieren hay que
 * decirlo.
 *
 * Medido en producción: los 89 envíos de `promo_3x1_cursos` salieron con
 * `referencia = 'campana:…'` en vez de una clave de conversación, así que de
 * ninguno se puede saber si contestó. Sin esta línea, la tarjeta mostraría
 * «88 envíos» arriba y «contestaron 0 de 0» abajo, y las dos cosas juntas se
 * leen como «no contestó nadie» — que es una conclusión, no un dato.
 *
 * `null` cuando los dos números coinciden: no hay nada que aclarar.
 */
export function salvedad(e: EnviosDeUnaPlantilla): string | null {
  if (e.salieron === 0 || e.medibles === e.salieron) return null;
  if (e.medibles === 0) {
    return 'estos envíos no quedaron atados a una conversación, así que no hay dónde mirar la respuesta';
  }
  return `se pudo mirar la respuesta de ${numero(e.medibles)} de los ${numero(e.salieron)}`;
}

/**
 * LA SEGUNDA: cuántos contestaron.
 *
 * ⚠️ **El nombre no promete causa** — es la misma regla que `resultados/
 * medicion.ts` fija con un test: se dice «contestaron después», nunca
 * «efectividad» ni «funcionó». Que alguien conteste después de un mensaje no
 * prueba que haya contestado POR el mensaje.
 */
export function respuestas(e: EnviosDeUnaPlantilla): string {
  if (e.salieron === 0) return 'no salió ninguno, así que no hay nada que medir';
  // 0 medibles NO se dibuja como «0 de 0»: eso se lee como que no contestó
  // nadie, y lo que pasa es que no se puede saber. La salvedad explica por qué.
  if (e.medibles === 0) return 'no se puede saber si contestaron';
  const cola = e.medianaMinutosHastaLaRespuesta !== null
    ? ` · la mitad contestó en menos de ${demora(e.medianaMinutosHastaLaRespuesta)}`
    : '';
  return `contestaron después: ${conMuestra(e.respondieron)}${cola}`;
}

/** «8 min» · «2 h» · «3 días» — la unidad se elige por el tamaño, no por gusto. */
export function demora(minutos: number): string {
  if (minutos < 60) return `${Math.round(minutos)} min`;
  if (minutos < 60 * 24) return `${Math.round(minutos / 60)} h`;
  const dias = Math.round(minutos / (60 * 24));
  return `${dias} ${dias === 1 ? 'día' : 'días'}`;
}

/**
 * ¿HAY QUE AVISAR QUE EL NÚMERO NO ALCANZA PARA DECIDIR?
 *
 * `muestraSuficiente` lo calcula el server con `MUESTRA_MINIMA`. Acá sólo se
 * pregunta si conviene decirlo: con 0 envíos no hay nada que advertir, porque
 * ya se dijo que no salió ninguno.
 */
export function avisarMuestraChica(e: EnviosDeUnaPlantilla): boolean {
  return e.medibles > 0 && !e.respondieron.muestraSuficiente;
}

/**
 * LA COMPARACIÓN CON LA LÍNEA DE BASE.
 *
 * Un 3 % solo no significa nada: la pregunta que se hace quien mira es «¿esto
 * anduvo?», y la única referencia honesta es lo que la misma gente logra
 * escribiendo a mano en el mismo período (ADR 0022: `null` no es un hueco, es
 * contra lo que se compara todo).
 *
 * ⚠️ **No se dice cuál gana.** Esa afirmación necesita que los intervalos no se
 * toquen (`leGanaClaramente`, en el server) y acá no hay con qué verificarla:
 * se ponen los dos números al lado y la persona lee. Un «esta plantilla es
 * mejor» calculado de a ojo en el navegador es exactamente el tipo de
 * conclusión que el módulo de medición existe para no dejar sacar.
 */
export function comparacion(base: { envios: number; respondieron: Medicion } | null): string | null {
  if (!base || base.envios === 0) return null;
  return `escrito a mano, en el mismo período: ${conMuestra(base.respondieron)}`;
}
