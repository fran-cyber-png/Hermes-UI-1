import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ErrorApi } from '../../lib/datos/cliente';
import { tokenGuardado } from '../../lib/datos/token';
import { API_URL } from '../../config';
import type { PiezaDeclarada } from './procedenciaComposer';
import type { CitaHilo } from './cita';
import { esLineaQueNoCorre, intervaloDelHilo, intervaloDeLaSesion } from './cadencia';

/** Un adjunto del hilo: el archivo ya vive en el server, esto es la referencia. */
export interface MediaHilo {
  clase: 'imagen' | 'video' | 'audio' | 'documento' | 'sticker';
  archivo: string;
  mime: string | null;
  nombre?: string | null;
}

/**
 * Una reacción a un mensaje — 👍 al flyer, ❤️ al temario.
 *
 * **Opcional a propósito, y ausente en vez de `[]`**: un server viejo no la
 * manda y la migración puede no estar aplicada. Sin el campo, la burbuja se
 * dibuja como siempre; con `[]` habría que distinguir «no tiene reacciones» de
 * «no se pudo saber», y esa diferencia no le sirve a nadie acá.
 */
/** La escala de los ✓✓. Espeja `entrega/dominio.ts` del server. */
export type EstadoEntregaWa = 'enviado' | 'entregado' | 'leido' | 'fallido';

export interface ReaccionWa {
  emoji: string;
  /** La puso Goberna por esta línea, no el lead. */
  nuestra: boolean;
}

/** Un mensaje del hilo, tal como lo devuelve el backend. */
export interface MensajeHilo {
  id: number;
  direccion: 'entrante' | 'saliente';
  autor: string;
  texto: string | null;
  occurred_at: string;
  external_id: string;
  media?: MediaHilo | null;
  /** Si este mensaje trajo el origen del lead (anuncio/landing). Solo el primero suele traerlo. */
  origen?: { fuente: string; titulo?: string | null } | null;
  /**
   * Lo mandó la AUTO-RESPUESTA fuera de horario, no una persona (#125, ADR 0015).
   * Sale de `envios_wa.automatico`. La vendedora TIENE que poder distinguirlo de
   * un vistazo: sin la marca, abre el chat creyendo que ella escribió eso.
   */
  automatico?: boolean;
  /**
   * Quién le dio el OK antes de que saliera (modo supervisado, ADR 0016). Null
   * en modo automático, donde justamente no lo miró nadie. La distinción no es
   * cosmética: «esto lo mandó la máquina sola» y «esto lo mandó la máquina
   * porque Ana lo aprobó» son dos cosas distintas para quien lee el hilo tres
   * días después.
   */
  aprobada_por?: string | null;
  /** Las reacciones a ESTE mensaje, en el orden en que se pusieron. */
  reacciones?: ReaccionWa[];
  /**
   * ¿LE LLEGÓ? ¿LO LEYÓ? Solo en los SALIENTES.
   *
   * **Ausente = no se sabe**, y eso NO es lo mismo que «enviado»: los mensajes
   * anteriores a este frente no tienen estado —sus recibos pasaron cuando no los
   * escuchábamos— y dibujar un ✓ ahí sería afirmar algo que nadie confirmó.
   */
  entrega?: EstadoEntregaWa;
  /**
   * POR QUÉ NO SE ENTREGÓ — el código de Meta (`'131047'`), solo con `fallido`.
   *
   * Lo traduce `motivoEntrega.ts`. **Ausente es lo normal y no significa nada
   * malo**: un server viejo, un hilo rehidratado del caché (ADR 0007) o un fallo
   * anterior a la migración 0028. Sin él la burbuja dibuja el triángulo pelado,
   * exactamente como antes de este frente.
   */
  entregaMotivo?: string;
  /**
   * A QUÉ MENSAJE RESPONDE ESTE — la tirita gris de WhatsApp.
   *
   * **Opcional y `null`-able**: opcional porque un server viejo no la manda (el
   * front sale por N4 y el server por N5, así que esa ventana existe en cada
   * deploy), y `null` porque el server nuevo la manda explícita en cada mensaje.
   * Las dos formas significan lo mismo acá: no hay tirita.
   *
   * Que venga con `texto: null` **no** significa que no haya cita: significa que
   * el mensaje citado no está en Hermes, y ahí se dibuja el hueco honesto. La
   * lectura vive en `cita.ts`, no en el JSX.
   */
  cita?: CitaHilo | null;
  /**
   * SI SE EDITÓ: el texto VIGENTE y cuándo cambió por última vez.
   *
   * **Opcional, y ausente ≠ no editado a secas**: como `entrega`, un server
   * viejo no lo manda. Con el campo, la burbuja prefiere `editado.texto` sobre
   * `texto` (el original) y muestra «Editado» — el mismo trato que le da
   * WhatsApp: no lo pisa, lo marca.
   */
  editado?: { texto: string; editadoEn: string } | null;
}

