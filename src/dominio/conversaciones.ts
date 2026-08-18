import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/datos/cliente';
import { esFiltroSec, parametrosDeCola, type EstadoCola } from './cola';
import type { FilaDesglose } from './desglose';

/**
 * Una fila de la cola unificada: o un comentario suelto (FB/IG) o una
 * conversación de mensajes agrupada (WhatsApp/Messenger). El servidor ya la
 * ordena por la urgencia de seis niveles (`server/src/cola/urgencia.ts`);
 * el front no reordena nada.
 */
export interface Conversacion {
  /** Clave estable: `int:<id>` para comentarios, `conv:<canal>:<persona>:<num>` para chats. */
  clave: string;
  /**
   * ⚠️ `landing` NO es un canal de chat: es un lead de formulario que todavía no
   * tiene conversación (ADR 0051). Entra a la cola por el tercer brazo del UNION
   * (`cola/leadsCte.ts`) y cae en «Te esperan» porque la pelota es nuestra.
   * Quien ramifique por canal tiene que contemplarlo — no hay hilo que abrir ni
   * línea por la que haya entrado.
   */
  canal: 'facebook' | 'instagram' | 'whatsapp' | 'landing';
  /**
   * ⚠️ `lead` es el tercer valor y **no es decorativo: gobierna el orden de la
   * cola**. `server/src/cola/urgencia.ts` decide con él si la fila es deuda
   * nuestra (niveles 0 y 3) o «el resto» (nivel 5). Estuvo faltando acá mientras
   * el server ya lo emitía, y el día que se preguntó por él quedó a la vista que
   * un lead caía en el nivel 5 — o sea, debajo de las 377 conversaciones de su
   * propia columna. Ver ADR 0051, enmienda del 11-ago-2026.
   */
  tipo: 'comentario' | 'mensaje' | 'lead';
  persona_id: string | null;
  persona_nombre: string | null;
  /** El número propio de Goberna por el que entró (solo mensajes). */
  numero_propio: string | null;
  texto: string | null;
  contexto_texto: string | null;
  /** Clase del último mensaje (imagen/video/audio/documento/sticker): para «📷 Foto» cuando no hay texto.
   *  Opcional: solo la cola (`/api/conversaciones`) la trae; el radar/agenda arman Conversacion sin ella. */
  ultima_clase?: string | null;
  /** Origen del último mensaje (anuncio/landing): para «📣 Vino del anuncio» cuando no hay texto ni media. */
  ultima_origen?: { fuente: string; titulo?: string | null } | null;
  /** El PRIMER anuncio de la conversación — de acá sale el curso (#128). */
  origen_anuncio?: { fuente: string; titulo?: string | null; adId?: string | null } | null;
  /** Derivada: hay un saliente posterior al último entrante. Nunca estado de fila. */
  respondida: boolean;
  /** Derivada: alguna vez salió un mensaje nuestro. Distinto de `respondida`
   *  (que es de quién es el turno HOY): quien volvió a escribir después de que
   *  la atendimos no es una desconocida. */
  ya_le_hablamos?: boolean;
  /** Derivada (`cola/precio.ts`): ya le pasamos el precio o la forma de pagarlo. */
  precio_enviado?: boolean;
  /** La etapa del embudo dicha por el SERVER (ADR 0013): max(manual, derivada),
   *  `perdido` terminal. Opcional hasta que el server desplegado la sirva (#88). */
  etapa_efectiva?: string | null;
  /** La última gestión asentada a mano (o null). Informativa; la que manda es la efectiva. */
  etapa_manual?: string | null;
  ventana_abierta: boolean;
  /**
   * CUÁNDO SE CIERRA LA PUERTA (server: `cola/ventana.ts`) — 24 h desde que la
   * persona escribió en un chat, 7 días desde que comentó en FB/IG. Viaja el
   * INSTANTE y no «6 h»: el texto envejece adentro del caché de IndexedDB
   * (ADR 0007) y un «quedan 6 h» serializado ayer hoy es mentira.
   *
   * `null` = no aplica (sin entrante, o un canal sin plazo). AUSENTE = el server
   * todavía no lo manda (N4 va solo, N5 es un botón), y ahí no se dibuja nada —
   * que es como se comportaba antes. La lectura vive en `canales/ventana.ts`.
   */
  ventana_cierra?: string | null;
  /**
   * ¿PIDIÓ ALGO? Los tres niveles del predicado viven en el server
   * (`cola/pregunta.ts`): precio, un sustantivo concreto, o un pedido genérico
   * que no sea el texto del anuncio.
   */
  pregunto: boolean;
  /** Nombró plata: precio, cuotas, yape, cómo inscribirse. Es el chip. */
  pregunto_precio?: boolean;
  /**
   * El último entrante lo escribió el ANUNCIO, no la persona. AUSENTE = server
   * viejo o respuesta rehidratada del caché (ADR 0007): ahí no se dibuja nada y
   * la fila se comporta como antes de este frente.
   */
  solo_clic?: boolean;
  /** Cuántos mensajes agrupa la conversación (1 en comentarios). */
  n: number;
  referencia: string;
  ultimo_at: string;
  /**
   * DESDE CUÁNDO ESTÁ EN SU ETAPA (server: `cola/tiempoEnEtapa.ts`) — el dato que
   * separa a dos tarjetas que la etapa iguala: una recibió el precio hace 40
   * minutos y la otra hace tres semanas.
   *
   * Viaja el INSTANTE, no «hace 12 d»: el texto envejece adentro del caché de
   * IndexedDB (ADR 0007), el timestamp no. Opcional y **nulable, que no es lo
   * mismo**: ausente = server viejo; `null` = no se pudo determinar (un
   * comentario respondido no guarda cuándo). Los dos casos se dibujan igual —no
   * se dibuja nada—, y por eso la lectura vive en `canales/antiguedad.ts`.
   */
  etapa_desde?: string | null;
  dias: number;
  /** La escala canónica de urgencia: 0 vivo · 1 vencido · 2 expira · 3 espera ·
   *  4 silencio · 5 resto — la misma que el radar del Dashboard. */
  nivel: 0 | 1 | 2 | 3 | 4 | 5;
  /** Estado PERSONAL de la vendedora sobre la conversación (cola potenciada #49).
   *  Opcionales: solo la cola (`/api/conversaciones`) los trae; radar/agenda no. */
  /** Fijada (pin): sube a la banda de arriba de todo (tope 3). */
  fijada?: boolean;
  /** Favorita: entra al tab «Favoritos». */
  favorita?: boolean;
  /** Sin leer: hay un entrante posterior al cursor de lectura. Distinto de `respondida`. */
  no_leido?: boolean;
  /** Las categorías (etiquetas) asignadas, en minúsculas — para la píldora de color. */
  categorias?: string[];
  /** CANDIDATOS del chip de curso (#72). La precedencia la decide `curso.ts`, no el server. */
  /** El interés más reciente asentado para esta conversación. */
  interes_curso?: string | null;
  /** El curso del formulario que la persona llenó (lead emparejado por teléfono). */
  lead_curso?: string | null;
  /** El nombre con el que llenó ESE formulario. Le gana al pushname de WhatsApp,
   *  que en producción suele ser «🦋W», «.» o «10 ❤️L» (#137). */
  lead_nombre?: string | null;
  /** EX-CLIENTE (#133): `vip` · `recompro` · `compro`, del cruce por teléfono
   *  contra el padrón local. Ausente = no se sabe (radar/agenda no lo traen, y un
   *  server sin el `db:push` tampoco). NUNCA se lee como «no es cliente». */
  cliente_nivel?: 'vip' | 'recompro' | 'compro' | null;
  /** Cuántas compras registra el padrón — el «×3» de la marca. */
  cliente_compras?: number | null;
  /** EL VEREDICTO DEL BOT (`cola/botSql.ts`): el bot se frenó y espera a una
   *  persona. Ausente = no se sabe (el radar y la agenda no lo traen, y un
   *  server sin la migración del bot tampoco). Se lee en `canales/bot.ts`. */
  bot_escalada?: boolean | null;
  /** `caliente` · `tibio` · `frio` — lo que el bot calificó. `null` = no dijo nada. */
  bot_temperatura?: string | null;
  /** El motivo CRUDO: uno de los seis `EscaladaMotivo` si escaló, o el texto
   *  libre del modelo si solo calificó. La traducción a criollo vive en `bot.ts`. */
  bot_motivo?: string | null;
  /** DE QUIÉN ES (reparto de leads, 4-ago-2026): el username de Cerberus de quien
   *  la tiene. `null`/ausente = sin dueño, y eso NO se lee como «es de nadie,
   *  agarrala»: un server sin la migración del reparto manda esto en cada fila.
   *  La marca de la píldora la decide `canales/dueno.ts`, puro y con tests. */
  asignada_a?: string | null;
}

