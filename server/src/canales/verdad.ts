import { sql } from "drizzle-orm";
import { db } from "../db/client.js";

/**
 * LOS NÚMEROS QUE LA HOME DEBERÍA HABER MOSTRADO SIEMPRE.
 *
 * La home vieja contaba VOLUMEN: "946 sin atender". Ese número es verdadero y es inútil, porque
 * de esos 946 solo a 18 se les puede responder — a los otros 928 Meta les cerró la puerta.
 *
 * Un contador gigante de pendientes no es un sistema de trabajo: es una acusación. Y encima,
 * cuando la mayoría de esos pendientes son inalcanzables, es una acusación falsa.
 *
 * Acá se calculan los números que sí se pueden mirar y actuar. Ninguno está escrito a mano:
 * todos salen de una consulta, incluido el porcentaje de gente que pregunta el precio.
 */

/** Lo que TODAVÍA se puede responder: un comentario de menos de 7 días. */
const DENTRO_DE_VENTANA = sql`tipo = 'comentario' AND occurred_at > now() - interval '7 days'`;

/**
 * La ventana REAL de Meta, por tipo, tal como la verificamos:
 *
 *   · comentario → 7 días para la respuesta privada, y un solo intento.
 *   · mensaje    → 24 horas. (Serían 7 días CON el permiso `human_agent`, que NO TENEMOS —
 *                  confirmado con `debug_token`.)
 *
 * Es la regla que decide quién es alcanzable y quién no. Todo lo demás en esta pantalla se
 * deriva de acá.
 */
const VENTANA_META = sql`(
     (tipo = 'comentario' AND occurred_at > now() - interval '7 days')
  OR (tipo = 'mensaje'    AND occurred_at > now() - interval '24 hours')
)`;

export type Lazo = {
  /** ¿Ya conectamos Cerberus? Si no, Meta no sabe que vendimos, y eso es LO importante. */
  conectado: boolean;
  ventasConocidas: number;
  reportadas: number;
  /** El 17%: Tesorería confirmó tarde y Meta rechaza el evento en silencio. Acá es ruidoso. */
  perdidasPorVentana: number;
};

export type Accionable = {
  total: number;
  porCanal: { canal: string; n: number }[];
  /** A la más vieja dentro de ventana le quedan estas horas. Es a la que hay que responder. */
  horasRestantesMasUrgente: number | null;
};

export type Cerrado = {
  total: number;
  /** Messenger: sin `human_agent`, la ventana es de 24 h. El histórico es inalcanzable. */
  mensajes: number;
  /** Comentarios de más de 7 días: la respuesta privada ya no se puede mandar. */
  comentarios: number;
};

export type Preguntas = {
  conTexto: number;
  precio: number;
  info: number;
  /** Cuántos solo dejaron su teléfono, sin preguntar nada. Es la señal más fuerte y nadie la mira. */
  soloTelefono: number;
};

/**
 * El estado del lazo: ¿Meta sabe que vendimos?
 *
 * Es la razón de ser del sistema. Quitarle a Meta la señal de conversión sube el costo mediano
 * por cliente incremental un 31% (RCT, 70.000+ anunciantes, NBER w32765). Si esto está en cero,
 * nada más importa.
 */
export async function estadoDelLazo(): Promise<Lazo> {
  const [filas] = (await db.execute(sql`
    SELECT
      (SELECT count(*)::int FROM fuentes.registro
        WHERE fuente = 'cerberus' AND tabla = 'tb_venta')            AS ventas_conocidas,
      (SELECT count(*)::int FROM ontologia.conversiones
        WHERE enviado_at IS NOT NULL AND es_prueba = false)          AS reportadas,
      (SELECT count(*)::int FROM ontologia.conversiones
        WHERE descarte = 'fuera_de_ventana')                         AS perdidas
  `)) as unknown as { ventas_conocidas: number; reportadas: number; perdidas: number }[];

  return {
    conectado: (filas?.ventas_conocidas ?? 0) > 0,
    ventasConocidas: filas?.ventas_conocidas ?? 0,
    reportadas: filas?.reportadas ?? 0,
    perdidasPorVentana: filas?.perdidas ?? 0,
  };
}

/**
 * La cola honesta: lo que una persona puede trabajar HOY.
 *
 * No son 94.371. Son las decenas que todavía tienen la ventana de Meta abierta.
 */
export async function loAccionable(): Promise<Accionable> {
  const [porCanal, urgente] = await Promise.all([
    db.execute(sql`
      SELECT canal, count(*)::int AS n
      FROM interactions
      WHERE status = 'nuevo' AND direccion = 'entrante' AND (${DENTRO_DE_VENTANA})
      GROUP BY canal ORDER BY n DESC
    `),
    db.execute(sql`
      SELECT round(extract(epoch FROM (
               (min(occurred_at) + interval '7 days') - now()
             )) / 3600)::int AS horas
      FROM interactions
      WHERE status = 'nuevo' AND direccion = 'entrante' AND (${DENTRO_DE_VENTANA})
    `),
  ]);

  const filas = porCanal as unknown as { canal: string; n: number }[];
  const horas = (urgente as unknown as { horas: number | null }[])[0]?.horas ?? null;

  return {
    total: filas.reduce((s, f) => s + f.n, 0),
    porCanal: filas,
    horasRestantesMasUrgente: horas,
  };
}