/**
 * La URL para ver/bajar un adjunto del hilo. OJO: está detrás del perímetro
 * (Bearer), así que NO va directa a un `<img src>` — se consume vía
 * `useBlobAutenticado` (src/lib/datos/blobAutenticado.ts), el mecanismo
 * central de media autenticada.
 */
export function urlMedia(archivo: string): string {
  return `${API_URL}/api/whatsapp/media/${encodeURIComponent(archivo)}`;
}

/**
 * CUÁNTO ACEPTA ESTA LÍNEA, por clase de adjunto (bytes).
 *
 * Lo publica `GET /api/whatsapp/sesion` porque el tope **es de la línea, no de
 * Hermes**: la del bot es Cloud API y Meta corta el video en 16 MB y la imagen
 * en 5; las de las vendedoras son whatsmeow y no tienen ese tope. Sin esto, la
 * app dejaba elegir un video de 17,9 MB, lo subía entero y mostraba el JSON de
 * Meta con su `fbtrace_id`.
 *
 * **Opcional a propósito**: un server viejo no lo manda, y ahí el front no
 * frena nada — que es exactamente como se comportaba antes. La garantía no es
 * ésta: el server verifica igual y responde 409 con el motivo redactado.
 */
export type LimitesMediaWa = Partial<Record<'imagen' | 'video' | 'audio' | 'documento', number>>;

/** El estado de la sesión de WhatsApp (para el banner). Espeja `EstadoSesion` del server. */
export type EstadoSesionWa = {
  /** Qué hay del otro lado. Ausente en un server viejo. */
  transporte?: 'whatsmeow' | 'cloud-api' | 'falso';
  limitesMedia?: LimitesMediaWa;
  /**
   * ¿ESTA LÍNEA PUEDE EDITAR UN MENSAJE YA MANDADO? Feature-detectado del lado
   * del server (`transporte.editarTexto` presente o no): hoy solo whatsmeow,
   * porque la Cloud API de Meta no expone ningún PATCH de mensajes.
   *
   * Ausente = server viejo → se trata como `false` (no ofrecer el botón), el
   * mismo criterio conservador que el resto de estas banderas opcionales.
   */
  puedeEditar?: boolean;
} & (
  | { estado: 'sin-vincular'; qr: string | null; codigo: string | null }
  | { estado: 'conectando' }
  | { estado: 'conectado'; telefono: string }
  | { estado: 'desconectado'; motivo: string }
  | { estado: 'cerrada'; motivo: string }
  | { estado: 'baneado'; codigo: string; expira: string }
);

/**
 * EL ESTADO DE LA LÍNEA — y por qué este poll es la RED del SSE, no la fuente.
 *
 * Cuando el estado de una línea cambia de verdad (conectada, caída, baneada, o
 * recién montada), el server lo empuja por el bus: `whatsapp/wiring.ts` llama a
 * `emitirRT({tipo:'estado'})` en cada `onEstado`, y `lib/datos/tiempoReal.ts`
 * traduce ese evento a `invalidateQueries(['wa','sesion'])`. **Eso es la
 * fuente.** Este intervalo es lo que queda cuando el stream no está.
 *
 * Era `10_000` fijo, y con ~6 observadores montados a la vez eso fueron
 * **58.429 pedidos el 18-ago-2026** para un endpoint que contesta en 6 ms sin
 * tocar la base — o sea, trabajo que no le sirve a nadie.
 *
 * ⚠️ **Los ~6 observadores siguen ahí y cada uno pone su propio timer**:
 * `refetchInterval` vive en el OBSERVADOR, no en la query, así que seis
 * componentes montados sobre `['wa','sesion','']` son seis timers sobre la
 * misma query. Bajar de 10 s a 60 s divide eso por seis; **hacer que sólo uno
 * sondee es otro frente** y no se hace acá, porque elegir «cuál» crea un
 * acoplamiento nuevo: el día que ese componente se desmonte, nadie pollea y
 * nada lo dice.
 *
 * ⚠️ **`['wa','sesion','']` y `['wa','sesion',numeroPropio]` son claves
 * DISTINTAS a propósito y no se colapsan**: la primera es el semáforo global
 * («¿alguna línea puede mandar?») y la segunda gobierna si el composer de ESA
 * conversación deja mandar. Con una sola, el composer de una línea caída
 * quedaría habilitado porque otra está viva.
 */