type Pagina = {
  conversaciones: Conversacion[];
  total?: number;
  hayMas: boolean;
  /** El server sirvió la cola SIN estado personal (la tabla no existe todavía). */
  sinEstado?: boolean;
  /** Conteos reales por etapa efectiva sobre la misma ventana (#89). Solo primera página. */
  conteos?: Record<string, number>;
  /** Cuántas filas daría cada filtro secundario dentro del recorte actual. Primera página. */
  conteosFiltro?: {
    preguntoPrecio: number;
    teEscribieron: number;
    /** La deuda entera, sin corte de antigüedad. Ya no tiene chip: eran 505 y el
     *  93 % de más de una semana. Se sigue contando porque es el número que dice
     *  si la deuda vieja crece. */
    sinResponder?: number;
    yaCompraron?: number;
    /** El bot se frenó y espera a una persona. Opcional: un server viejo no lo manda. */
    botEscalada?: number;
    botCaliente?: number;
    /** Cuántas tienen la ventana abierta (`cola/ventana.ts`). Opcional: server viejo. */
    puedoEscribirle?: number;
    /** Cuántas te asignó el reparto — SIEMPRE contadas con el filtro apagado, así
     *  el chip puede decir su número antes de que lo toquen. */
    mios?: number;
  };
  /** El server sirvió la cola SIN la marca de ex-cliente (falta el `db:push` de #133). */
  sinPadron?: boolean;
  /** Se pidió «las mías» y `numero_vendedora` no le asigna ninguna: vino TODO. */
  sinLineasPropias?: boolean;
  /** El server sirvió la cola SIN dueño: falta la migración del reparto. */
  sinAsignacion?: boolean;
  /**
   * Se pidió «Míos» (`?mios=1`), así que esta cola YA es solo lo suyo.
   *
   * ⚠️ **Antes también se prendía sola**, al estar en una rueda del reparto, y era
   * lo que decidía el rótulo de la cabecera. Ese recorte automático murió: quién
   * ve qué es propiedad del ROL, y lo que hay que leer para el rótulo es
   * `colaRecortada`. Se conserva en el tipo porque el server lo sigue mandando —
   * hoy ninguna pantalla manda `?mios=1`, así que en la práctica nunca llega.
   */
  enElReparto?: boolean;
  /**
   * EL SERVER APLICÓ LA FRONTERA DEL ROL: esta cola trae lo de quien pregunta más
   * lo huérfano de sus líneas, y el trabajo repartido a otra persona **no viajó**.
   *
   * ⚠️ **Opcional, y ausente NO es «no hay recorte»**: un server viejo no lo manda
   * y una página rehidratada del caché de IndexedDB (ADR 0007) tampoco. Es «no se
   * sabe», y de eso no se afirma nada — ver `RotuloDeLaCola`.
   */
  colaRecortada?: boolean;
  /**
   * QUIEN MIRA TRAJO SU PROPIA LÍNEA (la vinculó por QR desde Hermes), así que
   * esta cola es **su línea entera más lo que le asignaron en las otras** — y
   * NADA del archivo de las líneas que no tienen dueña.
   *
   * 🔴 **Cambia lo que la pantalla puede AFIRMAR, no cómo se ve una fila.** Sin
   * esto, el rótulo de la cabecera le promete «lo que todavía no tiene dueña»
   * (`RotuloDeLaCola`) — que para esta persona es exactamente la rama que se le
   * cayó, o sea una explicación falsa sobre por qué su número bajó. Y el vacío
   * diría «nada cayó con estos filtros», que también es falso: cayó, no es suyo
   * y todavía no le asignaron nada. Es el mismo problema que `soloMisAsignadas`
   * resuelve en el Dashboard (ADR 0036).
   *
   * ⚠️ **Opcional, y ausente NO es «no tiene línea propia»**: es «no se sabe» —
   * un server viejo no lo manda (el front sale por N4 y el server por N5) y una
   * página rehidratada del caché de IndexedDB tampoco (ADR 0007). Se lee
   * `?? false` / `=== true`: no afirmar nada deja el texto de siempre, que como
   * mucho es incompleto. Al revés se afirmaría un recorte sobre la cola de todo
   * el equipo.
   */
  conLineaPropia?: boolean;
  /** La misma foto abierta por «ya le hablamos» × precio × viva × ventana. Solo primera página. */
  desglose?: FilaDesglose[];
};