/**
 * Lo que Meta cerró. No es deuda, es archivo.
 *
 * Mostrar esto como "pendiente" es mentir: sin el permiso `human_agent` (que no tenemos,
 * verificado con `debug_token`), a las conversaciones de Messenger de más de 24 h NO SE LES
 * PUEDE ESCRIBIR. Nunca. Y a los comentarios de más de 7 días, tampoco.
 *
 * Su destino real es audiencia publicitaria, no conversación.
 */
export async function loCerrado(): Promise<Cerrado> {
  const [filas] = (await db.execute(sql`
    SELECT
      count(*) FILTER (WHERE tipo = 'mensaje')::int                                     AS mensajes,
      count(*) FILTER (WHERE tipo = 'comentario'
                       AND occurred_at <= now() - interval '7 days')::int               AS comentarios
    FROM interactions
    WHERE status = 'nuevo' AND direccion = 'entrante'
  `)) as unknown as { mensajes: number; comentarios: number }[];

  const m = filas?.mensajes ?? 0;
  const c = filas?.comentarios ?? 0;
  return { total: m + c, mensajes: m, comentarios: c };
}

/**
 * Qué pregunta realmente la gente. Es el dato que le sirve al creativo, y nadie lo miraba.
 *
 * De 200 mensajes leídos a mano: el 27% pregunta el precio y el 30% pide "información" —
 * que en LATAM casi siempre significa "¿cuánto cuesta?" sin decirlo. Juntos: el 57% de todo
 * lo que la gente pregunta sobre el curso.
 *
 * El anuncio no muestra el precio. Por eso escriben. Es trabajo humano evitable con una
 * decisión de copy.
 *
 * Y la categoría más común de todas (37%) no está en ningún paper: la gente escribe su número
 * de teléfono y se va. No es una pregunta — es una entrega.
 */
/**
 * Memoria de 5 minutos.
 *
 * El regex corre sobre 82.076 textos y ningún índice lo puede cubrir — son 440 ms de Seq Scan.
 * Pero es un dato que cambia LENTO: lo que la gente pregunta no se mueve de un minuto al otro.
 * Recalcularlo en cada carga de pantalla es pagar 440 ms por una respuesta que va a ser idéntica.
 */
let memo: { valor: Preguntas; hasta: number } | null = null;

export async function loQuePreguntan(): Promise<Preguntas> {
  if (memo && Date.now() < memo.hasta) return memo.valor;

  const [filas] = (await db.execute(sql`
    SELECT
      count(*)::int                                                                      AS con_texto,
      count(*) FILTER (WHERE texto ~* '(precio|costo|cuánto|cuanto|cuesta|vale|pago)')::int  AS precio,
      count(*) FILTER (WHERE texto ~* '(informaci|^\\s*info\\b)')::int                       AS info,
      -- Un texto que es SOLO un número de teléfono: nada más, sin pregunta.
      count(*) FILTER (WHERE trim(texto) ~ '^[+()0-9\\s.-]{8,20}$')::int                     AS solo_telefono
    FROM interactions
    WHERE texto IS NOT NULL AND length(trim(texto)) >= 3
  `)) as unknown as Record<string, number>[];

  const valor: Preguntas = {
    conTexto: filas?.con_texto ?? 0,
    precio: filas?.precio ?? 0,
    info: filas?.info ?? 0,
    soloTelefono: filas?.solo_telefono ?? 0,
  };
  memo = { valor, hasta: Date.now() + 5 * 60_000 };
  return valor;
}


/** Un día del flujo, partido por lo único que decide si se puede hacer algo: la ventana. */
export type DiaFlujo = {
  dia: string;
  /** La trabajamos. */
  respondidas: number;
  /** Todavía se puede: la ventana de Meta sigue abierta. Es EL trabajo. */
  abiertas: number;
  /** Meta cerró la puerta. No se les puede escribir. Nunca. */
  cerradas: number;
};

/**
 * El flujo por día, partido en los tres estados que importan.
 *
 * El gráfico viejo mostraba "cuándo entró la gente", separado por canal. Es verdadero e inútil:
 * no responde ninguna pregunta y el canal no cambia ninguna decisión.
 *
 * Este muestra LA PUERTA CERRÁNDOSE. Sobre 30 días se ve una pared gris enorme —la gente que ya
 * no podemos alcanzar— y una franja viva de unos pocos días al final. Eso es todo el negocio en
 * una imagen, y es lo que ningún contador de pendientes puede decir.
 */
export async function flujoPorDia(desde: string | null): Promise<DiaFlujo[]> {
  const filtro = desde ? sql`AND occurred_at >= ${desde}` : sql``;

  const filas = await db.execute(sql`
    SELECT occurred_at::date::text                                  AS dia,
           count(*) FILTER (WHERE status <> 'nuevo')::int           AS respondidas,
           count(*) FILTER (WHERE status = 'nuevo' AND ${VENTANA_META})::int      AS abiertas,
           count(*) FILTER (WHERE status = 'nuevo' AND NOT ${VENTANA_META})::int  AS cerradas
    FROM interactions
    WHERE direccion = 'entrante' ${filtro}
    GROUP BY 1 ORDER BY 1
  `);

  return filas as unknown as DiaFlujo[];
}