export function useSesionWa(numeroPropio?: string | null) {
  const params = numeroPropio ? `?numeroPropio=${encodeURIComponent(numeroPropio)}` : '';
  return useQuery({
    queryKey: ['wa', 'sesion', numeroPropio ?? ''],
    queryFn: () => api<EstadoSesionWa>(`/api/whatsapp/sesion${params}`),
    /**
     * 🔴 **UN 404 SE DEJA DE PEDIR.** `esa línea no está corriendo`
     * (`server/src/routes/whatsapp.ts`) es una respuesta ESTABLE: sólo cambia
     * cuando alguien monta la línea, y **cuando eso pasa el server emite un
     * `estado`** que invalida esta clave. Repreguntarlo cada 10 s fueron
     * **19.313 pedidos el 18-ago** que nunca podían contestar otra cosa.
     *
     * La red no es `refetchOnWindowFocus` —está APAGADO globalmente en Hermes
     * (`lib/datos/cliente.ts`)—: son las dos invalidaciones de
     * `lib/datos/tiempoReal.ts`, la del evento `estado` y la del **reconecte**
     * del stream. Sin esa segunda, una línea montada mientras el front estaba
     * desconectado se quedaría en 404 para siempre.
     */
    refetchInterval: (query) => intervaloDeLaSesion(query.state.error),
    /**
     * Y tampoco se REINTENTA el 404: el default global es `retry: 1`, así que
     * cada 404 costaba dos pedidos. Los demás errores conservan su reintento.
     */
    retry: (intentos, error) => !esLineaQueNoCorre(error) && intentos < 1,
  });
}

/** De dónde vino el lead, enriquecido con Meta si vino de un anuncio. */
export type OrigenLead =
  | { fuente: 'anuncio'; adId?: string; titulo?: string; anuncio?: string; campana?: string }
  | { fuente: 'landing'; ref: string }
  | null;

/** Lo que devuelve `GET /api/whatsapp/conversacion/:telefono`. */
type HiloWa = { telefono: string; mensajes: MensajeHilo[]; origen: OrigenLead };

/**
 * Cuándo pasó lo último en este hilo — lo que decide su cadencia.
 *
 * El server sirve los mensajes en orden ASCENDENTE (`whatsapp/hilo.ts` aplica
 * el `LIMIT` sobre el orden DESC y devuelve ASC), así que el último del arreglo
 * es el más reciente. Sin hilo todavía, o con un hilo vacío, devuelve `null` —
 * y `intervaloDelHilo` lee eso como el escalón más rápido.
 *
 * ══ 🔴 POR QUÉ ESTO ES TOTAL Y NO CONFÍA EN EL TIPO ═════════════════════════
 *
 * Porque lo consume un `refetchInterval`, y **TanStack lo evalúa adentro del
 * RENDER** (`QueryObserver.setOptions`, desde `useBaseQuery`): una excepción
 * ahí no degrada el poll, se lleva puesta la pantalla entera.
 *
 * Y el tipo no alcanza para garantizar que no la haya. `query.state.data` está
 * declarado `HiloWa | undefined` y en runtime puede ser otra cosa: una
 * respuesta rehidratada del caché de IndexedDB (ADR 0007) escrita por una
 * versión anterior del front, o un server que contesta otro cuerpo. La primera
 * versión de esta función era `hilo?.mensajes.at(-1)` —el `?.` cubría `hilo` y
 * no `mensajes`— y **tumbó un candado que no tiene nada que ver con este
 * frente**: `leidoInstantaneo.test.tsx` usa un stub que contesta
 * `{ok:true,cursor:true}` a TODA URL, incluida la del hilo, y el render murió
 * con «Cannot read properties of undefined (reading 'at')».
 *
 * Cualquier forma que no se entienda cae en `null`, que es el escalón más
 * rápido: la misma regla de `cadencia.ts`, degradar hacia MÁS frecuente.
 */
