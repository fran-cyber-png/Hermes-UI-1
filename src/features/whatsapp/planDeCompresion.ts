/**
 * CUÁNTO HAY QUE APRETAR UN VIDEO PARA QUE ENTRE — la aritmética, sin motor.
 *
 * ── Por qué esto existe aparte de ffmpeg ──────────────────────────────────
 * Comprimir tiene dos mitades: DECIDIR con qué parámetros, y EJECUTAR. La
 * segunda pesa 30 MB de wasm y tarda un minuto; la primera es una división y
 * decide si el resultado se ve bien o se ve como un fax. Mezclarlas dejaría la
 * parte que importa sin poder testear — habría que correr un encoder de verdad
 * para preguntar «¿y si el video dura dos horas?».
 *
 * ── El dato que ordena todo (medido el 5-ago-2026 sobre el video real) ────
 * El video que rebotó —promo del I Foro de Estado, 1080×1920, 2:13— pesaba
 * 17,9 MB con 1.128 kbps y el tope es 16 MB. **Le sobraba un 11 %.** Ya venía
 * en H.264 + AAC, que es justo lo que la Cloud API exige.
 *
 * De ahí sale la regla de esta casa: **primero se baja el BITRATE, la
 * resolución se toca solo cuando el bitrate ya no alcanza**. El reflejo obvio
 * era mandarlo a 720p, y habría sido peor gratis: a 820 kbps en 1080p el
 * resultado quedó indistinguible del original en una comparación cuadro a
 * cuadro, y bajar a 720p habría tirado la mitad de los píxeles para ahorrar un
 * 11 % que el bitrate solo ya daba.
 */

/** Lo que la Cloud API exige y lo que igual hay que producir. */
export const CODEC_VIDEO = 'h264';
export const CODEC_AUDIO = 'aac';

/**
 * El encoder no clava el bitrate pedido y el contenedor suma overhead, así que
 * se apunta por debajo del tope. 8 % salió de la medición: pidiendo 820 kbps
 * sobre un tope de 16 MB el archivo cayó en 13,6 MB — el margen sobró, pero un
 * archivo que vuelve a rebotar después de un minuto de espera es mucho peor que
 * uno un 8 % más chico.
 */
export const MARGEN = 0.92;

/** Audio: 96 kbps AAC es transparente para voz y música de fondo. */
export const AUDIO_KBPS = 96;
/** Cuando el presupuesto aprieta, el audio cede antes que la imagen — pero no por debajo de esto. */
export const AUDIO_KBPS_MINIMO = 64;

/**
 * Debajo de esto, cada resolución se ve mal — bloques en el movimiento y texto
 * ilegible, que en un flyer de Goberna es justo lo que hay que leer. Cuando el
 * presupuesto no llega, se BAJA la resolución en vez de seguir apretando.
 */
export const KBPS_MINIMO_POR_ALTURA: { altura: number; kbps: number }[] = [
  { altura: 1080, kbps: 700 },
  { altura: 720, kbps: 400 },
  { altura: 480, kbps: 250 },
];

/** El piso: por debajo de 480p un video de venta ya no sirve para mostrar nada. */
export const ALTURA_MINIMA = 480;

/**
 * Cuánto tarda el encode, en múltiplos de la duración del video.
 *
 * **Medido**: 199 s para un video de 133 s (1,5x) con ffmpeg.wasm
 * single-thread en una Mac con chip M. Se usa **2x** y no 1,5 porque las
 * laptops de las vendedoras son más lentas que la máquina donde se midió, y
 * porque una espera que se pasa de lo prometido se siente peor que una que
 * termina antes. Decirlo importa: tres minutos sin aviso se leen como colgada,
 * y tres minutos anunciados son una decisión que la persona puede tomar.
 */
export const RATIO_ENCODE = 2;

export interface EntradaVideo {
  bytes: number;
  /** Segundos. Sale del `<video>` (`loadedmetadata`), sin tocar ffmpeg. */
  duracionSeg: number;
  /** El lado más corto en píxeles — un vertical de 1080×1920 es «1080». */
  ladoCorto: number;
}

export type Plan =
  /** Ya entra: no se toca. Reencodear un archivo que entra solo lo empeora. */
  | { tipo: 'entra_como_esta' }
  /** Hay que apretar, y así. */
  | {
      tipo: 'comprimir';
      videoKbps: number;
      audioKbps: number;
      /** El lado corto de salida. Igual a la entrada si no hizo falta bajar. */
      ladoCorto: number;
      /** Cuánto va a pesar, aproximado — para decirlo ANTES de esperar un minuto. */
      bytesEstimados: number;
      /** `true` si además de bitrate hubo que resignar píxeles. Se dice en pantalla. */
      bajaResolucion: boolean;
      /** Cuánto va a tardar, aproximado — para decirlo ANTES de que empiece. */
      segundosEstimados: number;
    }
  /** No hay parámetros que lo hagan entrar sin destruirlo. Se dice por qué. */
  | { tipo: 'imposible'; motivo: string };