/**
 * La cola unificada. Mismo patrón que `useInteracciones` (infinite query cacheada
 * por filtros), pero contra `/api/conversaciones`: una fila por conversación, no
 * por mensaje. Los ejes (tab, filtro secundario, categoría, etapa) van en
 * `estado` y se traducen a query-params con `parametrosDeCola` (lógica pura,
 * testeada aparte).
 *
 * `etapa` (#89/#90): la carga POR COLUMNA del Pipeline — filtra por etapa
 * efectiva en el server. Solo entra a la queryKey/URL cuando se pide, así las
 * queries de siempre (Mensajes) conservan su clave y su caché persistido.
 */
export function useConversaciones(
  estado: EstadoCola | string = { tab: 'todo', filtroSec: '', categoria: null },
  canal = '',
  etapa = '',
) {
  // Compat: `VistaEmbudo` (otro frente) todavía llama `useConversaciones(intencion, canal, etapa)`
  // por posición, con el string viejo de intención. Un string legado se normaliza
  // a un estado: `''` = todo, y solo los filtros que HOY existen sobreviven como
  // filtro secundario; `canal`/`etapa` posicionales entran igual al estado.
  const norm: EstadoCola =
    typeof estado === 'string'
      ? {
          tab: 'todo',
          filtroSec: esFiltroSec(estado) ? estado : '',
          categoria: null,
          canal: canal || undefined,
          etapa: etapa || undefined,
        }
      : estado;
  const base = parametrosDeCola(norm);

  const q = useInfiniteQuery({
    queryKey: ['conversaciones', base],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => {
      const p = new URLSearchParams({ ...base, limit: '30', offset: String(pageParam) });
      return api<Pagina>(`/api/conversaciones?${p}`);
    },
    getNextPageParam: (ultima, todas) =>
      ultima.hayMas ? todas.reduce((n, p) => n + p.conversaciones.length, 0) : undefined,
    // El tiempo real lo maneja el SSE (invalida al instante). Esto es la red de
    // seguridad: si el stream se cae, la cola igual se refresca al volver a la app
    // y cada ~20-30s. Con SSE vivo, esto casi nunca dispara.
    // ⚠️ El intervalo lleva jitter (no un número fijo): con ~8 vendedoras conectadas,
    // un valor clavado las sincroniza y las 8 pestañas repiten la consulta más cara
    // de la cola en el mismo segundo (medido: load average 16 en un VPS de 8 núcleos).
    refetchOnWindowFocus: true,
    refetchInterval: () => 20_000 + Math.random() * 10_000,
  });

  return {
    items: q.data?.pages.flatMap((p) => p.conversaciones) ?? [],
    total: q.data?.pages[0]?.total ?? 0,
    /** Los conteos del embudo (primera página): el total real de cada columna del tablero. */
    conteos: q.data?.pages[0]?.conteos,
    /** Cuántas daría cada chip de filtro sin salir del recorte actual (#72). */
    conteosFiltro: q.data?.pages[0]?.conteosFiltro,
    /** El desglose (primera página): las bandas de la bandeja y el recorte por precio. */
    desglose: q.data?.pages[0]?.desglose,
    hayMas: Boolean(q.hasNextPage),
    cargando: q.isPending,
    cargandoMas: q.isFetchingNextPage,
    cargarMas: () => void q.fetchNextPage(),
    /**
     * Cuándo se trajo esto. Al abrir la app la cola se pinta desde el caché
     * persistido, y hasta que llegue lo fresco hay que decir de cuándo es
     * (ver `lib/datos/persistencia.ts`).
     */
    traidoEn: q.dataUpdatedAt,
    actualizando: q.isFetching,
    /**
     * El server no pudo leer el estado personal (falta el `db:push` de
     * `estado_conversacion`). La cola igual sirve; la UI lo dice en voz alta en
     * vez de fingir que nadie fijó ni marcó nada.
     */
    sinEstado: q.data?.pages[0]?.sinEstado === true,
    /**
     * Se pidió «las mías» y el mapa `numero_vendedora` no le asigna ninguna, así
     * que el server sirvió TODO (fail-open). La UI lo dice: un filtro que no
     * filtra y no avisa se ve igual que uno que sí, y la vendedora creería que
     * esas conversaciones son suyas.
     */
    sinLineasPropias: q.data?.pages[0]?.sinLineasPropias === true,
    /**
     * El server sirvió la cola SIN el dueño de cada conversación: falta la
     * migración del reparto. Se dice para que la pantalla no ofrezca un filtro
     * «Míos» que devolvería cero por una razón que no es «no te tocó nada».
     */
    sinAsignacion: q.data?.pages[0]?.sinAsignacion === true,
    /**
     * EL SERVER APLICÓ LA FRONTERA DEL ROL: esta cola es lo de quien pregunta más
     * lo huérfano de sus líneas. La pantalla lo usa para DECIRLO — sin la píldora
     * «Vos» (retirada por ser la misma marca en todas las filas), una cola propia
     * se ve idéntica a la de todos, y el número de la cabecera cae sin explicación.
     *
     * ⚠️ **`=== true` y no `?? false`, y la diferencia importa acá**: lo que se
     * quiere distinguir es «el server dijo que recortó» de «el server no dijo
     * nada» (server viejo, o caché rehidratado). Ausente cae en `false` y el
     * rótulo no afirma nada, que es lo correcto.
     *
     * ⚠️ Reemplaza a `enElReparto` en este lugar: aquél respondía «¿está en una
     * rueda?», que dejó de gobernar lo que se ve.
     */
    colaRecortada: q.data?.pages[0]?.colaRecortada === true,
    /**
     * TRAJO SU PROPIA LÍNEA: la cola es su línea entera + lo que le asignen en
     * las otras. La pantalla lo usa para DECIRLO — hoy son dos personas que van
     * a abrir la cola y ver muy poco, porque el dueño todavía no les asignó nada
     * en la línea compartida (medido el 18-ago-2026: cero filas en
     * `conversacion_asignada` para las dos). Un vacío sin motivo se lee «se
     * perdieron las conversaciones».
     *
     * ⚠️ `=== true` y no `?? true`: ausente es «no se sabe» y no se afirma nada.
     */
    conLineaPropia: q.data?.pages[0]?.conLineaPropia === true,
  };
}

/** Un cambio de estado personal de una conversación (pin / favorita / leído). */
export interface CambioEstadoConversacion {
  clave: string;
  fijada?: boolean;
  favorita?: boolean;
  leido?: boolean;
}

/**
 * Fijar / marcar favorita / marcar leído — la mutación contra
 * `PUT /api/conversaciones/estado`. Es una ESCRITURA (una acción humana): al
 * terminar invalida la cola para que el pin/estrella/punto azul se repinten.
 * Fijar con el tope lleno devuelve 409 (`ErrorApi`), que la UI muestra sin
 * esconder. `marcarLeido` avanza el cursor cross-canal al abrir cualquier hilo.
 */
export function useEstadoConversacion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (cambio: CambioEstadoConversacion) =>
      api('/api/conversaciones/estado', { method: 'PUT', body: JSON.stringify(cambio) }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['conversaciones'] });
    },
  });
}