function ultimoMensajeDelHilo(hilo: HiloWa | undefined): string | null {
  const mensajes: unknown = hilo?.mensajes;
  if (!Array.isArray(mensajes)) return null;
  const ultimo: unknown = mensajes.at(-1);
  if (typeof ultimo !== 'object' || ultimo === null) return null;
  const cuando = (ultimo as { occurred_at?: unknown }).occurred_at;
  return typeof cuando === 'string' ? cuando : null;
}

export function useConversacionWa(telefono: string | null) {
  const qc = useQueryClient();

  const hilo = useQuery({
    queryKey: ['wa', 'conversacion', telefono],
    queryFn: () => api<HiloWa>(`/api/whatsapp/conversacion/${telefono}`),
    enabled: Boolean(telefono),
    /**
     * EL RITMO DEPENDE DE QUÉ TAN VIVA ESTÁ LA CONVERSACIÓN, no del reloj.
     *
     * Era `5_000` fijo, y el 18-ago-2026 eso fueron **41.973 pedidos con 98,8 %
     * de 304** — de los cuales **19.234 (46 %) eran cinco conversaciones de
     * líneas apagadas con DIEZ mensajes entre todas** (`989270836`: 6.644
     * pedidos para UN mensaje, en una línea muerta hacía 28 días). Un 304 no es
     * gratis: el ETag es el hash del cuerpo, así que la consulta corre entera y
     * recién al final se descubre que no cambió.
     *
     * La regla y su porqué —incluido el 🔴 de por qué el escalón lento no puede
     * pasar de 60 s— viven en `cadencia.ts`, puras y con test. Acá sólo se le
     * pasa el último mensaje del hilo: el server lo sirve ASC
     * (`whatsapp/hilo.ts`: `ORDER BY occurred_at ASC` sobre el `LIMIT` DESC),
     * así que el último del arreglo es el más reciente.
     *
     * Sin `data` todavía —el primer render, o el hilo recién abierto— cae en el
     * escalón más rápido: la regla degrada hacia MÁS frecuente, siempre.
     */
    refetchInterval: (query) =>
      telefono
        ? intervaloDelHilo(ultimoMensajeDelHilo(query.state.data), Date.now())
        : false,
  });

  // Marcar leído al abrir (ticks azules — decisión de Estephano). Sin bloquear la vista.
  /**
   * Marcar leído al abrir. Hace DOS cosas del otro lado: los ticks azules para el
   * lead y el cursor de lectura de la vendedora (lo que apaga el punto azul de
   * la fila).
   *
   * ⚠️ **`numeroPropio` no es opcional para el cursor**: `estado_conversacion` se
   * indexa por la clave completa `conv:whatsapp:<tel>:<linea>`, y sin la línea el
   * server no puede saber cuál conversación marcar — manda los ticks y no toca el
   * cursor, que es lo correcto: mejor no apagar la marca que apagar la de otra.
   *
   * La cola se revalida al terminar. La conversación **no se mueve de lugar**:
   * el orden es por urgencia y leer no es atender (decisión del 7-ago-2026).
   */
  const marcarLeido = useMutation({
    mutationFn: (vars: { telefono: string; numeroPropio?: string | null }) => {
      const q = vars.numeroPropio ? `?numeroPropio=${encodeURIComponent(vars.numeroPropio)}` : '';
      return api<{ ok: true; cursor: boolean }>(`/api/whatsapp/leido/${vars.telefono}${q}`, {
        method: 'POST',
        body: '{}',
      });
    },
    /**
     * OPTIMISTA: el punto azul se apaga en el instante del clic.
     *
     * ── Por qué hacía falta ─────────────────────────────────────────────
     * El síntoma reportado fue «tengo que quedarme unos 3 segundos en el chat
     * para que lo tome como leído». No era eso: el marcado TARDABA tres
     * segundos —el server esperaba a que WhatsApp acusara los tildes antes de
     * tocar el cursor— y quien volvía antes no lo veía. Eso ya se arregló del
     * lado del server; esto es la otra mitad, para que ni siquiera se note el
     * viaje de ida y vuelta.
     *
     * Se tocan TODAS las variantes de la cola (`setQueriesData` con el prefijo)
     * porque la queryKey lleva los filtros: con `setQueryData` de una sola,
     * cambiar de filtro mostraría el punto encendido otra vez.
     *
     * ⚠️ **Solo se apaga el punto; NO se reordena acá.** El orden de la cola es
     * del server (`bandaPinOrdenSql`) y reimplementarlo en el navegador sería
     * tener la misma regla en dos lados — la lección de #37. La fila baja cuando
     * llega el refetch, que ahora tarda milisegundos.
     */
    onMutate: (vars) => {
      const previas = qc.getQueriesData({ queryKey: ['conversaciones'] });
      qc.setQueriesData(
        { queryKey: ['conversaciones'] },
        (viejo: { pages?: { conversaciones: { persona_id: string; no_leido?: boolean }[] }[] } | undefined) => {
          if (!viejo?.pages) return viejo;
          return {
            ...viejo,
            pages: viejo.pages.map((p) => ({
              ...p,
              conversaciones: p.conversaciones.map((c) =>
                c.persona_id === vars.telefono ? { ...c, no_leido: false } : c,
              ),
            })),
          };
        },
      );
      return { previas };
    },
    onError: (_e, _v, ctx) => {
      // Se deshace: un punto apagado sobre algo que el server no marcó es una
      // conversación que se pierde de vista sin que nadie la haya leído.
      for (const [clave, dato] of ctx?.previas ?? []) qc.setQueryData(clave, dato);
    },
    onSuccess: (r) => {
      // El refetch trae el ORDEN nuevo (la fila baja). El punto ya está apagado
      // desde `onMutate`, así que esto no se nota como un salto.
      if (r?.cursor) void qc.invalidateQueries({ queryKey: ['conversaciones'] });
    },
  });

  const enviar = useMutation({
    mutationFn: (vars: {
      numeroPropio: string;
      telefono: string;
      texto: string;
      referencia: string;
      /** De qué pieza salió (#169). Ausente = escrito a mano: la línea de base. */
      pieza?: PiezaDeclarada;
      /**
       * A qué mensaje responde: **el `external_id` y nada más**. De quién era y
       * qué decía lo resuelve el server contra lo que ya guardó — es un dato que
       * el LEAD va a ver, y declararlo desde acá sería la segunda fuente de
       * verdad para el mismo hecho (ver `whatsapp/citaRepositorio.ts`).
       */
      citaDe?: string;
    }) =>
      api<{ ok: true; idExterno: string }>('/api/whatsapp/enviar', {
        method: 'POST',
        body: JSON.stringify(vars),
      }),
    // Al enviar, el hilo y la cola quedan viejos: se revalidan.
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['wa', 'conversacion', telefono] });
      void qc.invalidateQueries({ queryKey: ['conversaciones'] });
    },
  });

  // Adjuntos: el archivo viaja crudo (no JSON), por eso no pasa por `api()` —
  // pero lleva el mismo Bearer y los mismos estados que cualquier envío.
  const enviarMedia = useMutation({
    mutationFn: async (vars: {
      numeroPropio: string;
      telefono: string;
      referencia: string;
      archivo: File;
      caption: string;
    }) => {
      const token = tokenGuardado();
      const q = new URLSearchParams({
        telefono: vars.telefono,
        numeroPropio: vars.numeroPropio,
        referencia: vars.referencia,
        nombre: vars.archivo.name,
        ...(vars.caption.trim() ? { caption: vars.caption.trim() } : {}),
      });
      const res = await fetch(`${API_URL}/api/whatsapp/enviar-media?${q}`, {
        method: 'POST',
        headers: {
          'content-type': vars.archivo.type || 'application/octet-stream',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: vars.archivo,
      });
      if (!res.ok) {
        const cuerpo = await res.json().catch(() => ({}));
        throw new ErrorApi(cuerpo.message ?? `Error ${res.status}`, res.status);
      }
      return res.json() as Promise<{ ok: true; idExterno: string }>;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['wa', 'conversacion', telefono] });
      void qc.invalidateQueries({ queryKey: ['conversaciones'] });
    },
  });

  /**
   * REACCIONAR a un mensaje del lead. Emoji vacío quita la reacción.
   *
   * Optimista a propósito: la píldora aparece al instante y se corrige sola si
   * el server dice que no. Reaccionar es el gesto más liviano del chat — que
   * tarde medio segundo en aparecer lo hace sentir roto.
   */
  const reaccionar = useMutation({
    mutationFn: (vars: { numeroPropio: string; telefono: string; mensajeId: string; emoji: string }) =>
      api<{ ok: true; quitada: boolean }>('/api/whatsapp/reaccionar', {
        method: 'POST',
        body: JSON.stringify(vars),
      }),
    onMutate: async (vars) => {
      const clave = ['wa', 'conversacion', telefono];
      await qc.cancelQueries({ queryKey: clave });
      const antes = qc.getQueryData(clave);
      qc.setQueryData(clave, (viejo: { mensajes: MensajeHilo[] } | undefined) => {
        if (!viejo) return viejo;
        return {
          ...viejo,
          mensajes: viejo.mensajes.map((m) => {
            if (m.external_id !== `wa:${vars.mensajeId}` && m.external_id !== vars.mensajeId) return m;
            // Las de OTROS quedan como están: solo se toca la nuestra, que es
            // la única que este gesto puede cambiar.
            const ajenas = (m.reacciones ?? []).filter((r) => !r.nuestra);
            const nuestras = vars.emoji ? [{ emoji: vars.emoji, nuestra: true }] : [];
            const todas = [...ajenas, ...nuestras];
            return { ...m, reacciones: todas.length ? todas : undefined };
          }),
        };
      });
      return { antes, clave };
    },
    onError: (_e, _v, ctx) => {
      // Se deshace: dejar la píldora puesta sobre algo que no salió es peor que
      // no haberla mostrado.
      if (ctx?.antes) qc.setQueryData(ctx.clave, ctx.antes);
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: ['wa', 'conversacion', telefono] }),
  });

  /**
   * EDITAR el texto de un mensaje SALIENTE ya mandado — la corrección de un
   * error de tipeo.
   *
   * Optimista, como reaccionar: la burbuja muestra el texto nuevo al instante
   * y se corrige sola si el server dice que no (línea sin la capacidad, sesión
   * caída, WhatsApp lo rechazó por protocolo — el aviso llega igual por
   * `onError` del componente que la dispara).
   */
  const editar = useMutation({
    mutationFn: (vars: { numeroPropio: string; telefono: string; mensajeId: string; texto: string }) =>
      api<{ ok: true }>('/api/whatsapp/editar', {
        method: 'POST',
        body: JSON.stringify(vars),
      }),
    onMutate: async (vars) => {
      const clave = ['wa', 'conversacion', telefono];
      await qc.cancelQueries({ queryKey: clave });
      const antes = qc.getQueryData(clave);
      const ahora = new Date().toISOString();
      qc.setQueryData(clave, (viejo: { mensajes: MensajeHilo[] } | undefined) => {
        if (!viejo) return viejo;
        return {
          ...viejo,
          mensajes: viejo.mensajes.map((m) =>
            m.external_id === `wa:${vars.mensajeId}` || m.external_id === vars.mensajeId
              ? { ...m, editado: { texto: vars.texto, editadoEn: ahora } }
              : m,
          ),
        };
      });
      return { antes, clave };
    },
    onError: (_e, _v, ctx) => {
      // Se deshace: un texto editado que no salió de verdad es peor que no
      // haberlo mostrado — el lead nunca vio esa corrección.
      if (ctx?.antes) qc.setQueryData(ctx.clave, ctx.antes);
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: ['wa', 'conversacion', telefono] }),
  });

  return { hilo, enviar, enviarMedia, marcarLeido, reaccionar, editar };
}