/** El bitrate total (kbps) que cabe en `bytes` durante `duracionSeg`. */
export function kbpsQueEntran(bytes: number, duracionSeg: number): number {
  if (duracionSeg <= 0) return 0;
  return (bytes * 8) / duracionSeg / 1000;
}

/** El peso (bytes) de `kbps` durante `duracionSeg`. */
export function bytesDe(kbps: number, duracionSeg: number): number {
  return Math.round((kbps * 1000 * duracionSeg) / 8);
}

/** El mínimo aceptable para una altura dada; por debajo de 480p, el del 480p. */
export function kbpsMinimoPara(ladoCorto: number): number {
  for (const p of KBPS_MINIMO_POR_ALTURA) {
    if (ladoCorto >= p.altura) return p.kbps;
  }
  return KBPS_MINIMO_POR_ALTURA[KBPS_MINIMO_POR_ALTURA.length - 1].kbps;
}

/** Las resoluciones a las que se puede bajar desde `ladoCorto`, de mayor a menor. */
function escalones(ladoCorto: number): number[] {
  return KBPS_MINIMO_POR_ALTURA.map((p) => p.altura).filter((a) => a < ladoCorto && a >= ALTURA_MINIMA);
}

/**
 * QUÉ HACER CON ESTE VIDEO PARA QUE ENTRE EN `topeBytes`.
 *
 * El orden es el que importa: bitrate primero, resolución después, y «no se
 * puede» antes que devolver un plan que produzca algo ilegible. Un video que
 * sale a 200 kbps en 1080p entra —y es basura—: haberlo mandado igual es peor
 * que decir que no, porque lo que llega del otro lado lo ve un lead.
 */
export function planDeCompresion(video: EntradaVideo, topeBytes: number): Plan {
  if (video.bytes <= topeBytes) return { tipo: 'entra_como_esta' };

  if (!Number.isFinite(video.duracionSeg) || video.duracionSeg <= 0) {
    // Sin duración no hay aritmética posible: cualquier bitrate sería un número
    // inventado. Se dice, no se adivina.
    return { tipo: 'imposible', motivo: 'No se pudo leer la duración del video.' };
  }

  const objetivo = topeBytes * MARGEN;
  const presupuesto = kbpsQueEntran(objetivo, video.duracionSeg);

  for (const ladoCorto of [video.ladoCorto, ...escalones(video.ladoCorto)]) {
    const minimo = kbpsMinimoPara(ladoCorto);
    // El audio cede primero, y solo hasta su piso: bajar la imagen a bloques
    // para salvar 32 kbps de audio es cambiar lo que se ve por lo que no se nota.
    for (const audioKbps of [AUDIO_KBPS, AUDIO_KBPS_MINIMO]) {
      const videoKbps = Math.floor(presupuesto - audioKbps);
      if (videoKbps >= minimo) {
        return {
          tipo: 'comprimir',
          videoKbps,
          audioKbps,
          ladoCorto,
          bytesEstimados: bytesDe(videoKbps + audioKbps, video.duracionSeg),
          bajaResolucion: ladoCorto < video.ladoCorto,
          segundosEstimados: Math.round(video.duracionSeg * RATIO_ENCODE),
        };
      }
    }
  }

  const minutos = Math.round(video.duracionSeg / 60);
  return {
    tipo: 'imposible',
    motivo:
      minutos >= 2
        ? `Dura ${minutos} minutos: para que entre habría que dejarlo ilegible. Recortalo y volvé a intentar.`
        : 'No entra sin dejarlo ilegible. Recortalo y volvé a intentar.',
  };
}

/**
 * «unos 3 minutos» — cuánto va a esperar, dicho como lo diría una persona.
 *
 * El redondeo grueso es a propósito: es una estimación sobre una máquina que no
 * conocemos, y un «3:19» prometería una precisión que no existe.
 *
 * Redondea al MÁS CERCANO, no hacia arriba: el margen ya está en `RATIO_ENCODE`
 * (2x sobre el 1,5x medido) y aplicarlo dos veces anunciaría 5 minutos para
 * algo que tarda 3:19. Un margen de seguridad que se nota es un margen que se
 * deja de creer.
 */
export function duracionAproximada(segundos: number): string {
  if (!Number.isFinite(segundos) || segundos < 60) return 'menos de un minuto';
  const min = Math.max(1, Math.round(segundos / 60));
  return min === 1 ? 'como un minuto' : `unos ${min} minutos`;
}
